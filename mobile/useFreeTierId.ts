import { useEffect, useState } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";

const STORAGE_KEY = "lucy_free_tier_id";

/**
 * Mirrors web/src/lib/useFreeTierId.ts - a random id kept in on-device
 * storage, sent with generate-preset/clone-voice when there's no access
 * token, so the free tier's 10,000 chars/mo can actually be tracked and
 * enforced server-side instead of just a soft per-request cap.
 */
export function useFreeTierId() {
  const [id, setId] = useState<string | null>(null);

  useEffect(() => {
    AsyncStorage.getItem(STORAGE_KEY)
      .then(async (stored) => {
        if (stored) return stored;
        const fresh = (globalThis.crypto as Crypto | undefined)?.randomUUID
          ? crypto.randomUUID()
          : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
        await AsyncStorage.setItem(STORAGE_KEY, fresh);
        return fresh;
      })
      .then(setId)
      .catch(() => setId(`${Date.now()}-${Math.random().toString(36).slice(2)}`));
  }, []);

  return id;
}
