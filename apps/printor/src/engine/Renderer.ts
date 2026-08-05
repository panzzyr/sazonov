import { fragmentShader, vertexShader } from "./shaders";
import type { FrameParams } from "./frameParams";
import { stageOrder, type ExportInk, type TextureStageId } from "../types";

/** Texture unit assignment. Unit 0 is always the source frame. */
const textureUnits: Record<TextureStageId, number> = {
  paper: 1,
  displace: 2,
  cutout: 3,
  overlay: 4,
};

const samplerNames: Record<TextureStageId, string> = {
  paper: "u_paper",
  displace: "u_displace",
  cutout: "u_cutout",
  overlay: "u_overlay",
};

const inkIndex: Record<ExportInk, number> = { flat: 0, white: 1, black: 2 };

function compile(gl: WebGL2RenderingContext, type: number, source: string) {
  const shader = gl.createShader(type);
  if (!shader) throw new Error("Unable to allocate a WebGL shader.");
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(shader) || "Shader compilation failed.";
    gl.deleteShader(shader);
    throw new Error(log);
  }
  return shader;
}

function createProgram(gl: WebGL2RenderingContext) {
  const program = gl.createProgram();
  if (!program) throw new Error("Unable to allocate a WebGL program.");
  const vertex = compile(gl, gl.VERTEX_SHADER, vertexShader);
  const fragment = compile(gl, gl.FRAGMENT_SHADER, fragmentShader);
  gl.attachShader(program, vertex);
  gl.attachShader(program, fragment);
  gl.linkProgram(program);
  gl.deleteShader(vertex);
  gl.deleteShader(fragment);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    throw new Error(gl.getProgramInfoLog(program) || "Shader linking failed.");
  }
  return program;
}

export type RenderOptions = {
  ink: ExportInk;
  invert: boolean;
  bypass: boolean;
};

export class Renderer {
  readonly canvas: HTMLCanvasElement;
  private readonly gl: WebGL2RenderingContext;
  private readonly program: WebGLProgram;
  private readonly sourceTexture: WebGLTexture;
  private readonly stageTextures = new Map<TextureStageId, WebGLTexture>();
  private readonly uniforms = new Map<string, WebGLUniformLocation | null>();
  /** Which library texture each unit currently holds, to avoid re-uploading. */
  private readonly bound = new Map<TextureStageId, string>();

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    const gl = canvas.getContext("webgl2", {
      alpha: true,
      antialias: false,
      depth: false,
      stencil: false,
      // Straight alpha keeps canvas.toBlob() output correct for the ink modes,
      // which write opaque white or black against a varying alpha.
      premultipliedAlpha: false,
      preserveDrawingBuffer: true,
    });
    if (!gl) throw new Error("WebGL2 is required to run printor.");
    this.gl = gl;
    this.program = createProgram(gl);
    gl.useProgram(this.program);

    const source = gl.createTexture();
    if (!source) throw new Error("Unable to allocate the source texture.");
    this.sourceTexture = source;
    this.configureTexture(source, gl.CLAMP_TO_EDGE);
    gl.uniform1i(this.uniform("u_source"), 0);

