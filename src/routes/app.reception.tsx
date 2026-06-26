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
import { Camera, Check, Loader2, PackageCheck, ChevronDown, ChevronUp, ScanLine } from "lucide-react";
import { toast } from "sonner";
import { getCollaborator, useCollaborator } from "@/lib/session";
import { BRANCH_LABELS } from "@/lib/branches";
import { BarcodeScanner } from "@/components/BarcodeScanner";

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

function ReceptionPage() {
  const qc = useQueryClient();
  const [activeBatch, setActiveBatch] = useState<BatchGroup | null>(null);
  const [expandedBatch, setExpandedBatch] = useState<string | null>(null);

  const { data: pending = [], isLoading } = useQuery({
    queryKey: ["pending-transfers"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("transfers")
        .select("id, barcode, product_name, quantity, origin, destination, sender_name, receiver_name, photo_url, created_at, client_uid")
        .is("received_at", null)
        .order("created_at", { ascending: false })
        .limit(200);
      if (error) throw error;
      return data as PendingTransfer[];
    },
    refetchInterval: 30_000,
  });

  const batches = groupByBatch(pending);

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <h1 className="mr-auto text-xl font-semibold tracking-tight">Recepciones pendientes</h1>
        <span className="rounded-full bg-amber-100 px-2 py-1 text-xs font-medium text-amber-900 dark:bg-amber-900/40 dark:text-amber-100">
          {batches.length} envío{batches.length === 1 ? "" : "s"}
        </span>
      </div>

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
        onClose={() => setActiveBatch(null)}
        onDone={() => {
          setActiveBatch(null);
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
  onClose,
  onDone,
}: {
  batch: BatchGroup | null;
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
  // Mapa barcode -> cuántas unidades se han pistoleado (debe llegar a item.quantity)
  const [scannedCounts, setScannedCounts] = useState<Map<string, number>>(new Map());
  const [scanInput, setScanInput] = useState("");
  const photoRef = useRef<HTMLInputElement>(null);
  const galleryRef = useRef<HTMLInputElement>(null);
  const scanInputRef = useRef<HTMLInputElement>(null);

  const { data: collaborators = [] } = useQuery({
    queryKey: ["collaborators-active"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("collaborators")
        .select("id, name")
        .eq("active", true)
        .order("name");
      if (error) throw error;
      return data as Array<{ id: string; name: string }>;
    },
  });

  useEffect(() => {
    if (batch) {
      setSender(batch.sender_name);
      setReceiver(me?.name ?? batch.receiver_name ?? "");
      setScannedCounts(new Map());
      setPhoto(null);
      setScanInput("");
      setNameSearch("");
    }
  }, [batch, me?.name]);

  const batchBarcodes = batch?.items.map((i) => i.barcode) ?? [];

  // Un producto está completo cuando se pistoleó la cantidad exacta
  function isItemComplete(barcode: string): boolean {
    const item = batch?.items.find((i) => i.barcode === barcode);
    if (!item) return false;
    return (scannedCounts.get(barcode) ?? 0) >= item.quantity;
  }

  const allConfirmed = batch !== null && batch.items.every((i) => isItemComplete(i.barcode));

  // Total pistoleado vs total esperado
  const totalScanned = Array.from(scannedCounts.values()).reduce((s, v) => s + v, 0);
  const totalExpected = batch?.totalQuantity ?? 0;

  function scanUnit(code: string) {
    const c = code.trim();
    if (!c) return;
    if (!batchBarcodes.includes(c)) {
      toast.error("Ese código no pertenece a este envío");
      setScanInput("");
      return;
    }
    const item = batch?.items.find((i) => i.barcode === c);
    if (!item) return;
    const current = scannedCounts.get(c) ?? 0;
    if (current >= item.quantity) {
      toast.info(`${item.product_name} ya tiene las ${item.quantity} unidades completas`);
      setScanInput("");
      return;
    }
    const next = current + 1;
    setScannedCounts((prev) => new Map(prev).set(c, next));
    if (next === item.quantity) {
      toast.success(`✓ ${item.product_name} completo (${next}/${item.quantity})`);
    } else {
      toast.success(`${item.product_name}: ${next}/${item.quantity} unidades`);
    }
    setScanInput("");
    scanInputRef.current?.focus();
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
    try {
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

      const ids = batch.items.map((i) => i.id);
      const { error } = await supabase
        .from("transfers")
        .update({
          received_at: new Date().toISOString(),
          received_by_id: collab.id,
          received_by_name: collab.name,
          received_photo_url,
          received_scanned_barcode: Array.from(scannedCounts.entries()).map(([bc, qty]) => `${bc}x${qty}`).join(","),
          received_sender_name: sender.trim(),
          received_receiver_name: receiver.trim(),
        })
        .in("id", ids);
      if (error) throw error;

      toast.success(`${ids.length} producto${ids.length === 1 ? "" : "s"} recibidos`);
      onDone();
    } catch (e) {
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
                const scanned = scannedCounts.get(item.barcode) ?? 0;
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
                      <div className="font-mono text-muted-foreground">{item.barcode}</div>
                    </div>
                    {/* Contador de unidades */}
                    <div className={`shrink-0 text-xs font-bold tabular-nums ${done ? "text-emerald-600" : scanned > 0 ? "text-amber-600" : "text-muted-foreground"}`}>
                      {scanned}/{item.quantity}
                    </div>
                    {!done && (
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        className="h-7 text-xs"
                        onClick={() => scanUnit(item.barcode)}
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
              <Label>O buscar por nombre (suma +1)</Label>
              <Input
                value={nameSearch}
                onChange={(e) => setNameSearch(e.target.value)}
                placeholder="Escribí al menos 2 letras…"
              />
              {nameSearch.trim().length >= 2 && (
                <div className="mt-1 max-h-40 overflow-auto rounded-md border bg-card">
                  {batch.items
                    .filter((i) => i.product_name.toLowerCase().includes(nameSearch.toLowerCase()))
                    .map((item) => {
                      const scanned = scannedCounts.get(item.barcode) ?? 0;
                      const done = scanned >= item.quantity;
                      return (
                        <button
                          key={item.barcode}
                          type="button"
                          disabled={done}
                          onClick={() => {
                            scanUnit(item.barcode);
                            setNameSearch("");
                          }}
                          className="flex w-full items-center justify-between gap-2 border-b px-3 py-2 text-left text-xs last:border-b-0 hover:bg-muted disabled:opacity-40"
                        >
                          <span className="truncate font-medium">{item.product_name}</span>
                          <span className="shrink-0 text-muted-foreground">{scanned}/{item.quantity}</span>
                        </button>
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
                <Select value={sender} onValueChange={setSender}>
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
                <Select value={receiver} onValueChange={setReceiver}>
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
