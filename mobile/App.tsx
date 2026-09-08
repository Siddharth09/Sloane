import { useState } from "react";
import {
  ActivityIndicator,
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
import { DeliverySliders, DEFAULT_DELIVERY, type Delivery } from "./DeliverySliders";

// Goes through the same Next.js proxy routes the web app uses (not the GPU
// inference server directly) so mobile requests get the same billing/quota
// gate - see web/src/app/api/generate-preset/route.ts. AudioResult below
// still needs the raw inference server host to actually play the returned
// file, since audio_url comes back as an absolute URL to that host.
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

function AudioResult({ url }: { url: string | null }) {
  // audio_url now comes back absolute (the proxy route resolves it against
  // the inference server host server-side) - no prefixing needed here.
  const player = useAudioPlayer(url);
  if (!url) return null;
  return (
    <View style={{ gap: 8 }}>
      <Pressable style={styles.playButton} onPress={() => player.play()}>
        <Text style={styles.playButtonText}>▶ Play result</Text>
      </Pressable>
      <Pressable
        style={styles.shareButton}
        onPress={() => Share.share({ message: "Listen to what I made with Lucy! " + url, url })}
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
  children,
}: {
  icon: string;
  title: string;
  subtitle: string;
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
      </View>
      <View style={{ gap: 12 }}>{children}</View>
    </View>
  );
}

function PresetVoiceSection() {
  const { token } = useAccessToken();
  const [text, setText] = useState("");
  const [voiceId, setVoiceId] = useState(PRESET_VOICES[0].id);
  const [delivery, setDelivery] = useState<Delivery>(DEFAULT_DELIVERY);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleGenerate() {
    setLoading(true);
    setError(null);
    try {
      const form = new FormData();
      form.append("text", text);
      form.append("voice_id", voiceId);
      form.append("exaggeration", String(delivery.expressiveness));
      form.append("speed", String(delivery.speed));
      if (token) form.append("access_token", token);
      const res = await fetch(`${WEB_BASE}/api/generate-preset`, { method: "POST", body: form });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? `Request failed (${res.status})`);
      setAudioUrl(data.audio_url);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setLoading(false);
    }
  }

  return (
    <Card icon="✎" title="Text to speech" subtitle="Type anything, pick a voice, hear it narrated.">
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

      <GradientButton
        onPress={handleGenerate}
        disabled={!text || loading}
        loading={loading}
        label="Generate"
      />

      {error && <Text style={styles.errorText}>{error}</Text>}
      <AudioResult url={audioUrl} />
    </Card>
  );
}

function CloneVoiceSection() {
  const { token } = useAccessToken();
  const [text, setText] = useState("");
  const [file, setFile] = useState<DocumentPicker.DocumentPickerAsset | null>(null);
  const [delivery, setDelivery] = useState<Delivery>(DEFAULT_DELIVERY);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handlePickFile() {
    const result = await DocumentPicker.getDocumentAsync({ type: "audio/*" });
    if (!result.canceled) {
      setFile(result.assets[0]);
    }
  }

  async function handleGenerate() {
    if (!file) return;
    setLoading(true);
    setError(null);
    try {
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
      const res = await fetch(`${WEB_BASE}/api/clone-voice`, { method: "POST", body: form });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? `Request failed (${res.status})`);
      setAudioUrl(data.audio_url);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setLoading(false);
    }
  }

  return (
    <Card
      icon="🎙"
      title="Clone any voice"
      subtitle="Upload ~10-20 seconds of a voice, type any text. Custom audio generation has some latency — it may take a couple minutes to load."
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

      <GradientButton
        onPress={handleGenerate}
        disabled={!text || !file || loading}
        loading={loading}
        label="Generate"
      />

      {error && <Text style={styles.errorText}>{error}</Text>}
      <AudioResult url={audioUrl} />
    </Card>
  );
}

export default function App() {
  return (
    <SafeAreaView style={styles.safeArea}>
      <ScrollView contentContainerStyle={styles.scrollContent}>
        <View style={styles.hero}>
          <LogoMark size={64} />
          <Text style={styles.title}>Lucy Labs</Text>
          <Text style={styles.subtitle}>
            Narrate, clone, and share, in a voice that sounds like someone real.
          </Text>
        </View>
        <AccountWidget />
        <PresetVoiceSection />
        <CloneVoiceSection />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: COLORS.background },
  scrollContent: { padding: 20, gap: 20 },
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
