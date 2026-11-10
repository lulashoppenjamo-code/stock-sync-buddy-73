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
  return `\( {now.getFullYear()}- \){String(now.getMonth() + 1).padStart(2, "0")}-01`;
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

  // Sucursal del colaborador: online desde Supabase, offline desde caché IndexedDB
  // (misma lógica que en traspasos para no cambiar de sucursal al perder internet)
  const { data: collabData } = useQuery({
    queryKey: ["collab-branch", me?.id, online],
    enabled: !!me?.id,
    staleTime: online ? 60_000 : Infinity,
    queryFn: async () => {
      if (!online) {
        const { getCachedCollaborators } = await import("@/lib/offline-cache");
        const list = await getCachedCollaborators();
        const found = list.find((c) => c.id === me!.id);
        return found ? { branch: found.branch ?? "A" } : { branch: "A" };
      }
      try {
        const { data } = await supabase
          .from("collaborators")
          .select("branch")
          .eq("id", me!.id)
          .maybeSingle();
        return data as { branch: string } | null;
      } catch {
        const { getCachedCollaborators } = await import("@/lib/offline-cache");
        const list = await getCachedCollaborators();
        const found = list.find((c) => c.id === me!.id);
        return found ? { branch: found.branch ?? "A" } : { branch: "A" };
      }
    },
  });

  const myBranch = useMemo((): "A" | "B" => {
    if (me?.is_admin) return collabBranch ?? "A";
    // Preferir sucursal de la sesión (guardada al login), luego query/caché
    const fromSession = me?.branch;
    if (fromSession === "A" || fromSession === "B") return fromSession;
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
  const scanRef = useRef<
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
                  La categoría quedará lista para contar desde cero. El stock del sistema no se modifica.
                </p>
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
            Anotá acá errores encontrados, desperfectos o sugerencias{category ? ` sobre "\( {category}" ( \){branchLabel(branch)})` : ""}.
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

      <BarcodeScanner
        open={scanning}
        onClose={() => setScanning(false)}
        continuous
        onDetected={(code) => addCount(code, true)}
        countEntries={Array.from(counts.values())}
        onChangeCount={setCount}
      />
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
