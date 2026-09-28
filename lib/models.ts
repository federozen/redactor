import type { ModelTier } from "./types";
import { parseJson } from "./json";

type Message = { role: "system" | "user" | "assistant"; content: string };
export type ModelResult = { text: string; provider: string; model: string };
type Provider = "gemini" | "groq" | "anthropic";
type Candidate = { provider: Provider; model: string };

const env = (name: string, fallback = "") => process.env[name]?.trim() || fallback;
const has = (p: Provider) =>
  !!env(p === "gemini" ? "GEMINI_API_KEY" : p === "groq" ? "GROQ_API_KEY" : "ANTHROPIC_API_KEY");

const TIMEOUT_MS = Number(env("MODEL_TIMEOUT_MS", "90000"));

async function readError(r: Response) {
  const t = await r.text().catch(() => "");
  try {
    const j = JSON.parse(t);
    return j?.error?.message || j?.message || t.slice(0, 240);
  } catch {
    return t.slice(0, 240);
  }
}

async function gemini(messages: Message[], model: string): Promise<ModelResult> {
  const key = env("GEMINI_API_KEY");
  const base = env("GEMINI_BASE_URL", "https://generativelanguage.googleapis.com/v1beta");
  const system = messages.filter((m) => m.role === "system").map((m) => m.content).join("\n\n");
  const contents = messages
    .filter((m) => m.role !== "system")
    .map((m) => ({ role: m.role === "assistant" ? "model" : "user", parts: [{ text: m.content }] }));
  const r = await fetch(`${base}/models/${encodeURIComponent(model)}:generateContent`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-goog-api-key": key },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: system }] },
      contents,
      generationConfig: { temperature: 0.25, responseMimeType: "application/json", maxOutputTokens: 8192 },
    }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!r.ok) throw new Error(`Gemini ${r.status}: ${await readError(r)}`);
  const d = await r.json();
  const text = d?.candidates?.[0]?.content?.parts
    ?.filter((p: any) => !p.thought)
    .map((p: any) => p.text || "")
    .join("")
    .trim();
  if (!text) throw new Error(`Gemini no devolvió texto (${d?.candidates?.[0]?.finishReason || d?.promptFeedback?.blockReason || "sin motivo"})`);
  return { text, provider: "Gemini", model };
}

