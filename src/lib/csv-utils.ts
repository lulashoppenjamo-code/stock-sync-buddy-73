import Papa from "papaparse";
import { supabase } from "@/integrations/supabase/client";

export type ParsedRow = {
  product_name: string;
  barcode: string;
  uom: string | null;
  category: string | null;
  stock_a: number | null;
  stock_b: number | null;
  price: number | null;
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
      price: number;
    };
    next: ParsedRow;
    nameChanged: boolean;
    uomChanged: boolean;
    categoryChanged: boolean;
    stockAChanged: boolean;
    stockBChanged: boolean;
    priceChanged: boolean;
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
            // No barcode — leave empty. buildDiff will match by product_name instead.
            barcode = "";
          }
          const uom = pick(r, ["UoM", "Uom", "Unidad", "Unit", "ITEM_TYPE"]) || null;
          const category = pick(r, ["Category", "Categoria", "Categoría", "category", "CATEGORY"]) || null;
          const stock_a = parseNum(pick(r, ["StockA", "Stock_A", "Stock A", "Mina", "StockMina", "Stock Mina", "STOCK"]));
          const stock_b = parseNum(pick(r, ["StockB", "Stock_B", "Stock B", "Morelos", "StockMorelos", "Stock Morelos"]));
          const price = parseNum(pick(r, ["Price", "Precio", "price", "PRICE", "PrecioUnitario", "UnitPrice", "Precio_Unitario"]));
          rows.push({ barcode, product_name, uom, category, stock_a, stock_b, price });
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
  // Separate rows with barcode from those without
  const rowsWithBarcode = rows.filter((r) => r.barcode !== "");
  const rowsWithoutBarcode = rows.filter((r) => r.barcode === "");

  const existing = new Map<
    string,
    { id?: string; barcode: string; product_name: string; uom: string | null; category: string | null; stock_a: number; stock_b: number; price: number }
  >();

  // Match rows WITH barcode by barcode
  const barcodes = rowsWithBarcode.map((r) => r.barcode);
  for (let i = 0; i < barcodes.length; i += 500) {
    const chunk = barcodes.slice(i, i + 500);
    const { data, error } = await supabase
      .from("products")
      .select("barcode, product_name, uom, category, stock_a, stock_b, price")
      .in("barcode", chunk);
    if (error) throw error;
    for (const p of data ?? [])
      existing.set(p.barcode, {
        barcode: p.barcode,
        product_name: p.product_name,
        uom: p.uom,
        category: p.category,
        stock_a: Number(p.stock_a),
        stock_b: Number(p.stock_b),
        price: Number((p as { price?: number }).price ?? 0),
      });
  }

  // Match rows WITHOUT barcode by product_name
  const noBarNames = rowsWithoutBarcode.map((r) => r.product_name);
  const existingByName = new Map<
    string,
    { barcode: string; product_name: string; uom: string | null; category: string | null; stock_a: number; stock_b: number; price: number }
  >();
  for (let i = 0; i < noBarNames.length; i += 500) {
    const chunk = noBarNames.slice(i, i + 500);
    const { data, error } = await supabase
      .from("products")
      .select("barcode, product_name, uom, category, stock_a, stock_b, price")
      .in("product_name", chunk);
    if (error) throw error;
    for (const p of data ?? [])
      existingByName.set(p.product_name, {
        barcode: p.barcode,
        product_name: p.product_name,
        uom: p.uom,
        category: p.category,
        stock_a: Number(p.stock_a),
        stock_b: Number(p.stock_b),
        price: Number((p as { price?: number }).price ?? 0),
      });
  }

  const diff: ImportDiff = { newItems: [], changedItems: [], identical: 0, invalid: 0 };

  // Process rows WITH barcode normally
  for (const r of rowsWithBarcode) {
    const cur = existing.get(r.barcode);
    if (!cur) {
      diff.newItems.push(r);
    } else {
      const nameChanged = cur.product_name !== r.product_name;
      const uomChanged = (cur.uom ?? "") !== (r.uom ?? "");
      const categoryChanged = (cur.category ?? "") !== (r.category ?? "");
      const stockAChanged = r.stock_a != null && Number(cur.stock_a) !== r.stock_a;
      const stockBChanged = r.stock_b != null && Number(cur.stock_b) !== r.stock_b;
      const priceChanged = r.price != null && Number(cur.price) !== r.price;
      if (nameChanged || uomChanged || categoryChanged || stockAChanged || stockBChanged || priceChanged) {
        diff.changedItems.push({ barcode: r.barcode, current: cur, next: r, nameChanged, uomChanged, categoryChanged, stockAChanged, stockBChanged, priceChanged });
      } else {
        diff.identical++;
      }
    }
  }

  // Process rows WITHOUT barcode — match by name
  for (const r of rowsWithoutBarcode) {
    const cur = existingByName.get(r.product_name);
    if (!cur) {
      // Truly new product — create with empty barcode
      diff.newItems.push(r);
    } else {
      // Exists by name — use its real barcode to update
      const rWithBarcode = { ...r, barcode: cur.barcode };
      const uomChanged = (cur.uom ?? "") !== (r.uom ?? "");
      const categoryChanged = (cur.category ?? "") !== (r.category ?? "");
      const stockAChanged = r.stock_a != null && Number(cur.stock_a) !== r.stock_a;
      const stockBChanged = r.stock_b != null && Number(cur.stock_b) !== r.stock_b;
      const priceChanged = r.price != null && Number(cur.price) !== r.price;
      if (uomChanged || categoryChanged || stockAChanged || stockBChanged || priceChanged) {
        diff.changedItems.push({ barcode: cur.barcode, current: cur, next: rWithBarcode, nameChanged: false, uomChanged, categoryChanged, stockAChanged, stockBChanged, priceChanged });
      } else {
        diff.identical++;
      }
    }
  }

  return diff;
}

