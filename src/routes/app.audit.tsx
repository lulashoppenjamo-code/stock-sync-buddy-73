import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState, useCallback, useMemo } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Loader2, ScanLine, Save, Search, CheckCircle2, Minus, Plus, Trash2, ClipboardList, Flag, History } from "lucide-react";
import { toast } from "sonner";
import { getCollaborator } from "@/lib/session";
import { BarcodeScanner } from "@/components/BarcodeScanner";
import { branchLabel } from "@/lib/branches";

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
  system_stock: number;
};

// ── localStorage persistence ───────────────────────────────────────────
const CAT_KEY = "inv.audit.category.v2";

function loadCatState(): { category: string; branch: "A" | "B"; counts: [string, CountEntry][] } | null {
  try { const r = localStorage.getItem(CAT_KEY); return r ? JSON.parse(r) : null; }
  catch { return null; }
}
function saveCatState(category: string, branch: "A" | "B", counts: Map<string, CountEntry>) {
  try { localStorage.setItem(CAT_KEY, JSON.stringify({ category, branch, counts: Array.from(counts.entries()) })); }
  catch { /* ignore */ }
}
function clearCatState() {
  try { localStorage.removeItem(CAT_KEY); } catch { /* ignore */ }
}

function startOfTodayIso() {
  const d = new Date(); d.setHours(0, 0, 0, 0); return d.toISOString();
}

