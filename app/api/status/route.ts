import { NextResponse } from "next/server";
import { providerStatus } from "@/lib/models";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({ providers: providerStatus() });
}
