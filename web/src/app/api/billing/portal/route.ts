import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { getSubscriberByUserId } from "@/lib/db";
import { stripe } from "@/lib/stripe";

export async function POST(req: NextRequest) {
  try {
    const user = await getSessionUser();
    if (!user) {
      return NextResponse.json({ error: "Not signed in" }, { status: 401 });
    }
    const subscriber = await getSubscriberByUserId(user.id);
    if (!subscriber) {
      return NextResponse.json({ error: "No subscription on this account yet" }, { status: 404 });
    }
    const session = await stripe.billingPortal.sessions.create({
      customer: subscriber.stripe_customer_id,
      return_url: `${req.nextUrl.origin}/account`,
    });
    return NextResponse.json({ url: session.url });
  } catch (err) {
    console.error("[billing/portal] failed to create portal session", err);
    return NextResponse.json({ error: "Could not open billing portal right now" }, { status: 500 });
  }
}
