import { NextRequest, NextResponse } from "next/server";
import { stripe } from "@/lib/stripe";
import { PLANS, type PlanId } from "@/lib/plans";

export async function POST(req: NextRequest) {
  const { plan } = (await req.json()) as { plan: PlanId };
  const planDef = PLANS[plan];
  if (!planDef || !planDef.stripePriceEnvVar) {
    return NextResponse.json({ error: "Unknown plan" }, { status: 400 });
  }
  const priceId = process.env[planDef.stripePriceEnvVar];
  if (!priceId) {
    return NextResponse.json({ error: "Plan not configured on the server yet" }, { status: 500 });
  }

  const origin = req.nextUrl.origin;
  const session = await stripe.checkout.sessions.create({
    mode: "subscription",
    line_items: [{ price: priceId, quantity: 1 }],
    success_url: `${origin}/billing?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${origin}/billing?canceled=1`,
  });

  return NextResponse.json({ url: session.url });
}
