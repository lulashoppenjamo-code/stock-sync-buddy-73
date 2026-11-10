import { useEffect, useRef, useState, useCallback } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Loader2, Zap, Hand, Plus, Minus } from "lucide-react";

export type ScannerCountEntry = {
  barcode: string;
  product_name: string;
  count: number;
  system_stock: number;
};

type Props = {
  open: boolean;
  onClose: () => void;
  onDetected: (code: string) => void | boolean | Promise<void | boolean>;
  continuous?: boolean;
  countEntries?: ScannerCountEntry[];
  onChangeCount?: (barcode: string, quantity: number) => void;
};

function playBeep() {
  try {
    const AudioContextClass =
      window.AudioContext || (window as any).webkitAudioContext;

    const ctx = new AudioContextClass();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.connect(gain);
    gain.connect(ctx.destination);

    osc.type = "sine";
    osc.frequency.setValueAtTime(1480, ctx.currentTime);
    gain.gain.setValueAtTime(0.35, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(
      0.001,
      ctx.currentTime + 0.12
    );

    osc.start();
    osc.stop(ctx.currentTime + 0.12);
    osc.onended = () => void ctx.close();
  } catch {
    // El sonido no debe interrumpir el escaneo.
  }
}

function playErrorBeep() {
  try {
    const AudioContextClass =
      window.AudioContext || (window as any).webkitAudioContext;

    const ctx = new AudioContextClass();

    [320, 190].forEach((frequency, index) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      const start = ctx.currentTime + index * 0.16;

      osc.connect(gain);
      gain.connect(ctx.destination);

      osc.type = "square";
      osc.frequency.setValueAtTime(frequency, start);
      gain.gain.setValueAtTime(0.22, start);
      gain.gain.exponentialRampToValueAtTime(
        0.001,
        start + 0.12
      );

      osc.start(start);
      osc.stop(start + 0.12);

      if (index === 1) {
        osc.onended = () => void ctx.close();
      }
    });
  } catch {
    // El sonido no debe interrumpir el escaneo.
  }
}

