"use client";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useAccessToken } from "@/lib/useAccessToken";
import { SiteHeader } from "@/components/SiteHeader";
import { PLANS, VIDEO_CREDIT_COSTS, type PlanId } from "@/lib/plans";

// Talking-head/cinematic equivalents shown per plan are derived from the
// same ratios used for real vendor billing (VIDEO_CREDIT_COSTS in
// lib/plans.ts) so this display can never drift out of sync with the
// numbers actually enforced server-side once video ships.
function videoCreditsBlurb(credits: number): string | null {
  if (credits <= 0) return null;
  const talkSeconds = Math.round(credits * VIDEO_CREDIT_COSTS.talkingHeadSecondsPerCredit);
  const cineSeconds = Math.round(credits * VIDEO_CREDIT_COSTS.cinematicSecondsPerCredit);
  return `${credits} video credits/month (≈${talkSeconds}s talking-head, or ≈${cineSeconds}s cinematic)`;
}

const VIDEO_NOTE =
  "Honest heads-up: video is being wired up now, not live in your account yet - see the home page for real tests of all three modes (talking head via Kling, cinematic via Veo, ads via Seedance with your own reusable AI actor), a genuine feature, not a lesser self-hosted substitute. Credits above are reserved for the moment it ships. Your photo/video/reference audio will be sent to those third-party AI vendors for processing (not fully self-hosted like audio is today) - we'll disclose that clearly in the product before you use it.";

const PLAN_CARDS: { id: PlanId; blurb: string; wash: string; accent: string }[] = [
  { id: "free", blurb: "Try it out", wash: "bg-surface", accent: "text-muted" },
  { id: "starter", blurb: "For occasional use", wash: "bg-blue-wash/90", accent: "text-blue" },
  { id: "plus", blurb: "For regular use", wash: "bg-pink-wash/90", accent: "text-pink" },
  { id: "video", blurb: "Audio + video credits", wash: "bg-purple-wash/90", accent: "text-purple" },
];

function CheckoutSuccess() {
  const params = useSearchParams();
  const sessionId = params.get("session_id");
  const canceled = params.get("canceled");
  const { setToken } = useAccessToken();
  const [revealedToken, setRevealedToken] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);

  useEffect(() => {
    if (!sessionId) return;
    let attempts = 0;
    setChecking(true);
    const poll = async () => {
      attempts += 1;
      const res = await fetch(`/api/billing/session?session_id=${encodeURIComponent(sessionId)}`);
      const data = await res.json();
      if (data.accessToken) {
        setRevealedToken(data.accessToken);
        setToken(data.accessToken);
        setChecking(false);
      } else if (attempts < 8) {
        setTimeout(poll, 1500);
      } else {
        setChecking(false);
      }
    };
    poll();
  }, [sessionId, setToken]);

  if (canceled) {
    return <p className="mx-auto max-w-md text-center text-sm text-muted">Checkout canceled - no charge was made.</p>;
  }
  if (!sessionId) return null;

  return (
    <div className="mx-auto max-w-md rounded-2xl border border-white/60 bg-surface/90 p-6 text-center text-sm shadow-soft backdrop-blur-xl">
      {revealedToken ? (
        <>
          <p className="font-semibold text-foreground">You&apos;re subscribed! Your access code:</p>
          <code className="mt-2 block rounded-lg bg-white px-4 py-2 text-xs break-all">{revealedToken}</code>
          <p className="mt-2 text-xs text-muted">
            Saved to this browser automatically. Keep a copy - you&apos;ll need it to sign in elsewhere.
          </p>
        </>
      ) : checking ? (
        <p className="text-muted">Confirming your subscription…</p>
      ) : (
        <p className="text-coral-dark">
          Payment succeeded but we couldn&apos;t fetch your access code yet - refresh this page in a moment.
        </p>
      )}
    </div>
  );
}

