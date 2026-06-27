import { useEffect, useRef, useState, useCallback } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Loader2 } from "lucide-react";

type Props = {
  open: boolean;
  onClose: () => void;
  onDetected: (code: string) => void;
  continuous?: boolean;
};

export function BarcodeScanner({ open, onClose, onDetected, continuous = false }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const animRef = useRef<number | null>(null);
  const lastEmitRef = useRef<number>(0);
  const activeRef = useRef(false);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastCode, setLastCode] = useState<string | null>(null);

  const stopAll = useCallback(() => {
    activeRef.current = false;
    if (animRef.current) { cancelAnimationFrame(animRef.current); animRef.current = null; }
    if (streamRef.current) { streamRef.current.getTracks().forEach((t) => t.stop()); streamRef.current = null; }
    if (videoRef.current) videoRef.current.srcObject = null;
  }, []);

  const handleClose = useCallback(() => { stopAll(); onClose(); }, [stopAll, onClose]);

  useEffect(() => {
    if (!open) return;
    setError(null);
    setLastCode(null);
    setStarting(true);
    activeRef.current = true;

    (async () => {
      try {
        // Use BarcodeDetector API (native in Chrome Android)
        const BarcodeDetector = (window as any).BarcodeDetector;
        if (!BarcodeDetector) {
          throw new Error("Tu navegador no soporta lectura de códigos nativa. Usá el campo de texto para ingresar el código.");
        }

        const detector = new BarcodeDetector({
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
            const barcodes = await detector.detect(videoRef.current);
            if (barcodes.length > 0) {
              const code = barcodes[0].rawValue?.trim();
              if (code) {
                if (continuous) {
                  const now = Date.now();
                  if (now - lastEmitRef.current >= 800) {
                    lastEmitRef.current = now;
                    setLastCode(code);
                    onDetected(code);
                  }
                } else {
                  stopAll();
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
  }, [open, continuous, onDetected, onClose, stopAll]);

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) handleClose(); }}>
      <DialogContent className="max-w-md p-0 overflow-hidden">
        <DialogHeader className="px-4 pt-4 pb-2">
          <DialogTitle>Escanear código de barras</DialogTitle>
        </DialogHeader>

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
                <div className="absolute top-0 left-0 h-5 w-5 border-t-2 border-l-2 border-red-400" />
                <div className="absolute top-0 right-0 h-5 w-5 border-t-2 border-r-2 border-red-400" />
                <div className="absolute bottom-0 left-0 h-5 w-5 border-b-2 border-l-2 border-red-400" />
                <div className="absolute bottom-0 right-0 h-5 w-5 border-b-2 border-r-2 border-red-400" />
              </div>
            </div>
          )}

          {continuous && lastCode && (
            <div className="pointer-events-none absolute top-3 left-1/2 -translate-x-1/2 whitespace-nowrap rounded-full bg-emerald-500/90 px-3 py-1 font-mono text-xs text-white shadow-lg">
              ✓ {lastCode}
            </div>
          )}

          {!error && !starting && (
            <div className="pointer-events-none absolute bottom-2 left-0 right-0 text-center text-[10px] text-white/70">
              {continuous ? "Modo continuo — cada lectura suma 1" : "Centrá el código dentro del recuadro"}
            </div>
          )}
        </div>

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
