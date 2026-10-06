# AGENTS

## Notes for agents
- Follow the product and identity principles in [README.md](README.md#rivolo-and-ait-identities).
- Changing app identity in Appearance is only cosmetic. No features are affected.
- Favor small, reviewable changes; avoid mixing unrelated edits.
- Keep UI changes aligned with existing visual style.
- Verify affected UI flows with desktop keyboard/mouse and narrow mobile touch layouts. Make sure app changes work well as a PWA, including iOS Safari and installed mode; report device-specific checks that could not be performed.
- Treat responsive behavior as a requirement: verify layout at narrow widths, preserve readable typography, and avoid overflow/clip.
- Design for touch: ensure tap targets, spacing, and scroll/keyboard interactions feel correct on phones.
- Account for mobile Safari/PWA quirks (safe areas, viewport height, back/forward gestures, standalone mode).
- Check identity-sensitive changes in Rivolo and AIT, including titles, logos, installation icons, and manifests.
- Before changing sync, inspect the other implemented providers and shared sync logic. Explain whether the change is provider-specific or applies across providers. When that scope requires an unresolved product decision, ask the user.
- For changes to shared-note merging or sync, verify the relevant cases involving concurrent edits, offline reconnection, retries, and deletions. Preserve unrelated edits and make conflicts recoverable.
- If you get stuck, propose the user to update this file.
- Do not remove user data or reset storage without explicit request.
- Avoid destructive git commands; keep working tree clean.
- Build new features on a branch and open a PR. For GUI changes, include before/after screenshots and the Cloudflare Pages preview URL to test with, which is listed in the PR's Cloudflare check. Long branch names are cut short in it, e.g. `feat-floating-desktop-chat-c.rivolo.pages.dev`. Host screenshots on an image-only `pr-assets/<branch>` branch.
- Write PR descriptions with the `writing-for-humans` skill.
- Ship to `dev` first (deployed at dev.rivolo.pages.dev), then merge into `main`. Keep feature and `pr-assets/*` branches after merging: deleting them breaks their previews and the PR's screenshots.
