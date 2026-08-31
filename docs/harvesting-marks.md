# Cutting a page into marks

How a scanned page of letterpress becomes a glyph art preset, and how to do it
again with your own pages.

Two scripts, run in order. The first turns pages into candidate marks; the
second decides which of those marks prints on which of the twelve levels. They
are separate because they answer separate questions, and because the second one
also serves the hand-picked sets, which never go near the first.

```sh
# 1. cut the pages into candidate marks
node scripts/harvest-glyphs.mjs eighteen-twelve-press assets/glyph-pages/eighteen-twelve-press/*.png

# 2. solve the ladder and write the deployed set
node scripts/build-glyph-presets.mjs

# ...and look at what you got, which is not optional
node scripts/build-glyph-presets.mjs --sheet proof
```

Neither runs in CI. Both need `assets/`, which is gitignored, and both are
manual for the same reason printor's texture builder is: the originals are
large, they are yours, and only the converted result belongs in the repository.

---

## What goes in

A page that has already had its background removed — ink in the alpha channel,
nothing behind it. That is the one preparation step the scripts do not do for
you, and it is the step that decides how good the result is. A page with the
paper still in it produces thousands of islands of paper texture and nothing
usable.

Polarity does not matter. Black ink on transparency and white ink on
transparency both work, because ink is read from alpha, not from colour.

Resolution matters a great deal. The body type on a page has to survive being
cut out, and the filters start rejecting islands below about 14 px on the short
side. On the four 1812 pages the body type runs 25–50 px, which is comfortable;
a page scanned at half that would yield only its headings.

Keep the pages somewhere stable — `assets/glyph-pages/<set-id>/` is where the
shipped ones live — so a rebuild is one command rather than an archaeology
expedition.

---

## Step 1: `harvest-glyphs.mjs`

### There is no machine vision here, and none is wanted

A cleaned letterpress page is ink on transparency, so a letter *is* a connected
island of alpha. Finding those islands is connected-component labelling: one
raster scan assigning provisional labels and recording which ones touch, then a
union-find to resolve them. It is a technique from the 1970s, it takes about a
tenth of a second for a ten-megapixel page, and it gives exactly the same answer
every time.

What a vision model would add is a *name* for each island — "this is a П". The
tool never needs one. It sizes a mark by the ink it measures, not by what letter
it is, so recognition would be an expensive way to produce a label nothing reads.

8-connectivity rather than 4, because a letterpress serif meets its stem
diagonally as often as squarely, and 4-connectivity shears the serifs off into
separate islands.

### Four filters

Six thousand islands come off a broadsheet. Most are not marks.

| filter | rejects | why |
| --- | --- | --- |
| **size** | under 14 px on the short side; over 420 px on the long | scanner grit and full stops at one end; rules, borders and the masthead at the other |
| **proportion** | over 2.5 : 1 | past that a mark printed in a square cell is a dash, not a mark |
| **fill** | under 12% of its own bounding box | a frame or a stray hairline |
| **crispness** | under 33% of its ink at full strength | the filter nothing else can do — see below |

**Crispness is the one that earns its place.** A page carries, alongside its
type, a quantity of soft grey rubbish: show-through from the far side of the
leaf, a thumbprint, the ghost of a fold, the halo where a stain was cleaned
away. These pass every test of size, shape and fill — some are exactly
letter-sized and letter-shaped — and they print as mud.

What separates them from type is not shape but **edge**. A letter pressed into
paper is bimodal: nearly every pixel is ink or paper, with a pixel or two of
transition. A stain is *all* transition. Counting the pixels at full strength as
a fraction of the pixels with any ink at all separates the two cleanly, and the
threshold is not delicate:

```
crispness  0.00 – 0.20   uniformly rubbish
           0.20 – 0.33   soft but legible; excluded, because there is plenty else
           0.33 – 0.95   uniformly type
```

On the four 1812 pages this filter alone took `north.png` from 2431 islands to
626 — that page had been cleaned in a way that left a great deal of ghosting.

### And one that is not a filter but a proof

