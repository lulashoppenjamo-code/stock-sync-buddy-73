import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Camera, ArrowRight, Loader2, Send } from "lucide-react";
import { toast } from "sonner";
import { getCollaborator } from "@/lib/session";
import { enqueue, drainQueue } from "@/lib/offline-queue";

export const Route = createFileRoute("/app/transfer")({
  component: TransferPage,
});

type Branch = "A" | "B";

function TransferPage() {
  const qc = useQueryClient();
  const [barcode, setBarcode] = useState("");
  const [quantity, setQuantity] = useState("");
  const [origin, setOrigin] = useState<Branch>("A");
  const [destination, setDestination] = useState<Branch>("B");
  const [sender, setSender] = useState("");
  const [receiver, setReceiver] = useState("");
  const [photo, setPhoto] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const photoRef = useRef<HTMLInputElement>(null);
  const galleryRef = useRef<HTMLInputElement>(null);

  const { data: product } = useQuery({
    queryKey: ["product-lookup", barcode],
    enabled: barcode.trim().length > 0,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("products")
        .select("barcode, product_name, stock_a, stock_b")
        .eq("barcode", barcode.trim())
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });

  function reset() {
    setBarcode("");
    setQuantity("");
    setSender("");
    setReceiver("");
    setPhoto(null);
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!product) return toast.error("Producto no encontrado");
    if (origin === destination) return toast.error("Origen y destino deben ser distintos");
    const q = Number(quantity);
    if (!Number.isFinite(q) || q <= 0) return toast.error("Cantidad inválida");
    const originStock = origin === "A" ? product.stock_a : product.stock_b;
    if (q > originStock) return toast.error(`Stock insuficiente en ${origin}: ${originStock}`);
    if (!sender.trim() || !receiver.trim()) return toast.error("Falta nombre de envía/recibe");
    if (!photo) return toast.error("La foto es obligatoria");

    const collab = getCollaborator();
    if (!collab) return toast.error("Sesión expirada");
    const client_uid = `transfer-${crypto.randomUUID()}`;
    const ext = (photo.name.split(".").pop() || "jpg").toLowerCase();
    const payload = {
      barcode: product.barcode,
      quantity: q,
      origin,
      destination,
      sender_name: sender.trim(),
      receiver_name: receiver.trim(),
      collaborator_id: collab.id,
      collaborator_name: collab.name,
      client_uid,
    };
    setBusy(true);
    try {
      if (navigator.onLine) {
        const path = `${client_uid}.${ext}`;
        const up = await supabase.storage
          .from("transfer-photos")
          .upload(path, photo, { contentType: photo.type, upsert: true });
        if (up.error) throw up.error;
        const { data: signed } = await supabase.storage
          .from("transfer-photos")
          .createSignedUrl(path, 60 * 60 * 24 * 365);
        const photo_url = signed?.signedUrl ?? path;
        const { error } = await supabase.rpc("apply_transfer", {
          p_barcode: payload.barcode,
          p_quantity: payload.quantity,
          p_origin: payload.origin,
          p_destination: payload.destination,
          p_sender_name: payload.sender_name,
          p_receiver_name: payload.receiver_name,
          p_photo_url: photo_url,
          p_collaborator_id: payload.collaborator_id,
          p_collaborator_name: payload.collaborator_name,
          p_client_uid: payload.client_uid,
        });
        if (error) throw error;
        toast.success("Traspaso registrado");
      } else {
        await enqueue({
          kind: "transfer",
          uid: client_uid,
          createdAt: Date.now(),
          payload,
          photo: { blob: photo, ext },
        });
        toast.info("Sin conexión: traspaso encolado, se aplicará al volver la red");
      }
      reset();
      qc.invalidateQueries({ queryKey: ["products"] });
      qc.invalidateQueries({ queryKey: ["transfers"] });
      drainQueue();
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold tracking-tight">Traspaso entre sucursales</h1>
      <Card>
        <CardContent className="p-4">
          <form onSubmit={submit} className="space-y-4">
            <div>
              <Label htmlFor="barcode">Código de barras</Label>
              <Input
                id="barcode"
                value={barcode}
                onChange={(e) => setBarcode(e.target.value)}
                placeholder="Escanear o tipear…"
                className="font-mono"
                autoFocus
                inputMode="numeric"
              />
              {barcode.trim() && (
                <div className="mt-1 text-xs">
                  {product ? (
                    <span className="text-emerald-600">
                      {product.product_name} · A: {product.stock_a} · B: {product.stock_b}
                    </span>
                  ) : (
                    <span className="text-muted-foreground">Buscando…</span>
                  )}
                </div>
              )}
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Origen</Label>
                <ToggleGroup
                  type="single"
                  value={origin}
                  onValueChange={(v) => v && setOrigin(v as Branch)}
                  className="justify-start"
                >
                  <ToggleGroupItem value="A">A</ToggleGroupItem>
                  <ToggleGroupItem value="B">B</ToggleGroupItem>
                </ToggleGroup>
              </div>
              <div>
                <Label>Destino</Label>
                <ToggleGroup
                  type="single"
                  value={destination}
                  onValueChange={(v) => v && setDestination(v as Branch)}
                  className="justify-start"
                >
                  <ToggleGroupItem value="A">A</ToggleGroupItem>
                  <ToggleGroupItem value="B">B</ToggleGroupItem>
                </ToggleGroup>
              </div>
            </div>

            <div className="flex items-center justify-center gap-2 text-sm text-muted-foreground">
              <span className="font-semibold">{origin}</span>
              <ArrowRight className="h-4 w-4" />
              <span className="font-semibold">{destination}</span>
            </div>

            <div>
              <Label htmlFor="qty">Cantidad</Label>
              <Input
                id="qty"
                type="number"
                inputMode="decimal"
                step="any"
                min={0}
                value={quantity}
                onChange={(e) => setQuantity(e.target.value)}
              />
            </div>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div>
                <Label htmlFor="sender">Nombre envía</Label>
                <Input id="sender" value={sender} onChange={(e) => setSender(e.target.value)} />
              </div>
              <div>
                <Label htmlFor="receiver">Nombre recibe</Label>
                <Input id="receiver" value={receiver} onChange={(e) => setReceiver(e.target.value)} />
              </div>
            </div>

            <div>
              <Label>Foto evidencia</Label>
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
                {photo && (
                  <span className="text-xs text-muted-foreground">
                    {photo.name} ({Math.round(photo.size / 1024)} KB)
                  </span>
                )}
              </div>
              {photo && (
                // eslint-disable-next-line jsx-a11y/img-redundant-alt
                <img
                  src={URL.createObjectURL(photo)}
                  alt="Evidencia"
                  className="mt-2 h-32 w-32 rounded-md border object-cover"
                />
              )}
            </div>

            <Button type="submit" disabled={busy} className="w-full">
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
              Confirmar traspaso
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
