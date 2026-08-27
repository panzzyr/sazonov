import { ToolShell } from "./shared/Shell";
import { MAX_EXPORT_FRAMES } from "./export/renderSequence";
import { presets } from "./presets";
import { maxBands, maxGrid, maxFps, maxLines, minBands, minFps, minGrid, minLines } from "./types";

function available(value: boolean) {
  return value ? "yes" : "no";
}

export function Support() {
  const capabilities = {
    canvas: Boolean(document.createElement("canvas").getContext("2d")),
    videoEncoder: "VideoEncoder" in window,
    bitmap: typeof globalThis.createImageBitmap === "function",
  };

  return (
    <ToolShell name="glyph art" support>
      <main className="support-page">
        <header>
          <p className="kicker">Support</p>
          <h1>Browser check</h1>
        </header>
        <table>
          <thead><tr><th>Capability</th><th>This browser</th><th>Needed for</th></tr></thead>
          <tbody>
            <tr><td>2D canvas</td><td>{available(capabilities.canvas)}</td><td>Everything. glyph art cannot run without it.</td></tr>
            <tr><td>createImageBitmap</td><td>{available(capabilities.bitmap)}</td><td>Opening still images.</td></tr>
            <tr><td>WebCodecs encoder</td><td>{available(capabilities.videoEncoder)}</td><td>MP4 export. PNG export works without it.</td></tr>
          </tbody>
        </table>

        <section>
          <h2>What it does</h2>
          <p>
            Import MP4, MOV, WebM, PNG, JPEG or WebP. There are two modes, and they work
            on different principles.
          </p>
          <p>
            In <em>glyphs</em>, the source is converted to grayscale, resampled onto a
            square grid of {minGrid} to {maxGrid} cells across, and split into {minBands}
            {" "}to {maxBands} tone bands. Each band prints a mark, and the size of that
            mark is what carries the tone — there is no tint and no filter over it.
          </p>
          <p>
            In <em>halftone</em>, there is no grid and no mark. A screen of dots at a
            ruling of {minLines} to {maxLines} lines across the frame is laid over the
            picture at an angle of its own, and tone is the area of each dot. Colour
            comes from separating the image into plates — one black screen, two inks of
            your choosing, or four process plates at the classic angles — which are then
            multiplied together the way wet ink is.
          </p>
          <p>
            Size is not set from tone directly. Each band asks for a fraction of its
            cell to be inked, and the size is solved from that target and the mark's own
            measured ink density. That is why a dot and a solid square can sit on the
            same ramp without one of them reading two bands too dark.
          </p>
        </section>

        <section>
          <h2>Marks</h2>
          <p>
            Six marks ship with the tool, and the lightest band starts empty. There are
            also {presets.length} presets — {presets.map((preset) => preset.label).join(", ")}
            {" "}— each a set of scanned type and marks of its period sorted onto twelve
            levels. A preset changes the marks and the shape of their ramp, and nothing
            about the picture: the grid, the levels and the inversions stay where you
            put them.
          </p>
          <p>
            You can type characters to add more marks, or drop PNG, JPEG, SVG or WebP
            files onto any band — those may be vector, even though the source may not. A
            band holding more than one mark cycles through them, one mark every{" "}
            <em>hold</em> frames, with each cell out of phase with its neighbours.
          </p>
          <p>
            <em>max mark</em> is how far a mark may spill past its cell. Nothing is ever
            clipped — the marks are stamped into a full-frame mask — but past about 1.2
            they knit into a mass instead of staying countable. <em>fit ramp</em> then
            solves <em>max ink</em>, the coverage the darkest band asks for, so that the
            ramp climbs as far as it can before the first mark would spill past that
            ceiling. A set of hairlines lands on a lighter ramp than a set of blocks,
            which is the truth about those marks rather than a failure to reach black.
          </p>
          <p>
            Marks in one band should be variations of the same mark — three drawings of
            the same X, not three unrelated shapes. Unrelated shapes on random phase is
            television static.
          </p>
        </section>

        <section>
          <h2>Export</h2>
          <p>
            A PNG sequence can carry three passes — flat, the marks with the paper keyed
            to transparency, and the paper with the marks punched out of it — each in its
            own folder inside the ZIP. Combined with the invert toggle that covers all
            four variants. A halftone in two or four inks can also write each separation
            on its own, black on white, which is what a printer loads.
          </p>
          <p>
            MP4 is written at the target frame rate, between {minFps} and {maxFps} frames
            per second. H.264 has no alpha channel, so MP4 is always the flat result.
          </p>
          <p>
            The output raster is derived from the grid — or, in halftone, from the frame
            width you pick — rather than from the source, so the canvas you are looking
            at is the exported frame at full size.
          </p>
        </section>

        <section>
          <h2>Limits</h2>
          <p>
            Export stops at {MAX_EXPORT_FRAMES} frames. Below about eight pixels per cell
            the marks stop reading as marks; the panel says so when you get there.
          </p>
          <p>
            Video decoding depends on the codecs built into the browser. If an MP4 or MOV
            will not open, convert it to H.264 or export an image sequence from your
            editor instead.
          </p>
        </section>

        <section>
          <h2>Privacy</h2>
          <p>
            The Content Security Policy sets <code>connect-src 'none'</code>, so the page
            cannot open a connection of its own — no fetch, no socket, no beacon. The
            only thing it loads is its own preset marks, as images from this same origin,
            and only once you pick a preset. There is no analytics, no account system,
            and no upload code. Files you open stay in the browser tab; settings are
            saved to local storage on your own machine.
          </p>
          <p>
            A share link carries the settings only. Marks you uploaded are not in it —
            save the project file to keep those.
          </p>
        </section>
      </main>
    </ToolShell>
  );
}
