"use client";

import { useEffect, useState, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { useAccessToken } from "@/lib/useAccessToken";

type Generation = {
  id: string;
  kind: "preset" | "clone";
  voiceLabel: string | null;
  textPreview: string;
  audioUrl: string;
  createdAt: string;
  expiresAt: string;
};

type AccountData = {
  email: string;
  accessToken: string | null;
  subscriber: { plan: string; status: string; charactersUsed: number; periodEnd: string } | null;
  generations: Generation[];
};

const ERROR_MESSAGES: Record<string, string> = {
  missing_token: "That link is missing its code — try requesting a new one.",
  expired_link: "That sign-in link expired or was already used — request a new one below.",
  google_state_mismatch: "That Google sign-in link expired — please try again.",
  google_not_configured: "Google sign-in isn't set up yet — use email instead.",
  google_failed: "Google sign-in didn't work — please try again or use email.",
};

function daysLeft(expiresAt: string): number {
  return Math.max(0, Math.ceil((new Date(expiresAt).getTime() - Date.now()) / (1000 * 60 * 60 * 24)));
}

function AccountPageInner() {
  const { setToken } = useAccessToken();
  const searchParams = useSearchParams();
  const [data, setData] = useState<AccountData | null>(null);
  const [checkedAuth, setCheckedAuth] = useState(false);
  const [email, setEmail] = useState("");
  const [linkSent, setLinkSent] = useState(false);
  const [error, setError] = useState<string | null>(
    ERROR_MESSAGES[searchParams.get("error") ?? ""] ?? null
  );
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    fetch("/api/account")
      .then((r) => (r.ok ? r.json() : null))
      .then((json: AccountData | null) => {
        setData(json);
        if (json?.accessToken) setToken(json.accessToken);
      })
      .finally(() => setCheckedAuth(true));
    // Only run once on mount - setToken identity isn't stable across renders
    // and re-fetching on every render would be wasteful.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function requestLink(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/auth/request-link", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Couldn't send that link");
      setLinkSent(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't send that link");
    } finally {
      setBusy(false);
    }
  }

  async function openBillingPortal() {
    setBusy(true);
    try {
      const res = await fetch("/api/billing/portal", { method: "POST" });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Couldn't open billing portal");
      window.location.href = json.url;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't open billing portal");
      setBusy(false);
    }
  }

  async function signOut() {
    setBusy(true);
    await fetch("/api/auth/logout", { method: "POST" });
    setToken(null);
    window.location.reload();
  }

  if (!checkedAuth) {
    return <main className="mx-auto max-w-md px-6 py-24 text-center text-muted">Loading…</main>;
  }

  if (!data) {
    return (
      <main className="mx-auto max-w-md px-6 py-16">
        <h1 className="mb-2 text-2xl font-bold text-foreground">Sign in</h1>
        <p className="mb-6 text-sm text-muted">
          No passwords here — we&apos;ll email you a link, or you can continue with Google.
        </p>

        {error && <p className="mb-4 rounded-xl bg-coral/10 px-4 py-3 text-sm text-coral-dark">{error}</p>}

        {linkSent ? (
          <p className="rounded-xl border border-border bg-surface px-4 py-3 text-sm text-foreground">
            Check your inbox — we sent a sign-in link to <strong>{email}</strong>. It works once and expires
            in 15 minutes.
          </p>
        ) : (
          <form onSubmit={requestLink} className="flex flex-col gap-3">
            <input
              type="email"
              required
              placeholder="you@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="rounded-full border border-border bg-white px-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-coral"
            />
            <button
              type="submit"
              disabled={busy}
              className="shadow-soft rounded-full bg-coral px-4 py-2 text-sm font-bold text-white transition hover:brightness-105 disabled:opacity-50"
            >
              Email me a sign-in link
            </button>
          </form>
        )}

        <div className="my-6 flex items-center gap-3 text-xs text-muted">
          <div className="h-px flex-1 bg-border" />
          or
          <div className="h-px flex-1 bg-border" />
        </div>

        <a
          href="/api/auth/google/start"
          className="flex w-full items-center justify-center gap-2 rounded-full border border-border bg-white px-4 py-2 text-sm font-semibold text-foreground shadow-soft transition hover:brightness-95"
        >
          Continue with Google
        </a>

        <a href="/billing" className="mt-8 block text-center text-xs font-semibold text-coral-dark underline">
          See plans →
        </a>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-md px-6 py-16">
      <h1 className="mb-1 text-2xl font-bold text-foreground">Your account</h1>
      <p className="mb-6 text-sm text-muted">{data.email}</p>

      <div className="mb-6 rounded-2xl border border-border bg-surface px-6 py-4 text-sm">
        {data.subscriber ? (
          <>
            <p className="font-semibold text-foreground">{data.subscriber.plan} plan · {data.subscriber.status}</p>
            <p className="mt-1 text-muted">
              {data.subscriber.charactersUsed.toLocaleString()} characters used this period
            </p>
            <button
              onClick={openBillingPortal}
              disabled={busy}
              className="shadow-soft mt-4 rounded-full bg-coral px-4 py-2 text-xs font-bold text-white transition hover:brightness-105 disabled:opacity-50"
            >
              Manage billing / cancel
            </button>
          </>
        ) : (
          <>
            <p className="text-muted">You&apos;re on the free tier — no active plan yet.</p>
            <a href="/billing" className="mt-2 inline-block text-xs font-semibold text-coral-dark underline">
              See plans →
            </a>
          </>
        )}
      </div>

      <h2 className="mb-3 text-sm font-bold text-foreground">Recent generations</h2>
      {data.generations.length === 0 ? (
        <p className="text-sm text-muted">
          Nothing yet — anything you generate while signed in will show up here for a couple of weeks.
        </p>
      ) : (
        <ul className="flex flex-col gap-3">
          {data.generations.map((g) => (
            <li key={g.id} className="rounded-xl border border-border bg-white px-4 py-3 text-sm">
              <p className="truncate text-foreground">
                {g.voiceLabel ? `${g.voiceLabel} — ` : ""}
                {g.textPreview}
              </p>
              <audio controls src={g.audioUrl} className="mt-2 w-full" />
              <div className="mt-1 flex items-center justify-between text-xs text-muted">
                <a href={g.audioUrl} download className="font-semibold text-coral-dark underline">
                  Download
                </a>
                <span>expires in {daysLeft(g.expiresAt)}d</span>
              </div>
            </li>
          ))}
        </ul>
      )}

      <button onClick={signOut} disabled={busy} className="mt-8 text-xs text-muted underline">
        Sign out
      </button>
    </main>
  );
}

export default function AccountPage() {
  return (
    <Suspense fallback={<main className="mx-auto max-w-md px-6 py-24 text-center text-muted">Loading…</main>}>
      <AccountPageInner />
    </Suspense>
  );
}
