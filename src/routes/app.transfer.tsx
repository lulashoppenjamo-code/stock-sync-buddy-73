import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Camera, ArrowRight, Loader2, Send, ScanLine, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { getCollaborator } from "@/lib/session";
import { BRANCH_LABELS } from "@/lib/branches";
import { BarcodeScanner } from "@/components/BarcodeScanner";

export const Route = createFileRoute("/app/transfer")({
  component: TransferPage,
});

type Branch = "A" | "B";
type CartItem = {
  barcode: string;
  product_name: string;
  uom: string | null;
  total_stock: number;
  quantity: number;
};

function TransferPage() {
  const qc = useQueryClient();
  const [barcode, setBarcode] = useState("");
  const [nameSearch, setNameSearch] = useState("");
  const [origin, setOrigin] = useState<Branch>("A");
  const [destination, setDestination] = useState<Branch>("B");
  const [sender, setSender] = useState("");
  const [receiver, setReceiver] = useState("");
  const [photo, setPhoto] = useState<File | null>(null);
  const [cart, setCart] = useState<CartItem[]>([]);
  const [busy, setBusy] = useState(false);
  const [scannerOpen, setScannerOpen] = useState(false);
  const photoRef = useRef<HTMLInputElement>(null);
  const galleryRef = useRef<HTMLInputElement>(null);
  const barcodeRef = useRef<HTMLInputElement>(null);

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

  const { data: nameResults = [] } = useQuery({
    queryKey: ["product-search-name", nameSearch],
    enabled: nameSearch.trim().length >= 2,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("products")
        .select("barcode, product_name, uom, stock_a, stock_b")
        .ilike("product_name", `%${nameSearch.trim()}%`)
        .order("product_name")
        .limit(15);
      if (error) throw error;
      return data as Array<{ barcode: string; product_name: string; uom: string | null; stock_a: number; stock_b: number }>;
    },
  });

  /** Look up by barcode and add +1 to cart (or stack if already there). */
  async function addBarcode(code: string) {
    const c = code.trim();
    if (!c) return;
    const { data, error } = await supabase
      .from("products")
      .select("barcode, product_name, uom, stock_a, stock_b")
      .eq("barcode", c)
      .maybeSingle();
    if (error) {
      toast.error(error.message);
      return;
    }
    if (!data) {
      toast.error(`Producto no encontrado: ${c}`);
      return;
    }
    const total = Number(data.stock_a) + Number(data.stock_b);
    setCart((prev) => {
      const i = prev.findIndex((x) => x.barcode === data.barcode);
      if (i >= 0) {
        const copy = [...prev];
        copy[i] = { ...copy[i], quantity: copy[i].quantity + 1 };
        return copy;
      }
      return [
        ...prev,
        {
          barcode: data.barcode,
          product_name: data.product_name,
          uom: data.uom,
          total_stock: total,
          quantity: 1,
        },
      ];
    });
    toast.success(`+1 · ${data.product_name}`);
    setBarcode("");
    setNameSearch("");
    barcodeRef.current?.focus();
  }

  function removeFromCart(bc: string) {
    setCart((prev) => prev.filter((c) => c.barcode !== bc));
  }

  function updateCartQty(bc: string, q: number) {
    setCart((prev) => prev.map((c) => (c.barcode === bc ? { ...c, quantity: q } : c)));
  }

  async function submitAll() {
    if (cart.length === 0) return toast.error("Agregá al menos un producto");
    if (origin === destination) return toast.error("Origen y destino deben ser distintos");
    if (!sender.trim() || !receiver.trim()) return toast.error("Seleccioná quién envía y recibe");
    if (!photo) return toast.error("La foto es obligatoria");
    for (const c of cart) {
      if (c.quantity <= 0) return toast.error(`Cantidad inválida en ${c.product_name}`);
    }

    const collab = getCollaborator();
    if (!collab) return toast.error("Sesión expirada");

    setBusy(true);
    try {
      const batchId = crypto.randomUUID();
      const ext = (photo.name.split(".").pop() || "jpg").toLowerCase();
      const path = `${batchId}.${ext}`;
      const up = await supabase.storage
        .from("transfer-photos")
        .upload(path, photo, { contentType: photo.type, upsert: true });
      if (up.error) throw up.error;
      const { data: signed } = await supabase.storage
        .from("transfer-photos")
        .createSignedUrl(path, 60 * 60 * 24 * 365);
      const photo_url = signed?.signedUrl ?? path;

      // Direct insert into transfers — NO stock deduction (only evidence).
      const rows = cart.map((c) => ({
        barcode: c.barcode,
        product_name: c.product_name,
        quantity: c.quantity,
        origin,
        destination,
        sender_name: sender.trim(),
        receiver_name: receiver.trim(),
        photo_url,
        collaborator_id: collab.id,
        collaborator_name: collab.name,
        client_uid: `transfer-${batchId}-${c.barcode}`,
      }));
      const { error } = await supabase.from("transfers").insert(rows);
      if (error) throw error;

      toast.success(`${rows.length} traspaso${rows.length === 1 ? "" : "s"} registrado${rows.length === 1 ? "" : "s"}`);

      setCart([]);
      setBarcode("");
      setNameSearch("");
      setPhoto(null);
      qc.invalidateQueries({ queryKey: ["transfers"] });
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const totalItems = cart.reduce((s, c) => s + c.quantity, 0);

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold tracking-tight">Traspaso entre sucursales</h1>

      <Card>
        <CardContent className="space-y-4 p-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Origen</Label>
              <ToggleGroup
                type="single"
                value={origin}
                onValueChange={(v) => v && setOrigin(v as Branch)}
                className="justify-start"
              >
                <ToggleGroupItem value="A">{BRANCH_LABELS.A}</ToggleGroupItem>
                <ToggleGroupItem value="B">{BRANCH_LABELS.B}</ToggleGroupItem>
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
                <ToggleGroupItem value="A">{BRANCH_LABELS.A}</ToggleGroupItem>
                <ToggleGroupItem value="B">{BRANCH_LABELS.B}</ToggleGroupItem>
              </ToggleGroup>
            </div>
          </div>
          <div className="flex items-center justify-center gap-2 text-sm text-muted-foreground">
            <span className="font-semibold">{BRANCH_LABELS[origin]}</span>
            <ArrowRight className="h-4 w-4" />
            <span className="font-semibold">{BRANCH_LABELS[destination]}</span>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="space-y-4 p-4">
          <h2 className="text-sm font-semibold">Agregar producto (cada escaneo suma 1)</h2>
          <div>
            <Label htmlFor="barcode">Código de barras</Label>
            <div className="flex gap-2">
              <Input
                id="barcode"
                ref={barcodeRef}
                value={barcode}
                onChange={(e) => setBarcode(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    addBarcode(barcode);
                  }
                }}
                placeholder="Pistolá o tipeá y Enter para sumar 1…"
                className="font-mono"
                inputMode="numeric"
                autoFocus
              />
              <Button
                type="button"
                variant="default"
                onClick={() => setScannerOpen(true)}
                aria-label="Escanear con cámara"
                className="shrink-0"
              >
                <ScanLine className="h-4 w-4" /> Cámara
              </Button>
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              Con pistola: cada disparo agrega +1 al carrito automáticamente.
            </p>
          </div>

          <div>
            <Label htmlFor="name-search">O buscar por nombre</Label>
            <Input
              id="name-search"
              value={nameSearch}
              onChange={(e) => setNameSearch(e.target.value)}
              placeholder="Escribí al menos 2 letras y tocá un resultado…"
            />
            {nameSearch.trim().length >= 2 && nameResults.length > 0 && (
              <div className="mt-1 max-h-56 overflow-auto rounded-md border bg-card">
                {nameResults.map((r) => (
                  <button
                    key={r.barcode}
                    type="button"
                    onClick={() => addBarcode(r.barcode)}
                    className="flex w-full items-center justify-between gap-2 border-b px-3 py-2 text-left text-sm last:border-b-0 hover:bg-muted"
                  >
                    <span className="min-w-0 truncate">
                      <span className="font-medium">{r.product_name}</span>{" "}
                      <span className="text-xs text-muted-foreground">{r.uom ?? ""}</span>
                    </span>
                    <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                      Total: {Number(r.stock_a) + Number(r.stock_b)}
                    </span>
                  </button>
                ))}
              </div>
            )}
            {nameSearch.trim().length >= 2 && nameResults.length === 0 && (
              <div className="mt-1 text-xs text-muted-foreground">Sin resultados</div>
            )}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="space-y-2 p-4">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold">
              Productos en el traspaso ({cart.length})
            </h2>
            {cart.length > 0 && (
              <span className="text-xs text-muted-foreground tabular-nums">
                Total unidades: {totalItems}
              </span>
            )}
          </div>
          {cart.length === 0 ? (
            <p className="py-6 text-center text-xs text-muted-foreground">
              Pistoleá productos para empezar. No hay límite.
            </p>
          ) : (
            <div className="divide-y rounded-md border">
              {cart.map((c) => (
                <div key={c.barcode} className="flex items-center gap-2 p-2">
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium">{c.product_name}</div>
                    <div className="font-mono text-xs text-muted-foreground">
                      {c.barcode} · stock total: {c.total_stock}
                    </div>
                  </div>
                  <Input
                    type="number"
                    inputMode="decimal"
                    step="any"
                    min={0}
                    value={c.quantity}
                    onChange={(e) => updateCartQty(c.barcode, Number(e.target.value) || 0)}
                    className="h-9 w-20 text-right"
                  />
                  <Button
                    type="button"
                    size="icon"
                    variant="ghost"
                    onClick={() => removeFromCart(c.barcode)}
                    aria-label="Quitar"
                  >
                    <Trash2 className="h-4 w-4 text-red-600" />
                  </Button>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardContent className="space-y-4 p-4">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <Label>Envía</Label>
              <Select value={sender} onValueChange={setSender}>
                <SelectTrigger>
                  <SelectValue placeholder="Seleccionar colaboradora…" />
                </SelectTrigger>
                <SelectContent>
                  {collaborators.map((c) => (
                    <SelectItem key={c.id} value={c.name}>
                      {c.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Recibe</Label>
              <Select value={receiver} onValueChange={setReceiver}>
                <SelectTrigger>
                  <SelectValue placeholder="Seleccionar colaboradora…" />
                </SelectTrigger>
                <SelectContent>
                  {collaborators.map((c) => (
                    <SelectItem key={c.id} value={c.name}>
                      {c.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div>
            <Label>Foto evidencia (una para todo el traspaso)</Label>
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
              <img
                src={URL.createObjectURL(photo)}
                alt="Evidencia"
                className="mt-2 h-32 w-32 rounded-md border object-cover"
              />
            )}
          </div>

          <Button type="button" onClick={submitAll} disabled={busy || cart.length === 0} className="w-full">
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
            Confirmar {cart.length > 0 ? `${cart.length} producto${cart.length === 1 ? "" : "s"}` : "traspaso"}
          </Button>
        </CardContent>
      </Card>

      <BarcodeScanner
        open={scannerOpen}
        onClose={() => setScannerOpen(false)}
        continuous
        onDetected={(code) => addBarcode(code)}
      />
    </div>
  );
}
