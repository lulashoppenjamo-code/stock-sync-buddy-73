/**
 * Caché offline de catálogo (productos + colaboradores).
 * Se guarda en IndexedDB y se refresca cada vez que hay internet.
 * Permite buscar / escanear productos y armar traspasos sin red.
 */
import { get, set, createStore } from "idb-keyval";
import { supabase } from "@/integrations/supabase/client";

const store = createStore("inventory-offline-cache", "data");

const PRODUCTS_KEY = "products:v1";
const COLLABS_KEY = "collaborators:v1";
const META_KEY = "meta:v1";

export type CachedProduct = {
  barcode: string;
  product_name: string;
  uom: string | null;
  category: string | null;
  stock_a: number;
  stock_b: number;
  price?: number | null;
  updated_at?: string;
};

export type CachedCollaborator = {
  id: string;
  name: string;
  branch?: string | null;
  active?: boolean;
};

type CacheMeta = {
  productsAt: number | null;
  collabsAt: number | null;
};

async function getMeta(): Promise<CacheMeta> {
  try {
    return (await get<CacheMeta>(META_KEY, store)) ?? { productsAt: null, collabsAt: null };
  } catch {
    return { productsAt: null, collabsAt: null };
  }
}

async function setMeta(patch: Partial<CacheMeta>) {
  const cur = await getMeta();
  await set(META_KEY, { ...cur, ...patch }, store);
}

/** Lee productos desde caché local (sin red). */
export async function getCachedProducts(): Promise<CachedProduct[]> {
  try {
    return (await get<CachedProduct[]>(PRODUCTS_KEY, store)) ?? [];
  } catch {
    return [];
  }
}

/** Busca un producto por código de barras en caché. */
export async function getCachedProductByBarcode(barcode: string): Promise<CachedProduct | null> {
  const all = await getCachedProducts();
  const bc = barcode.trim();
  return all.find((p) => p.barcode === bc) ?? null;
}

/** Filtra productos por nombre (ilike simple) en caché. */
export async function searchCachedProducts(query: string, limit = 15): Promise<CachedProduct[]> {
  const q = query.trim().toLowerCase();
  if (q.length < 2) return [];
  const all = await getCachedProducts();
  return all
    .filter((p) => p.product_name.toLowerCase().includes(q) || p.barcode.includes(q))
    .slice(0, limit);
}

/** Productos de una categoría desde caché. */
export async function getCachedProductsByCategory(category: string): Promise<CachedProduct[]> {
  const cat = category.trim().toLowerCase();
  if (!cat) return [];
  const all = await getCachedProducts();
  return all.filter((p) => (p.category ?? "").trim().toLowerCase() === cat);
}

/** Lista de categorías distintas desde el catálogo local (para Auditoría offline). */
export async function getCachedCategories(): Promise<string[]> {
  const all = await getCachedProducts();
  const set = new Set<string>();
  for (const p of all) {
    const c = (p.category ?? "").trim();
    if (c) set.add(c);
  }
  return Array.from(set).sort((a, b) => a.localeCompare(b, "es"));
}

/** Conteo de productos por categoría desde caché local. */
export async function getCachedCategoryCounts(): Promise<Map<string, number>> {
  const all = await getCachedProducts();
  const counts = new Map<string, number>();
  for (const p of all) {
    const key = (p.category ?? "").trim();
    if (!key) continue;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return counts;
}

export async function getCachedCollaborators(): Promise<CachedCollaborator[]> {
  try {
    return (await get<CachedCollaborator[]>(COLLABS_KEY, store)) ?? [];
  } catch {
    return [];
  }
}

export async function getCacheInfo(): Promise<{ products: number; collabs: number; productsAt: number | null; collabsAt: number | null }> {
  const [products, collabs, meta] = await Promise.all([
    getCachedProducts(),
    getCachedCollaborators(),
    getMeta(),
  ]);
  return {
    products: products.length,
    collabs: collabs.length,
    productsAt: meta.productsAt,
    collabsAt: meta.collabsAt,
  };
}

/** Descarga TODOS los productos y los guarda en IndexedDB. */
export async function refreshProductsCache(): Promise<number> {
  if (typeof navigator !== "undefined" && !navigator.onLine) return 0;
  const all: CachedProduct[] = [];
  const pageSize = 1000;
  let from = 0;
  while (true) {
    const { data, error } = await supabase
      .from("products")
      .select("barcode, product_name, uom, category, stock_a, stock_b, price, updated_at")
      .order("product_name")
      .range(from, from + pageSize - 1);
    if (error) throw error;
    const page = (data ?? []) as CachedProduct[];
    all.push(...page);
    if (page.length < pageSize) break;
    from += pageSize;
  }
  await set(PRODUCTS_KEY, all, store);
  await setMeta({ productsAt: Date.now() });
  return all.length;
}

/** Descarga colaboradores activos. */
export async function refreshCollaboratorsCache(): Promise<number> {
  if (typeof navigator !== "undefined" && !navigator.onLine) return 0;
  const { data, error } = await supabase
    .from("collaborators")
    .select("id, name, branch, active")
    .eq("active", true)
    .order("name");
  if (error) throw error;
  const rows = (data ?? []) as CachedCollaborator[];
  await set(COLLABS_KEY, rows, store);
  await setMeta({ collabsAt: Date.now() });
  return rows.length;
}

let warming = false;

/**
 * Refresca caché si está vacía o tiene más de `maxAgeMs` (default 6 h).
 * Seguro llamar al arrancar la app o al volver online.
 */
export async function warmOfflineCache(maxAgeMs = 6 * 60 * 60 * 1000): Promise<void> {
  if (typeof navigator !== "undefined" && !navigator.onLine) return;
  if (warming) return;
  warming = true;
  try {
    const meta = await getMeta();
    const now = Date.now();
    const productsStale = !meta.productsAt || now - meta.productsAt > maxAgeMs;
    const collabsStale = !meta.collabsAt || now - meta.collabsAt > maxAgeMs;

    // Si no hay productos en caché, forzar refresh aunque no esté "stale" por tiempo
    const existing = await getCachedProducts();
    if (productsStale || existing.length === 0) {
      try {
        await refreshProductsCache();
      } catch (e) {
        console.warn("[offline-cache] products refresh failed:", e);
      }
    }
    if (collabsStale) {
      try {
        await refreshCollaboratorsCache();
      } catch (e) {
        console.warn("[offline-cache] collabs refresh failed:", e);
      }
    }
  } finally {
    warming = false;
  }
}

/** Arranca listeners: al volver online refresca caché. */
export function startOfflineCacheAutoWarm() {
  if (typeof window === "undefined") return () => {};
  const run = () => {
    warmOfflineCache().catch(() => {});
  };
  window.addEventListener("online", run);
  // Primera carga
  run();
  // Refresco periódico cada hora si hay red
  const interval = window.setInterval(run, 60 * 60 * 1000);
  return () => {
    window.removeEventListener("online", run);
    window.clearInterval(interval);
  };
}
 