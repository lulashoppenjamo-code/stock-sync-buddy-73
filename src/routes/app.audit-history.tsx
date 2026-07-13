import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Loader2, ArrowLeft, History } from "lucide-react";
import { branchLabel } from "@/lib/branches";

export const Route = createFileRoute("/app/audit-history")({
  component: AuditHistoryPage,
});

type Row = {
  id: string;
  session_id: string;
  category: string;
  branch: string;
  barcode: string;
  product_name: string;
  system_stock: number;
  counted_quantity: number;
  difference: number;
  collaborator_name: string | null;
  created_at: string;
};

function AuditHistoryPage() {
  const [selected, setSelected] = useState<string | null>(null);
  const [filterCat, setFilterCat] = useState("");
  const [filterDate, setFilterDate] = useState("");

  const { data: rows = [], isLoading } = useQuery({
    queryKey: ["audit_history"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("audit_history")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(5000);
      if (error) throw error;
      return data as Row[];
    },
  });

  const sessions = useMemo(() => {
    const map = new Map<string, { session_id: string; category: string; branch: string; created_at: string; collaborator_name: string | null; count: number }>();
    for (const r of rows) {
      if (filterCat && r.category !== filterCat) continue;
      if (filterDate && !r.created_at.startsWith(filterDate)) continue;
      const existing = map.get(r.session_id);
      if (existing) existing.count++;
      else map.set(r.session_id, {
        session_id: r.session_id, category: r.category, branch: r.branch,
        created_at: r.created_at, collaborator_name: r.collaborator_name, count: 1,
      });
    }
    return Array.from(map.values()).sort((a, b) => b.created_at.localeCompare(a.created_at));
  }, [rows, filterCat, filterDate]);

  const categories = useMemo(() =>
    Array.from(new Set(rows.map((r) => r.category))).sort((a, b) => a.localeCompare(b, "es")),
    [rows]
  );

  const detail = useMemo(() => selected ? rows.filter((r) => r.session_id === selected) : [], [rows, selected]);

  if (selected) {
    const s = sessions.find((x) => x.session_id === selected) ?? detail[0];
    const totals = detail.reduce((acc, r) => {
      acc.sys += Number(r.system_stock);
      acc.cnt += Number(r.counted_quantity);
      if (r.difference === 0) acc.ok++;
      else if (r.difference < 0) acc.faltan++;
      else acc.sobran++;
      return acc;
    }, { sys: 0, cnt: 0, ok: 0, faltan: 0, sobran: 0 });

    return (
      <div className="space-y-4">
        <div className="flex items-center gap-2">
          <button onClick={() => setSelected(null)} className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
            <ArrowLeft className="h-4 w-4" /> Volver
          </button>
        </div>
        <Card>
          <CardContent className="p-3 space-y-2">
            <div className="text-sm font-semibold">{s?.category}</div>
            <div className="text-xs text-muted-foreground">
              {s && new Date(s.created_at).toLocaleString("es-MX")} · Sucursal: {branchLabel(s?.branch)} · {s?.collaborator_name ?? "—"}
            </div>
            <div className="grid grid-cols-3 gap-2 pt-2">
              <div className="rounded bg-emerald-50 dark:bg-emerald-950/20 p-2 text-center">
                <div className="text-[10px] text-muted-foreground">Sin diferencia</div>
                <div className="text-lg font-bold text-emerald-700">{totals.ok}</div>
              </div>
              <div className="rounded bg-red-50 dark:bg-red-950/20 p-2 text-center">
                <div className="text-[10px] text-muted-foreground">Faltantes</div>
                <div className="text-lg font-bold text-red-600">{totals.faltan}</div>
              </div>
              <div className="rounded bg-amber-50 dark:bg-amber-950/20 p-2 text-center">
                <div className="text-[10px] text-muted-foreground">Sobrantes</div>
                <div className="text-lg font-bold text-amber-600">{totals.sobran}</div>
              </div>
            </div>
            <div className="pt-1 text-xs text-muted-foreground">
              Sistema: {totals.sys} · Contado: {totals.cnt} · Δ {totals.cnt - totals.sys}
            </div>
          </CardContent>
        </Card>
        <div className="divide-y rounded-md border">
          {detail.sort((a, b) => a.difference - b.difference).map((r) => (
            <div key={r.id}
              className={`flex items-center gap-2 px-3 py-2.5 text-xs ${r.difference === 0 ? "" : r.difference < 0 ? "bg-red-50 dark:bg-red-950/20" : "bg-amber-50 dark:bg-amber-950/20"}`}>
              <div className="min-w-0 flex-1">
                <div className="font-medium truncate">{r.product_name}</div>
                <div className="font-mono text-muted-foreground">{r.barcode}</div>
              </div>
              <div className="shrink-0 text-right">
                <div className="text-muted-foreground">Sys: {r.system_stock} · Conteo: {r.counted_quantity}</div>
                <div className={`font-bold ${r.difference === 0 ? "text-emerald-600" : r.difference < 0 ? "text-red-600" : "text-amber-600"}`}>
                  {r.difference === 0 ? "✓" : r.difference > 0 ? `+${r.difference} SOBRA` : `${r.difference} FALTA`}
                </div>
              </div>
            </div>
          ))}
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

      {isLoading && (
        <div className="py-8 text-center text-xs text-muted-foreground">
          <Loader2 className="mx-auto mb-2 h-4 w-4 animate-spin" /> Cargando…
        </div>
      )}

      <div className="divide-y rounded-md border">
        {sessions.map((s) => (
          <button key={s.session_id} onClick={() => setSelected(s.session_id)}
            className="flex w-full items-center gap-2 px-3 py-2.5 text-left text-sm hover:bg-muted">
            <div className="min-w-0 flex-1">
              <div className="font-medium truncate">{s.category}</div>
              <div className="text-xs text-muted-foreground">
                {new Date(s.created_at).toLocaleString("es-MX")} · {branchLabel(s.branch)} · {s.collaborator_name ?? "—"}
              </div>
            </div>
            <div className="text-xs text-muted-foreground shrink-0">{s.count} prod.</div>
          </button>
        ))}
        {!isLoading && sessions.length === 0 && (
          <div className="py-8 text-center text-xs text-muted-foreground">Sin auditorías registradas</div>
        )}
      </div>
    </div>
  );
}
