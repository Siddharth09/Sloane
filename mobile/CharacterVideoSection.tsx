import { useState } from "react";
import { Image, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { useVideoPlayer, VideoView } from "expo-video";
import { useAccessToken } from "./useAccessToken";

// Mirrors web/src/app/page.tsx's CharacterVideoSection - same 5-character
// roster, click-to-preview, single Lucy-voice generation path. Uses the
// access_token (not a cookie session) since this is billed against the
// Video plan's existing subscription quota, same gating as audio generation.
const WEB_BASE = process.env.EXPO_PUBLIC_WEB_BASE ?? "https://www.lucylabs.app";

const COLORS = {
  surface: "#fffbf7",
  foreground: "#3d3330",
  muted: "#9a8b83",
  border: "#f0e2d4",
  purple: "#9b7dc0",
};

// Kept in sync by hand with web/src/lib/characters.ts - no shared package
// between web/mobile yet. defaultVoiceId picked to match each character's
// requested accent (2026-09-11): Harper/Jack Australian (Jack "like Brad"),
// Beth English "like Alice", Vicky/Marcus American.
const CHARACTERS = [
  { id: "harper", name: "Harper", imageUrl: "https://v3b.fal.media/files/b/0aa9eb60/yOpTgTwUZNYQcFCLsa822_harper.jpg", defaultVoiceId: "voice_mark" },
  { id: "beth", name: "Beth", imageUrl: "https://v3b.fal.media/files/b/0aa9eb60/Y2m8E19pk2G12R1ewoEYH_beth.jpg", defaultVoiceId: "voice_business" },
  { id: "vicky", name: "Vicky", imageUrl: "https://v3b.fal.media/files/b/0aa9eb60/GCrI6ghEIlnUFmhtS8X7v_vicky.jpg", defaultVoiceId: "voice_rachel" },
  { id: "marcus", name: "Marcus", imageUrl: "https://v3b.fal.media/files/b/0aa9eb61/iPWHKRCO3ZxzoPoXtCewT_marcus.jpg", defaultVoiceId: "voice_adam" },
  { id: "jack", name: "Jack", imageUrl: "https://v3b.fal.media/files/b/0aa9eb61/6_ml_AMMqKfis0tvQBm8G_jack.jpg", defaultVoiceId: "voice_tech" },
];

const LUCY_VOICE_CREDIT_COST = 8;
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
  const [script, setScript] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [playingId, setPlayingId] = useState<string | null>(null);

  const character = CHARACTERS.find((c) => c.id === characterId)!;
  // One shared preview player, source swapped per click (same pattern as
  // the pay-as-you-go audio previews elsewhere in this app).
  const previewPlayer = useVideoPlayer(null, (p) => {
    p.loop = false;
  });

  function handlePickCharacter(id: string) {
    setCharacterId(id);
    if (playingId === id) {
      previewPlayer.pause();
      setPlayingId(null);
      return;
    }
    previewPlayer.replace(`${WEB_BASE}/character-samples/${id}.mp4`);
    previewPlayer.play();
    setPlayingId(id);
  }

  async function handleGenerate() {
    setLoading(true);
    setError(null);
    setVideoUrl(null);
    try {
      const res = await fetch(`${WEB_BASE}/api/generate-character-video`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ access_token: token, character_id: characterId, voice_choice: character.defaultVoiceId, script }),
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
      <Text style={styles.subtitle}>Tap a face to hear them, then type what they should say.</Text>

      <View style={styles.characterRow}>
        {CHARACTERS.map((c) => (
          <Pressable key={c.id} onPress={() => handlePickCharacter(c.id)} style={styles.characterItem}>
            <View>
              <Image
                source={{ uri: c.imageUrl }}
                style={[styles.characterImage, characterId === c.id && styles.characterImageSelected]}
              />
              {playingId === c.id && (
                <View style={styles.playingBadge}>
                  <Text style={styles.playingBadgeText}>🔊</Text>
                </View>
              )}
            </View>
            <Text style={[styles.characterName, characterId === c.id && styles.characterNameSelected]}>{c.name}</Text>
          </Pressable>
        ))}
      </View>

      {!token ? (
        <Text style={styles.muted}>Sign in with a Video-plan access code in Account to actually generate a video with them.</Text>
      ) : (
        <>
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
              {loading ? "Generating… (usually 30-90s)" : `Generate (${LUCY_VOICE_CREDIT_COST} video credits)`}
            </Text>
          </Pressable>

          {error && <Text style={styles.errorText}>{error}</Text>}
          {videoUrl && <ResultVideo uri={videoUrl} />}
        </>
      )}

      <Text style={styles.noteText}>Comes from your Video plan&apos;s 40 credits/month - each video costs {LUCY_VOICE_CREDIT_COST}.</Text>
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
  playingBadge: {
    position: "absolute",
    bottom: -2,
    right: -2,
    width: 16,
    height: 16,
    borderRadius: 8,
    backgroundColor: "#fff",
    alignItems: "center",
    justifyContent: "center",
  },
  playingBadgeText: { fontSize: 9 },
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
  resultVideo: { width: "100%", aspectRatio: 9 / 16, borderRadius: 16, backgroundColor: "#000" },
  noteText: { fontSize: 11, lineHeight: 17, color: COLORS.muted },
});
