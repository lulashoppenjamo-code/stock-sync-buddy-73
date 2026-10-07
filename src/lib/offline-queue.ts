// Cola offline FIFO en IndexedDB.
// Se vacía automáticamente al volver internet y al tocar "pendientes".
import { get, set, del, keys, createStore } from "idb-keyval";
import { supabase } from "@/integrations/supabase/client";

const store = createStore("inventory-queue", "ops");

export type QueuedOp =
  | {
      kind: "audit";
      uid: string;
      createdAt: number;
      attempts?: number;
      lastError?: string;
      payload: {
        branch: "A" | "B";
        barcode: string;
        product_name: string;
        system_stock: number;
        physical_count: number;
        difference: number;
        collaborator_id: string | null;
        collaborator_name: string | null;
        client_uid: string;
      };
    }
  | {
      kind: "transfer";
      uid: string;
      createdAt: number;
      attempts?: number;
      lastError?: string;
      payload: {
        barcode: string;
        product_name?: string;
        quantity: number;
        origin: "A" | "B";
        destination: "A" | "B";
        sender_name: string;
        receiver_name: string;
        collaborator_id: string;
        collaborator_name: string;
        client_uid: string;
      };
      photo: { blob: Blob; ext: string; type?: string };
    }
  | {
      kind: "inventory_count";
      uid: string;
      createdAt: number;
      attempts?: number;
      lastError?: string;
      payload: {
        session_id: string;
        barcode: string;
        location: "A" | "B";
        mode: "increment" | "set";
        delta?: number;
        quantity?: number;
        collaborator_name: string | null;
        client_uid: string;
      };
    };

export async function enqueue(op: QueuedOp) {
  await set(op.uid, op, store);
  notify();
}

export async function listPending(): Promise<QueuedOp[]> {
  const ks = await keys(store);
  const pairs = await Promise.all(
    ks.map(async (k) => {
      const v = await get<QueuedOp>(k as string, store);
      return { key: k as string, value: v };
    }),
  );
  // Limpiar claves huérfanas (sin valor válido) para que el contador no se quede trabado
  for (const p of pairs) {
    if (!p.value || typeof p.value !== "object" || !("kind" in p.value)) {
      try { await del(p.key, store); } catch { /* ignore */ }
    }
  }
  return pairs
    .filter((p): p is { key: string; value: QueuedOp } => !!p.value && typeof p.value === "object" && "kind" in p.value)
    .map((p) => p.value)
    .sort((a, b) => a.createdAt - b.createdAt);
}

export async function pendingCount(): Promise<number> {
  // Contar solo operaciones válidas (no claves basura)
  const items = await listPending();
  return items.length;
}

/** Descarta todas las operaciones pendientes (solo si el usuario lo pide). */
export async function clearQueue(): Promise<number> {
  const ks = await keys(store);
  for (const k of ks) await del(k as string, store);
  notify();
  return ks.length;
}

function isDuplicateError(msg: string | undefined): boolean {
  if (!msg) return false;
  const m = msg.toLowerCase();
  return (
    m.includes("duplicate") ||
    m.includes("unique") ||
    m.includes("already exists") ||
    m.includes("conflict")
  );
}

function errMsg(e: unknown): string {
  if (!e) return "Error desconocido";
  if (typeof e === "string") return e;
  if (e instanceof Error) return e.message;
  const any = e as { message?: string; error_description?: string };
  return any.message || any.error_description || JSON.stringify(e);
}

/** Comprueba si realmente hay red hacia Supabase (navigator.onLine miente a veces). */
async function canReachServer(): Promise<boolean> {
  if (typeof navigator !== "undefined" && !navigator.onLine) return false;
  try {
    // HEAD liviano al REST de Supabase (usa el client ya configurado)
    const { error } = await supabase.from("collaborators").select("id", { head: true, count: "exact" }).limit(1);
    // error de red → false; error de auth/RLS igual implica que el servidor respondió
    if (error && /failed to fetch|network|timeout|load failed/i.test(error.message)) return false;
    return true;
  } catch {
    return false;
  }
}

