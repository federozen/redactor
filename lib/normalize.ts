import { num, str, strArr } from "./json";
import type { EditorialAnalysis, ModelTier, Risk, Trigger } from "./types";

const TRIGGERS: Trigger[] = ["breaking", "noticia", "declaraciones", "mercado", "previa", "post", "actualizacion", "analisis"];
const TIERS: ModelTier[] = ["free_fast", "free_strong", "premium"];

const stripAccents = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();

export function tierForComplexity(c: number): ModelTier {
  return c >= 6 ? "premium" : c >= 3 ? "free_strong" : "free_fast";
}

/** Normaliza lo que devuelva el modelo para que la UI nunca reciba campos faltantes o con otro tipo. */
export function normalizeAnalysis(raw: any): EditorialAnalysis {
  const r = raw && typeof raw === "object" ? raw : {};
  let trigger = stripAccents(str(r.trigger, "noticia")).replace(/\s+partido$/, "") as Trigger;
  if (!TRIGGERS.includes(trigger)) trigger = "noticia";
  let risk = stripAccents(str(r.risk, "medio")) as Risk;
  if (!["bajo", "medio", "alto"].includes(risk)) risk = "medio";
  const complexity = Math.max(0, Math.min(10, Math.round(num(r.complexity, 3))));
  let recommendedTier = str(r.recommendedTier) as ModelTier;
  if (!TIERS.includes(recommendedTier)) recommendedTier = tierForComplexity(complexity);
  return {
    trigger,
    label: str(r.label, trigger),
    headline: str(r.headline, "Historia detectada"),
    summary: str(r.summary),
    protagonists: strArr(r.protagonists),
    confirmedFacts: strArr(r.confirmedFacts),
    openQuestions: strArr(r.openQuestions),
    cautions: strArr(r.cautions),
    suggestedAngles: strArr(r.suggestedAngles).slice(0, 5),
    section: str(r.section, "Fútbol"),
    tags: strArr(r.tags),
    complexity,
    risk,
    recommendedTier,
    reason: str(r.reason),
  };
}

export function normalizeAlternatives(v: unknown) {
  if (!Array.isArray(v)) return [];
  return v
    .map((a: any) =>
      typeof a === "string"
        ? { kind: "Alternativa", title: a, score: 0, notes: [] as string[] }
        : { kind: str(a?.kind ?? a?.type ?? a?.label, "Alternativa"), title: str(a?.title), score: Math.round(num(a?.score, 0)), notes: strArr(a?.notes) }
    )
    .filter((a) => a.title);
}
