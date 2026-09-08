"use client";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useAccessToken } from "@/lib/useAccessToken";
import { LogoMark } from "@/components/LogoMark";
import type { PlanId } from "@/lib/plans";

const PLAN_CARDS: { id: PlanId; name: string; price: string; blurb: string; features: string[]; wash: string; accent: string }[] = [
  {
    id: "free",
    name: "Free",
    price: "$0",
    blurb: "Try it out",
    features: ["10,000 characters/month", "All preset voices"],
    wash: "bg-surface",
    accent: "text-muted",
  },
  {
    id: "plus",
    name: "Plus",
    price: "$3/mo",
    blurb: "For regular use",
    features: ["200,000 characters/month", "Clone any voice"],
    wash: "bg-pink-wash/90",
    accent: "text-pink",
  },
  {
    id: "pro",
    name: "Pro",
    price: "$9/mo",
    blurb: "For power users",
    features: ["1,500,000 characters/month", "Clone any voice"],
    wash: "bg-purple-wash/90",
    accent: "text-purple",
  },
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
          <p className="font-semibold text-foreground">You're subscribed! Your access code:</p>
          <code className="mt-2 block rounded-lg bg-white px-4 py-2 text-xs break-all">{revealedToken}</code>
          <p className="mt-2 text-xs text-muted">
            Saved to this browser automatically. Keep a copy - you'll need it to sign in elsewhere.
          </p>
        </>
      ) : checking ? (
        <p className="text-muted">Confirming your subscription…</p>
      ) : (
        <p className="text-coral-dark">
          Payment succeeded but we couldn't fetch your access code yet - refresh this page in a moment.
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
        <div className="mx-auto flex flex-col items-center gap-3 rounded-[32px] border border-white/60 bg-surface/90 px-8 py-8 text-center shadow-soft-lg backdrop-blur-xl">
          <LogoMark size={48} />
          <h1 className="text-3xl font-extrabold tracking-tight text-foreground">Plans</h1>
          <p className="max-w-sm text-sm text-muted">
            Straightforward character limits, no surprise caps.
          </p>
        </div>

        <Suspense>
          <CheckoutSuccess />
        </Suspense>

        {checkoutError && (
          <p className="mx-auto max-w-md rounded-2xl border border-white/60 bg-surface/90 px-6 py-3 text-center text-sm text-coral-dark shadow-soft backdrop-blur-xl">
            {checkoutError}
          </p>
        )}

        <div className="grid gap-6 sm:grid-cols-3">
          {PLAN_CARDS.map((p) => (
            <div
              key={p.id}
              className={`flex flex-col gap-4 rounded-[28px] border border-white/60 p-6 shadow-soft backdrop-blur-xl ${p.wash}`}
            >
              <div>
                <h2 className="text-lg font-extrabold tracking-tight">{p.name}</h2>
                <p className="text-sm text-muted">{p.blurb}</p>
              </div>
              <p className={`text-3xl font-extrabold ${p.accent}`}>{p.price}</p>
              <ul className="flex flex-1 flex-col gap-2 text-sm text-foreground">
                {p.features.map((f) => (
                  <li key={f} className="flex items-start gap-2">
                    <span className={p.accent}>✓</span> {f}
                  </li>
                ))}
              </ul>
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
          ))}
        </div>

        <p className="text-center text-xs text-muted">
          Cancel anytime from the receipt Stripe emails you, or contact{" "}
          <a href="mailto:support@astryks.com" className="underline">
            support@astryks.com
          </a>
          .
        </p>
      </main>
    </div>
  );
}
