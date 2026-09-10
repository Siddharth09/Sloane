# Video/image research assets (archived 2026-09-11)

Real generated media from this project's video-model research, saved to git so nothing is lost when local scratch directories get cleaned up. Production assets actually used on the live site live under `web/public/` instead (voice-samples, character-samples, trailers) - this folder is reference/investigation material.

## `character-picker/candidate-portraits/`
All 10 original AI-actor candidates generated via `fal-ai/flux-pro/v1.1-ultra` when deciding the roster (STATUS.md "Sixth" section). Final 5 kept: `harper`, `beth` (was called `isla` during generation), `vicky`, `marcus`, `jack`. Not used: `priya`, `chloe`, `amara`, `diego`, `raj`, `tom`.

## `character-picker/veo-identity-drift-tests/`
The real Veo image-to-video test clips that led to dropping the "character's own voice" option entirely - each one shows a visibly different person than the reference portrait, even with a low-motion "stand still and talk" prompt. `beth_website_ad.mp4` + its frame is the earlier "Beth demos the website" test that first caught this problem.

## `character-picker/kling-tests/`
`kling_avatar_test.mp4` - the test that confirmed Kling Avatar (unlike Veo) reliably preserves character identity; matches Beth's reference exactly. `kling_elements_test.mp4` - the multi-image product-ad test (Beth + a test product) that avoided Seedance's content-policy block but showed identity drift and label-text distortion instead.

## `product-ad-tests/`
`test_product.jpg` - a synthetic product image (clear "LUCY LABS" text) used to objectively test logo/text fidelity across engines, since a real product photo wouldn't let us tell if distortion happened.

## `bondi-ad-iterations/`
The three real iterations of the Bondi Beach ads-mode demo video (now live at `web/public/trailers/ads-veo-demo.mp4`): `v1_mispronounced.mp4` (first attempt, "Bondi" said wrong), `v3_final_correct_pronunciation.mp4` (the shipped version, fixed by respelling the word phonetically in the literal script rather than as a separate pronunciation instruction), and the character reference frame used to keep her consistent across both.
