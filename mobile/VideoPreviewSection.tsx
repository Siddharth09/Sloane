import { StyleSheet, Text, View } from "react-native";
import { useVideoPlayer, VideoView } from "expo-video";

// Mirrors web/src/app/page.tsx's VideoCloneSection - same three modes, same
// honesty disclaimers, same shared-credit framing. Videos stream from the
// web app's own hosting rather than bundling multi-MB clips into the app
// binary - this is preview/marketing content, not something that needs to
// work offline.
const WEB_BASE = process.env.EXPO_PUBLIC_WEB_BASE ?? "https://www.lucylabs.app";

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
const VIDEO_CREDITS = { video: 40, talkSecondsPerCredit: 1, cineSecondsPerCredit: 0.33 };

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
    p.play();
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
          <Text style={styles.cardTitle}>Video</Text>
          <Text style={styles.cardSubtitle}>Three real modes, being wired up now.</Text>
        </View>
      </View>

      <Text style={styles.body}>
        Video is landing as three distinct modes, each built on the AI video engine that&apos;s actually
        best at that job: Kling for a talking-head video in any voice, Veo for a fully AI-generated
        cinematic scene, and Seedance for ad-style videos built around your own reusable AI actor. The
        clips below are real tests run against the live APIs, not mockups — here&apos;s exactly what to
        expect, drawbacks included.
      </Text>

      <VideoModeCard
        badge="Talking head"
        title="Kling + any Lucy voice (or Kling's own)"
        videoUri={`${WEB_BASE}/trailers/kirsty-kling-dub.mp4`}
        description="Upload a photo or short video of a face, plus audio — either type text narrated in one of Lucy's voices (including a cloned one), or let Kling use its own voice. We lip-sync it to that face."
      />

      <VideoModeCard
        badge="Cinematic"
        title="Veo, any scene you describe"
        videoUri={`${WEB_BASE}/trailers/kirsty-moon-veo-audio.mp4`}
        description="Upload a photo and describe a scene in a prompt — Veo generates the video around it, with a choice of its own AI-generated voice/dialogue or a Lucy voice dubbed in afterward for shots calm enough for the dub to sync convincingly."
        promptExamples={CINEMATIC_PROMPT_EXAMPLES}
        footnote="The more the character moves within a scene, the more their face can drift or distort from the original reference photo — a real limitation of current AI video technology broadly, ours included, not something we can fully fix on our end. Cinematic mode isn't reliable yet for a shot that needs the face to stay consistent throughout a lot of motion."
      />

      <VideoModeCard
        badge="Ads"
        title="Your own exclusive AI actor"
        videoUri={`${WEB_BASE}/trailers/ads-veo-demo.mp4`}
        description="Describe your actor in a text prompt, or start from a photo or a short video — either way, you type the script and your actor says it back in the video. That actor is generated privately for your account: we never hand the same generated actor to another customer, and every new one is checked against everyone else's before it's finalized so even an accidental lookalike gets regenerated. Reuse that one actor across unlimited ads afterward - new scripts, new scenes, or upload an existing ad/UGC video and Seedance recreates its content and motion with your actor instead."
        footnote="This demo (and any hyper-realistic actor) is generated through Veo - Seedance's own safety filter blocks fully AI-generated faces that look too photorealistic, so it's reserved for its unique upload-a-video recreation trick and more stylized actor looks instead."
      />

      <View style={styles.noteBox}>
        <Text style={styles.noteText}>
          <Text style={{ fontWeight: "700", color: COLORS.foreground }}>
            Video credits are shared across all three modes
          </Text>{" "}
          — one monthly balance. 1 credit ≈ {VIDEO_CREDITS.talkSecondsPerCredit}s of talking-head, or ≈
          {VIDEO_CREDITS.cineSecondsPerCredit}s of cinematic (cinematic costs more to produce) - ads-mode
          pricing depends on which engine a given generation actually uses and is still being finalized.
          Once this ships: the Video plan gets {VIDEO_CREDITS.video} credits/month - Free/Starter/Plus
          don&apos;t include video. Whichever mode you use, your photo, video, and any reference audio are
          sent to third-party AI vendors (Kling, Veo, Seedance, and the fal.ai platform we use to reach
          them) for processing — different from our audio feature, which runs entirely on our own servers.
        </Text>
      </View>
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
