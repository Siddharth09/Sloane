import { Resend } from "resend";
import { PLANS, type PlanId } from "@/lib/plans";
import type { VideoCreditPack } from "@/lib/videoPaygo";

// No-ops (logs and returns) rather than throwing if RESEND_API_KEY isn't
// set - a missing email key should never break checkout/billing, which is
// the actual product. Add a real key to web/.env.local (and Vercel) to
// make this send for real; nothing here is live until that key exists.
const resend = process.env.RESEND_API_KEY ? new Resend(process.env.RESEND_API_KEY) : null;
// Real constraint found 2026-09-12: direct request was to send from
// support@astryks.com, but Resend rejects that outright (403,
// "The astryks.com domain is not verified") - only lucylabs.app and
// orcaaustralia.com are verified on this Resend account (checked directly
// via the /domains API, not assumed). Sending FROM an unverified domain
// isn't possible without adding DNS records for it first, so this keeps
// the already-working, already-verified lucylabs.app sender and instead
// sets REPLY_TO to support@astryks.com - replies still land in the
// requested inbox, just via a different mechanism than the From line.
const FROM = "Lucy Labs <billing@lucylabs.app>";
const REPLY_TO = "support@astryks.com";
const LOGO_URL = "https://lucylabs.app/mic-logo.png";

const usd = (cents: number) => `$${(cents / 100).toFixed(2)}`;

// Shared shell (2026-09-12) - logo + consistent warm styling + a single
// footer, so every customer-facing email looks like it came from the same
// real product instead of each function hand-rolling its own markup.
// Operator alerts (sendLowFalBalanceEmail) skip this - that one goes to
// the account owner, not a customer, and doesn't need the same tone.
function emailShell(heading: string, bodyHtml: string): string {
  return `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif; max-width: 480px; margin: 0 auto; padding: 32px 24px; color: #2b2320; background: #fffbf7;">
      <div style="text-align: center; margin-bottom: 20px;">
        <img src="${LOGO_URL}" alt="Lucy Labs" width="48" height="48" style="display: inline-block; border-radius: 12px;" />
      </div>
      <h1 style="font-size: 20px; margin: 0 0 16px; text-align: center; color: #2b2320;">${heading}</h1>
      ${bodyHtml}
      <p style="color: #9a8b83; font-size: 13px; margin-top: 32px; text-align: center;">
        Questions? Just reply to this email or reach us at support@astryks.com.
      </p>
    </div>
  `;
}

export async function sendAccessCodeEmail(email: string, accessToken: string, plan: PlanId, amountUsdCents: number) {
  if (!email) return;
  if (!resend) {
    console.warn("[email] RESEND_API_KEY not set - skipping access-code email to", email);
    return;
  }
  const planName = PLANS[plan].name;
  try {
    await resend.emails.send({
      from: FROM,
      replyTo: REPLY_TO,
      to: email,
      subject: `You're in! Your Lucy Labs ${planName} receipt + access code`,
      html: emailShell(
        `Welcome to Lucy Labs ${planName}!`,
        `
          <p>Thanks so much for subscribing - we're really glad to have you. Here's your receipt, and everything you need to get started.</p>
          <table style="width: 100%; border-collapse: collapse; margin: 20px 0; font-size: 14px;">
            <tr>
              <td style="padding: 6px 0; color: #9a8b83;">Plan</td>
              <td style="padding: 6px 0; text-align: right; font-weight: 600;">${planName}</td>
            </tr>
            <tr>
              <td style="padding: 6px 0; color: #9a8b83;">Charged today</td>
              <td style="padding: 6px 0; text-align: right; font-weight: 600;">${usd(amountUsdCents)}</td>
            </tr>
            <tr>
              <td style="padding: 6px 0; color: #9a8b83;">Billing</td>
              <td style="padding: 6px 0; text-align: right;">Renews monthly</td>
            </tr>
          </table>
          <p>Your access code - save it somewhere safe, it's the only thing you need to unlock your plan on lucylabs.app:</p>
          <p style="font-size: 24px; font-weight: bold; letter-spacing: 1px; background: #fdf6f0; padding: 16px; border-radius: 12px; text-align: center;">${accessToken}</p>
          <p>Paste it into the account box on the home page any time you're on a new device or browser.</p>
        `,
      ),
    });
  } catch (err) {
    // Never let an email failure break the billing flow that triggered it.
    console.error("[email] Failed to send access-code email", err);
  }
}