export function BarcodeScanner({
  open,
  onClose,
  onDetected,
  continuous = false,
  countEntries,
  onChangeCount,
}: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const detectorRef = useRef<any>(null);
  const animationRef = useRef<number | null>(null);

  const activeRef = useRef(false);
  const scanningRef = useRef(false);

  const onDetectedRef = useRef(onDetected);
  const onCloseRef = useRef(onClose);

  const modeRef = useRef<"auto" | "manual">("auto");
  const pendingCodeRef = useRef<string | null>(null);

  const lastCodeRef = useRef<string | null>(null);
  const lastSeenRef = useRef(0);
  const manualReadyRef = useRef(true);

  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastCode, setLastCode] = useState<string | null>(null);
  const [mode, setMode] = useState<"auto" | "manual">("auto");
  const [pendingCode, setPendingCode] = useState<string | null>(null);
  const [processing, setProcessing] = useState(false);

  const entries = countEntries ?? [];
  const showCountPanel =
    Array.isArray(countEntries) && typeof onChangeCount === "function";

  useEffect(() => {
    onDetectedRef.current = onDetected;
  }, [onDetected]);

  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  const stopAll = useCallback(() => {
    activeRef.current = false;

    if (animationRef.current !== null) {
      cancelAnimationFrame(animationRef.current);
      animationRef.current = null;
    }

    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }

    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
  }, []);

  const handleClose = useCallback(() => {
    stopAll();
    onCloseRef.current();
  }, [stopAll]);

  const processCode = useCallback(async (code: string) => {
    try {
      const result = await onDetectedRef.current(code);

      if (result === false) {
        playErrorBeep();
        return false;
      }

      playBeep();
      setLastCode(code);
      return true;
    } catch {
      playErrorBeep();
      return false;
    }
  }, []);

  const changeMode = (nextMode: "auto" | "manual") => {
    modeRef.current = nextMode;
    setMode(nextMode);

    pendingCodeRef.current = null;
    setPendingCode(null);

    lastCodeRef.current = null;
    lastSeenRef.current = 0;
    manualReadyRef.current = true;
  };

  const confirmScan = async () => {
    const code = pendingCodeRef.current;

    if (!code || processing) return;

    setProcessing(true);
    pendingCodeRef.current = null;
    setPendingCode(null);
    manualReadyRef.current = false;

    await processCode(code);

    setProcessing(false);
  };

  useEffect(() => {
    if (!open) return;

    let cancelled = false;

    setError(null);
    setLastCode(null);
    setPendingCode(null);
    setStarting(true);
    setProcessing(false);

    modeRef.current = "auto";
    pendingCodeRef.current = null;
    lastCodeRef.current = null;
    lastSeenRef.current = 0;
    manualReadyRef.current = true;

    activeRef.current = true;
    scanningRef.current = false;

    const startCamera = async () => {
      try {
        const BarcodeDetectorClass = (window as any).BarcodeDetector;

        if (!BarcodeDetectorClass) {
          throw new Error(
            "Tu navegador no soporta lectura de códigos nativa. Usá el campo de texto para ingresar el código."
          );
        }

        detectorRef.current = new BarcodeDetectorClass({
          formats: [
            "ean_13",
            "ean_8",
            "code_128",
            "code_39",
            "code_93",
            "upc_a",
            "upc_e",
            "itf",
            "qr_code",
            "data_matrix",
          ],
        });

        const stream = await navigator.mediaDevices.getUserMedia({
          video: {
            facingMode: "environment",
            width: { ideal: 1280 },
            height: { ideal: 720 },
          },
        });

        if (cancelled) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }

        streamRef.current = stream;

        if (!videoRef.current) return;

        videoRef.current.srcObject = stream;
        await videoRef.current.play();

        if (cancelled) return;

        setStarting(false);

        const scanFrame = async () => {
          if (
            cancelled ||
            !activeRef.current ||
            !videoRef.current
          ) {
            return;
          }

          if (scanningRef.current) {
            animationRef.current = requestAnimationFrame(scanFrame);
            return;
          }

          scanningRef.current = true;

          try {
            const barcodes = await detectorRef.current.detect(
              videoRef.current
            );

            const now = Date.now();

            if (barcodes.length > 0) {
              const code = barcodes[0].rawValue?.trim();

              if (code) {
                const previousCode = lastCodeRef.current;
                const wasAbsent =
                  now - lastSeenRef.current > 700;

                lastSeenRef.current = now;
                lastCodeRef.current = code;

                if (continuous && modeRef.current === "auto") {
                  const isNewProduct =
                    previousCode !== code || wasAbsent;

                  if (isNewProduct) {
                    await processCode(code);
                  }
                } else if (
                  continuous &&
                  modeRef.current === "manual"
                ) {
                  const isDifferentCode =
                    pendingCodeRef.current !== code;

                  if (
                    manualReadyRef.current &&
                    (isDifferentCode || !pendingCodeRef.current)
                  ) {
                    pendingCodeRef.current = code;
                    setPendingCode(code);
                  }
                } else if (!continuous) {
                  activeRef.current = false;
                  stopAll();

                  await processCode(code);

                  onCloseRef.current();
                  return;
                }
              }
            } else {
              if (now - lastSeenRef.current > 700) {
                lastCodeRef.current = null;

                if (modeRef.current === "manual") {
                  manualReadyRef.current = true;
                }
              }
            }
          } catch {
            // Ignorar errores aislados de lectura de imagen.
          } finally {
            scanningRef.current = false;
          }

          if (!cancelled && activeRef.current) {
            animationRef.current = requestAnimationFrame(scanFrame);
          }
        };

        animationRef.current = requestAnimationFrame(scanFrame);
      } catch (e) {
        if (cancelled) return;

        setStarting(false);

        const message = (e as Error).message ?? "";

        if (
          message.toLowerCase().includes("permission") ||
          message.toLowerCase().includes("denied")
        ) {
          setError(
            "Permiso de cámara denegado. Habilitalo en Configuración → Chrome → Cámara."
          );
        } else {
          setError(message || "No se pudo abrir la cámara.");
        }
      }
    };

    void startCamera();

    return () => {
      cancelled = true;
      stopAll();
    };
  }, [open, continuous, stopAll, processCode]);

  const totalUnits = entries.reduce(
    (sum, item) => sum + item.count,
    0
  );

  return (
    <Dialog
      open={open}
      onOpenChange={(value) => {
        if (!value) handleClose();
      }}
    >
      <DialogContent className="max-w-md max-h-[92dvh] overflow-y-auto p-0">
        <DialogHeader className="px-4 pt-4 pb-2">
          <DialogTitle>Escanear código de barras</DialogTitle>
        </DialogHeader>

        {continuous && !error && !starting && (
          <div className="flex items-center gap-2 px-4 pb-2">
            <span className="text-xs text-muted-foreground">
              Modo:
            </span>

            <div className="inline-flex overflow-hidden rounded-md border text-xs">
              <button
                type="button"
                onClick={() => changeMode("auto")}
                className={`flex items-center gap-1 px-3 py-1.5 font-medium transition-colors ${
                  mode === "auto"
                    ? "bg-primary text-primary-foreground"
                    : "bg-background hover:bg-muted"
                }`}
              >
                <Zap className="h-3 w-3" />
                Automático
              </button>

              <button
                type="button"
                onClick={() => changeMode("manual")}
                className={`flex items-center gap-1 px-3 py-1.5 font-medium transition-colors ${
                  mode === "manual"
                    ? "bg-amber-500 text-white"
                    : "bg-background hover:bg-muted"
                }`}
              >
                <Hand className="h-3 w-3" />
                Manual
              </button>
            </div>
          </div>
        )}

        <div className="relative bg-black" style={{ aspectRatio: "16/9" }}>
          <video
            ref={videoRef}
            className="h-full w-full object-cover"
            autoPlay
            muted
            playsInline
          />

          {starting && (
            <div className="absolute inset-0 grid place-items-center bg-black">
              <div className="flex flex-col items-center gap-2 text-white">
                <Loader2 className="h-8 w-8 animate-spin" />
                <span className="text-xs opacity-70">
                  Abriendo cámara…
                </span>
              </div>
            </div>
          )}

          {!starting && !error && (
            <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
              <div className="relative w-4/5" style={{ height: "38%" }}>
                <div
                  className={`absolute left-0 top-0 h-5 w-5 border-l-2 border-t-2 ${
                    pendingCode ? "border-amber-400" : "border-red-400"
                  }`}
                />
                <div
                  className={`absolute right-0 top-0 h-5 w-5 border-r-2 border-t-2 ${
                    pendingCode ? "border-amber-400" : "border-red-400"
                  }`}
                />
                <div
                  className={`absolute bottom-0 left-0 h-5 w-5 border-b-2 border-l-2 ${
                    pendingCode ? "border-amber-400" : "border-red-400"
                  }`}
                />
                <div
                  className={`absolute bottom-0 right-0 h-5 w-5 border-b-2 border-r-2 ${
                    pendingCode ? "border-amber-400" : "border-red-400"
                  }`}
                />
              </div>
            </div>
          )}

          {mode === "auto" && lastCode && (
            <div className="pointer-events-none absolute left-1/2 top-3 -translate-x-1/2 whitespace-nowrap rounded-full bg-emerald-500/90 px-3 py-1 font-mono text-xs text-white shadow-lg">
              ✓ {lastCode}
            </div>
          )}

          {mode === "manual" && pendingCode && (
            <div className="absolute left-1/2 top-3 -translate-x-1/2 whitespace-nowrap rounded-full bg-amber-500/95 px-3 py-1 font-mono text-xs text-white shadow-lg">
              📦 {pendingCode}
            </div>
          )}

          {!error && !starting && (
            <div className="pointer-events-none absolute bottom-2 left-0 right-0 text-center text-[10px] text-white/70">
              {mode === "auto"
                ? "Automático — retira el producto para volver a escanearlo"
                : "Manual — toca '+ Agregar' para confirmar"}
            </div>
          )}
        </div>

        {error && (
          <div className="mx-4 my-2 rounded-md border border-red-200 bg-red-50 p-3 text-xs text-red-700 dark:bg-red-950/30 dark:text-red-300">
            ⚠ {error}
          </div>
        )}

        {showCountPanel && (
          <div className="mx-4 mt-3 overflow-hidden rounded-lg border">
            <div className="flex items-center justify-between border-b bg-muted/50 px-3 py-2">
              <div>
                <p className="text-sm font-semibold">
                  Productos escaneados
                </p>
                <p className="text-[11px] text-muted-foreground">
                  {entries.length} productos · {totalUnits} unidades
                </p>
              </div>

              <span className="rounded-full bg-primary/10 px-2 py-1 text-xs font-semibold">
                En vivo
              </span>
            </div>

            <div className="max-h-48 divide-y overflow-y-auto">
              {entries.length === 0 ? (
                <p className="px-3 py-5 text-center text-xs text-muted-foreground">
                  Los productos que escanees aparecerán aquí.
                </p>
              ) : (
                [...entries].reverse().map((item) => (
                  <div
                    key={item.barcode}
                    className="flex items-center gap-2 px-3 py-2"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-xs font-medium">
                        {item.product_name}
                      </p>
                      <p className="font-mono text-[10px] text-muted-foreground">
                        {item.barcode}
                      </p>
                    </div>

                    <Button
                      type="button"
                      size="icon"
                      variant="outline"
                      className="h-7 w-7 shrink-0"
                      onClick={() =>
                        onChangeCount?.(
                          item.barcode,
                          item.count - 1
                        )
                      }
                    >
                      <Minus className="h-3 w-3" />
                    </Button>

                    <input
                      type="number"
                      min="0"
                      value={item.count}
                      onChange={(event) =>
                        onChangeCount?.(
                          item.barcode,
                          Math.max(
                            0,
                            Number(event.target.value) || 0
                          )
                        )
                      }
                      className="h-8 w-14 rounded-md border bg-background text-center text-sm font-semibold"
                    />

                    <Button
                      type="button"
                      size="icon"
                      variant="outline"
                      className="h-7 w-7 shrink-0"
                      onClick={() =>
                        onChangeCount?.(
                          item.barcode,
                          item.count + 1
                        )
                      }
                    >
                      <Plus className="h-3 w-3" />
                    </Button>
                  </div>
                ))
              )}
            </div>
          </div>
        )}

        <div className="flex items-center justify-between gap-2 px-4 pb-4 pt-3">
          {mode === "manual" && continuous ? (
            <>
              <Button variant="outline" onClick={handleClose}>
                Listo
              </Button>

              <Button
                onClick={confirmScan}
                disabled={!pendingCode || processing}
                className="flex-1 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-40"
              >
                {processing && (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                )}

                {pendingCode
                  ? `+ Agregar: ${pendingCode}`
                  : "Apuntá al código…"}
              </Button>
            </>
          ) : (
            <Button
              variant="outline"
              onClick={handleClose}
              className="ml-auto"
            >
              {continuous ? "Listo" : "Cancelar"}
            </Button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}