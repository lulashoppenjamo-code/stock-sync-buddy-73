// Collaborator session (no real auth — internal app with PIN)
import { useEffect, useState } from "react";

export type Collaborator = {
  id: string;
  name: string;
  is_admin: boolean;
};

const KEY = "inv.collab.v1";

export function getCollaborator(): Collaborator | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as Collaborator) : null;
  } catch {
    return null;
  }
}

export function setCollaborator(c: Collaborator | null) {
  if (typeof window === "undefined") return;
  if (c) localStorage.setItem(KEY, JSON.stringify(c));
  else localStorage.removeItem(KEY);
  window.dispatchEvent(new Event("inv:collab-changed"));
}

export function useCollaborator() {
  const [c, setC] = useState<Collaborator | null>(() => getCollaborator());
  useEffect(() => {
    const sync = () => setC(getCollaborator());
    window.addEventListener("inv:collab-changed", sync);
    window.addEventListener("storage", sync);
    return () => {
      window.removeEventListener("inv:collab-changed", sync);
      window.removeEventListener("storage", sync);
    };
  }, []);
  return c;
}
