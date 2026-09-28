import { NextResponse } from "next/server";
import { z } from "zod";
import { runJson } from "@/lib/models";
import { WRITE_SYSTEM, REVIEW_SYSTEM } from "@/lib/prompts";
import { str, strArr } from "@/lib/json";
import { normalizeAnalysis, normalizeAlternatives } from "@/lib/normalize";
import { errorMessage } from "@/lib/errors";
import type { Article, EditorialAnalysis, ModelTier } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 300;

const Req = z.object({
  input: z.string().trim().min(5).max(30000),
  context: z.string().max(10000).default(""),
  analysis: z.record(z.string(), z.any()),
  forceTier: z.enum(["auto", "free_fast", "free_strong", "premium"]).default("auto"),
});

const WRITE_SHAPE = `Devolvé un objeto JSON con estas claves exactas:
{"title":string,"deck":string,"body":string (párrafos separados por \\n\\n),"section":string,"tags":string[],"alternatives":[{"kind":"Directo","title":string,"score":0-100,"notes":string[]},{"kind":"SEO",...},{"kind":"Más periodístico",...}]}`;

type Verdict = { approved: boolean; warnings: string[]; checks: string[]; revisionInstruction: string };

async function review(a: EditorialAnalysis, article: any, tier: ModelTier, label: string): Promise<Verdict> {
  try {
    const out = await runJson<any>(tier, [
      { role: "system", content: REVIEW_SYSTEM },
      { role: "user", content: `MESA:\n${JSON.stringify(a, null, 2)}\n\n${label}:\n${JSON.stringify(article, null, 2)}` },
    ]);
    const v = out.data || {};
    return {
      approved: v.approved === true || v.approved === "true",
      warnings: strArr(v.warnings),
      checks: strArr(v.checks),
      revisionInstruction: str(v.revisionInstruction),
    };
  } catch (e: any) {
    // Si el revisor falla, no se pierde la nota: se entrega marcada para revisión humana.
    return { approved: false, warnings: [`No se pudo ejecutar la revisión automática: ${e?.message || e}`], checks: [], revisionInstruction: "" };
  }
}

export async function POST(req: Request) {
  try {
    const body = Req.parse(await req.json());
    const a = normalizeAnalysis(body.analysis);
    const tier: ModelTier = body.forceTier !== "auto" ? body.forceTier : a.recommendedTier;
    const reviewTier: ModelTier = tier === "free_fast" ? "free_fast" : "free_strong";
    const facts = `DISPARADOR ORIGINAL:\n${body.input}\n\nMESA EDITORIAL (el primer enfoque de suggestedAngles es el elegido por el editor):\n${JSON.stringify(a, null, 2)}\n\nCONTEXTO DEL PERIODISTA:\n${body.context || "(sin contexto adicional)"}\n\n${WRITE_SHAPE}`;

    let draft = await runJson<any>(tier, [
      { role: "system", content: WRITE_SYSTEM },
      { role: "user", content: facts },
    ]);
    let verdict = await review(a, draft.data, reviewTier, "BORRADOR");
    let rewritten = false;

    if (!verdict.approved && verdict.revisionInstruction) {
      try {
        draft = await runJson<any>(tier, [
          { role: "system", content: WRITE_SYSTEM },
          {
            role: "user",
            content: `${facts}\n\nBORRADOR ANTERIOR:\n${JSON.stringify(draft.data, null, 2)}\n\nREVISIÓN EDITORIAL OBLIGATORIA:\n${verdict.revisionInstruction}\nReescribí corrigiendo sólo lo señalado.`,
          },
        ]);
        rewritten = true;
        verdict = await review(a, draft.data, reviewTier, "BORRADOR REVISADO");
      } catch (e: any) {
        verdict.warnings.push(`La reescritura automática falló: ${e?.message || e}`);
      }
    }

    const art = draft.data || {};
    const result: Article = {
      title: str(art.title),
      deck: str(art.deck),
      body: str(art.body),
      section: str(art.section, a.section),
      tags: strArr(art.tags).length ? strArr(art.tags) : a.tags,
      alternatives: normalizeAlternatives(art.alternatives),
      review: { approved: verdict.approved, warnings: verdict.warnings, checks: verdict.checks, rewritten },
      model: { provider: draft.provider, model: draft.model, tier },
    };
    if (!result.title && !result.body) throw new Error("El modelo devolvió una nota vacía. Probá de nuevo o forzá otro modelo.");
    return NextResponse.json({ article: result });
  } catch (e: any) {
    console.error("[generate]", e);
    return NextResponse.json({ error: errorMessage(e, "No se pudo generar") }, { status: e instanceof z.ZodError ? 400 : 502 });
  }
}
