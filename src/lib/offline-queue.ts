// Simple FIFO offline queue backed by IndexedDB.
// Drains automatically when navigator.onLine becomes true.
import { get, set, del, keys, createStore } from "idb-keyval";
import { supabase } from "@/integrations/supabase/client";

const store = createStore("inventory-queue", "ops");

export type QueuedOp =
  | {
      kind: "audit";
      uid: string;
      createdAt: number;
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
      payload: {
        barcode: string;
        quantity: number;
        origin: "A" | "B";
        destination: "A" | "B";
        sender_name: string;
        receiver_name: string;
        collaborator_id: string;
        collaborator_name: string;
        client_uid: string;
      };
      photo: { blob: Blob; ext: string };
    }
  | {
      kind: "inventory_count";
      uid: string;
      createdAt: number;
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

export async function pendingCount(): Promise<number> {
  return (await keys(store)).length;
}

export async function listPending(): Promise<QueuedOp[]> {
  const ks = await keys(store);
  const items = await Promise.all(ks.map((k) => get<QueuedOp>(k as string, store)));
  return items.filter(Boolean).sort((a, b) => a!.createdAt - b!.createdAt) as QueuedOp[];
}

function isDuplicateError(msg: string | undefined): boolean {
  if (!msg) return false;
  const m = msg.toLowerCase();
  return m.includes("duplicate") || m.includes("unique") || m.includes("already exists");
}

async function processOne(op: QueuedOp): Promise<void> {
  if (op.kind === "audit") {
    const { error } = await supabase.from("audits").insert(op.payload);
    if (error && !isDuplicateError(error.message)) throw error;
  } else if (op.kind === "inventory_count") {
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
  } else {
    // transfer
    const path = `${op.payload.client_uid}.${op.photo.ext}`;
    const up = await supabase.storage
      .from("transfer-photos")
      .upload(path, op.photo.blob, { contentType: op.photo.blob.type, upsert: true });
    if (up.error && !isDuplicateError(up.error.message)) throw up.error;
    const { data: signed } = await supabase.storage.from("transfer-photos").createSignedUrl(path, 60 * 60 * 24 * 365);
    const photo_url = signed?.signedUrl ?? path;
    // Prefer RPC si existe; si no, insert directo en transfers
    const { error } = await supabase.rpc("apply_transfer", {
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
    if (error && !isDuplicateError(error.message)) throw error;
  }
}

let draining = false;
export async function drainQueue(): Promise<{ ok: number; failed: number }> {
  if (draining || typeof navigator === "undefined" || !navigator.onLine) return { ok: 0, failed: 0 };
  draining = true;
  let ok = 0;
  let failed = 0;
  try {
    const items = await listPending();
    for (const op of items) {
      // Reintento simple: hasta 2 intentos por operación en este ciclo
      let lastErr: unknown = null;
      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          await processOne(op);
          await del(op.uid, store);
          ok++;
          lastErr = null;
          break;
        } catch (e) {
          lastErr = e;
          await new Promise((r) => setTimeout(r, 400 * (attempt + 1)));
        }
      }
      if (lastErr) {
        console.warn("[queue] op failed, keeping for retry:", lastErr);
        failed++;
      }
    }
  } finally {
    draining = false;
    notify();
  }
  return { ok, failed };
}

function notify() {
  if (typeof window !== "undefined") window.dispatchEvent(new Event("inv:queue-changed"));
}

export function startQueueAutoDrain() {
  if (typeof window === "undefined") return () => {};
  const tryDrain = () => {
    if (!navigator.onLine) return;
    drainQueue()
      .then(({ ok }) => {
        if (ok > 0) {
          window.dispatchEvent(new CustomEvent("inv:queue-synced", { detail: { ok } }));
        }
      })
      .catch(() => {});
  };
  window.addEventListener("online", tryDrain);
  window.addEventListener("focus", tryDrain);
  // Al recuperar visibilidad (vuelve de otra app)
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") tryDrain();
  });
  // Más frecuente: cada 15 s
  const interval = window.setInterval(tryDrain, 15_000);
  tryDrain();
  return () => {
    window.removeEventListener("online", tryDrain);
    window.removeEventListener("focus", tryDrain);
    window.clearInterval(interval);
  };
}
