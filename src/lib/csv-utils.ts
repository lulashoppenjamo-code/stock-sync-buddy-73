import Papa from "papaparse";
import { supabase } from "@/integrations/supabase/client";

export type ParsedRow = {
  product_name: string;
  barcode: string;
  uom: string | null;
  category: string | null;
  stock_a: number | null;
  stock_b: number | null;
};

export type ImportDiff = {
  newItems: ParsedRow[];
  changedItems: Array<{
    barcode: string;
    current: {
      product_name: string;
      uom: string | null;
      category: string | null;
      stock_a: number;
      stock_b: number;
    };
    next: ParsedRow;
    nameChanged: boolean;
    uomChanged: boolean;
    categoryChanged: boolean;
    stockAChanged: boolean;
    stockBChanged: boolean;
  }>;
  identical: number;
  invalid: number;
};

function pick(r: Record<string, unknown>, keys: string[]): string {
  for (const k of keys) {
    const v = r[k];
    if (v != null && String(v).trim() !== "") return String(v).trim();
  }
  return "";
}

function parseNum(s: string): number | null {
  if (!s) return null;
  const n = Number(s.replace(",", "."));
  return Number.isFinite(n) ? n : null;
}

export function parseCsv(file: File): Promise<ParsedRow[]> {
  return new Promise((resolve, reject) => {
    Papa.parse<Record<string, unknown>>(file, {
      header: true,
      skipEmptyLines: true,
      complete: (res) => {
        const rows: ParsedRow[] = [];
        let missingIdx = 0;
        const stamp = Date.now().toString(36).toUpperCase();
        for (const r of res.data) {
          let barcode = pick(r, ["Barcode", "barcode", "BARCODE", "Codigo", "Código", "CodigoBarras"]);
          const base_name = pick(r, ["ProductName", "Product", "Producto", "Nombre", "product_name", "ITEM_NAME", "ItemName"]);
          if (!base_name) continue;
          // If there's a variant name, append it to the product name
          const variant = pick(r, ["VARIANT_NAME", "VariantName", "Variant", "Variante", "variant_name"]);
          const product_name = variant ? `${base_name} ${variant}`.trim() : base_name;
          if (!barcode) {
            missingIdx++;
            // Synthetic code so products without barcode are still imported.
            barcode = `SIN-${stamp}-${String(missingIdx).padStart(4, "0")}`;
          }
          const uom = pick(r, ["UoM", "Uom", "Unidad", "Unit", "ITEM_TYPE"]) || null;
          const category = pick(r, ["Category", "Categoria", "Categoría", "category", "CATEGORY"]) || null;
          const stock_a = parseNum(pick(r, ["StockA", "Stock_A", "Stock A", "Mina", "StockMina", "Stock Mina", "STOCK"]));
          const stock_b = parseNum(pick(r, ["StockB", "Stock_B", "Stock B", "Morelos", "StockMorelos", "Stock Morelos"]));
          rows.push({ barcode, product_name, uom, category, stock_a, stock_b });
        }
        const map = new Map<string, ParsedRow>();
        for (const r of rows) map.set(r.barcode, r);
        resolve(Array.from(map.values()));
      },
      error: reject,
    });
  });
}

export async function buildDiff(rows: ParsedRow[]): Promise<ImportDiff> {
  const barcodes = rows.map((r) => r.barcode);
  const existing = new Map<
    string,
    { product_name: string; uom: string | null; category: string | null; stock_a: number; stock_b: number }
  >();
  for (let i = 0; i < barcodes.length; i += 500) {
    const chunk = barcodes.slice(i, i + 500);
    const { data, error } = await supabase
      .from("products")
      .select("barcode, product_name, uom, category, stock_a, stock_b")
      .in("barcode", chunk);
    if (error) throw error;
    for (const p of data ?? [])
      existing.set(p.barcode, {
        product_name: p.product_name,
        uom: p.uom,
        category: p.category,
        stock_a: Number(p.stock_a),
        stock_b: Number(p.stock_b),
      });
  }
  const diff: ImportDiff = { newItems: [], changedItems: [], identical: 0, invalid: 0 };
  for (const r of rows) {
    const cur = existing.get(r.barcode);
    if (!cur) {
      diff.newItems.push(r);
    } else {
      const nameChanged = cur.product_name !== r.product_name;
      const uomChanged = (cur.uom ?? "") !== (r.uom ?? "");
      const categoryChanged = (cur.category ?? "") !== (r.category ?? "");
      const stockAChanged = r.stock_a != null && Number(cur.stock_a) !== r.stock_a;
      const stockBChanged = r.stock_b != null && Number(cur.stock_b) !== r.stock_b;
      if (nameChanged || uomChanged || categoryChanged || stockAChanged || stockBChanged) {
        diff.changedItems.push({
          barcode: r.barcode,
          current: cur,
          next: r,
          nameChanged,
          uomChanged,
          categoryChanged,
          stockAChanged,
          stockBChanged,
        });
      } else {
        diff.identical++;
      }
    }
  }
  return diff;
}

