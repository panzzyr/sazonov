# Architecture decisions

## 2026-07-29 — Publish only implemented tool states

- **Decision:** Display printor and proxiguesse as “in development” until their
  applications and production URLs exist.
- **Alternatives:** Use the “live” label from the content draft or invent a URL.
- **Reason:** A portfolio should not publish broken links or inaccurate status.
- **Consequences:** Update the shared tools data when each deployment is live.

## 2026-07-29 — Temporary text mark

- **Decision:** Use an inline “S” text mark until the owner supplies `logo.svg`.
- **Alternatives:** Redraw the absent logo or omit the home link.
- **Reason:** The supplied design requires a visible home link but forbids
  recreating the owner's artwork.
- **Consequences:** Replacing one include with the optimized SVG completes the
  intended identity without changing layout.

## 2026-07-29 — First printor release pipeline

- **Decision:** Ship a WebGL2 single-pass renderer with reorderable logical
  effects and PNG ZIP export before adding WebCodecs video encoding.
- **Alternatives:** Delay release until MP4/WebM export and worker rendering.
- **Reason:** PNG sequences are the specified universal baseline and make the
  first release useful without browser codec differences.
- **Consequences:** Full-resolution export yields between frames but remains on
  the UI thread; worker rendering and encoded video remain the next milestone.
