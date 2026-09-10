import { NextRequest, NextResponse } from "next/server";
import { stripe } from "@/lib/stripe";
import { getSessionUser } from "@/lib/auth";
import { VIDEO_CREDIT_PACKS } from "@/lib/videoPaygo";

// One-time payment (mode: "payment", not "subscription") for a video-credit
// pack - a deliberately different Stripe flow from @/app/api/billing/checkout,
// which only ever creates recurring subscriptions. client_reference_id is
// required (not optional like the subscription flow) since credits are
// meaningless without an account to hold the balance.
export async function POST(req: NextRequest) {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "Sign in required to buy video credits" }, { status: 401 });
  }

  const { packId } = (await req.json()) as { packId: string };
  const pack = VIDEO_CREDIT_PACKS.find((p) => p.id === packId);
  if (!pack) {
    return NextResponse.json({ error: "Unknown credit pack" }, { status: 400 });
  }
  const priceId = process.env[pack.stripePriceEnvVar];
  if (!priceId) {
    return NextResponse.json({ error: "Credit pack not configured on the server yet" }, { status: 500 });
  }

  const origin = req.nextUrl.origin;
  try {
    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: `${origin}/account?video_credits=1&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${origin}/account?canceled=1`,
      client_reference_id: user.id,
      managed_payments: { enabled: false },
    });
    return NextResponse.json({ url: session.url });
  } catch (err) {
    console.error("Video credit checkout session creation failed", err);
    const message = err instanceof Error ? err.message : "Checkout failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
