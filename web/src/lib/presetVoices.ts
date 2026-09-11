// Plain data, deliberately NOT in VoicePicker.tsx (a "use client" file) -
// real bug found 2026-09-12 testing "a Lucy voice" on pay-as-you-go: a
// server Route Handler importing PRESET_VOICES from a "use client" module
// got back something Turbopack's route bundler doesn't treat as a plain
// array (`PRESET_VOICES.find is not a function` at runtime, only inside
// route.ts - VoicePicker.tsx itself rendered fine, since that's the
// boundary Next actually expects "use client" imports to cross). Moving
// the data here means server code never crosses a client-component
// boundary just to read a constant. VoicePicker.tsx re-exports both names
// so existing imports elsewhere don't need to change.
export type Voice = { id: string; label: string; color: string; initial: string };

export const PRESET_VOICES: Voice[] = [
  { id: "art_instructor", label: "Vicky", color: "bg-rose", initial: "V" },
  { id: "music_instructor", label: "Patrick", color: "bg-sage", initial: "P" },
  { id: "voice_business", label: "Alice", color: "bg-pink", initial: "A" },
  { id: "voice_finance", label: "Megan", color: "bg-blue", initial: "M" },
  { id: "voice_broadcast", label: "Katie", color: "bg-purple", initial: "K" },
  { id: "voice_tech", label: "Brad", color: "bg-butter", initial: "B" },
  { id: "voice_comedy", label: "Izzy", color: "bg-lavender", initial: "I" },
  { id: "voice_sales", label: "Robbo", color: "bg-coral", initial: "R" },
  { id: "voice_mark", label: "Mark", color: "bg-sage", initial: "M" },
  // Adam/Rachel added 2026-09-10 - 11 voices, only 9 defined brand colors,
  // so these reuse existing ones (freed bg-coral-dark from Michelle's
  // removal; bg-rose shared with Vicky) rather than inventing new ones -
  // same documented design constraint as Patrick/Mark sharing bg-sage.
  { id: "voice_adam", label: "Adam", color: "bg-coral-dark", initial: "A" },
  { id: "voice_rachel", label: "Rachel", color: "bg-rose", initial: "R" },
  // Harper (2026-09-11) - zero-shot cloned from the surfing ads-demo clip's
  // own audio (see scripts/lucy_tts_engine.py's ZERO_SHOT_PRESET_VOICES),
  // not a real fine-tune - honest quality expectation is a rougher
  // approximation than the fine-tuned LoRA voices above, each trained
  // on many minutes of real source audio. Reuses bg-pink (already Alice's)
  // - same documented color-reuse constraint as Patrick/Mark sharing sage.
  { id: "harper", label: "Harper", color: "bg-pink", initial: "H" },
  // 2026-09-11: jess (second, distinct Irish accent - see characters.ts,
  // now Jess/formerly-Vicky's character-video default; originally named
  // "Aoife", renamed to "Jess" per direct request to match the character's
  // own renaming) + liam/ryan/tyler ("male version of Izzy/Katie/Harper",
  // matched by accent/vibe not timbre). All 4 are zero-shot from
  // Veo-generated reference clips, same honest-quality caveat as Harper
  // above - reuses colors per the same documented 9-colors-for-more-voices
  // constraint.
  { id: "jess", label: "Jess", color: "bg-lavender", initial: "J" },
  { id: "liam", label: "Liam", color: "bg-purple", initial: "L" },
  { id: "ryan", label: "Ryan", color: "bg-butter", initial: "R" },
  { id: "tyler", label: "Tyler", color: "bg-coral", initial: "T" },
];