async function processOne(op: QueuedOp): Promise<void> {
  if (op.kind === "audit") {
    const { error } = await supabase.from("audits").insert(op.payload);
    if (error && !isDuplicateError(error.message)) throw error;
    return;
  }

  if (op.kind === "inventory_count") {
    if (op.payload.mode === "increment") {
      const { error } = await supabase.rpc("inventory_scan", {
        p_session_id: op.payload.session_id,
        p_barcode: op.payload.barcode,
        p_location: op.payload.location,
        p_delta: op.payload.delta ?? 1,
        p_collaborator_name: op.payload.collaborator_name ?? "",
        p_client_uid: op.payload.client_uid,
      });
      if (error && !isDuplicateError(error.message)) throw error;
    } else {
      const { error } = await supabase.rpc("inventory_manual_set", {
        p_session_id: op.payload.session_id,
        p_barcode: op.payload.barcode,
        p_location: op.payload.location,
        p_quantity: op.payload.quantity ?? 0,
        p_collaborator_name: op.payload.collaborator_name ?? "",
        p_client_uid: op.payload.client_uid,
      });
      if (error && !isDuplicateError(error.message)) throw error;
    }
    return;
  }

  // transfer
  const blob = op.photo?.blob;
  if (!blob || !(blob instanceof Blob) || blob.size === 0) {
    throw new Error("Foto de traspaso no disponible en este dispositivo");
  }
  const ext = op.photo.ext || "jpg";
  const path = `${op.payload.client_uid}.${ext}`;
  const contentType = op.photo.type || blob.type || "image/jpeg";
  const up = await supabase.storage
    .from("transfer-photos")
    .upload(path, blob, { contentType, upsert: true });
  if (up.error && !isDuplicateError(up.error.message)) throw up.error;
  const { data: signed } = await supabase.storage.from("transfer-photos").createSignedUrl(path, 60 * 60 * 24 * 365);
  const photo_url = signed?.signedUrl ?? path;

  const rpc = await supabase.rpc("apply_transfer", {
    p_barcode: op.payload.barcode,
    p_quantity: op.payload.quantity,
    p_origin: op.payload.origin,
    p_destination: op.payload.destination,
    p_sender_name: op.payload.sender_name,
    p_receiver_name: op.payload.receiver_name,
    p_photo_url: photo_url,
    p_collaborator_id: op.payload.collaborator_id,
    p_collaborator_name: op.payload.collaborator_name,
    p_client_uid: op.payload.client_uid,
  });
  if (rpc.error && !isDuplicateError(rpc.error.message)) {
    // Fallback: insert directo (misma tabla que usa la pantalla de traspaso)
    const { error } = await supabase.from("transfers").insert({
      barcode: op.payload.barcode,
      product_name: op.payload.product_name || op.payload.barcode,
      quantity: op.payload.quantity,
      origin: op.payload.origin,
      destination: op.payload.destination,
      sender_name: op.payload.sender_name,
      receiver_name: op.payload.receiver_name,
      photo_url,
      collaborator_id: op.payload.collaborator_id,
      collaborator_name: op.payload.collaborator_name,
      client_uid: op.payload.client_uid,
    });
    if (error && !isDuplicateError(error.message)) throw error;
  }
}

let draining = false;
let drainStartedAt = 0;

export type DrainResult = {
  ok: number;
  failed: number;
  remaining: number;
  errors: string[];
  unreachable: boolean;
};

export async function drainQueue(): Promise<DrainResult> {
  const withRemaining = async (partial: Omit<DrainResult, "remaining">): Promise<DrainResult> => ({
    ...partial,
    remaining: await pendingCount(),
  });

  if (typeof navigator === "undefined") {
    return { ok: 0, failed: 0, remaining: 0, errors: [], unreachable: false };
  }

  // Si un drain anterior quedó colgado > 60s, liberar el candado
  if (draining && Date.now() - drainStartedAt > 60_000) {
    console.warn("[queue] unlocking stuck drain");
    draining = false;
  }
  // Ya hay un sync en curso: NO mentir con remaining 0
  if (draining) {
    return withRemaining({ ok: 0, failed: 0, errors: ["Sincronización en curso"], unreachable: false });
  }
  if (!navigator.onLine) {
    return withRemaining({ ok: 0, failed: 0, errors: [], unreachable: true });
  }

  const reachable = await canReachServer();
  if (!reachable) {
    return withRemaining({ ok: 0, failed: 0, errors: [], unreachable: true });
  }

  draining = true;
  drainStartedAt = Date.now();
  let ok = 0;
  let failed = 0;
  const errors: string[] = [];

  try {
    const items = await listPending();
    for (const op of items) {
      let lastErr: unknown = null;
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          await processOne(op);
          await del(op.uid, store);
          ok++;
          lastErr = null;
          break;
        } catch (e) {
          lastErr = e;
          await new Promise((r) => setTimeout(r, 500 * (attempt + 1)));
        }
      }
      if (lastErr) {
        const msg = errMsg(lastErr);
        console.warn("[queue] op failed:", op.kind, op.uid, msg);
        errors.push(`${op.kind}: ${msg}`);
        // Guardar intento / error para diagnóstico (no borra la op)
        try {
          await set(
            op.uid,
            { ...op, attempts: (op.attempts ?? 0) + 1, lastError: msg },
            store,
          );
        } catch { /* ignore */ }
        failed++;
      }
    }
  } finally {
    draining = false;
    notify();
  }

  const remaining = await pendingCount();
  return { ok, failed, remaining, errors, unreachable: false };
}

function notify() {
  if (typeof window !== "undefined") window.dispatchEvent(new Event("inv:queue-changed"));
}

export function startQueueAutoDrain() {
  if (typeof window === "undefined") return () => {};

  let running = false;
  const tryDrain = async () => {
    if (running) return;
    if (!navigator.onLine) return;
    running = true;
    try {
      const result = await drainQueue();
      if (result.ok > 0) {
        window.dispatchEvent(new CustomEvent("inv:queue-synced", { detail: result }));
      }
    } catch (e) {
      console.warn("[queue] auto-drain error:", e);
    } finally {
      running = false;
    }
  };

  window.addEventListener("online", () => {
    // Esperar un momento a que la red se estabilice
    setTimeout(() => { void tryDrain(); }, 1500);
  });
  window.addEventListener("focus", () => { void tryDrain(); });
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") void tryDrain();
  });
  const interval = window.setInterval(() => { void tryDrain(); }, 20_000);
  // Primer intento al arrancar
  setTimeout(() => { void tryDrain(); }, 2000);

  return () => {
    window.clearInterval(interval);
  };
}
