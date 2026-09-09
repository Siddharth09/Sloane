import { NextRequest, NextResponse } from "next/server";
import { getSubscriberByToken } from "@/lib/db";
import { PLANS } from "@/lib/plans";

export async function GET(req: NextRequest) {
  try {
    const token = req.nextUrl.searchParams.get("token");
    if (!token) {
      return NextResponse.json({ error: "Missing token" }, { status: 400 });
    }
    const sub = await getSubscriberByToken(token);
    if (!sub) {
      return NextResponse.json({ error: "Access code not found" }, { status: 404 });
    }
    const plan = PLANS[sub.plan];
    return NextResponse.json({
      plan: plan.name,
      status: sub.status,
      charactersUsed: sub.characters_used,
      charactersLimit: plan.charactersPerMonth,
      // DB column is still named video_seconds_used (avoiding a migration for
      // an always-zero, not-yet-live field) - it now means credits, not seconds.
      videoCreditsUsed: sub.video_seconds_used,
      videoCreditsLimit: plan.videoCreditsPerMonth,
      periodEnd: sub.period_end,
    });
  } catch (err) {
    console.error("[billing/status] failed to look up subscriber", err);
    return NextResponse.json({ error: "Couldn't reach the account server." }, { status: 502 });
  }
}
