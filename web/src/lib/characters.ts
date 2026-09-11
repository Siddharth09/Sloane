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
  // Default Lucy voice for this character's click-to-preview clip and as
  // the pre-selected option in the generation UI. Original assignments
  // (2026-09-11) were picked purely by requested accent; three were
  // reassigned same day per direct real-ear feedback after hearing them:
  // Harper -> Katie (was Mark - same Australian accent, just clearer),
  // Vicky -> Izzy (was Rachel - "Vicky's voice is not clear"), Marcus ->
  // Mark (was Adam, per direct request - note this makes Marcus's voice
  // Australian-accented even though his backstory is Nashville, a real,
  // deliberate override of the earlier accent-matching logic, not an
  // oversight). Beth/Jack unchanged (Alice/Brad, both explicitly requested
  // by name from the start). Users can still pick a different Lucy voice
  // when actually generating - this is just the sensible default.
  defaultVoiceId: string;
};

export const CHARACTERS: Character[] = [
  {
    id: "harper",
    name: "Harper",
    gender: "female",
    age: "mid-20s",
    region: "Sydney, Australia",
    imageUrl: "https://v3b.fal.media/files/b/0aa9eb60/yOpTgTwUZNYQcFCLsa822_harper.jpg",
    defaultVoiceId: "voice_broadcast", // Katie - Australian accent, requested explicitly ("same as katie")
  },
  {
    id: "beth",
    name: "Beth",
    gender: "female",
    age: "late 20s",
    region: "London, UK",
    imageUrl: "https://v3b.fal.media/files/b/0aa9eb60/Y2m8E19pk2G12R1ewoEYH_beth.jpg",
    defaultVoiceId: "voice_business", // Alice - UK, requested explicitly ("like Alice")
  },
  {
    id: "vicky",
    name: "Vicky",
    gender: "female",
    age: "late 20s",
    region: "Australia",
    imageUrl: "https://v3b.fal.media/files/b/0aa9eb60/GCrI6ghEIlnUFmhtS8X7v_vicky.jpg",
    defaultVoiceId: "voice_comedy", // Izzy - requested explicitly ("make it like izzy's voice")
  },
  {
    id: "marcus",
    name: "Marcus",
    gender: "male",
    age: "late 20s",
    region: "Nashville, USA",
    // Re-generated 2026-09-11 to look more like a music instructor (guitar,
    // teaching studio) per direct request - was a generic studio portrait.
    imageUrl: "https://v3b.fal.media/files/b/0aa9ed98/31mAICP5_1aZQawWNnVT8_marcus_v2.jpg",
    defaultVoiceId: "voice_mark", // Mark - requested explicitly ("voice of mark")
  },
  {
    id: "jack",
    name: "Jack",
    gender: "male",
    age: "mid-20s",
    region: "Sydney, Australia",
    imageUrl: "https://v3b.fal.media/files/b/0aa9eb61/6_ml_AMMqKfis0tvQBm8G_jack.jpg",
    defaultVoiceId: "voice_tech", // Brad - Australian accent, requested explicitly ("like Brad")
  },
];

export function getCharacter(id: string): Character | undefined {
  return CHARACTERS.find((c) => c.id === id);
}

/**
 * Cost of one character video, in the same "video credits" unit the Video
 * plan's `videoCreditsPerMonth` already tracks (see plans.ts - 1 credit =
 * 1s of talking-head). Every character video goes through Kling Avatar
 * (the existing talking-head mechanism) so it costs that rate - deliberately
 * reuses this existing conversion rather than inventing a new price, and
 * draws from the SAME 40-credit/month pool the Video plan already promises,
 * not a new purchase.
 *
 * There was also a "character's own voice" option via Veo, which would have
 * cost the pricier cinematic rate (24 credits) - removed 2026-09-11 after
 * real testing showed Veo's image-to-video does not reliably preserve
 * character identity (3/3 tests produced a visibly different person than
 * the reference photo, even with minimal motion). Kling Avatar animates the
 * exact reference photo to match audio rather than regenerating the scene,
 * which is why it's reliable and Veo wasn't - see STATUS.md "Sixth" section
 * for the full story before re-attempting a Veo-voice option.
 */
export const LUCY_VOICE_CREDIT_COST = 8; // 8s x 1 credit/s (talking-head rate)
