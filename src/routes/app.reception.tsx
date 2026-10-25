import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Camera, Check, Loader2, PackageCheck, ChevronDown, ChevronUp, ScanLine, WifiOff } from "lucide-react";
import { toast } from "sonner";
import { getCollaborator, useCollaborator } from "@/lib/session";
import { BRANCH_LABELS } from "@/lib/branches";
import { BarcodeScanner } from "@/components/BarcodeScanner";
import { useOnline } from "@/hooks/use-online";

export const Route = createFileRoute("/app/reception")({
  component: ReceptionPage,
});

type PendingTransfer = {
  id: string;
  barcode: string;
  product_name: string;
  quantity: number;
  origin: "A" | "B";
  destination: "A" | "B";
  sender_name: string;
  receiver_name: string;
  photo_url: string;
  created_at: string;
  client_uid: string | null;
};

type BatchGroup = {
  batchId: string;
  items: PendingTransfer[];
  origin: "A" | "B";
  destination: "A" | "B";
  sender_name: string;
  receiver_name: string;
  photo_url: string;
  created_at: string;
  totalQuantity: number;
};

function extractBatchId(client_uid: string | null, fallback: string): string {
  if (!client_uid) return fallback;
  const match = client_uid.match(/^transfer-([a-f0-9\-]{36})-/);
  return match ? match[1] : fallback;
}

// --- Persistencia local del progreso de recepción ---
// Evita perder las unidades ya pistoleadas si se sale accidentalmente
// de la pantalla o se toca otra sección antes de confirmar.
const PROGRESS_PREFIX = "reception-progress-";

type SavedProgress = {
  scannedCounts: Record<string, number>;
  sender?: string;
  receiver?: string;
};

function loadReceptionProgress(batchId: string): SavedProgress | null {
  try {
    const raw = localStorage.getItem(PROGRESS_PREFIX + batchId);
    if (!raw) return null;
    return JSON.parse(raw) as SavedProgress;
  } catch {
    return null;
  }
}

function saveReceptionProgress(
  batchId: string,
  scannedCounts: Map<string, number>,
  sender: string,
  receiver: string
) {
  try {
    localStorage.setItem(
      PROGRESS_PREFIX + batchId,
      JSON.stringify({
        scannedCounts: Object.fromEntries(scannedCounts),
        sender,
        receiver,
      })
    );
  } catch {
    // almacenamiento no disponible, se ignora
  }
}

function clearReceptionProgress(batchId: string) {
  try {
    localStorage.removeItem(PROGRESS_PREFIX + batchId);
  } catch {
    // no-op
  }
}

function groupByBatch(transfers: PendingTransfer[]): BatchGroup[] {
  const map = new Map<string, BatchGroup>();
  for (const t of transfers) {
    const batchId = extractBatchId(t.client_uid, t.id);
    if (!map.has(batchId)) {
      map.set(batchId, {
        batchId,
        items: [],
        origin: t.origin,
        destination: t.destination,
        sender_name: t.sender_name,
        receiver_name: t.receiver_name,
        photo_url: t.photo_url,
        created_at: t.created_at,
        totalQuantity: 0,
      });
    }
    const group = map.get(batchId)!;
    group.items.push(t);
    group.totalQuantity += t.quantity;
  }
  return Array.from(map.values()).sort(
    (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
  );
}

// Cola local de recepciones confirmadas sin red
const OFFLINE_RECEPTIONS_KEY = "inv.offline.receptions.v1";
type OfflineReception = {
  id: string;
  batchId: string;
  transferIds: string[];
  received_by_id: string;
  received_by_name: string;
  received_sender_name: string;
  received_receiver_name: string;
  received_scanned_barcode: string;
  photoBase64: string;
  photoType: string;
  photoName: string;
  savedAt: number;
};

function loadOfflineReceptions(): OfflineReception[] {
  try {
    const r = localStorage.getItem(OFFLINE_RECEPTIONS_KEY);
    return r ? (JSON.parse(r) as OfflineReception[]) : [];
  } catch {
    return [];
  }
}
function saveOfflineReception(t: OfflineReception) {
  try {
    const existing = loadOfflineReceptions();
    existing.push(t);
    localStorage.setItem(OFFLINE_RECEPTIONS_KEY, JSON.stringify(existing));
  } catch { /* ignore */ }
}
function removeOfflineReception(id: string) {
  try {
    const existing = loadOfflineReceptions().filter((x) => x.id !== id);
    localStorage.setItem(OFFLINE_RECEPTIONS_KEY, JSON.stringify(existing));
  } catch { /* ignore */ }
}

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve((reader.result as string).split(",")[1] ?? "");
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}
function base64ToBlob(base64: string, type: string): Blob {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type });
}

