import { useEffect, useState } from "react";
import {
  ActivityIndicator,
  ImageBackground,
  Linking,
  Pressable,
  SafeAreaView,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import {
  useAudioPlayer,
  useAudioPlayerStatus,
  useAudioRecorder,
  useAudioRecorderState,
  RecordingPresets,
  requestRecordingPermissionsAsync,
} from "expo-audio";
import * as DocumentPicker from "expo-document-picker";
import { LogoMark } from "./LogoMark";
import { AccountWidget } from "./AccountWidget";
import { useAccessToken } from "./useAccessToken";
import { useFreeTierId } from "./useFreeTierId";
import { DeliverySliders, DEFAULT_DELIVERY, type Delivery } from "./DeliverySliders";
import { VideoPreviewSection } from "./VideoPreviewSection";
import { CharacterVideoSection } from "./CharacterVideoSection";
import { Footer } from "./Footer";
import { useAudioGeneration } from "./useAudioGeneration";
import { WaitingGame } from "./WaitingGame";

// Same backend host the rest of the app calls (billing/free-tier status
// live on the Next.js web app, not the GPU inference server).
const WEB_BASE = process.env.EXPO_PUBLIC_WEB_BASE ?? "https://www.lucylabs.app";

// Mirrors web/src/app/page.tsx's useIsPodMode - fetched at runtime rather
// than baked in from an env var at build time, so the cold-start copy stays
// accurate even when /admin flips the backend without a new app build (a
// build-time constant here previously went stale exactly that way).
let cachedPodMode: boolean | null = null;

function useIsPodMode(): boolean {
  const [isPodMode, setIsPodMode] = useState(cachedPodMode ?? false);
  useEffect(() => {
    if (cachedPodMode !== null) return;
    fetch(`${WEB_BASE}/api/inference-mode`)
      .then((r) => r.json())
      .then((data) => {
        cachedPodMode = data.mode === "pod";
        setIsPodMode(cachedPodMode);
      })
      .catch(() => {
        // Leave the default (Serverless-style copy) - harmless either way,
        // it's just informational text, not enforcement.
      });
  }, []);
  return isPodMode;
}

const COLORS = {
  background: "#fdf6f0",
  surface: "#fffbf7",
  foreground: "#3d3330",
  muted: "#9a8b83",
  border: "#f0e2d4",
  coral: "#e8846b",
  coralDark: "#d66f55",
  rose: "#e8a0a0",
  sage: "#93b48c",
  lavender: "#b3a6d6",
  butter: "#e8c26b",
  pink: "#dd7c9c",
  blue: "#6f97bd",
  purple: "#9b7dc0",
};

const PRESET_VOICES = [
  { id: "art_instructor", label: "Vicky", color: COLORS.rose, initial: "V" },
  { id: "music_instructor", label: "Patrick", color: COLORS.sage, initial: "P" },
  { id: "voice_business", label: "Alice", color: COLORS.pink, initial: "A" },
  { id: "voice_finance", label: "Megan", color: COLORS.blue, initial: "M" },
  { id: "voice_broadcast", label: "Katie", color: COLORS.purple, initial: "K" },
  { id: "voice_tech", label: "Brad", color: COLORS.butter, initial: "B" },
  { id: "voice_comedy", label: "Izzy", color: COLORS.lavender, initial: "I" },
  { id: "voice_sales", label: "Robbo", color: COLORS.coral, initial: "R" },
  { id: "voice_mark", label: "Mark", color: COLORS.sage, initial: "M" },
  // Adam/Rachel added 2026-09-10 - reuse existing colors (freed
  // COLORS.coralDark from Michelle's removal; COLORS.rose shared with
  // Vicky), same documented constraint as Patrick/Mark sharing sage.
  { id: "voice_adam", label: "Adam", color: COLORS.coralDark, initial: "A" },
  { id: "voice_rachel", label: "Rachel", color: COLORS.rose, initial: "R" },
  { id: "voice_emily", label: "Emily", color: COLORS.blue, initial: "E" },
  // Harper (2026-09-11) - see web/src/components/VoicePicker.tsx for the
  // full reasoning (zero-shot cloned, not fine-tuned - a rougher
  // approximation than the other 12). Reuses COLORS.pink like web does.
  { id: "harper", label: "Harper", color: COLORS.pink, initial: "H" },
  // 2026-09-11: aoife/liam/ryan/tyler - see web/src/components/VoicePicker.tsx.
  { id: "aoife", label: "Aoife", color: COLORS.lavender, initial: "A" },
  { id: "liam", label: "Liam", color: COLORS.purple, initial: "L" },
  { id: "ryan", label: "Ryan", color: COLORS.butter, initial: "R" },
  { id: "tyler", label: "Tyler", color: COLORS.coral, initial: "T" },
];

function GradientButton({
  onPress,
  disabled,
  loading,
  label,
}: {
  onPress: () => void;
  disabled?: boolean;
  loading?: boolean;
  label: string;
}) {
  return (
    <Pressable onPress={onPress} disabled={disabled}>
      <LinearGradient
        colors={disabled ? ["#e5d9cf", "#e5d9cf"] : [COLORS.coral, COLORS.coralDark]}
        style={styles.button}
      >
        {loading ? <ActivityIndicator color="#fff" /> : <Text style={styles.buttonText}>{label}</Text>}
      </LinearGradient>
    </Pressable>
  );
}

function AudioResult({ uri }: { uri: string | null }) {
  // uri is now a local cache-file:// path decoded from the job's base64
  // audio (see useAudioGeneration.ts) - RunPod Serverless has no persisted
  // hosted URL for generated audio anymore (see STATUS.md "Serverless
  // migration"), so there's nothing meaningful to paste as a link. Share
  // still works on iOS (attaches the local file via the `url` field);
  // Android's Share API only reads `message`, so it just shares the promo
  // text there rather than a broken local path.
  const player = useAudioPlayer(uri);
  if (!uri) return null;
  return (
    <View style={{ gap: 8 }}>
      <Pressable
        style={styles.playButton}
        onPress={async () => {
          // player.play() resumes from currentTime, which sits at the end
          // once playback finishes - without this seek, pressing Play again
          // after a full playthrough silently does nothing.
          await player.seekTo(0);
          player.play();
        }}
      >
        <Text style={styles.playButtonText}>▶ Play result</Text>
      </Pressable>
      <Pressable
        style={styles.shareButton}
        onPress={() => Share.share({ message: "Listen to what I made with Lucy!", url: uri }).catch(() => {})}
      >
        <Text style={styles.shareButtonText}>Share</Text>
      </Pressable>
    </View>
  );
}

function Card({
  icon,
  title,
  subtitle,
  headerRight,
  children,
}: {
  icon: string;
  title: string;
  subtitle: string;
  headerRight?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <View style={styles.card}>
      <View style={styles.cardHeader}>
        <Text style={styles.cardIcon}>{icon}</Text>
        <View style={{ flex: 1 }}>
          <Text style={styles.cardTitle}>{title}</Text>
          <Text style={styles.cardSubtitle}>{subtitle}</Text>
        </View>
        {headerRight}
      </View>
      <View style={{ gap: 12 }}>{children}</View>
    </View>
  );
}

// Works for BOTH anonymous free-tier visitors and paying subscribers -
// shown "at all times" per direct request, not just for the free tier.
// Mirrors web/src/app/page.tsx's useUsage/UsageBadge.
type UsageInfo = { charactersUsed: number; charactersLimit: number; periodEnd: string; planName: string; isFree: boolean };

function useUsage(token: string | null, freeTierId: string | null) {
  const [usage, setUsage] = useState<UsageInfo | null>(null);

  async function refresh() {
    try {
      if (token) {
        const res = await fetch(`${WEB_BASE}/api/billing/status?token=${encodeURIComponent(token)}`);
        const data = await res.json();
        if (res.ok && !data.error) {
          setUsage({
            charactersUsed: data.charactersUsed,
            charactersLimit: data.charactersLimit,
            periodEnd: data.periodEnd,
            planName: data.plan,
            isFree: false,
          });
        }
      } else if (freeTierId) {
        const res = await fetch(`${WEB_BASE}/api/free-tier-status?id=${encodeURIComponent(freeTierId)}`);
        const data = await res.json();
        if (res.ok) {
          setUsage({
            charactersUsed: data.charactersUsed,
            charactersLimit: data.charactersLimit,
            periodEnd: data.periodEnd,
            planName: "Free",
            isFree: true,
          });
        }
      }
    } catch {
      // Informational only - not worth surfacing an error for this.
    }
  }

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, freeTierId]);

  return { usage, refresh };
}

