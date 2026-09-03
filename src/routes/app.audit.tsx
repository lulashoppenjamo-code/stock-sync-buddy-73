import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState, useCallback, useMemo } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Loader2, ScanLine, Save, Search, CheckCircle2, Minus, Plus, Trash2, ClipboardList, Flag, History, WifiOff, ShieldAlert, RotateCcw, Pencil, Lock, AlertTriangle } from "lucide-react";
import { toast } from "sonner";
import { getCollaborator, useCollaborator } from "@/lib/session";
import { BarcodeScanner } from "@/components/BarcodeScanner";
import { branchLabel } from "@/lib/branches";
import { useOnline } from "@/hooks/use-online";
import { enqueue } from "@/lib/offline-queue";

export const Route = createFileRoute("/app/audit")({
  component: AuditPage,
});

type Product = {
  barcode: string;
  product_name: string;
  category: string | null;
  stock_a: number;
  stock_b: number;
  price: number;
};

type CountEntry = {
  barcode: string;
  product_name: string;
  count: number;
  system_stock: number;
};

type HistoryRow = {
  id: string;
  category: string;
  branch: "A" | "B";
  session_id: string;
  barcode: string;
  product_name: string;
  system_stock: number;
  counted_quantity: number;
  created_at: string;
};

type AdminAction =
  | { type: "reset"; category: string; branch: "A" | "B" }
  | { type: "resetRealtime"; category: string; branch: "A" | "B" }
  | { type: "deleteRow"; row: HistoryRow }
  | { type: "editRow"; row: HistoryRow; newQty: number };

// ── localStorage ───────────────────────────────────────────────────────
const CAT_KEY = "inv.audit.category.v2";
function loadCatState(): { category: string; branch: "A" | "B"; counts: [string, CountEntry][] } | null {
  try { const r = localStorage.getItem(CAT_KEY); return r ? JSON.parse(r) : null; } catch { return null; }
}
function saveCatState(category: string, branch: "A" | "B", counts: Map<string, CountEntry>) {
  try { localStorage.setItem(CAT_KEY, JSON.stringify({ category, branch, counts: Array.from(counts.entries()) })); } catch { }
}
function clearCatState() { try { localStorage.removeItem(CAT_KEY); } catch { } }

function startOfTodayIso() {
  const d = new Date(); d.setHours(0, 0, 0, 0); return d.toISOString();
}

function monthRange() {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0);
  const end = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);
  return { start, end, startIso: start.toISOString(), endIso: end.toISOString() };
}
function monthLabel() {
  const { start, end } = monthRange();
  const fmt = (d: Date) => d.toLocaleDateString("es-MX", { day: "numeric", month: "long" });
  return `${fmt(start)} al ${fmt(end)}`;
}

function stockColor(stock: number): string {
  if (stock < 0) return "text-red-600 dark:text-red-400";
  if (stock === 0) return "text-amber-500 dark:text-amber-400";
  return "";
}

