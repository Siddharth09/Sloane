import { StyleSheet, Text, View } from "react-native";
import { WebView } from "react-native-webview";

// Mirrors web/src/components/WaitingGame.tsx - shown while a generation job
// is in flight. Cold starts on the Serverless endpoint (see STATUS.md
// "Serverless migration") mean a 20-60+ second wait is now normal, not a
// rare edge case - this gives people something to do instead of a bare
// spinner. beckythebat.com/play.html is our own game (Astryks Group owns
// both Lucy Labs and Becky the Bat), so there's no third-party permission
// concern in embedding it.
const COLORS = {
  surface: "#fffbf7",
  foreground: "#3d3330",
  muted: "#9a8b83",
  border: "#f0e2d4",
};

export function WaitingGame() {
  return (
    <View style={styles.card}>
      <Text style={styles.text}>
        We&apos;re just starting out, so generation can take a little while — we&apos;re working on making
        it faster. In the meantime, here&apos;s a quick game made by our team at Astryks if you&apos;d like
        something to do while you wait.
      </Text>
      <WebView source={{ uri: "https://beckythebat.com/play.html" }} style={styles.webview} />
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: 16,
    borderWidth: 1,
    borderStyle: "dashed",
    borderColor: COLORS.border,
    backgroundColor: COLORS.surface,
    padding: 12,
    gap: 10,
  },
  text: { fontSize: 12, lineHeight: 17, color: COLORS.muted },
  webview: { height: 220, borderRadius: 12, overflow: "hidden" },
});
