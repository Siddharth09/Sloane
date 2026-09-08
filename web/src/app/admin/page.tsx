"use client";

import { useEffect, useState } from "react";

const PASSWORD_KEY = "lucy_admin_password";
const POLL_INTERVAL_MS = 5000;

type Stats = {
  activeNow: number;
  visitsToday: number;
  activePaths: { path: string; visitors: number }[];
};

export default function AdminDashboard() {
  const [password, setPassword] = useState<string | null>(null);
  const [passwordInput, setPasswordInput] = useState("");
  const [stats, setStats] = useState<Stats | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  useEffect(() => {
    const saved = sessionStorage.getItem(PASSWORD_KEY);
    if (saved) setPassword(saved);
  }, []);

  useEffect(() => {
    if (!password) return;

    let cancelled = false;
    async function poll() {
      try {
        const res = await fetch("/api/admin/stats", { headers: { "x-admin-password": password! } });
        const data = await res.json();
        if (cancelled) return;
        if (!res.ok) {
          setError(data.error ?? "Failed to load stats");
          if (res.status === 401) {
            sessionStorage.removeItem(PASSWORD_KEY);
            setPassword(null);
          }
          return;
        }
        setStats(data);
        setError(null);
        setLastUpdated(new Date());
      } catch {
        if (!cancelled) setError("Couldn't reach the server.");
      }
    }

    poll();
    const interval = setInterval(poll, POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [password]);

  if (!password) {
    return (
      <div className="min-h-screen flex items-center justify-center px-6">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            sessionStorage.setItem(PASSWORD_KEY, passwordInput);
            setPassword(passwordInput);
          }}
          className="w-full max-w-sm rounded-[28px] border border-white/60 bg-surface/90 p-8 shadow-soft-lg backdrop-blur-xl"
        >
          <h1 className="text-lg font-extrabold text-foreground">Admin dashboard</h1>
          <p className="mt-1 text-sm text-muted">Enter the dashboard password to continue.</p>
          <input
            type="password"
            autoFocus
            value={passwordInput}
            onChange={(e) => setPasswordInput(e.target.value)}
            className="mt-4 w-full rounded-full border border-border bg-white px-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-coral"
            placeholder="Password"
          />
          <button
            type="submit"
            className="shadow-soft mt-3 w-full rounded-full bg-coral py-2.5 text-sm font-bold text-white transition hover:brightness-105"
          >
            Enter
          </button>
        </form>
      </div>
    );
  }

  return (
    <div className="min-h-screen px-6 py-16">
      <main className="mx-auto flex max-w-2xl flex-col gap-6">
        <div>
          <h1 className="text-2xl font-extrabold tracking-tight text-foreground">Live visitors</h1>
          <p className="mt-1 text-sm text-muted">
            Updates every 5 seconds. &quot;Active now&quot; counts distinct visitors seen in the last minute.
          </p>
        </div>

        {error && <p className="text-sm text-coral-dark">{error}</p>}

        <div className="grid grid-cols-2 gap-4">
          <div className="rounded-[28px] border border-white/60 bg-surface/90 p-7 text-center shadow-soft-lg backdrop-blur-xl">
            <p className="text-5xl font-extrabold text-foreground">{stats?.activeNow ?? "—"}</p>
            <p className="mt-1 text-sm text-muted">active now</p>
          </div>
          <div className="rounded-[28px] border border-white/60 bg-surface/90 p-7 text-center shadow-soft-lg backdrop-blur-xl">
            <p className="text-5xl font-extrabold text-foreground">{stats?.visitsToday ?? "—"}</p>
            <p className="mt-1 text-sm text-muted">visitors today</p>
          </div>
        </div>

        <div className="rounded-[28px] border border-white/60 bg-surface/90 p-7 shadow-soft-lg backdrop-blur-xl">
          <h2 className="text-sm font-bold text-foreground">Where they are right now</h2>
          {stats && stats.activePaths.length > 0 ? (
            <ul className="mt-3 flex flex-col gap-2">
              {stats.activePaths.map((p) => (
                <li key={p.path} className="flex items-center justify-between text-sm">
                  <span className="text-foreground">{p.path}</span>
                  <span className="text-muted">{p.visitors}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-2 text-sm text-muted">No one active right now.</p>
          )}
        </div>

        {lastUpdated && (
          <p className="text-center text-xs text-muted">Last updated {lastUpdated.toLocaleTimeString()}</p>
        )}
      </main>
    </div>
  );
}
