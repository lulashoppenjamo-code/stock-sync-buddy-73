import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState, useMemo } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Camera, ArrowRight, Loader2, Send, ScanLine, Trash2, RotateCcw, WifiOff } from "lucide-react";
import { toast } from "sonner";
import { getCollaborator, useCollaborator } from "@/lib/session";
import { BRANCH_LABELS } from "@/lib/branches";
import { BarcodeScanner } from "@/components/BarcodeScanner";
import { useOnline } from "@/hooks/use-online";
import { enqueue } from "@/lib/offline-queue";

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

const CART_KEY = "inv.transfer.cart.v1";

function loadCart(): CartItem[] {
  try { const r = localStorage.getItem(CART_KEY); return r ? JSON.parse(r) : []; }
  catch { return []; }
}
function saveCart(cart: CartItem[]) {
  try { localStorage.setItem(CART_KEY, JSON.stringify(cart)); } catch { /* ignore */ }
}
function clearCart() {
  try { localStorage.removeItem(CART_KEY); } catch { /* ignore */ }
}

// Offline pending transfers
const OFFLINE_TRANSFERS_KEY = "inv.offline.transfers.v1";
type OfflineTransfer = {
  id: string;
  cart: CartItem[];
  origin: Branch;
  destination: Branch;
  sender: string;
  receiver: string;
  photoBase64: string;
  photoType: string;
  photoName: string;
  savedAt: number;
};

function loadOfflineTransfers(): OfflineTransfer[] {
  try { const r = localStorage.getItem(OFFLINE_TRANSFERS_KEY); return r ? JSON.parse(r) : []; }
  catch { return []; }
}
function saveOfflineTransfer(t: OfflineTransfer) {
  try {
    const existing = loadOfflineTransfers();
    existing.push(t);
    localStorage.setItem(OFFLINE_TRANSFERS_KEY, JSON.stringify(existing));
  } catch { /* ignore */ }
}
function removeOfflineTransfer(id: string) {
  try {
    const existing = loadOfflineTransfers().filter((t) => t.id !== id);
    localStorage.setItem(OFFLINE_TRANSFERS_KEY, JSON.stringify(existing));
  } catch { /* ignore */ }
}

function useDebounce<T>(value: T, delay = 300): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(t);
  }, [value, delay]);
  return debounced;
}

// Convert File to base64
function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve((reader.result as string).split(",")[1]);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

// Convert base64 back to Blob
function base64ToBlob(base64: string, type: string): Blob {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type });
}

