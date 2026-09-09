import { NextRequest, NextResponse } from "next/server";
import { initSchema, getVisitStats } from "@/lib/db";

// Gated by a shared password (ADMIN_DASHBOARD_PASSWORD) rather than real
// auth - there's no admin/owner account system in this app yet, and this
// only exposes visit counts (no subscriber/billing data), so a simple
// shared secret is a reasonable amount of protection for what it guards.
export async function GET(req: NextRequest) {
  const password = req.headers.get("x-admin-password");
  const expected = process.env.ADMIN_DASHBOARD_PASSWORD;
  if (!expected || password !== expected) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    await initSchema();
    const stats = await getVisitStats();
    return NextResponse.json(stats);
  } catch (err) {
    console.error("[admin/stats] failed to load visit stats", err);
    return NextResponse.json({ error: "Could not load stats right now." }, { status: 502 });
  }
}
