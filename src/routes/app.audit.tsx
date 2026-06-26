import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Loader2, ScanLine, Save, Camera, Search, CheckCircle2, XCircle, Trash2, Lock } from "lucide-react";
import { toast } from "sonner";
import { getCollaborator } from "@/lib/session";
import { BarcodeScanner } from "@/components/BarcodeScanner";

export const Route = createFileRoute("/app/audit")({
  component: AuditPage,
});

type Product = {
  barcode: string;
  product_name: string;
  category: string | null;
  stock_a: number;
  stock_b: number;
};

type CountEntry = {
  barcode: string;
  product_name: string;
  count: number;
  stock_a: number;
  stock_b: number;
};

function startOfTodayIso() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.toISOString();
}

// ─── Admin PIN check ───────────────────────────────────────────────────────────
const ADMIN_PIN = "1991";
function useAdminCheck() {
  const [isAdmin, setIsAdmin] = useState(false);
  const [pinInput, setPinInput] = useState("");
  const [showPinDialog, setShowPinDialog] = useState(false);
  const [pendingAction, setPendingAction] = useState<(() => void) | null>(null);

  function requireAdmin(action: () => void) {
    if (isAdmin) { action(); return; }
    setPendingAction(() => action);
    setShowPinDialog(true);
  }

  function submitPin() {
    if (pinInput === ADMIN_PIN) {
      setIsAdmin(true);
      setShowPinDialog(false);
      setPinInput("");
      pendingAction?.();
      toast.success("Acceso admin concedido");
    } else {
      toast.error("PIN incorrecto");
      setPinInput("");
    }
  }

  return { isAdmin, requireAdmin, showPinDialog, setShowPinDialog, pinInput, setPinInput, submitPin };
}

