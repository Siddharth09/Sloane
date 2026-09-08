import { Linking, StyleSheet, Text, View } from "react-native";

// Mirrors web/src/components/Footer.tsx - same company attribution, support
// contact, and privacy link, just native-styled. The privacy policy itself
// only exists as a web page (web/src/app/privacy/page.tsx), so this opens it
// in the device browser rather than duplicating the content natively.
const WEB_BASE = process.env.EXPO_PUBLIC_WEB_BASE ?? "https://lucylabs.app";

const COLORS = {
  surface: "#fffbf7",
  foreground: "#3d3330",
  muted: "#9a8b83",
  border: "#f0e2d4",
  coralDark: "#d66f55",
};

export function Footer() {
  return (
    <View style={styles.footer}>
      <Text style={styles.name}>Lucy Labs</Text>
      <Text style={styles.muted}>Part of the Astryks Group</Text>
      <View style={styles.linkRow}>
        <Text style={styles.link} onPress={() => Linking.openURL("mailto:support@astryks.com")}>
          support@astryks.com
        </Text>
        <Text style={styles.muted}> · </Text>
        <Text style={styles.link} onPress={() => Linking.openURL(`${WEB_BASE}/privacy`)}>
          Privacy Policy
        </Text>
        <Text style={styles.muted}> · </Text>
        <Text style={styles.link} onPress={() => Linking.openURL(`${WEB_BASE}/account`)}>
          Account
        </Text>
      </View>
      <Text style={styles.copyright}>© {new Date().getFullYear()} Astryks Group. All rights reserved.</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  footer: {
    backgroundColor: COLORS.surface,
    borderRadius: 24,
    padding: 20,
    borderWidth: 1,
    borderColor: COLORS.border,
    alignItems: "center",
    marginBottom: 8,
  },
  name: { fontSize: 13, fontWeight: "700", color: COLORS.foreground },
  muted: { fontSize: 11, color: COLORS.muted, marginTop: 2 },
  linkRow: { flexDirection: "row", marginTop: 10, flexWrap: "wrap", justifyContent: "center" },
  link: { fontSize: 11, color: COLORS.coralDark, fontWeight: "600", textDecorationLine: "underline" },
  copyright: { fontSize: 11, color: COLORS.muted, marginTop: 14 },
});
