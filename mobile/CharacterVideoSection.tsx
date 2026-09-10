import { useState } from "react";
import { Image, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { useVideoPlayer, VideoView } from "expo-video";
import { useAccessToken } from "./useAccessToken";

// Mirrors web/src/app/page.tsx's CharacterVideoSection - same 5-character
// roster, same voice-choice/credits framing, same submit-then-poll pattern
// as the rest of this app's generation flows. Uses the access_token
// (not a cookie session) since this is billed against the Video plan's
// existing subscription quota, same gating as audio generation.
const WEB_BASE = process.env.EXPO_PUBLIC_WEB_BASE ?? "https://www.lucylabs.app";

const COLORS = {
  surface: "#fffbf7",
  foreground: "#3d3330",
  muted: "#9a8b83",
  border: "#f0e2d4",
  purple: "#9b7dc0",
};

// Kept in sync by hand with web/src/lib/characters.ts - no shared package
// between web/mobile yet (same limitation already noted in VideoPreviewSection).
const CHARACTERS = [
  { id: "harper", name: "Harper", imageUrl: "https://v3b.fal.media/files/b/0aa9eb60/yOpTgTwUZNYQcFCLsa822_harper.jpg" },
  { id: "beth", name: "Beth", imageUrl: "https://v3b.fal.media/files/b/0aa9eb60/Y2m8E19pk2G12R1ewoEYH_beth.jpg" },
  { id: "vicky", name: "Vicky", imageUrl: "https://v3b.fal.media/files/b/0aa9eb60/GCrI6ghEIlnUFmhtS8X7v_vicky.jpg" },
  { id: "marcus", name: "Marcus", imageUrl: "https://v3b.fal.media/files/b/0aa9eb61/iPWHKRCO3ZxzoPoXtCewT_marcus.jpg" },
  { id: "jack", name: "Jack", imageUrl: "https://v3b.fal.media/files/b/0aa9eb61/6_ml_AMMqKfis0tvQBm8G_jack.jpg" },
];

const LUCY_VOICES = [
  { id: "art_instructor", label: "Vicky" },
  { id: "music_instructor", label: "Patrick" },
  { id: "voice_business", label: "Alice" },
  { id: "voice_finance", label: "Megan" },
  { id: "voice_broadcast", label: "Katie" },
  { id: "voice_tech", label: "Brad" },
  { id: "voice_comedy", label: "Izzy" },
  { id: "voice_sales", label: "Robbo" },
  { id: "voice_mark", label: "Mark" },
  { id: "voice_adam", label: "Adam" },
  { id: "voice_rachel", label: "Rachel" },
  { id: "voice_emily", label: "Emily" },
];

const LUCY_VOICE_CREDIT_COST = 8;
const VEO_VOICE_CREDIT_COST = 24;
const POLL_INTERVAL_MS = 3000;
const POLL_TIMEOUT_MS = 300_000;

function ResultVideo({ uri }: { uri: string }) {
  const player = useVideoPlayer(uri, (p) => {
    p.loop = true;
    p.play();
  });
  return <VideoView style={styles.resultVideo} player={player} nativeControls contentFit="cover" />;
}

export function CharacterVideoSection() {
  const { token } = useAccessToken();
  const [characterId, setCharacterId] = useState(CHARACTERS[0].id);
  const [voiceChoice, setVoiceChoice] = useState("veo");
  const [script, setScript] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [videoUrl, setVideoUrl] = useState<string | null>(null);

  const creditsCost = voiceChoice === "veo" ? VEO_VOICE_CREDIT_COST : LUCY_VOICE_CREDIT_COST;

  async function handleGenerate() {
    setLoading(true);
    setError(null);
    setVideoUrl(null);
    try {
      const res = await fetch(`${WEB_BASE}/api/generate-character-video`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ access_token: token, character_id: characterId, voice_choice: voiceChoice, script }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Generation failed");
      const jobId = data.jobId as string;

      const startedAt = Date.now();
      for (;;) {
        if (Date.now() - startedAt > POLL_TIMEOUT_MS) throw new Error("Taking much longer than usual - try again shortly.");
        await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
        const statusRes = await fetch(`${WEB_BASE}/api/generate-character-video/status?jobId=${encodeURIComponent(jobId)}`);
        const statusData = await statusRes.json();
        if (statusData.status === "COMPLETED") {
          setVideoUrl(statusData.videoUrl);
          break;
        }
        if (statusData.status === "FAILED") throw new Error(statusData.error ?? "Generation failed");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Generation failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <View style={styles.card}>
      <Text style={styles.title}>Pick a character, make an ad</Text>
      <Text style={styles.subtitle}>5 pre-made AI actors - choose one, pick a voice, type a script.</Text>

      {!token ? (
        <Text style={styles.muted}>This needs the Video plan and an access code - add yours in Account to use it.</Text>
      ) : (
        <>
          <View style={styles.characterRow}>
            {CHARACTERS.map((c) => (
              <Pressable key={c.id} onPress={() => setCharacterId(c.id)} style={styles.characterItem}>
                <Image
                  source={{ uri: c.imageUrl }}
                  style={[styles.characterImage, characterId === c.id && styles.characterImageSelected]}
                />
                <Text style={[styles.characterName, characterId === c.id && styles.characterNameSelected]}>{c.name}</Text>
              </Pressable>
            ))}
          </View>

          <View style={styles.voiceRow}>
            <Pressable
              onPress={() => setVoiceChoice("veo")}
              style={[styles.voicePill, voiceChoice === "veo" && styles.voicePillSelected]}
            >
              <Text style={[styles.voicePillText, voiceChoice === "veo" && styles.voicePillTextSelected]}>
                Own voice ({VEO_VOICE_CREDIT_COST}cr)
              </Text>
            </Pressable>
            {LUCY_VOICES.map((v) => (
              <Pressable
                key={v.id}
                onPress={() => setVoiceChoice(v.id)}
                style={[styles.voicePill, voiceChoice === v.id && styles.voicePillSelected]}
              >
                <Text style={[styles.voicePillText, voiceChoice === v.id && styles.voicePillTextSelected]}>
                  {v.label} ({LUCY_VOICE_CREDIT_COST}cr)
                </Text>
              </Pressable>
            ))}
          </View>
          {voiceChoice === "veo" && (
            <Text style={styles.warningText}>
              Heads up: the character&apos;s own voice re-generates the whole scene, and in testing this has
              sometimes drifted to a different-looking face than the photo above - a real, unresolved
              limitation. A Lucy voice is more reliable for keeping the exact character.
            </Text>
          )}

          <TextInput
            style={styles.textArea}
            multiline
            numberOfLines={3}
            placeholder="What should they say?"
            placeholderTextColor={COLORS.muted}
            value={script}
            onChangeText={setScript}
          />

          <Pressable
            onPress={handleGenerate}
            disabled={loading || !script.trim()}
            style={[styles.generateButton, (loading || !script.trim()) && { opacity: 0.5 }]}
          >
            <Text style={styles.generateButtonText}>
              {loading ? "Generating… (usually 30-90s)" : `Generate (${creditsCost} video credits)`}
            </Text>
          </Pressable>

          {error && <Text style={styles.errorText}>{error}</Text>}
          {videoUrl && <ResultVideo uri={videoUrl} />}
        </>
      )}

      <Text style={styles.noteText}>
        Video credits come from your Video plan&apos;s existing 40/month allotment - a Lucy-voice video costs{" "}
        {LUCY_VOICE_CREDIT_COST} credits, the character&apos;s own Veo-generated voice costs {VEO_VOICE_CREDIT_COST}.
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
  },
  title: { fontSize: 16, fontWeight: "800", color: COLORS.foreground },
  subtitle: { fontSize: 12, color: COLORS.muted },
  muted: { fontSize: 12, color: COLORS.muted },
  characterRow: { flexDirection: "row", justifyContent: "space-between" },
  characterItem: { alignItems: "center", gap: 4 },
  characterImage: { width: 56, height: 56, borderRadius: 28, opacity: 0.7 },
  characterImageSelected: { opacity: 1, borderWidth: 3, borderColor: COLORS.purple },
  characterName: { fontSize: 11, color: COLORS.muted },
  characterNameSelected: { fontWeight: "700", color: COLORS.purple },
  voiceRow: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  voicePill: { backgroundColor: "#fff", borderRadius: 999, paddingHorizontal: 10, paddingVertical: 6 },
  voicePillSelected: { backgroundColor: COLORS.purple },
  voicePillText: { fontSize: 11, fontWeight: "600", color: COLORS.muted },
  voicePillTextSelected: { color: "#fff" },
  textArea: {
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: 16,
    padding: 12,
    fontSize: 13,
    color: COLORS.foreground,
    backgroundColor: "#fff",
    minHeight: 70,
    textAlignVertical: "top",
  },
  generateButton: { backgroundColor: COLORS.purple, borderRadius: 999, paddingVertical: 12, alignItems: "center" },
  generateButtonText: { color: "#fff", fontSize: 13, fontWeight: "700" },
  errorText: { fontSize: 12, color: "#b0463c" },
  warningText: { fontSize: 11, lineHeight: 16, fontStyle: "italic", color: "#b0463c" },
  resultVideo: { width: "100%", aspectRatio: 9 / 16, borderRadius: 16, backgroundColor: "#000" },
  noteText: { fontSize: 11, lineHeight: 17, color: COLORS.muted },
});
