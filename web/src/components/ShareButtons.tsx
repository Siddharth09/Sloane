"use client";

import { useState } from "react";

/**
 * Instagram has no direct web share URL (unlike Facebook/WhatsApp) - the
 * only reliable cross-platform way to reach it is the native Web Share API,
 * which hands off to whatever's installed (Instagram included) on supporting
 * browsers. We offer that as the primary button, with explicit WhatsApp/
 * Facebook web links as a fallback for desktop browsers that don't support
 * navigator.share.
 */
export function ShareButtons({ url, text }: { url: string; text: string }) {
  const [copied, setCopied] = useState(false);
  const canNativeShare = typeof navigator !== "undefined" && !!navigator.share;

  async function handleNativeShare() {
    try {
      await navigator.share({ title: "Lucy", text, url });
    } catch {
      // user cancelled - nothing to do
    }
  }

  async function handleCopy() {
    await navigator.clipboard.writeText(url);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  const whatsappHref = `https://wa.me/?text=${encodeURIComponent(`${text} ${url}`)}`;
  const facebookHref = `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(url)}`;

  return (
    <div className="mt-3 flex flex-wrap items-center gap-2">
      {canNativeShare && (
        <button
          onClick={handleNativeShare}
          className="rounded-full bg-butter px-4 py-2 text-xs font-semibold text-white"
        >
          Share…
        </button>
      )}
      <a
        href={whatsappHref}
        target="_blank"
        rel="noopener noreferrer"
        className="rounded-full border border-border bg-white px-4 py-2 text-xs font-semibold text-foreground hover:bg-white/70"
      >
        WhatsApp
      </a>
      <a
        href={facebookHref}
        target="_blank"
        rel="noopener noreferrer"
        className="rounded-full border border-border bg-white px-4 py-2 text-xs font-semibold text-foreground hover:bg-white/70"
      >
        Facebook
      </a>
      <button
        onClick={handleCopy}
        className="rounded-full border border-border bg-white px-4 py-2 text-xs font-semibold text-foreground hover:bg-white/70"
        title="Instagram doesn't offer a direct web-share link - copy and paste into the app"
      >
        {copied ? "Copied!" : "Copy link (for Instagram)"}
      </button>
    </div>
  );
}
