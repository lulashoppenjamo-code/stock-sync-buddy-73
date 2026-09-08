import { useEffect, useRef, useState, useCallback } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Loader2, Zap, Hand } from "lucide-react";

type Props = {
  open: boolean;
  onClose: () => void;
  onDetected: (code: string) => void;
  continuous?: boolean;
};

function playBeep() {
  try {
    const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.type = "sine";
    osc.frequency.setValueAtTime(1480, ctx.currentTime);
    gain.gain.setValueAtTime(0.4, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.12);
    osc.start(ctx.currentTime);
    osc.stop(ctx.currentTime + 0.12);
  } catch { /* ignore if audio not available */ }
}

export function BarcodeScanner({ open, onClose, onDetected, continuous = false }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const animRef = useRef<number | null>(null);
  const lastEmitRef = useRef<number>(0);
  const activeRef = useRef(false);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastCode, setLastCode] = useState<string | null>(null);
  // ── Modo: "auto" = continuo, "manual" = un escaneo a la vez con botón ──
  const [mode, setMode] = useState<"auto" | "manual">("auto");
  const [pendingCode, setPendingCode] = useState<string | null>(null);
  const detectorRef = useRef<any>(null);

  const stopAll = useCallback(() => {
    activeRef.current = false;
    if (animRef.current) { cancelAnimationFrame(animRef.current); animRef.current = null; }
    if (streamRef.current) { streamRef.current.getTracks().forEach((t) => t.stop()); streamRef.current = null; }
    if (videoRef.current) videoRef.current.srcObject = null;
  }, []);

  const handleClose = useCallback(() => { stopAll(); onClose(); }, [stopAll, onClose]);

  // Confirmar escaneo en modo manual
  function confirmScan() {
    if (!pendingCode) return;
    playBeep();
    onDetected(pendingCode);
    setPendingCode(null);
    setLastCode(pendingCode);
  }

  useEffect(() => {
    if (!open) return;
    setError(null);
    setLastCode(null);
    setPendingCode(null);
    setStarting(true);
    activeRef.current = true;

    (async () => {
      try {
        const BarcodeDetector = (window as any).BarcodeDetector;
        if (!BarcodeDetector) {
          throw new Error("Tu navegador no soporta lectura de códigos nativa. Usá el campo de texto para ingresar el código.");
        }

        detectorRef.current = new BarcodeDetector({
          formats: ["ean_13", "ean_8", "code_128", "code_39", "code_93", "upc_a", "upc_e", "itf", "qr_code", "data_matrix"],
        });

        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: "environment", width: { ideal: 1280 }, height: { ideal: 720 } },
        });
        streamRef.current = stream;

        if (!videoRef.current) return;
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
        setStarting(false);

        const scan = async () => {
          if (!activeRef.current || !videoRef.current) return;
          try {
            const barcodes = await detectorRef.current.detect(videoRef.current);
            if (barcodes.length > 0) {
              const code = barcodes[0].rawValue?.trim();
              if (code) {
                if (mode === "auto" && continuous) {
                  // Modo automático: escanea cada 800ms
                  const now = Date.now();
                  if (now - lastEmitRef.current >= 800) {
                    lastEmitRef.current = now;
                    playBeep();
                    setLastCode(code);
                    onDetected(code);
                  }
                } else if (mode === "manual") {
                  // Modo manual: solo detecta y muestra, espera confirmación
                  const now = Date.now();
                  if (now - lastEmitRef.current >= 600) {
                    lastEmitRef.current = now;
                    setPendingCode(code);
                  }
                } else {
                  // Modo no-continuo original
                  stopAll();
                  playBeep();
                  onDetected(code);
                  onClose();
                  return;
                }
              }
            }
          } catch { /* frame error, ignore */ }
          if (activeRef.current) animRef.current = requestAnimationFrame(scan);
        };

        animRef.current = requestAnimationFrame(scan);
      } catch (e) {
        setStarting(false);
        const msg = (e as Error).message ?? "";
        if (msg.toLowerCase().includes("permission") || msg.toLowerCase().includes("denied")) {
          setError("Permiso de cámara denegado. Habilitalo en Configuración → Chrome → Cámara.");
        } else {
          setError(msg || "No se pudo abrir la cámara.");
        }
      }
    })();

    return () => { stopAll(); };
  }, [open, continuous, onDetected, onClose, stopAll, mode]);

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) handleClose(); }}>
      <DialogContent className="max-w-md p-0 overflow-hidden">
        <DialogHeader className="px-4 pt-4 pb-2">
          <DialogTitle>Escanear código de barras</DialogTitle>
        </DialogHeader>

        {/* Toggle de modo — solo en modo continuo */}
        {continuous && !error && !starting && (
          <div className="flex items-center gap-2 px-4 pb-2">
            <span className="text-xs text-muted-foreground">Modo:</span>
            <div className="inline-flex overflow-hidden rounded-md border text-xs">
              <button type="button"
                onClick={() => { setMode("auto"); setPendingCode(null); }}
                className={`flex items-center gap-1 px-3 py-1.5 font-medium transition-colors ${mode === "auto" ? "bg-primary text-primary-foreground" : "bg-background hover:bg-muted"}`}>
                <Zap className="h-3 w-3" /> Automático
              </button>
              <button type="button"
                onClick={() => { setMode("manual"); setPendingCode(null); }}
                className={`flex items-center gap-1 px-3 py-1.5 font-medium transition-colors ${mode === "manual" ? "bg-amber-500 text-white" : "bg-background hover:bg-muted"}`}>
                <Hand className="h-3 w-3" /> Manual
              </button>
            </div>
          </div>
        )}

        <div className="relative bg-black" style={{ aspectRatio: "16/9" }}>
          <video ref={videoRef} className="h-full w-full object-cover" autoPlay muted playsInline />

          {starting && (
            <div className="absolute inset-0 grid place-items-center bg-black">
              <div className="flex flex-col items-center gap-2 text-white">
                <Loader2 className="h-8 w-8 animate-spin" />
                <span className="text-xs opacity-70">Abriendo cámara…</span>
              </div>
            </div>
          )}

          {!starting && !error && (
            <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
              <div className="relative w-4/5" style={{ height: "38%" }}>
                <div className={`absolute top-0 left-0 h-5 w-5 border-t-2 border-l-2 ${pendingCode ? "border-amber-400" : "border-red-400"}`} />
                <div className={`absolute top-0 right-0 h-5 w-5 border-t-2 border-r-2 ${pendingCode ? "border-amber-400" : "border-red-400"}`} />
                <div className={`absolute bottom-0 left-0 h-5 w-5 border-b-2 border-l-2 ${pendingCode ? "border-amber-400" : "border-red-400"}`} />
                <div className={`absolute bottom-0 right-0 h-5 w-5 border-b-2 border-r-2 ${pendingCode ? "border-amber-400" : "border-red-400"}`} />
              </div>
            </div>
          )}

          {/* Último código escaneado en auto */}
          {mode === "auto" && lastCode && (
            <div className="pointer-events-none absolute top-3 left-1/2 -translate-x-1/2 whitespace-nowrap rounded-full bg-emerald-500/90 px-3 py-1 font-mono text-xs text-white shadow-lg">
              ✓ {lastCode}
            </div>
          )}

          {/* Código detectado en modo manual — espera confirmación */}
          {mode === "manual" && pendingCode && (
            <div className="absolute top-3 left-1/2 -translate-x-1/2 whitespace-nowrap rounded-full bg-amber-500/95 px-3 py-1 font-mono text-xs text-white shadow-lg">
              📦 {pendingCode}
            </div>
          )}

          {!error && !starting && (
            <div className="pointer-events-none absolute bottom-2 left-0 right-0 text-center text-[10px] text-white/70">
              {mode === "auto" ? "Automático — cada lectura suma 1" : "Manual — toca '+ Agregar' para confirmar"}
            </div>
          )}
        </div>

        {error && (
          <div className="mx-4 my-2 rounded-md border border-red-200 bg-red-50 dark:bg-red-950/30 p-3 text-xs text-red-700 dark:text-red-300">
            ⚠ {error}
          </div>
        )}

        <div className="flex items-center justify-between px-4 pb-4 pt-2 gap-2">
          {/* Botón de confirmar en modo manual */}
          {mode === "manual" && continuous ? (
            <>
              <Button variant="outline" onClick={handleClose}>Listo</Button>
              <Button
                onClick={confirmScan}
                disabled={!pendingCode}
                className="flex-1 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-40">
                {pendingCode ? `+ Agregar: ${pendingCode}` : "Apuntá al código…"}
              </Button>
            </>
          ) : (
            <Button variant="outline" onClick={handleClose} className="ml-auto">
              {continuous ? "Listo" : "Cancelar"}
            </Button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
