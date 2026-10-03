import { createFileRoute, Link } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { get, set as idbSet, createStore } from "idb-keyval";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  PackageSearch, PlayCircle, Loader2, Camera, Keyboard, ScanLine,
  CheckCircle2, CircleDashed, TrendingDown, TrendingUp, DownloadCloud,
  Flag, History as HistoryIcon, MapPin,
} from "lucide-react";
import { toast } from "sonner";
import { useCollaborator } from "@/lib/session";
import { BarcodeScanner } from "@/components/BarcodeScanner";
import { enqueue } from "@/lib/offline-queue";
import { useOnline } from "@/hooks/use-online";

export const Route = createFileRoute("/app/inventory-full")({
  component: InventoryFullPage,
});

// ── Tipos ────────────────────────────────────────────────────────────
type SessionStatus = "in_progress" | "finished";

type SessionRow = {
  id: string;
  status: SessionStatus;
  started_at: string;
  started_by_name: string | null;
  finished_at: string | null;
  total_products: number;
};

type ItemRow = {
  barcode: string;
  product_name: string;
  category: string | null;
  system_stock_snapshot: number;
  unit_cost_snapshot: number;
  mina_count: number;
  morelos_count: number;
  physical_count: number;
  difference: number;
  touched: boolean;
  counted_by: string | null;
  counted_at: string | null;
};

type CountLocation = "A" | "B";
const LOCATION_LABEL: Record<CountLocation, string> = { A: "Mina", B: "Morelos" };

// ── Cache local (offline) ───────────────────────────────────────────
const localStore = createStore("inventory-full-cache", "sessions");
const itemsCacheKey = (sessionId: string) => `items-${sessionId}`;

async function fetchAllItems(sessionId: string): Promise<ItemRow[]> {
  const PAGE_SIZE = 1000;
  let all: ItemRow[] = [];
  let from = 0;
  while (true) {
    const { data, error } = await supabase
      .from("inventory_session_items")
      .select("barcode, product_name, category, system_stock_snapshot, unit_cost_snapshot, mina_count, morelos_count, physical_count, difference, touched, counted_by, counted_at")
      .eq("session_id", sessionId)
      .range(from, from + PAGE_SIZE - 1);
    if (error) throw error;
    const page = (data ?? []) as unknown as ItemRow[];
    all = all.concat(page);
    if (page.length < PAGE_SIZE) break;
    from += PAGE_SIZE;
  }
  return all;
}

function mergeServerItems(local: Map<string, ItemRow>, serverRows: ItemRow[]): Map<string, ItemRow> {
  const next = new Map(local);
  for (const row of serverRows) {
    const existing = next.get(row.barcode);
    if (!existing) { next.set(row.barcode, row); continue; }
    const existingTime = existing.counted_at ? new Date(existing.counted_at).getTime() : 0;
    const rowTime = row.counted_at ? new Date(row.counted_at).getTime() : 0;
    // "Última escritura gana" — así una tablet no le borra el avance a la otra.
    if (rowTime >= existingTime) next.set(row.barcode, row);
  }
  return next;
}

function playBeep() {
  try {
    const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.type = "sine";
    osc.frequency.setValueAtTime(1600, ctx.currentTime);
    gain.gain.setValueAtTime(0.3, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.1);
    osc.start(ctx.currentTime);
    osc.stop(ctx.currentTime + 0.1);
  } catch { /* silencioso si el navegador bloquea audio */ }
}

function playErrorBeep() {
  try {
    const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.type = "square";
    osc.frequency.setValueAtTime(220, ctx.currentTime);
    gain.gain.setValueAtTime(0.2, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.25);
    osc.start(ctx.currentTime);
    osc.stop(ctx.currentTime + 0.25);
  } catch { /* ignore */ }
}

function money(n: number) {
  return n.toLocaleString("es-MX", { style: "currency", currency: "MXN", maximumFractionDigits: 2 });
}