async function groq(messages: Message[], model: string): Promise<ModelResult> {
  const key = env("GROQ_API_KEY");
  const base = env("GROQ_BASE_URL", "https://api.groq.com/openai/v1");
  const call = (jsonMode: boolean) =>
    fetch(`${base}/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
      body: JSON.stringify({
        model,
        messages,
        temperature: 0.2,
        max_completion_tokens: 8192,
        ...(jsonMode ? { response_format: { type: "json_object" } } : {}),
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  let r = await call(true);
  // Groq devuelve 400 json_validate_failed cuando el modelo se desvía del JSON: reintento sin modo JSON y parseo tolerante.
  if (r.status === 400) r = await call(false);
  if (!r.ok) throw new Error(`Groq ${r.status}: ${await readError(r)}`);
  const d = await r.json();
  const text = d?.choices?.[0]?.message?.content?.trim();
  if (!text) throw new Error("Groq no devolvió texto");
  return { text, provider: "Groq", model };
}

async function anthropic(messages: Message[], model: string): Promise<ModelResult> {
  const key = env("ANTHROPIC_API_KEY");
  const base = env("ANTHROPIC_BASE_URL", "https://api.anthropic.com");
  const system = messages.filter((m) => m.role === "system").map((m) => m.content).join("\n\n");
  const clean = messages.filter((m) => m.role !== "system");
  const r = await fetch(`${base}/v1/messages`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-api-key": key, "anthropic-version": "2023-06-01" },
    body: JSON.stringify({
      model,
      max_tokens: 8000,
      system: `${system}\n\nRespondé únicamente con el objeto JSON, sin texto antes ni después y sin bloques de código.`,
      messages: clean,
    }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!r.ok) throw new Error(`Anthropic ${r.status}: ${await readError(r)}`);
  const d = await r.json();
  const text = d?.content?.filter((x: any) => x.type === "text").map((x: any) => x.text).join("\n")?.trim();
  if (!text) throw new Error("Anthropic no devolvió texto");
  return { text, provider: "Anthropic", model };
}

const CALL: Record<Provider, (m: Message[], model: string) => Promise<ModelResult>> = { gemini, groq, anthropic };

function fastCandidate(p: Provider): Candidate {
  if (p === "groq") return { provider: "groq", model: env("GROQ_FAST_MODEL", "openai/gpt-oss-20b") };
  if (p === "anthropic") return { provider: "anthropic", model: env("PREMIUM_MODEL", "claude-sonnet-5") };
  return { provider: "gemini", model: env("GEMINI_FAST_MODEL", "gemini-3.5-flash-lite") };
}
function strongCandidate(p: Provider): Candidate {
  if (p === "groq") return { provider: "groq", model: env("GROQ_STRONG_MODEL", "openai/gpt-oss-120b") };
  if (p === "anthropic") return { provider: "anthropic", model: env("PREMIUM_MODEL", "claude-sonnet-5") };
  return { provider: "gemini", model: env("GEMINI_STRONG_MODEL", "gemini-3.8-flash") };
}
const asProvider = (v: string, fb: Provider): Provider => (["gemini", "groq", "anthropic"].includes(v) ? (v as Provider) : fb);

/** Orden de intento para cada tier. Sólo se incluyen proveedores con key. */
export function candidatesFor(tier: ModelTier): Candidate[] {
  const fastP = asProvider(env("FREE_FAST_PROVIDER", "gemini"), "gemini");
  const strongP = asProvider(env("FREE_STRONG_PROVIDER", "groq"), "groq");
  const other = (p: Provider): Provider => (p === "gemini" ? "groq" : "gemini");
  const premium = strongCandidate("anthropic");
  let list: Candidate[];
  if (tier === "premium") list = [premium, strongCandidate(strongP), strongCandidate(other(strongP)), fastCandidate(fastP)];
  else if (tier === "free_strong") list = [strongCandidate(strongP), strongCandidate(other(strongP)), fastCandidate(fastP), fastCandidate(other(fastP)), premium];
  else list = [fastCandidate(fastP), fastCandidate(other(fastP)), strongCandidate(strongP), strongCandidate(other(strongP)), premium];
  const seen = new Set<string>();
  return list.filter((c) => {
    const k = `${c.provider}:${c.model}`;
    if (!has(c.provider) || seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

export function providerStatus() {
  return { gemini: has("gemini"), groq: has("groq"), anthropic: has("anthropic") };
}

/**
 * Llama al primer modelo disponible del tier y parsea JSON.
 * Si un proveedor falla (cuota, modelo inexistente, timeout, JSON roto) pasa al siguiente.
 */
export async function runJson<T>(tier: ModelTier, messages: Message[]): Promise<ModelResult & { data: T }> {
  const list = candidatesFor(tier);
  if (!list.length) {
    throw new Error("No hay ningún proveedor de IA configurado. Agregá GEMINI_API_KEY, GROQ_API_KEY o ANTHROPIC_API_KEY en las variables de entorno.");
  }
  const errors: string[] = [];
  for (const c of list) {
    try {
      const out = await CALL[c.provider](messages, c.model);
      return { ...out, data: parseJson<T>(out.text) };
    } catch (e: any) {
      const msg = e?.name === "TimeoutError" ? "tiempo agotado" : e?.message || String(e);
      errors.push(`${c.provider}/${c.model}: ${msg}`);
      console.error("[models]", errors[errors.length - 1]);
    }
  }
  throw new Error(`Fallaron todos los modelos disponibles → ${errors.join(" | ")}`);
}
