import { useEffect, useState } from "react";
import {
  ActivityIndicator,
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
import { useAudioPlayer } from "expo-audio";
import * as DocumentPicker from "expo-document-picker";
import { LogoMark } from "./LogoMark";
import { AccountWidget } from "./AccountWidget";
import { useAccessToken } from "./useAccessToken";
import { useFreeTierId } from "./useFreeTierId";
import { DeliverySliders, DEFAULT_DELIVERY, type Delivery } from "./DeliverySliders";
import { VideoPreviewSection } from "./VideoPreviewSection";
import { Footer } from "./Footer";
import { useAudioGeneration } from "./useAudioGeneration";
import { WaitingGame } from "./WaitingGame";

// Mirrors web/src/app/page.tsx's IS_POD_MODE - keep in sync with the
// server-side INFERENCE_BACKEND toggle (web/src/lib/inferenceBackend.ts).
const IS_POD_MODE = process.env.EXPO_PUBLIC_INFERENCE_BACKEND === "pod";

// Same backend host the rest of the app calls (billing/free-tier status
// live on the Next.js web app, not the GPU inference server).
const WEB_BASE = process.env.EXPO_PUBLIC_WEB_BASE ?? "https://lucylabs.app";

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
  { id: "voice_meditation", label: "Michelle", color: COLORS.coralDark, initial: "F" },
  { id: "voice_mark", label: "Mark", color: COLORS.sage, initial: "M" },
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
      <Pressable style={styles.playButton} onPress={() => player.play()}>
        <Text style={styles.playButtonText}>▶ Play result</Text>
      </Pressable>
      <Pressable
        style={styles.shareButton}
        onPress={() => Share.share({ message: "Listen to what I made with Lucy!", url: uri })}
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

type FreeTierUsage = { charactersUsed: number; charactersLimit: number; periodEnd: string };

function useFreeTierUsage(freeTierId: string | null) {
  const [usage, setUsage] = useState<FreeTierUsage | null>(null);

  async function refresh() {
    if (!freeTierId) return;
    try {
      const res = await fetch(`${WEB_BASE}/api/free-tier-status?id=${encodeURIComponent(freeTierId)}`);
      const data = await res.json();
      if (res.ok) setUsage(data);
    } catch {
      // Informational only - not worth surfacing an error for this.
    }
  }

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [freeTierId]);

  return { usage, refresh };
}

function FreeTierBadge({ usage }: { usage: FreeTierUsage | null }) {
  if (!usage) return null;
  const remaining = Math.max(0, usage.charactersLimit - usage.charactersUsed);
  const resetDate = new Date(usage.periodEnd).toLocaleDateString("en-US", { month: "long", day: "numeric" });
  return (
    <View style={{ alignItems: "flex-end" }}>
      <Text style={styles.freeTierCount}>{remaining.toLocaleString()} left</Text>
      <Text style={styles.freeTierReset}>resets {resetDate}</Text>
    </View>
  );
}

