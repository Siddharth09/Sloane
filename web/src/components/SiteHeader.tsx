import Link from "next/link";
import { LogoMark } from "@/components/LogoMark";

type NavKey = "home" | "account" | "billing";

const NAV_LINKS: { key: NavKey; href: string; label: string }[] = [
  { key: "home", href: "/", label: "Generate" },
  { key: "account", href: "/account", label: "My account" },
  { key: "billing", href: "/billing", label: "Plans" },
];

// Shared header + nav for every page below the home page - without this,
// billing/privacy/account each grew their own one-off header and none of
// them linked anywhere else, so landing on any page but "/" was a dead end
// with no way back to generating or to the account page. One component
// keeps every page's "how do I get back to X" answer identical.
export function SiteHeader({
  title,
  subtitle,
  current,
  logoSize = 48,
}: {
  title: string;
  subtitle?: string;
  current?: NavKey;
  logoSize?: number;
}) {
  return (
    <div className="mx-auto flex flex-col items-center gap-3 rounded-[32px] border border-white/60 bg-surface/90 px-8 py-8 text-center shadow-soft-lg backdrop-blur-xl">
      <Link href="/" className="inline-flex">
        <LogoMark size={logoSize} />
      </Link>
      <h1 className="text-3xl font-extrabold tracking-tight text-foreground">{title}</h1>
      {subtitle && <p className="max-w-sm text-sm text-muted">{subtitle}</p>}
      <nav className="mt-2 flex flex-wrap items-center justify-center gap-2">
        {NAV_LINKS.map((link) => (
          <Link
            key={link.key}
            href={link.href}
            className={
              link.key === current
                ? "rounded-full bg-coral px-3.5 py-1.5 text-xs font-bold text-white shadow-soft"
                : "rounded-full border border-border bg-white/80 px-3.5 py-1.5 text-xs font-semibold text-foreground shadow-soft transition hover:bg-white"
            }
          >
            {link.label}
          </Link>
        ))}
      </nav>
    </div>
  );
}