// Receipt for a one-time pay-as-you-go video-credit-pack purchase - the
// prepaid-credits flow (video_credits table) is a completely separate
// transaction from the plan subscription above, and previously sent no
// email at all. Triggered from the "payment" mode branch of
// checkout.session.completed, right after addVideoCredits.
export async function sendVideoCreditReceiptEmail(email: string, pack: VideoCreditPack, amountUsdCents: number) {
  if (!email) return;
  if (!resend) {
    console.warn("[email] RESEND_API_KEY not set - skipping video-credit receipt email to", email);
    return;
  }
  const label = pack.credits === 1 ? "1 video credit" : `${pack.credits} video credits`;
  try {
    await resend.emails.send({
      from: FROM,
      replyTo: REPLY_TO,
      to: email,
      subject: `Your receipt - ${label} added to Lucy Labs`,
      html: emailShell(
        "Thanks for your purchase!",
        `
          <p>Your video credits are in your account and ready to use right now.</p>
          <table style="width: 100%; border-collapse: collapse; margin: 20px 0; font-size: 14px;">
            <tr>
              <td style="padding: 6px 0; color: #9a8b83;">Purchased</td>
              <td style="padding: 6px 0; text-align: right; font-weight: 600;">${label}</td>
            </tr>
            <tr>
              <td style="padding: 6px 0; color: #9a8b83;">Total charged</td>
              <td style="padding: 6px 0; text-align: right; font-weight: 600;">${usd(amountUsdCents)}</td>
            </tr>
          </table>
          <p style="text-align: center; margin: 28px 0;">
            <a href="https://lucylabs.app/#pay-as-you-go" style="display: inline-block; background: #1a1a1a; color: #fff; text-decoration: none; padding: 14px 28px; border-radius: 999px; font-weight: 600;">Make a video</a>
          </p>
        `,
      ),
    });
  } catch (err) {
    console.error("[email] Failed to send video-credit receipt email", err);
  }
}

export async function sendMagicLinkEmail(email: string, link: string) {
  if (!email) return;
  if (!resend) {
    console.warn("[email] RESEND_API_KEY not set - skipping magic-link email to", email);
    return;
  }
  try {
    await resend.emails.send({
      from: FROM,
      replyTo: REPLY_TO,
      to: email,
      subject: "Sign in to Lucy Labs",
      html: emailShell(
        "Sign in to Lucy Labs",
        `
          <p>Click the button below to sign in. This link works once and expires in 15 minutes.</p>
          <p style="text-align: center; margin: 32px 0;">
            <a href="${link}" style="display: inline-block; background: #1a1a1a; color: #fff; text-decoration: none; padding: 14px 28px; border-radius: 999px; font-weight: 600;">Sign in</a>
          </p>
          <p style="color: #9a8b83; font-size: 13px;">If you didn't request this, you can safely ignore this email.</p>
        `,
      ),
    });
  } catch (err) {
    console.error("[email] Failed to send magic-link email", err);
  }
}

// Operator alert (2026-09-12), not a customer-facing email - sent to
// whoever ADMIN_ALERT_EMAIL is set to (the account owner), from the
// scheduled fal-balance check (see api/cron/check-fal-balance/route.ts).
// Real point of this: catch a draining fal.ai balance with enough runway
// to top up before it actually locks and starts failing real customer
// generations - see fal.ts's balance-guard comment for the full picture.
// Deliberately skips emailShell/logo - this is an internal alert, not a
// customer-facing message, so it doesn't need the same warm tone.
export async function sendLowFalBalanceEmail(balanceUsd: number) {
  const to = process.env.ADMIN_ALERT_EMAIL;
  if (!to || !resend) {
    if (!resend) console.warn("[email] RESEND_API_KEY not set - skipping low-fal-balance alert");
    else console.warn("[email] ADMIN_ALERT_EMAIL not set - skipping low-fal-balance alert");
    return;
  }
  try {
    await resend.emails.send({
      from: FROM,
      replyTo: REPLY_TO,
      to,
      subject: `Lucy Labs — fal.ai balance is low ($${balanceUsd.toFixed(2)})`,
      html: `
        <div style="font-family: sans-serif; max-width: 480px; margin: 0 auto; padding: 24px;">
          <h1 style="font-size: 20px;">fal.ai balance is getting low</h1>
          <p>Current balance: <strong>$${balanceUsd.toFixed(2)}</strong>. Video generation on lucylabs.app draws from this prepaid balance - once it runs out, real customer generations will fail.</p>
          <p style="text-align: center; margin: 32px 0;">
            <a href="https://fal.ai/dashboard/billing" style="display: inline-block; background: #1a1a1a; color: #fff; text-decoration: none; padding: 14px 28px; border-radius: 999px; font-weight: 600;">Top up on fal.ai</a>
          </p>
          <p style="color: #9a8b83; font-size: 13px;">A real-time guard is already in place to decline new generations gracefully (no charge) rather than let them fail mid-generation once the balance is critically low - but topping up before then keeps things running smoothly for real customers.</p>
        </div>
      `,
    });
  } catch (err) {
    console.error("[email] Failed to send low-fal-balance alert", err);
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
      replyTo: REPLY_TO,
      to: email,
      subject: "Lucy Labs — there was a problem with your payment",
      html: emailShell(
        "We couldn't process your payment",
        `
          <p>Your card was declined or your payment method needs updating. Your Lucy Labs plan will pause if this isn't resolved soon.</p>
          <p>Update your payment details from the receipt email Stripe sent you, or just reply to this email and we'll help sort it out.</p>
        `,
      ),
    });
  } catch (err) {
    console.error("[email] Failed to send payment-failed email", err);
  }
}
