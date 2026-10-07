import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState, useMemo } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Checkbox } from "@/components/ui/checkbox";
import { Progress } from "@/components/ui/progress";
import { Upload, Search, Loader2, FileSpreadsheet, Check, Plus, Trash2, FolderPlus, Lock, AlertTriangle } from "lucide-react";
import { toast } from "sonner";
import { parseCsv, parseZobazeXlsx, buildDiff, applyImport, type ImportDiff, type ApplyProgress, type ApplyResult } from "@/lib/csv-utils";
import { getCollaborator } from "@/lib/session";
import { BRANCH_LABELS } from "@/lib/branches";

export const Route = createFileRoute("/app/")({
  component: ProductsPage,
});

type Product = {
  barcode: string;
  product_name: string;
  uom: string | null;
  category: string | null;
  stock_a: number;
  stock_b: number;
  updated_at: string;
};

// ── Debounce hook ──────────────────────────────────────────────────────
function useDebounce<T>(value: T, delay = 300): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(t);
  }, [value, delay]);
  return debounced;
}

function ProductsPage() {
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState<string>("__all__");
  const debouncedSearch = useDebounce(search, 250);

  const { data, isLoading } = useQuery({
    queryKey: ["products"],
    queryFn: async () => {
      try {
        // Paginate to get ALL products, not just first 5000
        const all: Product[] = [];
        const pageSize = 1000;
        let from = 0;
        while (true) {
          const { data, error } = await supabase
            .from("products")
            .select("barcode, product_name, uom, category, stock_a, stock_b, updated_at")
            .order("product_name")
            .range(from, from + pageSize - 1);
          if (error) throw error;
          all.push(...(data as Product[]));
          if ((data ?? []).length < pageSize) break;
          from += pageSize;
        }
        // Actualizar caché offline en segundo plano
        import("@/lib/offline-cache").then(({ refreshProductsCache }) => {
          refreshProductsCache().catch(() => {});
        });
        return all;
      } catch {
        const { getCachedProducts } = await import("@/lib/offline-cache");
        const cached = await getCachedProducts();
        return cached.map((p) => ({
          barcode: p.barcode,
          product_name: p.product_name,
          uom: p.uom,
          category: p.category,
          stock_a: p.stock_a,
          stock_b: p.stock_b,
          updated_at: p.updated_at ?? "",
        })) as Product[];
      }
    },
  });

  const { data: managedCategories = [] } = useQuery({
    queryKey: ["categories"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("categories")
        .select("name")
        .order("name");
      if (error) throw error;
      return (data ?? []).map((r) => r.name as string);
    },
  });

  const categories = useMemo(() =>
    Array.from(new Set([
      ...managedCategories,
      ...(data ?? []).map((p) => p.category).filter((c): c is string => !!c),
    ])).sort(),
    [managedCategories, data]
  );

  const filtered = useMemo(() =>
    (data ?? []).filter((p) => {
      if (category !== "__all__" && (p.category ?? "") !== category) return false;
      if (!debouncedSearch.trim()) return true;
      const q = debouncedSearch.toLowerCase();
      return p.product_name.toLowerCase().includes(q) || p.barcode.includes(q);
    }),
    [data, category, debouncedSearch]
  );

  const totalUnits = useMemo(() =>
    filtered.reduce((s, p) => s + Number(p.stock_a) + Number(p.stock_b), 0),
    [filtered]
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="mr-auto text-xl font-semibold tracking-tight">Productos</h1>
        <NewCategoryButton />
        <AddProductButton categories={categories} />
        <ImportCsvButton />
        <DeleteAllProductsButton hasProducts={(data ?? []).length > 0} />
      </div>

      <div className="flex flex-col gap-2 sm:flex-row">
        <div className="relative min-w-0 flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Buscar producto..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-9"
          />
        </div>
        <select
          value={category}
          onChange={(e) => setCategory(e.target.value)}
          className="h-10 w-full rounded-md border bg-background px-2 text-sm sm:w-auto"
        >
          <option value="__all__">Todas las categorías</option>
          {categories.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
      </div>

      <p className="text-xs text-muted-foreground">
        Tip: tocá el total para editarlo. Se requiere confirmación antes de guardar.
      </p>

      <Card>
        <CardContent className="p-0">
          <div className="max-h-[70vh] overflow-auto">
            <Table>
              <TableHeader className="sticky top-0 bg-card">
                <TableRow>
                  <TableHead>Producto</TableHead>
                  <TableHead className="hidden md:table-cell">Código</TableHead>
                  <TableHead className="hidden md:table-cell">UoM</TableHead>
                  <TableHead className="text-right">Stock total</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading ? (
                  <TableRow>
                    <TableCell colSpan={4} className="py-12 text-center text-muted-foreground">
                      <Loader2 className="mx-auto h-5 w-5 animate-spin" />
                    </TableCell>
                  </TableRow>
                ) : filtered.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={4} className="py-12 text-center text-muted-foreground">
                      {search ? "Sin resultados para esa búsqueda." : "Sin productos. Importá un CSV para empezar."}
                    </TableCell>
                  </TableRow>
                ) : (
                  filtered.map((p) => (
                    <TableRow key={p.barcode}>
                      <TableCell>
                        <div className="font-medium">{p.product_name}</div>
                        <div className="flex gap-2 text-xs text-muted-foreground">
                          {p.category && <span className="rounded bg-muted px-1.5 py-0.5">{p.category}</span>}
                          <span className="md:hidden">{p.barcode}</span>
                        </div>
                      </TableCell>
                      <TableCell className="hidden font-mono text-xs md:table-cell">{p.barcode}</TableCell>
                      <TableCell className="hidden md:table-cell">{p.uom ?? "—"}</TableCell>
                      <TableCell className="text-right">
                        <TotalStockCell
                          barcode={p.barcode}
                          productName={p.product_name}
                          value={Number(p.stock_a) + Number(p.stock_b)}
                        />
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      <p className="text-xs text-muted-foreground">
        Total: {filtered.length} producto{filtered.length === 1 ? "" : "s"} · {totalUnits} unidades en sistema
        {(data ?? []).length > filtered.length && ` (de ${(data ?? []).length} totales)`}
      </p>
    </div>
  );
}

// ── TotalStockCell with confirmation dialog ────────────────────────────
function TotalStockCell({ barcode, productName, value }: { barcode: string; productName: string; value: number }) {
  const qc = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [val, setVal] = useState(String(value));
  const [saving, setSaving] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [pendingVal, setPendingVal] = useState<number | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { if (!editing) setVal(String(value)); }, [value, editing]);
  useEffect(() => { if (editing) inputRef.current?.select(); }, [editing]);

  function requestSave() {
    const n = Number(val);
    if (!Number.isFinite(n) || n < 0) { toast.error("Cantidad inválida"); return; }
    if (n === value) { setEditing(false); return; }
    setPendingVal(n);
    setConfirmOpen(true);
  }

  async function confirmSave() {
    if (pendingVal === null) return;
    setSaving(true);
    setConfirmOpen(false);
    try {
      const collab = getCollaborator();
      const { error } = await supabase
        .from("products")
        .update({ stock_a: pendingVal, stock_b: 0 })
        .eq("barcode", barcode);
      if (error) throw error;
      // Log the stock change
      await supabase.from("audits").insert({
        branch: "A",
        barcode,
        product_name: productName,
        system_stock: value,
        physical_count: pendingVal,
        difference: pendingVal - value,
        collaborator_id: collab?.id ?? null,
        collaborator_name: collab?.name ?? "Desconocido",
        client_uid: `stock-edit-${crypto.randomUUID()}`,
      });
      toast.success(`Stock actualizado: ${value} → ${pendingVal}`);
      setEditing(false);
      qc.invalidateQueries({ queryKey: ["products"] });
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSaving(false);
      setPendingVal(null);
    }
  }

  if (!editing) {
    return (
      <button onClick={() => setEditing(true)}
        className="rounded px-2 py-1 tabular-nums hover:bg-muted"
        aria-label="Editar stock total">
        {value}
      </button>
    );
  }

  return (
    <>
      <div className="flex items-center justify-end gap-1">
        <Input ref={inputRef} type="number" inputMode="decimal" step="any" min={0}
          value={val} onChange={(e) => setVal(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") requestSave(); if (e.key === "Escape") setEditing(false); }}
          onBlur={requestSave} disabled={saving}
          className="h-8 w-20 text-right" />
        <Button type="button" size="icon" variant="ghost" className="h-8 w-8"
          onMouseDown={(e) => e.preventDefault()} onClick={requestSave} disabled={saving}>
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
        </Button>
      </div>

      {/* Confirmation dialog */}
      <Dialog open={confirmOpen} onOpenChange={(o) => { if (!o) { setConfirmOpen(false); setEditing(false); } }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Lock className="h-4 w-4" /> Confirmar cambio de stock
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-2 text-sm">
            <p className="font-medium truncate">{productName}</p>
            <div className="flex items-center gap-3 rounded-md bg-muted p-3 tabular-nums">
              <div className="text-center">
                <div className="text-xs text-muted-foreground">Actual</div>
                <div className="text-xl font-bold">{value}</div>
              </div>
              <div className="text-muted-foreground">→</div>
              <div className="text-center">
                <div className="text-xs text-muted-foreground">Nuevo</div>
                <div className={`text-xl font-bold ${(pendingVal ?? 0) < value ? "text-red-600" : "text-emerald-600"}`}>
                  {pendingVal}
                </div>
              </div>
              <div className="text-center">
                <div className="text-xs text-muted-foreground">Diferencia</div>
                <div className={`text-sm font-semibold ${(pendingVal ?? 0) - value < 0 ? "text-red-600" : "text-emerald-600"}`}>
                  {(pendingVal ?? 0) - value > 0 ? "+" : ""}{(pendingVal ?? 0) - value}
                </div>
              </div>
            </div>
            <p className="text-xs text-muted-foreground">Este cambio quedará registrado en el historial de auditorías.</p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setConfirmOpen(false); setEditing(false); }}>Cancelar</Button>
            <Button onClick={confirmSave} disabled={saving}>
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
              Confirmar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

// ── ImportCsvButton ──────────────────────────────────────────────────────
function ImportCsvButton() {
  const qc = useQueryClient();
  const inputRef = useRef<HTMLInputElement>(null);
  const [diff, setDiff] = useState<ImportDiff | null>(null);
  const [filename, setFilename] = useState<string | null>(null);
  const [updateName, setUpdateName] = useState(true);
  const [updateUom, setUpdateUom] = useState(true);
  const [updateCategory, setUpdateCategory] = useState(true);
  const [updateStockA, setUpdateStockA] = useState(false);
  const [updateStockB, setUpdateStockB] = useState(false);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<ApplyProgress | null>(null);
  const [result, setResult] = useState<ApplyResult | null>(null);

  async function onFile(file: File) {
    setBusy(true);
    try {
      const isXlsx = /\.xlsx$/i.test(file.name);
      const rows = isXlsx ? await parseZobazeXlsx(file) : await parseCsv(file);
      if (!rows.length) { toast.error(isXlsx ? "Excel vacío o sin filas válidas (columnas: ITEM_NAME, BARCODE, ITEM_TYPE, CATEGORY, STOCK, PRICE)" : "CSV vacío. Columnas: ProductName, Barcode, UoM, Category, StockA, StockB"); return; }
      const d = await buildDiff(rows);
      setDiff(d); setFilename(file.name);
    } catch (e) { toast.error((e as Error).message); }
    finally { setBusy(false); }
  }

  async function confirmApply() {
    if (!diff) return;
    setBusy(true);
    setResult(null);
    setProgress({ done: 0, total: diff.newItems.length + diff.changedItems.length, phase: "insert" });
    try {
      const collab = getCollaborator();
      const res = await applyImport(
        diff,
        { updateName, updateUom, updateCategory, updateStockA, updateStockB },
        collab,
        filename,
        (p) => setProgress(p),
      );
      setResult(res);
      if (!res.aborted) {
        qc.invalidateQueries({ queryKey: ["products"] });
        qc.invalidateQueries({ queryKey: ["categories"] });
      }
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  function closeAll() {
    setDiff(null); setFilename(null); setProgress(null); setResult(null);
  }

  const total = progress?.total ?? 0;
  const pct = total > 0 ? Math.round(((progress?.done ?? 0) / total) * 100) : 0;
  const isImporting = busy && !result;

  return (
    <>
      <input ref={inputRef} type="file" accept=".csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" className="hidden"
        onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) onFile(f); }} />
      <Button onClick={() => inputRef.current?.click()} disabled={busy}>
        {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />} Importar CSV / Excel
      </Button>
      <Dialog open={!!diff} onOpenChange={(o) => !o && !isImporting && closeAll()}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <FileSpreadsheet className="h-5 w-5" />
              {result ? "Resultado de la importación" : "Vista previa de importación"}
            </DialogTitle>
          </DialogHeader>

          {/* Progreso en curso */}
          {diff && isImporting && (
            <div className="space-y-3 py-2">
              <Progress value={pct} />
              <p className="text-sm text-center text-muted-foreground">
                {progress?.phase === "insert" ? "Importando" : "Actualizando"}{" "}
                {(progress?.done ?? 0).toLocaleString("es-MX")} de {total.toLocaleString("es-MX")}...
              </p>
              <p className="text-xs text-center text-muted-foreground">
                Podés dejar esta ventana abierta, la importación sigue en segundo plano.
              </p>
            </div>
          )}

          {/* Resumen final */}
          {result && (
            <div className="space-y-4 text-sm">
              {result.aborted && result.failedAt && (
                <div className="flex items-start gap-2 rounded-md border border-destructive/50 bg-destructive/10 p-3 text-destructive">
                  <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
                  <div>
                    <p className="font-medium">La importación se detuvo</p>
                    <p className="text-xs mt-1">
                      Falló en el producto <span className="font-mono">{result.failedAt.barcode}</span> — {result.failedAt.product_name}
                      {" "}(posición {result.failedAt.index} de {result.failedAt.total}). {result.failedAt.message}
                    </p>
                    <p className="text-xs mt-1">
                      Lo procesado hasta ese punto ya quedó guardado. Podés volver a importar el mismo archivo:
                      lo ya cargado se detectará como idéntico y solo continuará desde ahí.
                    </p>
                  </div>
                </div>
              )}
              <div className="grid grid-cols-3 gap-2">
                <Stat label="Nuevos" value={result.inserted} tone="positive" />
                <Stat label="Actualizados" value={result.updated} tone="warning" />
                <Stat label="Errores" value={result.errors.length} tone={result.errors.length ? "warning" : "muted"} />
              </div>
              {result.errors.length > 0 && (
                <details className="rounded-md border p-2 text-xs" open>
                  <summary className="cursor-pointer font-medium">Ver errores ({result.errors.length})</summary>
                  <ul className="mt-2 space-y-1 max-h-40 overflow-y-auto">
                    {result.errors.map((e) => (
                      <li key={e.barcode} className="font-mono">
                        {e.barcode} — {e.product_name}: <span className="text-destructive">{e.message}</span>
                      </li>
                    ))}
                  </ul>
                </details>
              )}
            </div>
          )}

          {/* Vista previa antes de aplicar */}
          {diff && !isImporting && !result && (
            <div className="space-y-4 text-sm">
              <div className="grid grid-cols-3 gap-2">
                <Stat label="Nuevos" value={diff.newItems.length} tone="positive" />
                <Stat label="Con cambios" value={diff.changedItems.length} tone="warning" />
                <Stat label="Idénticos" value={diff.identical} tone="muted" />
              </div>
              <p className="text-xs text-muted-foreground">
                Nuevos se crean con la categoría y stocks del CSV. Para existentes, elegí qué actualizar.
              </p>
              {diff.changedItems.length > 0 && (
                <div className="space-y-2 rounded-md border p-3">
                  <div className="text-sm font-medium">Actualizar en existentes:</div>
                  {[
                    [updateName, setUpdateName, "Nombre"],
                    [updateUom, setUpdateUom, "Unidad (UoM)"],
                    [updateCategory, setUpdateCategory, "Categoría"],
                    [updateStockA, setUpdateStockA, `Stock ${BRANCH_LABELS.A} (sobrescribe)`],
                    [updateStockB, setUpdateStockB, `Stock ${BRANCH_LABELS.B} (sobrescribe)`],
                  ].map(([val, setter, label]) => (
                    <label key={label as string} className="flex items-center gap-2 text-sm">
                      <Checkbox checked={val as boolean} onCheckedChange={(v) => (setter as any)(!!v)} /> {label as string}
                    </label>
                  ))}
                </div>
              )}
              {diff.newItems.length > 0 && (
                <details className="rounded-md border p-2 text-xs">
                  <summary className="cursor-pointer">Ver primeros 10 nuevos</summary>
                  <ul className="mt-2 space-y-1">
                    {diff.newItems.slice(0, 10).map((r) => (
                      <li key={r.barcode} className="font-mono">{r.barcode} — {r.product_name}{r.category ? ` · ${r.category}` : ""}</li>
                    ))}
                  </ul>
                </details>
              )}
            </div>
          )}

          <DialogFooter>
            {result ? (
              <Button onClick={closeAll}>Cerrar</Button>
            ) : (
              <>
                <Button variant="outline" onClick={closeAll} disabled={isImporting}>Cancelar</Button>
                <Button onClick={confirmApply} disabled={isImporting}>
                  {isImporting ? <Loader2 className="h-4 w-4 animate-spin" /> : "Aplicar"}
                </Button>
              </>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

function AddProductButton({ categories }: { categories: string[] }) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [barcode, setBarcode] = useState("");
  const [name, setName] = useState("");
  const [uom, setUom] = useState("");
  const [category, setCategory] = useState("");
  const [total, setTotal] = useState("0");
  const [busy, setBusy] = useState(false);

  function reset() { setBarcode(""); setName(""); setUom(""); setCategory(""); setTotal("0"); }

  async function save() {
    const b = barcode.trim(); const n = name.trim();
    if (!b || !n) { toast.error("Código y nombre son obligatorios"); return; }
    const t = Number(total) || 0;
    if (t < 0) { toast.error("Stock inválido"); return; }
    setBusy(true);
    try {
      const { data: existing } = await supabase.from("products").select("barcode").eq("barcode", b).maybeSingle();
      if (existing) { toast.error("Ya existe un producto con ese código"); return; }
      const { error } = await supabase.from("products").insert({
        barcode: b, product_name: n, uom: uom.trim() || null,
        category: category.trim() || null, stock_a: t, stock_b: 0,
      });
      if (error) throw error;
      toast.success("Producto agregado");
      qc.invalidateQueries({ queryKey: ["products"] });
      reset(); setOpen(false);
    } catch (e) { toast.error((e as Error).message); }
    finally { setBusy(false); }
  }

  return (
    <>
      <Button variant="outline" onClick={() => setOpen(true)}>
        <Plus className="h-4 w-4" /> Agregar
      </Button>
      <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) reset(); }}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>Agregar producto</DialogTitle></DialogHeader>
          <div className="space-y-3">
            {[
              { label: "Código de barras *", value: barcode, setter: setBarcode, props: { className: "font-mono", autoFocus: true } },
              { label: "Nombre *", value: name, setter: setName, props: {} },
              { label: "Unidad (UoM)", value: uom, setter: setUom, props: { placeholder: "PZA, KG…" } },
            ].map(({ label, value, setter, props }) => (
              <div key={label}>
                <label className="text-xs font-medium text-muted-foreground">{label}</label>
                <Input value={value} onChange={(e) => setter(e.target.value)} {...props} />
              </div>
            ))}
            <div>
              <label className="text-xs font-medium text-muted-foreground">Categoría</label>
              <Input value={category} onChange={(e) => setCategory(e.target.value)}
                placeholder="Ej: Limpieza, Bebidas…" list="add-product-categories" />
              <datalist id="add-product-categories">
                {categories.map((c) => <option key={c} value={c} />)}
              </datalist>
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground">Stock total</label>
              <Input type="number" inputMode="decimal" step="any" min={0} value={total}
                onChange={(e) => setTotal(e.target.value)} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)} disabled={busy}>Cancelar</Button>
            <Button onClick={save} disabled={busy}>
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />} Guardar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

function Stat({ label, value, tone }: { label: string; value: number; tone: "positive" | "warning" | "muted" }) {
  const cls = tone === "positive"
    ? "bg-emerald-50 text-emerald-900 dark:bg-emerald-900/30 dark:text-emerald-100"
    : tone === "warning"
      ? "bg-amber-50 text-amber-900 dark:bg-amber-900/30 dark:text-amber-100"
      : "bg-muted text-foreground";
  return (
    <div className={`rounded-md p-3 ${cls}`}>
      <div className="text-xs">{label}</div>
      <div className="text-2xl font-semibold tabular-nums">{value}</div>
    </div>
  );
}

function NewCategoryButton() {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);

  async function save() {
    const n = name.trim();
    if (!n) { toast.error("Nombre obligatorio"); return; }
    setBusy(true);
    try {
      const { error } = await supabase.from("categories").insert({ name: n });
      if (error) { if (error.code === "23505") toast.error("Esa categoría ya existe"); else throw error; return; }
      toast.success(`Categoría "${n}" creada`);
      setName(""); setOpen(false);
      qc.invalidateQueries({ queryKey: ["categories"] });
    } catch (e) { toast.error((e as Error).message); }
    finally { setBusy(false); }
  }

  return (
    <>
      <Button variant="outline" onClick={() => setOpen(true)}>
        <FolderPlus className="h-4 w-4" /> Categoría
      </Button>
      <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) setName(""); }}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>Nueva categoría</DialogTitle></DialogHeader>
          <Input value={name} onChange={(e) => setName(e.target.value)}
            placeholder="Ej: Limpieza, Bebidas…" autoFocus
            onKeyDown={(e) => { if (e.key === "Enter") save(); }} />
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)} disabled={busy}>Cancelar</Button>
            <Button onClick={save} disabled={busy}>
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />} Crear
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

