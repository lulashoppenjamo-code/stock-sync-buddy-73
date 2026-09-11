import { createServerFn } from "@tanstack/react-start";
import { createClient } from "@supabase/supabase-js";
import { z } from "zod";
import type { Database } from "@/integrations/supabase/types";

const inputSchema = z.object({
  threadId: z.string().uuid(),
  question: z.string().min(1).max(2000),
  collaboratorName: z.string().max(120).optional(),
});

function serverClient() {
  const key = process.env["SUPABASE_PUBLISHABLE_KEY"] ?? process.env["SUPABASE_ANON_KEY"]!;
  return createClient<Database>(process.env["SUPABASE_URL"]!, key, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: {
      fetch: (input, init) => {
        const h = new Headers(init?.headers);
        if (key.startsWith("sb_") && h.get("Authorization") === `Bearer ${key}`) h.delete("Authorization");
        h.set("apikey", key);
        return fetch(input, { ...init, headers: h });
      },
    },
  });
}

function money(n: number) {
  return n.toLocaleString("es-MX", { style: "currency", currency: "MXN", maximumFractionDigits: 2 });
}

/** Resumen compacto de todo el inventario para dárselo al modelo como contexto. */
async function fetchAllClosedCounts(sb: ReturnType<typeof serverClient>) {
  // PostgREST limita cada respuesta a un máximo de filas por defecto
  // (típicamente 1000) sin importar el .limit() pedido desde el cliente.
  // Paginamos con .range() hasta traer todo, para no perder meses viejos
  // cuando hay más de una página de resultados.
  const PAGE_SIZE = 1000;
  const all: any[] = [];
  let from = 0;
  while (true) {
    const { data, error } = await sb
      .from("closed_counts")
      .select("*")
      .order("closed_at", { ascending: false })
      .range(from, from + PAGE_SIZE - 1);
    if (error) throw error;
    const page = data ?? [];
    all.push(...page);
    if (page.length < PAGE_SIZE) break;
    from += PAGE_SIZE;
  }
  return all;
}

