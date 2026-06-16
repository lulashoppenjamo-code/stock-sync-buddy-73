import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Loader2, ScanLine, Save, Camera, Search } from "lucide-react";
import { toast } from "sonner";
import { getCollaborator } from "@/lib/session";
import { enqueue, drainQueue } from "@/lib/offline-queue";
import { BRANCH_LABELS, branchLabel } from "@/lib/branches";
import { BarcodeScanner } from "@/components/BarcodeScanner";

export const Route = createFileRoute("/app/audit")({
  component: AuditPage,
});

type Branch = "A" | "B";

type Product = { barcode: string; product_name: string; stock_a: number; stock_b: number };

function AuditPage() {
  const qc = useQueryClient();
  const [branch, setBranch] = useState<Branch>("A");
  const [code, setCode] = useState("");
  const [physical, setPhysical] = useState("");
  const [current, setCurrent] = useState<Product | null>(null);
  const [busy, setBusy] = useState(false);
  const [scannerOpen, setScannerOpen] = useState(false);
  const scanRef = useRef<HTMLInputElement>(null);
  const physicalRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    scanRef.current?.focus();
  }, [branch]);

  const { data: history } = useQuery({
    queryKey: ["audits"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("audits")
        .select("id, branch, barcode, product_name, system_stock, physical_count, difference, collaborator_name, created_at")
        .order("created_at", { ascending: false })
        .limit(50);
      if (error) throw error;
      return data;
    },
  });

  async function lookup(barcode: string) {
    const { data, error } = await supabase
      .from("products")
      .select("barcode, product_name, stock_a, stock_b")
      .eq("barcode", barcode)
      .maybeSingle();
    if (error) {
      toast.error(error.message);
      return null;
    }
    if (!data) {
      toast.error(`Producto no encontrado: ${barcode}`);
      return null;
    }
    return data as Product;
  }

  async function handleScan(e: React.FormEvent) {
    e.preventDefault();
    const c = code.trim();
    if (!c) return;
    setBusy(true);
    const p = await lookup(c);
    setBusy(false);
    if (p) {
      setCurrent(p);
      setPhysical("");
      setTimeout(() => physicalRef.current?.focus(), 10);
    } else {
      setCode("");
      scanRef.current?.focus();
    }
  }

  async function save(e?: React.FormEvent) {
    e?.preventDefault();
    if (!current) return;
    const phys = Number(physical);
    if (!Number.isFinite(phys)) {
      toast.error("Conteo físico inválido");
      return;
    }
    const sysStock = branch === "A" ? current.stock_a : current.stock_b;
    const diff = phys - sysStock;
    const collab = getCollaborator();
    const client_uid = `audit-${crypto.randomUUID()}`;
    const payload = {
      branch,
      barcode: current.barcode,
      product_name: current.product_name,
      system_stock: sysStock,
      physical_count: phys,
      difference: diff,
      collaborator_id: collab?.id ?? null,
      collaborator_name: collab?.name ?? null,
      client_uid,
    };
    setBusy(true);
    try {
      if (navigator.onLine) {
        const { error } = await supabase.from("audits").insert(payload);
        if (error) throw error;
      } else {
        await enqueue({ kind: "audit", uid: client_uid, createdAt: Date.now(), payload });
        toast.info("Sin conexión: se guardará cuando vuelva la red");
      }
      qc.invalidateQueries({ queryKey: ["audits"] });
      toast.success(`Diferencia: ${diff > 0 ? "+" : ""}${diff}`);
      setCurrent(null);
      setCode("");
      setPhysical("");
      scanRef.current?.focus();
      drainQueue();
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const sysStock = current ? (branch === "A" ? current.stock_a : current.stock_b) : 0;
  const diffPreview = current && physical !== "" ? Number(physical) - sysStock : null;

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold tracking-tight">Auditoría</h1>

      <Card>
        <CardContent className="space-y-4 p-4">
          <div className="flex items-center gap-3">
            <span className="text-sm text-muted-foreground">Sucursal</span>
            <ToggleGroup type="single" value={branch} onValueChange={(v) => v && setBranch(v as Branch)}>
              <ToggleGroupItem value="A">{BRANCH_LABELS.A}</ToggleGroupItem>
              <ToggleGroupItem value="B">{BRANCH_LABELS.B}</ToggleGroupItem>
            </ToggleGroup>
          </div>

          <form onSubmit={handleScan}>
            <label className="text-xs font-medium text-muted-foreground">Escanear código (Enter)</label>
            <div className="relative mt-1 flex gap-2">
              <div className="relative flex-1">
                <ScanLine className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  ref={scanRef}
                  autoFocus
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                  placeholder="Pistola, cámara o tipear…"
                  className="pl-9 font-mono text-base"
                  inputMode="numeric"
                />
              </div>
              <Button
                type="button"
                variant="outline"
                size="icon"
                onClick={() => setScannerOpen(true)}
                aria-label="Escanear con cámara"
              >
                <Camera className="h-4 w-4" />
              </Button>
            </div>
          </form>

          <ProductNameSearch
            onPick={async (barcode) => {
              setCode(barcode);
              setBusy(true);
              const p = await lookup(barcode);
              setBusy(false);
              if (p) {
                setCurrent(p);
                setPhysical("");
                setTimeout(() => physicalRef.current?.focus(), 10);
              }
            }}
          />


          {current && (
            <form onSubmit={save} className="rounded-lg border bg-muted/30 p-3 space-y-3">
              <div>
                <div className="text-xs text-muted-foreground">Producto</div>
                <div className="font-medium">{current.product_name}</div>
                <div className="font-mono text-xs text-muted-foreground">{current.barcode}</div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <div className="text-xs text-muted-foreground">Stock sistema · {BRANCH_LABELS[branch]}</div>
                  <div className="text-xl font-semibold tabular-nums">{sysStock}</div>
                </div>
                <div>
                  <label className="text-xs text-muted-foreground">Conteo físico</label>
                  <Input
                    ref={physicalRef}
                    type="number"
                    inputMode="decimal"
                    step="any"
                    value={physical}
                    onChange={(e) => setPhysical(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") save();
                    }}
                    placeholder="0"
                    className="text-lg"
                  />
                </div>
              </div>
              {diffPreview !== null && (
                <div className="text-sm">
                  Diferencia:{" "}
                  <span
                    className={
                      diffPreview === 0
                        ? "font-semibold"
                        : diffPreview > 0
                          ? "font-semibold text-emerald-600"
                          : "font-semibold text-red-600"
                    }
                  >
                    {diffPreview > 0 ? "+" : ""}
                    {diffPreview}
                  </span>
                </div>
              )}
              <div className="flex gap-2">
                <Button type="submit" disabled={busy || physical === ""}>
                  {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />} Guardar
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => {
                    setCurrent(null);
                    setCode("");
                    setPhysical("");
                    scanRef.current?.focus();
                  }}
                >
                  Cancelar
                </Button>
              </div>
            </form>
          )}
        </CardContent>
      </Card>

      <h2 className="text-sm font-semibold tracking-tight">Historial reciente</h2>
      <Card>
        <CardContent className="p-0">
          <div className="max-h-[50vh] overflow-auto">
            <Table>
              <TableHeader className="sticky top-0 bg-card">
                <TableRow>
                  <TableHead>Fecha</TableHead>
                  <TableHead>Sucursal</TableHead>
                  <TableHead>Producto</TableHead>
                  <TableHead className="text-right">Sistema</TableHead>
                  <TableHead className="text-right">Físico</TableHead>
                  <TableHead className="text-right">Dif.</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(history ?? []).map((a) => (
                  <TableRow key={a.id}>
                    <TableCell className="whitespace-nowrap text-xs">
                      {new Date(a.created_at).toLocaleString()}
                    </TableCell>
                    <TableCell>{branchLabel(a.branch)}</TableCell>
                    <TableCell>
                      <div>{a.product_name}</div>
                      <div className="font-mono text-xs text-muted-foreground">{a.barcode}</div>
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{a.system_stock}</TableCell>
                    <TableCell className="text-right tabular-nums">{a.physical_count}</TableCell>
                    <TableCell
                      className={`text-right tabular-nums font-medium ${
                        a.difference === 0 ? "" : a.difference > 0 ? "text-emerald-600" : "text-red-600"
                      }`}
                    >
                      {a.difference > 0 ? "+" : ""}
                      {a.difference}
                    </TableCell>
                  </TableRow>
                ))}
                {(history ?? []).length === 0 && (
                  <TableRow>
                    <TableCell colSpan={6} className="py-8 text-center text-muted-foreground">
                      Sin auditorías aún
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      <BarcodeScanner
        open={scannerOpen}
        onClose={() => setScannerOpen(false)}
        onDetected={async (c) => {
          setCode(c);
          setBusy(true);
          const p = await lookup(c);
          setBusy(false);
          if (p) {
            setCurrent(p);
            setPhysical("");
            setTimeout(() => physicalRef.current?.focus(), 10);
          }
        }}
      />
    </div>
  );
}