function UsageBadge({ usage }: { usage: UsageInfo | null }) {
  if (!usage) return null;
  const remaining = Math.max(0, usage.charactersLimit - usage.charactersUsed);
  const resetDate = new Date(usage.periodEnd).toLocaleDateString("en-US", { month: "long", day: "numeric" });
  return (
    <View style={{ alignItems: "flex-end" }}>
      <Text style={styles.freeTierCount}>{remaining.toLocaleString()} left</Text>
      <Text style={styles.freeTierReset}>{usage.planName} · resets {resetDate}</Text>
    </View>
  );
}

function PresetVoiceSection() {
  const { token } = useAccessToken();
  const freeTierId = useFreeTierId();
  const isPodMode = useIsPodMode();
  const { usage, refresh: refreshUsage } = useUsage(token, freeTierId);
  const [text, setText] = useState("");
  const [voiceId, setVoiceId] = useState(PRESET_VOICES[0].id);
  const [delivery, setDelivery] = useState<Delivery>(DEFAULT_DELIVERY);
  const { generate, loading, error, audioUri, statusMessage, showWaitingUi } = useAudioGeneration("/api/generate-preset");

  // Click-to-preview: static pre-generated intro clips served from the web
  // app's public/voice-samples/ dir (same files VoicePicker.tsx plays on
  // web) - instant, no pod/Modal round trip. One player instance reused via
  // replace() rather than one useAudioPlayer per voice bubble, matching the
  // existing AudioResult pattern above of a single player + seekTo(0).
  const previewPlayer = useAudioPlayer();
  const previewStatus = useAudioPlayerStatus(previewPlayer);
  const [previewingId, setPreviewingId] = useState<string | null>(null);

  useEffect(() => {
    if (previewingId && previewStatus.didJustFinish) setPreviewingId(null);
  }, [previewStatus.didJustFinish, previewingId]);

  function handleVoicePress(id: string) {
    setVoiceId(id);
    if (previewingId === id) {
      previewPlayer.pause();
      setPreviewingId(null);
      return;
    }
    previewPlayer.pause();
    previewPlayer.replace({ uri: `${WEB_BASE}/voice-samples/${id}.wav` });
    previewPlayer.play();
    setPreviewingId(id);
  }

  const quotaExhausted = !!usage && usage.charactersUsed >= usage.charactersLimit;

  async function handleGenerate() {
    const form = new FormData();
    form.append("text", text);
    form.append("voice_id", voiceId);
    form.append("exaggeration", String(delivery.expressiveness));
    form.append("speed", String(delivery.speed));
    if (token) form.append("access_token", token);
    else if (freeTierId) form.append("free_tier_id", freeTierId);
    await generate(form);
    refreshUsage();
  }

  return (
    <Card
      icon="✎"
      title="Text to speech"
      subtitle="Type anything, pick a voice, hear it narrated."
      headerRight={<UsageBadge usage={usage} />}
    >
      <TextInput
        style={styles.textArea}
        multiline
        numberOfLines={4}
        placeholder="Type what you want narrated..."
        placeholderTextColor={COLORS.muted}
        value={text}
        onChangeText={setText}
      />

      <View style={styles.voiceRow}>
        {PRESET_VOICES.map((v) => {
          const selected = voiceId === v.id;
          const previewing = previewingId === v.id;
          return (
            <Pressable key={v.id} style={styles.voiceOption} onPress={() => handleVoicePress(v.id)}>
              <View
                style={[
                  styles.voiceCircle,
                  { backgroundColor: v.color },
                  selected && styles.voiceCircleSelected,
                ]}
              >
                {selected && <View style={styles.voiceCircleScrim} />}
                <Text style={styles.voiceCircleText}>{v.initial}</Text>
                {previewing && (
                  <View style={styles.voicePreviewBadge}>
                    <Text style={styles.voicePreviewBadgeText}>🔊</Text>
                  </View>
                )}
              </View>
              <Text style={[styles.voiceLabel, selected && styles.voiceLabelSelected]}>
                {v.label}
              </Text>
            </Pressable>
          );
        })}
      </View>

      <DeliverySliders value={delivery} onChange={setDelivery} accentColor={COLORS.pink} />

      {!isPodMode && (
        <Text style={styles.helperText}>
          Generation usually takes under a minute, but can take up to a few minutes after a quiet period while the voice engine wakes up.
        </Text>
      )}
      {quotaExhausted ? (
        <View style={styles.exhaustedBox}>
          <Text style={styles.exhaustedText}>
            You&apos;ve used your {usage!.isFree ? "free" : usage!.planName} {usage!.charactersLimit.toLocaleString()}{" "}
            characters this month.
            Resets {new Date(usage!.periodEnd).toLocaleDateString("en-US", { month: "long", day: "numeric" })}.
          </Text>
          <Pressable onPress={() => Linking.openURL(`${WEB_BASE}/billing`).catch(() => {})}>
            <Text style={styles.exhaustedLink}>{usage!.isFree ? "See plans" : "Upgrade"} →</Text>
          </Pressable>
        </View>
      ) : (
        <GradientButton
          onPress={handleGenerate}
          disabled={!text || loading}
          loading={loading}
          label="Generate"
        />
      )}

      {showWaitingUi && (
        <>
          <Text style={styles.helperText}>{statusMessage}</Text>
          <WaitingGame />
        </>
      )}
      {error && <Text style={styles.errorText}>{error}</Text>}
      <AudioResult uri={audioUri} />
    </Card>
  );
}

