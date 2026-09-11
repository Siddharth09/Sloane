import { Linking, Pressable, StyleSheet, Text, View } from "react-native";

// Mirrors web/src/app/page.tsx's VideoIntroSection - the same 4 real modes.
// "Pick a character" is fully native (see CharacterVideoSection.tsx); the
// other three need an uploaded photo/video/audio file and, for pay-as-you-
// go, a signed-in cookie session - both are real native-build work not
// done yet, so (same "do it on the website" pattern already used for pay-
// as-you-go/billing/account elsewhere in this app) they deep-link to the
// matching section on the website instead of being rebuilt here.
const WEB_BASE = process.env.EXPO_PUBLIC_WEB_BASE ?? "https://www.lucylabs.app";

const COLORS = {
  surface: "#fffbf7",
  foreground: "#3d3330",
  muted: "#9a8b83",
  border: "#f0e2d4",
  purple: "#9b7dc0",
};

const VIDEO_CREDITS_PER_MONTH = 40;

const WEB_MODES = [
  {
    title: "Your video, hyper-realistic",
    body: "Upload your own photo or a short video of yourself, type what to say - Kling animates exactly your face.",
    anchor: "hyper-realistic",
  },
  {
    title: "Cinematic",
    body: "Your photo + a scene you describe - Veo generates the shot around it.",
    anchor: "cinematic",
  },
  {
    title: "Pay as you go",
    body: "Any prompt (+ optional photo/audio), any engine - no subscription, prepaid credits instead.",
    anchor: "pay-as-you-go",
  },
];

export function VideoPreviewSection() {
  return (
    <View style={styles.card}>
      <View style={styles.cardHeader}>
        <Text style={styles.cardIcon}>🎬</Text>
        <View style={{ flex: 1 }}>
          <Text style={styles.cardTitle}>Video</Text>
          <Text style={styles.cardSubtitle}>Four ways to make a video with Lucy.</Text>
        </View>
      </View>

      <Text style={styles.body}>
        Pick a character below for a fully in-app video, or open the website for the other three modes -
        each needs uploading your own photo/video/audio, which this app doesn&apos;t support taking directly
        yet.
      </Text>

      {WEB_MODES.map((m) => (
        <View key={m.anchor} style={styles.modeCard}>
          <Text style={styles.modeTitle}>{m.title}</Text>
          <Text style={styles.body}>{m.body}</Text>
          <Pressable
            style={styles.webButton}
            onPress={() => Linking.openURL(`${WEB_BASE}/#${m.anchor}`).catch(() => {})}
          >
            <Text style={styles.webButtonText}>Open on the website →</Text>
          </Pressable>
        </View>
      ))}

      <View style={styles.noteBox}>
        <Text style={styles.noteText}>
          The first three modes share one Video-plan balance: {VIDEO_CREDITS_PER_MONTH} credits/month.
          Whichever mode you use, your photo, video, and any audio are sent to third-party AI vendors
          (Kling, Veo, Seedance, and the fal.ai platform we use to reach them) for processing.
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
  modeCard: { backgroundColor: "#fff", borderRadius: 16, padding: 14, gap: 8 },
  modeTitle: { fontSize: 14, fontWeight: "700", color: COLORS.foreground },
  webButton: { backgroundColor: COLORS.purple, borderRadius: 999, paddingVertical: 10, alignItems: "center" },
  webButtonText: { color: "#fff", fontSize: 13, fontWeight: "700" },
  noteBox: { backgroundColor: "#fff", borderRadius: 16, padding: 12 },
  noteText: { fontSize: 11, lineHeight: 17, color: COLORS.muted },
});
