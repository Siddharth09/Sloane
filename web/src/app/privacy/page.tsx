import { SiteHeader } from "@/components/SiteHeader";
import { getGenerationRetentionDays, initSchema } from "@/lib/db";

export const metadata = {
  title: "Privacy Policy — Lucy Labs",
};

// Reads a live, admin-tunable setting (generation retention days) - without
// this the page would statically bake in whatever that value was at build
// time and drift out of sync after the next /admin change, same mistake
// this rewrite exists to fix.
export const dynamic = "force-dynamic";

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-2">
      <h2 className="text-lg font-extrabold tracking-tight text-foreground">{title}</h2>
      <div className="flex flex-col gap-2 text-sm leading-relaxed text-muted">{children}</div>
    </section>
  );
}

export default async function PrivacyPage() {
  await initSchema();
  const retentionDays = await getGenerationRetentionDays();
  return (
    <div className="min-h-screen px-6 py-16">
      <main className="mx-auto flex max-w-2xl flex-col gap-8">
        <SiteHeader title="Privacy Policy" subtitle="Last updated 2026-09-11 (part of the Astryks Group)" />

        <div className="flex flex-col gap-6 rounded-[28px] border border-white/60 bg-surface/90 p-8 shadow-soft backdrop-blur-xl">
          <Section title="What this covers">
            <p>
              This page describes what Lucy Labs (&quot;we,&quot; &quot;us&quot;), part of the Astryks
              Group, collects and does with your data when you use lucylabs.app and the Lucy Labs
              mobile app. It&apos;s written in plain language and reflects what we actually do — not
              boilerplate we haven&apos;t checked against the real product.
            </p>
          </Section>

          <Section title="Audio — narration and voice cloning">
            <p>
              Text you type for narration, any voice recording you upload to clone, and the audio we
              generate are processed entirely on our own infrastructure — GPU servers we control,
              rented from RunPod and Modal. We do not send this data to any third-party AI vendor.
              Generated audio is not stored on our servers — it&apos;s returned directly to your device
              for playback and download, so save anything you want to keep. Uploaded voice samples are
              used only to generate your requested audio and are not retained afterward or used to
              train models for other users.
            </p>
          </Section>

          <Section title="Video — a materially different arrangement from audio">
            <p>
              Video generation is a live, paid feature (talking-head avatars, cinematic scenes, and
              our pay-as-you-go engine picker). It works differently from audio-only narration/voice
              cloning above, and we want to be direct about that difference rather than bury it:
            </p>
            <p>
              Any photo, video, or reference audio you upload for a video generation — along with the
              text/audio we generate on your behalf to drive it — is sent to third-party AI model
              providers to actually produce the video. Depending on which engine you (or the feature)
              select, that means one or more of: <strong>Kling</strong> (Kuaishou), <strong>Veo</strong>{" "}
              (Google), and <strong>Seedance</strong> (ByteDance) — all reached through{" "}
              <strong>fal.ai</strong>, the inference platform that hosts and routes to these models on
              our behalf. fal.ai also runs a small audio/video-merge utility we use when a video needs
              your uploaded or generated audio track attached to it.
            </p>
            <p>
              Practically, this means: your uploaded photo/video/audio and the resulting generated
              video are transmitted to and briefly stored by fal.ai and whichever model provider
              actually renders it, are subject to those companies&apos; own privacy and retention
              policies (not just ours), and the finished video is returned to you via a URL hosted on
              fal.ai&apos;s infrastructure rather than ours. We do not control how long fal.ai or its
              model providers retain that content on their own systems, and we have asked fal.ai
              directly about aspects of this we could not confirm from public documentation alone. We
              never send your data to these providers for anything other than fulfilling the specific
              video you asked for — not for their model training, and not for ours.
            </p>
          </Section>

          <Section title="Account &amp; billing">
            <p>
              We don&apos;t use passwords or traditional accounts. Instead, a subscription is tied to an
              access code generated after checkout. Payment is processed by Stripe — we do not see or
              store your card details ourselves. We store your email, subscription status, and usage
              (characters/video credits used this billing period) to enforce plan limits and manage
              your subscription. Your email address and subscription plan name are also sent to Resend,
              the service we use to actually deliver your access-code, sign-in, and payment-failed
              emails.
            </p>
          </Section>

          <Section title="Third-party service providers, at a glance">
            <p>
              Summarizing the companies above in one place, and what each one actually receives from
              us:
            </p>
            <ul className="list-disc pl-5">
              <li>
                <strong>fal.ai, Kling, Veo, Seedance</strong> — your uploaded photo/video/audio and
                generated video, only when you use a video feature (see &quot;Video&quot; above).
              </li>
              <li>
                <strong>Stripe</strong> — payment details and billing email, to process your
                subscription or credit purchase. We never see your raw card number.
              </li>
              <li>
                <strong>Resend</strong> — your email address and plan name, to deliver transactional
                emails (access codes, sign-in links, payment-failure notices).
              </li>
              <li>
                <strong>RunPod, Modal</strong> — audio you submit for narration/voice cloning, and
                photo/video/audio for video generation before it&apos;s forwarded to the vendors above.
                These are GPU servers we rent and run our own code on, not third-party AI services
                that process data on their own terms.
              </li>
              <li>
                <strong>Vercel</strong> — hosts the site and, for signed-in users, your generation
                history (see &quot;Data retention &amp; deletion&quot; below).
              </li>
            </ul>
          </Section>

          <Section title="Basic visit counts">
            <p>
              We keep a lightweight, anonymous record of page visits (a randomly generated id stored
              in your browser, the page path, and a timestamp) so we can see roughly how much traffic
              the site is getting. We don&apos;t collect your IP address, device fingerprint, or any
              identifying information as part of this, and it isn&apos;t linked to your account or
              billing data.
            </p>
          </Section>

          <Section title="What we don't do">
            <ul className="list-disc pl-5">
              <li>We don&apos;t sell your data.</li>
              <li>We don&apos;t use your uploaded voice, photos, or video to train models — not for anyone else&apos;s benefit, and not for ours.</li>
              <li>We don&apos;t send audio-only narration/voice-cloning data to any third party — that stays entirely on infrastructure we control (see &quot;Audio&quot; above). Video generation is the one exception, disclosed plainly above, not buried here.</li>
            </ul>
          </Section>

          <Section title="Data retention &amp; deletion">
            <p>
              If you generate audio without signing in, nothing is stored on our servers — it exists
              only in your browser for that session. If you sign in, we keep a short history of your
              generations (currently {retentionDays} days) so you can play them back and re-download
              them from your account; anything older is automatically deleted. Videos are not stored on
              our own servers at any point — you get a direct link to the file as hosted by fal.ai, and
              signed-in users&apos; history keeps that link, not a copy of the video itself, for the same
              retention window. If you&apos;d like anything deleted sooner — your account, uploaded
              samples, or generated clips — email us and we&apos;ll take care of it. We can&apos;t force an
              early deletion on fal.ai&apos;s or a model provider&apos;s own systems, but we can and will ask
              on your behalf.
            </p>
          </Section>

          <Section title="Contact">
            <p>
              Questions about this policy or your data:{" "}
              <a href="mailto:support@astryks.com" className="underline">
                support@astryks.com
              </a>
              .
            </p>
          </Section>

          <p className="rounded-2xl bg-white/60 p-3 text-xs italic leading-relaxed text-muted">
            This policy describes our actual data practices as accurately as we can, but it has not
            been reviewed by a lawyer and should not be treated as a complete legal document — in
            particular, it doesn&apos;t yet address regional requirements (e.g. GDPR, CCPA) in detail.
            Get it reviewed before relying on it for compliance purposes.
          </p>
        </div>
      </main>
    </div>
  );
}
