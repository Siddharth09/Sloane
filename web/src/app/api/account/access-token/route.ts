import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { getSubscriberByUserId, initSchema } from "@/lib/db";

// Lightweight sibling of /api/account (2026-09-12) - returns just the
// access token linked to the signed-in session, if any, without the
// heavier subscriber/generations payload. Lets useAccessToken auto-sync a
// paying subscriber's token on ANY page (not just /account, which was the
// only place this sync happened before) without pulling generations data
// on every page load across every component that calls the hook.
export async function GET() {
  try {
    await initSchema();
    const user = await getSessionUser();
    if (!user) {
      return NextResponse.json({ accessToken: null });
    }
    const subscriber = await getSubscriberByUserId(user.id);
    return NextResponse.json({ accessToken: subscriber?.access_token ?? null });
  } catch (err) {
    console.error("[account/access-token] failed to look up subscriber", err);
    return NextResponse.json({ accessToken: null });
  }
}