function ProductNameSearch({ onPick }: { onPick: (barcode: string) => void }) {
  const [q, setQ] = useState("");
  const { data, isFetching } = useQuery({
    queryKey: ["audit-product-search", q],
    queryFn: async () => {
      const term = q.trim();
      if (term.length < 2) return [];
      const { data, error } = await supabase
        .from("products")
        .select("barcode, product_name, uom, stock_a, stock_b")
        .ilike("product_name", `%${term}%`)
        .order("product_name")
        .limit(15);
      if (error) throw error;
      return data ?? [];
    },
  });

  return (
    <div>
      <label className="text-xs font-medium text-muted-foreground">Buscar producto por nombre</label>
      <div className="relative mt-1">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Escribí al menos 2 letras…"
          className="pl-9"
        />
      </div>
      {q.trim().length >= 2 && (
        <div className="mt-2 max-h-60 overflow-auto rounded-md border">
          {isFetching && (
            <div className="p-3 text-center text-xs text-muted-foreground">Buscando…</div>
          )}
          {!isFetching && (data ?? []).length === 0 && (
            <div className="p-3 text-center text-xs text-muted-foreground">Sin resultados</div>
          )}
          {(data ?? []).map((p) => (
            <button
              key={p.barcode}
              type="button"
              onClick={() => { onPick(p.barcode); setQ(""); }}
              className="block w-full border-b px-3 py-2 text-left text-sm last:border-b-0 hover:bg-muted"
            >
              <div className="font-medium">{p.product_name}</div>
              <div className="font-mono text-xs text-muted-foreground">
                {p.barcode} · {p.uom ?? "—"} · {BRANCH_LABELS.A}:{p.stock_a} · {BRANCH_LABELS.B}:{p.stock_b}
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

