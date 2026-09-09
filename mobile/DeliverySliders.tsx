import { StyleSheet, Text, View } from "react-native";
import Slider from "@react-native-community/slider";

export type Delivery = { expressiveness: number; speed: number };
export const DEFAULT_DELIVERY: Delivery = { expressiveness: 0.6, speed: 1.0 };

// Mirrors web/src/components/DeliverySliders.tsx - same two honestly-labeled
// controls (real generation params, not a fake "happy/sad" knob), same
// ranges/defaults, so behavior matches across web and mobile.
export function DeliverySliders({
  value,
  onChange,
  accentColor,
}: {
  value: Delivery;
  onChange: (d: Delivery) => void;
  accentColor: string;
}) {
  return (
    <View style={{ gap: 12 }}>
      <View>
        <View style={styles.labelRow}>
          <Text style={styles.label}>Expressiveness</Text>
          <Text style={styles.value}>{value.expressiveness < 0.55 ? "Flat" : value.expressiveness > 0.75 ? "Animated" : "Natural"}</Text>
        </View>
        <Slider
          minimumValue={0.3}
          maximumValue={1.0}
          value={value.expressiveness}
          onValueChange={(v) => onChange({ ...value, expressiveness: v })}
          minimumTrackTintColor={accentColor}
          maximumTrackTintColor="#f0e2d4"
          thumbTintColor={accentColor}
        />
      </View>
      <View>
        <View style={styles.labelRow}>
          <Text style={styles.label}>Speed</Text>
          <Text style={styles.value}>{value.speed < 0.9 ? "Slower" : value.speed > 1.1 ? "Faster" : "Normal"}</Text>
        </View>
        <Slider
          minimumValue={0.7}
          maximumValue={1.3}
          value={value.speed}
          onValueChange={(v) => onChange({ ...value, speed: v })}
          minimumTrackTintColor={accentColor}
          maximumTrackTintColor="#f0e2d4"
          thumbTintColor={accentColor}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  labelRow: { flexDirection: "row", justifyContent: "space-between", marginBottom: 2 },
  label: { fontSize: 12, fontWeight: "600", color: "#3d3330" },
  value: { fontSize: 12, color: "#9a8b83" },
});
