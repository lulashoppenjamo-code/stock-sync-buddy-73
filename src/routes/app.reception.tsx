import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Camera, Check, Loader2, ScanLine, PackageCheck, AlertCircle } from "lucide-react";
import { toast } from "sonner";
import { getCollaborator } from "@/lib/session";
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
};

function ReceptionPage() {
  const qc = useQueryClient();
  const [active, setActive] = useState<PendingTransfer | null>(null);

  const { data: pending = [], isLoading } = useQuery({
    queryKey: ["pending-transfers"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("transfers")
        .select("id, barcode, product_name, quantity, origin, destination, sender_name, receiver_name, photo_url, created_at")
        .is("received_at", null)
        .order("created_at", { ascending: false })
        .limit(200);
      if (error) throw error;
      return data as PendingTransfer[];
    },
    refetchInterval: 30_000,
  });

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <h1 className="mr-auto text-xl font-semibold tracking-tight">Recepciones pendientes</h1>
        <span className="rounded-full bg-amber-100 px-2 py-1 text-xs font-medium text-amber-900 dark:bg-amber-900/40 dark:text-amber-100">
          {pending.length} pendiente{pending.length === 1 ? "" : "s"}
        </span>
      </div>

      <p className="text-xs text-muted-foreground">
        Pistoleá la mercancía y sacá foto al recibirla para confirmar el traspaso.
      </p>

      {isLoading ? (
        <Card><CardContent className="grid place-items-center p-8"><Loader2 className="h-5 w-5 animate-spin" /></CardContent></Card>
      ) : pending.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-2 p-8 text-center text-sm text-muted-foreground">
            <PackageCheck className="h-8 w-8 text-emerald-500" />
            No hay traspasos pendientes de recibir.
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
          {pending.map((t) => (
            <Card key={t.id} className="overflow-hidden">
              <CardContent className="flex items-center gap-3 p-3">
                {t.photo_url && (
                  <img src={t.photo_url} alt="envío" className="h-14 w-14 shrink-0 rounded-md border object-cover" />
                )}
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium">{t.product_name}</div>
                  <div className="font-mono text-xs text-muted-foreground">{t.barcode}</div>
                  <div className="mt-0.5 text-xs">
                    <span className="font-semibold">{t.quantity}</span> ·{" "}
                    {BRANCH_LABELS[t.origin]} → <span className="font-semibold">{BRANCH_LABELS[t.destination]}</span>
                  </div>
                  <div className="text-[11px] text-muted-foreground">
                    {new Date(t.created_at).toLocaleString()} · de {t.sender_name}
                  </div>
                </div>
                <Button size="sm" onClick={() => setActive(t)}>
                  Recibir
                </Button>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <ReceiveDialog
        transfer={active}
        onClose={() => setActive(null)}
        onDone={() => {
          setActive(null);
          qc.invalidateQueries({ queryKey: ["pending-transfers"] });
          qc.invalidateQueries({ queryKey: ["pending-transfers-count"] });
          qc.invalidateQueries({ queryKey: ["transfers"] });
        }}
      />
    </div>
  );
}

function ReceiveDialog({
  transfer,
  onClose,
  onDone,
}: {
  transfer: PendingTransfer | null;
  onClose: () => void;
  onDone: () => void;
}) {
  const [scanned, setScanned] = useState("");
  const [photo, setPhoto] = useState<File | null>(null);
  const [scannerOpen, setScannerOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const photoRef = useRef<HTMLInputElement>(null);
  const galleryRef = useRef<HTMLInputElement>(null);

  const matches = !!transfer && scanned.trim() === transfer.barcode;

  async function confirm() {
    if (!transfer) return;
    if (!matches) {
      toast.error("El código escaneado no coincide con el del traspaso");
      return;
    }
    if (!photo) {
      toast.error("Tomá foto de la mercancía recibida");
      return;
    }
    const collab = getCollaborator();
    if (!collab) return toast.error("Sesión expirada");

    setBusy(true);
    try {
      const ext = (photo.name.split(".").pop() || "jpg").toLowerCase();
      const path = `received-${transfer.id}.${ext}`;
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
          received_scanned_barcode: scanned.trim(),
        })
        .eq("id", transfer.id);
      if (error) throw error;

      toast.success("Traspaso recibido");
      setScanned("");
      setPhoto(null);
      onDone();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={!!transfer} onOpenChange={(o) => { if (!o) { setScanned(""); setPhoto(null); onClose(); } }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Confirmar recepción</DialogTitle>
        </DialogHeader>
        {transfer && (
          <div className="space-y-3 text-sm">
            <div className="rounded-md border p-3">
              <div className="font-medium">{transfer.product_name}</div>
              <div className="font-mono text-xs text-muted-foreground">{transfer.barcode}</div>
              <div className="mt-1 text-xs">
                Cantidad esperada: <span className="font-semibold">{transfer.quantity}</span> ·{" "}
                {BRANCH_LABELS[transfer.origin]} → {BRANCH_LABELS[transfer.destination]}
              </div>
            </div>

            <div>
              <Label>Pistolá el código para confirmar</Label>
              <div className="flex gap-2">
                <Input
                  autoFocus
                  value={scanned}
                  onChange={(e) => setScanned(e.target.value)}
                  placeholder="Escaneá o tipeá el código…"
                  className="font-mono"
                  inputMode="numeric"
                />
                <Button type="button" variant="outline" onClick={() => setScannerOpen(true)}>
                  <Camera className="h-4 w-4" /> Cámara
                </Button>
              </div>
              {scanned && (
                <div className={`mt-1 inline-flex items-center gap-1 text-xs ${matches ? "text-emerald-600" : "text-red-600"}`}>
                  {matches ? <Check className="h-3 w-3" /> : <AlertCircle className="h-3 w-3" />}
                  {matches ? "Código coincide" : "No coincide con el traspaso"}
                </div>
              )}
            </div>

            <div>
              <Label>Foto evidencia de recepción</Label>
              <div className="flex flex-wrap items-center gap-2">
                <input
                  ref={photoRef}
                  type="file"
                  accept="image/*"
                  capture="environment"
                  className="hidden"
                  onChange={(e) => setPhoto(e.target.files?.[0] ?? null)}
                />
                <input
                  ref={galleryRef}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={(e) => setPhoto(e.target.files?.[0] ?? null)}
                />
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
          <Button onClick={confirm} disabled={busy || !matches || !photo}>
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />} Confirmar recepción
          </Button>
        </DialogFooter>

        <BarcodeScanner
          open={scannerOpen}
          onClose={() => setScannerOpen(false)}
          onDetected={(code) => setScanned(code)}
        />
      </DialogContent>
    </Dialog>
  );
}
