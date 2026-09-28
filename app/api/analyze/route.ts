import { NextResponse } from "next/server";
import { z } from "zod";
import { runJson } from "@/lib/models";
import { ANALYZE_SYSTEM } from "@/lib/prompts";
import { fetchSource } from "@/lib/source";
import { normalizeAnalysis } from "@/lib/normalize";
import { errorMessage } from "@/lib/errors";

export const runtime = "nodejs";
export const maxDuration = 300;

const Req = z.object({
  input: z.string().trim().min(5).max(30000),
  urls: z.array(z.string()).default([]),
  context: z.string().max(10000).default(""),
});

function cleanUrls(list: string[]): string[] {
  const out: string[] = [];
  for (let raw of list) {
    raw = raw.trim();
    if (!raw) continue;
    if (!/^https?:\/\//i.test(raw)) raw = `https://${raw}`;
    try {
      const u = new URL(raw);
      if (u.hostname.includes(".") && !out.includes(u.toString())) out.push(u.toString());
    } catch {
      /* se ignora */
    }
  }
  return out.slice(0, 6);
}

export async function POST(req: Request) {
  try {
    const body = Req.parse(await req.json());
    const urls = cleanUrls(body.urls);
    const sources = await Promise.all(urls.map(fetchSource));
    const sourceText = sources
      .map((s, i) => `FUENTE ${i + 1}\nURL: ${s.url}\nTítulo: ${s.title}\n${s.error ? `ERROR: ${s.error}` : s.text}`)
      .join("\n\n---\n\n");
    const user = `DISPARADOR DEL PERIODISTA:\n${body.input}\n\nCONTEXTO OPCIONAL:\n${body.context || "(sin contexto adicional)"}\n\nFUENTES LEÍDAS:\n${sourceText || "(sin URLs)"}\n\nDevolvé un objeto JSON con estas claves exactas:
{"trigger":"breaking|noticia|declaraciones|mercado|previa|post|actualizacion|analisis","label":string,"headline":string,"summary":string,"protagonists":string[],"confirmedFacts":string[],"openQuestions":string[],"cautions":string[],"suggestedAngles":[3 strings],"section":string,"tags":string[],"complexity":0-10,"risk":"bajo|medio|alto","recommendedTier":"free_fast|free_strong|premium","reason":string}`;
    const out = await runJson<any>("free_fast", [
      { role: "system", content: ANALYZE_SYSTEM },
      { role: "user", content: user },
    ]);
    const analysis = normalizeAnalysis(out.data);
    return NextResponse.json({ analysis, sources, model: { provider: out.provider, model: out.model } });
  } catch (e: any) {
    console.error("[analyze]", e);
    return NextResponse.json({ error: errorMessage(e, "No se pudo analizar") }, { status: e instanceof z.ZodError ? 400 : 502 });
  }
}
