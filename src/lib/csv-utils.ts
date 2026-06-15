import Papa from "papaparse";
import { supabase } from "@/integrations/supabase/client";

export type CsvRow = { ProductName: string; Barcode: string; UoM?: string };
export type ParsedRow = { product_name: string; barcode: string; uom: string | null };

export type ImportDiff = {
  newItems: ParsedRow[];
  changedItems: Array<{
    barcode: string;
    current: { product_name: string; uom: string | null };
    next: ParsedRow;
    nameChanged: boolean;
    uomChanged: boolean;
  }>;
  identical: number;
  invalid: number;
};

export function parseCsv(file: File): Promise<ParsedRow[]> {
  return new Promise((resolve, reject) => {
    Papa.parse<CsvRow>(file, {
      header: true,
      skipEmptyLines: true,
      complete: (res) => {
        const rows: ParsedRow[] = [];
        for (const r of res.data) {
          const barcode = String((r as any).Barcode ?? "").trim();
          const product_name = String((r as any).ProductName ?? "").trim();
          if (!barcode || !product_name) continue;
          const uom = String((r as any).UoM ?? "").trim() || null;
          rows.push({ barcode, product_name, uom });
        }
        resolve(rows);
      },
      error: reject,
    });
  });
}

export async function buildDiff(rows: ParsedRow[]): Promise<ImportDiff> {
  const barcodes = rows.map((r) => r.barcode);
  const existing = new Map<string, { product_name: string; uom: string | null }>();
  // Chunk in 500
  for (let i = 0; i < barcodes.length; i += 500) {
    const chunk = barcodes.slice(i, i + 500);
    const { data, error } = await supabase
      .from("products")
      .select("barcode, product_name, uom")
      .in("barcode", chunk);
    if (error) throw error;
    for (const p of data ?? []) existing.set(p.barcode, { product_name: p.product_name, uom: p.uom });
  }
  const diff: ImportDiff = { newItems: [], changedItems: [], identical: 0, invalid: 0 };
  for (const r of rows) {
    const cur = existing.get(r.barcode);
    if (!cur) {
      diff.newItems.push(r);
    } else {
      const nameChanged = cur.product_name !== r.product_name;
      const uomChanged = (cur.uom ?? "") !== (r.uom ?? "");
      if (nameChanged || uomChanged) {
        diff.changedItems.push({ barcode: r.barcode, current: cur, next: r, nameChanged, uomChanged });
      } else {
        diff.identical++;
      }
    }
  }
  return diff;
}

export async function applyImport(
  diff: ImportDiff,
  opts: { updateName: boolean; updateUom: boolean },
  collab: { id: string; name: string } | null,
  filename: string | null,
) {
  // Insert new items (stocks default to 0)
  if (diff.newItems.length) {
    for (let i = 0; i < diff.newItems.length; i += 500) {
      const chunk = diff.newItems.slice(i, i + 500);
      const { error } = await supabase.from("products").insert(
        chunk.map((r) => ({ barcode: r.barcode, product_name: r.product_name, uom: r.uom })),
      );
      if (error) throw error;
    }
  }
  // Update changed items per chosen fields
  let updated = 0;
  if (opts.updateName || opts.updateUom) {
    for (const c of diff.changedItems) {
      const patch: Record<string, unknown> = {};
      if (opts.updateName && c.nameChanged) patch.product_name = c.next.product_name;
      if (opts.updateUom && c.uomChanged) patch.uom = c.next.uom;
      if (Object.keys(patch).length === 0) continue;
      const { error } = await supabase.from("products").update(patch).eq("barcode", c.barcode);
      if (error) throw error;
      updated++;
    }
  }
  await supabase.from("csv_imports").insert({
    filename,
    new_count: diff.newItems.length,
    updated_count: updated,
    skipped_count: diff.identical + (diff.changedItems.length - updated),
    collaborator_id: collab?.id ?? null,
    collaborator_name: collab?.name ?? null,
  });
  return { inserted: diff.newItems.length, updated };
}
