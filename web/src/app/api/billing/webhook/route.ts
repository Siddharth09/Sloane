import { NextRequest, NextResponse } from "next/server";
import { stripe } from "@/lib/stripe";
import { upsertSubscriberForCheckout, setSubscriberStatus, linkSubscriberToUser, initSchema, addVideoCredits } from "@/lib/db";
import { planFromStripePriceId } from "@/lib/plans";
import { videoCreditPackFromStripePriceId } from "@/lib/videoPaygo";
import { sendAccessCodeEmail, sendPaymentFailedEmail } from "@/lib/email";
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

      // One-time video-credit-pack purchase (mode: "payment") - a
      // completely different flow from the subscription checkout below,
      // distinguished by session.mode since both events share this same
      // Stripe event type. Requires client_reference_id (the video-paygo
      // checkout route always sets it - credits are meaningless without an
      // account to hold the balance, unlike the subscription flow where
      // it's optional).
      if (session.mode === "payment") {
        const lineItems = await stripe.checkout.sessions.listLineItems(session.id);
        const priceId = lineItems.data[0]?.price?.id;
        const pack = priceId ? videoCreditPackFromStripePriceId(priceId) : null;
        const userId = session.client_reference_id;
        if (pack && userId) {
          await addVideoCredits(userId, pack.credits);
        } else {
          console.error("Video credit checkout completed but couldn't resolve pack/user", { priceId, userId });
        }
        break;
      }

      const subscriptionId = session.subscription as string;
      const subscription = await stripe.subscriptions.retrieve(subscriptionId);
      const priceId = subscription.items.data[0]?.price.id;
      const plan = priceId ? planFromStripePriceId(priceId) : null;
      if (!plan) {
        console.error("Checkout completed for an unrecognized price", priceId);
        break;
      }
      const item = subscription.items.data[0];
      const email = session.customer_details?.email ?? "";
      const accessToken = await upsertSubscriberForCheckout({
        email,
        stripeCustomerId: session.customer as string,
        stripeSubscriptionId: subscription.id,
        plan,
        periodStart: new Date(item.current_period_start * 1000),
        periodEnd: new Date(item.current_period_end * 1000),
      });
      // Only on first checkout, not every renewal (invoice.paid fires
      // monthly too) - a "welcome, here's your code" email every renewal
      // would be spammy and confusing.
      await sendAccessCodeEmail(email, accessToken, plan);
      // If checkout was started from a logged-in session, link this
      // subscriber straight to that account so /account shows it immediately
      // without waiting for a lazy email-match on next login.
      if (session.client_reference_id && email) {
        await linkSubscriberToUser(email, session.client_reference_id);
      }
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
        const customer = await stripe.customers.retrieve(subscription.customer as string);
        const customerEmail = !customer.deleted ? customer.email : null;
        if (customerEmail) await sendPaymentFailedEmail(customerEmail);
      } else if (subscription.status === "active") {
        await setSubscriberStatus(subscription.customer as string, "active");
      }
      break;
    }
  }

  return NextResponse.json({ received: true });
}