function CloneVoiceSection() {
  const { token } = useAccessToken();
  const freeTierId = useFreeTierId();
  const isPodMode = useIsPodMode();
  const { usage, refresh: refreshUsage } = useUsage(token, freeTierId);
  const [text, setText] = useState("");
  const [file, setFile] = useState<{ uri: string; name: string; mimeType?: string } | null>(null);
  const [delivery, setDelivery] = useState<Delivery>(DEFAULT_DELIVERY);
  const { generate, loading, error, audioUri, statusMessage, showWaitingUi } = useAudioGeneration("/api/clone-voice");
  const recorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
  const recorderState = useAudioRecorderState(recorder);

  const quotaExhausted = !!usage && usage.charactersUsed >= usage.charactersLimit;

  async function handlePickFile() {
    try {
      const result = await DocumentPicker.getDocumentAsync({ type: "audio/*" });
      if (!result.canceled) {
        setFile(result.assets[0]);
      }
    } catch {
      // User cancelled or the picker failed - nothing to recover, just leave the prior selection.
    }
  }

  async function handleToggleRecord() {
    if (recorderState.isRecording) {
      await recorder.stop();
      if (recorder.uri) {
        setFile({ uri: recorder.uri, name: "recording.m4a", mimeType: "audio/m4a" });
      }
      return;
    }
    const { granted } = await requestRecordingPermissionsAsync();
    if (!granted) return;
    await recorder.prepareToRecordAsync();
    recorder.record();
  }

  async function handleGenerate() {
    if (!file) return;
    const form = new FormData();
    form.append("text", text);
    // React Native's fetch/FormData accepts this {uri, name, type} shape for
    // file uploads - not the web File object, which doesn't exist here.
    form.append("reference_audio", {
      uri: file.uri,
      name: file.name,
      type: file.mimeType ?? "audio/wav",
    } as unknown as Blob);
    form.append("exaggeration", String(delivery.expressiveness));
    form.append("speed", String(delivery.speed));
    if (token) form.append("access_token", token);
    else if (freeTierId) form.append("free_tier_id", freeTierId);
    await generate(form);
    refreshUsage();
  }

  return (
    <Card
      icon="🎙"
      title="Clone any voice"
      subtitle="Record or upload ~10-20 seconds of a voice, type any text."
      headerRight={<UsageBadge usage={usage} />}
    >
      {file ? (
        <View style={styles.filePickButton}>
          <Text style={styles.filePickButtonText}>{file.name}</Text>
          <Pressable onPress={() => setFile(null)}>
            <Text style={styles.clearFileText}>Clear and try again</Text>
          </Pressable>
        </View>
      ) : (
        <View style={{ flexDirection: "row", gap: 10 }}>
          <Pressable
            style={[styles.recordButton, recorderState.isRecording && styles.recordButtonActive]}
            onPress={handleToggleRecord}
          >
            <Text style={styles.recordButtonText}>
              {recorderState.isRecording ? "⏹ Stop" : "🎙 Record audio"}
            </Text>
          </Pressable>
          <Pressable style={[styles.filePickButton, { flex: 1 }]} onPress={handlePickFile}>
            <Text style={styles.filePickButtonText}>Upload</Text>
          </Pressable>
        </View>
      )}

      <TextInput
        style={styles.textArea}
        multiline
        numberOfLines={4}
        placeholder="Type what you want read back in that voice..."
        placeholderTextColor={COLORS.muted}
        value={text}
        onChangeText={setText}
      />

      <DeliverySliders value={delivery} onChange={setDelivery} accentColor={COLORS.blue} />

      {!isPodMode && (
        <Text style={styles.helperText}>
          Generation usually takes under a minute, but can take up to a few minutes after a quiet period while the voice engine wakes up.
        </Text>
      )}
      {quotaExhausted ? (
        <View style={styles.exhaustedBox}>
          <Text style={styles.exhaustedText}>
            You&apos;ve used your {usage!.isFree ? "free" : usage!.planName} {usage!.charactersLimit.toLocaleString()}{" "}
            characters this month.
            Resets {new Date(usage!.periodEnd).toLocaleDateString("en-US", { month: "long", day: "numeric" })}.
          </Text>
          <Pressable onPress={() => Linking.openURL(`${WEB_BASE}/billing`).catch(() => {})}>
            <Text style={styles.exhaustedLink}>{usage!.isFree ? "See plans" : "Upgrade"} →</Text>
          </Pressable>
        </View>
      ) : (
        <GradientButton
          onPress={handleGenerate}
          disabled={!text || !file || loading}
          loading={loading}
          label="Generate"
        />
      )}

      {showWaitingUi && (
        <>
          <Text style={styles.helperText}>{statusMessage}</Text>
          <WaitingGame />
        </>
      )}
      {error && <Text style={styles.errorText}>{error}</Text>}
      <AudioResult uri={audioUri} />
    </Card>
  );
}

