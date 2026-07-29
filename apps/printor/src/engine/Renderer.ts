import { fragmentShader, vertexShader } from "./shaders";
import type { EffectLayer, LayerId, Settings } from "../types";

const layerIndex: Record<LayerId, number> = {
  levels: 0,
  noise: 1,
  print: 2,
  paper: 3,
};

function compile(gl: WebGL2RenderingContext, type: number, source: string) {
  const shader = gl.createShader(type);
  if (!shader) throw new Error("Unable to allocate a WebGL shader.");
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    throw new Error(gl.getShaderInfoLog(shader) || "Shader compilation failed.");
  }
  return shader;
}

function createProgram(gl: WebGL2RenderingContext) {
  const program = gl.createProgram();
  if (!program) throw new Error("Unable to allocate a WebGL program.");
  gl.attachShader(program, compile(gl, gl.VERTEX_SHADER, vertexShader));
  gl.attachShader(program, compile(gl, gl.FRAGMENT_SHADER, fragmentShader));
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    throw new Error(gl.getProgramInfoLog(program) || "Shader linking failed.");
  }
  return program;
}

export class Renderer {
  readonly canvas: HTMLCanvasElement;
  private readonly gl: WebGL2RenderingContext;
  private readonly program: WebGLProgram;
  private readonly texture: WebGLTexture;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    const gl = canvas.getContext("webgl2", {
      alpha: true,
      antialias: false,
      preserveDrawingBuffer: true,
    });
    if (!gl) throw new Error("WebGL2 is required to run printor.");
    this.gl = gl;
    this.program = createProgram(gl);
    const texture = gl.createTexture();
    if (!texture) throw new Error("Unable to allocate a source texture.");
    this.texture = texture;
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  }

  resize(width: number, height: number) {
    if (this.canvas.width === width && this.canvas.height === height) return;
    this.canvas.width = width;
    this.canvas.height = height;
    this.gl.viewport(0, 0, width, height);
  }

  render(
    source: TexImageSource,
    settings: Settings,
    layers: EffectLayer[],
    frame: number,
    original = false,
  ) {
    const gl = this.gl;
    gl.useProgram(this.program);
    gl.bindTexture(gl.TEXTURE_2D, this.texture);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    gl.texImage2D(
      gl.TEXTURE_2D,
      0,
      gl.RGBA,
      gl.RGBA,
      gl.UNSIGNED_BYTE,
      source,
    );

    const enabled = new Int32Array(4);
    for (const layer of layers) enabled[layerIndex[layer.id]] = original ? 0 : Number(layer.enabled);
    const order = new Int32Array(layers.map((layer) => layerIndex[layer.id]));

    this.uniform1ui("u_seed", settings.seed >>> 0);
    this.uniform1ui("u_frame", frame >>> 0);
    gl.uniform1iv(this.location("u_order[0]"), order);
    gl.uniform1iv(this.location("u_enabled[0]"), enabled);
    this.uniform1f("u_chaos", settings.chaos);
    this.uniform1f("u_brightness", settings.brightness);
    this.uniform1f("u_contrast", settings.contrast);
    this.uniform1f("u_gamma", settings.gamma);
    this.uniform1f("u_noise", settings.noise);
    this.uniform1f("u_noise_size", settings.noiseSize);
    gl.uniform1i(this.location("u_print_mode"), settings.printMode === "dither" ? 0 : 1);
    this.uniform1f("u_levels", settings.levels);
    this.uniform1f("u_threshold", settings.threshold);
    this.uniform1f("u_halftone_scale", settings.halftoneScale);
    this.uniform1f("u_dot_gain", settings.dotGain);
    this.uniform1f("u_paper", settings.paper);
    this.uniform1f("u_banding", settings.banding);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  private location(name: string) {
    const location = this.gl.getUniformLocation(this.program, name);
    if (location === null) throw new Error(`Shader uniform ${name} is unavailable.`);
    return location;
  }

  private uniform1f(name: string, value: number) {
    this.gl.uniform1f(this.location(name), value);
  }

  private uniform1ui(name: string, value: number) {
    this.gl.uniform1ui(this.location(name), value);
  }

}
