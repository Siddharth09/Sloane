import { useState } from "react";
import {
  ActivityIndicator,
  Platform,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { useAudioPlayer } from "expo-audio";
import * as DocumentPicker from "expo-document-picker";

// Same backend as the web app (web/src/app/page.tsx) - set via app.json "extra"
// or an EXPO_PUBLIC_ env var. Defaults to localhost for a simulator/same-machine
// test; a physical device needs the pod's real proxy URL (Expo Go can't reach
// "localhost" meaning your own machine).
const API_BASE = process.env.EXPO_PUBLIC_API_BASE ?? "http://localhost:8000";

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
};

const PRESET_VOICES = [
  { id: "art_instructor", label: "Art Instructor", color: COLORS.rose, initial: "A" },
  { id: "music_instructor", label: "Music Instructor", color: COLORS.sage, initial: "M" },
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
  const player = useAudioPlayer(url ? `${API_BASE}${url}` : null);
  if (!url) return null;
  return (
    <Pressable style={styles.playButton} onPress={() => player.play()}>
      <Text style={styles.playButtonText}>▶ Play result</Text>
    </Pressable>
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
  const [text, setText] = useState("");
  const [voiceId, setVoiceId] = useState(PRESET_VOICES[0].id);
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
      const res = await fetch(`${API_BASE}/api/generate-preset`, { method: "POST", body: form });
      if (!res.ok) throw new Error(`Request failed (${res.status})`);
      const data = await res.json();
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
                <Text style={styles.voiceCircleText}>{v.initial}</Text>
              </View>
              <Text style={[styles.voiceLabel, selected && styles.voiceLabelSelected]}>
                {v.label}
              </Text>
            </Pressable>
          );
        })}
      </View>

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
  const [text, setText] = useState("");
  const [file, setFile] = useState<DocumentPicker.DocumentPickerAsset | null>(null);
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
      const res = await fetch(`${API_BASE}/api/clone-voice`, { method: "POST", body: form });
      if (!res.ok) throw new Error(`Request failed (${res.status})`);
      const data = await res.json();
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
          <LinearGradient colors={[COLORS.rose, COLORS.coral]} style={styles.logoMark}>
            <Text style={styles.logoMarkText}>L</Text>
          </LinearGradient>
          <Text style={styles.title}>Lucy</Text>
          <Text style={styles.subtitle}>
            by Lucy Labs — narrate, clone, and share, in a voice that sounds like someone real.
            {Platform.OS !== "web" &&
              ' Set EXPO_PUBLIC_API_BASE to your pod\'s proxy URL — "localhost" won\'t reach your computer from a device.'}
          </Text>
        </View>
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
  logoMark: {
    width: 56,
    height: 56,
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 8,
  },
  logoMarkText: { color: "#fff", fontSize: 22, fontWeight: "800" },
  title: { fontSize: 30, fontWeight: "800", color: COLORS.foreground },
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
  voiceRow: { flexDirection: "row", gap: 20 },
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
});