// ─── Main Page ─────────────────────────────────────────────────────────────────
function AuditPage() {
  const qc = useQueryClient();
  const [mode, setMode] = useState<"single" | "category">("single");

  // Single-product mode state
  const [code, setCode] = useState("");
  const [physical, setPhysical] = useState("");
  const [branch, setBranch] = useState<"A" | "B">("A");
  const [current, setCurrent] = useState<Product | null>(null);
  const [busy, setBusy] = useState(false);
  const [scannerOpen, setScannerOpen] = useState(false);
  const scanRef = useRef<HTMLInputElement>(null);
  const physicalRef = useRef<HTMLInputElement>(null);

  // Category mode state
  const [selectedCategory, setSelectedCategory] = useState("");
  const [categoryBranch, setCategoryBranch] = useState<"A" | "B">("A");
  const [counts, setCounts] = useState<Map<string, CountEntry>>(new Map());
  const [catScannerOpen, setCatScannerOpen] = useState(false);
  const [catScanInput, setCatScanInput] = useState("");
  const [catNameSearch, setCatNameSearch] = useState("");
  const [savingCategory, setSavingCategory] = useState(false);
  const [summaryData, setSummaryData] = useState<any[] | null>(null);
  const catScanRef = useRef<HTMLInputElement>(null);

  const admin = useAdminCheck();

  useEffect(() => { if (mode === "single") scanRef.current?.focus(); }, [mode]);

  // ── Queries ──
  const { data: history, refetch: refetchHistory } = useQuery({
    queryKey: ["audits"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("audits")
        .select("id, barcode, product_name, system_stock, physical_count, difference, collaborator_name, branch, created_at")
        .order("created_at", { ascending: false })
        .limit(100);
      if (error) throw error;
      return data;
    },
  });

  const { data: todayForProduct } = useQuery({
    queryKey: ["audits-today-product", current?.barcode],
    enabled: !!current,
    refetchInterval: 10_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("audits")
        .select("id, physical_count, collaborator_name, branch, created_at")
        .eq("barcode", current!.barcode)
        .gte("created_at", startOfTodayIso())
        .order("created_at", { ascending: true });
      if (error) throw error;
      return data as Array<{ id: string; physical_count: number; collaborator_name: string | null; branch: "A" | "B" | null; created_at: string }>;
    },
  });

  // SE OPTIMIZÓ ESTA CONSULTA: Trae todas las categorías del archivo de inventario importado de forma limpia
  const { data: categories = [], isLoading: isLoadingCategories } = useQuery({
    queryKey: ["categories"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("products")
        .select("category")
        .not("category", "is", null)
        .filter("category", "neq", ""); // Evita traer espacios vacíos si el excel venía con celdas en blanco
        
      if (error) throw error;
      
      const set = new Set<string>();
      for (const r of data ?? []) {
        if (r.category) {
          set.add(r.category.trim()); // Limpia espacios accidentales al inicio/final
        }
      }
      return Array.from(set).sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
    },
  });

  const { data: categoryProducts = [], isFetching: isFetchingProducts } = useQuery({
    queryKey: ["category-products", selectedCategory],
    enabled: !!selectedCategory,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("products")
        .select("barcode, product_name, category, stock_a, stock_b")
        .eq("category", selectedCategory)
        .order("product_name");
      if (error) throw error;
      return data as Product[];
    },
  });

  // Real-time: today's audits for selected category
  const { data: todayCategory = [] } = useQuery({
    queryKey: ["audits-today-category", selectedCategory, categoryBranch],
    enabled: !!selectedCategory,
    refetchInterval: 8_000,
    queryFn: async () => {
      if (!selectedCategory) return [];
      const barcodes = categoryProducts.map((p) => p.barcode);
      if (!barcodes.length) return [];
      const { data, error } = await supabase
        .from("audits")
        .select("barcode, physical_count, collaborator_name, branch, created_at")
        .in("barcode", barcodes)
        .gte("created_at", startOfTodayIso())
        .order("created_at", { ascending: true });
      if (error) throw error;
      return data as Array<{ barcode: string; physical_count: number; collaborator_name: string | null; branch: "A" | "B" | null; created_at: string }>;
    },
  });

  // ── Single product lookup ──
  async function lookup(barcode: string) {
    const { data, error } = await supabase
      .from("products")
      .select("barcode, product_name, category, stock_a, stock_b")
      .eq("barcode", barcode)
      .maybeSingle();
    if (error) { toast.error(error.message); return null; }
    if (!data) { toast.error(`Producto no encontrado: ${barcode}`); return null; }
    return data as Product;
  }

  async function handleScan(e: React.FormEvent) {
    e.preventDefault();
    const c = code.trim();
    if (!c) return;
    setBusy(true);
    const p = await lookup(c);
    setBusy(false);
    if (p) { setCurrent(p); setPhysical(""); setTimeout(() => physicalRef.current?.focus(), 10); }
    else { setCode(""); scanRef.current?.focus(); }
  }

  async function saveSingle(e?: React.FormEvent) {
    e?.preventDefault();
    if (!current) return;
    const phys = Number(physical);
    if (!Number.isFinite(phys)) return toast.error("Conteo físico inválido");
    const totalStock = Number(current.stock_a) + Number(current.stock_b);
    const sumToday = (todayForProduct ?? []).reduce((s, r) => s + Number(r.physical_count), 0);
    const diff = sumToday + phys - totalStock;
    const collab = getCollaborator();
    if (!collab) return toast.error("Sesión expirada");
    setBusy(true);
    try {
      const { error } = await supabase.from("audits").insert({
        branch, barcode: current.barcode, product_name: current.product_name,
        system_stock: totalStock, physical_count: phys, difference: diff,
        collaborator_id: collab.id, collaborator_name: collab.name,
        client_uid: `audit-${crypto.randomUUID()}`,
      });
      if (error) throw error;
      qc.invalidateQueries({ queryKey: ["audits"] });
      qc.invalidateQueries({ queryKey: ["audits-today-product", current.barcode] });
      toast.success(`Guardado. Suma: ${sumToday + phys} vs sistema: ${totalStock} (${diff > 0 ? "+" : ""}${diff})`);
      setCurrent(null); setCode(""); setPhysical(""); scanRef.current?.focus();
    } catch (err) { toast.error((err as Error).message); }
    finally { setBusy(false); }
  }

  // ── Category mode: add/update count ──
  const addToCount = useCallback(async (barcode: string, delta = 1) => {
    let prod = categoryProducts.find((p) => p.barcode === barcode);
    if (!prod) {
      const result = await lookup(barcode);
      if (!result) return;
      if (result.category !== selectedCategory) {
        toast.error(`Ese producto no es de la categoría "${selectedCategory}"`);
        return;
      }
      prod = result;
    }
    setCounts((prev) => {
      const existing = prev.get(barcode);
      const newMap = new Map(prev);
      newMap.set(barcode, {
        barcode: prod!.barcode,
        product_name: prod!.product_name,
        count: (existing?.count ?? 0) + delta,
        stock_a: prod!.stock_a,
        stock_b: prod!.stock_b,
      });
      return newMap;
    });
    toast.success(`+1 · ${prod.product_name}`);
  }, [categoryProducts, selectedCategory]);

  function setManualCount(barcode: string, val: number) {
    const prod = categoryProducts.find((p) => p.barcode === barcode);
    if (!prod) return;
    setCounts((prev) => {
      const newMap = new Map(prev);
      newMap.set(barcode, {
        barcode: prod.barcode,
        product_name: prod.product_name,
        count: val,
        stock_a: prod.stock_a,
        stock_b: prod.stock_b,
      });
      return newMap;
    });
  }

  function removeFromCount(barcode: string) {
    setCounts((prev) => { const m = new Map(prev); m.delete(barcode); return m; });
  }

  async function saveCategoryCount() {
    if (counts.size === 0) return toast.error("No hay productos contados");
    const collab = getCollaborator();
    if (!collab) return toast.error("Sesión expirada");
    setSavingCategory(true);
    try {
      const rows = Array.from(counts.values()).map((c) => {
        const totalStock = Number(c.stock_a) + Number(c.stock_b);
        const diff = c.count - totalStock;
        return {
          branch: categoryBranch,
          barcode: c.barcode,
          product_name: c.product_name,
          system_stock: totalStock,
          physical_count: c.count,
          difference: diff,
          collaborator_id: collab.id,
          collaborator_name: collab.name,
          client_uid: `audit-${crypto.randomUUID()}`,
        };
      });
      const { error } = await supabase.from("audits").insert(rows);
      if (error) throw error;

      const summary = rows.map((r) => ({
        product_name: r.product_name,
        barcode: r.barcode,
        system_stock: r.system_stock,
        my_count: r.physical_count,
        difference: r.difference,
      }));
      setSummaryData(summary);
      qc.invalidateQueries({ queryKey: ["audits"] });
      qc.invalidateQueries({ queryKey: ["audits-today-category"] });
      setCounts(new Map());
      toast.success(`${rows.length} productos guardados`);
    } catch (err) { toast.error((err as Error).message); }
    finally { setSavingCategory(false); }
  }

  async function deleteAudit(id: string) {
    admin.requireAdmin(async () => {
      const { error } = await supabase.from("audits").delete().eq("id", id);
      if (error) return toast.error(error.message);
      toast.success("Registro eliminado");
      refetchHistory();
    });
  }

  const totalStock = current ? Number(current.stock_a) + Number(current.stock_b) : 0;
  const sumToday = (todayForProduct ?? []).reduce((s, r) => s + Number(r.physical_count), 0);
  const sumMina = (todayForProduct ?? []).filter((r) => r.branch === "A").reduce((s, r) => s + Number(r.physical_count), 0);
  const sumMorelos = (todayForProduct ?? []).filter((r) => r.branch === "B").reduce((s, r) => s + Number(r.physical_count), 0);
  const previewSum = current && physical !== "" ? sumToday + Number(physical) : sumToday;
  const previewMina = branch === "A" && physical !== "" ? sumMina + Number(physical) : sumMina;
  const previewMorelos = branch === "B" && physical !== "" ? sumMorelos + Number(physical) : sumMorelos;
  const previewDiff = current ? previewSum - totalStock : 0;

  const todayCatByBarcode = new Map<string, { mina: number; morelos: number }>();
  for (const r of todayCategory) {
    const entry = todayCatByBarcode.get(r.barcode) ?? { mina: 0, morelos: 0 };
    if (r.branch === "A") entry.mina += Number(r.physical_count);
    else if (r.branch === "B") entry.morelos += Number(r.physical_count);
    todayCatByBarcode.set(r.barcode, entry);
  }

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold tracking-tight">Auditoría</h1>

      {/* Mode tabs */}
      <div className="inline-flex overflow-hidden rounded-md border">
        <button type="button" onClick={() => setMode("single")}
          className={`px-4 py-2 text-sm font-medium ${mode === "single" ? "bg-primary text-primary-foreground" : "bg-background"}`}>
          Producto individual
        </button>
        <button type="button" onClick={() => setMode("category")}
          className={`px-4 py-2 text-sm font-medium ${mode === "category" ? "bg-primary text-primary-foreground" : "bg-background"}`}>
          Por categoría
        </button>
      </div>

      {/* ── SINGLE PRODUCT MODE ── */}
      {mode === "single" && (
        <Card>
          <CardContent className="space-y-4 p-4">
            <form onSubmit={handleScan}>
              <label className="text-xs font-medium text-muted-foreground">Escanear código (Enter)</label>
              <div className="relative mt-1 flex gap-2">
                <div className="relative flex-1">
                  <ScanLine className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <Input ref={scanRef} autoFocus value={code} onChange={(e) => setCode(e.target.value)}
                    placeholder="Pistola, cámara o tipear…" className="pl-9 font-mono text-base" inputMode="numeric" />
                </div>
                <Button type="button" variant="default" onClick={() => setScannerOpen(true)} className="shrink-0">
                  <Camera className="h-4 w-4" /> Cámara
                </Button>
              </div>
            </form>

            <ProductNameSearch onPick={async (barcode) => {
              setBusy(true); const p = await lookup(barcode); setBusy(false);
              if (p) { setCurrent(p); setPhysical(""); setTimeout(() => physicalRef.current?.focus(), 10); }
            }} />

            {current && (
              <form onSubmit={saveSingle} className="space-y-3 rounded-lg border bg-muted/30 p-3">
                <div>
                  <div className="text-xs text-muted-foreground">Producto</div>
                  <div className="font-medium">{current.product_name}</div>
                  <div className="font-mono text-xs text-muted-foreground">{current.barcode}</div>
                </div>
                <div>
                  <div className="mb-1 text-xs text-muted-foreground">Sucursal</div>
                  <div className="inline-flex overflow-hidden rounded-md border">
                    {(["A", "B"] as const).map((b) => (
                      <button key={b} type="button" onClick={() => setBranch(b)}
                        className={`px-3 py-1.5 text-sm font-medium ${branch === b ? "bg-primary text-primary-foreground" : "bg-background"}`}>
                        {b === "A" ? "Mina" : "Morelos"}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <div className="text-xs text-muted-foreground">Stock sistema</div>
                    <div className="text-xl font-semibold tabular-nums">{totalStock}</div>
                  </div>
                  <div>
                    <label className="text-xs text-muted-foreground">Tu conteo</label>
                    <Input ref={physicalRef} type="number" inputMode="decimal" step="any"
                      value={physical} onChange={(e) => setPhysical(e.target.value)}
                      onKeyDown={(e) => { if (e.key === "Enter") saveSingle(); }} placeholder="0" className="text-lg" />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-2 text-sm">
                  <div className="rounded-md border bg-card p-2">
                    <div className="text-xs text-muted-foreground">Suma Mina</div>
                    <div className="text-lg font-semibold tabular-nums">{previewMina}</div>
                  </div>
                  <div className="rounded-md border bg-card p-2">
                    <div className="text-xs text-muted-foreground">Suma Morelos</div>
                    <div className="text-lg font-semibold tabular-nums">{previewMorelos}</div>
                  </div>
                </div>
                {(todayForProduct ?? []).length > 0 && (
                  <div className="rounded-md border bg-card p-2">
                    <div className="mb-1 text-xs font-medium">Conteos de hoy (tiempo real)</div>
                    <ul className="divide-y text-xs">
                      {(todayForProduct ?? []).map((r) => (
                        <li key={r.id} className="flex items-center justify-between py-1">
                          <span>{r.collaborator_name ?? "Anónimo"} · {r.branch === "A" ? "Mina" : "Morelos"}</span>
                          <span className="tabular-nums">{r.physical_count}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                <div className="rounded-md border bg-card p-2 text-sm">
                  <div className="flex justify-between"><span className="text-muted-foreground">Suma hoy</span><span className="font-semibold tabular-nums">{previewSum}</span></div>
                  <div className="flex justify-between"><span className="text-muted-foreground">Sistema</span><span className="font-semibold tabular-nums">{totalStock}</span></div>
                  <div className="mt-1 flex justify-between border-t pt-1">
                    <span className="text-muted-foreground">Diferencia</span>
                    <span className={`font-semibold tabular-nums ${previewDiff === 0 ? "" : previewDiff > 0 ? "text-emerald-600" : "text-red-600"}`}>
                      {previewDiff > 0 ? "+" : ""}{previewDiff}
                    </span>
                  </div>
                </div>
                <div className="flex gap-2">
                  <Button type="submit" disabled={busy || physical === ""}>
                    {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />} Guardar
                  </Button>
                  <Button type="button" variant="ghost" onClick={() => { setCurrent(null); setCode(""); setPhysical(""); scanRef.current?.focus(); }}>
                    Cancelar
                  </Button>
                </div>
              </form>
            )}
          </CardContent>
        </Card>
      )}

      {/* ── CATEGORY MODE ── */}
      {mode === "category" && (
        <Card>
          <CardContent className="space-y-4 p-4">
            {/* Category + branch selector */}
            <div className="flex flex-wrap items-center gap-3">
              <div className="flex-1 min-w-0">
                <label className="text-xs font-medium text-muted-foreground">Categoría</label>
                <select value={selectedCategory} onChange={(e) => { setSelectedCategory(e.target.value); setCounts(new Map()); }}
                  className="mt-1 h-9 w-full rounded-md border bg-background px-2 text-sm">
                  {isLoadingCategories ? (
                    <option>Cargando categorías del inventario...</option>
                  ) : (
                    <>
                      <option value="">Elegir categoría ({categories.length} encontradas)…</option>
                      {categories.map((c) => <option key={c} value={c}>{c}</option>)}
                    </>
                  )}
                </select>
              </div>
              <div>
                <label className="text-xs font-medium text-muted-foreground">Sucursal</label>
                <div className="mt-1 inline-flex overflow-hidden rounded-md border">
                  {(["A", "B"] as const).map((b) => (
                    <button key={b} type="button" onClick={() => setCategoryBranch(b)}
                      className={`px-3 py-1.5 text-sm font-medium ${categoryBranch === b ? "bg-primary text-primary-foreground" : "bg-background"}`}>
                      {b === "A" ? "Mina" : "Morelos"}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {selectedCategory && (
              <>
                {/* Scanner input */}
                <div>
                  <label className="text-xs font-medium text-muted-foreground">Pistolá productos (cada disparo suma +1)</label>
                  <div className="mt-1 flex gap-2">
                    <Input ref={catScanRef} value={catScanInput}
                      onChange={(e) => setCatScanInput(e.target.value)}
                      onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addToCount(catScanInput.trim()); setCatScanInput(""); } }}
                      placeholder="Pistola o tipear código…" className="font-mono" inputMode="numeric" autoFocus />
                    <Button type="button" variant="default" onClick={() => setCatScannerOpen(true)} className="shrink-0">
                      <Camera className="h-4 w-4" /> Cámara
                    </Button>
                  </div>
                </div>

                {/* Name search within category */}
                <div>
                  <label className="text-xs font-medium text-muted-foreground">O buscar por nombre</label>
                  <div className="relative mt-1">
                    <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                    <Input value={catNameSearch} onChange={(e) => setCatNameSearch(e.target.value)}
                      placeholder="Escribí al menos 2 letras…" className="pl-9" />
                  </div>
                  {catNameSearch.trim().length >= 2 && (
                    <div className="mt-1 max-h-48 overflow-auto rounded-md border bg-card">
                      {categoryProducts
                        .filter((p) => p.product_name.toLowerCase().includes(catNameSearch.toLowerCase()))
                        .map((p) => (
                          <button key={p.barcode} type="button"
                            onClick={() => { addToCount(p.barcode); setCatNameSearch(""); }}
                            className="flex w-full items-center justify-between border-b px-3 py-2 text-left text-sm last:border-b-0 hover:bg-muted">
                            <span className="truncate font-medium">{p.product_name}</span>
                            <span className="ml-2 shrink-0 text-xs text-muted-foreground">Stock: {Number(p.stock_a) + Number(p.stock_b)}</span>
                          </button>
                        ))}
                      {categoryProducts.filter((p) => p.product_name.toLowerCase().includes(catNameSearch.toLowerCase())).length === 0 && (
                        <div className="p-3 text-xs text-muted-foreground">Sin resultados en esta categoría</div>
                      )}
                    </div>
                  )}
                </div>

                {/* Product list with counts */}
                <div className="space-y-1">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-medium text-muted-foreground">
                      {isFetchingProducts ? "Cargando productos de la categoría..." : `Productos de la categoría · ${counts.size} contados / ${categoryProducts.length} total`}
                    </span>
                  </div>
                  <div className="max-h-80 overflow-auto rounded-md border divide-y">
                    {categoryProducts.map((p) => {
                      const entry = counts.get(p.barcode);
                      const totalSys = Number(p.stock_a) + Number(p.stock_b);
                      const realtime = todayCatByBarcode.get(p.barcode);
                      const isCounted = !!entry;
                      return (
                        <div key={p.barcode}
                          className={`flex items-center gap-2 px-3 py-2 text-xs transition-colors ${isCounted ? "bg-emerald-50 dark:bg-emerald-950/20" : ""}`}>
                          <div className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2 ${isCounted ? "border-emerald-500 bg-emerald-500 text-white" : "border-muted-foreground"}`}>
                            {isCounted && <CheckCircle2 className="h-3 w-3" />}
                          </div>
                          <div className="min-w-0 flex-1">
                            <div className={`truncate font-medium ${isCounted ? "" : "text-muted-foreground"}`}>{p.product_name}</div>
                            <div className="font-mono text-muted-foreground">{p.barcode}</div>
                            {realtime && (
                              <div className="mt-0.5 text-[10px] text-blue-600 dark:text-blue-400">
                                Tiempo real → Mina: {realtime.mina} · Morelos: {realtime.morelos}
                              </div>
                            )}
                          </div>
                          <div className="flex items-center gap-1 shrink-0">
                            <span className="text-muted-foreground tabular-nums">Sys:{totalSys}</span>
                            <Input type="number" inputMode="decimal" min={0} step="any"
                              value={entry?.count ?? ""}
                              onChange={(e) => setManualCount(p.barcode, Number(e.target.value) || 0)}
                              placeholder="—"
                              className="h-7 w-16 text-center text-xs" />
                            {isCounted && (
                              <button type="button" onClick={() => removeFromCount(p.barcode)}
                                className="text-muted-foreground hover:text-red-500">
                                <XCircle className="h-4 w-4" />
                              </button>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>

                {/* Save button */}
                <Button onClick={saveCategoryCount} disabled={savingCategory || counts.size === 0} className="w-full">
                  {savingCategory ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                  Guardar conteo ({counts.size} productos)
                </Button>
              </>
            )}
          </CardContent>
        </Card>
      )}

      {/* ── SUMMARY DIALOG ── */}
      <Dialog open={!!summaryData} onOpenChange={(o) => { if (!o) setSummaryData(null); }}>
        <DialogContent className="max-h-[90vh] max-w-lg overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Resumen del conteo — {selectedCategory}</DialogTitle>
          </DialogHeader>
          <div className="space-y-2 text-sm">
            <p className="text-xs text-muted-foreground">Comparación de tu conteo vs stock en sistema. Verde = sin diferencia, rojo = faltante, amarillo = sobrante.</p>
            <div className="divide-y rounded-md border">
              {(summaryData ?? []).map((r: any) => {
                const diff = r.difference;
                return (
                  <div key={r.barcode} className={`flex items-center gap-2 px-3 py-2 text-xs ${diff === 0 ? "bg-emerald-50 dark:bg-emerald-950/20" : diff < 0 ? "bg-red-50 dark:bg-red-950/20" : "bg-amber-50 dark:bg-amber-950/20"}`}>
                    <div className="min-w-0 flex-1">
                      <div className="truncate font-medium">{r.product_name}</div>
                      <div className="font-mono text-muted-foreground">{r.barcode}</div>
                    </div>
                    <div className="shrink-0 text-right tabular-nums space-y-0.5">
                      <div className="text-muted-foreground">Sistema: {r.system_stock}</div>
                      <div>Conteo: {r.my_count}</div>
                      <div className={`font-bold ${diff === 0 ? "text-emerald-600" : diff < 0 ? "text-red-600" : "text-amber-600"}`}>
                        {diff > 0 ? "+" : ""}{diff} {diff < 0 ? "⚠ FALTANTE" : diff > 0 ? "↑ SOBRANTE" : "✓"}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
            <div className="rounded-md border bg-muted p-3 text-xs space-y-1">
              <div className="font-semibold">Totales:</div>
              <div>Productos contados: {(summaryData ?? []).length}</div>
              <div className="text-red-600">Faltantes: {(summaryData ?? []).filter((r: any) => r.difference < 0).length} productos</div>
              <div className="text-amber-600">Sobrantes: {(summaryData ?? []).filter((r: any) => r.difference > 0).length} productos</div>
              <div className="text-emerald-600">Sin diferencia: {(summaryData ?? []).filter((r: any) => r.difference === 0).length} productos</div>
            </div>
          </div>
          <DialogFooter>
            <Button onClick={() => setSummaryData(null)}>Cerrar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── HISTORY ── */}
      <div className="flex items-center gap-2">
        <h2 className="text-sm font-semibold tracking-tight">Historial reciente</h2>
        {admin.isAdmin && <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs text-amber-800"><Lock className="inline h-3 w-3 mr-0.5" />Admin</span>}
        {!admin.isAdmin && (
          <button type="button" onClick={() => admin.requireAdmin(() => {})}
            className="text-xs text-muted-foreground underline">Acceso admin</button>
        )}
      </div>
      <Card>
        <CardContent className="p-0">
          <div className="max-h-[50vh] overflow-auto">
            <Table>
              <TableHeader className="sticky top-0 bg-card">
                <TableRow>
                  <TableHead>Fecha</TableHead>
                  <TableHead>Colaboradora</TableHead>
                  <TableHead>Producto</TableHead>
                  <TableHead className="text-right">Sistema</TableHead>
                  <TableHead className="text-right">Conteo</TableHead>
                  <TableHead className="text-right">Dif.</TableHead>
                  {admin.isAdmin && <TableHead />}
                </TableRow>
              </TableHeader>
              <TableBody>
                {(history ?? []).map((a: any) => (
                  <TableRow key={a.id}>
                    <TableCell className="whitespace-nowrap text-xs">{new Date(a.created_at).toLocaleString()}</TableCell>
                    <TableCell className="text-xs">{a.collaborator_name ?? "—"}<br /><span className="text-muted-foreground">{a.branch === "A" ? "Mina" : a.branch === "B" ? "Morelos" : ""}</span></TableCell>
                    <TableCell>
                      <div>{a.product_name}</div>
                      <div className="font-mono text-xs text-muted-foreground">{a.barcode}</div>
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{a.system_stock}</TableCell>
                    <TableCell className="text-right tabular-nums">{a.physical_count}</TableCell>
                    <TableCell className={`text-right tabular-nums font-medium ${a.difference === 0 ? "" : a.difference > 0 ? "text-emerald-600" : "text-red-600"}`}>
                      {a.difference > 0 ? "+" : ""}{a.difference}
                    </TableCell>
                    {admin.isAdmin && (
                      <TableCell>
                        <button type="button" onClick={() => deleteAudit(a.id)} className="text-muted-foreground hover:text-red-500">
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </TableCell>
                    )}
                  </TableRow>
                ))}
                {(history ?? []).length === 0 && (
                  <TableRow><TableCell colSpan={7} className="py-8 text-center text-muted-foreground">Sin auditorías aún</TableCell></TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      {/* Admin PIN dialog */}
      <Dialog open={admin.showPinDialog} onOpenChange={(o) => { if (!o) admin.setShowPinDialog(false); }}>
        <DialogContent className="max-w-xs">
          <DialogHeader><DialogTitle><Lock className="inline h-4 w-4 mr-1" />Acceso administrador</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <p className="text-xs text-muted-foreground">Ingresa el PIN de administrador para continuar.</p>
            <Input type="password" inputMode="numeric" placeholder="PIN…" value={admin.pinInput}
              onChange={(e) => admin.setPinInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") admin.submitPin(); }} autoFocus />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => admin.setShowPinDialog(false)}>Cancelar</Button>
            <Button onClick={admin.submitPin}>Entrar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Single mode barcode scanner */}
      <BarcodeScanner open={scannerOpen} onClose={() => setScannerOpen(false)}
        onDetected={async (c) => {
          setBusy(true); const p = await lookup(c); setBusy(false);
          if (p) { setCurrent(p); setPhysical(""); setTimeout(() => physicalRef.current?.focus(), 10); }
        }} />

      {/* Category mode barcode scanner */}
      <BarcodeScanner open={catScannerOpen} onClose={() => setCatScannerOpen(false)}
        continuous onDetected={(c) => addToCount(c)} />
    </div>
  );
}

function ProductNameSearch({ onPick }: { onPick: (barcode: string) => void }) {
  const [q, setQ] = useState("");
  const { data, isFetching } = useQuery({
    queryKey: ["audit-product-search", q],
    queryFn: async () => {
      const term = q.trim();
      if (term.length < 2) return [];
      const { data, error } = await supabase
        .from("products")
        .select("barcode, product_name, uom, stock_a, stock_b")
        .ilike("product_name", `%${term}%`)
        .order("product_name")
        .limit(15);
      if (error) throw error;
      return data ?? [];
    },
  });

  return (
    <div>
      <label className="text-xs font-medium text-muted-foreground">Buscar producto por nombre</label>
      <div className="relative mt-1">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input value={q} onChange={(e) => setQ(e.target.value)}
          placeholder="Escribí al menos 2 letras…" className="pl-9" />
      </div>
      {q.trim().length >= 2 && (
        <div className="mt-2 max-h-60 overflow-auto rounded-md border">
          {isFetching && <div className="p-3 text-center text-xs text-muted-foreground">Buscando…</div>}
          {!isFetching && (data ?? []).length === 0 && <div className="p-3 text-center text-xs text-muted-foreground">Sin resultados</div>}
          {(data ?? []).map((p: any) => (
            <button key={p.barcode} type="button" onClick={() => { onPick(p.barcode); setQ(""); }}
              className="block w-full border-b px-3 py-2 text-left text-sm last:border-b-0 hover:bg-muted">
              <div className="font-medium">{p.product_name}</div>
              <div className="font-mono text-xs text-muted-foreground">{p.barcode} · {p.uom ?? "—"} · Total: {Number(p.stock_a) + Number(p.stock_b)}</div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
