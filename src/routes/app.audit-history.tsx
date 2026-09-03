import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Loader2, ArrowLeft, History, BarChart3, ShieldAlert, Pencil, CheckCircle2, PackageCheck } from "lucide-react";
import { toast } from "sonner";
import { BRANCH_LABELS } from "@/lib/branches";
import { useCollaborator } from "@/lib/session";

export const Route = createFileRoute("/app/audit-history")({
  component: AuditHistoryPage,
});

type CountDetail = { name: string; branch: string; qty: number; at: string };

type ClosedRow = {
  id: string;
  session_id: string;
  category: string;
  barcode: string;
  product_name: string;
  system_stock: number;
  mina_count: number;
  morelos_count: number;
  total_counted: number;
  difference: number;
  unit_price: number | null;
  difference_value: number | null;
  scanned_mina: boolean;
  scanned_morelos: boolean;
  closed_by: string | null;
  closed_at: string;
  count_details: CountDetail[] | null;
  last_counted_by: string | null;
  last_counted_at: string | null;
};

type ZobazeCorrection = {
  session_id: string;
  corrected: boolean;
  corrected_by: string | null;
  corrected_at: string;
};

const MINA = BRANCH_LABELS.A;
const MORELOS = BRANCH_LABELS.B;

// Paleta de colores para diferenciar visualmente cada mes en "Cortes por categoría"
const MONTH_COLORS = [
  { bar: "bg-violet-500", badge: "bg-violet-100 text-violet-800 dark:bg-violet-900/30 dark:text-violet-200", ring: "border-l-violet-500" },
  { bar: "bg-sky-500", badge: "bg-sky-100 text-sky-800 dark:bg-sky-900/30 dark:text-sky-200", ring: "border-l-sky-500" },
  { bar: "bg-emerald-500", badge: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-200", ring: "border-l-emerald-500" },
  { bar: "bg-amber-500", badge: "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-200", ring: "border-l-amber-500" },
  { bar: "bg-rose-500", badge: "bg-rose-100 text-rose-800 dark:bg-rose-900/30 dark:text-rose-200", ring: "border-l-rose-500" },
  { bar: "bg-cyan-500", badge: "bg-cyan-100 text-cyan-800 dark:bg-cyan-900/30 dark:text-cyan-200", ring: "border-l-cyan-500" },
];
function monthColor(key: string) {
  let hash = 0;
  for (let i = 0; i < key.length; i++) hash = (hash * 31 + key.charCodeAt(i)) >>> 0;
  return MONTH_COLORS[hash % MONTH_COLORS.length];
}

function monthKey(iso: string) {
  return iso.slice(0, 7);
}
function nowMonthKey() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}
function monthName(key: string) {
  const [y, m] = key.split("-").map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString("es-MX", { month: "long", year: "numeric" });
}
function pct(missing: number, sys: number) {
  if (sys <= 0) return 0;
  return (missing / sys) * 100;
}
function money(n: number) {
  return n.toLocaleString("es-MX", { style: "currency", currency: "MXN", maximumFractionDigits: 2 });
}
// Valor en pesos de la diferencia; para cortes antiguos sin difference_value
// se calcula como diferencia × precio unitario guardado.
function rowValue(r: ClosedRow) {
  const v = Number(r.difference_value ?? 0);
  if (v !== 0) return v;
  return Number(r.difference) * Number(r.unit_price ?? 0);
}