**Recurrence.** Every island gets a 16×16 thumbnail, stretched from its tight
box so a wide impression of a sort matches a narrow one. An island whose
thumbnail matches at least three others on the page is a sort in the fount: it
was set more than once, so it is type. One that matches nothing is more likely a
tear, or two words fused by a heavy impression.

That proof is only available for text that was set repeatedly. A masthead, a
headline or an ornament appears once while being the most deliberate mark on the
page, so size is accepted as a second, independent proof: anything 36 px or more
on its short side is kept whether it recurs or not. Scanner dirt is not that
large, and nothing that large survives the fill and crispness filters without
being type.

> **The bucket trap.** Comparing every pair of islands is millions of distances,
> so candidates are bucketed by proportion and density and compared only within
> a neighbourhood. The neighbourhood is the whole point. Two impressions of the
> same sort differ slightly in ink, so one lands at density 0.249 and the next at
> 0.251 — with a bucket edge between them. Searching only the home bucket reports
> that neither recurs, and *every letter on the page looks like a one-off smudge*.
> The bug is silent: the script runs, reports a number, and the number is wrong.
> `countRecurrence` searches the surrounding 3×3 of buckets for this reason.

### What comes out

One PNG per surviving island, black ink with the impression in the alpha —
byte-for-byte the same shape a hand-picked scan arrives in, so the builder
cannot tell the difference and does not need to. Plus `harvest.json`, recording
for each mark which page it came from, where on that page, and its measurements.
Nothing reads that file; it is there so a mark can be traced back to its source.

The four shipped pages yield **2839 candidates**. That is not the set — it is
the case of type the set will be composed from.

---

## Step 2: `build-glyph-presets.mjs`

Unchanged in shape from what it always did, and it treats harvested and
hand-picked marks identically.

### Every mark is normalised and measured

Alpha is lifted out, inverted, and written as opaque grey — black ink on white
paper — whatever polarity the source had. That one step is why all five sets
behave the same, and why the density measured here is the density the browser
measures when it loads the mark.

Each mark yields four numbers: **ink density** over its tight box, **proportion**,
**median stroke width** from a chamfer distance transform, and a 12×12 **shape
thumbnail**.

### Levels are solved, not sorted

The intuitive move is to sort marks by their own ink and hand the darkest to the
darkest level. It is wrong, and understanding why is the whole thing.

The solver can print *any* mark at *any* level by changing its size. What it
cannot do is print a mark at a size that does not work. A solid woodblock
reaches a light level only by shrinking to grit; an airy letter reaches a dark
one only by overflowing its cell. So eligibility is a question about **size**:

```
size a mark needs at level ℓ  =  sqrt( coverage(ℓ) / (ρ · min(a, 1/a)) )
eligible if that size is between 0.14 and 1.15 cells
```

Stroke width is the second gate, and it catches what the coverage arithmetic
cannot: a mark of fine rules at a third of a cell is a grey smudge long before
it is too small to see.

This is also why **wide marks sort themselves onto the light levels** with
nothing in the code looking at proportion to put them there. A mark is fitted
into its square cell by its long side, so one 2.5 times as wide as it is tall
reaches only two fifths of the cell the other way and inks two fifths of what
its density suggests. It hits the ceiling at a far lighter tone. On the
harvested set this is visible in the data: mean proportion runs 1.47 : 1 on the
lightest level and 1.05 : 1 on the darkest.

### Within a level, marks are chosen to be unlike each other

A pool is not a fallback list. Every mark in it prints, cycling from cell to
cell, so **the pool size is how varied that level looks**. Filling a level from
the top of a ranked list gives ten impressions of the same letter — technically
ten marks, visibly one.

So the first pick is the best-scoring mark, because the ramp solver measures the
level's size from it and it has to print that level well. Every pick after that
is the candidate **furthest in shape** from everything already on the level,
with print quality as a weight rather than as the criterion:

```
value = (distance to the nearest mark already chosen) × (0.55 + 0.45 × quality)
```

A mark nothing has used yet gets a small thumb on the scale — 1.2× on the
distance — so a hand-picked set does not leave its own scans unprinted. It is
small enough to decide only between candidates the distance had already left
close together.

A mark serves at most three levels at different sizes, which is where a *small*
set's variety comes from. A set cut from whole pages has more material than the
ramp has places, so it never repeats a mark at all: 126 marks in 126 places.