async function buildContext(sb: ReturnType<typeof serverClient>) {
  const [closedRows, comments, prods] = await Promise.all([
    fetchAllClosedCounts(sb),
    sb.from("audit_comments").select("category, branch, collaborator_name, comment, created_at").order("created_at", { ascending: false }).limit(100),
    sb.from("products").select("barcode").limit(1),
  ]);

  const rows = closedRows ?? [];
  type Agg = { sys: number; mina: number; morelos: number; total: number; faltPz: number; sobrPz: number; faltVal: number; sobrVal: number };
  const newAgg = (): Agg => ({ sys: 0, mina: 0, morelos: 0, total: 0, faltPz: 0, sobrPz: 0, faltVal: 0, sobrVal: 0 });
  const byMonth = new Map<string, Agg>();
  const byCategory = new Map<string, Agg>();
  const worst: Array<{ name: string; barcode: string; category: string; diff: number; val: number; mina: number; morelos: number; sys: number; month: string }> = [];

  for (const r of rows) {
    const month = String(r.closed_at).slice(0, 7);
    const diff = Number(r.difference);
    const val = Number(r.difference_value ?? 0) || diff * Number(r.unit_price ?? 0);
    for (const key of [["m", month] as const, ["c", r.category] as const]) {
      const map = key[0] === "m" ? byMonth : byCategory;
      const e = map.get(key[1]) ?? newAgg();
      e.sys += Number(r.system_stock);
      e.mina += Number(r.mina_count);
      e.morelos += Number(r.morelos_count);
      e.total += Number(r.total_counted);
      if (diff < 0) { e.faltPz += -diff; e.faltVal += -val; } else { e.sobrPz += diff; e.sobrVal += val; }
      map.set(key[1], e);
    }
    if (diff !== 0) {
      worst.push({
        name: r.product_name, barcode: r.barcode, category: r.category, diff, val,
        mina: Number(r.mina_count), morelos: Number(r.morelos_count), sys: Number(r.system_stock), month,
      });
    }
  }

  worst.sort((a, b) => a.val - b.val);
  const topFaltantes = worst.slice(0, 60);
  const topSobrantes = worst.slice(-30).reverse();

  const fmtAgg = (label: string, a: Agg) => {
    const pctF = a.sys > 0 ? ((a.faltPz / a.sys) * 100).toFixed(2) : "0.00";
    return `${label}: sistema ${a.sys} pz, contado ${a.total} pz (Mina ${a.mina} / Morelos ${a.morelos}), faltante ${a.faltPz} pz = ${money(a.faltVal)} (${pctF}%), sobrante ${a.sobrPz} pz = ${money(a.sobrVal)}`;
  };

  const months = Array.from(byMonth.entries()).sort((a, b) => b[0].localeCompare(a[0]));
  const cats = Array.from(byCategory.entries()).sort((a, b) => b[1].faltVal - a[1].faltVal);

  return [
    `Datos de inventario (cortes cerrados: ${rows.length} renglones, productos en catálogo: ${prods.data ? "sí" : "n/d"}).`,
    "Sucursales: A = Mina, B = Morelos. Diferencia = (Mina + Morelos) − stock del sistema. Negativo = faltante.",
    "",
    "== FALTANTE POR MES ==",
    ...months.map(([k, a]) => fmtAgg(k, a)),
    "",
    "== FALTANTE POR CATEGORÍA (acumulado) ==",
    ...cats.map(([k, a]) => fmtAgg(k, a)),
    "",
    "== PRODUCTOS CON MAYOR FALTANTE EN PESOS ==",
    ...topFaltantes.map((w) => `${w.month} · ${w.category} · ${w.name} (código ${w.barcode}): diferencia ${w.diff} pz = ${money(w.val)} · Mina ${w.mina}, Morelos ${w.morelos}, sistema ${w.sys}`),
    "",
    "== PRODUCTOS CON MAYOR SOBRANTE ==",
    ...topSobrantes.map((w) => `${w.month} · ${w.category} · ${w.name} (código ${w.barcode}): +${w.diff} pz = ${money(w.val)}`),
    "",
    "== COMENTARIOS RECIENTES DE LAS COLABORADORAS ==",
    ...(comments.data ?? []).map((c) => `${String(c.created_at).slice(0, 10)} · ${c.collaborator_name ?? "—"} · ${c.category ?? "general"} · ${c.branch === "A" ? "Mina" : c.branch === "B" ? "Morelos" : "—"}: ${c.comment}`),
  ].join("\n");
}

export const askAuditAI = createServerFn({ method: "POST" })
  .inputValidator(inputSchema)
  .handler(async ({ data }) => {
    const sb = serverClient();

    // Memoria: historial de la conversación
    const { data: history } = await sb
      .from("ai_messages")
      .select("role, content")
      .eq("thread_id", data.threadId)
      .order("created_at", { ascending: true })
      .limit(60);

    const context = await buildContext(sb);

    const messages = [
      {
        role: "system",
        content:
          "Eres el asistente de inventario de una tienda con dos sucursales (Mina y Morelos). " +
          "Respondes en español de México, breve y concreto, con cifras y pesos mexicanos cuando aplique. " +
          "Usa exclusivamente los datos del contexto; si algo no está en los datos dilo claramente. " +
          "Recuerda lo conversado antes en este hilo.\n\n### DATOS ACTUALES\n" +
          context,
      },
      ...(history ?? []).map((m) => ({ role: m.role === "assistant" ? "assistant" : "user", content: m.content })),
      { role: "user", content: data.question },
    ];

    const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env["LOVABLE_API_KEY"]!}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ model: "google/gemini-2.5-flash", messages }),
    });

    if (!res.ok) {
      const text = await res.text();
      if (res.status === 429) throw new Error("Se alcanzó el límite de uso del asistente. Intentá en un momento.");
      if (res.status === 402) throw new Error("Se agotaron los créditos de IA del proyecto.");
      throw new Error(`El asistente no respondió (${res.status}): ${text.slice(0, 200)}`);
    }

    const json = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
    const answer = json.choices?.[0]?.message?.content?.trim() || "No pude generar una respuesta.";

    await sb.from("ai_messages").insert([
      { thread_id: data.threadId, role: "user", content: data.question, collaborator_name: data.collaboratorName ?? null },
      { thread_id: data.threadId, role: "assistant", content: answer },
    ]);

    return { answer };
  });
