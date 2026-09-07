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
import { useAudioPlayer } from "expo-audio";
import * as DocumentPicker from "expo-document-picker";

// Same backend as the web app (web/src/app/page.tsx) - set via app.json "extra"
// or an EXPO_PUBLIC_ env var. Defaults to localhost for a simulator/same-machine
// test; a physical device needs the pod's real proxy URL (Expo Go can't reach
// "localhost" meaning your own machine).
const API_BASE = process.env.EXPO_PUBLIC_API_BASE ?? "http://localhost:8000";

const PRESET_VOICES = [
  { id: "art_instructor", label: "Art Instructor" },
  { id: "music_instructor", label: "Music Instructor" },
];

function AudioResult({ url }: { url: string | null }) {
  const player = useAudioPlayer(url ? `${API_BASE}${url}` : null);
  if (!url) return null;
  return (
    <Pressable style={styles.playButton} onPress={() => player.play()}>
      <Text style={styles.playButtonText}>▶ Play result</Text>
    </Pressable>
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
    <View style={styles.card}>
      <Text style={styles.cardTitle}>Text to speech — preset voices</Text>
      <Text style={styles.cardSubtitle}>Type text, pick a voice, hear it read back.</Text>

      <TextInput
        style={styles.textArea}
        multiline
        numberOfLines={4}
        placeholder="Type what you want narrated..."
        value={text}
        onChangeText={setText}
      />

      <View style={styles.voiceRow}>
        {PRESET_VOICES.map((v) => (
          <Pressable
            key={v.id}
            style={[styles.voicePill, voiceId === v.id && styles.voicePillActive]}
            onPress={() => setVoiceId(v.id)}
          >
            <Text style={[styles.voicePillText, voiceId === v.id && styles.voicePillTextActive]}>
              {v.label}
            </Text>
          </Pressable>
        ))}
      </View>

      <Pressable
        style={[styles.button, (!text || loading) && styles.buttonDisabled]}
        disabled={!text || loading}
        onPress={handleGenerate}
      >
        {loading ? (
          <ActivityIndicator color="#fff" />
        ) : (
          <Text style={styles.buttonText}>Generate</Text>
        )}
      </Pressable>

      {error && <Text style={styles.errorText}>{error}</Text>}
      <AudioResult url={audioUrl} />
    </View>
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
    <View style={styles.card}>
      <Text style={styles.cardTitle}>Clone a voice from a clip</Text>
      <Text style={styles.cardSubtitle}>
        Upload ~10-20 seconds of a voice, type any text, hear it read back in that voice.
      </Text>

      <Pressable style={styles.filePickButton} onPress={handlePickFile}>
        <Text style={styles.filePickButtonText}>
          {file ? file.name : "Choose an audio file"}
        </Text>
      </Pressable>

      <TextInput
        style={styles.textArea}
        multiline
        numberOfLines={4}
        placeholder="Type what you want read back in the uploaded voice..."
        value={text}
        onChangeText={setText}
      />

      <Pressable
        style={[styles.button, (!text || !file || loading) && styles.buttonDisabled]}
        disabled={!text || !file || loading}
        onPress={handleGenerate}
      >
        {loading ? (
          <ActivityIndicator color="#fff" />
        ) : (
          <Text style={styles.buttonText}>Generate</Text>
        )}
      </Pressable>

      {error && <Text style={styles.errorText}>{error}</Text>}
      <AudioResult url={audioUrl} />
    </View>
  );
}

export default function App() {
  return (
    <SafeAreaView style={styles.safeArea}>
      <ScrollView contentContainerStyle={styles.scrollContent}>
        <Text style={styles.title}>Lucy</Text>
        <Text style={styles.subtitle}>
          Same backend as the web app — set EXPO_PUBLIC_API_BASE to your pod&apos;s proxy URL.
          {Platform.OS !== "web" && " On a physical device, \"localhost\" won't reach your computer."}
        </Text>
        <PresetVoiceSection />
        <CloneVoiceSection />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: "#fafafa" },
  scrollContent: { padding: 20, gap: 20 },
  title: { fontSize: 28, fontWeight: "700", color: "#111" },
  subtitle: { fontSize: 13, color: "#666", marginBottom: 8 },
  card: {
    backgroundColor: "#fff",
    borderRadius: 12,
    padding: 16,
    borderWidth: 1,
    borderColor: "#e5e5e5",
    gap: 12,
  },
  cardTitle: { fontSize: 17, fontWeight: "600", color: "#111" },
  cardSubtitle: { fontSize: 13, color: "#666", marginTop: -8 },
  textArea: {
    borderWidth: 1,
    borderColor: "#d4d4d4",
    borderRadius: 8,
    padding: 12,
    fontSize: 14,
    minHeight: 90,
    textAlignVertical: "top",
  },
  voiceRow: { flexDirection: "row", gap: 8, flexWrap: "wrap" },
  voicePill: {
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: "#d4d4d4",
  },
  voicePillActive: { backgroundColor: "#111", borderColor: "#111" },
  voicePillText: { fontSize: 13, color: "#111" },
  voicePillTextActive: { color: "#fff" },
  filePickButton: {
    borderWidth: 1,
    borderColor: "#d4d4d4",
    borderRadius: 8,
    padding: 12,
    alignItems: "center",
  },
  filePickButtonText: { fontSize: 14, color: "#111" },
  button: {
    backgroundColor: "#111",
    borderRadius: 8,
    paddingVertical: 12,
    alignItems: "center",
  },
  buttonDisabled: { opacity: 0.4 },
  buttonText: { color: "#fff", fontSize: 14, fontWeight: "600" },
  errorText: { color: "#dc2626", fontSize: 13 },
  playButton: {
    borderWidth: 1,
    borderColor: "#d4d4d4",
    borderRadius: 8,
    paddingVertical: 10,
    alignItems: "center",
  },
  playButtonText: { fontSize: 14, color: "#111" },
});
