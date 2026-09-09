import { randomUUID } from "crypto";
import { put, del } from "@vercel/blob";
import { recordGeneration, type Generation } from "./db";

// Only signed-in users (a real session, not just an access_token or the
// free-tier id) get generation history - keeps the number of audio blobs we
// ever store bounded to people who created an account, not all traffic.
// Generations also auto-expire (see getGenerationRetentionDays + the
// cleanup cron), so storage cost stays bounded either way.
export async function saveGenerationAudio(params: {
  userId: string;
  kind: "preset" | "clone";
  voiceLabel: string | null;
  text: string;
  audioBase64: string;
}) {
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
