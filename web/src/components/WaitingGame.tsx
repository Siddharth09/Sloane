// Shown while a generation job is in flight. Cold starts on the Serverless
// endpoint (see STATUS.md "Serverless migration") mean a wait of up to a
// few minutes is now a normal part of using the site, not a rare edge case.
// Deliberately NOT an embedded game anymore (an earlier version inline-
// embedded beckythebat.com in an iframe) - a full interactive game pulled
// too much focus during the core paid interaction and diluted the brand
// with an unrelated product. Just a friendly apology plus an optional,
// clearly-secondary link out for anyone who wants it.
export function WaitingGame() {
  return (
    <div className="rounded-2xl border border-dashed border-border bg-white/60 p-4 text-center">
      <p className="text-xs leading-relaxed text-muted">
        Sorry for the wait — we&apos;re just starting out, so generation can take a little while. We&apos;re
        working on making it faster.
      </p>
      <a
        href="https://beckythebat.com/play.html"
        target="_blank"
        rel="noopener noreferrer"
        className="mt-2 inline-block text-xs font-semibold text-coral-dark underline"
      >
        Feeling patient? Play a quick game from our team while you wait →
      </a>
    </div>
  );
}
