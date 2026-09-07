export function Footer() {
  return (
    <footer className="mt-6 rounded-[28px] border border-white/60 bg-surface/90 px-8 py-8 text-center shadow-soft backdrop-blur-xl">
      <p className="text-sm font-bold text-foreground">Lucy Labs</p>
      <p className="mt-1 text-xs text-muted">Part of the Astryks Group</p>
      <p className="mt-3 text-xs text-muted">
        <a href="mailto:support@astryks.com" className="underline decoration-border hover:text-foreground">
          support@astryks.com
        </a>
      </p>
      <p className="mt-4 text-xs text-muted">
        © {new Date().getFullYear()} Astryks Group. All rights reserved.
      </p>
    </footer>
  );
}
