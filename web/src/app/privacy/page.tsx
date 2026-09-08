import { LogoMark } from "@/components/LogoMark";

export const metadata = {
  title: "Privacy Policy — Lucy Labs",
};

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-2">
      <h2 className="text-lg font-extrabold tracking-tight text-foreground">{title}</h2>
      <div className="flex flex-col gap-2 text-sm leading-relaxed text-muted">{children}</div>
    </section>
  );
}

export default function PrivacyPage() {
  return (
    <div className="min-h-screen px-6 py-16">
      <main className="mx-auto flex max-w-2xl flex-col gap-8">
        <div className="mx-auto flex flex-col items-center gap-3 rounded-[32px] border border-white/60 bg-surface/90 px-8 py-8 text-center shadow-soft-lg backdrop-blur-xl">
          <LogoMark size={48} />
          <h1 className="text-3xl font-extrabold tracking-tight text-foreground">Privacy Policy</h1>
          <p className="max-w-sm text-sm text-muted">Last updated 2026-09-09 (part of the Astryks Group)</p>
        </div>

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
              generate are processed entirely on our own servers (a dedicated GPU server we operate).
              We do not send this data to any third-party AI vendor. Generated audio clips are stored
              on our server so you can play them back and download them; uploaded voice samples are
              used to generate your requested audio and are not used to train models for other users.
            </p>
          </Section>

          <Section title="Video (not live yet)">
            <p>
              Video cloning is not a working feature yet (see the home page). When it ships, it will
              work differently from audio: any photo, video, or reference audio you upload for a video
              generation will be sent to third-party AI vendors (Kling, Veo, and the fal.ai platform we
              use to reach them) for processing. That is a materially different arrangement from
              audio, which stays entirely on our own infrastructure — we&apos;ll say this plainly in the
              product itself before you generate anything, not just here.
            </p>
          </Section>

          <Section title="Account &amp; billing">
            <p>
              We don&apos;t use passwords or traditional accounts. Instead, a subscription is tied to an
              access code generated after checkout. Payment is processed by Stripe — we do not see or
              store your card details ourselves. We store your email, subscription status, and usage
              (characters/video credits used this billing period) to enforce plan limits and manage
              your subscription.
            </p>
          </Section>

          <Section title="What we don't do">
            <ul className="list-disc pl-5">
              <li>We don&apos;t sell your data.</li>
              <li>We don&apos;t use your uploaded voice, photos, or video to train models for anyone else.</li>
              <li>We don&apos;t share audio data with third parties — it&apos;s processed on our own servers.</li>
            </ul>
          </Section>

          <Section title="Data retention &amp; deletion">
            <p>
              Generated audio/video clips and uploaded samples are kept so you can access your history
              and re-download past generations. If you&apos;d like anything deleted — your account,
              uploaded samples, or generated clips — email us and we&apos;ll take care of it.
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
