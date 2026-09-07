import { NextRequest, NextResponse } from "next/server";
import { stripe } from "@/lib/stripe";
import { upsertSubscriberForCheckout, setSubscriberStatus, initSchema } from "@/lib/db";
import { planFromStripePriceId } from "@/lib/plans";
import type Stripe from "stripe";

// Stripe needs the raw request body (unparsed) to verify the signature.
export async function POST(req: NextRequest) {
  await initSchema();

  const body = await req.text();
  const signature = req.headers.get("stripe-signature");
  if (!signature) {
    return NextResponse.json({ error: "Missing signature" }, { status: 400 });
  }

  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(body, signature, process.env.STRIPE_WEBHOOK_SECRET!);
  } catch (err) {
    console.error("Stripe webhook signature verification failed", err);
    return NextResponse.json({ error: "Invalid signature" }, { status: 400 });
  }

  switch (event.type) {
    case "checkout.session.completed": {
      const session = event.data.object as Stripe.Checkout.Session;
      const subscriptionId = session.subscription as string;
      const subscription = await stripe.subscriptions.retrieve(subscriptionId);
      const priceId = subscription.items.data[0]?.price.id;
      const plan = priceId ? planFromStripePriceId(priceId) : null;
      if (!plan) {
        console.error("Checkout completed for an unrecognized price", priceId);
        break;
      }
      const item = subscription.items.data[0];
      await upsertSubscriberForCheckout({
        email: session.customer_details?.email ?? "",
        stripeCustomerId: session.customer as string,
        stripeSubscriptionId: subscription.id,
        plan,
        periodStart: new Date(item.current_period_start * 1000),
        periodEnd: new Date(item.current_period_end * 1000),
      });
      break;
    }

    case "invoice.paid": {
      // Renewal - reset usage counters for the new period.
      const invoice = event.data.object as Stripe.Invoice;
      const subscriptionId = (invoice as unknown as { subscription?: string }).subscription;
      if (!subscriptionId) break;
      const subscription = await stripe.subscriptions.retrieve(subscriptionId);
      const priceId = subscription.items.data[0]?.price.id;
      const plan = priceId ? planFromStripePriceId(priceId) : null;
      if (!plan) break;
      const item = subscription.items.data[0];
      await upsertSubscriberForCheckout({
        email: invoice.customer_email ?? "",
        stripeCustomerId: subscription.customer as string,
        stripeSubscriptionId: subscription.id,
        plan,
        periodStart: new Date(item.current_period_start * 1000),
        periodEnd: new Date(item.current_period_end * 1000),
      });
      break;
    }

    case "customer.subscription.deleted": {
      const subscription = event.data.object as Stripe.Subscription;
      await setSubscriberStatus(subscription.customer as string, "canceled");
      break;
    }

    case "customer.subscription.updated": {
      const subscription = event.data.object as Stripe.Subscription;
      if (subscription.status === "past_due" || subscription.status === "unpaid") {
        await setSubscriberStatus(subscription.customer as string, "past_due");
      } else if (subscription.status === "active") {
        await setSubscriberStatus(subscription.customer as string, "active");
      }
      break;
    }
  }

  return NextResponse.json({ received: true });
}
