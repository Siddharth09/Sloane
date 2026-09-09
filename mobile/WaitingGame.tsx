import { Linking, Pressable, StyleSheet, Text, View } from "react-native";

// Mirrors web/src/components/WaitingGame.tsx - shown while a generation job
// is in flight. Deliberately NOT an embedded game anymore (an earlier
// version inline-embedded beckythebat.com in a WebView) - a full
// interactive game pulled too much focus during the core paid interaction
// and diluted the brand with an unrelated product. Just a friendly apology
// plus an optional, clearly-secondary link out for anyone who wants it.
const COLORS = {
  surface: "#fffbf7",
  muted: "#9a8b83",
  border: "#f0e2d4",
  coralDark: "#d66f55",
};

export function WaitingGame() {
  return (
    <View style={styles.card}>
      <Text style={styles.text}>
        Sorry for the wait — we&apos;re just starting out, so generation can take a little while.
        We&apos;re working on making it faster.
      </Text>
      <Pressable onPress={() => Linking.openURL("https://beckythebat.com/play.html").catch(() => {})}>
        <Text style={styles.link}>Feeling patient? Play a quick game from our team while you wait →</Text>
      </Pressable>
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
    gap: 8,
    alignItems: "center",
  },
  text: { fontSize: 12, lineHeight: 17, color: COLORS.muted, textAlign: "center" },
  link: { fontSize: 12, fontWeight: "700", color: COLORS.coralDark, textDecorationLine: "underline", textAlign: "center" },
});
