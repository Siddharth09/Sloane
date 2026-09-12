"use client";

import { useEffect, useState } from "react";
import { useAccessToken } from "@/lib/useAccessToken";

type Status = {
  plan: string;
  status: string;
  charactersUsed: number;
  charactersLimit: number;
  videoCreditsUsed: number;
  videoCreditsLimit: number;
};

export function AccountWidget() {
  const { token, setToken, loaded } = useAccessToken();
  const [status, setStatus] = useState<Status | null>(null);
  const [codeInput, setCodeInput] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!token) {
      setStatus(null);
      return;
    }
    fetch(`/api/billing/status?token=${encodeURIComponent(token)}`)
      .then((r) => r.json())
      .then((data) => {
        if (data.error) {
          setError(data.error);
          setStatus(null);
        } else {
          setStatus(data);
          setError(null);
        }
      })
      .catch(() => setError("Couldn't reach the account server."));
  }, [token]);

  if (!loaded) return null;

  if (!token) {
    return (
      <div className="mx-auto flex max-w-md flex-col items-center gap-2 rounded-2xl border border-white/60 bg-surface/90 px-6 py-4 text-center text-sm shadow-soft backdrop-blur-xl">
        <p className="text-muted">
          Free tier: {(10_000).toLocaleString()} characters. Have an access code from checkout?
        </p>
        <div className="flex w-full gap-2">
          <input
            className="flex-1 rounded-full border border-border bg-white px-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-coral"
            placeholder="LUCY-XXXX-XXXX-XXXX-XXXX"
            value={codeInput}
            onChange={(e) => setCodeInput(e.target.value)}
          />
          <button
            className="shadow-soft rounded-full bg-coral px-4 py-2 text-sm font-bold text-white transition hover:brightness-105"
            onClick={() => codeInput && setToken(codeInput.trim())}
          >
            Save
          </button>
        </div>
        <div className="flex gap-4">
          <a href="/billing" className="text-xs font-semibold text-coral-dark underline">
            See plans →
          </a>
          <a href="/account" className="text-xs font-semibold text-coral-dark underline">
            Sign in →
          </a>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto flex max-w-md flex-col items-center gap-1 rounded-2xl border border-white/60 bg-surface/90 px-6 py-4 text-center text-sm shadow-soft backdrop-blur-xl">
      {error ? (
        <>
          <p className="text-coral-dark">{error}</p>
          <button className="text-xs text-muted underline" onClick={() => setToken(null)}>
            Remove this code
          </button>
        </>
      ) : status ? (
        <>
          <p className="font-semibold text-foreground">{status.plan} plan</p>
          <p className="text-muted">
            {status.charactersUsed.toLocaleString()} / {status.charactersLimit.toLocaleString()} characters used this period
            {status.videoCreditsLimit > 0 && (
              <> · {status.videoCreditsUsed}/{status.videoCreditsLimit} video credits</>
            )}
          </p>
          <a href="/billing" className="text-xs font-semibold text-coral-dark underline">
            Manage plan →
          </a>
        </>
      ) : (
        <p className="text-muted">Checking your account…</p>
      )}
    </div>
  );
}
