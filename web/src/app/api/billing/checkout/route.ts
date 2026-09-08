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
  try {
    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: `${origin}/billing?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${origin}/billing?canceled=1`,
      // Stripe's "Managed Payments" (on by default for this account) requires
      // a tax code on every product before it'll create a session - we
      // haven't made a tax-classification decision for the product yet, so
      // disable it for now rather than guess a tax code. Revisit once that's
      // deliberately decided.
      // @ts-expect-error - managed_payments isn't in this SDK version's types yet
      managed_payments: { enabled: false },
    });
    return NextResponse.json({ url: session.url });
  } catch (err) {
    console.error("Stripe checkout session creation failed", err);
    const message = err instanceof Error ? err.message : "Checkout failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