function DeleteAllProductsButton({ hasProducts }: { hasProducts: boolean }) {
  const qc = useQueryClient();
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);

  async function wipe() {
    if (confirm !== "BORRAR") { toast.error("Escribí BORRAR para confirmar"); return; }
    setBusy(true);
    try {
      const { error } = await supabase.from("products").delete().neq("barcode", "__never__");
      if (error) throw error;
      toast.success("Inventario borrado");
      setConfirm(""); setOpen(false);
      qc.invalidateQueries({ queryKey: ["products"] });
    } catch (e) { toast.error((e as Error).message); }
    finally { setBusy(false); }
  }

  return (
    <AlertDialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) setConfirm(""); }}>
      <AlertDialogTrigger asChild>
        <Button variant="outline" disabled={!hasProducts} className="text-red-600 hover:text-red-700">
          <Trash2 className="h-4 w-4" /> Borrar todo
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>¿Borrar TODO el inventario?</AlertDialogTitle>
          <AlertDialogDescription>
            Esta acción elimina <strong>todos los productos</strong> de la base. No se puede deshacer.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <div className="space-y-1">
          <label className="text-xs text-muted-foreground">Escribí <strong>BORRAR</strong> para confirmar</label>
          <Input value={confirm} onChange={(e) => setConfirm(e.target.value)} placeholder="BORRAR" />
        </div>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={busy}>Cancelar</AlertDialogCancel>
          <AlertDialogAction onClick={(e) => { e.preventDefault(); wipe(); }}
            disabled={busy || confirm !== "BORRAR"} className="bg-red-600 hover:bg-red-700">
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />} Borrar todo
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
 