export type ImportError = { barcode: string; product_name: string; message: string };

export type ApplyProgress = { done: number; total: number; phase: "insert" | "update" };

export type ApplyResult = {
  inserted: number;
  updated: number;
  errors: ImportError[];
  aborted?: boolean;
  failedAt?: { barcode: string; product_name: string; index: number; total: number; message: string };
};

const CHUNK_SIZE = 200;
const MAX_ATTEMPTS = 3;

export function formatError(err: unknown): string {
  if (!err) return "Error desconocido";
  if (typeof err === "string") return err;
  const e = err as { message?: string; details?: string; hint?: string; code?: string };
  const parts = [e.message, e.details, e.hint].filter((p): p is string => !!p && p.trim() !== "");
  if (parts.length > 0) return e.code ? `${parts.join(" — ")} (${e.code})` : parts.join(" — ");
  try {
    const json = JSON.stringify(err);
    if (json && json !== "{}") return json;
  } catch {
    /* ignore */
  }
  return "Error desconocido";
}

function isRetryable(err: unknown): boolean {
  const msg = formatError(err);
  return /fetch|network|timeout|ECONN|NetworkError/i.test(msg);
}


function sleep(ms: number) {
  return new Promise((res) => setTimeout(res, ms));
}

async function withRetry<T>(fn: () => Promise<T>, attempts = MAX_ATTEMPTS): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (attempt === attempts || !isRetryable(err)) throw err;
      await sleep(300 * attempt);
    }
  }
  throw lastErr;
}

type ProductRow = {
  barcode: string;
  product_name: string;
  uom: string | null;
  category: string | null;
  stock_a: number;
  stock_b: number;
  price: number;
};

function sanitize(r: ProductRow): ProductRow {
  const clean = (s: string | null, max: number) => {
    if (s == null) return null;
    const t = s.replace(/\u0000/g, "").trim().slice(0, max);
    return t === "" ? null : t;
  };
  const num = (n: number) => (Number.isFinite(n) ? n : 0);
  return {
    barcode: (clean(r.barcode, 120) ?? "").toString(),
    product_name: clean(r.product_name, 300) ?? "Sin nombre",
    uom: clean(r.uom, 60),
    category: clean(r.category, 120),
    stock_a: num(Number(r.stock_a)),
    stock_b: num(Number(r.stock_b)),
    price: num(Number(r.price)),
  };
}

