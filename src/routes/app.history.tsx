import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { branchLabel } from "@/lib/branches";

export const Route = createFileRoute("/app/history")({
  component: HistoryPage,
});

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

function TransfersTable() {
  const { data } = useQuery({
    queryKey: ["transfers"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("transfers")
        .select("id, barcode, product_name, quantity, origin, destination, sender_name, receiver_name, photo_url, collaborator_name, created_at")
        .order("created_at", { ascending: false })
        .limit(100);
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
                <TableHead>Producto</TableHead>
                <TableHead className="text-right">Cant.</TableHead>
                <TableHead>Ruta</TableHead>
                <TableHead className="hidden md:table-cell">Envía → Recibe</TableHead>
                <TableHead>Foto</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(data ?? []).map((t) => (
                <TableRow key={t.id}>
                  <TableCell className="whitespace-nowrap text-xs">{new Date(t.created_at).toLocaleString()}</TableCell>
                  <TableCell>
                    <div>{t.product_name}</div>
                    <div className="font-mono text-xs text-muted-foreground">{t.barcode}</div>
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{t.quantity}</TableCell>
                  <TableCell className="font-medium">{branchLabel(t.origin)} → {branchLabel(t.destination)}</TableCell>
                  <TableCell className="hidden md:table-cell text-sm">{t.sender_name} → {t.receiver_name}</TableCell>
                  <TableCell>
                    {t.photo_url ? (
                      <a href={t.photo_url} target="_blank" rel="noreferrer">
                        <img src={t.photo_url} alt="evidencia" loading="lazy" className="h-10 w-10 rounded object-cover border" />
                      </a>
                    ) : "—"}
                  </TableCell>
                </TableRow>
              ))}
              {(data ?? []).length === 0 && (
                <TableRow><TableCell colSpan={6} className="py-8 text-center text-muted-foreground">Sin traspasos</TableCell></TableRow>
              )}
            </TableBody>
          </Table>
        </div>
      </CardContent>
    </Card>
  );
}

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
