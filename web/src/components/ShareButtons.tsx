"use client";

import { useState } from "react";

/**
 * Instagram has no direct web share URL (unlike Facebook/WhatsApp) - the
 * only reliable cross-platform way to reach it is the native Web Share API,
 * which hands off to whatever's installed (Instagram included) on supporting
 * browsers. We offer that as the primary button, with explicit WhatsApp/
 * Facebook web links as a fallback for desktop browsers that don't support
 * navigator.share.
 *
 * Generated audio no longer has a stable hosted URL to share (it comes back
 * as base64 straight from a RunPod Serverless job, never written to a
 * public path - see STATUS.md "Serverless migration") - pass `file` instead
 * of `url` for that case and this shares the actual clip via the Web Share
 * API's file support instead of a link. Link-based sharing (WhatsApp/
 * Facebook/copy-link) only makes sense for a real URL, so those are hidden
 * when sharing a file; if the browser can't share files either, this
 * renders nothing rather than a broken/misleading link.
 */
type ShareButtonsProps = { text: string } & ({ url: string; file?: undefined } | { file: File; url?: undefined });

export function ShareButtons({ text, url, file }: ShareButtonsProps) {
  const [copied, setCopied] = useState(false);

  if (file) {
    const canShareFile = typeof navigator !== "undefined" && !!navigator.share && !!navigator.canShare?.({ files: [file] });
    if (!canShareFile) return null;
    return (
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button
          onClick={() => navigator.share({ title: "Lucy", text, files: [file] }).catch(() => {})}
          className="rounded-full bg-butter px-4 py-2 text-xs font-semibold text-white"
        >
          Share…
        </button>
      </div>
    );
  }

  const canNativeShare = typeof navigator !== "undefined" && !!navigator.share;

  async function handleNativeShare() {
    try {
      await navigator.share({ title: "Lucy", text, url });
    } catch {
      // user cancelled - nothing to do
    }
  }

  async function handleCopy() {
    await navigator.clipboard.writeText(url!);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  const whatsappHref = `https://wa.me/?text=${encodeURIComponent(`${text} ${url}`)}`;
  const facebookHref = `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(url!)}`;

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
