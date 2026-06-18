import { useEffect, useRef, useState, useCallback } from "react";
import { BrowserMultiFormatReader } from "@zxing/browser";
import { DecodeHintType, BarcodeFormat } from "@zxing/library";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Loader2 } from "lucide-react";

const MIN_LENGTH = 5;
const CONFIRM_FRAMES = 2;
const RETAIL_FORMATS = [
  BarcodeFormat.EAN_13,
  BarcodeFormat.EAN_8,
  BarcodeFormat.UPC_A,
  BarcodeFormat.UPC_E,
  BarcodeFormat.CODE_128,
  BarcodeFormat.CODE_39,
];

function isValidRetailBarcode(text: string) {
  if (!text || text.length < MIN_LENGTH) return false;
  return /^[A-Z0-9\-\.\/\+\s]+$/.test(text.toUpperCase());
}

type Props = {
  open: boolean;
  onClose: () => void;
  onDetected: (code: string) => void;
  /** If true, keep scanning after each detection (useful for "pistola" mode at transfers). */
  continuous?: boolean;
};

export function BarcodeScanner({ open, onClose, onDetected, continuous = false }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const controlsRef = useRef<{ stop: () => void } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const [lastCode, setLastCode] = useState<string | null>(null);
  const detectionsRef = useRef<Map<string, number>>(new Map());
  const lastDetectedRef = useRef<string | null>(null);
  const lastEmitAtRef = useRef<number>(0);

  const handleDetected = useCallback(
    (code: string) => {
      onDetected(code);
      setLastCode(code);
      if (!continuous) onClose();
    },
    [onDetected, onClose, continuous]
  );


  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    detectionsRef.current.clear();
    lastDetectedRef.current = null;

    const hints = new Map();
    hints.set(DecodeHintType.TRY_HARDER, true);
    hints.set(DecodeHintType.POSSIBLE_FORMATS, RETAIL_FORMATS);
    const reader = new BrowserMultiFormatReader(hints, {
      delayBetweenScanAttempts: 50,
      delayBetweenScanSuccess: 300,
    });
    setError(null);
    setStarting(true);

    (async () => {
      try {
        if (!videoRef.current) return;
        const constraints: MediaStreamConstraints = {
          audio: false,
          video: {
            facingMode: { ideal: "environment" },
            width: { ideal: 1280 },
            height: { ideal: 720 },
            frameRate: { ideal: 30 },
            // @ts-expect-error - non-standard but widely supported
            focusMode: "continuous",
          },
        };
        const controls = await reader.decodeFromConstraints(
          constraints,
          videoRef.current,
          (result, _err, ctrls) => {
            if (cancelled || !result) return;
            const text = result.getText().trim();
            if (!isValidRetailBarcode(text)) return;

            const map = detectionsRef.current;
            const count = (map.get(text) ?? 0) + 1;
            map.set(text, count);

            if (count >= CONFIRM_FRAMES && lastDetectedRef.current !== text) {
              lastDetectedRef.current = text;
              ctrls.stop();
              handleDetected(text);
            }
          }
        );
        controlsRef.current = controls;
        try {
          const stream = videoRef.current.srcObject as MediaStream | null;
          const track = stream?.getVideoTracks?.()[0];
          const caps = (track?.getCapabilities?.() ?? {}) as any;
          const advanced: any[] = [];
          if (caps.focusMode?.includes?.("continuous"))
            advanced.push({ focusMode: "continuous" });
          if (advanced.length && track)
            await track.applyConstraints({ advanced });
        } catch {
          /* noop */
        }
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
  }, [open, handleDetected]);

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Escanear con cámara</DialogTitle>
        </DialogHeader>
        <div className="relative overflow-hidden rounded-md bg-black aspect-video">
          <video
            ref={videoRef}
            className="h-full w-full object-cover"
            muted
            playsInline
          />
          {starting && (
            <div className="absolute inset-0 grid place-items-center text-white">
              <Loader2 className="h-6 w-6 animate-spin" />
            </div>
          )}

          {/* Scanning zone overlay — visual crop guide */}
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center p-8">
            <div className="relative h-3/5 w-4/5">
              {/* Corner brackets */}
              <div className="absolute -left-1 -top-1 h-6 w-6 border-l-2 border-t-2 border-emerald-400" />
              <div className="absolute -right-1 -top-1 h-6 w-6 border-r-2 border-t-2 border-emerald-400" />
              <div className="absolute -bottom-1 -left-1 h-6 w-6 border-b-2 border-l-2 border-emerald-400" />
              <div className="absolute -bottom-1 -right-1 h-6 w-6 border-b-2 border-r-2 border-emerald-400" />
              {/* Center line */}
              <div className="absolute inset-x-0 top-1/2 h-px -translate-y-1/2 bg-emerald-400/60" />
            </div>
          </div>

          <div className="pointer-events-none absolute bottom-2 left-0 right-0 text-center text-[10px] text-white/70">
            Centrá el código dentro del recuadro
          </div>
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
