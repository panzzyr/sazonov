# Symbol shuffle and historical scan screening

`shuffle symbols` chooses fresh marks from the entire pool of each cell's tone
band, not a permutation of the visible marks. It works in single-preset and
spatial-gradient mode. Positions, hand jitter, band membership and step boundaries
remain fixed. Sizes still compensate for each selected mark's ink density; the
shape itself may be wider or narrower than the mark it replaces. A pool containing
one mark cannot vary. Independent random picks may repeat a symbol.

`seed` controls layout jitter and spatial-step boundaries. `glyphSeed` controls
symbol selection. Random entropy is drawn only when choosing a new source,
selecting a preset, changing the step collection, resetting or explicitly
shuffling. Frame rendering remains deterministic, including existing mark cycles.
PNG, SVG and animation exports share the same placement generator. Every shuffle
is a separate undo step, and both seeds survive project files and share links.
The existing seed input and reroll still affect both, preserving their old meaning.

The first media attachment after restoring a file, link or local project keeps
the saved symbol seed. Further source uploads choose fresh symbols. Old projects
without `glyphSeed` use their `seed` for both, matching their former seed model.

## Quality policy

The build already measures blur and pixel resolution for each historical scan.
The quality audit uses that complete catalogue rather than re-harvesting sources
or repacking sheets. It screens out long edges below 16 pixels and a group's
softest tail: blur above the greater of 3.5 pixels and its 98th percentile. This
keeps an intentionally soft historical source from disappearing wholesale.
The initial audit covers 61,024 scans across 26 sources and excludes 294.

Screened marks get zero selection weight in historical level references. Original
weights of surviving impressions, ramp references, ids, sheet coordinates and
assets stay intact. Foreign weights are rebalanced after screening to preserve
the 30% ceiling. Explicit individual selections in old projects remain available.
Reaction vectors and user uploads are not screened.

This catches obvious low-resolution and unusually blurred impressions, not every
visually weak mark. It does not retouch type, alter SVG tracing or remove assets.
Tests require every level to retain at least forty selectable marks.

After rebuilding the preset catalogue, regenerate the small quality module:

```sh
node scripts/audit-glyph-quality.mjs
```

Its stdout is the source for `apps/glyph-art/src/generatedPresetQuality.ts`; stderr
is a per-source audit. `node scripts/audit-glyph-quality.mjs --check` verifies the
committed module against the current measurements and is run by the tests.
