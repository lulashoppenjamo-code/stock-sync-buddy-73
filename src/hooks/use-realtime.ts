import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

// Subscribe to changes on products / audits / transfers / closed_counts and invalidate React Query.
export function useRealtimeSync() {
  const qc = useQueryClient();
  useEffect(() => {
    const channel = supabase
      .channel("inventory-sync")
      .on("postgres_changes", { event: "*", schema: "public", table: "products" }, () => {
        qc.invalidateQueries({ queryKey: ["products"] });
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "audits" }, () => {
        qc.invalidateQueries({ queryKey: ["audits"] });
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "transfers" }, () => {
        qc.invalidateQueries({ queryKey: ["transfers"] });
        qc.invalidateQueries({ queryKey: ["products"] });
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "inventory_sessions" }, () => {
        qc.invalidateQueries({ queryKey: ["inventory-session"] });
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "inventory_session_items" }, () => {
        qc.invalidateQueries({ queryKey: ["inventory-session-items"] });
      })
      // Al cerrar (o borrar/corregir) un corte de categoría, el reporte general y
      // el informe por mes se actualizan solos en todos los dispositivos.
      .on("postgres_changes", { event: "*", schema: "public", table: "closed_counts" }, () => {
        qc.invalidateQueries({ queryKey: ["closed_counts"] });
        qc.invalidateQueries({ queryKey: ["closed-counts-categories"] });
        qc.invalidateQueries({ queryKey: ["audit-history-month"] });
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "zobaze_corrections" }, () => {
        qc.invalidateQueries({ queryKey: ["zobaze_corrections"] });
      })
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [qc]);
}