function PresetVoiceSection() {
  const { token } = useAccessToken();
  const freeTierId = useFreeTierId();
  const { usage: freeUsage, refresh: refreshFreeUsage } = useFreeTierUsage(token ? null : freeTierId);
  const [text, setText] = useState("");
  const [voiceId, setVoiceId] = useState(PRESET_VOICES[0].id);
  const [delivery, setDelivery] = useState<Delivery>(DEFAULT_DELIVERY);
  const { generate, loading, error, audioUri, statusMessage, showWaitingUi } = useAudioGeneration("/api/generate-preset");

  const freeTierExhausted = !token && !!freeUsage && freeUsage.charactersUsed >= freeUsage.charactersLimit;

  async function handleGenerate() {
    const form = new FormData();
    form.append("text", text);
    form.append("voice_id", voiceId);
    form.append("exaggeration", String(delivery.expressiveness));
    form.append("speed", String(delivery.speed));
    if (token) form.append("access_token", token);
    else if (freeTierId) form.append("free_tier_id", freeTierId);
    await generate(form);
    if (!token) refreshFreeUsage();
  }

  return (
    <Card
      icon="✎"
      title="Text to speech"
      subtitle="Type anything, pick a voice, hear it narrated."
      headerRight={!token ? <FreeTierBadge usage={freeUsage} /> : undefined}
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
          return (
            <Pressable key={v.id} style={styles.voiceOption} onPress={() => setVoiceId(v.id)}>
              <View
                style={[
                  styles.voiceCircle,
                  { backgroundColor: v.color },
                  selected && styles.voiceCircleSelected,
                ]}
              >
                {selected && <View style={styles.voiceCircleScrim} />}
                <Text style={styles.voiceCircleText}>{v.initial}</Text>
              </View>
              <Text style={[styles.voiceLabel, selected && styles.voiceLabelSelected]}>
                {v.label}
              </Text>
            </Pressable>
          );
        })}
      </View>

      <DeliverySliders value={delivery} onChange={setDelivery} accentColor={COLORS.pink} />

      {!IS_POD_MODE && (
        <Text style={styles.helperText}>
          Generation usually takes under a minute, but can take up to a few minutes after a quiet period while the voice engine wakes up.
        </Text>
      )}
      {freeTierExhausted ? (
        <View style={styles.exhaustedBox}>
          <Text style={styles.exhaustedText}>
            You&apos;ve used your free {freeUsage!.charactersLimit.toLocaleString()} characters this month.
            Resets {new Date(freeUsage!.periodEnd).toLocaleDateString("en-US", { month: "long", day: "numeric" })}.
          </Text>
          <Pressable onPress={() => Linking.openURL(`${WEB_BASE}/billing`)}>
            <Text style={styles.exhaustedLink}>See plans →</Text>
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
  const [text, setText] = useState("");
  const [file, setFile] = useState<DocumentPicker.DocumentPickerAsset | null>(null);
  const [delivery, setDelivery] = useState<Delivery>(DEFAULT_DELIVERY);
  const { generate, loading, error, audioUri, statusMessage } = useAudioGeneration("/api/clone-voice");

  async function handlePickFile() {
    const result = await DocumentPicker.getDocumentAsync({ type: "audio/*" });
    if (!result.canceled) {
      setFile(result.assets[0]);
    }
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
  }

  return (
    <Card
      icon="🎙"
      title="Clone any voice"
      subtitle="Upload ~10-20 seconds of a voice, type any text."
    >
      <Pressable style={styles.filePickButton} onPress={handlePickFile}>
        <Text style={styles.filePickButtonText}>{file ? file.name : "Choose an audio file"}</Text>
      </Pressable>

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

      <Text style={styles.helperText}>
        Generation usually takes under a minute, but can take up to a few minutes after a quiet period while the voice engine wakes up.
      </Text>
      <GradientButton
        onPress={handleGenerate}
        disabled={!text || !file || loading}
        loading={loading}
        label="Generate"
      />

      {loading && (
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
  return (
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
        <Footer />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: COLORS.background },
  // ScrollView's content container only takes up as much height as its
  // content by default - on a screen taller than the content, that left a
  // gap at the bottom showing the window's default background instead of
  // COLORS.background. flex:1 on the ScrollView itself + flexGrow:1 on the
  // content container makes it fill the screen even when content is short.
  scrollView: { flex: 1, backgroundColor: COLORS.background },
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
  // 10 preset voices don't fit in one unwrapped row on a phone width -
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
  voiceLabel: { fontSize: 12, color: COLORS.muted },
  voiceLabelSelected: { color: COLORS.foreground, fontWeight: "600" },
  filePickButton: {
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: 16,
    padding: 14,
    alignItems: "center",
    backgroundColor: "#fff",
  },
  filePickButtonText: { fontSize: 14, color: COLORS.foreground },
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
