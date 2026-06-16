import { useEffect, useRef, useState } from "react";
import { BrowserMultiFormatReader } from "@zxing/browser";
import { DecodeHintType, BarcodeFormat } from "@zxing/library";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Loader2 } from "lucide-react";

type Props = {
  open: boolean;
  onClose: () => void;
  onDetected: (code: string) => void;
};

export function BarcodeScanner({ open, onClose, onDetected }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const controlsRef = useRef<{ stop: () => void } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    const reader = new BrowserMultiFormatReader();
    setError(null);
    setStarting(true);

    (async () => {
      try {
        const devices = await BrowserMultiFormatReader.listVideoInputDevices();
        // Prefer back camera
        const back = devices.find((d) => /back|rear|environment|trasera/i.test(d.label));
        const deviceId = back?.deviceId ?? devices[0]?.deviceId;
        if (!videoRef.current) return;
        const controls = await reader.decodeFromVideoDevice(
          deviceId ?? undefined,
          videoRef.current,
          (result, _err, ctrls) => {
            if (result && !cancelled) {
              ctrls.stop();
              onDetected(result.getText());
              onClose();
            }
          },
        );
        controlsRef.current = controls;
      } catch (e) {
        setError((e as Error).message || "No se pudo abrir la cámara");
      } finally {
        setStarting(false);
      }
    })();

    return () => {
      cancelled = true;
      try {
        controlsRef.current?.stop();
      } catch {
        /* noop */
      }
      controlsRef.current = null;
    };
  }, [open, onClose, onDetected]);

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Escanear con cámara</DialogTitle>
        </DialogHeader>
        <div className="relative overflow-hidden rounded-md bg-black aspect-video">
          <video ref={videoRef} className="h-full w-full object-cover" muted playsInline />
          {starting && (
            <div className="absolute inset-0 grid place-items-center text-white">
              <Loader2 className="h-6 w-6 animate-spin" />
            </div>
          )}
          <div className="pointer-events-none absolute inset-x-8 top-1/2 h-0.5 -translate-y-1/2 bg-red-500/80" />
        </div>
        {error && <p className="text-sm text-red-600">{error}</p>}
        <div className="flex justify-end">
          <Button variant="outline" onClick={onClose}>
            Cancelar
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
