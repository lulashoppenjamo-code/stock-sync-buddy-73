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
  const me = useCollaborator();

  // Fetch branch assigned to this collaborator
  const { data: collabData } = useQuery({
    queryKey: ["collab-branch-transfer", me?.id],
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

  // Origin = sucursal asignada al colaborador (fija)
  const myBranch: Branch = collabData?.branch === "B" ? "B" : "A";
  const [destination, setDestination] = useState<Branch>("B");

  // Auto-set destination to the other branch when origin is known
  useEffect(() => {
    setDestination(myBranch === "A" ? "B" : "A");
  }, [myBranch]);

  // Admin y Ana pueden cambiar origen; las demás tienen origen fijo
  const canChangeOrigin = me?.is_admin || me?.name?.toLowerCase().includes("ana");
  const [origin, setOrigin] = useState<Branch>("A");
  // Sync origin with myBranch when it loads
  useEffect(() => {
    setOrigin(myBranch);
  }, [myBranch]);

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
    queryKey: ["collaborators-active", online],
    staleTime: online ? 30_000 : Infinity,
    queryFn: async () => {
      if (!online) {
        const { getCachedCollaborators } = await import("@/lib/offline-cache");
        return (await getCachedCollaborators()).map((c) => ({ id: c.id, name: c.name }));
      }
      try {
        const { data, error } = await supabase.from("collaborators").select("id, name").eq("active", true).order("name");
        if (error) throw error;
        return data as Array<{ id: string; name: string }>;
      } catch {
        const { getCachedCollaborators } = await import("@/lib/offline-cache");
        return (await getCachedCollaborators()).map((c) => ({ id: c.id, name: c.name }));
      }
    },
  });

  const { data: nameResults = [] } = useQuery({
    queryKey: ["product-search-name", debouncedNameSearch, online],
    enabled: debouncedNameSearch.trim().length >= 2,
    queryFn: async () => {
      type Row = { barcode: string; product_name: string; uom: string | null; stock_a: number; stock_b: number };
      if (!online) {
        const { searchCachedProducts } = await import("@/lib/offline-cache");
        const rows = await searchCachedProducts(debouncedNameSearch.trim(), 15);
        return rows as Row[];
      }
      try {
        const { data, error } = await supabase
          .from("products")
          .select("barcode, product_name, uom, stock_a, stock_b")
          .ilike("product_name", `%${debouncedNameSearch.trim()}%`)
          .order("product_name")
          .limit(15);
        if (error) throw error;
        return data as Row[];
      } catch {
        const { searchCachedProducts } = await import("@/lib/offline-cache");
        return (await searchCachedProducts(debouncedNameSearch.trim(), 15)) as Row[];
      }
    },
  });

  // Historial de traspasos: solo se abre cuando el usuario lo solicita (no automático)
  const [historyBarcode, setHistoryBarcode] = useState<string | null>(null);
  const [historyName, setHistoryName] = useState<string | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);

  const { data: productTransfers = [], isFetching: loadingTransfers } = useQuery({
    queryKey: ["product-transfer-history", historyBarcode],
    enabled: !!historyBarcode && historyOpen && online,
    staleTime: 15_000,
    queryFn: async () => {
      if (!historyBarcode) return [];
      const { data, error } = await supabase
        .from("transfers")
        .select("id, barcode, product_name, quantity, origin, destination, sender_name, receiver_name, created_at, received_at, received_by_name, received_quantity, received_sender_name, received_receiver_name")
        .eq("barcode", historyBarcode)
        .order("created_at", { ascending: false })
        .limit(30);
      if (error) throw error;
      return data ?? [];
    },
  });

  function showProductHistory(bc: string, name?: string) {
    setHistoryBarcode(bc);
    setHistoryName(name ?? null);
    setHistoryOpen(true);
  }

  function closeProductHistory() {
    setHistoryOpen(false);
    setHistoryBarcode(null);
    setHistoryName(null);
  }

  async function addBarcode(code: string) {
    const c = code.trim();
    if (!c) return;

    // Ya en el carrito → sumar 1 (funciona con o sin internet)
    const existing = cart.find((x) => x.barcode === c);
    if (existing) {
      setCart((prev) => prev.map((x) => x.barcode === c ? { ...x, quantity: x.quantity + 1 } : x));
      toast.success(`+1 · ${existing.product_name}`);
      setBarcode(""); barcodeRef.current?.focus();
      return;
    }

    type ProdRow = { barcode: string; product_name: string; uom: string | null; stock_a: number; stock_b: number };
    let data: ProdRow | null = null;

    if (online) {
      const res = await supabase
        .from("products").select("barcode, product_name, uom, stock_a, stock_b")
        .eq("barcode", c).maybeSingle();
      if (res.error) { toast.error(res.error.message); return; }
      data = res.data as ProdRow | null;
    }

    // Sin internet o falló el servidor → caché local
    if (!data) {
      const { getCachedProductByBarcode } = await import("@/lib/offline-cache");
      const cached = await getCachedProductByBarcode(c);
      if (cached) {
        data = {
          barcode: cached.barcode,
          product_name: cached.product_name,
          uom: cached.uom,
          stock_a: cached.stock_a,
          stock_b: cached.stock_b,
        };
      }
    }

    if (!data) {
      toast.error(
        online
          ? `Producto no encontrado: ${c}`
          : `Sin internet y el producto ${c} no está en la caché local. Abrí la app con internet una vez para descargar el catálogo.`
      );
      return;
    }

    const total = Number(data.stock_a) + Number(data.stock_b);
    setCart((prev) => {
      const i = prev.findIndex((x) => x.barcode === data!.barcode);
      if (i >= 0) {
        const copy = [...prev];
        copy[i] = { ...copy[i], quantity: copy[i].quantity + 1 };
        return copy;
      }
      return [...prev, { barcode: data!.barcode, product_name: data!.product_name, uom: data!.uom, total_stock: total, quantity: 1 }];
    });
    toast.success(`+1 · ${data.product_name}${online ? "" : " (offline)"}`);
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
              {/* Admin y Ana pueden cambiar origen; las demás lo tienen fijo */}
              {(me?.is_admin || me?.name?.toLowerCase().includes("ana")) ? (
                <ToggleGroup type="single" value={origin} onValueChange={(v) => v && setOrigin(v as Branch)} className="justify-start">
                  <ToggleGroupItem value="A">{BRANCH_LABELS.A}</ToggleGroupItem>
                  <ToggleGroupItem value="B">{BRANCH_LABELS.B}</ToggleGroupItem>
                </ToggleGroup>
              ) : (
                <>
                  <div className="mt-1 inline-flex overflow-hidden rounded-md border">
                    <div className="bg-primary text-primary-foreground px-4 py-1.5 text-sm font-medium">
                      {BRANCH_LABELS[origin]}
                    </div>
                  </div>
                  <p className="mt-1 text-[11px] text-muted-foreground">Tu sucursal asignada</p>
                </>
              )}
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
              placeholder="Escribí al menos 2 letras…" />
            {!online && (
              <p className="mt-1 text-xs text-amber-600">Sin internet — buscando en catálogo guardado en este dispositivo</p>
            )}
            {debouncedNameSearch.trim().length >= 2 && nameResults.length > 0 && (
              <div className="mt-1 max-h-56 overflow-auto rounded-md border bg-card">
                {nameResults.map((r) => (
                  <div key={r.barcode} className="flex items-stretch border-b last:border-b-0">
                    <button type="button" onClick={() => addBarcode(r.barcode)}
                      className="flex min-w-0 flex-1 items-center justify-between gap-2 px-3 py-2 text-left text-sm hover:bg-muted">
                      <span className="min-w-0 truncate">
                        <span className="font-medium">{r.product_name}</span>{" "}
                        <span className="text-xs text-muted-foreground">{r.uom ?? ""}</span>
                      </span>
                      <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                        Stock: {Number(r.stock_a) + Number(r.stock_b)}
                      </span>
                    </button>
                    <button
                      type="button"
                      title="Ver historial de traspasos"
                      onClick={() => showProductHistory(r.barcode, r.product_name)}
                      className="shrink-0 border-l px-2 text-[11px] text-muted-foreground hover:bg-muted hover:text-primary"
                    >
                      📋
                    </button>
                  </div>
                ))}
              </div>
            )}
            {debouncedNameSearch.trim().length >= 2 && nameResults.length === 0 && (
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
                  <button
                    type="button"
                    title="Ver movimientos de traspaso"
                    onClick={() => showProductHistory(c.barcode, c.product_name)}
                    className="shrink-0 rounded border px-1.5 py-1 text-[11px] text-muted-foreground hover:bg-muted hover:text-primary"
                  >
                    📋
                  </button>
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

      {/* Historial de movimientos: oculto por defecto; solo se despliega si el usuario lo pide (📋) */}
      {historyOpen && historyBarcode && (
        <Card className="border-blue-200 dark:border-blue-900">
          <CardContent className="space-y-2 p-4">
            <div className="flex items-center justify-between gap-2">
              <h2 className="text-sm font-semibold">
                Movimientos de traspaso
                {historyName ? ` · ${historyName}` : ""}
              </h2>
              <button
                type="button"
                onClick={closeProductHistory}
                className="text-xs text-muted-foreground hover:text-foreground"
              >
                Cerrar
              </button>
            </div>
            <p className="font-mono text-[10px] text-muted-foreground">{historyBarcode}</p>
            {loadingTransfers && (
              <div className="flex items-center gap-2 py-3 text-xs text-muted-foreground">
                <Loader2 className="h-3.5 w-3.5 animate-spin" /> Cargando movimientos…
              </div>
            )}
            {!loadingTransfers && productTransfers.length === 0 && (
              <p className="py-3 text-center text-xs text-muted-foreground">
                Este producto aún no tiene traspasos registrados.
              </p>
            )}
            {!loadingTransfers && productTransfers.length > 0 && (
              <div className="max-h-72 divide-y overflow-y-auto rounded-md border">
                {productTransfers.map((t) => {
                  const received = !!t.received_at;
                  const sender = t.received_sender_name || t.sender_name;
                  const receiver = t.received_receiver_name || t.receiver_name;
                  const qty = t.received_quantity != null ? t.received_quantity : t.quantity;
                  return (
                    <div key={t.id} className="px-3 py-2 text-xs space-y-0.5">
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-medium">
                          {BRANCH_LABELS[t.origin as Branch] ?? t.origin}
                          {" → "}
                          {BRANCH_LABELS[t.destination as Branch] ?? t.destination}
                        </span>
                        <span className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium ${
                          received
                            ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-200"
                            : "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-200"
                        }`}>
                          {received ? "Recibido" : "Pendiente"}
                        </span>
                      </div>
                      <div className="text-muted-foreground">
                        Cantidad: <span className="font-semibold text-foreground">{qty}</span>
                        {t.received_quantity != null && t.received_quantity !== t.quantity && (
                          <span className="ml-1">(enviado: {t.quantity})</span>
                        )}
                      </div>
                      <div className="text-muted-foreground">
                        Envió: <span className="text-foreground">{sender || "—"}</span>
                        {" · "}
                        Recibió: <span className="text-foreground">{receiver || "—"}</span>
                      </div>
                      <div className="text-[10px] text-muted-foreground">
                        Enviado: {new Date(t.created_at).toLocaleString("es-MX", {
                          day: "numeric", month: "short", year: "numeric",
                          hour: "2-digit", minute: "2-digit",
                        })}
                        {t.received_at && (
                          <>
                            {" · "}Recibido: {new Date(t.received_at).toLocaleString("es-MX", {
                              day: "numeric", month: "short", year: "numeric",
                              hour: "2-digit", minute: "2-digit",
                            })}
                            {t.received_by_name ? ` por ${t.received_by_name}` : ""}
                          </>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      <BarcodeScanner open={scannerOpen} onClose={() => setScannerOpen(false)}
        continuous onDetected={(code) => addBarcode(code)} />
    </div>
  );
}
