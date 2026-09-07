import { NextRequest, NextResponse } from "next/server";
import { stripe } from "@/lib/stripe";
import { getSubscriberByCustomerId } from "@/lib/db";

// Looks up the access token for a just-completed Checkout session, so the
// success page can show it once. Safe to expose only because Stripe session
// IDs are long, random, single-use-looking tokens themselves - not guessable.
export async function GET(req: NextRequest) {
  const sessionId = req.nextUrl.searchParams.get("session_id");
  if (!sessionId) {
    return NextResponse.json({ error: "Missing session_id" }, { status: 400 });
  }
  const session = await stripe.checkout.sessions.retrieve(sessionId);
  if (!session.customer) {
    return NextResponse.json({ error: "Session has no customer" }, { status: 400 });
  }
  const sub = await getSubscriberByCustomerId(session.customer as string);
  if (!sub) {
    // Webhook may not have landed yet (it's async) - tell the client to retry shortly.
    return NextResponse.json({ pending: true });
  }
  return NextResponse.json({ accessToken: sub.access_token, plan: sub.plan });
}