function ReceptionPage() {
  const qc = useQueryClient();
  const online = useOnline();
  const [activeBatch, setActiveBatch] = useState<BatchGroup | null>(null);
  const [expandedBatch, setExpandedBatch] = useState<string | null>(null);
  const [pendingOfflineReceptions, setPendingOfflineReceptions] = useState<OfflineReception[]>(() => loadOfflineReceptions());
  const [syncingOffline, setSyncingOffline] = useState(false);

  const { data: pending = [], isLoading } = useQuery({
    queryKey: ["pending-transfers", online],
    queryFn: async () => {
      if (!online) {
        const { getCachedPendingTransfers } = await import("@/lib/offline-cache");
        return getCachedPendingTransfers<PendingTransfer>();
      }
      try {
        const { data, error } = await supabase
          .from("transfers")
          .select("id, barcode, product_name, quantity, origin, destination, sender_name, receiver_name, photo_url, created_at, client_uid")
          .is("received_at", null)
          .order("created_at", { ascending: false })
          .limit(200);
        if (error) throw error;
        const rows = (data ?? []) as PendingTransfer[];
        const { setCachedPendingTransfers } = await import("@/lib/offline-cache");
        await setCachedPendingTransfers(rows);
        return rows;
      } catch {
        const { getCachedPendingTransfers } = await import("@/lib/offline-cache");
        return getCachedPendingTransfers<PendingTransfer>();
      }
    },
    staleTime: online ? 15_000 : Infinity,
    refetchInterval: online ? 30_000 : false,
  });

  // Ocultar lotes ya confirmados offline (pendientes de sync)
  const offlineReceivedIds = new Set(
    pendingOfflineReceptions.flatMap((r) => r.transferIds),
  );
  const visiblePending = pending.filter((p) => !offlineReceivedIds.has(p.id));
  const batches = groupByBatch(visiblePending);

  // Sincronizar recepciones offline al volver internet
  useEffect(() => {
    if (!online || syncingOffline) return;
    const queue = loadOfflineReceptions();
    if (queue.length === 0) return;
    let cancelled = false;
    (async () => {
      setSyncingOffline(true);
      let ok = 0;
      for (const item of queue) {
        if (cancelled) break;
        try {
          const blob = base64ToBlob(item.photoBase64, item.photoType || "image/jpeg");
          const ext = (item.photoName.split(".").pop() || "jpg").toLowerCase();
          const path = `received-batch-${item.batchId}.${ext}`;
          const up = await supabase.storage
            .from("transfer-photos")
            .upload(path, blob, { contentType: item.photoType || "image/jpeg", upsert: true });
          if (up.error) throw up.error;
          const { data: signed } = await supabase.storage
            .from("transfer-photos")
            .createSignedUrl(path, 60 * 60 * 24 * 365);
          const received_photo_url = signed?.signedUrl ?? path;
          const { error } = await supabase
            .from("transfers")
            .update({
              received_at: new Date().toISOString(),
              received_by_id: item.received_by_id,
              received_by_name: item.received_by_name,
              received_photo_url,
              received_scanned_barcode: item.received_scanned_barcode,
              received_sender_name: item.received_sender_name,
              received_receiver_name: item.received_receiver_name,
            })
            .in("id", item.transferIds);
          if (error) throw error;
          removeOfflineReception(item.id);
          ok++;
        } catch (e) {
          console.warn("[reception] offline sync failed", item.id, e);
        }
      }
      setPendingOfflineReceptions(loadOfflineReceptions());
      if (ok > 0) {
        toast.success(`${ok} recepción${ok === 1 ? "" : "es"} sincronizada${ok === 1 ? "" : "s"}`);
        qc.invalidateQueries({ queryKey: ["pending-transfers"] });
      }
      setSyncingOffline(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [online]);

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <h1 className="mr-auto text-xl font-semibold tracking-tight">Recepciones pendientes</h1>
        {!online && (
          <span className="flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800 dark:bg-amber-900/40 dark:text-amber-200">
            <WifiOff className="h-3 w-3" /> Sin internet
          </span>
        )}
        <span className="rounded-full bg-amber-100 px-2 py-1 text-xs font-medium text-amber-900 dark:bg-amber-900/40 dark:text-amber-100">
          {batches.length} envío{batches.length === 1 ? "" : "s"}
        </span>
      </div>

      {!online && (
        <div className="flex items-start gap-2 rounded-md border border-amber-300 bg-amber-50 dark:bg-amber-950/30 px-3 py-2 text-xs text-amber-800 dark:text-amber-200">
          <WifiOff className="h-4 w-4 mt-0.5 shrink-0" />
          <div>
            <p className="font-medium">Modo sin conexión</p>
            <p className="mt-0.5">
              Se muestran los envíos pendientes guardados en este dispositivo.
              Podés confirmar recepciones; se subirán al volver internet.
              {pendingOfflineReceptions.length > 0 && (
                <> · {pendingOfflineReceptions.length} pendiente{pendingOfflineReceptions.length === 1 ? "" : "s"} de sincronizar</>
              )}
            </p>
          </div>
        </div>
      )}

      <p className="text-xs text-muted-foreground">
        Cada tarjeta es un envío completo. Pistoleá cada unidad individualmente para confirmar la recepción.
      </p>

      {isLoading ? (
        <Card><CardContent className="grid place-items-center p-8"><Loader2 className="h-5 w-5 animate-spin" /></CardContent></Card>
      ) : batches.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-2 p-8 text-center text-sm text-muted-foreground">
            <PackageCheck className="h-8 w-8 text-emerald-500" />
            No hay traspasos pendientes de recibir.
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
          {batches.map((batch) => (
            <Card key={batch.batchId} className="overflow-hidden">
              <CardContent className="p-3 space-y-2">
                <div className="flex items-start gap-3">
                  {batch.photo_url && (
                    <img src={batch.photo_url} alt="envío" className="h-14 w-14 shrink-0 rounded-md border object-cover" />
                  )}
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-semibold">
                      {batch.items.length} producto{batch.items.length === 1 ? "" : "s"} · {batch.totalQuantity} unidades
                    </div>
                    <div className="mt-0.5 text-xs text-muted-foreground">
                      {BRANCH_LABELS[batch.origin]} → {BRANCH_LABELS[batch.destination]}
                    </div>
                    <div className="text-[11px] text-muted-foreground">
                      {new Date(batch.created_at).toLocaleString()} · de {batch.sender_name}
                    </div>
                  </div>
                  <Button size="sm" onClick={() => setActiveBatch(batch)}>
                    Recibir
                  </Button>
                </div>

                <button
                  type="button"
                  className="flex w-full items-center gap-1 text-xs text-muted-foreground"
                  onClick={() => setExpandedBatch(expandedBatch === batch.batchId ? null : batch.batchId)}
                >
                  {expandedBatch === batch.batchId ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
                  {expandedBatch === batch.batchId ? "Ocultar productos" : "Ver productos"}
                </button>

                {expandedBatch === batch.batchId && (
                  <div className="divide-y rounded-md border text-xs">
                    {batch.items.map((item) => (
                      <div key={item.id} className="flex items-center gap-2 px-2 py-1.5">
                        <div className="min-w-0 flex-1">
                          <div className="truncate font-medium">{item.product_name}</div>
                          <div className="font-mono text-muted-foreground">{item.barcode}</div>
                        </div>
                        <span className="shrink-0 font-semibold tabular-nums">×{item.quantity}</span>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <BatchReceiveDialog
        batch={activeBatch}
        online={online}
        onClose={() => setActiveBatch(null)}
        onDone={() => {
          setActiveBatch(null);
          setPendingOfflineReceptions(loadOfflineReceptions());
          qc.invalidateQueries({ queryKey: ["pending-transfers"] });
          qc.invalidateQueries({ queryKey: ["pending-transfers-count"] });
          qc.invalidateQueries({ queryKey: ["transfers"] });
        }}
      />
    </div>
  );
}

function BatchReceiveDialog({
  batch,
  online,
  onClose,
  onDone,
}: {
  batch: BatchGroup | null;
  online: boolean;
  onClose: () => void;
  onDone: () => void;
}) {
  const me = useCollaborator();
  const [photo, setPhoto] = useState<File | null>(null);
  const [scannerOpen, setScannerOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [sender, setSender] = useState<string>("");
  const [receiver, setReceiver] = useState<string>("");
  const [nameSearch, setNameSearch] = useState("");
  // Mapa item.id -> cuántas unidades se han recibido (debe llegar a item.quantity)
  // Se usa el id del artículo (no el código de barras) porque puede haber
  // más de un artículo sin código de barras en el mismo envío.
  const [scannedCounts, setScannedCounts] = useState<Map<string, number>>(new Map());
  const [scanInput, setScanInput] = useState("");
  // Cantidad tecleada manualmente por artículo en la búsqueda por nombre
  const [manualQtyInputs, setManualQtyInputs] = useState<Record<string, string>>({});
  const photoRef = useRef<HTMLInputElement>(null);
  const galleryRef = useRef<HTMLInputElement>(null);
  const scanInputRef = useRef<HTMLInputElement>(null);

  const { data: collaborators = [] } = useQuery({
    queryKey: ["collaborators-active", online],
    staleTime: online ? 30_000 : Infinity,
    queryFn: async () => {
      if (!online) {
        const { getCachedCollaborators } = await import("@/lib/offline-cache");
        const list = await getCachedCollaborators();
        return list.map((c) => ({ id: c.id, name: c.name }));
      }
      try {
        const { data, error } = await supabase
          .from("collaborators")
          .select("id, name")
          .eq("active", true)
          .order("name");
        if (error) throw error;
        return data as Array<{ id: string; name: string }>;
      } catch {
        const { getCachedCollaborators } = await import("@/lib/offline-cache");
        const list = await getCachedCollaborators();
        return list.map((c) => ({ id: c.id, name: c.name }));
      }
    },
  });

  useEffect(() => {
    if (batch) {
      const saved = loadReceptionProgress(batch.batchId);
      if (saved) {
        setScannedCounts(new Map(Object.entries(saved.scannedCounts)));
        setSender(saved.sender || batch.sender_name);
        setReceiver(saved.receiver || me?.name || batch.receiver_name || "");
        toast.info("Se restauró el progreso guardado de este envío");
      } else {
        setSender(batch.sender_name);
        setReceiver(me?.name ?? batch.receiver_name ?? "");
        setScannedCounts(new Map());
      }
      setPhoto(null);
      setScanInput("");
      setNameSearch("");
      setManualQtyInputs({});
    }
    // Solo se re-ejecuta cuando cambia el envío activo, no en cada refetch
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [batch?.batchId]);

  // Un producto está completo cuando se recibió la cantidad exacta
  function isItemComplete(itemId: string): boolean {
    const item = batch?.items.find((i) => i.id === itemId);
    if (!item) return false;
    return (scannedCounts.get(itemId) ?? 0) >= item.quantity;
  }

  const allConfirmed = batch !== null && batch.items.every((i) => isItemComplete(i.id));

  // Total recibido vs total esperado
  const totalScanned = Array.from(scannedCounts.values()).reduce((s, v) => s + v, 0);
  const totalExpected = batch?.totalQuantity ?? 0;

  // Suma `n` unidades al artículo (por id) y guarda el progreso automáticamente.
  function addUnits(itemId: string, n: number) {
    const item = batch?.items.find((i) => i.id === itemId);
    if (!item || !batch) return;
    const current = scannedCounts.get(itemId) ?? 0;
    if (current >= item.quantity) {
      toast.info(`${item.product_name} ya tiene las ${item.quantity} unidades completas`);
      return;
    }
    const next = Math.min(item.quantity, current + n);
    setScannedCounts((prev) => {
      const map = new Map(prev).set(itemId, next);
      saveReceptionProgress(batch.batchId, map, sender, receiver);
      return map;
    });
    if (next === item.quantity) {
      toast.success(`✓ ${item.product_name} completo (${next}/${item.quantity})`);
    } else {
      toast.success(`${item.product_name}: ${next}/${item.quantity} unidades`);
    }
  }

  // Pistoleo por código de barras (pistola o input). Solo aplica a artículos
  // que sí tienen código de barras asignado.
  function scanUnit(code: string) {
    const c = code.trim();
    if (!c) return;
    const item = batch?.items.find((i) => i.barcode && i.barcode === c);
    if (!item) {
      toast.error("Ese código no pertenece a este envío");
      setScanInput("");
      return;
    }
    addUnits(item.id, 1);
    setScanInput("");
    scanInputRef.current?.focus();
  }

  // Captura manual de piezas para un artículo (usado solo en la búsqueda por
  // nombre, para artículos que no se pueden pistolear porque no tienen
  // código de barras, o cuando es más rápido teclear la cantidad).
  function addManualQty(itemId: string) {
    const item = batch?.items.find((i) => i.id === itemId);
    if (!item) return;
    const raw = manualQtyInputs[itemId];
    const n = raw && raw.trim() !== "" ? parseInt(raw, 10) : 1;
    if (!n || n <= 0) return;
    addUnits(itemId, n);
    setManualQtyInputs((prev) => ({ ...prev, [itemId]: "" }));
  }

  async function confirm() {
    if (!batch) return;
    if (!allConfirmed) return toast.error("Faltan unidades por pistolar");
    if (!photo) return toast.error("Tomá foto de la mercancía recibida");
    if (!sender.trim()) return toast.error("Indicá quién envió");
    if (!receiver.trim()) return toast.error("Indicá quién recibe");
    const collab = getCollaborator();
    if (!collab) return toast.error("Sesión expirada");

    setBusy(true);
    const ids = batch.items.map((i) => i.id);
    const scannedStr = batch.items
      .map((i) => `${i.barcode || i.product_name}x${scannedCounts.get(i.id) ?? 0}`)
      .join(",");

    try {
      // Sin internet: guardar localmente y sincronizar después
      if (!online) {
        const photoBase64 = await fileToBase64(photo);
        saveOfflineReception({
          id: crypto.randomUUID(),
          batchId: batch.batchId,
          transferIds: ids,
          received_by_id: collab.id,
          received_by_name: collab.name,
          received_sender_name: sender.trim(),
          received_receiver_name: receiver.trim(),
          received_scanned_barcode: scannedStr,
          photoBase64,
          photoType: photo.type || "image/jpeg",
          photoName: photo.name || "received.jpg",
          savedAt: Date.now(),
        });
        clearReceptionProgress(batch.batchId);
        toast.success(`${ids.length} producto${ids.length === 1 ? "" : "s"} recibidos (offline · se sincronizará)`);
        onDone();
        return;
      }

      const ext = (photo.name.split(".").pop() || "jpg").toLowerCase();
      const path = `received-batch-${batch.batchId}.${ext}`;
      const up = await supabase.storage
        .from("transfer-photos")
        .upload(path, photo, { contentType: photo.type, upsert: true });
      if (up.error) throw up.error;
      const { data: signed } = await supabase.storage
        .from("transfer-photos")
        .createSignedUrl(path, 60 * 60 * 24 * 365);
      const received_photo_url = signed?.signedUrl ?? path;

      const { error } = await supabase
        .from("transfers")
        .update({
          received_at: new Date().toISOString(),
          received_by_id: collab.id,
          received_by_name: collab.name,
          received_photo_url,
          received_scanned_barcode: scannedStr,
          received_sender_name: sender.trim(),
          received_receiver_name: receiver.trim(),
        })
        .in("id", ids);
      if (error) throw error;

      clearReceptionProgress(batch.batchId);
      toast.success(`${ids.length} producto${ids.length === 1 ? "" : "s"} recibidos`);
      onDone();
    } catch (e) {
      // Si falló por red, intentar cola offline
      const msg = (e as Error).message || "";
      if (/failed to fetch|network|offline|load failed/i.test(msg) && photo) {
        try {
          const photoBase64 = await fileToBase64(photo);
          saveOfflineReception({
            id: crypto.randomUUID(),
            batchId: batch.batchId,
            transferIds: ids,
            received_by_id: collab.id,
            received_by_name: collab.name,
            received_sender_name: sender.trim(),
            received_receiver_name: receiver.trim(),
            received_scanned_barcode: scannedStr,
            photoBase64,
            photoType: photo.type || "image/jpeg",
            photoName: photo.name || "received.jpg",
            savedAt: Date.now(),
          });
          clearReceptionProgress(batch.batchId);
          toast.success(`${ids.length} producto${ids.length === 1 ? "" : "s"} recibidos (offline · se sincronizará)`);
          onDone();
          return;
        } catch { /* fall through */ }
      }
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={!!batch} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-h-[90vh] max-w-md overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Confirmar recepción del envío</DialogTitle>
        </DialogHeader>
        {batch && (
          <div className="space-y-3 text-sm">

            {/* Progreso total */}
            <div className="flex items-center justify-between rounded-md bg-muted px-3 py-2">
              <span className="text-xs font-medium">Unidades pistoleadas</span>
              <span className={`text-sm font-bold tabular-nums ${allConfirmed ? "text-emerald-600" : "text-amber-600"}`}>
                {totalScanned} / {totalExpected}
              </span>
            </div>

            {/* Lista de productos con progreso por unidades */}
            <div className="divide-y rounded-md border">
              {batch.items.map((item) => {
                const scanned = scannedCounts.get(item.id) ?? 0;
                const done = scanned >= item.quantity;
                return (
                  <div key={item.id} className={`flex items-center gap-2 px-3 py-2 text-xs ${done ? "bg-emerald-50 dark:bg-emerald-950/20" : ""}`}>
                    <div className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2 ${done ? "border-emerald-500 bg-emerald-500 text-white" : "border-muted-foreground"}`}>
                      {done && <Check className="h-3 w-3" />}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className={`truncate font-medium ${done ? "line-through text-muted-foreground" : ""}`}>
                        {item.product_name}
                      </div>
                      {item.barcode ? (
                        <div className="font-mono text-muted-foreground">{item.barcode}</div>
                      ) : (
                        <div className="italic text-amber-600">Sin código · buscá por nombre abajo</div>
                      )}
                    </div>
                    {/* Contador de unidades */}
                    <div className={`shrink-0 text-xs font-bold tabular-nums ${done ? "text-emerald-600" : scanned > 0 ? "text-amber-600" : "text-muted-foreground"}`}>
                      {scanned}/{item.quantity}
                    </div>
                    {!done && item.barcode && (
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        className="h-7 text-xs"
                        onClick={() => addUnits(item.id, 1)}
                      >
                        +1
                      </Button>
                    )}
                  </div>
                );
              })}
            </div>

            {/* Escanear */}
            <div>
              <Label>Pistolá cada unidad individualmente</Label>
              <div className="flex gap-2">
                <Input
                  ref={scanInputRef}
                  autoFocus
                  value={scanInput}
                  onChange={(e) => setScanInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      scanUnit(scanInput);
                    }
                  }}
                  placeholder="Código de barras…"
                  className="font-mono"
                  inputMode="numeric"
                />
                <Button type="button" variant="outline" onClick={() => setScannerOpen(true)}>
                  <ScanLine className="h-4 w-4" />
                </Button>
              </div>
              <p className="mt-1 text-xs text-muted-foreground">
                Cada disparo suma 1 unidad al producto. Pistolealas todas para marcar completo.
              </p>
            </div>

            {/* Buscar por nombre */}
            <div>
              <Label>O buscar por nombre (para artículos sin código)</Label>
              <Input
                value={nameSearch}
                onChange={(e) => setNameSearch(e.target.value)}
                placeholder="Escribí al menos 2 letras…"
              />
              <p className="mt-1 text-xs text-muted-foreground">
                Cuando buscás por nombre podés teclear directamente cuántas piezas llegaron, sin pistolar una por una.
              </p>
              {nameSearch.trim().length >= 2 && (
                <div className="mt-1 max-h-56 overflow-auto rounded-md border bg-card">
                  {batch.items
                    .filter((i) => i.product_name.toLowerCase().includes(nameSearch.toLowerCase()))
                    .map((item) => {
                      const scanned = scannedCounts.get(item.id) ?? 0;
                      const done = scanned >= item.quantity;
                      const remaining = item.quantity - scanned;
                      return (
                        <div
                          key={item.id}
                          className={`flex items-center justify-between gap-2 border-b px-3 py-2 text-xs last:border-b-0 ${done ? "bg-emerald-50 dark:bg-emerald-950/20" : ""}`}
                        >
                          <div className="min-w-0 flex-1">
                            <div className="truncate font-medium">{item.product_name}</div>
                            <div className="text-muted-foreground">
                              {item.barcode ? (
                                <span className="font-mono">{item.barcode}</span>
                              ) : (
                                <span className="italic text-amber-600">Sin código de barras</span>
                              )}
                              {" · "}{scanned}/{item.quantity}
                            </div>
                          </div>
                          {done ? (
                            <Check className="h-4 w-4 shrink-0 text-emerald-600" />
                          ) : (
                            <div className="flex shrink-0 items-center gap-1">
                              <Input
                                type="number"
                                inputMode="numeric"
                                min={1}
                                max={remaining}
                                placeholder={`${remaining}`}
                                value={manualQtyInputs[item.id] ?? ""}
                                onChange={(e) =>
                                  setManualQtyInputs((prev) => ({ ...prev, [item.id]: e.target.value }))
                                }
                                onKeyDown={(e) => {
                                  if (e.key === "Enter") {
                                    e.preventDefault();
                                    addManualQty(item.id);
                                  }
                                }}
                                className="h-7 w-14 px-1 text-center text-xs"
                              />
                              <Button
                                type="button"
                                size="sm"
                                variant="outline"
                                className="h-7 px-2 text-xs"
                                onClick={() => addManualQty(item.id)}
                              >
                                Agregar
                              </Button>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  {batch.items.filter((i) => i.product_name.toLowerCase().includes(nameSearch.toLowerCase())).length === 0 && (
                    <div className="px-3 py-2 text-xs text-muted-foreground">Sin resultados en este envío</div>
                  )}
                </div>
              )}
            </div>

            {/* Quién envía / recibe */}
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div>
                <Label>Envía</Label>
                <Select
                  value={sender}
                  onValueChange={(v) => {
                    setSender(v);
                    if (batch) saveReceptionProgress(batch.batchId, scannedCounts, v, receiver);
                  }}
                >
                  <SelectTrigger><SelectValue placeholder="Seleccionar…" /></SelectTrigger>
                  <SelectContent>
                    {collaborators.map((c) => (
                      <SelectItem key={c.id} value={c.name}>{c.name}</SelectItem>
                    ))}
                    {sender && !collaborators.some((c) => c.name === sender) && (
                      <SelectItem value={sender}>{sender}</SelectItem>
                    )}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Recibe</Label>
                <Select
                  value={receiver}
                  onValueChange={(v) => {
                    setReceiver(v);
                    if (batch) saveReceptionProgress(batch.batchId, scannedCounts, sender, v);
                  }}
                >
                  <SelectTrigger><SelectValue placeholder="Seleccionar…" /></SelectTrigger>
                  <SelectContent>
                    {collaborators.map((c) => (
                      <SelectItem key={c.id} value={c.name}>{c.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            {/* Foto */}
            <div>
              <Label>Foto evidencia de recepción</Label>
              <div className="flex flex-wrap items-center gap-2">
                <input ref={photoRef} type="file" accept="image/*" capture="environment" className="hidden"
                  onChange={(e) => setPhoto(e.target.files?.[0] ?? null)} />
                <input ref={galleryRef} type="file" accept="image/*" className="hidden"
                  onChange={(e) => setPhoto(e.target.files?.[0] ?? null)} />
                <Button type="button" variant="outline" onClick={() => photoRef.current?.click()}>
                  <Camera className="h-4 w-4" /> Tomar foto
                </Button>
                <Button type="button" variant="outline" onClick={() => galleryRef.current?.click()}>
                  Elegir archivo
                </Button>
              </div>
              {photo && (
                <img src={URL.createObjectURL(photo)} alt="" className="mt-2 h-32 w-32 rounded-md border object-cover" />
              )}
            </div>
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={busy}>Cancelar</Button>
          <Button onClick={confirm} disabled={busy || !allConfirmed || !photo}>
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
            Confirmar recepción {batch && `(${totalScanned}/${totalExpected})`}
          </Button>
        </DialogFooter>

        <BarcodeScanner
          open={scannerOpen}
          onClose={() => setScannerOpen(false)}
          onDetected={(code) => scanUnit(code)}
        />
      </DialogContent>
    </Dialog>
  );
}
