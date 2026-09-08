import { NextResponse } from "next/server";
import { getInferenceBackend } from "@/lib/inferenceBackend";

// Public, read-only - lets the client know whether to show the "may take
// 20-60 seconds" cold-start copy (Serverless) or not (Pod, always warm).
// Not sensitive: just says which backend is active, same info visible from
// how fast generation actually responds.
export async function GET() {
  return NextResponse.json({ mode: await getInferenceBackend() });
}
