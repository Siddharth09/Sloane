import { neon } from "@neondatabase/serverless";
import { randomBytes } from "crypto";
import { PLANS, type PlanId } from "./plans";

// POSTGRES_URL is what Vercel's Postgres (Neon-backed) integration injects
// automatically once the database is linked to this project.
const sql = neon(process.env.POSTGRES_URL!);

export type Subscriber = {
  id: string;
  email: string;
  stripe_customer_id: string;
  stripe_subscription_id: string | null;
  plan: PlanId;
  status: "active" | "canceled" | "past_due";
  access_token: string;
  period_start: string;
  period_end: string;
  characters_used: number;
  video_seconds_used: number;
};

export async function initSchema() {
  await sql`
    CREATE TABLE IF NOT EXISTS subscribers (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      email TEXT NOT NULL,
      stripe_customer_id TEXT UNIQUE NOT NULL,
      stripe_subscription_id TEXT,
      plan TEXT NOT NULL DEFAULT 'free',
      status TEXT NOT NULL DEFAULT 'active',
      access_token TEXT UNIQUE NOT NULL,
      period_start TIMESTAMPTZ NOT NULL DEFAULT now(),
      period_end TIMESTAMPTZ NOT NULL DEFAULT (now() + interval '30 days'),
      characters_used INTEGER NOT NULL DEFAULT 0,
      video_seconds_used INTEGER NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `;
}

function generateAccessToken(): string {
  // Readable-ish, not guessable - e.g. "lucy_9f2a7c1e4b8d6053a1f9c2e7b4d80a3f"
  return `lucy_${randomBytes(16).toString("hex")}`;
}

export async function upsertSubscriberForCheckout(params: {
  email: string;
  stripeCustomerId: string;
  stripeSubscriptionId: string;
  plan: PlanId;
  periodStart: Date;
  periodEnd: Date;
}): Promise<string> {
  const existing = await sql`
    SELECT access_token FROM subscribers WHERE stripe_customer_id = ${params.stripeCustomerId}
  `;
  const accessToken = existing[0]?.access_token ?? generateAccessToken();

  await sql`
    INSERT INTO subscribers (email, stripe_customer_id, stripe_subscription_id, plan, status, access_token, period_start, period_end, characters_used, video_seconds_used)
    VALUES (${params.email}, ${params.stripeCustomerId}, ${params.stripeSubscriptionId}, ${params.plan}, 'active', ${accessToken}, ${params.periodStart.toISOString()}, ${params.periodEnd.toISOString()}, 0, 0)
    ON CONFLICT (stripe_customer_id) DO UPDATE SET
      plan = EXCLUDED.plan,
      status = 'active',
      stripe_subscription_id = EXCLUDED.stripe_subscription_id,
      period_start = EXCLUDED.period_start,
      period_end = EXCLUDED.period_end,
      characters_used = 0,
      video_seconds_used = 0
  `;
  return accessToken;
}

export async function setSubscriberStatus(stripeCustomerId: string, status: Subscriber["status"]) {
  await sql`UPDATE subscribers SET status = ${status} WHERE stripe_customer_id = ${stripeCustomerId}`;
}

export async function getSubscriberByToken(token: string): Promise<Subscriber | null> {
  const rows = await sql`SELECT * FROM subscribers WHERE access_token = ${token}`;
  return (rows[0] as Subscriber) ?? null;
}

export async function getSubscriberByCustomerId(stripeCustomerId: string): Promise<Subscriber | null> {
  const rows = await sql`SELECT * FROM subscribers WHERE stripe_customer_id = ${stripeCustomerId}`;
  return (rows[0] as Subscriber) ?? null;
}

export async function incrementUsage(token: string, characters: number, videoSeconds: number) {
  await sql`
    UPDATE subscribers
    SET characters_used = characters_used + ${characters},
        video_seconds_used = video_seconds_used + ${videoSeconds}
    WHERE access_token = ${token}
  `;
}

/**
 * Returns null if the request is allowed, or a user-facing error message if
 * the subscriber is over their plan's cap. Free-tier (no token) requests
 * are checked against an anonymous per-IP-less character count is NOT
 * tracked server-side pre-launch - see api/generate-preset/route.ts for how
 * the free tier is currently handled (client-side soft limit only, until
 * real anonymous-usage tracking is worth building).
 */
export function checkQuota(sub: Subscriber, additionalCharacters: number): string | null {
  const plan = PLANS[sub.plan];
  if (sub.status !== "active") {
    return "Your subscription isn't active - check your billing status.";
  }
  if (sub.characters_used + additionalCharacters > plan.charactersPerMonth) {
    return `This would put you over your ${plan.name} plan's ${plan.charactersPerMonth.toLocaleString()} character/month limit. Upgrade or wait for your next billing period.`;
  }
  return null;
}
