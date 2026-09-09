import { useEffect, useState } from "react";
import { Linking, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { useAccessToken } from "./useAccessToken";

// Same backend host the rest of the app calls (billing status/checkout live
// on the Next.js web app, not the GPU inference server).
const WEB_BASE = process.env.EXPO_PUBLIC_WEB_BASE ?? "https://www.lucylabs.app";

type Status = {
  plan: string;
  status: string;
  charactersUsed: number;
  charactersLimit: number;
  videoCreditsUsed: number;
  videoCreditsLimit: number;
};

const COLORS = {
  surface: "#fffbf7",
  foreground: "#3d3330",
  muted: "#9a8b83",
  border: "#f0e2d4",
  coral: "#e8846b",
  coralDark: "#d66f55",
};

export function AccountWidget() {
  const { token, setToken, loaded } = useAccessToken();
  const [status, setStatus] = useState<Status | null>(null);
  const [codeInput, setCodeInput] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!token) {
      setStatus(null);
      return;
    }
    fetch(`${WEB_BASE}/api/billing/status?token=${encodeURIComponent(token)}`)
      .then((r) => r.json())
      .then((data) => {
        if (data.error) {
          setError(data.error);
          setStatus(null);
        } else {
          setStatus(data);
          setError(null);
        }
      })
      .catch(() => setError("Couldn't reach the account server."));
  }, [token]);

  if (!loaded) return null;

  if (!token) {
    return (
      <View style={styles.card}>
        <Text style={styles.muted}>Free tier: 10,000 characters. Have an access code from checkout?</Text>
        <View style={styles.row}>
          <TextInput
            style={styles.input}
            placeholder="lucy_..."
            placeholderTextColor={COLORS.muted}
            value={codeInput}
            onChangeText={setCodeInput}
            autoCapitalize="none"
          />
          <Pressable style={styles.saveButton} onPress={() => codeInput && setToken(codeInput.trim())}>
            <Text style={styles.saveButtonText}>Save</Text>
          </Pressable>
        </View>
        <Pressable onPress={() => Linking.openURL(`${WEB_BASE}/billing`).catch(() => {})}>
          <Text style={styles.link}>See plans →</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <View style={styles.card}>
      {error ? (
        <>
          <Text style={styles.errorText}>{error}</Text>
          <Pressable onPress={() => setToken(null)}>
            <Text style={styles.link}>Remove this code</Text>
          </Pressable>
        </>
      ) : status ? (
        <>
          <Text style={styles.planText}>{status.plan} plan</Text>
          <Text style={styles.muted}>
            {status.charactersUsed.toLocaleString()} / {status.charactersLimit.toLocaleString()} characters used this period
            {status.videoCreditsLimit > 0 && ` · ${status.videoCreditsUsed}/${status.videoCreditsLimit} video credits`}
          </Text>
          <Pressable onPress={() => Linking.openURL(`${WEB_BASE}/billing`).catch(() => {})}>
            <Text style={styles.link}>Manage plan →</Text>
          </Pressable>
        </>
      ) : (
        <Text style={styles.muted}>Checking your account…</Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: COLORS.surface,
    borderRadius: 20,
    padding: 16,
    borderWidth: 1,
    borderColor: COLORS.border,
    gap: 8,
    alignItems: "center",
  },
  muted: { fontSize: 13, color: COLORS.muted, textAlign: "center" },
  planText: { fontSize: 14, fontWeight: "700", color: COLORS.foreground },
  errorText: { fontSize: 13, color: COLORS.coralDark, textAlign: "center" },
  row: { flexDirection: "row", gap: 8, width: "100%" },
  input: {
    flex: 1,
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: 999,
    paddingHorizontal: 14,
    paddingVertical: 8,
    fontSize: 13,
    backgroundColor: "#fff",
    color: COLORS.foreground,
  },
  saveButton: {
    backgroundColor: COLORS.coral,
    borderRadius: 999,
    paddingHorizontal: 16,
    justifyContent: "center",
  },
  saveButtonText: { color: "#fff", fontSize: 13, fontWeight: "700" },
  link: { color: COLORS.coralDark, fontSize: 12, fontWeight: "600" },
});
