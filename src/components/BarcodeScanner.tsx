import { useEffect, useRef, useState, useCallback } from "react";
import { Html5Qrcode } from "html5-qrcode";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Loader2 } from "lucide-react";

const SCANNER_ID = "html5qr-scanner";

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

  const stopScanner = useCallback(async () => {
    if (scannerRef.current && isRunningRef.current) {
      try {
        await scannerRef.current.stop();
        scannerRef.current.clear();
      } catch {
        /* noop */
      }
      isRunningRef.current = false;
    }
  }, []);

  const handleDetected = useCallback(
    (code: string) => {
      if (continuous) {
        const now = Date.now();
        if (now - lastEmitAtRef.current < 700) return;
        lastEmitAtRef.current = now;
        onDetected(code);
        setLastCode(code);
      } else {
        stopScanner();
        onDetected(code);
        setLastCode(code);
        onClose();
      }
    },
    [onDetected, onClose, continuous, stopScanner]
  );

  useEffect(() => {
    if (!open) return;

    setError(null);
    setStarting(true);
    setLastCode(null);

    const timer = setTimeout(async () => {
      try {
        const scanner = new Html5Qrcode(SCANNER_ID);
        scannerRef.current = scanner;

        await scanner.start(
          { facingMode: "environment" },
          {
            fps: 15,
            qrbox: { width: 250, height: 150 },
            aspectRatio: 1.7,
            supportedScanTypes: [],
          },
          (decodedText) => {
            handleDetected(decodedText.trim());
          },
          () => {
            // Error de frame ignorado
          }
        );

        isRunningRef.current = true;
      } catch (e) {
        setError((e as Error).message || "No se pudo abrir la cámara");
      } finally {
        setStarting(false);
      }
    }, 300);

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
    <Dialog open={open} onOpenChange={(o) => !o && handleClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Escanear con cámara</DialogTitle>
        </DialogHeader>

        <div className="relative overflow-hidden rounded-md bg-black aspect-video">
          <div id={SCANNER_ID} className="w-full h-full" />

          {starting && (
            <div className="absolute inset-0 grid place-items-center text-white bg-black">
              <Loader2 className="h-6 w-6 animate-spin" />
            </div>
          )}

          <div className="pointer-events-none absolute bottom-2 left-0 right-0 text-center text-[10px] text-white/70">
            {continuous
              ? "Modo continuo: cada escaneo suma 1 al carrito"
              : "Centrá el código dentro del recuadro"}
          </div>

          {continuous && lastCode && (
            <div className="pointer-events-none absolute top-2 left-1/2 -translate-x-1/2 rounded-md bg-emerald-500/90 px-3 py-1 font-mono text-xs text-white shadow">
              +1 · {lastCode}
            </div>
          )}
        </div>

        {error && <p className="text-sm text-red-600">{error}</p>}

        <div className="flex justify-end">
          <Button variant="outline" onClick={handleClose}>
            {continuous ? "Listo" : "Cancelar"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
