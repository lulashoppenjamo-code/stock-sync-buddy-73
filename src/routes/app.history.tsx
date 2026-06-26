import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { branchLabel } from "@/lib/branches";
import { ArrowRight, PackageCheck, Clock } from "lucide-react";

export const Route = createFileRoute("/app/history")({
  component: HistoryPage,
});

// ── Types ──────────────────────────────────────────────────────────────
type TransferRow = {
  id: string;
  barcode: string;
  product_name: string;
  quantity: number;
  origin: string;
  destination: string;
  sender_name: string;
  receiver_name: string;
  photo_url: string | null;
  collaborator_name: string | null;
  created_at: string;
  received_at: string | null;
  received_by_name: string | null;
  received_photo_url: string | null;
  client_uid: string | null;
};

type BatchDetail = {
  batchId: string;
  items: TransferRow[];
  origin: string;
  destination: string;
  sender_name: string;
  receiver_name: string;
  photo_url: string | null;
  created_at: string;
  received_at: string | null;
  received_by_name: string | null;
  received_photo_url: string | null;
  totalQuantity: number;
};

function extractBatchId(client_uid: string | null, fallback: string): string {
  if (!client_uid) return fallback;
  const match = client_uid.match(/^transfer-([a-f0-9\-]{36})-/);
  return match ? match[1] : fallback;
}

function groupTransfersByBatch(rows: TransferRow[]): BatchDetail[] {
  const map = new Map<string, BatchDetail>();
  for (const t of rows) {
    const batchId = extractBatchId(t.client_uid, t.id);
    if (!map.has(batchId)) {
      map.set(batchId, {
        batchId,
        items: [],
        origin: t.origin,
        destination: t.destination,
        sender_name: t.sender_name,
        receiver_name: t.receiver_name,
        photo_url: t.photo_url,
        created_at: t.created_at,
        received_at: t.received_at,
        received_by_name: t.received_by_name,
        received_photo_url: t.received_photo_url,
        totalQuantity: 0,
      });
    }
    const g = map.get(batchId)!;
    g.items.push(t);
    g.totalQuantity += t.quantity;
    // Use most recent received_at in batch
    if (t.received_at && (!g.received_at || t.received_at > g.received_at)) {
      g.received_at = t.received_at;
      g.received_by_name = t.received_by_name;
      g.received_photo_url = t.received_photo_url;
    }
  }
  return Array.from(map.values()).sort(
    (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
  );
}

// ── Main page ──────────────────────────────────────────────────────────
function HistoryPage() {
  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold tracking-tight">Historial</h1>
      <Tabs defaultValue="transfers">
        <TabsList>
          <TabsTrigger value="transfers">Traspasos</TabsTrigger>
          <TabsTrigger value="audits">Auditorías</TabsTrigger>
          <TabsTrigger value="imports">Importaciones</TabsTrigger>
        </TabsList>
        <TabsContent value="transfers"><TransfersTable /></TabsContent>
        <TabsContent value="audits"><AuditsTable /></TabsContent>
        <TabsContent value="imports"><ImportsTable /></TabsContent>
      </Tabs>
    </div>
  );
}