export default function App() {
  useEffect(() => {
    // Fire-and-forget: wakes up Modal well before the user finishes typing
    // and hits Generate for real - see web's api/warm-inference/route.ts,
    // shared since mobile calls the same Next.js backend.
    fetch(`${WEB_BASE}/api/warm-inference`, { method: "POST" }).catch(() => {});
  }, []);

  return (
    // Mirrors web/src/app/layout.tsx's .art-backdrop - same mosaic-courtyard
    // painting behind the whole app, with the same cream wash on top for text
    // contrast. Streamed from the web app's own hosting rather than bundled
    // into the app binary, same reasoning as VideoPreviewSection's trailers.
    <ImageBackground
      source={{ uri: `${WEB_BASE}/backgrounds/mosaic-courtyard.png` }}
      style={styles.backdrop}
      resizeMode="cover"
    >
      <View style={styles.backdropWash} />
      <SafeAreaView style={styles.safeArea}>
        <ScrollView style={styles.scrollView} contentContainerStyle={styles.scrollContent}>
          <View style={styles.hero}>
            <LogoMark size={64} />
            <Text style={styles.title}>Lucy Labs</Text>
            <Text style={styles.subtitle}>
              The AI Voice Clone, narrate any text or upload your voice and try it out!
            </Text>
          </View>
          <AccountWidget />
          <PresetVoiceSection />
          <CloneVoiceSection />
          <VideoPreviewSection />
          <CharacterVideoSection />
          <Footer />
        </ScrollView>
      </SafeAreaView>
    </ImageBackground>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1 },
  backdropWash: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: "rgba(253, 246, 240, 0.5)",
  },
  safeArea: { flex: 1 },
  // ScrollView's content container only takes up as much height as its
  // content by default - on a screen taller than the content, that left a
  // gap at the bottom showing the backdrop cut off instead of continuing to
  // scroll with it. flex:1 on the ScrollView itself + flexGrow:1 on the
  // content container makes it fill the screen even when content is short.
  scrollView: { flex: 1 },
  scrollContent: { flexGrow: 1, padding: 20, gap: 20 },
  hero: { alignItems: "center", marginBottom: 4, gap: 4 },
  title: { fontSize: 30, fontWeight: "800", color: COLORS.foreground, marginTop: 8 },
  subtitle: { fontSize: 13, color: COLORS.muted, textAlign: "center", maxWidth: 320 },
  card: {
    backgroundColor: COLORS.surface,
    borderRadius: 24,
    padding: 20,
    borderWidth: 1,
    borderColor: COLORS.border,
    gap: 16,
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
    backgroundColor: COLORS.background,
    borderRadius: 14,
    overflow: "hidden",
  },
  cardTitle: { fontSize: 17, fontWeight: "700", color: COLORS.foreground },
  cardSubtitle: { fontSize: 13, color: COLORS.muted },
  textArea: {
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: 16,
    padding: 14,
    fontSize: 14,
    minHeight: 90,
    textAlignVertical: "top",
    backgroundColor: "#fff",
    color: COLORS.foreground,
  },
  // 9 preset voices don't fit in one unwrapped row on a phone width -
  // wrap, and cut the gap down so more fit per line.
  voiceRow: { flexDirection: "row", flexWrap: "wrap", gap: 12, rowGap: 16, justifyContent: "center" },
  voiceOption: { alignItems: "center", gap: 4 },
  voiceCircle: {
    width: 56,
    height: 56,
    borderRadius: 28,
    alignItems: "center",
    justifyContent: "center",
    opacity: 0.75,
  },
  voiceCircleSelected: {
    opacity: 1,
    borderWidth: 3,
    borderColor: COLORS.coral,
    transform: [{ scale: 1.22 }],
    // React Native has no CSS-filter equivalent (brightness/saturate), so
    // "darker when selected" is a translucent black scrim on top of the
    // circle's own color instead - see the nested View in the voice list.
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 4,
    elevation: 4,
  },
  voiceCircleScrim: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    borderRadius: 28,
    backgroundColor: "rgba(0,0,0,0.18)",
  },
  voiceCircleText: { color: "#fff", fontSize: 18, fontWeight: "700" },
  voicePreviewBadge: {
    position: "absolute",
    bottom: -2,
    right: -2,
    width: 16,
    height: 16,
    borderRadius: 8,
    backgroundColor: "#fff",
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.2,
    shadowRadius: 2,
    elevation: 3,
  },
  voicePreviewBadgeText: { fontSize: 9 },
  voiceLabel: { fontSize: 12, color: COLORS.muted },
  voiceLabelSelected: { color: COLORS.foreground, fontWeight: "600" },
  filePickButton: {
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: 16,
    padding: 14,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#fff",
    gap: 6,
  },
  filePickButtonText: { fontSize: 14, color: COLORS.foreground },
  clearFileText: { fontSize: 12, color: COLORS.muted, textDecorationLine: "underline" },
  recordButton: {
    flex: 1,
    borderRadius: 16,
    padding: 14,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: COLORS.rose,
  },
  recordButtonActive: { backgroundColor: COLORS.coralDark },
  recordButtonText: { fontSize: 14, color: "#fff", fontWeight: "700" },
  button: {
    borderRadius: 999,
    paddingVertical: 14,
    alignItems: "center",
  },
  buttonText: { color: "#fff", fontSize: 14, fontWeight: "700" },
  errorText: { color: "#c0503a", fontSize: 13 },
  helperText: { fontSize: 12, color: COLORS.muted },
  freeTierCount: { fontSize: 12, fontWeight: "700", color: COLORS.foreground },
  freeTierReset: { fontSize: 10, color: COLORS.muted, marginTop: 1 },
  exhaustedBox: {
    backgroundColor: "#fff",
    borderRadius: 16,
    padding: 12,
    gap: 6,
  },
  exhaustedText: { fontSize: 13, color: COLORS.coralDark, lineHeight: 18 },
  exhaustedLink: { fontSize: 13, fontWeight: "700", color: COLORS.coralDark, textDecorationLine: "underline" },
  playButton: {
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: 16,
    paddingVertical: 12,
    alignItems: "center",
    backgroundColor: "#fff",
  },
  playButtonText: { fontSize: 14, color: COLORS.foreground, fontWeight: "600" },
  shareButton: {
    borderRadius: 999,
    paddingVertical: 10,
    alignItems: "center",
    backgroundColor: COLORS.butter,
  },
  shareButtonText: { fontSize: 13, color: "#fff", fontWeight: "700" },
});