// ── Página raíz: decide Start vs Sesión activa ──────────────────────
function InventoryFullPage() {
  const { data: session, isLoading } = useQuery({
    queryKey: ["inventory-session", "open"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("inventory_sessions")
        .select("*")
        .eq("status", "in_progress")
        .maybeSingle();
      if (error) throw error;
      return data as SessionRow | null;
    },
    refetchInterval: 20_000,
  });

  if (isLoading) {
    return (
      <div className="flex justify-center py-16">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!session) return <StartScreen />;
  return <SessionScreen key={session.id} session={session} />;
}

// ── Pantalla inicial ─────────────────────────────────────────────────
function StartScreen() {
  const collab = useCollaborator();
  const qc = useQueryClient();
  const [creating, setCreating] = useState(false);

  async function startNew() {
    if (!collab) return;
    setCreating(true);
    try {
      const { error } = await supabase.rpc("create_inventory_session", {
        p_started_by_id: collab.id,
        p_started_by_name: collab.name,
      });
      if (error) throw error;
      toast.success("Inventario físico iniciado");
      qc.invalidateQueries({ queryKey: ["inventory-session"] });
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setCreating(false);
    }
  }

  return (
    <div className="mx-auto flex max-w-md flex-col items-center gap-4 py-12 text-center">
      <div className="grid h-14 w-14 place-items-center rounded-full bg-primary/10">
        <PackageSearch className="h-7 w-7 text-primary" />
      </div>
      <h1 className="text-lg font-semibold">Inventario físico completo</h1>
      <p className="text-sm text-muted-foreground">
        Conteo global de toda la empresa (Mina + Morelos = un solo inventario).
        Se puede pausar y continuar durante varios días.
      </p>
      <Button size="lg" className="mt-2 w-full" disabled={creating} onClick={startNew}>
        {creating ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <PlayCircle className="mr-2 h-4 w-4" />}
        Nuevo inventario
      </Button>
    </div>
  );
}

// ── Pantalla de sesión activa ───────────────────────────────────────
function SessionScreen({ session }: { session: SessionRow }) {
  const collab = useCollaborator();
  const online = useOnline();
  const qc = useQueryClient();

  const [itemsMap, setItemsMap] = useState<Map<string, ItemRow>>(new Map());
  const [loadingItems, setLoadingItems] = useState(true);
  const [scanMode, setScanMode] = useState<"reader" | "camera">(
    () => (typeof window !== "undefined" && localStorage.getItem("inv-full.scan-mode") === "camera") ? "camera" : "reader",
  );
  const [location, setLocation] = useState<CountLocation>(
    () => (typeof window !== "undefined" && localStorage.getItem("inv-full.location") === "B") ? "B" : "A",
  );
  const [cameraOpen, setCameraOpen] = useState(false);
  const [lastResult, setLastResult] = useState<ItemRow | null>(null);
  const [manualValue, setManualValue] = useState("");
  const [finalizeOpen, setFinalizeOpen] = useState(false);
  const [finalizing, setFinalizing] = useState(false);
  const [finishedSummary, setFinishedSummary] = useState<null | {
    products_total: number; counted: number; pending: number; coincide: number;
    faltante: number; sobrante: number; valor_teorico: number; valor_fisico: number; perdida_neta: number;
  }>(null);

  const readerInputRef = useRef<HTMLInputElement>(null);
  const [readerBuffer, setReaderBuffer] = useState("");
  const lastScanRef = useRef<{ code: string; time: number } | null>(null);
  const persistTimeoutRef = useRef<number | null>(null);
  // Espejo de itemsMap en un ref: así applyDelta puede leer el estado más
  // reciente sin tener que llevar `itemsMap` en sus dependencias. Si no,
  // applyDelta (y por lo tanto handleScan) se recrearía en cada escaneo,
  // y como BarcodeScanner reinicia la cámara cuando cambia `onDetected`,
  // la cámara se reiniciaría después de cada producto — justo lo
  // contrario de "escanear rápido y continuo".
  const itemsMapRef = useRef<Map<string, ItemRow>>(new Map());
  useEffect(() => { itemsMapRef.current = itemsMap; }, [itemsMap]);

  // ── Cargar items: cache local primero (rápido / offline), luego servidor ──
  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoadingItems(true);
      try {
        const cached = await get<ItemRow[]>(itemsCacheKey(session.id), localStore);
        if (cached && !cancelled && cached.length > 0) {
          setItemsMap(new Map(cached.map((r) => [r.barcode, r])));
        }
      } catch { /* sin cache disponible todavía */ }

      if (navigator.onLine) {
        try {
          const rows = await fetchAllItems(session.id);
          if (!cancelled) {
            setItemsMap((prev) => mergeServerItems(prev, rows));
            await idbSet(itemsCacheKey(session.id), rows, localStore);
          }
        } catch (e) {
          console.warn("[inventory-full] fetch error", e);
        }
      }
      if (!cancelled) setLoadingItems(false);
    })();
    return () => { cancelled = true; };
  }, [session.id]);

  const schedulePersist = useCallback((map: Map<string, ItemRow>) => {
    if (persistTimeoutRef.current) window.clearTimeout(persistTimeoutRef.current);
    persistTimeoutRef.current = window.setTimeout(() => {
      idbSet(itemsCacheKey(session.id), Array.from(map.values()), localStore).catch(() => {});
    }, 800);
  }, [session.id]);

  useEffect(() => {
    localStorage.setItem("inv-full.scan-mode", scanMode);
  }, [scanMode]);
  useEffect(() => {
    localStorage.setItem("inv-full.location", location);
  }, [location]);

  // Mantener el input del lector físico siempre enfocado (mientras no haya un diálogo abierto).
  useEffect(() => {
    if (scanMode !== "reader" || cameraOpen || finalizeOpen) return;
    const focusInput = () => readerInputRef.current?.focus();
    focusInput();
    const interval = window.setInterval(focusInput, 1500);
    return () => window.clearInterval(interval);
  }, [scanMode, cameraOpen, finalizeOpen]);

  function shouldAcceptScan(code: string) {
    const now = Date.now();
    const last = lastScanRef.current;
    if (last && last.code === code && now - last.time < 350) return false;
    lastScanRef.current = { code, time: now };
    return true;
  }

  // ── Aplicar +1 (o el delta indicado) a un código ────────────────────
  const applyDelta = useCallback(async (barcode: string, delta: number) => {
    let item = itemsMapRef.current.get(barcode);

    if (!item) {
      if (!navigator.onLine) {
        toast.error(`"${barcode}" no está precargado y no hay conexión. Conectate una vez para bajar el catálogo.`);
        playErrorBeep();
        return;
      }
      const { data: p, error } = await supabase
        .from("products")
        .select("barcode, product_name, category, stock_a, stock_b, price")
        .eq("barcode", barcode)
        .maybeSingle();
      if (error || !p) {
        toast.error(`Código no encontrado: ${barcode}`);
        playErrorBeep();
        return;
      }
      item = {
        barcode: p.barcode, product_name: p.product_name, category: p.category,
        system_stock_snapshot: p.stock_a + p.stock_b, unit_cost_snapshot: p.price,
        mina_count: 0, morelos_count: 0, physical_count: 0, difference: 0,
        touched: false, counted_by: null, counted_at: null,
      };
    }

    const mina = item.mina_count + (location === "A" ? delta : 0);
    const morelos = item.morelos_count + (location === "B" ? delta : 0);
    const physical = mina + morelos;
    const updated: ItemRow = {
      ...item, mina_count: mina, morelos_count: morelos, physical_count: physical,
      difference: physical - item.system_stock_snapshot,
      touched: true, counted_by: collab?.name ?? null, counted_at: new Date().toISOString(),
    };

    setItemsMap((prev) => {
      const next = new Map(prev);
      next.set(barcode, updated);
      schedulePersist(next);
      return next;
    });
    setLastResult(updated);
    playBeep();

    const client_uid = `invscan-${session.id}-${barcode}-${crypto.randomUUID()}`;
    const payload = {
      session_id: session.id, barcode, location, mode: "increment" as const, delta,
      collaborator_name: collab?.name ?? null, client_uid,
    };
    if (navigator.onLine) {
      const { error } = await supabase.rpc("inventory_scan", {
        p_session_id: session.id, p_barcode: barcode, p_location: location, p_delta: delta,
        p_collaborator_name: collab?.name ?? "", p_client_uid: client_uid,
      });
      if (error) {
        await enqueue({ kind: "inventory_count", uid: client_uid, createdAt: Date.now(), payload });
        toast.error(`No se sincronizó "${barcode}" — se reintentará.`);
      }
    } else {
      await enqueue({ kind: "inventory_count", uid: client_uid, createdAt: Date.now(), payload });
    }
  }, [location, session.id, collab, schedulePersist]);

  const handleScan = useCallback((raw: string) => {
    const code = raw.trim();
    if (!code) return;
    if (!shouldAcceptScan(code)) return;
    void applyDelta(code, 1);
  }, [applyDelta]);

  async function applyManualSet(barcode: string, quantity: number) {
    const item = itemsMapRef.current.get(barcode);
    if (!item) return;
    const mina = location === "A" ? quantity : item.mina_count;
    const morelos = location === "B" ? quantity : item.morelos_count;
    const physical = mina + morelos;
    const updated: ItemRow = {
      ...item, mina_count: mina, morelos_count: morelos, physical_count: physical,
      difference: physical - item.system_stock_snapshot,
      touched: true, counted_by: collab?.name ?? null, counted_at: new Date().toISOString(),
    };
    setItemsMap((prev) => {
      const next = new Map(prev);
      next.set(barcode, updated);
      schedulePersist(next);
      return next;
    });
    setLastResult(updated);

    const client_uid = `invset-${session.id}-${barcode}-${crypto.randomUUID()}`;
    const payload = {
      session_id: session.id, barcode, location, mode: "set" as const, quantity,
      collaborator_name: collab?.name ?? null, client_uid,
    };
    if (navigator.onLine) {
      const { error } = await supabase.rpc("inventory_manual_set", {
        p_session_id: session.id, p_barcode: barcode, p_location: location, p_quantity: quantity,
        p_collaborator_name: collab?.name ?? "", p_client_uid: client_uid,
      });
      if (error) {
        await enqueue({ kind: "inventory_count", uid: client_uid, createdAt: Date.now(), payload });
        toast.error(`No se sincronizó "${barcode}" — se reintentará.`);
      } else {
        toast.success(`${item.product_name}: ${quantity} u.`);
      }
    } else {
      await enqueue({ kind: "inventory_count", uid: client_uid, createdAt: Date.now(), payload });
      toast.success(`${item.product_name}: ${quantity} u. (guardado sin conexión)`);
    }
  }

  function onReaderKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter") {
      e.preventDefault();
      const code = readerBuffer.trim();
      setReaderBuffer("");
      if (code) handleScan(code);
    }
  }

  async function prefetchOffline() {
    try {
      const rows = await fetchAllItems(session.id);
      setItemsMap((prev) => mergeServerItems(prev, rows));
      await idbSet(itemsCacheKey(session.id), rows, localStore);
      toast.success(`${rows.length} productos guardados para trabajar sin conexión`);
    } catch {
      toast.error("No se pudo descargar el catálogo. Verificá tu conexión.");
    }
  }

  // ── Progreso ─────────────────────────────────────────────────────
  const items = useMemo(() => Array.from(itemsMap.values()), [itemsMap]);
  const total = items.length || session.total_products;
  const countedN = items.filter((i) => i.touched).length;
  const pendingN = total - countedN;
  const pct = total > 0 ? Math.round((countedN / total) * 100) : 0;

  async function handleFinalize() {
    if (!collab) return;
    setFinalizing(true);
    try {
      const { data, error } = await supabase.rpc("finalize_inventory_session", {
        p_session_id: session.id,
        p_finished_by_id: collab.id,
        p_finished_by_name: collab.name,
      });
      if (error) throw error;
      const row = Array.isArray(data) ? data[0] : data;
      setFinishedSummary(row);
      setFinalizeOpen(false);
      toast.success("Inventario finalizado");
      qc.invalidateQueries({ queryKey: ["inventory-session"] });
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setFinalizing(false);
    }
  }

  if (finishedSummary) {
    return <FinishedSummaryScreen summary={finishedSummary} />;
  }

  return (
    <div className="space-y-4 pb-6">
      {/* Encabezado + progreso */}
      <Card>
        <CardContent className="space-y-3 p-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h1 className="text-lg font-semibold leading-tight">Inventario físico completo</h1>
              <p className="text-xs text-muted-foreground">
                Iniciado {new Date(session.started_at).toLocaleString()} por {session.started_by_name ?? "—"}
              </p>
            </div>
            <Badge variant="secondary" className="shrink-0">En progreso</Badge>
          </div>
          <div className="space-y-1.5">
            <div className="flex items-center justify-between text-xs">
              <span className="text-muted-foreground">
                {countedN} de {total} productos contados
              </span>
              <span className="font-semibold tabular-nums">{pct}%</span>
            </div>
            <Progress value={pct} />
            <div className="text-xs text-muted-foreground">{pendingN} pendientes</div>
          </div>
          {!loadingItems && total === 0 && (
            <p className="text-xs text-amber-700">No se encontraron productos en esta sesión.</p>
          )}
        </CardContent>
      </Card>

      <Tabs defaultValue="scan">
        <TabsList className="grid w-full grid-cols-3">
          <TabsTrigger value="scan">Escanear</TabsTrigger>
          <TabsTrigger value="diff">Diferencias</TabsTrigger>
          <TabsTrigger value="summary">Resumen</TabsTrigger>
        </TabsList>

        <TabsContent value="scan" className="space-y-3">
          {/* Controles: modo de lectura + ubicación */}
          <div className="flex flex-wrap items-center gap-2">
            <div className="inline-flex overflow-hidden rounded-md border text-xs">
              <button type="button"
                onClick={() => setScanMode("reader")}
                className={`flex items-center gap-1 px-3 py-1.5 font-medium transition-colors ${scanMode === "reader" ? "bg-primary text-primary-foreground" : "bg-background hover:bg-muted"}`}>
                <Keyboard className="h-3.5 w-3.5" /> Lector físico
              </button>
              <button type="button"
                onClick={() => setScanMode("camera")}
                className={`flex items-center gap-1 px-3 py-1.5 font-medium transition-colors ${scanMode === "camera" ? "bg-primary text-primary-foreground" : "bg-background hover:bg-muted"}`}>
                <Camera className="h-3.5 w-3.5" /> Cámara
              </button>
            </div>

            <Select value={location} onValueChange={(v) => setLocation(v as CountLocation)}>
              <SelectTrigger className="w-[160px]">
                <MapPin className="mr-1 h-3.5 w-3.5 text-muted-foreground" />
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="A">Contando en Mina</SelectItem>
                <SelectItem value="B">Contando en Morelos</SelectItem>
              </SelectContent>
            </Select>

            {online && (
              <Button size="sm" variant="outline" onClick={prefetchOffline} className="ml-auto">
                <DownloadCloud className="mr-1.5 h-3.5 w-3.5" /> Preparar sin conexión
              </Button>
            )}
          </div>

          {/* Modo lector físico: input siempre enfocado */}
          {scanMode === "reader" && (
            <Card>
              <CardContent className="p-4">
                <Label className="mb-1.5 block text-xs text-muted-foreground">
                  Listo para escanear — el foco vuelve solo a este campo
                </Label>
                <div className="relative">
                  <ScanLine className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    ref={readerInputRef}
                    autoFocus
                    value={readerBuffer}
                    onChange={(e) => setReaderBuffer(e.target.value)}
                    onKeyDown={onReaderKeyDown}
                    onBlur={() => window.setTimeout(() => readerInputRef.current?.focus(), 50)}
                    placeholder="Esperando lectura..."
                    className="pl-9 font-mono"
                    inputMode="none"
                  />
                </div>
              </CardContent>
            </Card>
          )}

          {/* Modo cámara */}
          {scanMode === "camera" && (
            <Button size="lg" className="w-full" onClick={() => setCameraOpen(true)}>
              <Camera className="mr-2 h-4 w-4" /> Abrir cámara y escanear
            </Button>
          )}
          <BarcodeScanner
            open={cameraOpen}
            onClose={() => setCameraOpen(false)}
            onDetected={handleScan}
            continuous
          />

          {/* Último producto escaneado */}
          {lastResult && (
            <LastScannedCard
              item={lastResult}
              location={location}
              manualValue={manualValue}
              setManualValue={setManualValue}
              onApplyManual={(qty) => applyManualSet(lastResult.barcode, qty)}
            />
          )}
        </TabsContent>

        <TabsContent value="diff">
          <DifferencesList items={items} />
        </TabsContent>

        <TabsContent value="summary">
          <LiveSummary items={items} total={total} />
        </TabsContent>
      </Tabs>

      <Button
        variant="destructive"
        className="w-full"
        disabled={!online}
        onClick={() => setFinalizeOpen(true)}
      >
        <Flag className="mr-2 h-4 w-4" /> Finalizar inventario
      </Button>
      {!online && (
        <p className="text-center text-xs text-muted-foreground">
          Necesitás conexión para finalizar (el conteo sí funciona sin internet).
        </p>
      )}

      <FinalizeDialog
        open={finalizeOpen}
        pending={pendingN}
        total={total}
        finalizing={finalizing}
        onCancel={() => setFinalizeOpen(false)}
        onConfirm={handleFinalize}
      />
    </div>
  );
}