// ── Transfers table (grouped by batch, tappable) ───────────────────────
function TransfersTable() {
  const [selected, setSelected] = useState<BatchDetail | null>(null);

  const { data = [] } = useQuery({
    queryKey: ["transfers"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("transfers")
        .select("id, barcode, product_name, quantity, origin, destination, sender_name, receiver_name, photo_url, collaborator_name, created_at, received_at, received_by_name, received_photo_url, client_uid")
        .order("created_at", { ascending: false })
        .limit(300);
      if (error) throw error;
      return data as TransferRow[];
    },
  });

  const batches = groupTransfersByBatch(data);

  return (
    <>
      <Card>
        <CardContent className="p-0">
          <div className="max-h-[65vh] overflow-auto">
            <Table>
              <TableHeader className="sticky top-0 bg-card">
                <TableRow>
                  <TableHead>Fecha</TableHead>
                  <TableHead>Productos</TableHead>
                  <TableHead className="text-right">Unidades</TableHead>
                  <TableHead>Ruta</TableHead>
                  <TableHead>Estado</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {batches.map((b) => (
                  <TableRow
                    key={b.batchId}
                    className="cursor-pointer hover:bg-muted/60 active:bg-muted"
                    onClick={() => setSelected(b)}
                  >
                    <TableCell className="whitespace-nowrap text-xs">
                      {new Date(b.created_at).toLocaleString()}
                    </TableCell>
                    <TableCell>
                      <div className="text-sm font-medium">
                        {b.items.length} producto{b.items.length === 1 ? "" : "s"}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        de {b.sender_name}
                      </div>
                    </TableCell>
                    <TableCell className="text-right tabular-nums font-semibold">
                      {b.totalQuantity}
                    </TableCell>
                    <TableCell className="text-xs font-medium">
                      {branchLabel(b.origin)} → {branchLabel(b.destination)}
                    </TableCell>
                    <TableCell>
                      {b.received_at ? (
                        <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-medium text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200">
                          <PackageCheck className="h-3 w-3" /> Recibido
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-medium text-amber-800 dark:bg-amber-900/40 dark:text-amber-200">
                          <Clock className="h-3 w-3" /> Pendiente
                        </span>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
                {batches.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={5} className="py-8 text-center text-muted-foreground">Sin traspasos</TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      <TransferDetailDialog batch={selected} onClose={() => setSelected(null)} />
    </>
  );
}

// ── Detail dialog ──────────────────────────────────────────────────────
function TransferDetailDialog({ batch, onClose }: { batch: BatchDetail | null; onClose: () => void }) {
  if (!batch) return null;
  return (
    <Dialog open={!!batch} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-h-[90vh] max-w-md overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Detalle del traspaso</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 text-sm">
          {/* Info general */}
          <div className="rounded-md border bg-muted/40 p-3 space-y-1 text-xs">
            <div className="flex items-center gap-2 font-semibold text-sm">
              <span>{branchLabel(batch.origin)}</span>
              <ArrowRight className="h-4 w-4" />
              <span>{branchLabel(batch.destination)}</span>
            </div>
            <div><span className="text-muted-foreground">Envía: </span>{batch.sender_name}</div>
            <div><span className="text-muted-foreground">Recibe: </span>{batch.receiver_name}</div>
            <div><span className="text-muted-foreground">Fecha envío: </span>{new Date(batch.created_at).toLocaleString()}</div>
            {batch.received_at && (
              <div><span className="text-muted-foreground">Recibido: </span>{new Date(batch.received_at).toLocaleString()} por {batch.received_by_name ?? "—"}</div>
            )}
          </div>

          {/* Estado */}
          <div className="flex items-center gap-2">
            {batch.received_at ? (
              <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-3 py-1 text-xs font-medium text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200">
                <PackageCheck className="h-3 w-3" /> Recibido completo
              </span>
            ) : (
              <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-3 py-1 text-xs font-medium text-amber-800 dark:bg-amber-900/40 dark:text-amber-200">
                <Clock className="h-3 w-3" /> Pendiente de recepción
              </span>
            )}
            <span className="text-xs text-muted-foreground">{batch.totalQuantity} unidades totales</span>
          </div>

          {/* Productos */}
          <div>
            <p className="mb-1.5 text-xs font-semibold text-muted-foreground uppercase tracking-wide">
              Productos ({batch.items.length})
            </p>
            <div className="divide-y rounded-md border">
              {batch.items.map((item) => (
                <div key={item.id} className="flex items-center gap-3 px-3 py-2.5">
                  <div className="min-w-0 flex-1">
                    <div className="font-medium truncate">{item.product_name}</div>
                    <div className="font-mono text-xs text-muted-foreground">{item.barcode}</div>
                  </div>
                  <div className="shrink-0 text-right">
                    <div className="font-bold tabular-nums">×{item.quantity}</div>
                    <div className="text-[10px] text-muted-foreground">unidades</div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Fotos */}
          <div className="grid grid-cols-2 gap-3">
            {batch.photo_url && (
              <div>
                <p className="mb-1 text-xs font-semibold text-muted-foreground">Foto envío</p>
                <a href={batch.photo_url} target="_blank" rel="noreferrer">
                  <img src={batch.photo_url} alt="envío" className="h-32 w-full rounded-md border object-cover" />
                </a>
              </div>
            )}
            {batch.received_photo_url && (
              <div>
                <p className="mb-1 text-xs font-semibold text-muted-foreground">Foto recepción</p>
                <a href={batch.received_photo_url} target="_blank" rel="noreferrer">
                  <img src={batch.received_photo_url} alt="recepción" className="h-32 w-full rounded-md border object-cover" />
                </a>
              </div>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ── Audits table (unchanged) ───────────────────────────────────────────
function AuditsTable() {
  const { data } = useQuery({
    queryKey: ["audits"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("audits")
        .select("id, branch, barcode, product_name, system_stock, physical_count, difference, collaborator_name, created_at")
        .order("created_at", { ascending: false })
        .limit(200);
      if (error) throw error;
      return data;
    },
  });
  return (
    <Card>
      <CardContent className="p-0">
        <div className="max-h-[65vh] overflow-auto">
          <Table>
            <TableHeader className="sticky top-0 bg-card">
              <TableRow>
                <TableHead>Fecha</TableHead>
                <TableHead>Suc.</TableHead>
                <TableHead>Producto</TableHead>
                <TableHead className="text-right">Sistema</TableHead>
                <TableHead className="text-right">Físico</TableHead>
                <TableHead className="text-right">Dif.</TableHead>
                <TableHead className="hidden md:table-cell">Por</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(data ?? []).map((a) => (
                <TableRow key={a.id}>
                  <TableCell className="text-xs">{new Date(a.created_at).toLocaleString()}</TableCell>
                  <TableCell>{branchLabel(a.branch)}</TableCell>
                  <TableCell>{a.product_name}<div className="font-mono text-xs text-muted-foreground">{a.barcode}</div></TableCell>
                  <TableCell className="text-right tabular-nums">{a.system_stock}</TableCell>
                  <TableCell className="text-right tabular-nums">{a.physical_count}</TableCell>
                  <TableCell className={`text-right tabular-nums font-medium ${a.difference === 0 ? "" : a.difference > 0 ? "text-emerald-600" : "text-red-600"}`}>
                    {a.difference > 0 ? "+" : ""}{a.difference}
                  </TableCell>
                  <TableCell className="hidden md:table-cell text-xs text-muted-foreground">{a.collaborator_name}</TableCell>
                </TableRow>
              ))}
              {(data ?? []).length === 0 && (
                <TableRow><TableCell colSpan={7} className="py-8 text-center text-muted-foreground">Sin auditorías</TableCell></TableRow>
              )}
            </TableBody>
          </Table>
        </div>
      </CardContent>
    </Card>
  );
}

// ── Imports table (unchanged) ──────────────────────────────────────────
function ImportsTable() {
  const { data } = useQuery({
    queryKey: ["csv_imports"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("csv_imports")
        .select("id, filename, new_count, updated_count, skipped_count, collaborator_name, created_at")
        .order("created_at", { ascending: false })
        .limit(50);
      if (error) throw error;
      return data;
    },
  });
  return (
    <Card>
      <CardContent className="p-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Fecha</TableHead>
              <TableHead>Archivo</TableHead>
              <TableHead className="text-right">Nuevos</TableHead>
              <TableHead className="text-right">Actualizados</TableHead>
              <TableHead className="text-right">Sin cambios</TableHead>
              <TableHead className="hidden md:table-cell">Por</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {(data ?? []).map((i) => (
              <TableRow key={i.id}>
                <TableCell className="text-xs">{new Date(i.created_at).toLocaleString()}</TableCell>
                <TableCell className="text-sm">{i.filename ?? "—"}</TableCell>
                <TableCell className="text-right tabular-nums">{i.new_count}</TableCell>
                <TableCell className="text-right tabular-nums">{i.updated_count}</TableCell>
                <TableCell className="text-right tabular-nums">{i.skipped_count}</TableCell>
                <TableCell className="hidden md:table-cell text-xs text-muted-foreground">{i.collaborator_name}</TableCell>
              </TableRow>
            ))}
            {(data ?? []).length === 0 && (
              <TableRow><TableCell colSpan={6} className="py-8 text-center text-muted-foreground">Sin importaciones</TableCell></TableRow>
            )}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}
