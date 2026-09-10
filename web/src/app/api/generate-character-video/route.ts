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
const KLING_AVATAR_ENDPOINT = "fal-ai/kling-video/ai-avatar/v2/standard";

// Pick a character, choose a Lucy voice, type a script, get a video.
// Lucy-voice-only (via Kling Avatar lip-sync) - the "character's own voice"
// (Veo) option was removed 2026-09-11 after real testing showed Veo's
// image-to-video does not reliably preserve character identity (in 3/3
// tests it generated a visibly different person), where Kling Avatar
// (animates the exact reference photo to match audio, rather than
// regenerating the scene) reliably does. Billed against the Video plan's
// existing video-credit allotment (see checkVideoCreditQuota) - a
// subscription perk, not a separate purchase, so it needs an access_token
// the same way audio generation does.
export async function POST(req: NextRequest) {
  try {
    await initSchema();
    const body = await req.json();
    const accessToken = String(body.access_token ?? "");
    const characterId = String(body.character_id ?? "");
    const voiceChoice = String(body.voice_choice ?? "");
    const script = String(body.script ?? "").trim();

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
    if (!PRESET_VOICES.find((v) => v.id === voiceChoice)) {
      return NextResponse.json({ error: "Unknown voice choice" }, { status: 400 });
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
      // Generate the TTS audio first (via the same Modal backend generate-
      // preset/clone-voice already use), then (once that job completes,
      // checked in status/route.ts) upload it to fal storage and submit
      // Kling Avatar with the character image.
      const { jobId: modalJobId } = await submitModalJob({
        action: "generate-preset",
        text: script,
        voice_id: voiceChoice,
      });
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