// ── Card del último producto escaneado, con override manual ────────
function LastScannedCard({
  item, location, manualValue, setManualValue, onApplyManual,
}: {
  item: ItemRow; location: CountLocation; manualValue: string;
  setManualValue: (v: string) => void; onApplyManual: (qty: number) => void;
}) {
  const ok = item.difference === 0;
  const pos = item.difference > 0;
  const statusColor = !item.touched
    ? "border-muted bg-muted/30"
    : ok ? "border-emerald-300 bg-emerald-50 dark:bg-emerald-950/20"
    : pos ? "border-amber-300 bg-amber-50 dark:bg-amber-950/20"
    : "border-red-300 bg-red-50 dark:bg-red-950/20";

  return (
    <Card className={statusColor}>
      <CardContent className="space-y-2 p-4">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="truncate font-medium leading-snug">{item.product_name}</div>
            <div className="font-mono text-xs text-muted-foreground">{item.barcode}</div>
          </div>
          {ok ? (
            <span className="shrink-0 font-bold text-emerald-600">✓ COINCIDE</span>
          ) : (
            <span className={`shrink-0 font-bold ${pos ? "text-amber-600" : "text-red-600"}`}>
              {pos ? "+" : ""}{item.difference} {pos ? "SOBRANTE" : "FALTANTE"}
            </span>
          )}
        </div>
        <div className="grid grid-cols-3 gap-2 text-center text-xs">
          <div>
            <div className="text-muted-foreground">Sistema</div>
            <div className="text-base font-bold tabular-nums">{item.system_stock_snapshot}</div>
          </div>
          <div>
            <div className="text-muted-foreground">Mina</div>
            <div className="text-base font-bold tabular-nums">{item.mina_count}</div>
          </div>
          <div>
            <div className="text-muted-foreground">Morelos</div>
            <div className="text-base font-bold tabular-nums">{item.morelos_count}</div>
          </div>
        </div>
        <div className="flex items-center gap-2 border-t pt-2">
          <Label className="shrink-0 text-xs text-muted-foreground">
            Escribir cantidad exacta en {LOCATION_LABEL[location]}:
          </Label>
          <Input
            type="number"
            inputMode="numeric"
            className="h-8 w-24"
            value={manualValue}
            onChange={(e) => setManualValue(e.target.value)}
          />
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              const qty = Number(manualValue);
              if (Number.isFinite(qty) && qty >= 0) onApplyManual(qty);
              setManualValue("");
            }}
          >
            Aplicar
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

