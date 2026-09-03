import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Loader2, ArrowLeft, History, BarChart3 } from "lucide-react";
import { BRANCH_LABELS } from "@/lib/branches";

export const Route = createFileRoute("/app/audit-history")({
  component: AuditHistoryPage,
});

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
};

const MINA = BRANCH_LABELS.A;
const MORELOS = BRANCH_LABELS.B;

function monthKey(iso: string) {
  return iso.slice(0, 7);
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
  const [tab, setTab] = useState<"cortes" | "general">("cortes");
  const [selected, setSelected] = useState<string | null>(null);
  const [filterCat, setFilterCat] = useState("");
  const [filterDate, setFilterDate] = useState("");

  const { data: rows = [], isLoading } = useQuery({
    queryKey: ["closed_counts"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("closed_counts")
        .select("*")
        .order("closed_at", { ascending: false })
        .limit(10000);
      if (error) throw error;
      return data as ClosedRow[];
    },
  });

  const sessions = useMemo(() => {
    const map = new Map<string, {
      session_id: string; category: string; closed_at: string; closed_by: string | null;
      count: number; sys: number; mina: number; morelos: number; total: number; diff: number;
      faltanteVal: number; sobranteVal: number;
    }>();
    for (const r of rows) {
      if (filterCat && r.category !== filterCat) continue;
      if (filterDate && !r.closed_at.startsWith(filterDate)) continue;
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
  }, [rows, filterCat, filterDate]);

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
      return acc;
    }, { sys: 0, mina: 0, morelos: 0, total: 0, ok: 0, faltan: 0, sobran: 0, faltante: 0, sobrante: 0 });

    return (
      <div className="space-y-4">
        <button onClick={() => setSelected(null)} className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft className="h-4 w-4" /> Volver
        </button>

        <Card>
          <CardContent className="p-3 space-y-2">
            <div className="text-sm font-semibold">{s?.category ?? detail[0]?.category}</div>
            <div className="text-xs text-muted-foreground">
              {detail[0] && new Date(detail[0].closed_at).toLocaleString("es-MX")} · Cerrado por {detail[0]?.closed_by ?? "—"}
            </div>

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
              </div>
              <div className="rounded bg-amber-50 dark:bg-amber-950/20 p-2">
                <div className="text-[10px] text-muted-foreground">Sobrantes</div>
                <div className="text-base font-bold text-amber-600">{t.sobran} · {t.sobrante} pz</div>
              </div>
            </div>
            <div className="text-xs text-muted-foreground">
              % de faltante: <span className="font-semibold">{pct(t.faltante, t.sys).toFixed(2)}%</span>
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
            <div className="w-12 shrink-0 text-center">Δ</div>
          </div>
          {[...detail].sort((a, b) => Number(a.difference) - Number(b.difference)).map((r) => {
            const d = Number(r.difference);
            return (
              <div key={r.id}
                className={`flex items-center gap-2 px-3 py-2 text-xs ${d === 0 ? "" : d < 0 ? "bg-red-50 dark:bg-red-950/20" : "bg-amber-50 dark:bg-amber-950/20"}`}>
                <div className="min-w-0 flex-1">
                  <div className="font-medium truncate">{r.product_name}</div>
                  <div className="font-mono text-[10px] text-muted-foreground">{r.barcode}</div>
                </div>
                <div className="w-10 shrink-0 text-center font-semibold">{r.mina_count}</div>
                <div className="w-10 shrink-0 text-center font-semibold">{r.morelos_count}</div>
                <div className="w-10 shrink-0 text-center font-semibold">{r.total_counted}</div>
                <div className="w-10 shrink-0 text-center text-muted-foreground">{r.system_stock}</div>
                <div className={`w-12 shrink-0 text-center font-bold ${d === 0 ? "text-emerald-600" : d < 0 ? "text-red-600" : "text-amber-600"}`}>
                  {d === 0 ? "✓" : d > 0 ? `+${d}` : d}
                </div>
              </div>
            );
          })}
        </div>
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
                <label className="text-xs font-medium text-muted-foreground">Fecha</label>
                <input type="date" value={filterDate} onChange={(e) => setFilterDate(e.target.value)}
                  className="mt-1 h-9 w-full rounded-md border bg-background px-2 text-sm" />
              </div>
            </CardContent>
          </Card>

          <div className="divide-y rounded-md border">
            {sessions.map((s) => (
              <button key={s.session_id} onClick={() => setSelected(s.session_id)}
                className="flex w-full items-center gap-2 px-3 py-2.5 text-left text-sm hover:bg-muted">
                <div className="min-w-0 flex-1">
                  <div className="font-medium truncate">{s.category}</div>
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
                </div>
              </button>
            ))}
            {!isLoading && sessions.length === 0 && (
              <div className="py-8 text-center text-xs text-muted-foreground">Sin cortes cerrados</div>
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
                    <div>Faltante: <b className="text-red-600">{m.faltante} pz</b></div>
                    <div>Sobrante: <b className="text-amber-600">{m.sobrante} pz</b></div>
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
