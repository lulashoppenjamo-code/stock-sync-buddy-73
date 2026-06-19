import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
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
import { Upload, Search, Loader2, FileSpreadsheet, Check, Plus, Trash2, FolderPlus } from "lucide-react";
import { toast } from "sonner";
import { parseCsv, buildDiff, applyImport, type ImportDiff } from "@/lib/csv-utils";
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

function ProductsPage() {
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState<string>("__all__");
  const { data, isLoading } = useQuery({
    queryKey: ["products"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("products")
        .select("barcode, product_name, uom, category, stock_a, stock_b, updated_at")
        .order("product_name")
        .limit(5000);
      if (error) throw error;
      return data as Product[];
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

  const categories = Array.from(
    new Set([
      ...managedCategories,
      ...(data ?? []).map((p) => p.category).filter((c): c is string => !!c),
    ]),
  ).sort();

  const filtered = (data ?? []).filter((p) => {
    if (category !== "__all__" && (p.category ?? "") !== category) return false;
    if (!search.trim()) return true;
    const q = search.toLowerCase();
    return p.product_name.toLowerCase().includes(q) || p.barcode.includes(q);
  });

  const totalUnits = filtered.reduce(
    (s, p) => s + Number(p.stock_a) + Number(p.stock_b),
    0,
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

      <div className="flex flex-wrap gap-2">
        <div className="relative min-w-0 flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Buscar por nombre o código…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>
        <select
          value={category}
          onChange={(e) => setCategory(e.target.value)}
          className="h-10 rounded-md border bg-background px-2 text-sm"
        >
          <option value="__all__">Todas las categorías</option>
          {categories.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
      </div>

      <p className="text-xs text-muted-foreground">
        Tip: tocá el total para editarlo. Se guarda al confirmar (✓ o Enter).
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
                      Sin productos. Importá un CSV para empezar.
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
      </p>
    </div>
  );
}

function TotalStockCell({
  barcode,
  value,
}: {
  barcode: string;
  value: number;
}) {
  const qc = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [val, setVal] = useState(String(value));
  const [saving, setSaving] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!editing) setVal(String(value));
  }, [value, editing]);

  useEffect(() => {
    if (editing) inputRef.current?.select();
  }, [editing]);

  async function save() {
    const n = Number(val);
    if (!Number.isFinite(n) || n < 0) {
      toast.error("Cantidad inválida");
      return;
    }
    if (n === value) {
      setEditing(false);
      return;
    }
    setSaving(true);
    try {
      // Single global stock — store full amount in stock_a, keep stock_b at 0.
      const { error } = await supabase
        .from("products")
        .update({ stock_a: n, stock_b: 0 })
        .eq("barcode", barcode);
      if (error) throw error;
      toast.success("Stock actualizado");
      setEditing(false);
      qc.invalidateQueries({ queryKey: ["products"] });
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  if (!editing) {
    return (
      <button
        onClick={() => setEditing(true)}
        className="rounded px-2 py-1 tabular-nums hover:bg-muted"
        aria-label="Editar stock total"
      >
        {value}
      </button>
    );
  }

  return (
    <div className="flex items-center justify-end gap-1">
      <Input
        ref={inputRef}
        type="number"
        inputMode="decimal"
        step="any"
        min={0}
        value={val}
        onChange={(e) => setVal(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") save();
          if (e.key === "Escape") setEditing(false);
        }}
        onBlur={save}
        disabled={saving}
        className="h-8 w-20 text-right"
      />
      <Button
        type="button"
        size="icon"
        variant="ghost"
        className="h-8 w-8"
        onMouseDown={(e) => e.preventDefault()}
        onClick={save}
        disabled={saving}
        aria-label="Guardar"
      >
        {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
      </Button>
    </div>
  );
}

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

  async function onFile(file: File) {
    setBusy(true);
    try {
      const rows = await parseCsv(file);
      if (!rows.length) {
        toast.error("CSV vacío. Columnas: ProductName, Barcode, UoM, Category, StockA, StockB");
        return;
      }
      const d = await buildDiff(rows);
      setDiff(d);
      setFilename(file.name);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function confirmApply() {
    if (!diff) return;
    setBusy(true);
    try {
      const collab = getCollaborator();
      const res = await applyImport(
        diff,
        { updateName, updateUom, updateCategory, updateStockA, updateStockB },
        collab,
        filename,
      );
      toast.success(`Importación lista: +${res.inserted} nuevos, ${res.updated} actualizados`);
      setDiff(null);
      setFilename(null);
      qc.invalidateQueries({ queryKey: ["products"] });
      qc.invalidateQueries({ queryKey: ["categories"] });
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <input
        ref={inputRef}
        type="file"
        accept=".csv,text/csv"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = "";
          if (f) onFile(f);
        }}
      />
      <Button onClick={() => inputRef.current?.click()} disabled={busy}>
        {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
        Importar CSV
      </Button>

      <Dialog open={!!diff} onOpenChange={(o) => !o && setDiff(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <FileSpreadsheet className="h-5 w-5" /> Vista previa de importación
            </DialogTitle>
          </DialogHeader>
          {diff && (
            <div className="space-y-4 text-sm">
              <div className="grid grid-cols-3 gap-2">
                <Stat label="Nuevos" value={diff.newItems.length} tone="positive" />
                <Stat label="Con cambios" value={diff.changedItems.length} tone="warning" />
                <Stat label="Idénticos" value={diff.identical} tone="muted" />
              </div>
              <p className="text-xs text-muted-foreground">
                Nuevos se crean con la categoría y stocks del CSV (sin stock → 0). Para existentes, elegí qué actualizar.
              </p>
              {diff.changedItems.length > 0 && (
                <div className="space-y-2 rounded-md border p-3">
                  <div className="text-sm font-medium">Actualizar en existentes:</div>
                  <label className="flex items-center gap-2 text-sm">
                    <Checkbox checked={updateName} onCheckedChange={(v) => setUpdateName(!!v)} /> Nombre
                  </label>
                  <label className="flex items-center gap-2 text-sm">
                    <Checkbox checked={updateUom} onCheckedChange={(v) => setUpdateUom(!!v)} /> Unidad (UoM)
                  </label>
                  <label className="flex items-center gap-2 text-sm">
                    <Checkbox checked={updateCategory} onCheckedChange={(v) => setUpdateCategory(!!v)} /> Categoría
                  </label>
                  <label className="flex items-center gap-2 text-sm">
                    <Checkbox checked={updateStockA} onCheckedChange={(v) => setUpdateStockA(!!v)} /> Stock {BRANCH_LABELS.A} (sobrescribe)
                  </label>
                  <label className="flex items-center gap-2 text-sm">
                    <Checkbox checked={updateStockB} onCheckedChange={(v) => setUpdateStockB(!!v)} /> Stock {BRANCH_LABELS.B} (sobrescribe)
                  </label>
                </div>
              )}
              {diff.newItems.length > 0 && (
                <details className="rounded-md border p-2 text-xs">
                  <summary className="cursor-pointer">Ver primeros 10 nuevos</summary>
                  <ul className="mt-2 space-y-1">
                    {diff.newItems.slice(0, 10).map((r) => (
                      <li key={r.barcode} className="font-mono">
                        {r.barcode} — {r.product_name}
                        {r.category ? ` · ${r.category}` : ""}
                      </li>
                    ))}
                  </ul>
                </details>
              )}
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setDiff(null)} disabled={busy}>
              Cancelar
            </Button>
            <Button onClick={confirmApply} disabled={busy}>
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : "Aplicar"}
            </Button>
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

  function reset() {
    setBarcode(""); setName(""); setUom(""); setCategory(""); setTotal("0");
  }

  async function save() {
    const b = barcode.trim();
    const n = name.trim();
    if (!b || !n) { toast.error("Código y nombre son obligatorios"); return; }
    const t = Number(total) || 0;
    if (t < 0) { toast.error("Stock inválido"); return; }
    setBusy(true);
    try {
      const { data: existing } = await supabase.from("products").select("barcode").eq("barcode", b).maybeSingle();
      if (existing) { toast.error("Ya existe un producto con ese código"); return; }
      const { error } = await supabase.from("products").insert({
        barcode: b, product_name: n, uom: uom.trim() || null, category: category.trim() || null,
        stock_a: t, stock_b: 0,
      });
      if (error) throw error;
      toast.success("Producto agregado");
      qc.invalidateQueries({ queryKey: ["products"] });
      reset();
      setOpen(false);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Button variant="outline" onClick={() => setOpen(true)}>
        <Plus className="h-4 w-4" /> Agregar
      </Button>
      <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) reset(); }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Agregar producto</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <label className="text-xs font-medium text-muted-foreground">Código de barras *</label>
              <Input value={barcode} onChange={(e) => setBarcode(e.target.value)} className="font-mono" autoFocus />
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground">Nombre *</label>
              <Input value={name} onChange={(e) => setName(e.target.value)} />
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground">Unidad (UoM)</label>
              <Input value={uom} onChange={(e) => setUom(e.target.value)} placeholder="PZA, KG…" />
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground">Categoría</label>
              <Input
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                placeholder="Ej: Limpieza, Bebidas…"
                list="add-product-categories"
              />
              <datalist id="add-product-categories">
                {categories.map((c) => <option key={c} value={c} />)}
              </datalist>
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground">Stock total</label>
              <Input type="number" inputMode="decimal" step="any" min={0} value={total} onChange={(e) => setTotal(e.target.value)} />
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
  const cls =
    tone === "positive"
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
      if (error) {
        if (error.code === "23505") toast.error("Esa categoría ya existe");
        else throw error;
        return;
      }
      toast.success(`Categoría "${n}" creada`);
      setName("");
      setOpen(false);
      qc.invalidateQueries({ queryKey: ["categories"] });
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Button variant="outline" onClick={() => setOpen(true)}>
        <FolderPlus className="h-4 w-4" /> Categoría
      </Button>
      <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) setName(""); }}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>Nueva categoría</DialogTitle></DialogHeader>
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Ej: Limpieza, Bebidas…"
            autoFocus
            onKeyDown={(e) => { if (e.key === "Enter") save(); }}
          />
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
      setConfirm("");
      setOpen(false);
      qc.invalidateQueries({ queryKey: ["products"] });
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
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
            Esta acción elimina <strong>todos los productos</strong> de la base. Útil para volver a cargar
            el inventario por categoría desde cero. No se puede deshacer.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <div className="space-y-1">
          <label className="text-xs text-muted-foreground">Escribí <strong>BORRAR</strong> para confirmar</label>
          <Input value={confirm} onChange={(e) => setConfirm(e.target.value)} placeholder="BORRAR" />
        </div>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={busy}>Cancelar</AlertDialogCancel>
          <AlertDialogAction
            onClick={(e) => { e.preventDefault(); wipe(); }}
            disabled={busy || confirm !== "BORRAR"}
            className="bg-red-600 hover:bg-red-700"
          >
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />} Borrar todo
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