/**
 * Upsert rows in chunks. If a chunk fails, it is split recursively and finally
 * retried row by row, so a single bad row never blocks the rest of the file.
 */
async function upsertProducts(
  rows: ProductRow[],
  ignoreDuplicates: boolean,
  errors: ImportError[],
  onOk: (n: number) => void,
): Promise<void> {
  const send = async (batch: ProductRow[]) => {
    const { error } = await supabase
      .from("products")
      .upsert(batch, { onConflict: "barcode", ignoreDuplicates });
    if (error) throw error;
  };

  const run = async (batch: ProductRow[]): Promise<void> => {
    if (batch.length === 0) return;
    try {
      await withRetry(() => send(batch));
      onOk(batch.length);
      return;
    } catch (err) {
      if (batch.length === 1) {
        errors.push({
          barcode: batch[0].barcode,
          product_name: batch[0].product_name,
          message: formatError(err),
        });
        return;
      }
      const mid = Math.floor(batch.length / 2);
      await run(batch.slice(0, mid));
      await run(batch.slice(mid));
    }
  };

  for (let i = 0; i < rows.length; i += CHUNK_SIZE) {
    await run(rows.slice(i, i + CHUNK_SIZE));
  }
}

export async function applyImport(
  diff: ImportDiff,
  opts: { updateName: boolean; updateUom: boolean; updateCategory: boolean; updateStockA: boolean; updateStockB: boolean },
  collab: { id: string; name: string } | null,
  filename: string | null,
  onProgress?: (p: ApplyProgress) => void,
): Promise<ApplyResult> {
  const errors: ImportError[] = [];
  let inserted = 0;
  let updated = 0;

  const newRows: ProductRow[] = diff.newItems
    .map((r) =>
      sanitize({
        barcode: r.barcode,
        product_name: r.product_name,
        uom: r.uom,
        category: r.category,
        stock_a: r.stock_a ?? 0,
        stock_b: r.stock_b ?? 0,
      }),
    )
    .filter((r) => r.barcode !== "");

  const updateLabels = new Map<string, string>();
  const rowsToUpdate: ProductRow[] = [];
  for (const c of diff.changedItems) {
    const patch: Partial<ProductRow> = {};
    if (opts.updateName && c.nameChanged) patch.product_name = c.next.product_name;
    if (opts.updateUom && c.uomChanged) patch.uom = c.next.uom;
    if (opts.updateCategory && c.categoryChanged) patch.category = c.next.category;
    if (opts.updateStockA && c.stockAChanged && c.next.stock_a != null) patch.stock_a = c.next.stock_a;
    if (opts.updateStockB && c.stockBChanged && c.next.stock_b != null) patch.stock_b = c.next.stock_b;
    if (Object.keys(patch).length === 0) continue;
    const row = sanitize({
      barcode: c.barcode,
      product_name: c.current.product_name,
      uom: c.current.uom,
      category: c.current.category,
      stock_a: c.current.stock_a,
      stock_b: c.current.stock_b,
      ...patch,
    });
    if (row.barcode === "") continue;
    updateLabels.set(row.barcode, row.product_name);
    rowsToUpdate.push(row);
  }

  const total = newRows.length + rowsToUpdate.length;

  await upsertProducts(newRows, true, errors, (n) => {
    inserted += n;
    onProgress?.({ done: inserted, total, phase: "insert" });
  });

  await upsertProducts(rowsToUpdate, false, errors, (n) => {
    updated += n;
    onProgress?.({ done: inserted + updated, total, phase: "update" });
  });


  try {
    await supabase.from("csv_imports").insert({
      filename,
      new_count: inserted,
      updated_count: updated,
      skipped_count: diff.identical + errors.length,
      collaborator_id: collab?.id ?? null,
      collaborator_name: collab?.name ?? null,
    });
  } catch {
    /* el registro del historial no debe invalidar la importación */
  }


  return { inserted, updated, errors };
}