// ── Main page ──────────────────────────────────────────────────────────
function AuditPage() {
  const _saved = useMemo(() => loadCatState(), []);
  const [category, setCategory] = useState(_saved?.category ?? "");
  const [branch, setBranch] = useState<"A" | "B">(_saved?.branch ?? "A");
  const [counts, setCounts] = useState<Map<string, CountEntry>>(
    _saved?.counts ? new Map(_saved.counts) : new Map()
  );
  const [scanInput, setScanInput] = useState("");
  const [nameSearch, setNameSearch] = useState("");
  const [scanning, setScanning] = useState(false);
  const [saving, setSaving] = useState(false);
  const [finalizing, setFinalizing] = useState(false);
  const [summaryData, setSummaryData] = useState<CountEntry[] | null>(null);
  const [summaryFinal, setSummaryFinal] = useState(false);
  const scanRef = useRef<HTMLInputElement>(null);
  const qc = useQueryClient();

  // Persist on every counts change
  useEffect(() => {
    if (category) saveCatState(category, branch, counts);
  }, [counts, category, branch]);

  // ── Categories (all, paginated) ──
  const { data: categories = [] } = useQuery({
    queryKey: ["categories-all"],
    queryFn: async () => {
      const all = new Set<string>();
      const pageSize = 1000;
      let from = 0;
      while (true) {
        const { data, error } = await supabase
          .from("products").select("category")
          .not("category", "is", null).not("category", "eq", "")
          .range(from, from + pageSize - 1);
        if (error) throw error;
        for (const r of data ?? []) if (r.category) all.add(r.category.trim());
        if ((data ?? []).length < pageSize) break;
        from += pageSize;
      }
      return Array.from(all).sort((a, b) => a.localeCompare(b, "es"));
    },
  });

  // ── Products of selected category ──
  const { data: products = [] } = useQuery({
    queryKey: ["cat-products", category],
    enabled: !!category,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("products")
        .select("barcode, product_name, category, stock_a, stock_b")
        .eq("category", category)
        .order("product_name");
      if (error) throw error;
      return data as Product[];
    },
  });

  // ── Real-time: ALL audits of today for this category (summed by barcode+user) ──
  const { data: realtimeAudits = [] } = useQuery({
    queryKey: ["audits-realtime", category],
    enabled: !!category && products.length > 0,
    refetchInterval: 5_000,
    queryFn: async () => {
      const barcodes = products.map((p) => p.barcode);
      if (!barcodes.length) return [];
      const { data, error } = await supabase
        .from("audits")
        .select("barcode, physical_count, collaborator_name, created_at")
        .in("barcode", barcodes)
        .gte("created_at", startOfTodayIso())
        .order("created_at", { ascending: true });
      if (error) throw error;
      return data as Array<{ barcode: string; physical_count: number; collaborator_name: string | null; created_at: string }>;
    },
  });

  // Sum realtime audits per barcode (all users combined)
  const realtimeSums = useMemo(() => {
    const map = new Map<string, { total: number; byUser: Map<string, number> }>();
    for (const a of realtimeAudits) {
      if (!map.has(a.barcode)) map.set(a.barcode, { total: 0, byUser: new Map() });
      const entry = map.get(a.barcode)!;
      entry.total += Number(a.physical_count);
      const user = a.collaborator_name ?? "Anónimo";
      entry.byUser.set(user, (entry.byUser.get(user) ?? 0) + Number(a.physical_count));
    }
    return map;
  }, [realtimeAudits]);

  // ── Product lookup ──
  async function lookupProduct(barcode: string): Promise<Product | null> {
    const local = products.find((p) => p.barcode === barcode);
    if (local) return local;
    const { data, error } = await supabase
      .from("products").select("barcode, product_name, category, stock_a, stock_b")
      .eq("barcode", barcode).maybeSingle();
    if (error || !data) { toast.error(`Producto no encontrado: ${barcode}`); return null; }
    return data as Product;
  }

  // ── Add +1 to local count ──
  const addCount = useCallback(async (barcode: string) => {
    const code = barcode.trim();
    if (!code) return;
    if (!category) { toast.error("Seleccioná una categoría primero"); return; }
    const prod = await lookupProduct(code);
    if (!prod) return;
    if (prod.category !== category) {
      toast.error(`"${prod.product_name}" no es de la categoría ${category}`);
      return;
    }
    const sys = Number(prod.stock_a) + Number(prod.stock_b);
    setCounts((prev) => {
      const existing = prev.get(code);
      const newMap = new Map(prev);
      newMap.set(code, {
        barcode: code,
        product_name: prod.product_name,
        count: (existing?.count ?? 0) + 1,
        system_stock: sys,
      });
      return newMap;
    });
    toast.success(`+1 · ${prod.product_name}`);
    setScanInput("");
    scanRef.current?.focus();
  }, [products, category]);

  function setCount(barcode: string, val: number) {
    const prod = products.find((p) => p.barcode === barcode);
    if (!prod) return;
    const sys = Number(prod.stock_a) + Number(prod.stock_b);
    setCounts((prev) => {
      const newMap = new Map(prev);
      if (val <= 0) { newMap.delete(barcode); return newMap; }
      newMap.set(barcode, { barcode, product_name: prod.product_name, count: val, system_stock: sys });
      return newMap;
    });
  }

  function changeCategory(newCat: string) {
    if (counts.size > 0 && newCat !== category) {
      if (!confirm("¿Cambiar de categoría? Se perderá el conteo actual.")) return;
    }
    setCategory(newCat);
    setCounts(new Map());
    if (!newCat) clearCatState();
  }

  // ── Save all counts ──
  async function saveCount() {
    if (counts.size === 0) return toast.error("No hay productos contados");
    const collab = getCollaborator();
    if (!collab) return toast.error("Sesión expirada");
    setSaving(true);
    try {
      const sessionId = crypto.randomUUID();
      const rows = Array.from(counts.values()).map((c) => ({
        branch,
        barcode: c.barcode,
        product_name: c.product_name,
        system_stock: c.system_stock,
        physical_count: c.count,
        difference: c.count - c.system_stock,
        collaborator_id: collab.id,
        collaborator_name: collab.name,
        client_uid: `audit-${sessionId}-${c.barcode}`,
      }));
      const { error } = await supabase.from("audits").insert(rows);
      if (error) throw error;

      setSummaryData(Array.from(counts.values()));
      setCounts(new Map());
      clearCatState();
      qc.invalidateQueries({ queryKey: ["audits"] });
      qc.invalidateQueries({ queryKey: ["audits-realtime", category] });
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  // ── Finalize count: persist snapshot to audit_history, THEN clear local state ──
  async function finalizeCount() {
    if (counts.size === 0) return toast.error("No hay productos contados");
    const collab = getCollaborator();
    if (!collab) return toast.error("Sesión expirada");
    if (!confirm(`Finalizar conteo de "${category}"? Se guardará el resumen y se cerrará esta sesión.`)) return;
    setFinalizing(true);
    try {
      const sessionId = crypto.randomUUID();
      const snapshot = Array.from(counts.values());
      const rows = snapshot.map((c) => ({
        session_id: sessionId,
        category,
        branch,
        barcode: c.barcode,
        product_name: c.product_name,
        system_stock: c.system_stock,
        counted_quantity: c.count,
        difference: c.count - c.system_stock,
        collaborator_id: collab.id,
        collaborator_name: collab.name,
      }));
      const { error } = await supabase.from("audit_history").insert(rows);
      if (error) throw error;
      // Only NOW clear local state (persist confirmed)
      setSummaryData(snapshot);
      setSummaryFinal(true);
      setCounts(new Map());
      clearCatState();
      qc.invalidateQueries({ queryKey: ["audit_history"] });
      toast.success("Conteo finalizado y guardado en historial");
    } catch (e) {
      toast.error("No se pudo guardar: " + (e as Error).message);
    } finally {
      setFinalizing(false);
    }
  }


  // Filtered product list for name search
  const filteredProducts = useMemo(() =>
    nameSearch.trim().length >= 2
      ? products.filter((p) => p.product_name.toLowerCase().includes(nameSearch.toLowerCase()))
      : products,
    [products, nameSearch]
  );

  const totalCounted = useMemo(() =>
    Array.from(counts.values()).reduce((s, c) => s + c.count, 0),
    [counts]
  );

  return (
    <div className="space-y-4">
      {/* ── Header ── */}
      <div className="flex items-center gap-2">
        <h1 className="mr-auto text-xl font-semibold tracking-tight">Auditoría</h1>
        {counts.size > 0 && (
          <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200">
            {counts.size} · {totalCounted}
          </span>
        )}
        <Link to="/app/audit-history" className="flex items-center gap-1 rounded-md border px-2 py-1 text-xs hover:bg-muted">
          <History className="h-3.5 w-3.5" /> Historial
        </Link>
      </div>

      {/* ── Category + Branch selector ── */}
      <Card>
        <CardContent className="p-3 space-y-3">
          <div className="flex flex-wrap gap-3">
            <div className="flex-1 min-w-0">
              <label className="text-xs font-medium text-muted-foreground">Categoría</label>
              <select
                value={category}
                onChange={(e) => changeCategory(e.target.value)}
                className="mt-1 h-9 w-full rounded-md border bg-background px-2 text-sm"
              >
                <option value="">Elegir categoría…</option>
                {categories.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
            <div className="shrink-0">
              <label className="text-xs font-medium text-muted-foreground">Sucursal</label>
              <div className="mt-1 inline-flex overflow-hidden rounded-md border">
                {(["A", "B"] as const).map((b) => (
                  <button key={b} type="button" onClick={() => setBranch(b)}
                    className={`px-4 py-1.5 text-sm font-medium transition-colors ${branch === b ? "bg-primary text-primary-foreground" : "bg-background hover:bg-muted"}`}>
                    {b === "A" ? "Mina" : "Morelos"}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Resume banner */}
          {counts.size > 0 && category && (
            <div className="flex items-center justify-between rounded-md bg-amber-50 dark:bg-amber-950/30 border border-amber-200 px-3 py-2 text-xs">
              <span className="text-amber-800 dark:text-amber-200 font-medium">
                ⚠ Conteo en progreso — {counts.size} productos guardados localmente
              </span>
              <button type="button" onClick={() => { setCounts(new Map()); clearCatState(); }}
                className="ml-2 shrink-0 text-amber-700 underline dark:text-amber-300">
                Descartar
              </button>
            </div>
          )}
        </CardContent>
      </Card>

      {category && (
        <>
          {/* ── Scanner ── */}
          <Card>
            <CardContent className="p-3 space-y-2">
              <label className="text-xs font-medium text-muted-foreground">
                Pistolá un producto para sumar +1
              </label>
              <div className="flex gap-2">
                <Input
                  ref={scanRef}
                  autoFocus
                  value={scanInput}
                  onChange={(e) => setScanInput(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addCount(scanInput); } }}
                  placeholder="Código de barras…"
                  className="font-mono"
                  inputMode="numeric"
                />
                <Button type="button" variant="outline" onClick={() => setScanning(true)}>
                  <ScanLine className="h-4 w-4" />
                </Button>
              </div>

              {/* Name search */}
              <div className="relative">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={nameSearch}
                  onChange={(e) => setNameSearch(e.target.value)}
                  placeholder="O buscar por nombre…"
                  className="pl-9"
                />
              </div>
              {nameSearch.trim().length >= 2 && (
                <div className="max-h-40 overflow-auto rounded-md border bg-card">
                  {filteredProducts.map((p) => (
                    <button key={p.barcode} type="button"
                      onClick={() => { addCount(p.barcode); setNameSearch(""); }}
                      className="flex w-full items-center justify-between border-b px-3 py-2 text-left text-sm last:border-b-0 hover:bg-muted">
                      <span className="truncate font-medium">{p.product_name}</span>
                      <span className="ml-2 shrink-0 text-xs text-muted-foreground">
                        Sys: {Number(p.stock_a) + Number(p.stock_b)}
                      </span>
                    </button>
                  ))}
                  {filteredProducts.length === 0 && (
                    <div className="p-3 text-xs text-muted-foreground">Sin resultados</div>
                  )}
                </div>
              )}
            </CardContent>
          </Card>

          {/* ── Product list ── */}
          <div className="space-y-1">
            <div className="flex items-center justify-between px-1">
              <span className="text-xs font-medium text-muted-foreground">
                {counts.size} / {products.length} productos contados
              </span>
              {counts.size > 0 && (
                <Button onClick={saveCount} disabled={saving} size="sm">
                  {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                  Guardar conteo
                </Button>
              )}
            </div>

            <div className="divide-y rounded-md border">
              {products.map((p) => {
                const entry = counts.get(p.barcode);
                const sys = Number(p.stock_a) + Number(p.stock_b);
                const rt = realtimeSums.get(p.barcode);
                // Total = my local count + what's already saved today by anyone
                const myCount = entry?.count ?? 0;
                const savedToday = rt?.total ?? 0;
                const grandTotal = myCount + savedToday;
                const diff = grandTotal - sys;
                const isCounted = myCount > 0;

                return (
                  <div key={p.barcode}
                    className={`px-3 py-2.5 text-xs transition-colors ${isCounted ? "bg-emerald-50 dark:bg-emerald-950/20" : ""}`}>
                    <div className="flex items-start gap-2">
                      {/* Check circle */}
                      <div className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2 ${isCounted ? "border-emerald-500 bg-emerald-500 text-white" : "border-muted-foreground/40"}`}>
                        {isCounted && <CheckCircle2 className="h-3 w-3" />}
                      </div>

                      {/* Product info */}
                      <div className="min-w-0 flex-1">
                        <div className={`font-medium leading-snug ${isCounted ? "" : "text-muted-foreground"}`}>
                          {p.product_name}
                        </div>
                        <div className="font-mono text-muted-foreground">{p.barcode}</div>

                        {/* Real-time counters from other users */}
                        {rt && rt.byUser.size > 0 && (
                          <div className="mt-1 space-y-0.5">
                            {Array.from(rt.byUser.entries()).map(([user, qty]) => (
                              <div key={user} className="text-[10px] text-blue-600 dark:text-blue-400">
                                {user}: {qty} unid. (guardado)
                              </div>
                            ))}
                          </div>
                        )}

                        {/* Live difference preview */}
                        {(myCount > 0 || savedToday > 0) && (
                          <div className="mt-1 flex items-center gap-2 text-[10px]">
                            <span className="text-muted-foreground">Sistema: {sys}</span>
                            <span className="text-muted-foreground">·</span>
                            <span className="font-medium">Total contado: {grandTotal}</span>
                            <span className={`font-bold ${diff === 0 ? "text-emerald-600" : diff > 0 ? "text-amber-600" : "text-red-600"}`}>
                              {diff === 0 ? "✓" : diff > 0 ? `+${diff} SOBRA` : `${diff} FALTA`}
                            </span>
                          </div>
                        )}
                      </div>

                      {/* +/- counter */}
                      <div className="flex items-center gap-1 shrink-0">
                        <button type="button"
                          onClick={() => setCount(p.barcode, myCount - 1)}
                          disabled={myCount === 0}
                          className="flex h-7 w-7 items-center justify-center rounded-full border font-bold text-base disabled:opacity-25 hover:bg-muted active:scale-95">
                          <Minus className="h-3 w-3" />
                        </button>
                        <span className={`w-7 text-center tabular-nums font-bold text-sm ${isCounted ? "text-emerald-700" : "text-muted-foreground"}`}>
                          {myCount || "—"}
                        </span>
                        <button type="button"
                          onClick={() => addCount(p.barcode)}
                          className="flex h-7 w-7 items-center justify-center rounded-full border font-bold text-base hover:bg-muted active:scale-95">
                          <Plus className="h-3 w-3" />
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })}

              {products.length === 0 && (
                <div className="py-8 text-center text-xs text-muted-foreground">
                  <Loader2 className="mx-auto mb-2 h-4 w-4 animate-spin" />
                  Cargando productos…
                </div>
              )}
            </div>

            {/* Save button at bottom too */}
            {counts.size > 0 && (
              <Button onClick={saveCount} disabled={saving} className="w-full mt-2">
                {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                Guardar conteo ({counts.size} productos · {totalCounted} unidades)
              </Button>
            )}
          </div>
        </>
      )}

      {!category && (
        <div className="flex flex-col items-center gap-3 rounded-md border border-dashed py-12 text-center text-muted-foreground">
          <ClipboardList className="h-8 w-8 opacity-40" />
          <p className="text-sm">Elegí una categoría para comenzar el conteo</p>
        </div>
      )}

      {/* ── Summary dialog ── */}
      <Dialog open={!!summaryData} onOpenChange={(o) => { if (!o) setSummaryData(null); }}>
        <DialogContent className="max-h-[90vh] max-w-md overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Resultado del conteo — {category}</DialogTitle>
          </DialogHeader>
          {summaryData && (
            <div className="space-y-3 text-sm">
              {/* Totals summary */}
              <div className="grid grid-cols-3 gap-2">
                <div className="rounded-md bg-emerald-50 dark:bg-emerald-950/20 p-2 text-center">
                  <div className="text-[10px] text-muted-foreground">Sin diferencia</div>
                  <div className="text-lg font-bold text-emerald-700">
                    {summaryData.filter((r) => r.count === r.system_stock).length}
                  </div>
                </div>
                <div className="rounded-md bg-red-50 dark:bg-red-950/20 p-2 text-center">
                  <div className="text-[10px] text-muted-foreground">Faltantes</div>
                  <div className="text-lg font-bold text-red-600">
                    {summaryData.filter((r) => r.count < r.system_stock).length}
                  </div>
                </div>
                <div className="rounded-md bg-amber-50 dark:bg-amber-950/20 p-2 text-center">
                  <div className="text-[10px] text-muted-foreground">Sobrantes</div>
                  <div className="text-lg font-bold text-amber-600">
                    {summaryData.filter((r) => r.count > r.system_stock).length}
                  </div>
                </div>
              </div>

              <p className="text-xs text-muted-foreground">
                Sucursal: {branchLabel(branch)} · {summaryData.length} productos
              </p>

              {/* Product detail */}
              <div className="divide-y rounded-md border">
                {summaryData
                  .sort((a, b) => (a.count - a.system_stock) - (b.count - b.system_stock))
                  .map((r) => {
                    const diff = r.count - r.system_stock;
                    return (
                      <div key={r.barcode}
                        className={`flex items-center gap-2 px-3 py-2.5 text-xs ${diff === 0 ? "bg-emerald-50 dark:bg-emerald-950/20" : diff < 0 ? "bg-red-50 dark:bg-red-950/20" : "bg-amber-50 dark:bg-amber-950/20"}`}>
                        <div className="min-w-0 flex-1">
                          <div className="font-medium truncate">{r.product_name}</div>
                          <div className="font-mono text-muted-foreground">{r.barcode}</div>
                        </div>
                        <div className="shrink-0 text-right space-y-0.5">
                          <div className="text-muted-foreground">Sys: {r.system_stock} · Conteo: {r.count}</div>
                          <div className={`font-bold ${diff === 0 ? "text-emerald-600" : diff < 0 ? "text-red-600" : "text-amber-600"}`}>
                            {diff === 0 ? "✓ Correcto" : diff > 0 ? `+${diff} SOBRA` : `${diff} FALTA`}
                          </div>
                        </div>
                      </div>
                    );
                  })}
              </div>
            </div>
          )}
          <DialogFooter>
            <Button onClick={() => setSummaryData(null)}>Cerrar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Camera scanner */}
      <BarcodeScanner open={scanning} onClose={() => setScanning(false)}
        continuous onDetected={(c) => addCount(c)} />
    </div>
  );
}
