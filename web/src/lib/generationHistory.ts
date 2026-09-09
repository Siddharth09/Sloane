import { randomUUID } from "crypto";
import { put, del } from "@vercel/blob";
import { recordGeneration, type Generation } from "./db";

// Only signed-in users (a real session, not just an access_token or the
// free-tier id) get generation history - keeps the number of audio blobs we
// ever store bounded to people who created an account, not all traffic.
// Generations also auto-expire (see getGenerationRetentionDays + the
// cleanup cron), so storage cost stays bounded either way.
// Deliberately swallows its own errors (Blob outage, missing token, DB
// hiccup) rather than letting them propagate - this is a nice-to-have side
// effect of a generation, not part of its contract. A caller sits inside
// the same try/catch as the actual audio response, so an unhandled throw
// here would fail generation entirely for signed-in users over a feature
// that has nothing to do with whether generation itself succeeded.
export async function saveGenerationAudio(params: {
  userId: string;
  kind: "preset" | "clone";
  voiceLabel: string | null;
  text: string;
  audioBase64: string;
}) {
  try {
    const buffer = Buffer.from(params.audioBase64, "base64");
    const blob = await put(`generations/${params.userId}/${randomUUID()}.wav`, buffer, {
      access: "public",
      contentType: "audio/wav",
      addRandomSuffix: false,
    });
    await recordGeneration({
      userId: params.userId,
      kind: params.kind,
      voiceLabel: params.voiceLabel,
      textPreview: params.text.slice(0, 200),
      audioUrl: blob.url,
    });
  } catch (err) {
    console.error("[generationHistory] failed to save generation, continuing without it", err);
  }
}

export async function deleteGenerationBlob(generation: Generation) {
  try {
    await del(generation.audio_url);
  } catch (err) {
    // Blob may already be gone (manual cleanup, prior partial run) - don't
    // let that block deleting the now-stale DB row.
    console.error("[generationHistory] failed to delete blob", generation.audio_url, err);
  }
}
