import { createFileRoute, Outlet, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import { AppShell } from "@/components/AppShell";
import { useCollaborator } from "@/lib/session";

export const Route = createFileRoute("/app")({
  component: AppLayout,
});

function AppLayout() {
  const collab = useCollaborator();
  const navigate = useNavigate();
  useEffect(() => {
    if (!collab) navigate({ to: "/" });
  }, [collab, navigate]);
  if (!collab) return null;
  return (
    <AppShell>
      <Outlet />
    </AppShell>
  );
}
