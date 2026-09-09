import { StyleSheet, Text, View } from "react-native";
import { useVideoPlayer, VideoView } from "expo-video";

// Mirrors web/src/app/page.tsx's VideoCloneSection - same two modes, same
// honesty disclaimers, same shared-credit framing. Videos stream from the
// web app's own hosting rather than bundling multi-MB clips into the app
// binary - this is preview/marketing content, not something that needs to
// work offline.
const WEB_BASE = process.env.EXPO_PUBLIC_WEB_BASE ?? "https://lucylabs.app";

const COLORS = {
  surface: "#fffbf7",
  foreground: "#3d3330",
  muted: "#9a8b83",
  border: "#f0e2d4",
  purple: "#9b7dc0",
  coralDark: "#d66f55",
};

// Kept in sync by hand with web/src/lib/plans.ts VIDEO_CREDIT_COSTS and the
// Plus/Pro allotments - if those change, update here too (no shared package
// between web/mobile to import a single source of truth from yet).
const VIDEO_CREDITS = { plus: 15, pro: 60, talkSecondsPerCredit: 1, cineSecondsPerCredit: 0.33 };

const CINEMATIC_PROMPT_EXAMPLES = [
  "A sun-drenched clifftop terrace in Santorini, blue domes and the Aegean Sea behind me",
  "Walking a neon-lit street in Tokyo at night, rain reflecting off the pavement",
  "Standing in a quiet Kyoto bamboo forest at dawn, soft mist drifting through",
  "On a black-sand beach in Iceland, glaciers in the distance, moody light",
];

function TrailerClip({ uri }: { uri: string }) {
  const player = useVideoPlayer(uri, (p) => {
    p.loop = true;
    p.muted = true;
  });
  return <VideoView style={styles.video} player={player} nativeControls contentFit="cover" />;
}

function VideoModeCard({
  badge,
  title,
  videoUri,
  description,
  promptExamples,
  footnote,
}: {
  badge: string;
  title: string;
  videoUri: string;
  description: string;
  promptExamples?: string[];
  footnote?: string;
}) {
  return (
    <View style={styles.modeCard}>
      <View style={styles.modeHeader}>
        <Text style={styles.badge}>{badge}</Text>
        <Text style={styles.modeTitle}>{title}</Text>
      </View>
      <TrailerClip uri={videoUri} />
      <Text style={styles.body}>{description}</Text>
      {promptExamples && (
        <View style={{ marginTop: 6 }}>
          <Text style={styles.promptsLabel}>Example prompts:</Text>
          {promptExamples.map((p) => (
            <Text key={p} style={styles.promptItem}>
              {"• "}
              {p}
            </Text>
          ))}
        </View>
      )}
      {footnote && <Text style={styles.footnote}>{footnote}</Text>}
    </View>
  );
}

