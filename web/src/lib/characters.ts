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
    // 2026-09-11: switched from Katie to Harper's own voice - a new preset
    // zero-shot cloned from the surfing ads-demo clip's own audio (see
    // VoicePicker.tsx's PRESET_VOICES and lucy_tts_engine.py's
    // ZERO_SHOT_PRESET_VOICES), per direct request to make her voice match
    // her face/the original demo instead of reusing another voice.
    defaultVoiceId: "harper",
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
    // 2026-09-11: display name changed to Jess per direct request
    // ("change vicky's name in the video to Jess") - id stays "vicky"
    // (used as the character_id in generation jobs/URLs, not user-facing)
    // to avoid touching any stored job records; only the displayed name
    // changed. Unrelated to the separate "Vicky" label on the
    // art_instructor preset voice in VoicePicker.tsx - that's a different
    // product surface (TTS voice picker vs. character picker).
    name: "Jess",
    gender: "female",
    age: "late 20s",
    region: "Australia",
    imageUrl: "https://v3b.fal.media/files/b/0aa9eb60/GCrI6ghEIlnUFmhtS8X7v_vicky.jpg",
    // 2026-09-11: switched to Jess (renamed from Aoife - same zero-shot
    // voice, just renamed to match the character), a second/distinct
    // Irish-accented voice, per direct request ("give vicky another irish
    // accent") - was Izzy (voice_comedy), also Irish, which the user felt
    // no longer suited her face/character after living with it a while.
    defaultVoiceId: "jess",
  },
  {
    id: "marcus",
    // 2026-09-11: display name changed to Mark per direct request
    // ("rename marcus as mark") - id stays "marcus" (character_id in
    // generation jobs/URLs, not user-facing), same pattern as Vicky/Jess
    // above. His voice was already "Mark" (voice_mark), so his existing
    // character-picker clip already says "Mark" out loud - no video
    // regen needed, unlike Jess's rename which required a new clip.
    name: "Mark",
    gender: "male",
    age: "late 20s",
    region: "Nashville, USA",
    // Re-generated 2026-09-11 (v3) to a white male with reddish hair and a
    // full beard per direct request ("change marcus to a white male
    // character reddish haired beard") - v2 was a generic music-instructor
    // studio portrait, kept the same guitar/studio setting for continuity.
    imageUrl: "https://v3b.fal.media/files/b/0aa9fa6a/n5HtFS9LwobmqSacIVRGL_marcus_v3.jpg",
    defaultVoiceId: "voice_mark", // Mark - requested explicitly ("voice of mark")
  },
  {
    id: "jack",
    name: "Jack",
    gender: "male",
    age: "mid-20s",
    region: "Sydney, Australia",
    // Reverted 2026-09-11: a mid-40s v2 portrait was generated and shipped
    // earlier this same day, but the user felt the result read as looking
    // like "Brad" (his voice) rather than Jack, and asked to put Jack back
    // the way he was in the older video without spending more to
    // regenerate - reverted to the original portrait/age rather than
    // attempting a third portrait.
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