    for (const stage of Object.keys(textureUnits) as TextureStageId[]) {
      const texture = gl.createTexture();
      if (!texture) throw new Error(`Unable to allocate the ${stage} texture.`);
      // Cutouts are masks: clamping means anything outside the paper shape is
      // simply not printed. Stock textures mirror so offsets never run out.
      this.configureTexture(texture, stage === "cutout" ? gl.CLAMP_TO_EDGE : gl.MIRRORED_REPEAT);
      this.stageTextures.set(stage, texture);
      gl.uniform1i(this.uniform(samplerNames[stage]), textureUnits[stage]);
      // A neutral 1x1 white pixel so an unselected stage is a no-op, not black.
      gl.activeTexture(gl.TEXTURE0 + textureUnits[stage]);
      gl.bindTexture(gl.TEXTURE_2D, texture);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([255, 255, 255, 255]));
    }

    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
  }

  private configureTexture(texture: WebGLTexture, wrap: number) {
    const gl = this.gl;
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, wrap);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, wrap);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  }

  private uniform(name: string) {
    if (!this.uniforms.has(name)) {
      this.uniforms.set(name, this.gl.getUniformLocation(this.program, name));
    }
    return this.uniforms.get(name) ?? null;
  }

  resize(width: number, height: number) {
    if (this.canvas.width === width && this.canvas.height === height) return;
    this.canvas.width = width;
    this.canvas.height = height;
  }

  /** Uploads a library or user image into one of the stage slots. */
  setStageTexture(stage: TextureStageId, image: TexImageSource, key: string) {
    if (this.bound.get(stage) === key) return;
    const gl = this.gl;
    const texture = this.stageTextures.get(stage);
    if (!texture) return;
    gl.activeTexture(gl.TEXTURE0 + textureUnits[stage]);
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, image);
    this.bound.set(stage, key);
  }

  private setPlacement(name: string, placement: { scale: number; rotation: number; offsetX: number; offsetY: number }) {
    this.gl.uniform4f(this.uniform(name), placement.scale, placement.rotation, placement.offsetX, placement.offsetY);
  }

  render(source: TexImageSource, params: FrameParams, options: RenderOptions) {
    const gl = this.gl;
    gl.useProgram(this.program);
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.sourceTexture);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);

    gl.uniform2f(this.uniform("u_resolution"), this.canvas.width, this.canvas.height);
    // Pixel-denominated settings are authored against 1080p, so the proxy
    // preview and the full-resolution export show the same print.
    gl.uniform1f(this.uniform("u_pixel"), this.canvas.height / 1080);
    gl.uniform1ui(this.uniform("u_seed"), params.seed >>> 0);
    gl.uniform1ui(this.uniform("u_frame"), params.frame >>> 0);
    gl.uniform1i(this.uniform("u_bypass"), options.bypass ? 1 : 0);
    gl.uniform1i(this.uniform("u_invert"), options.invert ? 1 : 0);
    gl.uniform1i(this.uniform("u_ink"), inkIndex[options.ink]);

    // A stage that needs a texture but has none selected is inactive, so an
    // empty library selection cannot silently paint a white rectangle.
    const active = stageOrder.map((id) => {
      if (!params.active[id]) return 0;
      if (id in textureUnits) {
        const stage = id as TextureStageId;
        const wanted = params[stage].textureId;
        return wanted !== null && this.bound.get(stage) === wanted ? 1 : 0;
      }
      return 1;
    });
    gl.uniform1iv(this.uniform("u_active"), active);

    gl.uniform1f(this.uniform("u_motion_strength"), params.motion.strength);
    gl.uniform1f(this.uniform("u_motion_angle"), params.motion.angle);
    gl.uniform1i(this.uniform("u_motion_samples"), params.motion.samples);
    gl.uniform1i(this.uniform("u_motion_both"), params.motion.bothDirections ? 1 : 0);

    this.setPlacement("u_paper_placement", params.paper);
    gl.uniform1f(this.uniform("u_paper_opacity"), params.paper.opacity);
    gl.uniform1i(this.uniform("u_paper_blend"), params.paper.blend);

    gl.uniform1f(this.uniform("u_grain_amount"), params.grain.grain);
    gl.uniform1f(this.uniform("u_grain_gain"), params.grain.gain);
    gl.uniform1f(this.uniform("u_grain_size"), params.grain.size);

    gl.uniform1f(this.uniform("u_torn_balance"), params.torn.balance);
    gl.uniform1f(this.uniform("u_torn_smoothness"), params.torn.smoothness);
    gl.uniform1f(this.uniform("u_torn_contrast"), params.torn.contrast);
    gl.uniform1f(this.uniform("u_torn_roughness"), params.torn.roughness);

    gl.uniform2f(this.uniform("u_wiggle_offset"), params.wiggle.offsetX, params.wiggle.offsetY);
    gl.uniform1f(this.uniform("u_wiggle_rotation"), params.wiggle.rotation);

    this.setPlacement("u_displace_placement", params.displace);
    gl.uniform1f(this.uniform("u_displace_amount"), params.displace.amount);

    gl.uniform1f(this.uniform("u_halftone_cell"), params.halftone.cell);
    gl.uniform1f(this.uniform("u_halftone_angle"), params.halftone.angle);
    gl.uniform1f(this.uniform("u_halftone_strength"), params.halftone.strength);

    this.setPlacement("u_cutout_placement", params.cutout);
    gl.uniform1f(this.uniform("u_cutout_feather"), params.cutout.feather);
    gl.uniform1i(this.uniform("u_cutout_invert"), params.cutout.invert ? 1 : 0);

    this.setPlacement("u_overlay_placement", params.overlay);
    gl.uniform1f(this.uniform("u_overlay_opacity"), params.overlay.opacity);
    gl.uniform1i(this.uniform("u_overlay_blend"), params.overlay.blend);

    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  dispose() {
    const gl = this.gl;
    gl.deleteTexture(this.sourceTexture);
    for (const texture of this.stageTextures.values()) gl.deleteTexture(texture);
    gl.deleteProgram(this.program);
  }
}