function AuditHistoryPage() {
  const me = useCollaborator();
  const qc = useQueryClient();
  const [tab, setTab] = useState<"cortes" | "general">("cortes");
  const [selected, setSelected] = useState<string | null>(null);
  const [filterCat, setFilterCat] = useState("");
  const [filterDate, setFilterDate] = useState("");
  // Por defecto "Cortes por categoría" muestra el mes en curso.
  // Al buscar una fecha específica, se ignora el filtro de mes.
  const [filterMonth, setFilterMonth] = useState<string>(nowMonthKey());
  const [adminPin, setAdminPin] = useState("");
  const [editRow, setEditRow] = useState<ClosedRow | null>(null);
  const [editMina, setEditMina] = useState(0);
  const [editMorelos, setEditMorelos] = useState(0);
  const [savingEdit, setSavingEdit] = useState(false);
  const [savingZobaze, setSavingZobaze] = useState(false);

  const { data: rows = [], isLoading } = useQuery({
    queryKey: ["closed_counts"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("closed_counts")
        .select("*")
        .order("closed_at", { ascending: false })
        .limit(10000);
      if (error) throw error;
      return data as unknown as ClosedRow[];
    },
  });

  const { data: corrections = [] } = useQuery({
    queryKey: ["zobaze_corrections"],
    queryFn: async () => {
      const { data, error } = await supabase.from("zobaze_corrections").select("*");
      if (error) throw error;
      return data as ZobazeCorrection[];
    },
  });
  const correctionsMap = useMemo(() => {
    const map = new Map<string, ZobazeCorrection>();
    for (const c of corrections) if (c.corrected) map.set(c.session_id, c);
    return map;
  }, [corrections]);

  function openEdit(r: ClosedRow) {
    setEditRow(r);
    setEditMina(r.mina_count);
    setEditMorelos(r.morelos_count);
  }

  async function saveEdit() {
    if (!editRow || !me) return;
    if (adminPin.length < 4) { toast.error("Ingresá tu PIN de administrador"); return; }
    setSavingEdit(true);
    try {
      const { error } = await supabase.rpc("admin_update_closed_count_row", {
        p_admin_id: me.id, p_admin_pin: adminPin, p_row_id: editRow.id,
        p_mina_count: editMina, p_morelos_count: editMorelos,
      });
      if (error) throw error;
      toast.success("Conteo corregido");
      setEditRow(null);
      qc.invalidateQueries({ queryKey: ["closed_counts"] });
    } catch (e) { toast.error((e as Error).message); }
    finally { setSavingEdit(false); }
  }

  async function toggleZobaze(sessionId: string, category: string, corrected: boolean) {
    if (!me) return;
    if (adminPin.length < 4) { toast.error("Ingresá tu PIN de administrador arriba para marcar Zobaze"); return; }
    setSavingZobaze(true);
    try {
      const { error } = await supabase.rpc("admin_set_zobaze_correction", {
        p_admin_id: me.id, p_admin_pin: adminPin, p_session_id: sessionId,
        p_category: category, p_corrected: corrected,
      });
      if (error) throw error;
      toast.success(corrected ? "Marcado como corregido en Zobaze ✓" : "Marca de Zobaze quitada");
      qc.invalidateQueries({ queryKey: ["zobaze_corrections"] });
    } catch (e) { toast.error((e as Error).message); }
    finally { setSavingZobaze(false); }
  }

  const sessions = useMemo(() => {
    const map = new Map<string, {
      session_id: string; category: string; closed_at: string; closed_by: string | null;
      count: number; sys: number; mina: number; morelos: number; total: number; diff: number;
      faltanteVal: number; sobranteVal: number;
    }>();
    for (const r of rows) {
      if (filterCat && r.category !== filterCat) continue;
      if (filterDate) {
        // Búsqueda por fecha específica: manda sobre el filtro de mes.
        if (!r.closed_at.startsWith(filterDate)) continue;
      } else if (filterMonth && monthKey(r.closed_at) !== filterMonth) {
        continue;
      }
      const e = map.get(r.session_id) ?? {
        session_id: r.session_id, category: r.category, closed_at: r.closed_at,
        closed_by: r.closed_by, count: 0, sys: 0, mina: 0, morelos: 0, total: 0, diff: 0,
        faltanteVal: 0, sobranteVal: 0,
      };
      e.count++;
      e.sys += Number(r.system_stock);
      e.mina += Number(r.mina_count);
      e.morelos += Number(r.morelos_count);
      e.total += Number(r.total_counted);
      e.diff += Number(r.difference);
      const v = rowValue(r);
      if (v < 0) e.faltanteVal += -v; else e.sobranteVal += v;
      map.set(r.session_id, e);
    }
    return Array.from(map.values()).sort((a, b) => b.closed_at.localeCompare(a.closed_at));
  }, [rows, filterCat, filterDate, filterMonth]);

  const monthOptions = useMemo(() => {
    const set = new Set<string>(rows.map((r) => monthKey(r.closed_at)));
    set.add(nowMonthKey());
    return Array.from(set).sort((a, b) => b.localeCompare(a));
  }, [rows]);

  const categories = useMemo(
    () => Array.from(new Set(rows.map((r) => r.category))).sort((a, b) => a.localeCompare(b, "es")),
    [rows]
  );

  // ── Reporte general por mes ──────────────────────────────────────────
  const monthly = useMemo(() => {
    const map = new Map<string, {
      key: string; sys: number; mina: number; morelos: number; total: number;
      faltante: number; sobrante: number; faltanteVal: number; sobranteVal: number;
      categories: Set<string>; sessions: Set<string>;
    }>();
    for (const r of rows) {
      const k = monthKey(r.closed_at);
      const e = map.get(k) ?? {
        key: k, sys: 0, mina: 0, morelos: 0, total: 0, faltante: 0, sobrante: 0,
        faltanteVal: 0, sobranteVal: 0,
        categories: new Set<string>(), sessions: new Set<string>(),
      };
      e.sys += Number(r.system_stock);
      e.mina += Number(r.mina_count);
      e.morelos += Number(r.morelos_count);
      e.total += Number(r.total_counted);
      const d = Number(r.difference);
      if (d < 0) e.faltante += -d;
      else e.sobrante += d;
      const v = rowValue(r);
      if (v < 0) e.faltanteVal += -v; else e.sobranteVal += v;
      e.categories.add(r.category);
      e.sessions.add(r.session_id);
      map.set(k, e);
    }
    return Array.from(map.values()).sort((a, b) => b.key.localeCompare(a.key));
  }, [rows]);

  // ── Detalle de un corte ──────────────────────────────────────────────
  if (selected) {
    const detail = rows.filter((r) => r.session_id === selected);
    const s = sessions.find((x) => x.session_id === selected);
    const t = detail.reduce((acc, r) => {
      acc.sys += Number(r.system_stock);
      acc.mina += Number(r.mina_count);
      acc.morelos += Number(r.morelos_count);
      acc.total += Number(r.total_counted);
      const d = Number(r.difference);
      if (d === 0) acc.ok++; else if (d < 0) { acc.faltan++; acc.faltante += -d; } else { acc.sobran++; acc.sobrante += d; }
      const v = rowValue(r);
      if (v < 0) acc.faltanteVal += -v; else acc.sobranteVal += v;
      return acc;
    }, { sys: 0, mina: 0, morelos: 0, total: 0, ok: 0, faltan: 0, sobran: 0, faltante: 0, sobrante: 0, faltanteVal: 0, sobranteVal: 0 });

    const correction = correctionsMap.get(selected);

    return (
      <div className="space-y-4">
        <button onClick={() => setSelected(null)} className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft className="h-4 w-4" /> Volver
        </button>

        {me?.is_admin && (
          <Card>
            <CardContent className="p-3 space-y-2">
              <label className="text-xs font-medium text-muted-foreground">Tu PIN de administrador</label>
              <Input type="password" inputMode="numeric" value={adminPin}
                onChange={(e) => setAdminPin(e.target.value.replace(/\D/g, ""))}
                placeholder="Necesario para corregir o marcar Zobaze" className="max-w-xs" />
            </CardContent>
          </Card>
        )}

        <Card>
          <CardContent className="p-3 space-y-2">
            <div className="flex items-center justify-between gap-2">
              <div className="text-sm font-semibold">{s?.category ?? detail[0]?.category}</div>
              {correction && (
                <span className="flex items-center gap-1 rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-medium text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200">
                  <PackageCheck className="h-3 w-3" /> Corregido en Zobaze
                </span>
              )}
            </div>
            <div className="text-xs text-muted-foreground">
              {detail[0] && new Date(detail[0].closed_at).toLocaleString("es-MX")} · Cerrado por {detail[0]?.closed_by ?? "—"}
            </div>
            {correction && (
              <div className="text-[11px] text-emerald-700 dark:text-emerald-300">
                Corregido por {correction.corrected_by ?? "—"} · {new Date(correction.corrected_at).toLocaleString("es-MX")}
              </div>
            )}
            {me?.is_admin && (
              <Button size="sm" variant="outline" disabled={savingZobaze}
                className={correction ? "border-red-300 text-red-700 hover:bg-red-50" : "border-emerald-400 text-emerald-700 hover:bg-emerald-50"}
                onClick={() => toggleZobaze(selected, s?.category ?? detail[0]?.category ?? "", !correction)}>
                {savingZobaze ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <PackageCheck className="h-3.5 w-3.5" />}
                {correction ? "Quitar marca de Zobaze" : "Marcar como corregido en Zobaze"}
              </Button>
            )}
            <p className="text-[11px] text-muted-foreground">
              El conteo se conserva tal cual para llevar el registro; esta marca solo indica que ya ajustaste las existencias en Zobaze según este corte.
            </p>

            <div className="grid grid-cols-2 gap-2 pt-2 text-center">
              <div className="rounded bg-muted p-2">
                <div className="text-[10px] text-muted-foreground">{MINA}</div>
                <div className="text-lg font-bold">{t.mina}</div>
              </div>
              <div className="rounded bg-muted p-2">
                <div className="text-[10px] text-muted-foreground">{MORELOS}</div>
                <div className="text-lg font-bold">{t.morelos}</div>
              </div>
            </div>

            <div className="grid grid-cols-3 gap-2 text-center">
              <div className="rounded bg-muted p-2">
                <div className="text-[10px] text-muted-foreground">Sistema</div>
                <div className="text-lg font-bold">{t.sys}</div>
              </div>
              <div className="rounded bg-muted p-2">
                <div className="text-[10px] text-muted-foreground">Contado</div>
                <div className="text-lg font-bold">{t.total}</div>
              </div>
              <div className="rounded bg-muted p-2">
                <div className="text-[10px] text-muted-foreground">Δ Total</div>
                <div className={`text-lg font-bold ${t.total - t.sys === 0 ? "text-emerald-600" : t.total - t.sys < 0 ? "text-red-600" : "text-amber-600"}`}>
                  {t.total - t.sys > 0 ? `+${t.total - t.sys}` : t.total - t.sys}
                </div>
              </div>
            </div>

            <div className="grid grid-cols-3 gap-2 text-center">
              <div className="rounded bg-emerald-50 dark:bg-emerald-950/20 p-2">
                <div className="text-[10px] text-muted-foreground">Exactos</div>
                <div className="text-base font-bold text-emerald-700">{t.ok}</div>
              </div>
              <div className="rounded bg-red-50 dark:bg-red-950/20 p-2">
                <div className="text-[10px] text-muted-foreground">Faltantes</div>
                <div className="text-base font-bold text-red-600">{t.faltan} · {t.faltante} pz</div>
                <div className="text-[11px] font-semibold text-red-600">{money(t.faltanteVal)}</div>
              </div>
              <div className="rounded bg-amber-50 dark:bg-amber-950/20 p-2">
                <div className="text-[10px] text-muted-foreground">Sobrantes</div>
                <div className="text-base font-bold text-amber-600">{t.sobran} · {t.sobrante} pz</div>
                <div className="text-[11px] font-semibold text-amber-600">{money(t.sobranteVal)}</div>
              </div>
            </div>
            <div className="text-xs text-muted-foreground">
              % de faltante: <span className="font-semibold">{pct(t.faltante, t.sys).toFixed(2)}%</span>
              {t.faltanteVal > 0 && <> · Faltante: <span className="font-semibold text-red-600">{money(t.faltanteVal)}</span></>}
            </div>
          </CardContent>
        </Card>

        <div className="divide-y rounded-md border">
          <div className="flex items-center gap-2 bg-muted/50 px-3 py-2 text-[10px] font-medium uppercase text-muted-foreground">
            <div className="min-w-0 flex-1">Producto</div>
            <div className="w-10 shrink-0 text-center">{MINA.slice(0, 4)}</div>
            <div className="w-10 shrink-0 text-center">{MORELOS.slice(0, 4)}</div>
            <div className="w-10 shrink-0 text-center">Tot</div>
            <div className="w-10 shrink-0 text-center">Sys</div>
            <div className="w-16 shrink-0 text-center">Δ</div>
          </div>
          {[...detail].sort((a, b) => Number(a.difference) - Number(b.difference)).map((r) => {
            const d = Number(r.difference);
            const v = rowValue(r);
            const contributors = (r.count_details ?? []) as CountDetail[];
            return (
              <div key={r.id}
                className={`px-3 py-2 text-xs ${d === 0 ? "" : d < 0 ? "bg-red-50 dark:bg-red-950/20" : "bg-amber-50 dark:bg-amber-950/20"}`}>
                <div className="flex items-center gap-2">
                  <div className="min-w-0 flex-1">
                    <div className="font-medium break-words leading-snug">{r.product_name}</div>
                    <div className="font-mono text-[10px] text-muted-foreground">{r.barcode}</div>
                  </div>
                  <div className="w-10 shrink-0 text-center font-semibold">{r.mina_count}</div>
                  <div className="w-10 shrink-0 text-center font-semibold">{r.morelos_count}</div>
                  <div className="w-10 shrink-0 text-center font-semibold">{r.total_counted}</div>
                  <div className="w-10 shrink-0 text-center text-muted-foreground">{r.system_stock}</div>
                  <div className={`w-16 shrink-0 text-center font-bold ${d === 0 ? "text-emerald-600" : d < 0 ? "text-red-600" : "text-amber-600"}`}>
                    <div>{d === 0 ? "✓" : d > 0 ? `+${d}` : d}</div>
                    {v !== 0 && <div className="text-[10px] font-semibold">{money(v)}</div>}
                  </div>
                  {me?.is_admin && (
                    <button type="button" onClick={() => openEdit(r)}
                      className="shrink-0 rounded p-1 hover:bg-muted" title="Corregir conteo">
                      <Pencil className="h-3.5 w-3.5" />
                    </button>
                  )}
                </div>
                {(contributors.length > 0 || r.last_counted_by) && (
                  <div className="mt-1 text-[10px] text-blue-600 dark:text-blue-400">
                    {contributors.length > 0
                      ? contributors.map((c, i) => (
                          <span key={i}>
                            {i > 0 && " · "}
                            {c.name} ({c.branch}, {c.qty}) {new Date(c.at).toLocaleString("es-MX", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}
                          </span>
                        ))
                      : <span>Últ. contado por {r.last_counted_by}{r.last_counted_at && ` · ${new Date(r.last_counted_at).toLocaleString("es-MX", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}`}</span>}
                  </div>
                )}
              </div>
            );
          })}
        </div>

      {/* ── Dialog: corregir conteo (admin) ── */}
      <Dialog open={!!editRow} onOpenChange={(o) => { if (!o) setEditRow(null); }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-1.5 text-amber-700 dark:text-amber-300">
              <ShieldAlert className="h-4 w-4" /> Corregir conteo
            </DialogTitle>
          </DialogHeader>
          {editRow && (
            <div className="space-y-3 text-sm">
              <p className="text-muted-foreground">{editRow.product_name}</p>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-xs font-medium text-muted-foreground">{MINA}</label>
                  <Input type="number" min={0} value={editMina}
                    onChange={(e) => setEditMina(Math.max(0, parseInt(e.target.value, 10) || 0))} />
                </div>
                <div>
                  <label className="text-xs font-medium text-muted-foreground">{MORELOS}</label>
                  <Input type="number" min={0} value={editMorelos}
                    onChange={(e) => setEditMorelos(Math.max(0, parseInt(e.target.value, 10) || 0))} />
                </div>
              </div>
              <p className="text-[11px] text-muted-foreground">
                Sistema: {editRow.system_stock} · Nueva diferencia: {(editMina + editMorelos) - editRow.system_stock}
              </p>
              {!me?.is_admin || adminPin.length < 4 ? (
                <div>
                  <label className="text-xs font-medium text-muted-foreground">Tu PIN de administrador</label>
                  <Input type="password" inputMode="numeric" autoFocus value={adminPin}
                    onChange={(e) => setAdminPin(e.target.value.replace(/\D/g, ""))}
                    placeholder="PIN" className="mt-1" />
                </div>
              ) : null}
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditRow(null)}>Cancelar</Button>
            <Button disabled={savingEdit} onClick={saveEdit}>
              {savingEdit ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
              Guardar corrección
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <History className="h-5 w-5" />
        <h1 className="text-xl font-semibold">Historial de auditorías</h1>
        <Link to="/app/audit" className="ml-auto text-sm text-muted-foreground hover:text-foreground">
          Nuevo conteo →
        </Link>
      </div>

      <div className="flex rounded-md border p-0.5 text-sm">
        <button onClick={() => setTab("cortes")}
          className={`flex-1 rounded px-3 py-1.5 ${tab === "cortes" ? "bg-primary text-primary-foreground" : "text-muted-foreground"}`}>
          Cortes por categoría
        </button>
        <button onClick={() => setTab("general")}
          className={`flex-1 rounded px-3 py-1.5 ${tab === "general" ? "bg-primary text-primary-foreground" : "text-muted-foreground"}`}>
          Reporte general
        </button>
      </div>

      {isLoading && (
        <div className="py-8 text-center text-xs text-muted-foreground">
          <Loader2 className="mx-auto mb-2 h-4 w-4 animate-spin" /> Cargando…
        </div>
      )}

      {tab === "cortes" && (
        <>
          <Card>
            <CardContent className="p-3 flex flex-wrap gap-2">
              <div className="flex-1 min-w-[140px]">
                <label className="text-xs font-medium text-muted-foreground">Categoría</label>
                <select value={filterCat} onChange={(e) => setFilterCat(e.target.value)}
                  className="mt-1 h-9 w-full rounded-md border bg-background px-2 text-sm">
                  <option value="">Todas</option>
                  {categories.map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>
              <div className="flex-1 min-w-[140px]">
                <label className="text-xs font-medium text-muted-foreground">Mes</label>
                <select value={filterMonth} disabled={!!filterDate}
                  onChange={(e) => setFilterMonth(e.target.value)}
                  className="mt-1 h-9 w-full rounded-md border bg-background px-2 text-sm capitalize disabled:opacity-50">
                  <option value="">Todos los meses</option>
                  {monthOptions.map((k) => (
                    <option key={k} value={k} className="capitalize">{monthName(k)}</option>
                  ))}
                </select>
              </div>
              <div className="flex-1 min-w-[140px]">
                <label className="text-xs font-medium text-muted-foreground">Buscar fecha específica</label>
                <input type="date" value={filterDate}
                  onChange={(e) => { setFilterDate(e.target.value); if (e.target.value) setFilterMonth(""); }}
                  className="mt-1 h-9 w-full rounded-md border bg-background px-2 text-sm" />
                {filterDate && (
                  <button type="button" onClick={() => { setFilterDate(""); setFilterMonth(nowMonthKey()); }}
                    className="mt-1 text-[11px] text-muted-foreground underline">
                    Quitar fecha y volver al mes en curso
                  </button>
                )}
              </div>
            </CardContent>
          </Card>

          <div className="space-y-4">
            {(() => {
              const groups = new Map<string, typeof sessions>();
              for (const s of sessions) {
                const k = monthKey(s.closed_at);
                const arr = groups.get(k) ?? [];
                arr.push(s);
                groups.set(k, arr);
              }
              const orderedKeys = Array.from(groups.keys()).sort((a, b) => b.localeCompare(a));
              return orderedKeys.map((k) => {
                const color = monthColor(k);
                const group = groups.get(k)!;
                return (
                  <div key={k} className="space-y-1.5">
                    <div className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-semibold capitalize ${color.badge}`}>
                      <span className={`h-2 w-2 rounded-full ${color.bar}`} />
                      {monthName(k)}
                    </div>
                    <div className="divide-y rounded-md border overflow-hidden">
                      {group.map((s) => {
                        const corrected = correctionsMap.has(s.session_id);
                        return (
                          <button key={s.session_id} onClick={() => setSelected(s.session_id)}
                            className={`flex w-full items-center gap-2 border-l-4 ${color.ring} px-3 py-2.5 text-left text-sm hover:bg-muted`}>
                            <div className="min-w-0 flex-1">
                              <div className="flex items-center gap-1.5">
                                <span className="font-medium truncate">{s.category}</span>
                                {corrected && (
                                  <span className="flex items-center gap-0.5 shrink-0 rounded-full bg-emerald-100 px-1.5 py-0.5 text-[9px] font-medium text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200">
                                    <PackageCheck className="h-2.5 w-2.5" /> Zobaze
                                  </span>
                                )}
                              </div>
                              <div className="text-xs text-muted-foreground">
                                {new Date(s.closed_at).toLocaleString("es-MX")} · {s.closed_by ?? "—"}
                              </div>
                              <div className="text-[11px] text-muted-foreground">
                                {MINA}: <b>{s.mina}</b> · {MORELOS}: <b>{s.morelos}</b> · Sistema: {s.sys}
                              </div>
                            </div>
                            <div className="shrink-0 text-right text-xs">
                              <div className="text-muted-foreground">{s.count} prod.</div>
                              <div className={`font-bold ${s.diff === 0 ? "text-emerald-600" : s.diff < 0 ? "text-red-600" : "text-amber-600"}`}>
                                {s.diff === 0 ? "✓ exacto" : s.diff > 0 ? `+${s.diff}` : s.diff}
                              </div>
                              {s.faltanteVal > 0 && <div className="text-[11px] font-semibold text-red-600">−{money(s.faltanteVal)}</div>}
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                );
              });
            })()}
            {!isLoading && sessions.length === 0 && (
              <div className="py-8 text-center text-xs text-muted-foreground rounded-md border space-y-1">
                <p>Sin cortes cerrados{filterMonth ? ` en ${monthName(filterMonth)}` : ""}{filterDate ? ` para ${filterDate}` : ""}.</p>
                {(filterMonth || filterDate) && (
                  <button type="button" onClick={() => { setFilterDate(""); setFilterMonth(""); }} className="underline">
                    Ver todos los meses
                  </button>
                )}
              </div>
            )}
          </div>
        </>
      )}

      {tab === "general" && (
        <div className="space-y-3">
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <BarChart3 className="h-4 w-4" /> Faltante por mes (todas las categorías cerradas)
          </div>
          {monthly.map((m, i) => {
            const p = pct(m.faltante, m.sys);
            const prev = monthly[i + 1];
            const prevP = prev ? pct(prev.faltante, prev.sys) : null;
            const delta = prevP === null ? null : p - prevP;
            return (
              <Card key={m.key}>
                <CardContent className="p-3 space-y-2">
                  <div className="flex items-center justify-between">
                    <div className="text-sm font-semibold capitalize">{monthName(m.key)}</div>
                    <div className={`text-lg font-bold ${p === 0 ? "text-emerald-600" : p < 2 ? "text-amber-600" : "text-red-600"}`}>
                      {p.toFixed(2)}%
                    </div>
                  </div>
                  <div className="h-2 w-full overflow-hidden rounded bg-muted">
                    <div className="h-full bg-red-500" style={{ width: `${Math.min(100, p)}%` }} />
                  </div>
                  <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-xs text-muted-foreground sm:grid-cols-4">
                    <div>Sistema: <b className="text-foreground">{m.sys}</b></div>
                    <div>Contado: <b className="text-foreground">{m.total}</b></div>
                    <div>{MINA}: <b className="text-foreground">{m.mina}</b></div>
                    <div>{MORELOS}: <b className="text-foreground">{m.morelos}</b></div>
                    <div>Faltante: <b className="text-red-600">{m.faltante} pz</b> <b className="text-red-600">· {money(m.faltanteVal)}</b></div>
                    <div>Sobrante: <b className="text-amber-600">{m.sobrante} pz</b> <b className="text-amber-600">· {money(m.sobranteVal)}</b></div>
                    <div>Categorías: <b className="text-foreground">{m.categories.size}</b></div>
                    <div>Cortes: <b className="text-foreground">{m.sessions.size}</b></div>
                  </div>
                  {delta !== null && (
                    <div className={`text-xs font-medium ${delta <= 0 ? "text-emerald-600" : "text-red-600"}`}>
                      {delta <= 0 ? "▼ Mejoró" : "▲ Empeoró"} {Math.abs(delta).toFixed(2)} pts vs mes anterior
                    </div>
                  )}
                </CardContent>
              </Card>
            );
          })}
          {!isLoading && monthly.length === 0 && (
            <div className="py-8 text-center text-xs text-muted-foreground">Aún no hay cortes cerrados</div>
          )}
        </div>
      )}
    </div>
  );
}
