import { ToolShell } from "./shared/Shell";
import { MAX_EXPORT_FRAMES } from "./export/renderSequence";
import { maxFps, minFps } from "./types";

function available(value: boolean) {
  return value ? "yes" : "no";
}

export function Support() {
  const capabilities = {
    webgl: Boolean(document.createElement("canvas").getContext("webgl2")),
    videoEncoder: "VideoEncoder" in window,
    webp: document.createElement("canvas").toDataURL("image/webp").startsWith("data:image/webp"),
  };

  return (
    <ToolShell name="printor" support>
      <main className="support-page">
        <header>
          <p className="kicker">Support</p>
          <h1>Browser check</h1>
        </header>
        <table>
          <thead><tr><th>Capability</th><th>This browser</th><th>Needed for</th></tr></thead>
          <tbody>
            <tr><td>WebGL2</td><td>{available(capabilities.webgl)}</td><td>Everything. printor cannot run without it.</td></tr>
            <tr><td>WebCodecs encoder</td><td>{available(capabilities.videoEncoder)}</td><td>MP4 export. PNG export works without it.</td></tr>
            <tr><td>WebP decoding</td><td>{available(capabilities.webp)}</td><td>The paper and texture library.</td></tr>
          </tbody>
        </table>

        <section>
          <h2>What it does</h2>
          <p>
            Import MP4, MOV, WebM, PNG, JPEG, or WebP. The source is sampled at a
            target rate between {minFps} and {maxFps} frames per second, then each
            frame runs through nine stages: motion blur, soft paper, grain and gain,
            torn edges, wiggle, displacement, halftone, paper cuts, and overlay.
          </p>
          <p>
            Every parameter is a range. Each frame draws its own value from inside
            that range, so frames differ from one another, and a given seed
            reproduces the whole sequence exactly.
          </p>
          <p>
            A still image can be turned into a sequence: choose how many frames to
            generate and each one prints differently.
          </p>
        </section>

        <section>
          <h2>Export</h2>
          <p>
            Output is grayscale. A PNG sequence can carry three passes — flat
            grayscale, white ink with black keyed to alpha, and black ink with
            white keyed to alpha — each in its own folder inside the ZIP. Combined
            with the invert toggle that covers all four ink variants.
          </p>
          <p>
            MP4 is written at the target frame rate. H.264 has no alpha channel, so
            MP4 is always the flat grayscale result.
          </p>
        </section>

        <section>
          <h2>Limits</h2>
          <p>
            Export stops at {MAX_EXPORT_FRAMES} frames. Sources above 1080p work,
            but a full-resolution export can use a lot of memory.
          </p>
          <p>
            Video decoding depends on the codecs built into the browser. If an MP4
            or MOV will not open, convert it to H.264 or export an image sequence
            from your editor instead.
          </p>
        </section>

        <section>
          <h2>Privacy</h2>
          <p>
            The Content Security Policy sets <code>connect-src 'none'</code>, so the
            page cannot make network requests. There is no analytics, no account
            system, and no upload code. Files you open stay in the browser tab;
            settings are saved to local storage on your own machine.
          </p>
        </section>
      </main>
    </ToolShell>
  );
}
