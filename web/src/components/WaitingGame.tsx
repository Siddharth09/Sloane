// Shown while a generation job is in flight. Cold starts on the Serverless
// endpoint (see STATUS.md "Serverless migration") mean a wait of 20-60+
// seconds is now a normal part of using the site, not a rare edge case -
// this gives people something to do instead of staring at a spinner.
// beckythebat.com/play.html is our own game (Astryks Group owns both Lucy
// Labs and Becky the Bat), so there's no third-party permission/licensing
// concern in embedding it.
export function WaitingGame() {
  return (
    <div className="rounded-2xl border border-dashed border-border bg-white/60 p-4">
      <p className="text-xs leading-relaxed text-muted">
        We&apos;re just starting out, so generation can take a little while — we&apos;re working on making it
        faster. In the meantime, here&apos;s a quick game made by our team at Astryks if you&apos;d like
        something to do while you wait.
      </p>
      <iframe
        src="https://beckythebat.com/play.html"
        title="Becky the Bat"
        className="mt-3 h-[220px] w-full rounded-xl border border-border"
        loading="lazy"
      />
    </div>
  );
}