// ── Lista de diferencias con filtros y orden ────────────────────────
type FilterKind = "all" | "faltante" | "sobrante" | "coincide";
type SortKind = "loss" | "qty_short" | "qty_over";

function DifferencesList({ items }: { items: ItemRow[] }) {
  const [filter, setFilter] = useState<FilterKind>("all");
  const [sort, setSort] = useState<SortKind>("loss");

  const filtered = useMemo(() => {
    let list = items.filter((i) => i.touched);
    if (filter === "faltante") list = list.filter((i) => i.difference < 0);
    else if (filter === "sobrante") list = list.filter((i) => i.difference > 0);
    else if (filter === "coincide") list = list.filter((i) => i.difference === 0);

    const value = (i: ItemRow) => i.difference * i.unit_cost_snapshot;
    if (sort === "loss") list = [...list].sort((a, b) => value(a) - value(b));
    else if (sort === "qty_short") list = [...list].sort((a, b) => a.difference - b.difference);
    else list = [...list].sort((a, b) => b.difference - a.difference);
    return list;
  }, [items, filter, sort]);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        <Select value={filter} onValueChange={(v) => setFilter(v as FilterKind)}>
          <SelectTrigger className="w-[150px]"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos</SelectItem>
            <SelectItem value="faltante">Faltantes</SelectItem>
            <SelectItem value="sobrante">Sobrantes</SelectItem>
            <SelectItem value="coincide">Coincidencias</SelectItem>
          </SelectContent>
        </Select>
        <Select value={sort} onValueChange={(v) => setSort(v as SortKind)}>
          <SelectTrigger className="w-[190px]"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="loss">Mayor pérdida económica</SelectItem>
            <SelectItem value="qty_short">Mayor faltante de piezas</SelectItem>
            <SelectItem value="qty_over">Mayor sobrante</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <Card>
        <CardContent className="p-0">
          <div className="max-h-[60vh] overflow-auto">
            <Table>
              <TableHeader className="sticky top-0 bg-card">
                <TableRow>
                  <TableHead>Producto</TableHead>
                  <TableHead className="text-right">Sistema</TableHead>
                  <TableHead className="text-right">Físico</TableHead>
                  <TableHead className="text-right">Dif.</TableHead>
                  <TableHead className="text-right">Pérdida</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((i) => {
                  const loss = i.difference * i.unit_cost_snapshot;
                  const ok = i.difference === 0;
                  return (
                    <TableRow key={i.barcode}>
                      <TableCell>
                        <div className="truncate text-sm font-medium leading-snug">{i.product_name}</div>
                        <div className="font-mono text-[10px] text-muted-foreground">{i.barcode}</div>
                      </TableCell>
                      <TableCell className="text-right tabular-nums text-xs">{i.system_stock_snapshot}</TableCell>
                      <TableCell className="text-right tabular-nums font-semibold">{i.physical_count}</TableCell>
                      <TableCell className={`text-right tabular-nums font-bold ${ok ? "text-emerald-600" : loss < 0 ? "text-red-600" : "text-amber-600"}`}>
                        {i.difference > 0 ? "+" : ""}{i.difference}
                      </TableCell>
                      <TableCell className={`text-right tabular-nums text-xs font-semibold ${loss < 0 ? "text-red-600" : loss > 0 ? "text-amber-600" : "text-muted-foreground"}`}>
                        {loss === 0 ? "—" : money(loss)}
                      </TableCell>
                    </TableRow>
                  );
                })}
                {filtered.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={5} className="py-8 text-center text-muted-foreground">
                      Sin productos contados todavía en este filtro
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

// ── Resumen en vivo (antes de finalizar) ────────────────────────────
function LiveSummary({ items, total }: { items: ItemRow[]; total: number }) {
  const touched = items.filter((i) => i.touched);
  const coincide = touched.filter((i) => i.difference === 0).length;
  const faltante = touched.filter((i) => i.difference < 0).length;
  const sobrante = touched.filter((i) => i.difference > 0).length;
  const valorTeorico = items.reduce((s, i) => s + i.system_stock_snapshot * i.unit_cost_snapshot, 0);
  const perdidaNeta = touched.reduce((s, i) => s + i.difference * i.unit_cost_snapshot, 0);

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-3">
        <StatCard label="Contados" value={`${touched.length} / ${total}`} />
        <StatCard label="Pendientes" value={String(total - touched.length)} icon={<CircleDashed className="h-4 w-4" />} />
        <StatCard label="Coinciden" value={String(coincide)} icon={<CheckCircle2 className="h-4 w-4 text-emerald-600" />} />
        <StatCard label="Con diferencia" value={String(faltante + sobrante)} />
      </div>
      <Card>
        <CardContent className="space-y-2 p-4 text-sm">
          <div className="flex items-center justify-between">
            <span className="text-muted-foreground">Valor teórico (catálogo completo)</span>
            <span className="font-semibold tabular-nums">{money(valorTeorico)}</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="flex items-center gap-1 text-muted-foreground"><TrendingDown className="h-3.5 w-3.5" /> Faltante ({faltante} prod.)</span>
            <span className="font-semibold tabular-nums text-red-600">
              {money(touched.filter((i) => i.difference < 0).reduce((s, i) => s + i.difference * i.unit_cost_snapshot, 0))}
            </span>
          </div>
          <div className="flex items-center justify-between">
            <span className="flex items-center gap-1 text-muted-foreground"><TrendingUp className="h-3.5 w-3.5" /> Sobrante ({sobrante} prod.)</span>
            <span className="font-semibold tabular-nums text-amber-600">
              {money(touched.filter((i) => i.difference > 0).reduce((s, i) => s + i.difference * i.unit_cost_snapshot, 0))}
            </span>
          </div>
          <div className="flex items-center justify-between border-t pt-2">
            <span className="font-semibold">Pérdida neta (parcial, faltan {total - touched.length} por contar)</span>
            <span className={`font-bold tabular-nums ${perdidaNeta < 0 ? "text-red-600" : "text-emerald-600"}`}>{money(perdidaNeta)}</span>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function StatCard({ label, value, icon }: { label: string; value: string; icon?: React.ReactNode }) {
  return (
    <Card>
      <CardContent className="flex items-center justify-between p-3">
        <div>
          <div className="text-xs text-muted-foreground">{label}</div>
          <div className="text-lg font-bold tabular-nums">{value}</div>
        </div>
        {icon}
      </CardContent>
    </Card>
  );
}

// ── Diálogo de finalización ──────────────────────────────────────────
function FinalizeDialog({
  open, pending, total, finalizing, onCancel, onConfirm,
}: {
  open: boolean; pending: number; total: number; finalizing: boolean;
  onCancel: () => void; onConfirm: () => void;
}) {
  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onCancel(); }}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Finalizar inventario</DialogTitle>
        </DialogHeader>
        <div className="space-y-3 text-sm">
          {pending > 0 ? (
            <p className="rounded-md border border-amber-300 bg-amber-50 p-3 text-amber-800 dark:bg-amber-950/20 dark:text-amber-200">
              Quedan <strong>{pending}</strong> de {total} productos sin contar. Al finalizar, se
              registrarán como <strong>faltante total</strong> (0 piezas contadas).
            </p>
          ) : (
            <p className="rounded-md border border-emerald-300 bg-emerald-50 p-3 text-emerald-800 dark:bg-emerald-950/20 dark:text-emerald-200">
              Se contaron los {total} productos. Esta acción es irreversible: el inventario quedará
              cerrado y no se podrá modificar.
            </p>
          )}
          <p className="text-muted-foreground">¿Confirmás el cierre?</p>
        </div>
        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={onCancel} disabled={finalizing}>Cancelar</Button>
          <Button variant="destructive" onClick={onConfirm} disabled={finalizing}>
            {finalizing ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Flag className="mr-2 h-4 w-4" />}
            Finalizar inventario
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Pantalla final tras cerrar ───────────────────────────────────────
function FinishedSummaryScreen({ summary }: {
  summary: {
    products_total: number; counted: number; pending: number; coincide: number;
    faltante: number; sobrante: number; valor_teorico: number; valor_fisico: number; perdida_neta: number;
  };
}) {
  return (
    <div className="mx-auto max-w-md space-y-4 py-4">
      <div className="flex flex-col items-center gap-2 text-center">
        <CheckCircle2 className="h-10 w-10 text-emerald-600" />
        <h1 className="text-lg font-semibold">Inventario finalizado</h1>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <StatCard label="Productos" value={String(summary.products_total)} />
        <StatCard label="Contados" value={String(summary.counted)} />
        <StatCard label="Coinciden" value={String(summary.coincide)} />
        <StatCard label="Pendientes" value={String(summary.pending)} />
        <StatCard label="Con faltante" value={String(summary.faltante)} />
        <StatCard label="Con sobrante" value={String(summary.sobrante)} />
      </div>

      <Card>
        <CardContent className="space-y-2 p-4 text-sm">
          <div className="flex items-center justify-between">
            <span className="text-muted-foreground">Valor teórico</span>
            <span className="font-semibold tabular-nums">{money(summary.valor_teorico)}</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-muted-foreground">Valor físico</span>
            <span className="font-semibold tabular-nums">{money(summary.valor_fisico)}</span>
          </div>
          <div className="flex items-center justify-between border-t pt-2">
            <span className="font-semibold">Pérdida neta</span>
            <span className={`font-bold tabular-nums ${summary.perdida_neta < 0 ? "text-red-600" : "text-emerald-600"}`}>
              {money(summary.perdida_neta)}
            </span>
          </div>
        </CardContent>
      </Card>

      <Link
        to="/app/audit-history"
        className="flex w-full items-center justify-center gap-2 rounded-md border bg-card px-4 py-2.5 text-sm font-medium hover:bg-muted"
      >
        <HistoryIcon className="h-4 w-4" /> Ver detalle en Historial de auditorías
      </Link>
    </div>
  );
}
