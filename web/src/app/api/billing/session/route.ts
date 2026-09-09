import { NextRequest, NextResponse } from "next/server";
import { stripe } from "@/lib/stripe";
import { getSubscriberByCustomerId } from "@/lib/db";

// Looks up the access token for a just-completed Checkout session, so the
// success page can show it once. Safe to expose only because Stripe session
// IDs are long, random, single-use-looking tokens themselves - not guessable.
export async function GET(req: NextRequest) {
  // Wrapped in try/catch: an invalid/expired session_id throwing out of the
  // Stripe SDK used to produce a non-JSON error, and the client's polling
  // loop (billing/page.tsx's CheckoutSuccess) has no catch of its own -
  // right after a real charge, that left the UI stuck on "Confirming your
  // subscription..." forever with no feedback.
  try {
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
  } catch (err) {
    console.error("[billing/session] failed to look up checkout session", err);
    return NextResponse.json(
      { error: "Couldn't confirm your subscription right now - refresh this page in a moment." },
      { status: 502 },
    );
  }
}
