/**
 * Extrae el primer objeto JSON de una respuesta de modelo.
 * Tolera ```json fences, texto antes/después y bloques de razonamiento.
 */
export function parseJson<T>(text: string): T {
  const clean = text
    .replace(/<think>[\s\S]*?<\/think>/gi, "")
    .replace(/```(?:json)?/gi, "")
    .trim();
  try {
    return JSON.parse(clean) as T;
  } catch {
    const start = clean.indexOf("{");
    const end = clean.lastIndexOf("}");
    if (start >= 0 && end > start) {
      try {
        return JSON.parse(clean.slice(start, end + 1)) as T;
      } catch {
        /* sigue abajo */
      }
    }
    throw new Error("El modelo no devolvió JSON válido");
  }
}

export const str = (v: unknown, fallback = ""): string => {
  if (typeof v === "string") return v;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  if (Array.isArray(v)) return v.map((x) => str(x)).filter(Boolean).join("\n\n");
  return fallback;
};

export const strArr = (v: unknown): string[] => {
  if (Array.isArray(v)) {
    return v
      .map((x) => (typeof x === "string" ? x : x && typeof x === "object" ? str(Object.values(x)[0]) : str(x)))
      .map((x) => x.trim())
      .filter(Boolean);
  }
  if (typeof v === "string" && v.trim()) return v.split(/\n+/).map((x) => x.replace(/^[-•*]\s*/, "").trim()).filter(Boolean);
  return [];
};

export const num = (v: unknown, fallback = 0): number => {
  const n = typeof v === "number" ? v : parseFloat(String(v ?? ""));
  return Number.isFinite(n) ? n : fallback;
};
