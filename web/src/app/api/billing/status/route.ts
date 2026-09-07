import { NextRequest, NextResponse } from "next/server";
import { getSubscriberByToken } from "@/lib/db";
import { PLANS } from "@/lib/plans";

export async function GET(req: NextRequest) {
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
    videoSecondsUsed: sub.video_seconds_used,
    videoSecondsLimit: plan.videoSecondsPerMonth,
    periodEnd: sub.period_end,
  });
}
