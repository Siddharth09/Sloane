import { NextRequest, NextResponse } from "next/server";
import { initSchema, recordVisit } from "@/lib/db";

// Heartbeat endpoint for the live-visitors dashboard (see
// web/src/app/admin/page.tsx). Pinged by VisitTracker.tsx every ~20s while
// a tab is open - deliberately just a session id + path, no IP/user-agent/
// fingerprinting, consistent with this site's existing self-hosted,
// minimal-data-collection posture (see /privacy).
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const sessionId = typeof body?.sessionId === "string" ? body.sessionId : null;
  const path = typeof body?.path === "string" ? body.path : "/";
  if (!sessionId) {
    return NextResponse.json({ error: "Missing sessionId" }, { status: 400 });
  }

  await initSchema();
  await recordVisit(sessionId, path);
  return NextResponse.json({ ok: true });
}
