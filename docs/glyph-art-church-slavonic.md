# Church Slavonic Vedomosti

This is the owner's separate `task1006-1/ASCII 1st vitrina` collection: exactly
104 PNGs (85 `a0001`–`a0085` and 19 `Layer 3`–`Layer 21`), including the ornament.
No historical harvests, foreign marks, duplicates or automatic scan exclusions
are added. Every supplied symbol participates in the twelve-level ramp. Sparse
forms remain on lighter levels rather than exceeding the size ceiling in shadows.

The sheet is lossless and keeps every input's original dimensions and alpha
values. Even the large ornament is not reduced to the historical 80px limit.
The generated manifest records original-file and normalized-ink SHA-256 hashes;
tests verify each rectangle against its ink hash, without needing source files
on CI. These inputs are PNGs, so their SVG export necessarily uses bitmap
contours, unlike the native-vector digital reaction preset.

Regenerate with existing Sharp (no new dependencies):

```sh
node scripts/build-church-slavonic.mjs /absolute/path/to/ASCII-directory
```

The command writes the WebP sheet and prints `generatedChurchSlavonic.ts` on
stdout. Review and replace that module, then run the same command with `--check`
to verify both outputs and `pnpm check` to verify the project. Node 22.18+ is
required to reuse the TypeScript shelf packer. Default source directory is the
owner's `task1006-1/ASCII 1st vitrina` folder next to this repository.

The preset is selectable on its own and inside step gradients. Existing
default gradient steps and saved projects are unchanged; add the collection
explicitly to use it in a transition.
