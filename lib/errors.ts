import { ZodError } from "zod";

export function errorMessage(e: any, fallback: string): string {
  if (e instanceof ZodError) {
    const i = e.issues[0];
    const field = i?.path?.join(".") || "datos";
    if (field === "input") return "El texto de «¿Qué pasó?» es muy corto o demasiado largo.";
    return `Dato inválido en ${field}: ${i?.message}`;
  }
  if (e instanceof SyntaxError) return "El pedido no es JSON válido.";
  return e?.message || fallback;
}
