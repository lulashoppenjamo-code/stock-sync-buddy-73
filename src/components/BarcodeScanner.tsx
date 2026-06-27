import { useEffect, useRef, useState, useCallback } from "react";
import { Html5Qrcode, Html5QrcodeSupportedFormats } from "html5-qrcode";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Loader2, ZoomIn, ZoomOut } from "lucide-react";

const SCANNER_ID = "html5qr-scanner";

// All barcode formats that products use
const BARCODE_FORMATS = [
  Html5QrcodeSupportedFormats.EAN_13,
  Html5QrcodeSupportedFormats.EAN_8,
  Html5QrcodeSupportedFormats.CODE_128,
  Html5QrcodeSupportedFormats.CODE_39,
  Html5QrcodeSupportedFormats.CODE_93,
  Html5QrcodeSupportedFormats.UPC_A,
  Html5QrcodeSupportedFormats.UPC_E,
  Html5QrcodeSupportedFormats.ITF,
  Html5QrcodeSupportedFormats.QR_CODE,
  Html5QrcodeSupportedFormats.DATA_MATRIX,
];

type Props = {
  open: boolean;
  onClose: () => void;
  onDetected: (code: string) => void;
  continuous?: boolean;
};

export function BarcodeScanner({ open, onClose, onDetected, continuous = false }: Props) {
  const scannerRef = useRef<Html5Qrcode | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const [lastCode, setLastCode] = useState<string | null>(null);
  const lastEmitAtRef = useRef<number>(0);
  const isRunningRef = useRef(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const stopScanner = useCallback(async () => {
    if (scannerRef.current && isRunningRef.current) {
      try {
        await scannerRef.current.stop();
        scannerRef.current.clear();
      } catch { /* noop */ }
      isRunningRef.current = false;
    }
  }, []);

  const handleDetected = useCallback((code: string) => {
    const trimmed = code.trim();
    if (!trimmed) return;
    if (continuous) {
      const now = Date.now();
      if (now - lastEmitAtRef.current < 800) return; // debounce 800ms
      lastEmitAtRef.current = now;
      onDetected(trimmed);
      setLastCode(trimmed);
    } else {
      stopScanner();
      onDetected(trimmed);
      setLastCode(trimmed);
      onClose();
    }
  }, [onDetected, onClose, continuous, stopScanner]);

  useEffect(() => {
    if (!open) return;
    setError(null);
    setStarting(true);
    setLastCode(null);

    const timer = setTimeout(async () => {
      try {
        // Get container width for responsive qrbox
        const containerW = containerRef.current?.offsetWidth ?? 320;
        const boxW = Math.min(containerW - 32, 300);
        const boxH = Math.round(boxW * 0.45); // wide rectangle for barcodes

        const scanner = new Html5Qrcode(SCANNER_ID, {
          formatsToSupport: BARCODE_FORMATS,
          verbose: false,
        });
        scannerRef.current = scanner;

        await scanner.start(
          { facingMode: "environment" },
          {
            fps: 20,
            qrbox: { width: boxW, height: boxH },
            aspectRatio: 1.7,
            disableFlip: false,
          },
          (decodedText) => handleDetected(decodedText),
          () => { /* per-frame error, ignore */ }
        );

        isRunningRef.current = true;
      } catch (e) {
        const msg = (e as Error).message ?? "";
        if (msg.toLowerCase().includes("permission")) {
          setError("Permiso de cámara denegado. Habilitalo en la configuración del navegador.");
        } else if (msg.toLowerCase().includes("notfound") || msg.toLowerCase().includes("not found")) {
          setError("No se encontró ninguna cámara trasera.");
        } else {
          setError(msg || "No se pudo abrir la cámara.");
        }
      } finally {
        setStarting(false);
      }
    }, 350);

    return () => {
      clearTimeout(timer);
      stopScanner();
    };
  }, [open, handleDetected, stopScanner]);

  const handleClose = useCallback(async () => {
    await stopScanner();
    onClose();
  }, [stopScanner, onClose]);

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) handleClose(); }}>
      <DialogContent className="max-w-md p-0 overflow-hidden">
        <DialogHeader className="px-4 pt-4 pb-2">
          <DialogTitle>Escanear código de barras</DialogTitle>
        </DialogHeader>

        <div ref={containerRef} className="relative bg-black" style={{ aspectRatio: "16/9" }}>
          {/* Scanner renders here */}
          <div id={SCANNER_ID} className="w-full h-full" />

          {/* Loading overlay */}
          {starting && (
            <div className="absolute inset-0 grid place-items-center bg-black">
              <div className="flex flex-col items-center gap-2 text-white">
                <Loader2 className="h-8 w-8 animate-spin" />
                <span className="text-xs opacity-70">Abriendo cámara…</span>
              </div>
            </div>
          )}

          {/* Scan area guide overlay */}
          {!starting && !error && (
            <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
              <div className="relative" style={{ width: "80%", height: "40%" }}>
                {/* Corner markers */}
                {[
                  "top-0 left-0 border-t-2 border-l-2",
                  "top-0 right-0 border-t-2 border-r-2",
                  "bottom-0 left-0 border-b-2 border-l-2",
                  "bottom-0 right-0 border-b-2 border-r-2",
                ].map((cls, i) => (
                  <div key={i} className={`absolute h-5 w-5 border-white ${cls}`} />
                ))}
                {/* Scan line animation */}
                <div className="absolute inset-x-0 top-0 h-0.5 animate-[scan_2s_linear_infinite] bg-red-400 opacity-80" />
              </div>
            </div>
          )}

          {/* Last scanned code */}
          {continuous && lastCode && (
            <div className="pointer-events-none absolute top-2 left-1/2 -translate-x-1/2 whitespace-nowrap rounded-full bg-emerald-500/90 px-3 py-1 font-mono text-xs text-white shadow-lg">
              ✓ {lastCode}
            </div>
          )}

          {/* Instructions */}
          {!error && (
            <div className="pointer-events-none absolute bottom-2 left-0 right-0 text-center text-[10px] text-white/70">
              {continuous ? "Modo continuo — cada lectura suma 1" : "Centrá el código dentro del recuadro"}
            </div>
          )}
        </div>

        {/* Error */}
        {error && (
          <div className="mx-4 my-2 rounded-md bg-red-50 dark:bg-red-950/30 border border-red-200 p-3 text-xs text-red-700 dark:text-red-300">
            ⚠ {error}
          </div>
        )}

        <div className="flex justify-end gap-2 px-4 pb-4 pt-2">
          <Button variant="outline" onClick={handleClose}>
            {continuous ? "Listo" : "Cancelar"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
