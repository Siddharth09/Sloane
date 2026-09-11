import { NextRequest, NextResponse } from "next/server";
import {
  initSchema,
  getSubscriberByToken,
  checkVideoCreditQuota,
  createCharacterVideoJob,
  setCharacterVideoJobModalId,
  failCharacterVideoJob,
} from "@/lib/db";
import { getCharacter, LUCY_VOICE_CREDIT_COST } from "@/lib/characters";
import { PRESET_VOICES } from "@/components/VoicePicker";
import { submitModalJob } from "@/lib/modal";

const MAX_SCRIPT_LENGTH = 400;
const MAX_REFERENCE_AUDIO_BYTES = 7 * 1024 * 1024; // same cap as /api/clone-voice
const KLING_AVATAR_ENDPOINT = "fal-ai/kling-video/ai-avatar/v2/standard";

// Pick a character, choose ANY Lucy voice (or clone your own from a short
// audio sample - added 2026-09-11, previously locked to the character's
// single default voice), type a script, get a video. Lucy-voice-only (via
// Kling Avatar lip-sync) - the "character's own voice" (Veo) option was
// removed 2026-09-11 after real testing showed Veo's image-to-video does
// not reliably preserve character identity (in 3/3 tests it generated a
// visibly different person), where Kling Avatar (animates the exact
// reference photo to match audio, rather than regenerating the scene)
// reliably does. Billed against the Video plan's existing video-credit
// allotment (see checkVideoCreditQuota) - a subscription perk, not a
// separate purchase, so it needs an access_token the same way audio
// generation does. Switched from JSON to multipart/form-data to accept the
// optional own-voice audio upload.
export async function POST(req: NextRequest) {
  try {
    await initSchema();
    const form = await req.formData();
    const accessToken = String(form.get("access_token") ?? "");
    const characterId = String(form.get("character_id") ?? "");
    const voiceChoice = String(form.get("voice_choice") ?? ""); // preset id, or "__own__" to clone from upload
    const script = String(form.get("script") ?? "").trim();
    const referenceAudio = form.get("reference_audio");

    if (!accessToken) {
      return NextResponse.json({ error: "Sign in with your access code to use character videos" }, { status: 401 });
    }
    const sub = await getSubscriberByToken(accessToken);
    if (!sub) {
      return NextResponse.json({ error: "Access code not recognized" }, { status: 401 });
    }

    const character = getCharacter(characterId);
    if (!character) {
      return NextResponse.json({ error: "Unknown character" }, { status: 400 });
    }
    if (!script) {
      return NextResponse.json({ error: "Script is required" }, { status: 400 });
    }
    if (script.length > MAX_SCRIPT_LENGTH) {
      return NextResponse.json({ error: `Script is too long (max ${MAX_SCRIPT_LENGTH} characters)` }, { status: 400 });
    }
    const useOwnVoice = voiceChoice === "__own__";
    if (!useOwnVoice && !PRESET_VOICES.find((v) => v.id === voiceChoice)) {
      return NextResponse.json({ error: "Unknown voice choice" }, { status: 400 });
    }
    if (useOwnVoice) {
      if (!(referenceAudio instanceof Blob)) {
        return NextResponse.json({ error: "A short audio sample of your voice is required" }, { status: 400 });
      }
      if (referenceAudio.size > MAX_REFERENCE_AUDIO_BYTES) {
        return NextResponse.json(
          { error: `Audio sample is too large (max ${Math.round(MAX_REFERENCE_AUDIO_BYTES / 1024 / 1024)}MB)` },
          { status: 400 },
        );
      }
    }

    const quotaError = checkVideoCreditQuota(sub, LUCY_VOICE_CREDIT_COST);
    if (quotaError) {
      return NextResponse.json({ error: quotaError }, { status: 402 });
    }

    const jobId = await createCharacterVideoJob({
      accessToken,
      characterId,
      voiceChoice,
      script,
      creditsCost: LUCY_VOICE_CREDIT_COST,
      falEndpoint: KLING_AVATAR_ENDPOINT,
    });

    try {
      // Generate the TTS/clone audio first (via the same Modal backend
      // generate-preset/clone-voice already use), then (once that job
      // completes, checked in status/route.ts) upload it to fal storage
      // and submit Kling Avatar with the character image.
      const { jobId: modalJobId } = useOwnVoice
        ? await submitModalJob({
            action: "clone-voice",
            text: script,
            reference_audio_base64: Buffer.from(await (referenceAudio as Blob).arrayBuffer()).toString("base64"),
          })
        : await submitModalJob({ action: "generate-preset", text: script, voice_id: voiceChoice });
      await setCharacterVideoJobModalId(jobId, modalJobId);
      return NextResponse.json({ jobId });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Submission failed";
      await failCharacterVideoJob(jobId, message);
      return NextResponse.json({ error: message }, { status: 500 });
    }
  } catch (err) {
    console.error("generate-character-video failed", err);
    const message = err instanceof Error ? err.message : "Generation failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