export const IMPORT_BATCH_SIZE = 100;

export type ApplyProgress = {
  done: number;
  total: number;
  phase: "insert" | "update";
};

export type ApplyError = {
  barcode: string;
  product_name: string;
  message: string;
};

export type ApplyResult = {
  inserted: number;
  updated: number;
  errors: ApplyError[];
  /** true if the import was cut short by a hard failure (e.g. network/DB down) */
  aborted: boolean;
  /** present when `aborted` is true: exactly where the process stopped */
  failedAt?: { barcode: string; product_name: string; index: number; total: number; message: string };
};

export async function applyImport(
  diff: ImportDiff,
  opts: { updateName: boolean; updateUom: boolean; updateCategory: boolean; updateStockA: boolean; updateStockB: boolean },
  collab: { id: string; name: string } | null,
  filename: string | null,
  onProgress?: (p: ApplyProgress) => void,
): Promise<ApplyResult> {
  const total = diff.newItems.length + diff.changedItems.length;
  let done = 0;
  let inserted = 0;
  let updated = 0;
  const errors: ApplyError[] = [];

  // ── Fase 1: altas, en lotes de 100 ────────────────────────────────────
  for (let i = 0; i < diff.newItems.length; i += IMPORT_BATCH_SIZE) {
    const chunk = diff.newItems.slice(i, i + IMPORT_BATCH_SIZE);
    try {
      const { error } = await supabase.from("products").upsert(
        chunk.map((r) => ({
          barcode: r.barcode,
          product_name: r.product_name,
          uom: r.uom,
          category: r.category,
          stock_a: r.stock_a ?? 0,
          stock_b: r.stock_b ?? 0,
        })),
        { onConflict: "barcode", ignoreDuplicates: true },
      );
      if (error) throw error;
      inserted += chunk.length;
      done += chunk.length;
      onProgress?.({ done, total, phase: "insert" });
    } catch (e) {
      // Fallo "duro" (red/DB caída, etc.): lo ya confirmado en lotes previos
      // queda guardado en la base. Reportamos el punto exacto donde se detuvo.
      return {
        inserted,
        updated,
        errors,
        aborted: true,
        failedAt: {
          barcode: chunk[0].barcode,
          product_name: chunk[0].product_name,
          index: i + 1,
          total,
          message: (e as Error).message ?? "Error desconocido",
        },
      };
    }
  }

  // ── Fase 2: actualizaciones, en lotes de 100 (en paralelo dentro del lote) ─
  for (let i = 0; i < diff.changedItems.length; i += IMPORT_BATCH_SIZE) {
    const chunk = diff.changedItems.slice(i, i + IMPORT_BATCH_SIZE);
    const results = await Promise.allSettled(
      chunk.map(async (c) => {
        const patch: {
          product_name?: string;
          uom?: string | null;
          category?: string | null;
          stock_a?: number;
          stock_b?: number;
        } = {};
        if (opts.updateName && c.nameChanged) patch.product_name = c.next.product_name;
        if (opts.updateUom && c.uomChanged) patch.uom = c.next.uom;
        if (opts.updateCategory && c.categoryChanged) patch.category = c.next.category;
        if (opts.updateStockA && c.stockAChanged && c.next.stock_a != null) patch.stock_a = c.next.stock_a;
        if (opts.updateStockB && c.stockBChanged && c.next.stock_b != null) patch.stock_b = c.next.stock_b;
        if (Object.keys(patch).length === 0) return { skipped: true };
        const { error } = await supabase.from("products").update(patch).eq("barcode", c.barcode);
        if (error) throw error;
        return { skipped: false };
      }),
    );

    results.forEach((r, idx) => {
      const c = chunk[idx];
      if (r.status === "fulfilled") {
        if (!r.value.skipped) updated++;
      } else {
        errors.push({
          barcode: c.barcode,
          product_name: c.next.product_name,
          message: (r.reason as Error)?.message ?? "Error desconocido",
        });
      }
    });

    done += chunk.length;
    onProgress?.({ done, total, phase: "update" });
  }

  // El registro de historial no debe hacer fallar toda la importación si falla.
  try {
    await supabase.from("csv_imports").insert({
      filename,
      new_count: inserted,
      updated_count: updated,
      skipped_count: diff.identical + (diff.changedItems.length - updated - errors.length),
      collaborator_id: collab?.id ?? null,
      collaborator_name: collab?.name ?? null,
    });
  } catch {
    // no crítico: la importación de productos ya se completó
  }

  return { inserted, updated, errors, aborted: false };
}
