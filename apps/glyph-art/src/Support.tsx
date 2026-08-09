import { ToolShell } from "./shared/Shell";
import { MAX_EXPORT_FRAMES } from "./export/renderSequence";
import { maxBands, maxGrid, maxFps, minBands, minFps, minGrid } from "./types";

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
            Import MP4, MOV, WebM, PNG, JPEG or WebP. The source is converted to
            grayscale, resampled onto a square grid of {minGrid} to {maxGrid} cells
            across, and split into {minBands} to {maxBands} tone bands. Each band prints
            a mark, and the size of that mark is what carries the tone — there is no
            tint and no filter over it.
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
            Six marks ship with the tool, and the lightest band starts empty. You can type
            characters to add more, or drop PNG, JPEG, SVG or WebP files onto any band —
            those may be vector, even though the source may not. A band holding more than one mark
            cycles through them, one mark every <em>hold</em> frames, with each cell out
            of phase with its neighbours.
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
            four variants.
          </p>
          <p>
            MP4 is written at the target frame rate, between {minFps} and {maxFps} frames
            per second. H.264 has no alpha channel, so MP4 is always the flat result.
          </p>
          <p>
            The output raster is derived from the grid rather than from the source, so
            the canvas you are looking at is the exported frame at full size.
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
            cannot make network requests. There is no analytics, no account system, and
            no upload code. Files you open stay in the browser tab; settings are saved to
            local storage on your own machine.
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
