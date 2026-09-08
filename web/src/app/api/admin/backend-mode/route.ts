import { NextRequest, NextResponse } from "next/server";
import { getInferenceBackend, setInferenceBackend } from "@/lib/inferenceBackend";

// Password-gated (same shared secret as /api/admin/stats) - lets the
// live-visitors dashboard also switch between the always-on Pod (fast,
// billed hourly - use during a launch window with real traffic) and
// RunPod Serverless (cheap, cold starts - use once traffic is quiet)
// without a redeploy. See @/lib/inferenceBackend for why this is DB-backed
// rather than an env var.
function checkAuth(req: NextRequest): boolean {
  const password = req.headers.get("x-admin-password");
  const expected = process.env.ADMIN_DASHBOARD_PASSWORD;
  return !!expected && password === expected;
}

export async function GET(req: NextRequest) {
  if (!checkAuth(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  return NextResponse.json({ mode: await getInferenceBackend() });
}

export async function POST(req: NextRequest) {
  if (!checkAuth(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const body = await req.json().catch(() => null);
  const mode = body?.mode;
  if (mode !== "pod" && mode !== "serverless") {
    return NextResponse.json({ error: "mode must be 'pod' or 'serverless'" }, { status: 400 });
  }
  await setInferenceBackend(mode);
  return NextResponse.json({ mode });
}
