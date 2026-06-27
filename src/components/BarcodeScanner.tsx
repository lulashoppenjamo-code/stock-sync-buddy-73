import { useEffect, useRef, useState, useCallback } from "react";
import { BrowserMultiFormatReader, NotFoundException } from "@zxing/browser";
import { DecodeHintType, BarcodeFormat } from "@zxing/library";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Loader2 } from "lucide-react";

type Props = {
  open: boolean;
  onClose: () => void;
  onDetected: (code: string) => void;
  continuous?: boolean;
};

const HINTS = new Map();
HINTS.set(DecodeHintType.POSSIBLE_FORMATS, [
  BarcodeFormat.EAN_13,
  BarcodeFormat.EAN_8,
  BarcodeFormat.CODE_128,
  BarcodeFormat.CODE_39,
  BarcodeFormat.CODE_93,
  BarcodeFormat.UPC_A,
  BarcodeFormat.UPC_E,
  BarcodeFormat.ITF,
  BarcodeFormat.QR_CODE,
  BarcodeFormat.DATA_MATRIX,
  BarcodeFormat.AZTEC,
]);
HINTS.set(DecodeHintType.TRY_HARDER, true);

export function BarcodeScanner({ open, onClose, onDetected, continuous = false }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const readerRef = useRef<BrowserMultiFormatReader | null>(null);
  const lastEmitRef = useRef<number>(0);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastCode, setLastCode] = useState<string | null>(null);
  const activeRef = useRef(false);

  const stopReader = useCallback(async () => {
    activeRef.current = false;
    if (readerRef.current) {
      try { BrowserMultiFormatReader.releaseAllStreams(); } catch { /* noop */ }
      readerRef.current = null;
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
  }, []);

  const handleClose = useCallback(async () => {
    await stopReader();
    onClose();
  }, [stopReader, onClose]);

  useEffect(() => {
    if (!open) return;
    setError(null);
    setLastCode(null);
    setStarting(true);
    activeRef.current = true;

    const reader = new BrowserMultiFormatReader(HINTS, {
      delayBetweenScanAttempts: 50,
    });
    readerRef.current = reader;

    (async () => {
      try {
        // Pick the back camera
        const devices = await BrowserMultiFormatReader.listVideoInputDevices();
        const back = devices.find((d) =>
          d.label.toLowerCase().includes("back") ||
          d.label.toLowerCase().includes("rear") ||
          d.label.toLowerCase().includes("environment") ||
          d.label.toLowerCase().includes("trasera")
        ) ?? devices[devices.length - 1]; // fallback to last camera

        if (!back) throw new Error("No se encontró ninguna cámara.");

        setStarting(false);

        await reader.decodeFromVideoDevice(
          back.deviceId,
          videoRef.current!,
          (result, err) => {
            if (!activeRef.current) return;
            if (result) {
              const code = result.getText().trim();
              if (!code) return;

              if (continuous) {
                const now = Date.now();
                if (now - lastEmitRef.current < 800) return;
                lastEmitRef.current = now;
                setLastCode(code);
                onDetected(code);
              } else {
                stopReader();
                onDetected(code);
                onClose();
              }
            }
            if (err && !(err instanceof NotFoundException)) {
              // Real errors (not just "nothing found in frame")
              console.warn("ZXing error:", err);
            }
          }
        );
      } catch (e) {
        setStarting(false);
        const msg = (e as Error).message ?? "";
        if (msg.toLowerCase().includes("permission") || msg.toLowerCase().includes("denied")) {
          setError("Permiso de cámara denegado. Habilitalo en la configuración del navegador.");
        } else if (msg.toLowerCase().includes("notfound") || msg.toLowerCase().includes("not found") || msg.toLowerCase().includes("no se encontró")) {
          setError("No se encontró ninguna cámara.");
        } else {
          setError(msg || "No se pudo abrir la cámara.");
        }
      }
    })();

    return () => { stopReader(); };
  }, [open, continuous, onDetected, onClose, stopReader]);

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) handleClose(); }}>
      <DialogContent className="max-w-md p-0 overflow-hidden">
        <DialogHeader className="px-4 pt-4 pb-2">
          <DialogTitle>Escanear código de barras</DialogTitle>
        </DialogHeader>

        <div className="relative bg-black" style={{ aspectRatio: "16/9" }}>
          {/* Video element */}
          <video
            ref={videoRef}
            className="h-full w-full object-cover"
            autoPlay
            muted
            playsInline
          />

          {/* Loading */}
          {starting && (
            <div className="absolute inset-0 grid place-items-center bg-black">
              <div className="flex flex-col items-center gap-2 text-white">
                <Loader2 className="h-8 w-8 animate-spin" />
                <span className="text-xs opacity-70">Abriendo cámara…</span>
              </div>
            </div>
          )}

          {/* Scan guide — rectangular for barcodes */}
          {!starting && !error && (
            <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
              <div className="relative w-4/5" style={{ height: "35%" }}>
                {/* Corner brackets */}
                <div className="absolute top-0 left-0 h-6 w-6 border-t-2 border-l-2 border-red-400" />
                <div className="absolute top-0 right-0 h-6 w-6 border-t-2 border-r-2 border-red-400" />
                <div className="absolute bottom-0 left-0 h-6 w-6 border-b-2 border-l-2 border-red-400" />
                <div className="absolute bottom-0 right-0 h-6 w-6 border-b-2 border-r-2 border-red-400" />
                {/* Scan line */}
                <div className="absolute inset-x-0 top-0 h-0.5 bg-red-400 opacity-80"
                  style={{ animation: "scanline 2s ease-in-out infinite" }} />
              </div>
              <style>{`
                @keyframes scanline {
                  0% { transform: translateY(0); }
                  50% { transform: translateY(calc(var(--scan-height, 60px))); }
                  100% { transform: translateY(0); }
                }
              `}</style>
            </div>
          )}

          {/* Last scanned */}
          {continuous && lastCode && (
            <div className="pointer-events-none absolute top-3 left-1/2 -translate-x-1/2 whitespace-nowrap rounded-full bg-emerald-500/90 px-3 py-1 font-mono text-xs text-white shadow-lg">
              ✓ {lastCode}
            </div>
          )}

          {/* Hint */}
          {!error && !starting && (
            <div className="pointer-events-none absolute bottom-2 left-0 right-0 text-center text-[10px] text-white/70">
              {continuous ? "Modo continuo — cada lectura suma 1" : "Centrá el código dentro del recuadro"}
            </div>
          )}
        </div>

        {/* Error */}
        {error && (
          <div className="mx-4 my-2 rounded-md border border-red-200 bg-red-50 dark:bg-red-950/30 p-3 text-xs text-red-700 dark:text-red-300">
            ⚠ {error}
          </div>
        )}

        <div className="flex justify-end px-4 pb-4 pt-2">
          <Button variant="outline" onClick={handleClose}>
            {continuous ? "Listo" : "Cancelar"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