export default function BillingPage() {
  const [loadingPlan, setLoadingPlan] = useState<PlanId | null>(null);
  const [checkoutError, setCheckoutError] = useState<string | null>(null);

  async function subscribe(plan: PlanId) {
    setLoadingPlan(plan);
    setCheckoutError(null);
    try {
      const res = await fetch("/api/billing/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ plan }),
      });
      const data = await res.json();
      if (data.url) {
        // Intentional full-page navigation to Stripe's hosted checkout, not a React-managed value.
        // eslint-disable-next-line react-hooks/immutability
        window.location.href = data.url;
        return; // keep the loading state while the browser navigates away
      }
      setCheckoutError(data.error ?? "Checkout failed - please try again.");
    } catch {
      setCheckoutError("Couldn't reach the checkout server - please try again.");
    } finally {
      setLoadingPlan(null);
    }
  }

  return (
    <div className="min-h-screen px-6 py-16">
      <main className="mx-auto flex max-w-3xl flex-col gap-8">
        <SiteHeader
          title="Plans"
          subtitle="Straightforward character limits, no surprise caps."
          current="billing"
        />

        <Suspense>
          <CheckoutSuccess />
        </Suspense>

        {checkoutError && (
          <p className="mx-auto max-w-md rounded-2xl border border-white/60 bg-surface/90 px-6 py-3 text-center text-sm text-coral-dark shadow-soft backdrop-blur-xl">
            {checkoutError}
          </p>
        )}

        <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
          {PLAN_CARDS.map((p) => {
            const plan = PLANS[p.id];
            const price = plan.priceUsdCents === 0 ? "$0" : `$${(plan.priceUsdCents / 100).toFixed(0)}/mo`;
            const videoBlurb = videoCreditsBlurb(plan.videoCreditsPerMonth);
            const features = [
              `${plan.charactersPerMonth.toLocaleString()} characters of audio/month`,
              p.id === "free" ? "All 11 preset voices" : "Clone any voice from an upload",
              videoBlurb ?? "No video credits",
            ];
            return (
              <div
                key={p.id}
                className={`flex flex-col gap-4 rounded-[28px] border border-white/60 p-6 shadow-soft backdrop-blur-xl ${p.wash}`}
              >
                <div>
                  <h2 className="text-lg font-extrabold tracking-tight">{plan.name}</h2>
                  <p className="text-sm text-muted">{p.blurb}</p>
                </div>
                <p className={`text-3xl font-extrabold ${p.accent}`}>{price}</p>
                <ul className="flex flex-1 flex-col gap-2 text-sm text-foreground">
                  {features.map((f) => (
                    <li key={f} className="flex items-start gap-2">
                      <span className={p.accent}>✓</span> {f}
                    </li>
                  ))}
                </ul>
                {videoBlurb && (
                  <p className="rounded-2xl bg-white/60 p-3 text-xs leading-relaxed text-muted">{VIDEO_NOTE}</p>
                )}
                {p.id === "free" ? (
                  <span className="rounded-full border border-border py-2.5 text-center text-sm font-bold text-muted">
                    Current default
                  </span>
                ) : (
                  <button
                    className="shadow-soft rounded-full bg-foreground py-2.5 text-sm font-bold text-white transition hover:brightness-110 disabled:opacity-50"
                    disabled={loadingPlan !== null}
                    onClick={() => subscribe(p.id)}
                  >
                    {loadingPlan === p.id ? "Redirecting…" : "Subscribe"}
                  </button>
                )}
              </div>
            );
          })}
        </div>

        <p className="text-center text-xs text-muted">
          Already subscribed?{" "}
          <a href="/account" className="font-semibold text-coral-dark underline">
            Manage your plan or cancel from your account
          </a>
          , or contact{" "}
          <a href="mailto:support@astryks.com" className="underline">
            support@astryks.com
          </a>
          .
        </p>
      </main>
    </div>
  );
}