export function VideoPreviewSection() {
  return (
    <View style={styles.card}>
      <View style={styles.cardHeader}>
        <Text style={styles.cardIcon}>🎬</Text>
        <View style={{ flex: 1 }}>
          <Text style={styles.cardTitle}>Video, coming later</Text>
          <Text style={styles.cardSubtitle}>Not live yet — here&apos;s exactly what&apos;s planned.</Text>
        </View>
      </View>

      <Text style={styles.body}>
        We at Lucy Labs aren&apos;t ready for video yet, but we&apos;re building toward two distinct modes.
        Both clips below are real early tests, not polished demos — we&apos;d rather be upfront about
        where things stand than oversell it.
      </Text>

      <VideoModeCard
        badge="Talking head"
        title="Kling + your Lucy voice"
        videoUri={`${WEB_BASE}/trailers/kirsty-moon-kling-dub.mp4`}
        description="Upload a photo or short video of a face, plus audio — either type text narrated in your Lucy voice, or upload your own audio. We lip-sync it to that face. The voice is yours."
      />

      <VideoModeCard
        badge="Cinematic"
        title="Veo, any scene you describe"
        videoUri={`${WEB_BASE}/trailers/kirsty-moon-veo-audio.mp4`}
        description="Upload a photo and describe a scene in a prompt — Veo generates the video around it. The voice you hear is AI-generated dialogue, not your Lucy voice: dubbing a separate voice over this much camera motion doesn't sync convincingly, so we don't pretend it does."
        promptExamples={CINEMATIC_PROMPT_EXAMPLES}
        footnote="Faces can distort or drift from the original photo during generation — a real limitation of current AI video technology, ours included."
      />

      <VideoModeCard
        badge="Also tested"
        title="Kling's own voice (not shipping this way)"
        videoUri={`${WEB_BASE}/trailers/kirsty-moon-kling-with-audio.mp4`}
        description="We also tried letting Kling generate its own voice instead of dubbing with Lucy. Lip sync was noticeably worse this way — it's why Talking head mode dubs with your Lucy voice instead of a vendor's own generated speech."
      />

      <View style={styles.noteBox}>
        <Text style={styles.noteText}>
          <Text style={{ fontWeight: "700", color: COLORS.foreground }}>
            Video credits are shared across both modes
          </Text>{" "}
          — one monthly balance, spend it on talking-head, cinematic, or a mix of both. 1 credit ≈{" "}
          {VIDEO_CREDITS.talkSecondsPerCredit}s of talking-head, or ≈{VIDEO_CREDITS.cineSecondsPerCredit}s
          of cinematic (cinematic costs more to produce). Once this ships: Plus gets {VIDEO_CREDITS.plus}{" "}
          credits/month, Pro gets {VIDEO_CREDITS.pro} credits/month, Free gets none. Whichever mode you
          use, your photo, video, and any reference audio are sent to third-party AI vendors (Kling, Veo,
          and the fal.ai platform we use to reach them) for processing — different from our audio
          feature, which runs entirely on our own servers.
        </Text>
      </View>

      <Text style={styles.body}>
        If you need production-quality AI video today, the current best options are Kling and Utopai
        Studios&apos; PAI (the engine behind the &quot;Chloe vs History&quot; AI creator). We&apos;ll
        bring both modes here once they&apos;re actually good.
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: COLORS.surface,
    borderRadius: 24,
    padding: 20,
    borderWidth: 1,
    borderColor: COLORS.border,
    gap: 12,
    shadowColor: "#3d3330",
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.08,
    shadowRadius: 20,
    elevation: 3,
  },
  cardHeader: { flexDirection: "row", alignItems: "center", gap: 12 },
  cardIcon: {
    fontSize: 18,
    width: 40,
    height: 40,
    lineHeight: 40,
    textAlign: "center",
    backgroundColor: "#fdf6f0",
    borderRadius: 14,
    overflow: "hidden",
  },
  cardTitle: { fontSize: 17, fontWeight: "700", color: COLORS.foreground },
  cardSubtitle: { fontSize: 13, color: COLORS.muted },
  body: { fontSize: 13, lineHeight: 19, color: COLORS.muted },
  modeCard: {
    borderRadius: 16,
    borderWidth: 1,
    borderColor: COLORS.border,
    backgroundColor: "#fff",
    padding: 12,
    gap: 6,
  },
  modeHeader: { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 4 },
  badge: {
    backgroundColor: COLORS.purple,
    color: "#fff",
    fontSize: 11,
    fontWeight: "700",
    paddingHorizontal: 10,
    paddingVertical: 3,
    borderRadius: 999,
  },
  modeTitle: { fontSize: 13, fontWeight: "700", color: COLORS.foreground },
  video: { width: "100%", aspectRatio: 16 / 9, borderRadius: 12, backgroundColor: "#000" },
  promptsLabel: { fontSize: 12, fontWeight: "700", color: COLORS.foreground },
  promptItem: { fontSize: 12, color: COLORS.muted, marginTop: 2 },
  footnote: { fontSize: 11, fontStyle: "italic", color: COLORS.coralDark, marginTop: 4 },
  noteBox: { backgroundColor: "#fff", borderRadius: 16, padding: 12 },
  noteText: { fontSize: 11, lineHeight: 17, color: COLORS.muted },
});