function TransferPage() {
  const qc = useQueryClient();
  const online = useOnline();
  const [barcode, setBarcode] = useState("");
  const [nameSearch, setNameSearch] = useState("");
  const debouncedNameSearch = useDebounce(nameSearch, 300);
  const [origin, setOrigin] = useState<Branch>("A");
  const [destination, setDestination] = useState<Branch>("B");
  const me = useCollaborator();
  const [sender, setSender] = useState(me?.name ?? "");
  const [receiver, setReceiver] = useState("");
  useEffect(() => { if (me?.name && !sender) setSender(me.name); }, [me?.name, sender]);
  const [photo, setPhoto] = useState<File | null>(null);
  const [cart, setCart] = useState<CartItem[]>(() => loadCart());
  const [busy, setBusy] = useState(false);
  const [scannerOpen, setScannerOpen] = useState(false);
  const [syncingOffline, setSyncingOffline] = useState(false);
  const [pendingOffline, setPendingOffline] = useState<OfflineTransfer[]>(() => loadOfflineTransfers());
  const photoRef = useRef<HTMLInputElement>(null);
  const galleryRef = useRef<HTMLInputElement>(null);
  const barcodeRef = useRef<HTMLInputElement>(null);

  useEffect(() => { saveCart(cart); }, [cart]);

  // Auto-sync offline transfers when back online
  useEffect(() => {
    if (online && pendingOffline.length > 0) {
      syncOfflineTransfers();
    }
  }, [online]);

  const { data: collaborators = [] } = useQuery({
    queryKey: ["collaborators-active"],
    staleTime: online ? 30_000 : Infinity,
    queryFn: async () => {
      const { data, error } = await supabase.from("collaborators").select("id, name").eq("active", true).order("name");
      if (error) throw error;
      return data as Array<{ id: string; name: string }>;
    },
  });

  const { data: nameResults = [] } = useQuery({
    queryKey: ["product-search-name", debouncedNameSearch],
    enabled: debouncedNameSearch.trim().length >= 2 && online,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("products")
        .select("barcode, product_name, uom, stock_a, stock_b")
        .ilike("product_name", `%${debouncedNameSearch.trim()}%`)
        .order("product_name")
        .limit(15);
      if (error) throw error;
      return data as Array<{ barcode: string; product_name: string; uom: string | null; stock_a: number; stock_b: number }>;
    },
  });

  async function addBarcode(code: string) {
    const c = code.trim();
    if (!c) return;
    if (!online) {
      // Check if product is already in cart
      const existing = cart.find((x) => x.barcode === c);
      if (existing) {
        setCart((prev) => prev.map((x) => x.barcode === c ? { ...x, quantity: x.quantity + 1 } : x));
        toast.success(`+1 · ${existing.product_name}`);
        setBarcode(""); barcodeRef.current?.focus();
        return;
      }
      toast.error("Sin internet — solo podés agregar productos que ya están en el carrito");
      return;
    }
    const { data, error } = await supabase
      .from("products").select("barcode, product_name, uom, stock_a, stock_b")
      .eq("barcode", c).maybeSingle();
    if (error) { toast.error(error.message); return; }
    if (!data) { toast.error(`Producto no encontrado: ${c}`); return; }
    const total = Number(data.stock_a) + Number(data.stock_b);
    setCart((prev) => {
      const i = prev.findIndex((x) => x.barcode === data.barcode);
      if (i >= 0) {
        const copy = [...prev];
        copy[i] = { ...copy[i], quantity: copy[i].quantity + 1 };
        return copy;
      }
      return [...prev, { barcode: data.barcode, product_name: data.product_name, uom: data.uom, total_stock: total, quantity: 1 }];
    });
    toast.success(`+1 · ${data.product_name}`);
    setBarcode(""); setNameSearch("");
    barcodeRef.current?.focus();
  }

  function removeFromCart(bc: string) { setCart((prev) => prev.filter((c) => c.barcode !== bc)); }
  function updateCartQty(bc: string, q: number) { setCart((prev) => prev.map((c) => (c.barcode === bc ? { ...c, quantity: Math.max(1, q) } : c))); }

  const totalItems = useMemo(() => cart.reduce((s, c) => s + c.quantity, 0), [cart]);

  // ── Sync offline transfers when back online ──
  async function syncOfflineTransfers() {
    if (!online || syncingOffline) return;
    const pending = loadOfflineTransfers();
    if (!pending.length) return;
    setSyncingOffline(true);
    let synced = 0;
    for (const t of pending) {
      try {
        const blob = base64ToBlob(t.photoBase64, t.photoType);
        const ext = t.photoName.split(".").pop() || "jpg";
        const path = `${t.id}.${ext}`;
        const up = await supabase.storage.from("transfer-photos").upload(path, blob, { contentType: t.photoType, upsert: true });
        if (up.error) throw up.error;
        const { data: signed } = await supabase.storage.from("transfer-photos").createSignedUrl(path, 60 * 60 * 24 * 365);
        const photo_url = signed?.signedUrl ?? path;
        const collab = getCollaborator();
        const rows = t.cart.map((c) => ({
          barcode: c.barcode, product_name: c.product_name, quantity: c.quantity,
          origin: t.origin, destination: t.destination,
          sender_name: t.sender, receiver_name: t.receiver,
          photo_url, collaborator_id: collab?.id ?? null, collaborator_name: collab?.name ?? t.sender,
          client_uid: `transfer-${t.id}-${c.barcode}`,
        }));
        const { error } = await supabase.from("transfers").insert(rows);
        if (error) throw error;
        removeOfflineTransfer(t.id);
        synced++;
      } catch (e) {
        console.warn("[offline-transfer] sync failed:", e);
      }
    }
    const remaining = loadOfflineTransfers();
    setPendingOffline(remaining);
    setSyncingOffline(false);
    if (synced > 0) {
      toast.success(`${synced} traspaso${synced === 1 ? "" : "s"} offline sincronizado${synced === 1 ? "" : "s"}`);
      qc.invalidateQueries({ queryKey: ["transfers"] });
    }
  }

  async function submitAll() {
    if (cart.length === 0) return toast.error("Agregá al menos un producto");
    if (origin === destination) return toast.error("Origen y destino deben ser distintos");
    if (!sender.trim() || !receiver.trim()) return toast.error("Seleccioná quién envía y recibe");
    if (!photo) return toast.error("La foto es obligatoria");
    for (const c of cart) { if (c.quantity <= 0) return toast.error(`Cantidad inválida en ${c.product_name}`); }
    const collab = getCollaborator();
    if (!collab) return toast.error("Sesión expirada");

    setBusy(true);
    try {
      const batchId = crypto.randomUUID();

      if (!online) {
        // Save offline
        const photoBase64 = await fileToBase64(photo);
        const offlineTransfer: OfflineTransfer = {
          id: batchId,
          cart: [...cart],
          origin,
          destination,
          sender: sender.trim(),
          receiver: receiver.trim(),
          photoBase64,
          photoType: photo.type,
          photoName: photo.name,
          savedAt: Date.now(),
        };
        saveOfflineTransfer(offlineTransfer);
        setPendingOffline(loadOfflineTransfers());
        toast.success(`Sin internet — ${cart.length} producto${cart.length === 1 ? "" : "s"} guardado${cart.length === 1 ? "" : "s"} localmente. Se enviará cuando haya conexión.`);
        setCart([]); clearCart();
        setBarcode(""); setNameSearch(""); setPhoto(null);
        return;
      }

      // Online flow
      const ext = (photo.name.split(".").pop() || "jpg").toLowerCase();
      const path = `${batchId}.${ext}`;
      const up = await supabase.storage.from("transfer-photos").upload(path, photo, { contentType: photo.type, upsert: true });
      if (up.error) throw up.error;
      const { data: signed } = await supabase.storage.from("transfer-photos").createSignedUrl(path, 60 * 60 * 24 * 365);
      const photo_url = signed?.signedUrl ?? path;
      const rows = cart.map((c) => ({
        barcode: c.barcode, product_name: c.product_name, quantity: c.quantity,
        origin, destination, sender_name: sender.trim(), receiver_name: receiver.trim(),
        photo_url, collaborator_id: collab.id, collaborator_name: collab.name,
        client_uid: `transfer-${batchId}-${c.barcode}`,
      }));
      const { error } = await supabase.from("transfers").insert(rows);
      if (error) throw error;
      toast.success(`${rows.length} traspaso${rows.length === 1 ? "" : "s"} registrado${rows.length === 1 ? "" : "s"}`);
      setCart([]); clearCart();
      setBarcode(""); setNameSearch(""); setPhoto(null);
      qc.invalidateQueries({ queryKey: ["transfers"] });
    } catch (err) { toast.error((err as Error).message); }
    finally { setBusy(false); }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <h1 className="mr-auto text-xl font-semibold tracking-tight">Traspaso entre sucursales</h1>
        {!online && (
          <span className="flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800">
            <WifiOff className="h-3 w-3" /> Sin internet
          </span>
        )}
        {cart.length > 0 && (
          <button type="button" onClick={() => { setCart([]); clearCart(); }}
            className="flex items-center gap-1 text-xs text-muted-foreground hover:text-red-500">
            <RotateCcw className="h-3.5 w-3.5" /> Limpiar carrito
          </button>
        )}
      </div>

      {/* Offline banner */}
      {!online && (
        <div className="flex items-start gap-2 rounded-md border border-amber-300 bg-amber-50 dark:bg-amber-950/30 px-3 py-2 text-xs text-amber-800 dark:text-amber-200">
          <WifiOff className="h-4 w-4 mt-0.5 shrink-0" />
          <div>
            <p className="font-medium">Modo sin conexión</p>
            <p className="mt-0.5">El traspaso se guardará en este dispositivo y se enviará automáticamente cuando vuelva el internet.</p>
          </div>
        </div>
      )}

      {/* Pending offline transfers */}
      {pendingOffline.length > 0 && (
        <div className="rounded-md border border-blue-200 bg-blue-50 dark:bg-blue-950/30 px-3 py-2 text-xs text-blue-800 dark:text-blue-200">
          <div className="flex items-center justify-between">
            <span>📤 {pendingOffline.length} traspaso{pendingOffline.length === 1 ? "" : "s"} pendiente{pendingOffline.length === 1 ? "" : "s"} de sincronizar</span>
            {online && (
              <button type="button" onClick={syncOfflineTransfers} disabled={syncingOffline}
                className="ml-2 underline font-medium">
                {syncingOffline ? "Sincronizando…" : "Sincronizar ahora"}
              </button>
            )}
          </div>
        </div>
      )}

      {cart.length > 0 && (
        <div className="rounded-md border border-blue-200 bg-blue-50 dark:bg-blue-950/30 px-3 py-2 text-xs text-blue-800 dark:text-blue-200">
          📦 Carrito guardado: {cart.length} producto{cart.length === 1 ? "" : "s"} · {totalItems} unidades.
        </div>
      )}

      <Card>
        <CardContent className="space-y-4 p-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Origen</Label>
              <ToggleGroup type="single" value={origin} onValueChange={(v) => v && setOrigin(v as Branch)} className="justify-start">
                <ToggleGroupItem value="A">{BRANCH_LABELS.A}</ToggleGroupItem>
                <ToggleGroupItem value="B">{BRANCH_LABELS.B}</ToggleGroupItem>
              </ToggleGroup>
            </div>
            <div>
              <Label>Destino</Label>
              <ToggleGroup type="single" value={destination} onValueChange={(v) => v && setDestination(v as Branch)} className="justify-start">
                <ToggleGroupItem value="A">{BRANCH_LABELS.A}</ToggleGroupItem>
                <ToggleGroupItem value="B">{BRANCH_LABELS.B}</ToggleGroupItem>
              </ToggleGroup>
            </div>
          </div>
          {origin === destination && (
            <p className="text-xs text-red-500">⚠ Origen y destino no pueden ser iguales.</p>
          )}
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
              <Input id="barcode" ref={barcodeRef} value={barcode}
                onChange={(e) => setBarcode(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addBarcode(barcode); } }}
                placeholder="Pistolá o tipeá y Enter…" className="font-mono" inputMode="numeric" autoFocus />
              <Button type="button" variant="default" onClick={() => setScannerOpen(true)} className="shrink-0">
                <ScanLine className="h-4 w-4" /> Cámara
              </Button>
            </div>
            {!online && (
              <p className="mt-1 text-xs text-amber-600">Sin internet — solo podés agregar productos ya en el carrito por código</p>
            )}
          </div>
          <div>
            <Label htmlFor="name-search">O buscar por nombre</Label>
            <Input id="name-search" value={nameSearch} onChange={(e) => setNameSearch(e.target.value)}
              placeholder={online ? "Escribí al menos 2 letras…" : "No disponible sin internet"} disabled={!online} />
            {online && debouncedNameSearch.trim().length >= 2 && nameResults.length > 0 && (
              <div className="mt-1 max-h-56 overflow-auto rounded-md border bg-card">
                {nameResults.map((r) => (
                  <button key={r.barcode} type="button" onClick={() => addBarcode(r.barcode)}
                    className="flex w-full items-center justify-between gap-2 border-b px-3 py-2 text-left text-sm last:border-b-0 hover:bg-muted">
                    <span className="min-w-0 truncate">
                      <span className="font-medium">{r.product_name}</span>{" "}
                      <span className="text-xs text-muted-foreground">{r.uom ?? ""}</span>
                    </span>
                    <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                      Stock: {Number(r.stock_a) + Number(r.stock_b)}
                    </span>
                  </button>
                ))}
              </div>
            )}
            {online && debouncedNameSearch.trim().length >= 2 && nameResults.length === 0 && (
              <div className="mt-1 text-xs text-muted-foreground">Sin resultados</div>
            )}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="space-y-2 p-4">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold">Productos en el traspaso ({cart.length})</h2>
            {cart.length > 0 && (
              <span className="text-xs text-muted-foreground tabular-nums">Total: {totalItems} unidades</span>
            )}
          </div>
          {cart.length === 0 ? (
            <p className="py-6 text-center text-xs text-muted-foreground">Pistoleá productos para empezar.</p>
          ) : (
            <div className="divide-y rounded-md border">
              {cart.map((c) => (
                <div key={c.barcode} className="flex items-center gap-2 p-2">
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium">{c.product_name}</div>
                    <div className="font-mono text-xs text-muted-foreground">{c.barcode} · stock: {c.total_stock}</div>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <button type="button" onClick={() => updateCartQty(c.barcode, c.quantity - 1)}
                      disabled={c.quantity <= 1}
                      className="flex h-7 w-7 items-center justify-center rounded-full border text-lg font-bold disabled:opacity-30 hover:bg-muted">
                      −
                    </button>
                    <span className="w-8 text-center tabular-nums font-semibold">{c.quantity}</span>
                    <button type="button" onClick={() => updateCartQty(c.barcode, c.quantity + 1)}
                      className="flex h-7 w-7 items-center justify-center rounded-full border text-lg font-bold hover:bg-muted">
                      +
                    </button>
                  </div>
                  <Button type="button" size="icon" variant="ghost" onClick={() => removeFromCart(c.barcode)}>
                    <Trash2 className="h-4 w-4 text-red-500" />
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
              <Input value={sender} readOnly className="bg-muted" />
              <p className="mt-1 text-xs text-muted-foreground">Tu sesión actual.</p>
            </div>
            <div>
              <Label>Recibe</Label>
              <Select value={receiver} onValueChange={setReceiver}>
                <SelectTrigger><SelectValue placeholder="Seleccionar…" /></SelectTrigger>
                <SelectContent>
                  {collaborators.map((c) => <SelectItem key={c.id} value={c.name}>{c.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div>
            <Label>Foto evidencia</Label>
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
              {photo && <span className="text-xs text-muted-foreground">{photo.name} ({Math.round(photo.size / 1024)} KB)</span>}
            </div>
            {photo && <img src={URL.createObjectURL(photo)} alt="Evidencia" className="mt-2 h-32 w-32 rounded-md border object-cover" />}
          </div>

          <Button type="button" onClick={submitAll} disabled={busy || cart.length === 0 || origin === destination} className="w-full">
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
            {online
              ? `Confirmar ${cart.length > 0 ? `${cart.length} producto${cart.length === 1 ? "" : "s"} · ${totalItems} unidades` : "traspaso"}`
              : `Guardar offline (${cart.length} producto${cart.length === 1 ? "" : "s"})`
            }
          </Button>
        </CardContent>
      </Card>

      <BarcodeScanner open={scannerOpen} onClose={() => setScannerOpen(false)}
        continuous onDetected={(code) => addBarcode(code)} />
    </div>
  );
}
