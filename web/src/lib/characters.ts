/**
 * Pre-made AI actor roster (2026-09-11) - Arcads.ai-style pick-a-character
 * library. Each character is a hyper-realistic portrait generated via
 * fal-ai/flux-pro/v1.1-ultra (not a real person), hosted on fal's own CDN
 * (uploaded once, permanent URL) so generation calls don't depend on this
 * site's own hosting being reachable.
 *
 * Harper reuses the existing Bondi Beach character (a frame extracted from
 * the already-live ads-veo-demo.mp4) rather than generating a new one.
 * Vicky is a fresh visual matching her already-established voice bio (see
 * PRESET_VOICES "art_instructor" / "Vicky" - 28, Australian, works in
 * marketing) - not a recreation of a real person, a new character that
 * happens to share her name/backstory since she was voice-only until now.
 */

export type CharacterId = "harper" | "beth" | "vicky" | "marcus" | "jack";

export type Character = {
  id: CharacterId;
  name: string;
  gender: "female" | "male";
  age: string;
  region: string;
  imageUrl: string;
};

export const CHARACTERS: Character[] = [
  {
    id: "harper",
    name: "Harper",
    gender: "female",
    age: "mid-20s",
    region: "Sydney, Australia",
    imageUrl: "https://v3b.fal.media/files/b/0aa9eb60/yOpTgTwUZNYQcFCLsa822_harper.jpg",
  },
  {
    id: "beth",
    name: "Beth",
    gender: "female",
    age: "late 20s",
    region: "London, UK",
    imageUrl: "https://v3b.fal.media/files/b/0aa9eb60/Y2m8E19pk2G12R1ewoEYH_beth.jpg",
  },
  {
    id: "vicky",
    name: "Vicky",
    gender: "female",
    age: "late 20s",
    region: "Australia",
    imageUrl: "https://v3b.fal.media/files/b/0aa9eb60/GCrI6ghEIlnUFmhtS8X7v_vicky.jpg",
  },
  {
    id: "marcus",
    name: "Marcus",
    gender: "male",
    age: "late 20s",
    region: "Nashville, USA",
    imageUrl: "https://v3b.fal.media/files/b/0aa9eb61/iPWHKRCO3ZxzoPoXtCewT_marcus.jpg",
  },
  {
    id: "jack",
    name: "Jack",
    gender: "male",
    age: "mid-20s",
    region: "Sydney, Australia",
    imageUrl: "https://v3b.fal.media/files/b/0aa9eb61/6_ml_AMMqKfis0tvQBm8G_jack.jpg",
  },
];

export function getCharacter(id: string): Character | undefined {
  return CHARACTERS.find((c) => c.id === id);
}

/**
 * Cost of one character video, in the same "video credits" unit the Video
 * plan's `videoCreditsPerMonth` already tracks (see plans.ts - 1 credit =
 * 1s of talking-head, 1 credit = 1/3s of cinematic). A Lucy-voice video
 * goes through Kling Avatar (the existing talking-head mechanism) so it
 * costs the talking-head rate; a Veo-voice video is the cinematic
 * mechanism so it costs that rate instead. Deliberately reuses these
 * existing conversion rates rather than inventing a new price - this
 * feature draws from the SAME 40-credit/month pool the Video plan already
 * promises, not a new purchase.
 */
export const CHARACTER_VIDEO_DURATION_SECONDS = 8;
export const LUCY_VOICE_CREDIT_COST = 8; // 8s x 1 credit/s (talking-head rate)
export const VEO_VOICE_CREDIT_COST = 24; // 8s x 3 credits/s (cinematic rate, 1 credit = 1/3s)
