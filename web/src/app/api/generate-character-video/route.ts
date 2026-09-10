import { NextRequest, NextResponse } from "next/server";
import {
  initSchema,
  getSubscriberByToken,
  checkVideoCreditQuota,
  createCharacterVideoJob,
  setCharacterVideoJobModalId,
  setCharacterVideoJobRequestId,
  failCharacterVideoJob,
} from "@/lib/db";
import { getCharacter, LUCY_VOICE_CREDIT_COST, VEO_VOICE_CREDIT_COST } from "@/lib/characters";
import { PRESET_VOICES } from "@/components/VoicePicker";
import { submitFalJob } from "@/lib/fal";
import { submitModalJob } from "@/lib/modal";

const MAX_SCRIPT_LENGTH = 400;
const MAX_PRODUCT_DESC_LENGTH = 300;
const KLING_AVATAR_ENDPOINT = "fal-ai/kling-video/ai-avatar/v2/standard";
const VEO_ENDPOINT = "fal-ai/veo3.1/fast";

// Pick a character, choose a voice (a Lucy preset -> generates TTS then
// lip-syncs it onto the character via Kling Avatar; "veo" -> Veo generates
// its own dialogue and voice directly), type a script, get a video. Billed
// against the Video plan's existing video-credit allotment (see
// checkVideoCreditQuota) - this is a subscription perk, not a separate
// purchase, so it needs an access_token the same way audio generation does.
export async function POST(req: NextRequest) {
  try {
    await initSchema();
    const body = await req.json();
    const accessToken = String(body.access_token ?? "");
    const characterId = String(body.character_id ?? "");
    const voiceChoice = String(body.voice_choice ?? "");
    const script = String(body.script ?? "").trim();
    const productDescription = String(body.product_description ?? "").trim();

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
    if (productDescription.length > MAX_PRODUCT_DESC_LENGTH) {
      return NextResponse.json({ error: `Product description is too long (max ${MAX_PRODUCT_DESC_LENGTH} characters)` }, { status: 400 });
    }

    const isVeoVoice = voiceChoice === "veo";
    const lucyVoice = PRESET_VOICES.find((v) => v.id === voiceChoice);
    if (!isVeoVoice && !lucyVoice) {
      return NextResponse.json({ error: "Unknown voice choice" }, { status: 400 });
    }

    const creditsCost = isVeoVoice ? VEO_VOICE_CREDIT_COST : LUCY_VOICE_CREDIT_COST;
    const quotaError = checkVideoCreditQuota(sub, creditsCost);
    if (quotaError) {
      return NextResponse.json({ error: quotaError }, { status: 402 });
    }

    const falEndpoint = isVeoVoice ? VEO_ENDPOINT : KLING_AVATAR_ENDPOINT;
    const jobId = await createCharacterVideoJob({
      accessToken,
      characterId,
      voiceChoice,
      script,
      creditsCost,
      falEndpoint,
    });

    try {
      if (isVeoVoice) {
        const productContext = productDescription
          ? ` She is presenting this product (no reference image available, so approximate it from this description only): ${productDescription}.`
          : "";
        const prompt = `${character.name} looks directly at camera and says clearly: "${script}".${productContext} Hyper-realistic, photographic quality, natural lip sync.`;
        const requestId = await submitFalJob(VEO_ENDPOINT, {
          prompt,
          image_url: character.imageUrl,
          duration: "8s",
          resolution: "720p",
          generate_audio: true,
        });
        await setCharacterVideoJobRequestId(jobId, requestId);
      } else {
        // Lucy-voice path: generate the TTS audio first (via the same
        // Modal backend generate-preset/clone-voice already use), then
        // (once that job completes, checked in status/route.ts) upload it
        // to fal storage and submit Kling Avatar with the character image.
        const { jobId: modalJobId } = await submitModalJob({
          action: "generate-preset",
          text: script,
          voice_id: voiceChoice,
        });
        await setCharacterVideoJobModalId(jobId, modalJobId);
      }
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