### Pool sizes are per set

| set | marks used | per level | darkest three | peak ink |
| --- | --- | --- | --- | --- |
| 18th century | 21 of 24 | 2 | 4 | 44% |
| 1812 | 38 of 41 | 4 | 6 | 46% |
| Great War | 14 of 14 | 2 | 4 | 54% |
| 1941 | 17 of 17 | 2 | 4 | 63% |
| **1812 press** | **126 of 2839** | **10** | **12** | **70%** |

A set not using every one of its scans is the diversity rule working, not
material being ignored. The three that 18th century leaves out sit 0.27–0.31
away in shape from their nearest used sibling, where the *closest* pair among
the marks it does use is 0.257 apart and the median pair is 0.455: they are the
most redundant scans in the set, and printing them would put two near-identical
marks in one pool.

Raising a set's pool is not free, and the cost is tone. `solvePeak` anchors the
whole ramp on the *n*-th densest mark, where *n* is the darkest pool size,
because all *n* of them have to fit inside the cell. Taking 18th century from
2/4 to 3/5 does use all 24 of its scans — and drops its peak ink from 44% to
38%, because the fifth-densest mark cannot cover as much as the fourth.

Twelve is a hard ceiling, not a taste: `projectState.readBands` slices a band at
twelve marks, so a thirteenth would print from the preset button and vanish the
moment the project was saved and reopened. `tests/presets.test.ts` asserts it.

`peak` — the ink the darkest level asks for — is a property of the set, not a
setting. Airy letterpress cannot cover as much of a cell as a solid woodblock
without spilling out of it. The harvested set reaches the highest peak of the
five because a case of newspaper type contains genuinely solid sorts.

### Only what prints is written

The builder wipes each set's output directory and writes only the marks that a
level actually names. With 2839 candidates and 125 used, the alternative is
several megabytes of marks nothing points at.

The consequence, and it is a real one: **rebuilding can retire a mark id.** A
project saved against an older build that named a now-unused mark loses that
mark — `readGlyphs` drops preset ids this build does not ship, so it degrades to
the rest of the band rather than breaking.

---

## Reading the proof sheet

```sh
node scripts/build-glyph-presets.mjs --sheet proof
```

Twelve blocks per set, each a 5×5 patch of cells stamped with that level's pool
at the size it will really print. **Look at this before committing.** No table
shows whether a ladder steps, and the failure it catches — two adjacent levels
that read as the same tone — is invisible in every number the script prints.

What you are checking:

- the blocks get darker left to right, with no two adjacent ones alike
- the lightest block is nearly paper and the darkest is nearly solid
- inside a block, the marks are visibly different from one another
- nothing is a grey smudge

---

## Budgets

Two ceilings, because they answer different questions.

- **160 KB per set** — a set is fetched only when it is picked, so this is what
  a visitor actually downloads. Watch it when a set gains marks.
- **512 KB total** — what the repository and the deployment carry. Watch it when
  a set is added.

Current: 242 KB across five sets, the largest being 1812 press at 110 KB for 125
marks. `apps/glyph-art/scripts/budget.mjs` fails the build on either.

---

## Adding your own pages

1. Clean the background off the scans. This is the step that decides everything.
2. Put them in `assets/glyph-pages/<set-id>/`.
3. Add the set to the `sets` array in `scripts/build-glyph-presets.mjs`, with a
   label and a pool size.
4. `node scripts/harvest-glyphs.mjs <set-id> assets/glyph-pages/<set-id>/*.png`
5. `node scripts/build-glyph-presets.mjs --sheet proof`
6. Look at the sheet. If a level is muddy, the usual cause is a page that needed
   more cleaning, not a threshold that needs moving.
7. `pnpm check`, then commit — the generated module and
   `apps/glyph-art/public/presets/<set-id>/` only. The pages and the candidates
   stay out of git.

Mixing sources works: hand-picked scans and harvested ones can sit in the same
`assets/glyph-presets/<set-id>/` directory, and the builder treats them alike.
That is exactly how the **1812** set is built — sixteen scans chosen by hand,
plus twenty-six added later, all solved onto one ladder.
