import { useState } from "react";
import { Image, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { useVideoPlayer, VideoView } from "expo-video";
import { useAudioRecorder, useAudioRecorderState, RecordingPresets, requestRecordingPermissionsAsync } from "expo-audio";
import { useAccessToken } from "./useAccessToken";

// Mirrors web/src/app/page.tsx's CharacterVideoSection - same 5-character
// roster, click-to-preview, and (2026-09-11) the same voice choice: the
// character's own default, any other Lucy preset, or your own voice cloned
// from a short recording. Uses the access_token (not a cookie session)
// since this is billed against the Video plan's existing subscription
// quota, same gating as audio generation.
const WEB_BASE = process.env.EXPO_PUBLIC_WEB_BASE ?? "https://www.lucylabs.app";

const COLORS = {
  surface: "#fffbf7",
  foreground: "#3d3330",
  muted: "#9a8b83",
  border: "#f0e2d4",
  purple: "#9b7dc0",
};

// Kept in sync by hand with web/src/lib/characters.ts - no shared package
// between web/mobile yet. defaultVoiceId originally picked to match each
// character's requested accent, then Harper/Vicky/Marcus reassigned
// 2026-09-11 per direct real-ear feedback (see characters.ts's comment for
// the full reasoning, including the deliberate Marcus/Mark accent tradeoff).
const CHARACTERS = [
  { id: "harper", name: "Harper", imageUrl: "https://v3b.fal.media/files/b/0aa9eb60/yOpTgTwUZNYQcFCLsa822_harper.jpg", defaultVoiceId: "harper" },
  { id: "beth", name: "Beth", imageUrl: "https://v3b.fal.media/files/b/0aa9eb60/Y2m8E19pk2G12R1ewoEYH_beth.jpg", defaultVoiceId: "voice_business" },
  { id: "vicky", name: "Vicky", imageUrl: "https://v3b.fal.media/files/b/0aa9eb60/GCrI6ghEIlnUFmhtS8X7v_vicky.jpg", defaultVoiceId: "voice_comedy" },
  { id: "marcus", name: "Marcus", imageUrl: "https://v3b.fal.media/files/b/0aa9ed98/31mAICP5_1aZQawWNnVT8_marcus_v2.jpg", defaultVoiceId: "voice_mark" },
  { id: "jack", name: "Jack", imageUrl: "https://v3b.fal.media/files/b/0aa9eb61/6_ml_AMMqKfis0tvQBm8G_jack.jpg", defaultVoiceId: "voice_tech" },
];

// Same 12 ids/labels as web/src/components/VoicePicker.tsx's PRESET_VOICES
// and App.tsx's own copy - just id+label here, no color/initial needed for
// a plain picker row.
const VOICE_CHOICES = [
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
  { id: "harper", label: "Harper" },
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
  const [voiceMode, setVoiceMode] = useState<"default" | "pick" | "own">("default");
  const [presetVoiceId, setPresetVoiceId] = useState(VOICE_CHOICES[0].id);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [playingId, setPlayingId] = useState<string | null>(null);
  const recorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
  const recorderState = useAudioRecorderState(recorder);

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

  async function handleToggleRecord() {
    if (recorderState.isRecording) {
      await recorder.stop();
      return;
    }
    const { granted } = await requestRecordingPermissionsAsync();
    if (!granted) return;
    await recorder.prepareToRecordAsync();
    recorder.record();
  }

  async function handleGenerate() {
    // Real bug fixed here: recorder.uri is assigned as soon as
    // prepareToRecordAsync() runs (before record() is even called, per
    // expo-audio's native implementation on both iOS/Android) - checking
    // only `!recorder.uri` doesn't catch a recording that's still live.
    // Tapping "Re-record" then Generate before tapping Stop used to send
    // whatever's been written to the in-progress file so far - unfinished,
    // no container trailer, producing a decode failure/garbage clone.
    if (voiceMode === "own" && recorderState.isRecording) {
      setError("Stop recording first");
      return;
    }
    if (voiceMode === "own" && !recorder.uri) {
      setError("Record a short sample of your voice first, or pick a Lucy voice instead");
      return;
    }
    setLoading(true);
    setError(null);
    setVideoUrl(null);
    try {
      const form = new FormData();
      form.append("access_token", token ?? "");
      form.append("character_id", characterId);
      form.append("script", script);
      if (voiceMode === "own") {
        form.append("voice_choice", "__own__");
        // Same {uri, name, type} shape App.tsx's CloneVoiceSection already
        // uses for React Native's fetch/FormData file uploads.
        form.append("reference_audio", { uri: recorder.uri, name: "recording.m4a", type: "audio/m4a" } as unknown as Blob);
      } else {
        form.append("voice_choice", voiceMode === "pick" ? presetVoiceId : character.defaultVoiceId);
      }
      const res = await fetch(`${WEB_BASE}/api/generate-character-video`, { method: "POST", body: form });
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
      <Text style={styles.title}>Pick a character</Text>
      <Text style={styles.subtitle}>5 ready-made AI actors, always the same face - tap one to hear them, then type what they should say.</Text>

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

      {playingId && <VideoView style={styles.previewVideo} player={previewPlayer} nativeControls contentFit="cover" />}

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

          <View style={styles.voiceModeRow}>
            {(["default", "pick", "own"] as const).map((m) => (
              <Pressable
                key={m}
                onPress={() => {
                  // Real bug fixed here: switching away from "own" mid-
                  // recording left the recorder running in the background
                  // with no visual indicator (the Record/Stop button
                  // unmounts, the mic stays open) until switching back.
                  if (voiceMode === "own" && recorderState.isRecording) recorder.stop();
                  setVoiceMode(m);
                }}
                style={[styles.voiceModeButton, voiceMode === m && styles.voiceModeButtonActive]}
              >
                <Text style={[styles.voiceModeText, voiceMode === m && styles.voiceModeTextActive]}>
                  {m === "default" ? `${character.name}'s voice` : m === "pick" ? "Another voice" : "My own voice"}
                </Text>
              </Pressable>
            ))}
          </View>

          {voiceMode === "pick" && (
            <View style={styles.voicePickRow}>
              {VOICE_CHOICES.map((v) => (
                <Pressable
                  key={v.id}
                  onPress={() => setPresetVoiceId(v.id)}
                  style={[styles.voiceChip, presetVoiceId === v.id && styles.voiceChipActive]}
                >
                  <Text style={[styles.voiceChipText, presetVoiceId === v.id && styles.voiceChipTextActive]}>{v.label}</Text>
                </Pressable>
              ))}
            </View>
          )}

          {voiceMode === "own" && (
            <Pressable onPress={handleToggleRecord} style={styles.recordButton}>
              <Text style={styles.recordButtonText}>
                {recorderState.isRecording ? "⏹ Stop recording" : recorder.uri ? "🎙 Re-record" : "🎙 Record ~10s of your voice"}
              </Text>
            </Pressable>
          )}

          <Pressable
            onPress={handleGenerate}
            disabled={loading || !script.trim() || recorderState.isRecording}
            style={[styles.generateButton, (loading || !script.trim() || recorderState.isRecording) && { opacity: 0.5 }]}
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
  voiceModeRow: { flexDirection: "row", gap: 8 },
  voiceModeButton: { flex: 1, borderRadius: 999, paddingVertical: 8, alignItems: "center", borderWidth: 1, borderColor: COLORS.border, backgroundColor: "#fff" },
  voiceModeButtonActive: { backgroundColor: COLORS.purple, borderColor: COLORS.purple },
  voiceModeText: { fontSize: 11, fontWeight: "700", color: COLORS.muted },
  voiceModeTextActive: { color: "#fff" },
  voicePickRow: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  voiceChip: { borderRadius: 999, paddingVertical: 6, paddingHorizontal: 12, borderWidth: 1, borderColor: COLORS.border, backgroundColor: "#fff" },
  voiceChipActive: { backgroundColor: COLORS.purple, borderColor: COLORS.purple },
  voiceChipText: { fontSize: 11, color: COLORS.muted },
  voiceChipTextActive: { color: "#fff", fontWeight: "700" },
  recordButton: { borderRadius: 999, paddingVertical: 10, alignItems: "center", borderWidth: 1, borderColor: COLORS.border, backgroundColor: "#fff" },
  recordButtonText: { fontSize: 12, fontWeight: "700", color: COLORS.foreground },
  generateButton: { backgroundColor: COLORS.purple, borderRadius: 999, paddingVertical: 12, alignItems: "center" },
  generateButtonText: { color: "#fff", fontSize: 13, fontWeight: "700" },
  errorText: { fontSize: 12, color: "#b0463c" },
  resultVideo: { width: "100%", aspectRatio: 9 / 16, borderRadius: 16, backgroundColor: "#000" },
  previewVideo: { width: "100%", aspectRatio: 9 / 16, borderRadius: 16, backgroundColor: "#000" },
  noteText: { fontSize: 11, lineHeight: 17, color: COLORS.muted },
});