function AuditPage() {
  const online = useOnline();
  const _saved = useMemo(() => loadCatState(), []);
  const me = useCollaborator();

  // ── Sucursal asignada al colaborador ──────────────────────────────────
  // Admin puede cambiarla; colaboradoras normales tienen la suya fija
  const [collabBranch, setCollabBranch] = useState<"A" | "B" | null>(null);

  const { data: collabData } = useQuery({
    queryKey: ["collab-branch", me?.id],
    enabled: !!me?.id,
    staleTime: 60_000,
    queryFn: async () => {
      const { data } = await supabase
        .from("collaborators")
        .select("branch")
        .eq("id", me!.id)
        .maybeSingle();
      return data as { branch: string } | null;
    },
  });

  // Determinar la sucursal del colaborador logueado
  const myBranch = useMemo((): "A" | "B" => {
    if (me?.is_admin) return collabBranch ?? "A"; // Admin puede elegir
    const b = collabData?.branch;
    if (b === "B") return "B";
    return "A"; // Default Mina
  }, [me, collabData, collabBranch]);

  const [category, setCategory] = useState(_saved?.category ?? "");
  // branch siempre refleja la sucursal del colaborador (no editable para no-admin)
  const branch: "A" | "B" = myBranch;

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

  const [unscannedDialog, setUnscannedDialog] = useState(false);
  const [unscannedProducts, setUnscannedProducts] = useState<Product[]>([]);
  const [closeDialog, setCloseDialog] = useState(false);
  const [closing, setClosing] = useState(false);

  const rowRefs = useRef<Map<string, HTMLDivElement | null>>(new Map());
  const [highlightBarcode, setHighlightBarcode] = useState<string | null>(null);
  const highlightTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  function flashProduct(barcode: string) {
    rowRefs.current.get(barcode)?.scrollIntoView({ behavior: "smooth", block: "center" });
    setHighlightBarcode(barcode);
    if (highlightTimer.current) clearTimeout(highlightTimer.current);
    highlightTimer.current = setTimeout(() => setHighlightBarcode(null), 2000);
  }

  useEffect(() => {
    if (category) saveCatState(category, branch, counts);
  }, [counts, category, branch]);

  const [adminAction, setAdminAction] = useState<AdminAction | null>(null);
  const [adminPin, setAdminPin] = useState("");
  const [adminBusy, setAdminBusy] = useState(false);
  const [reportCategory, setReportCategory] = useState<string | null>(null);

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
    staleTime: online ? 30_000 : Infinity,
  });

  // Total de artículos (SKUs) por categoría — para mostrar debajo de cada categoría
  const { data: categoryCounts = new Map<string, number>() } = useQuery({
    queryKey: ["category-counts"],
    queryFn: async () => {
      const counts = new Map<string, number>();
      const pageSize = 1000;
      let from = 0;
      while (true) {
        const { data, error } = await supabase
          .from("products").select("category")
          .not("category", "is", null).not("category", "eq", "")
          .range(from, from + pageSize - 1);
        if (error) throw error;
        for (const r of data ?? []) {
          if (!r.category) continue;
          const key = r.category.trim();
          counts.set(key, (counts.get(key) ?? 0) + 1);
        }
        if ((data ?? []).length < pageSize) break;
        from += pageSize;
      }
      return counts;
    },
    staleTime: online ? 30_000 : Infinity,
  });

  const { data: monthlyHistory = [] } = useQuery({
    queryKey: ["audit-history-month"],
    staleTime: online ? 30_000 : Infinity,
    queryFn: async () => {
      const { startIso, endIso } = monthRange();
      const { data, error } = await supabase
        .from("audit_history")
        .select("id, category, branch, session_id, barcode, product_name, system_stock, counted_quantity, created_at")
        .gte("created_at", startIso)
        .lte("created_at", endIso)
        .order("created_at", { ascending: true });
      if (error) throw error;
      return data as HistoryRow[];
    },
  });

  const categoryStatus = useMemo(() => {
    const map = new Map<string, { hasA: boolean; hasB: boolean }>();
    for (const row of monthlyHistory) {
      const entry = map.get(row.category) ?? { hasA: false, hasB: false };
      if (row.branch === "A") entry.hasA = true;
      if (row.branch === "B") entry.hasB = true;
      map.set(row.category, entry);
    }
    return map;
  }, [monthlyHistory]);

  const { data: products = [] } = useQuery({
    queryKey: ["cat-products", category],
    enabled: !!category,
    staleTime: online ? 30_000 : Infinity,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("products")
        .select("barcode, product_name, category, stock_a, stock_b, price")
        .eq("category", category)
        .order("product_name");
      if (error) throw error;
      return data as Product[];
    },
  });

  const { data: realtimeAudits = [] } = useQuery({
    queryKey: ["audits-realtime", category],
    enabled: !!category && products.length > 0 && online,
    refetchInterval: online ? 5_000 : false,
    queryFn: async () => {
      const barcodes = products.map((p) => p.barcode);
      if (!barcodes.length) return [];
      const { data, error } = await supabase
        .from("audits")
        .select("barcode, physical_count, collaborator_name, branch, created_at")
        .in("barcode", barcodes)
        .gte("created_at", startOfTodayIso())
        .order("created_at", { ascending: true });
      if (error) throw error;
      return data as Array<{ barcode: string; physical_count: number; collaborator_name: string | null; branch: string; created_at: string }>;
    },
  });

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

  const realtimeMina = useMemo(() => {
    const map = new Map<string, number>();
    for (const a of realtimeAudits) {
      if (a.branch === "A") map.set(a.barcode, (map.get(a.barcode) ?? 0) + Number(a.physical_count));
    }
    return map;
  }, [realtimeAudits]);

  const realtimeMorelos = useMemo(() => {
    const map = new Map<string, number>();
    for (const a of realtimeAudits) {
      if (a.branch === "B") map.set(a.barcode, (map.get(a.barcode) ?? 0) + Number(a.physical_count));
    }
    return map;
  }, [realtimeAudits]);

  const minaDone = realtimeMina.size > 0;
  const morelosDone = realtimeMorelos.size > 0;
  const bothDone = minaDone && morelosDone;

  const alreadyCountedThisMonth = category
    ? (branch === "A" ? categoryStatus.get(category)?.hasA : categoryStatus.get(category)?.hasB) ?? false
    : false;

  async function lookupProduct(barcode: string): Promise<Product | null> {
    const local = products.find((p) => p.barcode === barcode);
    if (local) return local;
    if (!online) { toast.error(`Producto no encontrado localmente: ${barcode}`); return null; }
    const { data, error } = await supabase
      .from("products").select("barcode, product_name, category, stock_a, stock_b, price")
      .eq("barcode", barcode).maybeSingle();
    if (error || !data) { toast.error(`Producto no encontrado: ${barcode}`); return null; }
    return data as Product;
  }

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
      newMap.set(code, { barcode: code, product_name: prod.product_name, count: (existing?.count ?? 0) + 1, system_stock: sys });
      return newMap;
    });
    toast.success(`+1 · ${prod.product_name}`);
    setScanInput("");
    scanRef.current?.focus();
    flashProduct(code);
  }, [products, category, online]);

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

  function getUnscanned(): Product[] {
    return products.filter((p) => {
      const sys = Number(p.stock_a) + Number(p.stock_b);
      return sys > 0 && !counts.has(p.barcode) && !realtimeSums.has(p.barcode);
    });
  }

  async function saveCount() {
    if (counts.size === 0) return toast.error("No hay productos contados");
    const collab = getCollaborator();
    if (!collab) return toast.error("Sesión expirada");
    const unscanned = getUnscanned();
    if (unscanned.length > 0) {
      setUnscannedProducts(unscanned);
      setUnscannedDialog(true);
      return;
    }
    await doSave(counts);
  }

  async function doSave(countsToSave: Map<string, CountEntry>) {
    const collab = getCollaborator();
    if (!collab) return;
    setSaving(true);
    try {
      const sessionId = crypto.randomUUID();
      const rows = Array.from(countsToSave.values()).map((c) => ({
        branch, // siempre la sucursal del colaborador
        barcode: c.barcode,
        product_name: c.product_name,
        system_stock: c.system_stock,
        physical_count: c.count,
        difference: c.count - c.system_stock,
        collaborator_id: collab.id,
        collaborator_name: collab.name,
        client_uid: `audit-${sessionId}-${c.barcode}`,
      }));

      if (online) {
        const { error } = await supabase.from("audits").insert(rows);
        if (error) throw error;
        toast.success(`Conteo guardado — ${rows.length} productos`);
      } else {
        for (const row of rows) {
          await enqueue({ kind: "audit", uid: row.client_uid, createdAt: Date.now(), payload: row });
        }
        toast.success(`Sin internet — ${rows.length} productos guardados localmente.`);
      }

      setSummaryData(Array.from(countsToSave.values()));
      setCounts(new Map());
      clearCatState();
      setUnscannedDialog(false);
      if (online) {
        qc.invalidateQueries({ queryKey: ["audits"] });
        qc.invalidateQueries({ queryKey: ["audits-realtime", category] });
      }
    } catch (e) { toast.error((e as Error).message); }
    finally { setSaving(false); }
  }

  async function saveWithZeros() {
    const newCounts = new Map(counts);
    for (const p of unscannedProducts) {
      const sys = Number(p.stock_a) + Number(p.stock_b);
      newCounts.set(p.barcode, { barcode: p.barcode, product_name: p.product_name, count: 0, system_stock: sys });
    }
    setCounts(newCounts);
    setUnscannedDialog(false);
    await doSave(newCounts);
  }

  async function finalizeCount() {
    if (counts.size === 0) return toast.error("No hay productos contados");
    const collab = getCollaborator();
    if (!collab) return toast.error("Sesión expirada");
    if (alreadyCountedThisMonth) {
      return toast.error(`"${category}" ya se contó este mes en ${branchLabel(branch)}. Solo se permite 1 conteo por mes.`);
    }
    if (!confirm(`Finalizar conteo de "${category}"? Se guardará el resumen y se cerrará esta sesión.`)) return;
    setFinalizing(true);
    try {
      const sessionId = crypto.randomUUID();
      const snapshot = Array.from(counts.values());
      const rows = snapshot.map((c) => ({
        session_id: sessionId, category, branch,
        barcode: c.barcode, product_name: c.product_name,
        system_stock: c.system_stock, counted_quantity: c.count,
        difference: c.count - c.system_stock,
        collaborator_id: collab.id, collaborator_name: collab.name,
      }));

      if (online) {
        const { error } = await supabase.from("audit_history").insert(rows);
        if (error) throw error;
        toast.success("Conteo finalizado y guardado en historial");
      } else {
        const pendingKey = `inv.pending.finalize.${sessionId}`;
        localStorage.setItem(pendingKey, JSON.stringify({ rows, savedAt: Date.now() }));
        toast.success("Sin internet — conteo guardado localmente.");
      }

      setSummaryData(snapshot);
      setSummaryFinal(true);
      setCounts(new Map());
      clearCatState();
      if (online) {
        qc.invalidateQueries({ queryKey: ["audit_history"] });
        qc.invalidateQueries({ queryKey: ["audit-history-month"] });
      }
    } catch (e) { toast.error("No se pudo guardar: " + (e as Error).message); }
    finally { setFinalizing(false); }
  }

  async function confirmClose() {
    const collab = getCollaborator();
    if (!collab) return;
    setClosing(true);
    try {
      const sessionId = crypto.randomUUID();
      const closedAt = new Date().toISOString();

      // Detalle de quién contó y cuándo, por producto (de los escaneos en vivo de hoy)
      const detailsByBarcode = new Map<string, { name: string; branch: string; qty: number; at: string }[]>();
      for (const a of realtimeAudits) {
        const list = detailsByBarcode.get(a.barcode) ?? [];
        list.push({
          name: a.collaborator_name ?? "Anónimo",
          branch: branchLabel(a.branch),
          qty: Number(a.physical_count),
          at: a.created_at,
        });
        detailsByBarcode.set(a.barcode, list);
      }

      const reportRows = products.map((p) => {
        const sys = Number(p.stock_a) + Number(p.stock_b);
        const minaCount = realtimeMina.get(p.barcode) ?? 0;
        const morelosCount = realtimeMorelos.get(p.barcode) ?? 0;
        const price = Number(p.price) || 0;
        const diff = (minaCount + morelosCount) - sys;
        const details = (detailsByBarcode.get(p.barcode) ?? []).sort((a, b) => a.at.localeCompare(b.at));
        const last = details[details.length - 1];
        return {
          session_id: sessionId, category,
          barcode: p.barcode, product_name: p.product_name,
          system_stock: sys,
          mina_count: minaCount, morelos_count: morelosCount,
          total_counted: minaCount + morelosCount,
          difference: diff,
          unit_price: price,
          difference_value: diff * price,
          scanned_mina: realtimeMina.has(p.barcode),
          scanned_morelos: realtimeMorelos.has(p.barcode),
          closed_by: collab.name, closed_at: closedAt,
          count_details: details,
          last_counted_by: last?.name ?? null,
          last_counted_at: last?.at ?? null,
        };
      });

      // Insertar en audit_history para Mina (A) y Morelos (B)
      // Esto marca la categoría en verde en el corte mensual
      // El stock del sistema es consolidado (total), así que la diferencia real
      // solo tiene sentido contra la suma de ambas sucursales. Para no reportar
      // falsos faltantes por sucursal, cada renglón guarda su conteo y la
      // diferencia total del producto (Mina + Morelos vs sistema).
      const historyRowsMina = products.map((p) => {
        const sys = Number(p.stock_a) + Number(p.stock_b);
        const total = (realtimeMina.get(p.barcode) ?? 0) + (realtimeMorelos.get(p.barcode) ?? 0);
        return {
          session_id: sessionId,
          category,
          branch: "A" as const,
          barcode: p.barcode,
          product_name: p.product_name,
          system_stock: sys,
          counted_quantity: realtimeMina.get(p.barcode) ?? 0,
          difference: total - sys,
          collaborator_id: collab.id,
          collaborator_name: collab.name,
        };
      });
      const historyRowsMorelos = products.map((p) => {
        const sys = Number(p.stock_a) + Number(p.stock_b);
        const total = (realtimeMina.get(p.barcode) ?? 0) + (realtimeMorelos.get(p.barcode) ?? 0);
        return {
          session_id: sessionId,
          category,
          branch: "B" as const,
          barcode: p.barcode,
          product_name: p.product_name,
          system_stock: sys,
          counted_quantity: realtimeMorelos.get(p.barcode) ?? 0,
          difference: total - sys,
          collaborator_id: collab.id,
          collaborator_name: collab.name,
        };
      });

      if (online) {
        // Save closed_counts report
        const { error: e1 } = await supabase.from("closed_counts").insert(reportRows);
        if (e1) throw e1;
        // Save audit_history for both branches → marks category green in monthly view
        const { error: e2 } = await supabase.from("audit_history").insert([...historyRowsMina, ...historyRowsMorelos]);
        if (e2) throw e2;
      }

      toast.success(`Categoría "${category}" finalizada ✓ — ya aparece en verde en el corte mensual`);
      setCloseDialog(false);
      if (online) {
        qc.invalidateQueries({ queryKey: ["closed_counts"] });
        qc.invalidateQueries({ queryKey: ["audit-history-month"] });
        qc.invalidateQueries({ queryKey: ["audits-realtime", category] });
      }
    } catch (e) { toast.error("Error al finalizar: " + (e as Error).message); }
    finally { setClosing(false); }
  }

  async function confirmAdminAction() {
    if (!me) return;
    if (adminPin.length < 4) { toast.error("Ingresá tu PIN de administrador"); return; }
    if (!adminAction) return;
    setAdminBusy(true);
    try {
      if (adminAction.type === "reset") {
        const { data, error } = await supabase.rpc("admin_reset_audit_category", {
          p_admin_id: me.id, p_admin_pin: adminPin,
          p_category: adminAction.category, p_branch: adminAction.branch,
        });
        if (error) throw error;
        toast.success(`Conteo reiniciado — ${data ?? 0} registros eliminados.`);
        if (category === adminAction.category && branch === adminAction.branch) {
          setCounts(new Map()); clearCatState();
        }
      } else if (adminAction.type === "resetRealtime") {
        const barcodes = products.map((p) => p.barcode);
        const { data, error } = await supabase.rpc("admin_reset_realtime_audits", {
          p_admin_id: me.id, p_admin_pin: adminPin,
          p_branch: adminAction.branch, p_barcodes: barcodes, p_since: startOfTodayIso(),
        });
        if (error) throw error;
        toast.success(`Conteos en vivo reiniciados — ${data ?? 0} registros eliminados.`);
        qc.invalidateQueries({ queryKey: ["audits-realtime", adminAction.category] });
      } else if (adminAction.type === "deleteRow") {
        const { error } = await supabase.rpc("admin_delete_audit_history_row", {
          p_admin_id: me.id, p_admin_pin: adminPin, p_row_id: adminAction.row.id,
        });
        if (error) throw error;
        toast.success("Registro eliminado");
      } else if (adminAction.type === "editRow") {
        const { error } = await supabase.rpc("admin_update_audit_history_row", {
          p_admin_id: me.id, p_admin_pin: adminPin,
          p_row_id: adminAction.row.id, p_counted_quantity: adminAction.newQty,
        });
        if (error) throw error;
        toast.success("Cantidad actualizada");
      }
      setAdminAction(null); setAdminPin("");
      qc.invalidateQueries({ queryKey: ["audit-history-month"] });
    } catch (e) { toast.error((e as Error).message); }
    finally { setAdminBusy(false); }
  }

  function buildCategoryReport(cat: string) {
    const rows = monthlyHistory.filter((r) => r.category === cat);
    const merged = new Map<string, { barcode: string; product_name: string; system_stock: number; counted: number }>();
    for (const r of rows) {
      const e = merged.get(r.barcode) ?? { barcode: r.barcode, product_name: r.product_name, system_stock: r.system_stock, counted: 0 };
      e.counted += Number(r.counted_quantity);
      merged.set(r.barcode, e);
    }
    return Array.from(merged.values());
  }

  const filteredProducts = useMemo(() =>
    nameSearch.trim().length >= 2
      ? products.filter((p) => p.product_name.toLowerCase().includes(nameSearch.toLowerCase()))
      : products,
    [products, nameSearch]
  );

  const totalCounted = useMemo(() =>
    Array.from(counts.values()).reduce((s, c) => s + c.count, 0), [counts]
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
        {!online && (
          <span className="flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800 dark:bg-amber-900/40 dark:text-amber-200">
            <WifiOff className="h-3 w-3" /> Sin internet
          </span>
        )}
        <Link to="/app/audit-history" className="flex items-center gap-1 rounded-md border px-2 py-1 text-xs hover:bg-muted">
          <History className="h-3.5 w-3.5" /> Historial
        </Link>
      </div>

      {!online && (
        <div className="flex items-start gap-2 rounded-md border border-amber-300 bg-amber-50 dark:bg-amber-950/30 px-3 py-2 text-xs text-amber-800 dark:text-amber-200">
          <WifiOff className="h-4 w-4 mt-0.5 shrink-0" />
          <div>
            <p className="font-medium">Modo sin conexión</p>
            <p className="mt-0.5">Podés seguir contando. Los conteos se guardarán en este dispositivo y se sincronizarán automáticamente cuando vuelva el internet.</p>
          </div>
        </div>
      )}

      {/* ── Corte mensual ── */}
      <Card>
        <CardContent className="p-3 space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-muted-foreground">Corte mensual por categoría</span>
            <span className="text-[10px] text-muted-foreground">{monthLabel()}</span>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {categories.map((c) => {
              const st = categoryStatus.get(c);
              const done = !!st?.hasA && !!st?.hasB;
              const partial = !done && (!!st?.hasA || !!st?.hasB);
              const total = categoryCounts.get(c) ?? 0;
              return (
                <button key={c} type="button" onClick={() => setReportCategory(c)} disabled={!st}
                  className={`flex flex-col items-center rounded-md border px-2.5 py-1 text-[11px] font-medium leading-tight transition-colors ${
                    done ? "border-emerald-500 bg-emerald-500 text-white"
                    : partial ? "border-amber-300 bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-200"
                    : "border-transparent bg-muted text-muted-foreground"
                  }`}>
                  <span>{c}{done ? " ✓" : partial ? " ½" : ""}</span>
                  <span className={`text-[9px] font-normal ${done ? "text-emerald-50" : "opacity-70"}`}>
                    {total} artículo{total === 1 ? "" : "s"}
                  </span>
                </button>
              );
            })}
            {categories.length === 0 && <span className="text-xs text-muted-foreground">Sin categorías aún</span>}
          </div>
        </CardContent>
      </Card>

      {/* ── Category + Branch selector ── */}
      <Card>
        <CardContent className="p-3 space-y-3">
          <div className="flex flex-wrap gap-3">
            <div className="flex-1 min-w-0">
              <label className="text-xs font-medium text-muted-foreground">Categoría</label>
              <select value={category} onChange={(e) => changeCategory(e.target.value)}
                className="mt-1 h-9 w-full rounded-md border bg-background px-2 text-sm">
                <option value="">Elegir categoría…</option>
                {categories.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
            <div className="shrink-0">
              <label className="text-xs font-medium text-muted-foreground">Sucursal</label>
              {me?.is_admin ? (
                // Admin puede cambiar sucursal
                <div className="mt-1 inline-flex overflow-hidden rounded-md border">
                  {(["A", "B"] as const).map((b) => (
                    <button key={b} type="button" onClick={() => setCollabBranch(b)}
                      className={`px-4 py-1.5 text-sm font-medium transition-colors ${branch === b ? "bg-primary text-primary-foreground" : "bg-background hover:bg-muted"}`}>
                      {b === "A" ? "Mina" : "Morelos"}
                    </button>
                  ))}
                </div>
              ) : (
                // Colaboradora normal: sucursal fija, solo visual
                <div className="mt-1 inline-flex overflow-hidden rounded-md border">
                  <div className="bg-primary text-primary-foreground px-4 py-1.5 text-sm font-medium">
                    {branch === "A" ? "Mina" : "Morelos"}
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Indicador de sucursal asignada para colaboradoras */}
          {!me?.is_admin && (
            <p className="text-[11px] text-muted-foreground">
              Estás contando para <strong>{branch === "A" ? "Sucursal Mina" : "Sucursal Morelos"}</strong>.
              Solo podés guardar conteos de tu sucursal.
            </p>
          )}

          {/* Estado sucursales del día */}
          {category && (
            <div className="flex gap-2">
              <div className={`flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${minaDone ? "bg-emerald-100 text-emerald-700" : "bg-muted text-muted-foreground"}`}>
                {minaDone ? "✓" : "○"} Mina
              </div>
              <div className={`flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${morelosDone ? "bg-emerald-100 text-emerald-700" : "bg-muted text-muted-foreground"}`}>
                {morelosDone ? "✓" : "○"} Morelos
              </div>
              {me?.is_admin && bothDone && (
                <span className="ml-auto text-xs text-emerald-600 font-medium">¡Listas para cerrar!</span>
              )}
            </div>
          )}

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

      {category && alreadyCountedThisMonth && (
        <div className="flex flex-col items-center gap-2 rounded-md border border-emerald-300 bg-emerald-50 dark:bg-emerald-950/20 py-8 text-center">
          <CheckCircle2 className="h-8 w-8 text-emerald-600" />
          <p className="text-sm font-medium text-emerald-800 dark:text-emerald-200">
            "{category}" ya se contó este mes en {branchLabel(branch)}
          </p>
          <p className="text-xs text-muted-foreground max-w-xs">
            Solo se permite un conteo por categoría al mes ({monthLabel()}).
          </p>
          <div className="flex gap-2">
            <Button size="sm" variant="outline" onClick={() => setReportCategory(category)}>Ver reporte</Button>
            {me?.is_admin && (
              <Button size="sm" variant="outline"
                className="border-amber-400 text-amber-700 hover:bg-amber-50 dark:text-amber-300"
                onClick={() => setAdminAction({ type: "reset", category, branch })}>
                <RotateCcw className="h-4 w-4" /> Reiniciar (admin)
              </Button>
            )}
          </div>
        </div>
      )}

      {category && !alreadyCountedThisMonth && (
        <>
          <Card>
            <CardContent className="p-3 space-y-2">
              <label className="text-xs font-medium text-muted-foreground">Pistolá un producto para sumar +1</label>
              <div className="flex gap-2">
                <Input ref={scanRef} autoFocus value={scanInput}
                  onChange={(e) => setScanInput(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addCount(scanInput); } }}
                  placeholder="Código de barras…" className="font-mono" inputMode="numeric" />
                <Button type="button" variant="outline" onClick={() => setScanning(true)}>
                  <ScanLine className="h-4 w-4" />
                </Button>
              </div>
              <div className="relative">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input value={nameSearch} onChange={(e) => setNameSearch(e.target.value)}
                  placeholder="O buscar por nombre…" className="pl-9" />
              </div>
              {nameSearch.trim().length >= 2 && (
                <div className="max-h-40 overflow-auto rounded-md border bg-card">
                  {filteredProducts.map((p) => {
                    const sys = Number(p.stock_a) + Number(p.stock_b);
                    return (
                      <button key={p.barcode} type="button"
                        onClick={() => { addCount(p.barcode); setNameSearch(""); }}
                        className="flex w-full items-center justify-between border-b px-3 py-2 text-left text-sm last:border-b-0 hover:bg-muted">
                        <span className="truncate font-medium">{p.product_name}</span>
                        <span className={`ml-2 shrink-0 text-xs ${stockColor(sys)}`}>Sys: {sys}</span>
                      </button>
                    );
                  })}
                  {filteredProducts.length === 0 && <div className="p-3 text-xs text-muted-foreground">Sin resultados</div>}
                </div>
              )}
            </CardContent>
          </Card>

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
            <p className="px-1 text-[11px] text-muted-foreground">Tocá el número para escribir la cantidad directamente.</p>

            {me?.is_admin && (
              <div className="flex flex-wrap items-center gap-2 rounded-md border border-amber-300 bg-amber-50/60 px-2 py-1.5 dark:bg-amber-950/10">
                <span className="flex items-center gap-1 text-[11px] font-medium text-amber-800 dark:text-amber-300">
                  <ShieldAlert className="h-3.5 w-3.5" /> Admin — reiniciar conteos de hoy:
                </span>
                {(["A", "B"] as const).map((b) => (
                  <Button key={b} size="sm" variant="outline"
                    className="h-7 border-amber-400 px-2 text-[11px] text-amber-700 hover:bg-amber-100 dark:text-amber-300"
                    onClick={() => setAdminAction({ type: "resetRealtime", category, branch: b })}>
                    <RotateCcw className="h-3.5 w-3.5" /> {branchLabel(b)}
                  </Button>
                ))}
              </div>
            )}

            <div className="divide-y rounded-md border">
              {products.map((p) => {
                const entry = counts.get(p.barcode);
                const sys = Number(p.stock_a) + Number(p.stock_b);
                const rt = realtimeSums.get(p.barcode);
                const myCount = entry?.count ?? 0;
                const savedToday = rt?.total ?? 0;
                const grandTotal = myCount + savedToday;
                const diff = grandTotal - sys;
                const isCounted = myCount > 0;

                return (
                  <div key={p.barcode}
                    ref={(el) => { rowRefs.current.set(p.barcode, el); }}
                    className={`scroll-mt-24 px-3 py-2.5 text-xs transition-colors ${isCounted ? "bg-emerald-50 dark:bg-emerald-950/20" : ""} ${highlightBarcode === p.barcode ? "ring-2 ring-inset ring-blue-500 bg-blue-50 dark:bg-blue-950/30" : ""}`}>
                    <div className="flex items-start gap-2">
                      <div className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2 ${isCounted ? "border-emerald-500 bg-emerald-500 text-white" : "border-muted-foreground/40"}`}>
                        {isCounted && <CheckCircle2 className="h-3 w-3" />}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className={`font-medium leading-snug ${isCounted ? "" : "text-muted-foreground"}`}>{p.product_name}</div>
                        <div className="flex items-center gap-2 font-mono text-muted-foreground">
                          <span>{p.barcode}</span>
                          <span className={`font-semibold ${stockColor(sys)}`}>
                            {sys < 0 ? `⚠ ${sys}` : sys === 0 ? "● 0" : ""}
                          </span>
                        </div>
                        {rt && rt.byUser.size > 0 && (
                          <div className="mt-1 space-y-0.5">
                            {Array.from(rt.byUser.entries()).map(([user, qty]) => (
                              <div key={user} className="text-[10px] text-blue-600 dark:text-blue-400">
                                {user}: {qty} unid. (guardado)
                              </div>
                            ))}
                          </div>
                        )}
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
                      <div className="flex items-center gap-1 shrink-0">
                        <button type="button" onClick={() => setCount(p.barcode, myCount - 1)} disabled={myCount === 0}
                          className="flex h-7 w-7 items-center justify-center rounded-full border font-bold disabled:opacity-25 hover:bg-muted active:scale-95">
                          <Minus className="h-3 w-3" />
                        </button>
                        <input type="number" inputMode="numeric" min={0}
                          value={myCount === 0 ? "" : myCount} placeholder="0"
                          onFocus={(e) => e.target.select()}
                          onChange={(e) => {
                            const raw = e.target.value;
                            const n = raw === "" ? 0 : Math.max(0, parseInt(raw, 10) || 0);
                            setCount(p.barcode, n);
                          }}
                          className={`w-9 rounded border border-input bg-transparent text-center text-sm tabular-nums font-bold focus:outline-none focus:ring-2 focus:ring-primary ${isCounted ? "text-emerald-700" : "text-muted-foreground"}`}
                        />
                        <button type="button" onClick={() => addCount(p.barcode)}
                          className="flex h-7 w-7 items-center justify-center rounded-full border font-bold hover:bg-muted active:scale-95">
                          <Plus className="h-3 w-3" />
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })}
              {products.length === 0 && (
                <div className="py-8 text-center text-xs text-muted-foreground">
                  {online ? <><Loader2 className="mx-auto mb-2 h-4 w-4 animate-spin" />Cargando productos…</>
                  : <><WifiOff className="mx-auto mb-2 h-4 w-4" />Sin conexión — productos desde caché</>}
                </div>
              )}
            </div>

            {counts.size > 0 && (
              <div className="mt-2 grid grid-cols-1 gap-2">
                {/* Guardar parcial — visible para todos */}
                <Button onClick={saveCount} disabled={saving || finalizing} variant="outline" className="w-full">
                  {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                  {online ? `Guardar parcial (${counts.size})` : `Guardar offline (${counts.size})`}
                </Button>
                {/* Finalizar conteo — solo admin, solo cuando ambas sucursales tienen conteos */}
                {me?.is_admin && bothDone && (
                  <Button onClick={finalizeCount} disabled={saving || finalizing} className="w-full">
                    {finalizing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Flag className="h-4 w-4" />}
                    Finalizar conteo (Mina + Morelos)
                  </Button>
                )}
                {me?.is_admin && !bothDone && (
                  <div className="rounded-md border border-dashed px-3 py-2 text-xs text-muted-foreground text-center">
                    <Flag className="inline h-3.5 w-3.5 mr-1" />
                    Finalizar disponible cuando Mina y Morelos tengan conteos del día.
                    {!minaDone && " Falta: Mina."}{!morelosDone && " Falta: Morelos."}
                  </div>
                )}
              </div>
            )}

            {/* ── Finalizar conteo — solo admin, solo cuando ambas sucursales tienen conteos ── */}
            {me?.is_admin && category && bothDone && (
              <div className="mt-3 rounded-md border border-emerald-300 bg-emerald-50 dark:bg-emerald-950/20 p-3">
                <div className="mb-2 flex items-center gap-2 text-xs font-medium text-emerald-700 dark:text-emerald-300">
                  <Flag className="h-3.5 w-3.5" /> Finalizar conteo — Solo administrador
                </div>
                <p className="mb-3 text-xs text-muted-foreground">
                  Mina ✓ y Morelos ✓ tienen conteos de hoy. Al finalizar, "{category}" quedará marcada como contada este mes.
                </p>
                <Button onClick={() => setCloseDialog(true)} className="w-full bg-emerald-600 hover:bg-emerald-700">
                  <Flag className="h-4 w-4" /> Finalizar conteo de "{category}"
                </Button>
              </div>
            )}
            {me?.is_admin && category && !bothDone && (
              <div className="mt-2 rounded-md border border-dashed px-3 py-2 text-xs text-muted-foreground">
                <Flag className="mb-1 h-3.5 w-3.5 inline mr-1" />
                Finalizar disponible cuando Mina y Morelos tengan conteos del día.
                {!minaDone && " Falta: Mina."}{!morelosDone && " Falta: Morelos."}
              </div>
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

      {/* ── Dialog: productos no escaneados ── */}
      <Dialog open={unscannedDialog} onOpenChange={setUnscannedDialog}>
        <DialogContent className="max-h-[90vh] max-w-md overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-amber-500" />
              {unscannedProducts.length} productos con stock no escaneados
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3 text-sm">
            <p className="text-xs text-muted-foreground">
              Estos productos tienen existencias en sistema pero no fueron escaneados. ¿Los incluís como <strong>conteo = 0 (FALTA)</strong> o ignorás?
            </p>
            <div className="max-h-48 divide-y overflow-auto rounded-md border">
              {unscannedProducts.map((p) => {
                const sys = Number(p.stock_a) + Number(p.stock_b);
                return (
                  <div key={p.barcode} className="flex items-center justify-between px-3 py-2 text-xs">
                    <div>
                      <div className="font-medium">{p.product_name}</div>
                      <div className="font-mono text-muted-foreground">{p.barcode}</div>
                    </div>
                    <div className="text-right">
                      <div className="text-muted-foreground">Sistema: {sys}</div>
                      <div className="font-bold text-red-600">-{sys} FALTA</div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
          <DialogFooter className="flex-col gap-2 sm:flex-row">
            <Button variant="outline" onClick={() => doSave(counts)} disabled={saving} className="w-full sm:w-auto">
              Ignorar — guardar solo lo escaneado
            </Button>
            <Button onClick={saveWithZeros} disabled={saving} className="w-full sm:w-auto">
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              Incluir como 0 (FALTA)
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Dialog: cierre de conteo admin ── */}
      <Dialog open={closeDialog} onOpenChange={(o) => { if (!o && !closing) setCloseDialog(false); }}>
        <DialogContent className="max-h-[90vh] max-w-lg overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Flag className="h-5 w-5 text-emerald-600" /> Finalizar conteo — {category}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 text-sm">
            <div className="grid grid-cols-2 gap-2">
              <div className="rounded-md border p-2 text-center">
                <div className="text-xs font-medium text-muted-foreground mb-1">✓ Mina</div>
                <div className="text-lg font-bold text-emerald-700">{realtimeMina.size} escaneados</div>
              </div>
              <div className="rounded-md border p-2 text-center">
                <div className="text-xs font-medium text-muted-foreground mb-1">✓ Morelos</div>
                <div className="text-lg font-bold text-emerald-700">{realtimeMorelos.size} escaneados</div>
              </div>
            </div>
            <div>
              <p className="text-xs font-medium mb-1">Diferencias detectadas:</p>
              <div className="max-h-48 divide-y overflow-auto rounded-md border">
                {products.filter((p) => {
                  const sys = Number(p.stock_a) + Number(p.stock_b);
                  const total = (realtimeMina.get(p.barcode) ?? 0) + (realtimeMorelos.get(p.barcode) ?? 0);
                  return total !== sys;
                }).map((p) => {
                  const sys = Number(p.stock_a) + Number(p.stock_b);
                  const minaC = realtimeMina.get(p.barcode) ?? 0;
                  const morelosC = realtimeMorelos.get(p.barcode) ?? 0;
                  const total = minaC + morelosC;
                  const diff = total - sys;
                  return (
                    <div key={p.barcode} className={`px-3 py-2 text-xs ${diff < 0 ? "bg-red-50" : "bg-amber-50"}`}>
                      <div className="flex items-center justify-between">
                        <span className="font-medium truncate flex-1">{p.product_name}</span>
                        <span className={`font-bold ml-2 ${diff < 0 ? "text-red-600" : "text-amber-600"}`}>
                          {diff > 0 ? `+${diff}` : diff}
                        </span>
                      </div>
                      <div className="text-muted-foreground">
                        Sistema: {sys} · Mina: {minaC} · Morelos: {morelosC}
                      </div>
                    </div>
                  );
                })}
                {products.every((p) => {
                  const sys = Number(p.stock_a) + Number(p.stock_b);
                  return (realtimeMina.get(p.barcode) ?? 0) + (realtimeMorelos.get(p.barcode) ?? 0) === sys;
                }) && (
                  <div className="px-3 py-4 text-center text-xs text-emerald-600 font-medium">✓ Sin diferencias</div>
                )}
              </div>
            </div>
            <p className="text-xs text-muted-foreground">
              Al confirmar se guardará el reporte completo de "{category}" con ambas sucursales. No se puede deshacer.
            </p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCloseDialog(false)} disabled={closing}>Cancelar</Button>
            <Button onClick={confirmClose} disabled={closing} className="bg-emerald-600 hover:bg-emerald-700">
              {closing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Flag className="h-4 w-4" />}
              Confirmar finalización
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Summary dialog ── */}
      <Dialog open={!!summaryData} onOpenChange={(o) => { if (!o) { setSummaryData(null); setSummaryFinal(false); } }}>
        <DialogContent className="max-h-[90vh] max-w-md overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{summaryFinal ? "Conteo finalizado" : "Resultado del conteo"} — {category}</DialogTitle>
          </DialogHeader>
          {summaryData && (
            <div className="space-y-3 text-sm">
              <div className="grid grid-cols-3 gap-2">
                <div className="rounded-md bg-emerald-50 dark:bg-emerald-950/20 p-2 text-center">
                  <div className="text-[10px] text-muted-foreground">Sin diferencia</div>
                  <div className="text-lg font-bold text-emerald-700">{summaryData.filter((r) => r.count === r.system_stock).length}</div>
                </div>
                <div className="rounded-md bg-red-50 dark:bg-red-950/20 p-2 text-center">
                  <div className="text-[10px] text-muted-foreground">Faltantes</div>
                  <div className="text-lg font-bold text-red-600">{summaryData.filter((r) => r.count < r.system_stock).length}</div>
                </div>
                <div className="rounded-md bg-amber-50 dark:bg-amber-950/20 p-2 text-center">
                  <div className="text-[10px] text-muted-foreground">Sobrantes</div>
                  <div className="text-lg font-bold text-amber-600">{summaryData.filter((r) => r.count > r.system_stock).length}</div>
                </div>
              </div>
              <p className="text-xs text-muted-foreground">
                Sucursal: {branchLabel(branch)} · {summaryData.length} productos
                {!online && " · Guardado localmente (pendiente de sincronizar)"}
              </p>
              <div className="divide-y rounded-md border">
                {summaryData.sort((a, b) => (a.count - a.system_stock) - (b.count - b.system_stock)).map((r) => {
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
          <DialogFooter className="gap-2 sm:gap-0">
            {summaryFinal && online && (
              <Link to="/app/audit-history" className="inline-flex items-center justify-center gap-1 rounded-md border px-3 py-2 text-sm hover:bg-muted">
                <History className="h-4 w-4" /> Ver historial
              </Link>
            )}
            <Button onClick={() => { setSummaryData(null); setSummaryFinal(false); }}>Cerrar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Reporte mensual por categoría ── */}
      <Dialog open={!!reportCategory} onOpenChange={(o) => { if (!o) setReportCategory(null); }}>
        <DialogContent className="max-h-[90vh] max-w-md overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Reporte mensual — {reportCategory}</DialogTitle>
          </DialogHeader>
          {reportCategory && (() => {
            const rows = buildCategoryReport(reportCategory);
            const st = categoryStatus.get(reportCategory);
            const bothDoneReport = !!st?.hasA && !!st?.hasB;
            return (
              <div className="space-y-3 text-sm">
                <div className="grid grid-cols-3 gap-2">
                  <div className="rounded-md bg-emerald-50 dark:bg-emerald-950/20 p-2 text-center">
                    <div className="text-[10px] text-muted-foreground">Sin diferencia</div>
                    <div className="text-lg font-bold text-emerald-700">{rows.filter((r) => r.counted === r.system_stock).length}</div>
                  </div>
                  <div className="rounded-md bg-red-50 dark:bg-red-950/20 p-2 text-center">
                    <div className="text-[10px] text-muted-foreground">Faltantes</div>
                    <div className="text-lg font-bold text-red-600">{rows.filter((r) => r.counted < r.system_stock).length}</div>
                  </div>
                  <div className="rounded-md bg-amber-50 dark:bg-amber-950/20 p-2 text-center">
                    <div className="text-[10px] text-muted-foreground">Sobrantes</div>
                    <div className="text-lg font-bold text-amber-600">{rows.filter((r) => r.counted > r.system_stock).length}</div>
                  </div>
                </div>
                <p className="text-xs text-muted-foreground">
                  {monthLabel()} · {rows.length} productos
                  {!bothDoneReport && " · Falta contar en alguna sucursal — reporte parcial"}
                </p>
                <div className="divide-y rounded-md border">
                  {rows.sort((a, b) => (a.counted - a.system_stock) - (b.counted - b.system_stock)).map((r) => {
                    const diff = r.counted - r.system_stock;
                    return (
                      <div key={r.barcode}
                        className={`flex items-center gap-2 px-3 py-2.5 text-xs ${diff === 0 ? "bg-emerald-50 dark:bg-emerald-950/20" : diff < 0 ? "bg-red-50 dark:bg-red-950/20" : "bg-amber-50 dark:bg-amber-950/20"}`}>
                        <div className="min-w-0 flex-1">
                          <div className="font-medium truncate">{r.product_name}</div>
                          <div className="font-mono text-muted-foreground">{r.barcode}</div>
                        </div>
                        <div className="shrink-0 text-right space-y-0.5">
                          <div className="text-muted-foreground">Sys: {r.system_stock} · Contado: {r.counted}</div>
                          <div className={`font-bold ${diff === 0 ? "text-emerald-600" : diff < 0 ? "text-red-600" : "text-amber-600"}`}>
                            {diff === 0 ? "✓ Correcto" : diff > 0 ? `+${diff} SOBRA` : `${diff} FALTA`}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                  {rows.length === 0 && <div className="p-3 text-xs text-muted-foreground">Sin conteos registrados este mes.</div>}
                </div>
                {me?.is_admin && (
                  <div className="space-y-3 rounded-md border border-amber-300 bg-amber-50/60 p-3 dark:bg-amber-950/10">
                    <div className="flex items-center gap-1.5 text-xs font-semibold text-amber-800 dark:text-amber-300">
                      <ShieldAlert className="h-3.5 w-3.5" /> Panel de administrador
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {(["A", "B"] as const).map((b) => (
                        <Button key={b} size="sm" variant="outline"
                          disabled={!(b === "A" ? st?.hasA : st?.hasB)}
                          className="border-amber-400 text-amber-700 hover:bg-amber-100 dark:text-amber-300"
                          onClick={() => setAdminAction({ type: "reset", category: reportCategory!, branch: b })}>
                          <RotateCcw className="h-3.5 w-3.5" /> Reiniciar {branchLabel(b)}
                        </Button>
                      ))}
                    </div>
                    <div className="space-y-1.5">
                      <p className="text-[11px] font-medium text-muted-foreground">Registros individuales</p>
                      <div className="max-h-56 divide-y overflow-y-auto rounded-md border bg-background">
                        {monthlyHistory.filter((h) => h.category === reportCategory).map((h) => (
                          <AdminHistoryRow key={h.id} row={h}
                            onEdit={() => setAdminAction({ type: "editRow", row: h, newQty: h.counted_quantity })}
                            onDelete={() => setAdminAction({ type: "deleteRow", row: h })} />
                        ))}
                        {monthlyHistory.filter((h) => h.category === reportCategory).length === 0 && (
                          <div className="p-2 text-[11px] text-muted-foreground">Sin registros individuales.</div>
                        )}
                      </div>
                    </div>
                  </div>
                )}
              </div>
            );
          })()}
          <DialogFooter>
            <Button onClick={() => setReportCategory(null)}>Cerrar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Admin PIN dialog ── */}
      <Dialog open={!!adminAction} onOpenChange={(o) => { if (!o) { setAdminAction(null); setAdminPin(""); } }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-1.5 text-amber-700 dark:text-amber-300">
              <ShieldAlert className="h-4 w-4" />
              {adminAction?.type === "reset" && "Reiniciar conteo"}
              {adminAction?.type === "resetRealtime" && "Reiniciar conteos de hoy"}
              {adminAction?.type === "deleteRow" && "Eliminar registro"}
              {adminAction?.type === "editRow" && "Editar cantidad contada"}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3 text-sm">
            {adminAction?.type === "reset" && (
              <p className="text-muted-foreground">
                Se eliminarán todos los conteos de <strong>"{adminAction.category}"</strong> en{" "}
                <strong>{branchLabel(adminAction.branch)}</strong> registrados este mes.
              </p>
            )}
            {adminAction?.type === "resetRealtime" && (
              <p className="text-muted-foreground">
                Se eliminarán los conteos guardados hoy de <strong>"{adminAction.category}"</strong> en <strong>{branchLabel(adminAction.branch)}</strong>.
              </p>
            )}
            {adminAction?.type === "deleteRow" && (
              <p className="text-muted-foreground">
                Se eliminará el registro de <strong>{adminAction.row.product_name}</strong> ({adminAction.row.counted_quantity} unid.).
              </p>
            )}
            {adminAction?.type === "editRow" && (
              <div className="space-y-2">
                <p className="text-muted-foreground">{adminAction.row.product_name}</p>
                <Input type="number" min={0} value={adminAction.newQty}
                  onChange={(e) => setAdminAction((prev) =>
                    prev && prev.type === "editRow" ? { ...prev, newQty: Number(e.target.value) } : prev
                  )} />
              </div>
            )}
            <div>
              <label className="text-xs font-medium text-muted-foreground">Tu PIN de administrador</label>
              <Input type="password" inputMode="numeric" autoFocus value={adminPin}
                onChange={(e) => setAdminPin(e.target.value.replace(/\D/g, ""))}
                placeholder="PIN" className="mt-1" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setAdminAction(null); setAdminPin(""); }}>Cancelar</Button>
            <Button variant="destructive" disabled={adminBusy} onClick={confirmAdminAction}>
              {adminBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : null} Confirmar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <BarcodeScanner open={scanning} onClose={() => setScanning(false)} continuous onDetected={(c) => addCount(c)} />
    </div>
  );
}

function AdminHistoryRow({ row, onEdit, onDelete }: { row: HistoryRow; onEdit: () => void; onDelete: () => void }) {
  const diff = row.counted_quantity - row.system_stock;
  return (
    <div className="flex items-center gap-2 px-2 py-1.5 text-[11px]">
      <div className="min-w-0 flex-1">
        <div className="truncate font-medium">{row.product_name}</div>
        <div className="text-muted-foreground">
          {branchLabel(row.branch)} · Sys: {row.system_stock} · Contado: {row.counted_quantity}{" "}
          <span className={diff === 0 ? "text-emerald-600" : diff < 0 ? "text-red-600" : "text-amber-600"}>
            ({diff === 0 ? "✓" : diff > 0 ? `+${diff}` : diff})
          </span>
        </div>
        <div className="text-[10px] text-blue-600 dark:text-blue-400">
          {row.collaborator_name ?? "—"} · {new Date(row.created_at).toLocaleString("es-MX", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}
        </div>
      </div>
      <button type="button" onClick={onEdit} className="shrink-0 rounded p-1 hover:bg-muted">
        <Pencil className="h-3.5 w-3.5" />
      </button>
      <button type="button" onClick={onDelete} className="shrink-0 rounded p-1 text-red-600 hover:bg-red-50 dark:hover:bg-red-950/30">
        <Trash2 className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}
