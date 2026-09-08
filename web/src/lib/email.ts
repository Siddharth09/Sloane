import { Resend } from "resend";
import { PLANS, type PlanId } from "@/lib/plans";

// No-ops (logs and returns) rather than throwing if RESEND_API_KEY isn't
// set - a missing email key should never break checkout/billing, which is
// the actual product. Add a real key to web/.env.local (and Vercel) to
// make this send for real; nothing here is live until that key exists.
const resend = process.env.RESEND_API_KEY ? new Resend(process.env.RESEND_API_KEY) : null;
const FROM = "Lucy Labs <billing@lucylabs.app>";

export async function sendAccessCodeEmail(email: string, accessToken: string, plan: PlanId) {
  if (!email) return;
  if (!resend) {
    console.warn("[email] RESEND_API_KEY not set - skipping access-code email to", email);
    return;
  }
  const planName = PLANS[plan].name;
  try {
    await resend.emails.send({
      from: FROM,
      to: email,
      subject: `Your Lucy Labs access code (${planName} plan)`,
      html: `
        <div style="font-family: sans-serif; max-width: 480px; margin: 0 auto; padding: 24px;">
          <h1 style="font-size: 20px;">Welcome to Lucy Labs ${planName}!</h1>
          <p>Your subscription is active. Here's your access code — save it somewhere safe, it's the only thing you need to unlock your plan on lucylabs.app:</p>
          <p style="font-size: 24px; font-weight: bold; letter-spacing: 1px; background: #fdf6f0; padding: 16px; border-radius: 12px; text-align: center;">${accessToken}</p>
          <p>Paste it into the account box on the home page any time you're on a new device or browser.</p>
          <p style="color: #9a8b83; font-size: 13px; margin-top: 32px;">Questions? Just reply to this email or reach us at support@astryks.com.</p>
        </div>
      `,
    });
  } catch (err) {
    // Never let an email failure break the billing flow that triggered it.
    console.error("[email] Failed to send access-code email", err);
  }
}

export async function sendPaymentFailedEmail(email: string) {
  if (!email || !resend) {
    if (!resend) console.warn("[email] RESEND_API_KEY not set - skipping payment-failed email to", email);
    return;
  }
  try {
    await resend.emails.send({
      from: FROM,
      to: email,
      subject: "Lucy Labs — there was a problem with your payment",
      html: `
        <div style="font-family: sans-serif; max-width: 480px; margin: 0 auto; padding: 24px;">
          <h1 style="font-size: 20px;">We couldn't process your payment</h1>
          <p>Your card was declined or your payment method needs updating. Your Lucy Labs plan will pause if this isn't resolved soon.</p>
          <p>Update your payment details from the receipt email Stripe sent you, or contact us and we'll help sort it out.</p>
          <p style="color: #9a8b83; font-size: 13px; margin-top: 32px;">support@astryks.com</p>
        </div>
      `,
    });
  } catch (err) {
    console.error("[email] Failed to send payment-failed email", err);
  }
}
