import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState, useCallback, useMemo } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Loader2, Save, ScanLine, Search, CheckCircle2, Minus, Plus, Trash2, ClipboardList, Flag, History, WifiOff, ShieldAlert, RotateCcw, Pencil, AlertTriangle, MessageSquare, Send, Eye, EyeOff } from "lucide-react";
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
  collaborator_name: string | null;
  created_at: string;
};

type AdminAction =
  | { type: "reset"; category: string; branch: "A" | "B" }
  | { type: "resetRealtime"; category: string; branch: "A" | "B" }
  | { type: "deleteRow"; row: HistoryRow }
  | { type: "editRow"; row: HistoryRow; newQty: number }
  | { type: "restoreClosure"; category: string; branch: "A" | "B" }
  | { type: "regenerateReport"; category: string }
  | { type: "wipeCategory"; category: string; zeroStock: boolean }
  | {
      type: "editProduct";
      oldBarcode: string;
      data: { barcode: string; product_name: string; category: string | null; stock_a: number; stock_b: number; price: number };
    };

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

function periodKey() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-01`;
}

function stockColor(stock: number): string {
  if (stock < 0) return "text-red-600 dark:text-red-400";
  if (stock === 0) return "text-amber-500 dark:text-amber-400";
  return "";
}

/** Beeps locales con Web Audio API (sin librerías externas). */
function playSound(type: "match" | "error") {
  try {
    const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    const now = ctx.currentTime;

    if (type === "match") {
      // Dos beeps cortos ascendentes: 440 Hz → 880 Hz, 80 ms cada uno
      const beep = (freq: number, start: number) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = "sine";
        osc.frequency.value = freq;
        gain.gain.setValueAtTime(0.15, start);
        gain.gain.exponentialRampToValueAtTime(0.001, start + 0.08);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(start);
        osc.stop(start + 0.08);
      };
      beep(440, now);
      beep(880, now + 0.09);
    } else {
      // Beep grave descendente: 300 Hz → 150 Hz, 200 ms
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.setValueAtTime(300, now);
      osc.frequency.linearRampToValueAtTime(150, now + 0.2);
      gain.gain.setValueAtTime(0.2, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.2);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now);
      osc.stop(now + 0.2);
    }

    // Cerrar el contexto después de que terminen los beeps
    setTimeout(() => {
      try { ctx.close(); } catch { /* ignore */ }
    }, type === "match" ? 250 : 300);
  } catch {
    // Silenciar errores de audio (navegadores bloqueando autoplay, etc.)
  }
}

function AuditPage() {
  const online = useOnline();
  const _saved = useMemo(() => loadCatState(), []);
  const me = useCollaborator();

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

  const myBranch = useMemo((): "A" | "B" => {
    if (me?.is_admin) return collabBranch ?? "A";
    const b = collabData?.branch;
    if (b === "B") return "B";
    return "A";
  }, [me, collabData, collabBranch]);

  const [category, setCategory] = useState((_saved?.category ?? "").trim());
  const branch: "A" | "B" = myBranch;

  const [counts, setCounts] = useState<Map<string, CountEntry>>(
    _saved?.counts ? new Map(_saved.counts) : new Map()
  );
  const [scanInput, setScanInput] = useState("");
  const [nameSearch, setNameSearch] = useState("");
  const [scanning, setScanning] = useState(false);
  const [saving, setSaving] = useState(false);
  
  const [summaryData, setSummaryData] = useState<CountEntry[] | null>(null);
  const [summaryFinal, setSummaryFinal] = useState(false);
  const scanRef = useRef<HTMLInputElement>(null);
  const qc = useQueryClient();

  const [closeDialog, setCloseDialog] = useState(false);
  const [closing, setClosing] = useState(false);
  const [closeBranchDialog, setCloseBranchDialog] = useState(false);
  const [closingBranch, setClosingBranch] = useState(false);
  const [commentText, setCommentText] = useState("");

  // ── Comentarios inline por producto ──
  type ProdCommentRow = { id: string; collaborator_name: string | null; comment: string; created_at: string };
  const [prodComments, setProdComments] = useState<Map<string, { open: boolean; text: string; sending?: boolean }>>(new Map());
  const [prodCommentRows, setProdCommentRows] = useState<Map<string, ProdCommentRow[]>>(new Map());

  async function toggleProdComment(barcode: string, productName: string, cat: string | null) {
    const cur = prodComments.get(barcode) ?? { open: false, text: "" };
    const next = !cur.open;
    setProdComments((m) => new Map(m).set(barcode, { ...cur, open: next }));
    if (next && !prodCommentRows.has(barcode)) {
      const startOfDay = new Date();
      startOfDay.setHours(0, 0, 0, 0);
      const { data, error } = await supabase
        .from("audit_comments")
        .select("id, collaborator_name, comment, created_at")
        .eq("barcode", barcode)
        .eq("branch", branch)
        .eq("product_name", productName)
        .gte("created_at", startOfDay.toISOString())
        .order("created_at", { ascending: true });
      if (!error && data) setProdCommentRows((m) => new Map(m).set(barcode, data as ProdCommentRow[]));
    }
  }

  async function sendProdComment(barcode: string, productName: string, cat: string | null) {
    const cur = prodComments.get(barcode);
    const text = (cur?.text ?? "").trim();
    if (!text) return;
    setProdComments((m) => new Map(m).set(barcode, { ...(cur ?? { open: true, text: "" }), sending: true }));
    try {
      const { data, error } = await supabase.from("audit_comments").insert({
        barcode,
        product_name: productName,
        category: cat || category || null,
        branch,
        collaborator_name: me?.name || "Anónimo",
        comment: text,
      }).select("id, collaborator_name, comment, created_at").single();
      if (error) throw error;
      setProdCommentRows((m) => new Map(m).set(barcode, [...(m.get(barcode) ?? []), data as ProdCommentRow]));
      setProdComments((m) => new Map(m).set(barcode, { open: true, text: "" }));
    } catch (e) {
      toast.error("No se pudo enviar: " + (e as Error).message);
      setProdComments((m) => new Map(m).set(barcode, { open: true, text, sending: false }));
    }
  }

  const prevCategoryBranchRef = useRef<string>("");
  useEffect(() => {
    const key = `${category}|${branch}`;
    if (key !== prevCategoryBranchRef.current) {
      setCommentText("");
      prevCategoryBranchRef.current = key;
    }
  }, [category, branch]);
  const [commentSending, setCommentSending] = useState(false);

  const rowRefs = useRef<Map<string, HTMLDivElement | null>>(new Map());
  const [highlightBarcode, setHighlightBarcode] = useState<string | null>(null);
  // Mientras se edita cantidad a mano, bloquear pistoleo (evita sumar el código como +1 o pegar el barcode en el input)
  const qtyEditingRef = useRef<string | null>(null);
  const [qtyEditingBarcode, setQtyEditingBarcode] = useState<string | null>(null);

  function flashProduct(barcode: string, scroll = true) {
    setHighlightBarcode(barcode);
    if (scroll) {
      setTimeout(() => {
        rowRefs.current.get(barcode)?.scrollIntoView({ behavior: "smooth", block: "center" });
      }, 80);
    }
  }

  useEffect(() => {
    if (category) saveCatState(category, branch, counts);
  }, [counts, category, branch]);

  const [adminAction, setAdminAction] = useState<AdminAction | null>(null);
  const [adminPin, setAdminPin] = useState("");
  const [adminBusy, setAdminBusy] = useState(false);
  const [reportCategory, setReportCategory] = useState<string | null>(null);
  // Por defecto ocultamos categorías ya cerradas este mes (candado verde).
  // Toggle "Mostrar cerradas" las vuelve a listar en verde para consulta.
  const [showClosedCategories, setShowClosedCategories] = useState(false);

  const [productEditOpen, setProductEditOpen] = useState(false);
  const [productQuery, setProductQuery] = useState("");
  const [editingProduct, setEditingProduct] = useState<Product | null>(null);
  const [epBarcode, setEpBarcode] = useState("");
  const [epName, setEpName] = useState("");
  const [epCategory, setEpCategory] = useState("");
  const [epStockA, setEpStockA] = useState(0);
  const [epStockB, setEpStockB] = useState(0);
  const [epPrice, setEpPrice] = useState(0);

  function pickProductToEdit(p: Product) {
    setEditingProduct(p);
    setEpBarcode(p.barcode);
    setEpName(p.product_name);
    setEpCategory(p.category ?? "");
    setEpStockA(Number(p.stock_a));
    setEpStockB(Number(p.stock_b));
    setEpPrice(Number(p.price));
  }

  function closeProductEdit() {
    setProductEditOpen(false);
    setProductQuery("");
    setEditingProduct(null);
  }

  const { data: productSearchResults = [] } = useQuery({
    queryKey: ["product-search-edit", productQuery],
    enabled: productEditOpen && productQuery.trim().length >= 2 && online,
    staleTime: 10_000,
    queryFn: async () => {
      const q = productQuery.trim();
      const { data, error } = await supabase
        .from("products")
        .select("barcode, product_name, category, stock_a, stock_b, price")
        .or(`product_name.ilike.%${q}%,barcode.ilike.%${q}%`)
        .limit(20);
      if (error) throw error;
      return data as Product[];
    },
  });

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
    // Alineado con "closed-counts-categories" (10s): ambos alimentan el
    // cálculo de `done`/`reactivated`/`partial` del botón de categoría.
    // Si quedan desincronizados, el candado puede parpadear entre estados
    // mientras uno ya se refrescó y el otro todavía no.
    staleTime: online ? 10_000 : Infinity,
    queryFn: async () => {
      const { startIso, endIso } = monthRange();
      const { data, error } = await supabase
        .from("audit_history")
        .select("id, category, branch, session_id, barcode, product_name, system_stock, counted_quantity, collaborator_name, created_at")
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
      const key = row.category.trim();
      const entry = map.get(key) ?? { hasA: false, hasB: false };
      if (row.branch === "A") entry.hasA = true;
      if (row.branch === "B") entry.hasB = true;
      map.set(key, entry);
    }
    return map;
  }, [monthlyHistory]);

  const { data: branchClosures = [] } = useQuery({
    queryKey: ["branch-closures", periodKey()],
    staleTime: 0,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("branch_closures")
        .select("category, branch, period, collaborator_name, total_counted, products_counted, status")
        .eq("period", periodKey());
      if (error) throw error;
      return data as Array<{ category: string; branch: string; period: string; collaborator_name: string | null; total_counted: number; products_counted: number; status?: string }>;
    },
  });

  const branchClosureMap = useMemo(() => {
    const map = new Map<string, { A: boolean; B: boolean; reactivated: boolean }>();
    for (const row of branchClosures) {
      const key = row.category.trim();
      const entry = map.get(key) ?? { A: false, B: false, reactivated: false };
      const isReactivated = (row as any).status === "reactivated";
      // Una fila con status "reactivated" NO cuenta como sucursal cerrada:
      // si no, myBranchClosed/branchLocked se quedan en true después de
      // que el admin reactiva la categoría y el colaborador nunca recupera
      // la pantalla de conteo.
      if (row.branch === "A" && !isReactivated) entry.A = true;
      if (row.branch === "B" && !isReactivated) entry.B = true;
      if (isReactivated) entry.reactivated = true;
      map.set(key, entry);
    }
    return map;
  }, [branchClosures]);

  // ── CANDADO: categorías con cierre general este mes (closed_counts) ──
  // PostgREST limita ~1000 filas por request. Hay una fila por producto, así que
  // sin paginar se "pierden" categorías cerradas y siguen apareciendo como pendientes
  // aunque el trigger ya impida volver a cerrarlas.
  const { data: closedCountsThisMonth = [] } = useQuery({
    queryKey: ["closed-counts-categories", periodKey()],
    staleTime: online ? 10_000 : Infinity,
    queryFn: async () => {
      const { startIso, endIso } = monthRange();
      const PAGE = 1000;
      const all: Array<{ category: string }> = [];
      let from = 0;
      while (true) {
        const { data, error } = await supabase
          .from("closed_counts")
          .select("category")
          .gte("closed_at", startIso)
          .lte("closed_at", endIso)
          .range(from, from + PAGE - 1);
        if (error) throw error;
        const page = (data ?? []) as Array<{ category: string }>;
        all.push(...page);
        if (page.length < PAGE) break;
        from += PAGE;
      }
      return all;
    },
  });

  const closedCountsCategories = useMemo(() => {
    const set = new Set<string>();
    for (const r of closedCountsThisMonth) {
      if (r.category) set.add(r.category.trim());
    }
    return set;
  }, [closedCountsThisMonth]);

  const { data: reportLiveProducts = [] } = useQuery({
    queryKey: ["report-live-products", reportCategory],
    enabled: !!reportCategory,
    staleTime: online ? 15_000 : Infinity,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("products")
        .select("barcode, product_name, stock_a, stock_b")
        .eq("category", reportCategory as string);
      if (error) throw error;
      return data as Array<{ barcode: string; product_name: string; stock_a: number; stock_b: number }>;
    },
  });

  const { data: reportLiveAudits = [] } = useQuery({
    queryKey: ["report-live-audits", reportCategory],
    enabled: !!reportCategory && reportLiveProducts.length > 0 && online,
    staleTime: online ? 15_000 : Infinity,
    queryFn: async () => {
      const barcodes = reportLiveProducts.map((p) => p.barcode);
      const { startIso, endIso } = monthRange();
      const { data, error } = await supabase
        .from("audits")
        .select("barcode, physical_count, branch")
        .in("barcode", barcodes)
        .gte("created_at", startIso)
        .lte("created_at", endIso);
      if (error) throw error;
      return data as Array<{ barcode: string; physical_count: number; branch: string }>;
    },
  });

  const reportLiveRows = useMemo(() => {
    const minaMap = new Map<string, number>();
    const morelosMap = new Map<string, number>();
    for (const a of reportLiveAudits) {
      const qty = Number(a.physical_count);
      if (a.branch === "A") minaMap.set(a.barcode, (minaMap.get(a.barcode) ?? 0) + qty);
      if (a.branch === "B") morelosMap.set(a.barcode, (morelosMap.get(a.barcode) ?? 0) + qty);
    }
    return reportLiveProducts
      .map((p) => {
        const sys = Number(p.stock_a) + Number(p.stock_b);
        const mina = minaMap.get(p.barcode) ?? 0;
        const morelos = morelosMap.get(p.barcode) ?? 0;
        return { barcode: p.barcode, product_name: p.product_name, system_stock: sys, mina, morelos, total: mina + morelos };
      })
      .filter((r) => r.mina > 0 || r.morelos > 0);
  }, [reportLiveProducts, reportLiveAudits]);

  const { data: recentComments = [] } = useQuery({
    queryKey: ["audit-comments", category, branch],
    enabled: !!category,
    staleTime: online ? 15_000 : Infinity,
    queryFn: async () => {
      if (!category) return [];
      const { data, error } = await supabase
        .from("audit_comments")
        .select("id, category, branch, collaborator_name, comment, created_at, barcode, product_name")
        .eq("category", category)
        .eq("branch", branch)
        .order("created_at", { ascending: false })
        .limit(20);
      if (error) throw error;
      return data;
    },
  });

  // Comentarios de todos los productos de la categoría del reporte (ambas sucursales)
  const { data: reportComments = [] } = useQuery({
    queryKey: ["report-comments", reportCategory],
    enabled: !!reportCategory,
    staleTime: 10_000,
    queryFn: async () => {
      if (!reportCategory) return [];
      const start = new Date();
      start.setDate(1);
      start.setHours(0, 0, 0, 0);
      const { data, error } = await supabase
        .from("audit_comments")
        .select("id, category, branch, collaborator_name, comment, created_at, barcode, product_name")
        .eq("category", reportCategory)
        .gte("created_at", start.toISOString())
        .order("created_at", { ascending: false })
        .limit(200);
      if (error) throw error;
      return data ?? [];
    },
  });

  const { data: products = [] } = useQuery({
    queryKey: ["cat-products", category, online],
    enabled: !!category,
    staleTime: online ? 30_000 : Infinity,
    queryFn: async () => {
      const cat = (category ?? "").trim();
      if (!cat) return [];

      // Sin internet: catálogo local
      if (!online) {
        const { getCachedProductsByCategory } = await import("@/lib/offline-cache");
        const rows = await getCachedProductsByCategory(cat);
        return rows.map((p) => ({
          barcode: p.barcode,
          product_name: p.product_name,
          category: p.category,
          stock_a: p.stock_a,
          stock_b: p.stock_b,
          price: p.price ?? 0,
        })) as Product[];
      }

      try {
        // 1) Match exacto (caso normal)
        const { data, error } = await supabase
          .from("products")
          .select("barcode, product_name, category, stock_a, stock_b, price")
          .eq("category", cat)
          .order("product_name");
        if (error) throw error;
        if ((data ?? []).length > 0) return data as Product[];

        // 2) Fallback: espacios extra en category
        const { data: all, error: e2 } = await supabase
          .from("products")
          .select("barcode, product_name, category, stock_a, stock_b, price")
          .not("category", "is", null)
          .not("category", "eq", "");
        if (e2) throw e2;
        return ((all ?? []) as Product[])
          .filter((p) => (p.category ?? "").trim() === cat)
          .sort((a, b) => a.product_name.localeCompare(b.product_name, "es"));
      } catch {
        const { getCachedProductsByCategory } = await import("@/lib/offline-cache");
        const rows = await getCachedProductsByCategory(cat);
        return rows.map((p) => ({
          barcode: p.barcode,
          product_name: p.product_name,
          category: p.category,
          stock_a: p.stock_a,
          stock_b: p.stock_b,
          price: p.price ?? 0,
        })) as Product[];
      }
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
        .gte("created_at", monthRange().startIso)
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

  // Siempre normalizar categoría con trim para que coincida con las claves
  // de branchClosureMap / categoryStatus / closedCountsCategories (todas usan .trim()).
  // Sin esto, si localStorage o el select traen espacios, el candado verde/amarillo
  // y el bloqueo de "ya guardado" fallan de forma intermitente.
  const catKey = (category ?? "").trim();
  const closedA = catKey ? branchClosureMap.get(catKey)?.A ?? false : false;
  const closedB = catKey ? branchClosureMap.get(catKey)?.B ?? false : false;

  const minaDone = closedA;
  const morelosDone = closedB;
  const bothClosed = closedA && closedB;

  const categoryHasSavedReport = catKey ? closedCountsCategories.has(catKey) : false;
  const alreadyCountedThisMonth = catKey
    ? categoryHasSavedReport || ((branch === "A" ? categoryStatus.get(catKey)?.hasA : categoryStatus.get(catKey)?.hasB) ?? false)
    : false;

  const myBranchClosed = catKey ? (branch === "A" ? closedA : closedB) : false;
  // Si el reporte general ya está guardado este mes, bloquear para todos (incluyendo admin)
  // para evitar guardar la misma categoría dos veces en el mismo mes.
  const branchLocked = categoryHasSavedReport ? true : (alreadyCountedThisMonth || myBranchClosed);

  async function lookupProduct(barcode: string): Promise<Product | null> {
    const local = products.find((p) => p.barcode === barcode);
    if (local) return local;
    if (!online) {
      playSound("error");
      toast.error(`Producto no encontrado localmente: ${barcode}`);
      return null;
    }
    const { data, error } = await supabase
      .from("products").select("barcode, product_name, category, stock_a, stock_b, price")
      .eq("barcode", barcode).maybeSingle();
    if (error || !data) {
      playSound("error");
      toast.error(`Producto no encontrado: ${barcode}`);
      return null;
    }
    return data as Product;
  }

  const addCount = useCallback(async (barcode: string) => {
    const code = barcode.trim();
    if (!code) return;
    setScanInput("");
    // Si hay un input de cantidad manual enfocado, NO sumar por pistoleo
    if (qtyEditingRef.current) {
      toast.error("Estás editando una cantidad a mano. Terminá o tocá fuera antes de pistolear.");
      scanRef.current?.focus();
      return;
    }
    if (!category) { toast.error("Seleccioná una categoría primero"); scanRef.current?.focus(); return; }
    const prod = await lookupProduct(code);
    if (!prod) { scanRef.current?.focus(); return; }
    if (prod.category !== category) {
      toast.error(`"${prod.product_name}" no es de la categoría ${category}`);
      scanRef.current?.focus();
      return;
    }
    const sys = Number(prod.stock_a) + Number(prod.stock_b);
    const existingCount = counts.get(code)?.count ?? 0;
    const newLocalCount = existingCount + 1;
    const savedToday = realtimeSums.get(code)?.total ?? 0;
    const grandTotal = newLocalCount + savedToday;

    setCounts((prev) => {
      const newMap = new Map(prev);
      newMap.set(code, { barcode: code, product_name: prod.product_name, count: newLocalCount, system_stock: sys });
      return newMap;
    });

    if (grandTotal === sys) {
      playSound("match");
    }

    toast.success(`+1 · ${prod.product_name}`);
    scanRef.current?.focus();
    flashProduct(code);
  }, [products, category, online, counts, realtimeSums]);

  function setCount(barcode: string, val: number) {
    const prod = products.find((p) => p.barcode === barcode);
    if (!prod) return;
    // Evitar que un pistoleo pegado en el input de cantidad genere un número enorme
    if (val > 9_999) {
      toast.error("Cantidad inválida (parece un código de barras). Escribí solo el número contado.");
      return;
    }
    const sys = Number(prod.stock_a) + Number(prod.stock_b);
    setCounts((prev) => {
      const newMap = new Map(prev);
      if (val <= 0) { newMap.delete(barcode); return newMap; }
      newMap.set(barcode, { barcode, product_name: prod.product_name, count: val, system_stock: sys });
      return newMap;
    });
    // Marco azul también en cambio manual (+ / − / teclear)
    flashProduct(barcode, false);
  }

  function changeCategory(newCat: string) {
    const normalized = (newCat ?? "").trim();
    if (counts.size > 0 && normalized !== category) {
      if (!confirm("¿Cambiar de categoría? Se perderá el conteo actual.")) return;
    }
    setCategory(normalized);
    setCounts(new Map());
    if (!normalized) clearCatState();
  }

  function getUnclosedForBranch(): Product[] {
    const mySums = branch === "A" ? realtimeMina : realtimeMorelos;
    // Antes se excluían los productos con stock de sistema 0 (sys > 0),
    // así que si nadie los escaneaba nunca quedaba una fila en 'audits'
    // probando que esa sucursal los revisó. Ahora se auto-cierran en 0
    // igual que cualquier otro producto no escaneado, para que el registro
    // de auditoría sea completo para toda la categoría.
    return products.filter((p) => !counts.has(p.barcode) && !mySums.has(p.barcode));
  }

  async function closeBranchCount() {
    const collab = getCollaborator();
    if (!collab) { toast.error("Sesión expirada"); return; }
    if (!category) return;
    // Bloquear si el conteo general ya fue cerrado este mes (solo admin puede ajustar)
    if (categoryHasSavedReport) {
      toast.error(`"${category}" ya fue cerrado por el administrador este mes. Solo admin puede hacer ajustes desde "Reactivar categoría".`);
      return;
    }
    if (!online) {
      toast.error("Necesitás conexión a internet para cerrar el conteo.");
      return;
    }
    setClosingBranch(true);
    try {
      const unclosed = getUnclosedForBranch();
      const finalCounts = new Map(counts);
      for (const p of unclosed) {
        const sys = Number(p.stock_a) + Number(p.stock_b);
        finalCounts.set(p.barcode, { barcode: p.barcode, product_name: p.product_name, count: 0, system_stock: sys });
      }

      if (finalCounts.size > 0) {
        const sessionId = crypto.randomUUID();
        const rows = Array.from(finalCounts.values()).map((c) => ({
          branch,
          barcode: c.barcode,
          product_name: c.product_name,
          system_stock: c.system_stock,
          physical_count: c.count,
          difference: c.count - c.system_stock,
          collaborator_id: collab.id,
          collaborator_name: collab.name,
          client_uid: `close-${sessionId}-${c.barcode}`,
        }));
        if (online) {
          const { error } = await supabase.from("audits").insert(rows);
          if (error) throw error;
        } else {
          for (const row of rows) {
            await enqueue({ kind: "audit", uid: row.client_uid, createdAt: Date.now(), payload: row });
          }
        }
      }

      const mySums = branch === "A" ? realtimeMina : realtimeMorelos;
      let total = 0;
      let numProducts = 0;
      for (const p of products) {
        const local = finalCounts.get(p.barcode);
        const val = local ? local.count : (mySums.get(p.barcode) ?? 0);
        total += val;
        if (val > 0) numProducts++;
      }

      if (online) {
        const cat = (category ?? "").trim();
        const { error: e2 } = await supabase.from("branch_closures").upsert(
          {
            category: cat, branch, period: periodKey(),
            collaborator_id: collab.id, collaborator_name: collab.name,
            total_counted: total, products_counted: numProducts,
            status: "closed",
          },
          { onConflict: "category,branch,period" }
        );
        if (e2) throw e2;
      }

      toast.success(`Conteo de "${(category ?? "").trim()}" cerrado en ${branchLabel(branch)} ✓`);
      setCloseBranchDialog(false);
      setCounts(new Map());
      clearCatState();
      if (online) {
        qc.invalidateQueries({ queryKey: ["audits-realtime", category] });
        qc.invalidateQueries({ queryKey: ["branch-closures", periodKey()] });
      }
    } catch (e) {
      toast.error("No se pudo cerrar: " + (e as Error).message);
    } finally {
      setClosingBranch(false);
    }
  }

  async function sendComment() {
    const collab = getCollaborator();
    if (!collab) { toast.error("Sesión expirada"); return; }
    const text = commentText.trim();
    if (!text) return;
    setCommentSending(true);
    try {
      const { error } = await supabase.from("audit_comments").insert({
        category: category || null,
        branch,
        collaborator_id: collab.id,
        collaborator_name: collab.name,
        comment: text,
      });
      if (error) throw error;
      setCommentText("");
      toast.success("Comentario enviado");
      qc.invalidateQueries({ queryKey: ["audit-comments"] });
    } catch (e) {
      toast.error("No se pudo enviar: " + (e as Error).message);
    } finally {
      setCommentSending(false);
    }
  }

  async function confirmClose() {
    const collab = getCollaborator();
    if (!collab) return;
    const cat = (category ?? "").trim();
    if (!cat) {
      toast.error("Seleccioná una categoría primero");
      return;
    }
    if (!online) {
      toast.error("Necesitás conexión a internet para cerrar la categoría.");
      return;
    }
    setClosing(true);
    try {
      // Asegurar productos: si el query en memoria está vacío (por mismatch de espacios
      // en category), reintentamos con el mismo criterio tolerante a trim.
      let prods = products;
      if (prods.length === 0) {
        const { data: exact, error: eExact } = await supabase
          .from("products")
          .select("barcode, product_name, category, stock_a, stock_b, price")
          .eq("category", cat)
          .order("product_name");
        if (eExact) throw eExact;
        prods = (exact ?? []) as Product[];
        if (prods.length === 0) {
          const { data: all, error: eAll } = await supabase
            .from("products")
            .select("barcode, product_name, category, stock_a, stock_b, price")
            .not("category", "is", null)
            .not("category", "eq", "");
          if (eAll) throw eAll;
          prods = ((all ?? []) as Product[]).filter((p) => (p.category ?? "").trim() === cat);
        }
      }
      if (prods.length === 0) {
        throw new Error(
          `No se encontraron productos para la categoría "${cat}". Revisá que el nombre coincida en la tabla de productos (sin espacios extra).`
        );
      }

      const { startIso, endIso } = monthRange();
      // Comprobar por categoría normalizada (trim): en DB a veces hay espacios
      // extra y un .eq exacto devolvía 0 aunque el cierre ya existiera, permitiendo
      // guardar de nuevo y haciendo que el verde parpadee o se pierda el conteo.
      const { data: existingRows, error: eCheck } = await supabase
        .from("closed_counts")
        .select("category")
        .gte("closed_at", startIso)
        .lte("closed_at", endIso);
      if (eCheck) throw eCheck;
      const alreadyClosed = (existingRows ?? []).some(
        (r) => (r.category ?? "").trim() === cat
      );
      if (alreadyClosed) {
        toast.error(`"${cat}" ya fue cerrada este mes — no se puede volver a cerrar.`);
        setCloseDialog(false);
        // Refrescar el candado verde por si la UI estaba desfasada
        qc.invalidateQueries({ queryKey: ["closed-counts-categories"], refetchType: "all" });
        qc.invalidateQueries({ queryKey: ["closed_counts"], refetchType: "all" });
        return;
      }

      const sessionId = crypto.randomUUID();
      const closedAt = new Date().toISOString();

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

      const reportRows = prods.map((p) => {
        const sys = Number(p.stock_a) + Number(p.stock_b);
        const minaCount = realtimeMina.get(p.barcode) ?? 0;
        const morelosCount = realtimeMorelos.get(p.barcode) ?? 0;
        const price = Number(p.price) || 0;
        const diff = (minaCount + morelosCount) - sys;
        const details = (detailsByBarcode.get(p.barcode) ?? []).sort((a, b) => a.at.localeCompare(b.at));
        const last = details[details.length - 1];
        return {
          session_id: sessionId,
          category: cat,
          barcode: p.barcode,
          product_name: p.product_name,
          system_stock: sys,
          mina_count: minaCount,
          morelos_count: morelosCount,
          total_counted: minaCount + morelosCount,
          difference: diff,
          unit_price: price,
          difference_value: diff * price,
          scanned_mina: realtimeMina.has(p.barcode),
          scanned_morelos: realtimeMorelos.has(p.barcode),
          closed_by: collab.name,
          closed_at: closedAt,
          count_details: details,
          last_counted_by: last?.name ?? null,
          last_counted_at: last?.at ?? null,
        };
      });

      const historyRowsMina = prods.map((p) => {
        const sys = Number(p.stock_a) + Number(p.stock_b);
        const total = (realtimeMina.get(p.barcode) ?? 0) + (realtimeMorelos.get(p.barcode) ?? 0);
        return {
          session_id: sessionId,
          category: cat,
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
      const historyRowsMorelos = prods.map((p) => {
        const sys = Number(p.stock_a) + Number(p.stock_b);
        const total = (realtimeMina.get(p.barcode) ?? 0) + (realtimeMorelos.get(p.barcode) ?? 0);
        return {
          session_id: sessionId,
          category: cat,
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

      // Insert obligatorio en closed_counts (esto es lo que pinta verde).
      // Si falla, no mostramos éxito.
      if (reportRows.length === 0) {
        throw new Error("No se generaron filas de cierre. Revisá los productos de la categoría.");
      }
      const { error: e1 } = await supabase.from("closed_counts").insert(reportRows);
      if (e1) throw e1;

      // A partir de aquí el candado verde YA está en la DB. Los pasos siguientes
      // son complementarios: si fallan, igual invalidamos queries para que la UI
      // pinte verde y no se "pierda" el cierre del administrador.
      let secondaryError: string | null = null;

      const { error: e2 } = await supabase.from("audit_history").insert([...historyRowsMina, ...historyRowsMorelos]);
      if (e2) {
        console.warn("closed_counts OK pero audit_history falló:", e2.message);
        secondaryError = e2.message;
      }

      const { error: e3 } = await supabase
        .from("audit_comments")
        .update({ session_id: sessionId })
        .eq("category", cat)
        .is("session_id", null)
        .gte("created_at", startIso);
      if (e3) console.warn("No se pudieron ligar los comentarios:", e3.message);

      const { error: e4 } = await supabase
        .from("branch_closures")
        .update({ status: null })
        .eq("category", cat)
        .eq("period", periodKey())
        .eq("status", "reactivated");
      if (e4) console.warn("No se pudo limpiar el estado 'reactivated':", e4.message);

      // Invalidar SIEMPRE tras insert exitoso en closed_counts
      qc.invalidateQueries({ queryKey: ["closed_counts"], refetchType: "all" });
      qc.invalidateQueries({ queryKey: ["audit-history-month"], refetchType: "all" });
      qc.invalidateQueries({ queryKey: ["closed-counts-categories"], refetchType: "all" });
      qc.invalidateQueries({ queryKey: ["audits-realtime", category], refetchType: "all" });
      qc.invalidateQueries({ queryKey: ["branch-closures"], refetchType: "all" });
      qc.invalidateQueries({ queryKey: ["audit-comments"], refetchType: "all" });

      setCloseDialog(false);
      // Normalizar estado local para que el candado verde/bloqueos usen la misma clave
      if (category !== cat) setCategory(cat);
      if (secondaryError) {
        toast.success(`Categoría "${cat}" cerrada ✓ (verde OK). Historial parcial: ${secondaryError}`);
      } else {
        toast.success(`Categoría "${cat}" cerrada ✓ — ya aparece en verde en el corte mensual`);
      }
    } catch (e) {
      toast.error("Error al finalizar: " + (e as Error).message);
      // Por si el error ocurrió después de un insert parcial, refrescar candados
      qc.invalidateQueries({ queryKey: ["closed-counts-categories"], refetchType: "all" });
      qc.invalidateQueries({ queryKey: ["closed_counts"], refetchType: "all" });
      qc.invalidateQueries({ queryKey: ["branch-closures"], refetchType: "all" });
    } finally {
      setClosing(false);
    }
  }

  async function confirmAdminAction() {
    if (!me) return;
    if (adminAction?.type !== "restoreClosure" && adminPin.length < 4) { toast.error("Ingresá tu PIN de administrador"); return; }
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
      } else if (adminAction.type === "wipeCategory") {
        const cat = (adminAction.category ?? "").trim();
        const { startIso, endIso } = monthRange();
        const { data, error } = await supabase.rpc("admin_wipe_audit_category", {
          p_admin_id: me.id, p_admin_pin: adminPin, p_category: cat,
          p_since: startIso, p_until: endIso, p_period: periodKey(), p_zero_stock: adminAction.zeroStock,
        });
        if (error) throw error;
        toast.success(`"${cat}" quedó en ceros — ${data ?? 0} registros eliminados. Ya puedes importar y contar de nuevo.`);
        if ((category ?? "").trim() === cat) { setCounts(new Map()); clearCatState(); }
        setReportCategory(null);
        qc.invalidateQueries();
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
      } else if (adminAction.type === "restoreClosure") {
        const { startIso, endIso } = monthRange();
        const cat = (adminAction.category ?? "").trim();

        let { data: catProds } = await supabase
          .from("products").select("barcode, category").eq("category", cat);
        if (!(catProds ?? []).length) {
          const { data: allP } = await supabase
            .from("products").select("barcode, category")
            .not("category", "is", null).not("category", "eq", "");
          catProds = (allP ?? []).filter((p: any) => (p.category ?? "").trim() === cat);
        }
        const barcodes = (catProds ?? []).map((p: any) => p.barcode);

        // closed_counts es un resumen ya combinado de Mina + Morelos por
        // producto (no tiene columna 'branch'), así que siempre hay que
        // borrarlo completo al reactivar cualquiera de las dos sucursales.
        // El reporte general queda inválido hasta que el admin presione
        // "Volver a guardar conteo general".
        // Borrado tolerante a espacios: traemos filas del mes y filtramos por trim.
        const { data: ccRows } = await supabase
          .from("closed_counts")
          .select("id, category")
          .gte("closed_at", startIso)
          .lte("closed_at", endIso);
        const ccIds = (ccRows ?? [])
          .filter((r) => (r.category ?? "").trim() === cat)
          .map((r) => r.id);
        if (ccIds.length) {
          await supabase.from("closed_counts").delete().in("id", ccIds);
        }

        if (barcodes.length) {
          // audit_history SÍ tiene 'branch': antes se borraban las filas de
          // AMBAS sucursales aunque solo se reactivara una, así que el
          // historial ya guardado de la sucursal que seguía cerrada
          // desaparecía sin motivo. Ahora solo se borra la sucursal que se
          // está reactivando.
          const { data: histRows } = await supabase
            .from("audit_history")
            .select("id, category")
            .eq("branch", adminAction.branch)
            .gte("created_at", startIso)
            .lte("created_at", endIso);
          const histIds = (histRows ?? [])
            .filter((r) => (r.category ?? "").trim() === cat)
            .map((r) => r.id);
          if (histIds.length) {
            await supabase.from("audit_history").delete().in("id", histIds);
          }
        }

        // Antes esto marcaba A y B como "reactivated" sin importar cuál
        // sucursal pidió el admin, así que reactivar Mina también
        // desbloqueaba Morelos (y viceversa) aunque esa sucursal ya
        // estuviera correctamente cerrada. Ahora solo toca la sucursal
        // indicada en adminAction.branch.
        await supabase.from("branch_closures").upsert(
          { category: cat, branch: adminAction.branch, period: periodKey(), status: "reactivated", collaborator_name: me?.name ?? "Admin" },
          { onConflict: "category,branch,period" },
        );

        toast.success(`"${cat}" reactivada en ${branchLabel(adminAction.branch)} para corrección — los conteos anteriores se conservan.`);
        if (category === cat && branch === adminAction.branch) { setCounts(new Map()); clearCatState(); }
        qc.invalidateQueries({ queryKey: ["branch-closures", periodKey()], refetchType: "all" });
        qc.invalidateQueries({ queryKey: ["closed-counts-categories", periodKey()], refetchType: "all" });
        qc.invalidateQueries({ queryKey: ["audit-history-month"], refetchType: "all" });
      } else if (adminAction.type === "regenerateReport") {
        const cat = (adminAction.category ?? "").trim();
        if (!cat) throw new Error("Categoría vacía");
        const { startIso, endIso } = monthRange();

        // Match exacto + fallback trim (mismo criterio que confirmClose)
        let prods: Array<{ barcode: string; product_name: string; stock_a: number; stock_b: number; price: number }> = [];
        {
          const { data: exact, error: ep } = await supabase
            .from("products")
            .select("barcode, product_name, stock_a, stock_b, price, category")
            .eq("category", cat);
          if (ep) throw ep;
          prods = exact ?? [];
          if (prods.length === 0) {
            const { data: all, error: eAll } = await supabase
              .from("products")
              .select("barcode, product_name, stock_a, stock_b, price, category")
              .not("category", "is", null)
              .not("category", "eq", "");
            if (eAll) throw eAll;
            prods = (all ?? []).filter((p: any) => (p.category ?? "").trim() === cat);
          }
        }
        if (prods.length === 0) {
          throw new Error(`No se encontraron productos para "${cat}". Revisá espacios en el nombre de categoría.`);
        }
        const barcodes = prods.map((p) => p.barcode);

        let liveAudits: Array<{ barcode: string; physical_count: number; collaborator_name: string | null; branch: "A" | "B" | null; created_at: string }> = [];
        if (barcodes.length) {
          const { data: la, error: ea } = await supabase
            .from("audits")
            .select("barcode, physical_count, collaborator_name, branch, created_at")
            .in("barcode", barcodes)
            .gte("created_at", startIso)
            .lte("created_at", endIso);
          if (ea) throw ea;
          liveAudits = la ?? [];
        }

        const minaMap = new Map<string, number>();
        const morelosMap = new Map<string, number>();
        const detailsByBarcode = new Map<string, { name: string; branch: string; qty: number; at: string }[]>();
        for (const a of liveAudits) {
          const qty = Number(a.physical_count);
          if (a.branch === "A") minaMap.set(a.barcode, (minaMap.get(a.barcode) ?? 0) + qty);
          if (a.branch === "B") morelosMap.set(a.barcode, (morelosMap.get(a.barcode) ?? 0) + qty);
          const list = detailsByBarcode.get(a.barcode) ?? [];
          list.push({ name: a.collaborator_name ?? "Anónimo", branch: branchLabel(a.branch), qty, at: a.created_at });
          detailsByBarcode.set(a.barcode, list);
        }

        // Borrado tolerante a espacios en category (mismo criterio que el candado verde)
        const { data: ccToDel, error: eFetchCc } = await supabase
          .from("closed_counts").select("id, category")
          .gte("closed_at", startIso).lte("closed_at", endIso);
        if (eFetchCc) throw eFetchCc;
        const ccDelIds = (ccToDel ?? []).filter((r) => (r.category ?? "").trim() === cat).map((r) => r.id);
        if (ccDelIds.length) {
          const { error: eDelCounts } = await supabase.from("closed_counts").delete().in("id", ccDelIds);
          if (eDelCounts) throw eDelCounts;
        }
        const { data: histToDel, error: eFetchHist } = await supabase
          .from("audit_history").select("id, category")
          .gte("created_at", startIso).lte("created_at", endIso);
        if (eFetchHist) throw eFetchHist;
        const histDelIds = (histToDel ?? []).filter((r) => (r.category ?? "").trim() === cat).map((r) => r.id);
        if (histDelIds.length) {
          const { error: eDelHist } = await supabase.from("audit_history").delete().in("id", histDelIds);
          if (eDelHist) throw eDelHist;
        }

        const sessionId = crypto.randomUUID();
        const closedAt = new Date().toISOString();

        const reportRows = prods.map((p) => {
          const sys = Number(p.stock_a) + Number(p.stock_b);
          const minaCount = minaMap.get(p.barcode) ?? 0;
          const morelosCount = morelosMap.get(p.barcode) ?? 0;
          const price = Number(p.price) || 0;
          const diff = (minaCount + morelosCount) - sys;
          const details = (detailsByBarcode.get(p.barcode) ?? []).sort((a, b) => a.at.localeCompare(b.at));
          const last = details[details.length - 1];
          return {
            session_id: sessionId, category: cat,
            barcode: p.barcode, product_name: p.product_name,
            system_stock: sys, mina_count: minaCount, morelos_count: morelosCount,
            total_counted: minaCount + morelosCount, difference: diff,
            unit_price: price, difference_value: diff * price,
            scanned_mina: minaMap.has(p.barcode), scanned_morelos: morelosMap.has(p.barcode),
            closed_by: me.name, closed_at: closedAt,
            count_details: details, last_counted_by: last?.name ?? null, last_counted_at: last?.at ?? null,
          };
        });
        const historyRowsMina = prods.map((p) => {
          const sys = Number(p.stock_a) + Number(p.stock_b);
          const total = (minaMap.get(p.barcode) ?? 0) + (morelosMap.get(p.barcode) ?? 0);
          return {
            session_id: sessionId, category: cat, branch: "A" as const,
            barcode: p.barcode, product_name: p.product_name, system_stock: sys,
            counted_quantity: minaMap.get(p.barcode) ?? 0, difference: total - sys,
            collaborator_id: me.id, collaborator_name: me.name,
          };
        });
        const historyRowsMorelos = prods.map((p) => {
          const sys = Number(p.stock_a) + Number(p.stock_b);
          const total = (minaMap.get(p.barcode) ?? 0) + (morelosMap.get(p.barcode) ?? 0);
          return {
            session_id: sessionId, category: cat, branch: "B" as const,
            barcode: p.barcode, product_name: p.product_name, system_stock: sys,
            counted_quantity: morelosMap.get(p.barcode) ?? 0, difference: total - sys,
            collaborator_id: me.id, collaborator_name: me.name,
          };
        });

        const { error: e1 } = await supabase.from("closed_counts").insert(reportRows);
        if (e1) throw e1;
        const { error: e2 } = await supabase.from("audit_history").insert([...historyRowsMina, ...historyRowsMorelos]);
        if (e2) throw e2;
        const { error: e5 } = await supabase
          .from("branch_closures")
          .update({ status: null })
          .eq("category", cat)
          .eq("period", periodKey())
          .eq("status", "reactivated");
        if (e5) console.warn("No se pudo limpiar el estado 'reactivated':", e5.message);

        toast.success(`Reporte general de "${cat}" guardado de nuevo ✓`);
        if (category === cat) { setCounts(new Map()); clearCatState(); }
        qc.invalidateQueries({ queryKey: ["closed_counts"], refetchType: "all" });
        qc.invalidateQueries({ queryKey: ["closed-counts-categories"], refetchType: "all" });
        qc.invalidateQueries({ queryKey: ["audit-history-month"], refetchType: "all" });
        qc.invalidateQueries({ queryKey: ["branch-closures"], refetchType: "all" });
      } else if (adminAction.type === "editProduct") {
        const { oldBarcode, data } = adminAction;
        if (!data.barcode.trim() || !data.product_name.trim()) {
          throw new Error("El código y el nombre son obligatorios");
        }
        const { error } = await supabase
          .from("products")
          .update({
            barcode: data.barcode.trim(),
            product_name: data.product_name.trim(),
            category: data.category ? data.category.trim() : null,
            stock_a: data.stock_a,
            stock_b: data.stock_b,
            price: data.price,
          })
          .eq("barcode", oldBarcode);
        if (error) throw error;
        toast.success(`Producto "${data.product_name}" actualizado ✓`);
        closeProductEdit();
        qc.invalidateQueries({ queryKey: ["categories-all"] });
        qc.invalidateQueries({ queryKey: ["category-counts"] });
        qc.invalidateQueries({ queryKey: ["cat-products"] });
        qc.invalidateQueries({ queryKey: ["product-search-edit"] });
        qc.invalidateQueries({ queryKey: ["report-live-products"] });
      }
      setAdminAction(null); setAdminPin("");
      qc.invalidateQueries({ queryKey: ["audit-history-month"] });
    } catch (e) { toast.error((e as Error).message); }
    finally { setAdminBusy(false); }
  }

  function buildCategoryReport(cat: string) {
    const rows = monthlyHistory.filter((r) => (r.category ?? "").trim() === cat);
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

      {/* ── Corte mensual por categoría ── */}
      {/* Por defecto solo pendientes: al cerrar el admin la categoría se oculta.
          Toggle "Mostrar cerradas" las lista en verde. Cada mes nuevo vuelven todas. */}
      <Card>
        <CardContent className="p-3 space-y-2">
          {(() => {
            const pendingCats = categories.filter((c) => !closedCountsCategories.has(c.trim()));
            const closedCount = categories.length - pendingCats.length;
            const visibleCats = showClosedCategories ? categories : pendingCats;
            return (
              <>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex flex-col gap-0.5">
                    <span className="text-xs font-medium text-muted-foreground">Corte mensual por categoría</span>
                    <span className="text-[10px] text-muted-foreground">
                      {monthLabel()}
                      {categories.length > 0 && (
                        <> · {pendingCats.length} pendiente{pendingCats.length === 1 ? "" : "s"}
                          {closedCount > 0 ? ` · ${closedCount} cerrada${closedCount === 1 ? "" : "s"}` : ""}
                        </>
                      )}
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={() => setShowClosedCategories((v) => !v)}
                    className={`inline-flex items-center gap-1 rounded-md border px-2 py-1 text-[10px] font-medium transition-colors ${
                      showClosedCategories
                        ? "border-emerald-500 bg-emerald-50 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-200"
                        : "border-muted-foreground/30 text-muted-foreground hover:bg-muted"
                    }`}
                    title={showClosedCategories ? "Ocultar categorías ya cerradas este mes" : "Mostrar también las ya cerradas este mes"}
                  >
                    {showClosedCategories ? <Eye className="h-3 w-3" /> : <EyeOff className="h-3 w-3" />}
                    {showClosedCategories ? "Ocultar cerradas" : "Mostrar cerradas"}
                  </button>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {visibleCats.map((c) => {
                    const catTrimmed = c.trim();
                    const st = categoryStatus.get(catTrimmed) ?? categoryStatus.get(c);
                    const bc = branchClosureMap.get(catTrimmed) ?? branchClosureMap.get(c);

                    // done = cierre general del admin (closed_counts del mes)
                    const done = closedCountsCategories.has(catTrimmed);
                    const reactivated = !done && !!bc?.reactivated;
                    const partial = !done && !reactivated && (!!bc?.A || !!bc?.B);

                    const total = categoryCounts.get(catTrimmed) ?? categoryCounts.get(c) ?? 0;
                    return (
                      <button
                        key={c}
                        type="button"
                        onClick={() => setReportCategory(c)}
                        disabled={!st && !bc && !done}
                        className={`flex flex-col items-center rounded-md border px-2.5 py-1 text-[11px] font-medium leading-tight transition-colors ${
                          done
                            ? "border-emerald-500 bg-emerald-500 text-white"
                            : reactivated
                            ? "border-orange-500 bg-orange-400 text-white"
                            : partial
                            ? "border-amber-500 bg-amber-400 text-amber-950"
                            : "border-transparent bg-muted text-muted-foreground"
                        }`}
                      >
                        <span>{c}{done ? " ✓" : reactivated ? " 🔄" : partial ? " ⏳" : ""}</span>
                        <span className={`text-[9px] font-normal ${done ? "text-emerald-50" : reactivated ? "text-orange-50" : partial ? "text-amber-900" : "opacity-70"}`}>
                          {total} artículo{total === 1 ? "" : "s"}
                        </span>
                      </button>
                    );
                  })}
                  {categories.length === 0 && (
                    <span className="text-xs text-muted-foreground">Sin categorías aún</span>
                  )}
                  {categories.length > 0 && visibleCats.length === 0 && (
                    <div className="w-full rounded-md border border-emerald-200 bg-emerald-50/80 dark:border-emerald-900 dark:bg-emerald-950/30 px-3 py-3 text-center">
                      <p className="text-xs font-medium text-emerald-800 dark:text-emerald-200">
                        No hay categorías pendientes este mes ✓
                      </p>
                      <p className="mt-1 text-[10px] text-muted-foreground">
                        Todas las auditorías del mes ya están en el historial.
                        {closedCount > 0 && (
                          <>{" "}
                            <button
                              type="button"
                              className="underline text-emerald-700 dark:text-emerald-300"
                              onClick={() => setShowClosedCategories(true)}
                            >
                              Mostrar las {closedCount} cerradas
                            </button>
                          </>
                        )}
                      </p>
                    </div>
                  )}
                </div>
              </>
            );
          })()}
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
                <div className="mt-1 inline-flex overflow-hidden rounded-md border">
                  {(["A", "B"] as const).map((b) => {
                    const bothSelected = !!category && bothClosed;
                    const active = bothSelected || branch === b;
                    return (
                      <button key={b} type="button" onClick={() => setCollabBranch(b)}
                        className={`px-4 py-1.5 text-sm font-medium transition-colors ${active ? "bg-primary text-primary-foreground" : "bg-background hover:bg-muted"}`}>
                        {b === "A" ? "Mina" : "Morelos"}
                      </button>
                    );
                  })}
                </div>
              ) : (
                <div className="mt-1 inline-flex overflow-hidden rounded-md border">
                  <div className="bg-primary text-primary-foreground px-4 py-1.5 text-sm font-medium">
                    {branch === "A" ? "Mina" : "Morelos"}
                  </div>
                </div>
              )}
            </div>
          </div>

          {!me?.is_admin && (
            <p className="text-[11px] text-muted-foreground">
              Estás contando para <strong>{branch === "A" ? "Sucursal Mina" : "Sucursal Morelos"}</strong>.
              Solo podés guardar conteos de tu sucursal.
            </p>
          )}

          {category && (
            <div className="flex gap-2">
              <div className={`flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${minaDone ? "bg-emerald-100 text-emerald-700" : "bg-muted text-muted-foreground"}`}>
                {minaDone ? "✓" : "○"} Mina
              </div>
              <div className={`flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${morelosDone ? "bg-emerald-100 text-emerald-700" : "bg-muted text-muted-foreground"}`}>
                {morelosDone ? "✓" : "○"} Morelos
              </div>
              {me?.is_admin && bothClosed && (
                <span className="ml-auto text-xs text-emerald-600 font-medium">¡Listas para el cierre general!</span>
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

      {category && branchLocked && (
        <div className={`flex flex-col items-center gap-2 rounded-md border py-8 text-center ${alreadyCountedThisMonth ? "border-emerald-300 bg-emerald-50 dark:bg-emerald-950/20" : "border-amber-300 bg-amber-50 dark:bg-amber-950/20"}`}>
          <CheckCircle2 className={`h-8 w-8 ${alreadyCountedThisMonth ? "text-emerald-600" : "text-amber-600"}`} />
          <p className={`text-sm font-medium ${alreadyCountedThisMonth ? "text-emerald-800 dark:text-emerald-200" : "text-amber-800 dark:text-amber-200"}`}>
            {alreadyCountedThisMonth
              ? `"${category}" ya se contó este mes en ${branchLabel(branch)}`
              : `Cerraste el conteo de "${category}" en ${branchLabel(branch)} ✓`}
          </p>
          <p className="text-xs text-muted-foreground max-w-xs">
            {alreadyCountedThisMonth
              ? `Solo se permite un conteo por categoría al mes (${monthLabel()}).`
              : bothClosed
                ? "Las dos sucursales ya cerraron su conteo. Falta el cierre general del administrador."
                : `Falta que ${branchLabel(branch === "A" ? "B" : "A")} cierre su conteo.`}
          </p>
          <div className="flex flex-wrap justify-center gap-2">
            <Button size="sm" variant="outline" onClick={() => setReportCategory(category)}>Ver reporte</Button>
            {me?.is_admin && bothClosed && !alreadyCountedThisMonth && (
              <Button size="sm" className="bg-emerald-600 hover:bg-emerald-700" onClick={() => setCloseDialog(true)}>
                <Flag className="h-4 w-4" /> Cerrar conteo general
              </Button>
            )}
            {me?.is_admin && (
              <Button size="sm" variant="outline"
                className="border-amber-400 text-amber-700 hover:bg-amber-50 dark:text-amber-300"
                onClick={() => setAdminAction({ type: "reset", category, branch })}>
                <RotateCcw className="h-4 w-4" /> Reiniciar (admin)
              </Button>
            )}
            {me?.is_admin && (
              <Button size="sm" variant="outline"
                className="border-red-400 text-red-700 hover:bg-red-50 dark:text-red-300"
                onClick={() => setAdminAction({ type: "wipeCategory", category, zeroStock: true })}>
                <Trash2 className="h-4 w-4" /> Dejar en ceros
              </Button>
            )}
            {me?.is_admin && myBranchClosed && !alreadyCountedThisMonth && (
              <Button size="sm" variant="outline"
                className="border-blue-400 text-blue-700 hover:bg-blue-50 dark:text-blue-300"
                onClick={() => setAdminAction({ type: "restoreClosure", category, branch })}>
                <RotateCcw className="h-4 w-4" /> Reactivar categoría
              </Button>
            )}
          </div>
        </div>
      )}

      {category && !branchLocked && (
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
                        <div className={`font-medium text-xs leading-tight ${isCounted ? "" : "text-muted-foreground"}`}>{p.product_name}</div>
                        <div className="font-mono text-[10px] text-muted-foreground whitespace-nowrap overflow-x-auto">
                          {p.barcode}
                          {sys < 0 && <span className={`ml-1 font-semibold ${stockColor(sys)}`}>⚠ {sys}</span>}
                          {sys === 0 && <span className={`ml-1 font-semibold ${stockColor(sys)}`}>● 0</span>}
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
                          onFocus={(e) => {
                            e.target.select();
                            qtyEditingRef.current = p.barcode;
                            setQtyEditingBarcode(p.barcode);
                          }}
                          onChange={(e) => {
                            const raw = e.target.value;
                            // Pistola suele pegar muchos dígitos de golpe → no tratarlo como cantidad
                            if (raw.length >= 6) {
                              toast.error("Se detectó un código de barras. Salí del campo de cantidad antes de pistolear.");
                              return;
                            }
                            const n = raw === "" ? 0 : Math.max(0, parseInt(raw, 10) || 0);
                            setCount(p.barcode, n);
                          }}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") {
                              e.preventDefault();
                              qtyEditingRef.current = null;
                              setQtyEditingBarcode(null);
                              scanRef.current?.focus();
                            }
                          }}
                          onBlur={() => {
                            qtyEditingRef.current = null;
                            setQtyEditingBarcode(null);
                            // No robar foco si el usuario tocó otro control
                            window.setTimeout(() => {
                              if (!qtyEditingRef.current) scanRef.current?.focus();
                            }, 50);
                          }}
                          className={`w-9 rounded border border-input bg-transparent text-center text-sm tabular-nums font-bold focus:outline-none focus:ring-2 focus:ring-primary ${isCounted ? "text-emerald-700" : "text-muted-foreground"} ${qtyEditingBarcode === p.barcode ? "ring-2 ring-amber-400" : ""}`}
                        />
                        <button type="button" onClick={() => addCount(p.barcode)}
                          className="flex h-7 w-7 items-center justify-center rounded-full border font-bold hover:bg-muted active:scale-95">
                          <Plus className="h-3 w-3" />
                        </button>
                      </div>
                    </div>

                    {/* Comentario inline por producto */}
                    {(() => {
                      const pc = prodComments.get(p.barcode) ?? { open: false, text: "" };
                      const rows = prodCommentRows.get(p.barcode) ?? [];
                      return (
                        <div className="mt-1.5">
                          <button
                            type="button"
                            onClick={() => toggleProdComment(p.barcode, p.product_name, p.category)}
                            className="text-[11px] text-muted-foreground hover:text-primary transition-colors"
                          >
                            💬 {pc.open ? "Ocultar comentario" : rows.length > 0 ? `Comentario (${rows.length})` : "Comentar"}
                          </button>
                          {pc.open && (
                            <div className="mt-1 space-y-1 rounded-md border bg-muted/20 p-2">
                              {rows.map((c) => (
                                <div key={c.id} className="text-[10px]">
                                  <span className="font-medium text-foreground">{c.collaborator_name ?? "—"}</span>
                                  <span className="text-muted-foreground ml-1">
                                    · {new Date(c.created_at).toLocaleDateString("es-MX", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}
                                  </span>
                                  <p className="text-foreground mt-0.5">{c.comment}</p>
                                </div>
                              ))}
                              <div className="flex gap-1.5 pt-1">
                                <input
                                  type="text"
                                  value={pc.text}
                                  onChange={(e) => setProdComments((m) => new Map(m).set(p.barcode, { ...(m.get(p.barcode) ?? { open: true, text: "" }), open: true, text: e.target.value }))}
                                  placeholder="Comentario sobre este producto…"
                                  className="flex-1 rounded border bg-background px-2 py-1 text-[11px] focus:outline-none focus:ring-1 focus:ring-primary"
                                />
                                <button
                                  type="button"
                                  onClick={() => sendProdComment(p.barcode, p.product_name, p.category)}
                                  disabled={pc.sending || !pc.text.trim()}
                                  className="rounded bg-primary px-2 py-1 text-[11px] text-primary-foreground disabled:opacity-40"
                                >
                                  {pc.sending ? <Loader2 className="h-3 w-3 animate-spin" /> : "Enviar"}
                                </button>
                              </div>
                            </div>
                          )}
                        </div>
                      );
                    })()}
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

            <div className="mt-3">
              <Button onClick={() => setCloseBranchDialog(true)} disabled={saving || closingBranch}
                className="w-full bg-amber-600 hover:bg-amber-700">
                {closingBranch ? <Loader2 className="h-4 w-4 animate-spin" /> : <Flag className="h-4 w-4" />}
                Cerrar conteo de {branchLabel(branch)}
              </Button>
              <p className="mt-1 px-1 text-[11px] text-muted-foreground">
                Se guardan tus {counts.size} producto{counts.size === 1 ? "" : "s"} contados y lo que no contaste queda en 0.
              </p>
              {me?.is_admin && (
                <Button variant="outline" size="sm"
                  className="mt-2 w-full border-red-400 text-red-700 hover:bg-red-50 dark:text-red-300"
                  onClick={() => setAdminAction({ type: "wipeCategory", category, zeroStock: true })}>
                  <Trash2 className="h-4 w-4" /> Dejar categoría en ceros (admin)
                </Button>
              )}
            </div>

            {me?.is_admin && category && bothClosed && (
              <div className="mt-3 rounded-md border border-emerald-300 bg-emerald-50 dark:bg-emerald-950/20 p-3">
                <div className="mb-2 flex items-center gap-2 text-xs font-medium text-emerald-700 dark:text-emerald-300">
                  <Flag className="h-3.5 w-3.5" /> Cierre general — Solo administrador
                </div>
                <p className="mb-3 text-xs text-muted-foreground">
                  Mina ✓ y Morelos ✓ ya cerraron su conteo. Al cerrar en general, "{category}" quedará en verde y se guardará el reporte con los comentarios.
                </p>
                <Button onClick={() => setCloseDialog(true)} className="w-full bg-emerald-600 hover:bg-emerald-700">
                  <Flag className="h-4 w-4" /> Cerrar conteo general de "{category}"
                </Button>
              </div>
            )}
            {me?.is_admin && category && !bothClosed && (
              <div className="mt-2 rounded-md border border-dashed px-3 py-2 text-xs text-muted-foreground">
                <Flag className="mb-1 h-3.5 w-3.5 inline mr-1" />
                El cierre general se habilita cuando las dos sucursales cierren su conteo.
                {!closedA && " Falta: Mina."}{!closedB && " Falta: Morelos."}
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

      {/* ── Dialog: cerrar conteo por sucursal ── */}
      <Dialog open={closeBranchDialog} onOpenChange={(o) => { if (!o && !closingBranch) setCloseBranchDialog(false); }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-amber-700 dark:text-amber-300">
              <AlertTriangle className="h-5 w-5" /> ¿Seguro que quieres cerrar este conteo?
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-2 text-sm text-muted-foreground">
            <p>Revisá bien tus datos antes de continuar — esta acción no se puede deshacer.</p>
            <p>
              Asegurate de que estás en <strong className="text-foreground">tu sesión correcta</strong>
              {me?.name ? <> ({me.name})</> : null} y que estás contando en la sucursal correcta:{" "}
              <strong className="text-foreground">{branchLabel(branch)}</strong>.
            </p>
            <p>
              Lo que no se contó en "<strong className="text-foreground">{category}</strong>" se guardará como <strong className="text-foreground">0</strong>.
            </p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCloseBranchDialog(false)} disabled={closingBranch}>Cancelar</Button>
            <Button onClick={closeBranchCount} disabled={closingBranch} className="bg-amber-600 hover:bg-amber-700">
              {closingBranch ? <Loader2 className="h-4 w-4 animate-spin" /> : <Flag className="h-4 w-4" />}
              Cerrar conteo
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
              <div className={`rounded-md border p-2 text-center ${closedA ? "border-emerald-400 bg-emerald-50" : "border-amber-300 bg-amber-50"}`}>
                <div className="text-xs font-medium text-muted-foreground mb-1">{closedA ? "✓" : "○"} Mina</div>
                <div className={`text-lg font-bold ${closedA ? "text-emerald-700" : "text-amber-600"}`}>
                  {realtimeMina.size} escaneados
                </div>
                <div className="text-[10px] text-muted-foreground">{closedA ? "Conteo cerrado" : "Pendiente"}</div>
              </div>
              <div className={`rounded-md border p-2 text-center ${closedB ? "border-emerald-400 bg-emerald-50" : "border-amber-300 bg-amber-50"}`}>
                <div className="text-xs font-medium text-muted-foreground mb-1">{closedB ? "✓" : "○"} Morelos</div>
                <div className={`text-lg font-bold ${closedB ? "text-emerald-700" : "text-amber-600"}`}>
                  {realtimeMorelos.size} escaneados
                </div>
                <div className="text-[10px] text-muted-foreground">{closedB ? "Conteo cerrado" : "Pendiente"}</div>
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
            const bc = branchClosureMap.get(reportCategory);
            // Verde solo cuando el admin ya cerró (existe en closed_counts). Misma regla que los botones de categoría.
            const bothDoneReport = closedCountsCategories.has(reportCategory.trim());
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
                    const prodComments = reportComments.filter(
                      (c) => c.barcode === r.barcode || (!c.barcode && c.product_name === r.product_name)
                    );
                    return (
                      <div key={r.barcode}
                        className={`px-3 py-2.5 text-xs ${diff === 0 ? "bg-emerald-50 dark:bg-emerald-950/20" : diff < 0 ? "bg-red-50 dark:bg-red-950/20" : "bg-amber-50 dark:bg-amber-950/20"}`}>
                        <div className="flex items-center gap-2">
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
                        {prodComments.length > 0 && (
                          <div className="mt-1.5 space-y-1 rounded border border-blue-200/60 bg-blue-50/50 p-1.5 dark:border-blue-900 dark:bg-blue-950/20">
                            {prodComments.map((c) => (
                              <div key={c.id} className="text-[10px]">
                                <span className="font-medium text-foreground">{c.collaborator_name ?? "—"}</span>
                                {c.branch && <span className="text-muted-foreground"> · {branchLabel(c.branch)}</span>}
                                <span className="text-muted-foreground">
                                  {" · "}
                                  {new Date(c.created_at).toLocaleDateString("es-MX", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}
                                </span>
                                <p className="text-foreground mt-0.5">{c.comment}</p>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    );
                  })}
                  {rows.length === 0 && <div className="p-3 text-xs text-muted-foreground">Sin conteos registrados este mes.</div>}
                </div>

                {/* Resumen de comentarios de la categoría (incluye genéricos sin producto) */}
                {reportComments.length > 0 && (
                  <div className="space-y-1.5">
                    <p className="text-[11px] font-medium text-blue-700 dark:text-blue-300">
                      Comentarios del corte ({reportComments.length})
                    </p>
                    <div className="max-h-40 space-y-1.5 overflow-y-auto rounded-md border bg-muted/30 p-2">
                      {reportComments.map((c) => (
                        <div key={c.id} className="text-[11px]">
                          <div className="flex flex-wrap items-center gap-1 text-muted-foreground">
                            <span className="font-medium text-foreground">{c.collaborator_name ?? "—"}</span>
                            {c.branch && <span>· {branchLabel(c.branch)}</span>}
                            {c.product_name && <span>· {c.product_name}</span>}
                            <span>· {new Date(c.created_at).toLocaleDateString("es-MX", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}</span>
                          </div>
                          <p className="text-foreground">{c.comment}</p>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {reportLiveRows.length > 0 && (
                  <div className="space-y-1.5">
                    <p className="text-[11px] font-medium text-blue-700 dark:text-blue-300">
                      Conteo en vivo actual {rows.length === 0 ? "(aún sin cerrar)" : "(puede incluir escaneos del corte ya cerrado)"}
                    </p>
                    <div className="divide-y rounded-md border border-blue-200 dark:border-blue-900">
                      {reportLiveRows
                        .sort((a, b) => (a.total - a.system_stock) - (b.total - b.system_stock))
                        .map((r) => {
                          const diff = r.total - r.system_stock;
                          return (
                            <div key={r.barcode} className="flex items-center gap-2 px-3 py-2 text-xs bg-blue-50/60 dark:bg-blue-950/10">
                              <div className="min-w-0 flex-1">
                                <div className="font-medium truncate">{r.product_name}</div>
                                <div className="font-mono text-muted-foreground">{r.barcode}</div>
                              </div>
                              <div className="shrink-0 text-right space-y-0.5">
                                <div className="text-muted-foreground">Sys: {r.system_stock} · Mina: {r.mina} · Morelos: {r.morelos}</div>
                                <div className={`font-bold ${diff === 0 ? "text-emerald-600" : diff < 0 ? "text-red-600" : "text-amber-600"}`}>
                                  {diff === 0 ? "✓ Sin diferencia" : diff > 0 ? `+${diff} SOBRA` : `${diff} FALTA`}
                                </div>
                              </div>
                            </div>
                          );
                        })}
                    </div>
                  </div>
                )}
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
                    <div className="flex flex-wrap gap-2">
                      {(["A", "B"] as const).map((b) => (
                        <Button key={`restore-${b}`} size="sm" variant="outline"
                          disabled={!(b === "A" ? bc?.A : bc?.B)}
                          className="border-blue-400 text-blue-700 hover:bg-blue-100 dark:text-blue-300"
                          onClick={() => setAdminAction({ type: "restoreClosure", category: reportCategory!, branch: b })}>
                          <RotateCcw className="h-3.5 w-3.5" /> Reactivar {branchLabel(b)}
                        </Button>
                      ))}
                    </div>
                    <Button size="sm" variant="outline"
                      className="border-red-400 text-red-700 hover:bg-red-50 dark:text-red-300"
                      onClick={() => setAdminAction({ type: "wipeCategory", category: reportCategory!, zeroStock: true })}>
                      <Trash2 className="h-3.5 w-3.5" /> Dejar categoría en ceros
                    </Button>
                    <Button size="sm" variant="outline"
                      className="w-full border-emerald-400 text-emerald-700 hover:bg-emerald-100 dark:text-emerald-300"
                      onClick={() => setAdminAction({ type: "regenerateReport", category: reportCategory! })}>
                      <Save className="h-3.5 w-3.5" /> Volver a guardar conteo general de "{reportCategory}"
                    </Button>
                    <Button size="sm" variant="outline"
                      className="w-full border-slate-400 text-slate-700 hover:bg-slate-100 dark:text-slate-300"
                      onClick={() => setProductEditOpen(true)}>
                      <Pencil className="h-3.5 w-3.5" /> Editar un producto (código, categoría, stock, precio)
                    </Button>
                    <div className="space-y-1.5">
                      <p className="text-[11px] font-medium text-muted-foreground">Registros individuales</p>
                      <div className="max-h-56 divide-y overflow-y-auto rounded-md border bg-background">
                        {monthlyHistory.filter((h) => (h.category ?? "").trim() === (reportCategory ?? "").trim()).map((h) => (
                          <AdminHistoryRow key={h.id} row={h}
                            onEdit={() => setAdminAction({ type: "editRow", row: h, newQty: h.counted_quantity })}
                            onDelete={() => setAdminAction({ type: "deleteRow", row: h })} />
                        ))}
                        {monthlyHistory.filter((h) => (h.category ?? "").trim() === (reportCategory ?? "").trim()).length === 0 && (
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

      {/* ── Editar producto (admin) ── */}
      <Dialog open={productEditOpen} onOpenChange={(o) => { if (!o) closeProductEdit(); }}>
        <DialogContent className="max-h-[90vh] max-w-md overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-1.5">
              <Pencil className="h-4 w-4" /> Editar producto
            </DialogTitle>
          </DialogHeader>
          {!editingProduct ? (
            <div className="space-y-2">
              <div className="relative">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input autoFocus value={productQuery} onChange={(e) => setProductQuery(e.target.value)}
                  placeholder="Buscar por nombre o código de barras…" className="pl-9" />
              </div>
              <div className="max-h-72 divide-y overflow-auto rounded-md border">
                {productSearchResults.map((p) => (
                  <button key={p.barcode} type="button" onClick={() => pickProductToEdit(p)}
                    className="flex w-full items-center justify-between px-3 py-2 text-left text-sm hover:bg-muted">
                    <div className="min-w-0">
                      <div className="truncate font-medium">{p.product_name}</div>
                      <div className="font-mono text-xs text-muted-foreground">{p.barcode} · {p.category ?? "Sin categoría"}</div>
                    </div>
                  </button>
                ))}
                {productQuery.trim().length >= 2 && productSearchResults.length === 0 && (
                  <div className="p-3 text-xs text-muted-foreground">Sin resultados</div>
                )}
                {productQuery.trim().length < 2 && (
                  <div className="p-3 text-xs text-muted-foreground">Escribí al menos 2 caracteres para buscar.</div>
                )}
              </div>
            </div>
          ) : (
            <div className="space-y-3 text-sm">
              <button type="button" onClick={() => setEditingProduct(null)} className="text-xs text-muted-foreground underline">
                ← Buscar otro producto
              </button>
              <div>
                <label className="text-xs font-medium text-muted-foreground">Código de barras</label>
                <Input value={epBarcode} onChange={(e) => setEpBarcode(e.target.value)} className="font-mono" />
              </div>
              <div>
                <label className="text-xs font-medium text-muted-foreground">Nombre</label>
                <Input value={epName} onChange={(e) => setEpName(e.target.value)} />
              </div>
              <div>
                <label className="text-xs font-medium text-muted-foreground">Categoría</label>
                <input list="edit-product-categories" value={epCategory} onChange={(e) => setEpCategory(e.target.value)}
                  className="mt-1 h-9 w-full rounded-md border bg-background px-2 text-sm" placeholder="Elegir o escribir categoría…" />
                <datalist id="edit-product-categories">
                  {categories.map((c) => <option key={c} value={c} />)}
                </datalist>
              </div>
              <div className="grid grid-cols-3 gap-2">
                <div>
                  <label className="text-xs font-medium text-muted-foreground">Stock Mina</label>
                  <Input type="number" value={epStockA} onChange={(e) => setEpStockA(Number(e.target.value) || 0)} />
                </div>
                <div>
                  <label className="text-xs font-medium text-muted-foreground">Stock Morelos</label>
                  <Input type="number" value={epStockB} onChange={(e) => setEpStockB(Number(e.target.value) || 0)} />
                </div>
                <div>
                  <label className="text-xs font-medium text-muted-foreground">Precio</label>
                  <Input type="number" value={epPrice} onChange={(e) => setEpPrice(Number(e.target.value) || 0)} />
                </div>
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={closeProductEdit}>Cancelar</Button>
            {editingProduct && (
              <Button
                onClick={() => setAdminAction({
                  type: "editProduct",
                  oldBarcode: editingProduct.barcode,
                  data: { barcode: epBarcode, product_name: epName, category: epCategory || null, stock_a: epStockA, stock_b: epStockB, price: epPrice },
                })}>
                <Save className="h-4 w-4" /> Guardar cambios
              </Button>
            )}
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
              {adminAction?.type === "restoreClosure" && "Reactivar categoría"}
              {adminAction?.type === "regenerateReport" && "Volver a guardar conteo general"}
              {adminAction?.type === "wipeCategory" && "Dejar categoría en ceros"}
              {adminAction?.type === "editProduct" && "Editar producto"}
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
            {adminAction?.type === "restoreClosure" && (
              <p className="text-muted-foreground">
                Se eliminará el cierre de <strong>"{adminAction.category}"</strong> en{" "}
                <strong>{branchLabel(adminAction.branch)}</strong> para volver a permitir el conteo este mes.
              </p>
            )}
            {adminAction?.type === "regenerateReport" && (
              <p className="text-muted-foreground">
                Se borrará y se volverá a guardar el reporte general y el historial de{" "}
                <strong>"{adminAction.category}"</strong> este mes, usando los conteos en vivo actuales.
              </p>
            )}
            {adminAction?.type === "wipeCategory" && (
              <div className="space-y-2 text-muted-foreground">
                <p>
                  Se borrarán <strong>todos</strong> los conteos de <strong>"{adminAction.category}"</strong> de este mes en{" "}
                  <strong>Mina y Morelos</strong>: conteos en vivo, cierres de sucursal, cierre general e historial del mes.
                  La categoría quedará lista para contar desde cero.
                </p>
                <label className="flex items-center gap-2 text-xs">
                  <input type="checkbox" checked={adminAction.zeroStock}
                    onChange={(e) => setAdminAction((prev) =>
                      prev && prev.type === "wipeCategory" ? { ...prev, zeroStock: e.target.checked } : prev
                    )} />
                  También poner en 0 el stock del sistema (para importar las nuevas cantidades)
                </label>
                <p className="text-xs font-medium text-red-600">Esta acción no se puede deshacer.</p>
              </div>
            )}
            {adminAction?.type === "editProduct" && (
              <p className="text-muted-foreground">
                Se actualizará el producto <strong>"{adminAction.data.product_name}"</strong>.
              </p>
            )}
            {adminAction?.type !== "restoreClosure" && (
              <div>
                <label className="text-xs font-medium text-muted-foreground">Tu PIN de administrador</label>
                <Input type="password" inputMode="numeric" autoFocus value={adminPin}
                  onChange={(e) => setAdminPin(e.target.value.replace(/\D/g, ""))}
                  placeholder="PIN" className="mt-1" />
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setAdminAction(null); setAdminPin(""); }}>Cancelar</Button>
            <Button variant="destructive" disabled={adminBusy} onClick={confirmAdminAction}>
              {adminBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : null} Confirmar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Comentarios y reportes ── */}
      <Card>
        <CardContent className="p-3 space-y-2">
          <div className="flex items-center gap-2 text-sm font-semibold">
            <MessageSquare className="h-4 w-4" /> Comentarios y reportes
          </div>
          <p className="text-[11px] text-muted-foreground">
            Anotá acá errores encontrados, desperfectos o sugerencias{category ? ` sobre "${category}" (${branchLabel(branch)})` : ""}.
          </p>
          <Textarea value={commentText} onChange={(e) => setCommentText(e.target.value)}
            placeholder="Escribí tu comentario…" rows={3} />
          <Button size="sm" onClick={sendComment} disabled={commentSending || !commentText.trim()}>
            {commentSending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
            Enviar comentario
          </Button>
          {recentComments.length > 0 && (
            <div className="mt-2 max-h-40 space-y-2 overflow-y-auto rounded-md border bg-muted/30 p-2">
              {recentComments.map((c) => (
                <div key={c.id} className="text-[11px]">
                  <div className="flex flex-wrap items-center gap-1 text-muted-foreground">
                    <span className="font-medium text-foreground">{c.collaborator_name ?? "—"}</span>
                    {c.branch && <span>· {branchLabel(c.branch)}</span>}
                    {c.category && <span>· {c.category}</span>}
                    <span>· {new Date(c.created_at).toLocaleDateString("es-MX", { day: "numeric", month: "short" })}</span>
                  </div>
                  <p className="text-foreground">{c.comment}</p>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

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
