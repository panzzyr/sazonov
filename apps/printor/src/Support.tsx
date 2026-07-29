import { ToolShell } from "@sazonov/shell";

function available(value: boolean) {
  return value ? "yes" : "no";
}

export function Support() {
  const capabilities = {
    webgl: Boolean(document.createElement("canvas").getContext("webgl2")),
    videoDecoder: "VideoDecoder" in window,
    videoEncoder: "VideoEncoder" in window,
    offscreen: "OffscreenCanvas" in window,
    fileSystem: "showOpenFilePicker" in window,
  };

  return (
    <ToolShell support>
      <main className="support-page">
        <header>
          <p className="kicker">Support</p>
          <h1>Browser capability check</h1>
          <p>printor processes every frame locally. No upload fallback exists.</p>
        </header>
        <table>
          <thead><tr><th>Capability</th><th>This browser</th><th>Used for</th></tr></thead>
          <tbody>
            <tr><td>WebGL2</td><td>{available(capabilities.webgl)}</td><td>Preview and effects</td></tr>
            <tr><td>WebCodecs decoder</td><td>{available(capabilities.videoDecoder)}</td><td>Future direct decode path</td></tr>
            <tr><td>WebCodecs encoder</td><td>{available(capabilities.videoEncoder)}</td><td>Future MP4/WebM export</td></tr>
            <tr><td>OffscreenCanvas</td><td>{available(capabilities.offscreen)}</td><td>Future worker rendering</td></tr>
            <tr><td>File System Access</td><td>{available(capabilities.fileSystem)}</td><td>Optional folder workflows</td></tr>
          </tbody>
        </table>
        <section>
          <h2>Current release</h2>
          <p>Import MP4, MOV, WebM, GIF, PNG, JPEG, or WebP. Preview effects on the GPU and export a deterministic PNG sequence in a ZIP file.</p>
          <p>Video decoding support depends on codecs built into the browser. If a MOV or MP4 does not open, convert it to H.264 MP4 or export an image sequence.</p>
        </section>
        <section>
          <h2>Limits</h2>
          <p>The first release exports up to 300 frames and the first 30 seconds. Sources above 1080p work, but full-resolution export can use substantial memory.</p>
        </section>
        <section>
          <h2>Privacy</h2>
          <p>The production Content Security Policy sets <code>connect-src 'none'</code>. The application has no analytics, account system, endpoint, or upload code.</p>
        </section>
      </main>
    </ToolShell>
  );
}
