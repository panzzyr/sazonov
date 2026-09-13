/**
 * Where each preset mark sits on its sprite sheet.
 *
 * The build packs a group's marks onto sheets in shelves and ships only their
 * sizes; this replays the same packing to find them again. Positions would be
 * three more numbers per mark in the bundle, for tens of thousands of marks,
 * and they follow from the sizes anyway. The loop has to match `packShelves`
 * in `scripts/build-glyph-presets.mjs` step for step — `tests/presets.test.ts`
 * checks that it arrives at exactly the sheets the build wrote.
 */

/** A sheet is at most this many pixels on a side. */
export const sheetEdge = 2048;

/** Paper between marks, so a scaled draw never samples a neighbour. */
export const sheetGutter = 2;

export type Placement = { sheet: number; x: number; y: number };

/** Places marks of the given sizes, in order, on shelves across sheets. */
export function packShelves(sizes: readonly (readonly [number, number])[]) {
  const places: Placement[] = [];
  const sheets: { width: number; height: number }[] = [];
  let sheet = { width: 0, height: 0 };
  let x = sheetGutter;
  let y = sheetGutter;
  let shelf = 0;

  for (const [width, height] of sizes) {
    if (x + width + sheetGutter > sheetEdge) {
      x = sheetGutter;
      y += shelf + sheetGutter;
      shelf = 0;
    }
    if (y + height + sheetGutter > sheetEdge) {
      sheets.push(sheet);
      sheet = { width: 0, height: 0 };
      x = sheetGutter;
      y = sheetGutter;
      shelf = 0;
    }
    places.push({ sheet: sheets.length, x, y });
    sheet.width = Math.max(sheet.width, x + width + sheetGutter);
    sheet.height = Math.max(sheet.height, y + height + sheetGutter);
    x += width + sheetGutter;
    shelf = Math.max(shelf, height);
  }
  if (sizes.length > 0) sheets.push(sheet);
  return { places, sheets };
}
