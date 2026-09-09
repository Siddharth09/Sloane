import { NextResponse } from "next/server";
import { warmInferenceBackend } from "@/lib/inferenceBackend";

// Called by the client the moment someone opens the generation page (see
// web/src/app/page.tsx and mobile/App.tsx) - fires a background warm-up
// ping at Modal well before the user finishes typing and hits Generate for
// real, so the container is often already warm by then instead of paying
// the full cold-start cost on the request that actually matters. Always
// returns 200 - a failed warm-up ping should never surface to the user,
// worst case they just hit the normal cold-start path on Generate.
export async function POST() {
  await warmInferenceBackend().catch(() => {});
  return NextResponse.json({ ok: true });
}
