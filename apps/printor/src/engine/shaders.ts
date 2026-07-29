export const vertexShader = `#version 300 es
precision highp float;
out vec2 v_uv;

void main() {
  vec2 positions[3] = vec2[3](
    vec2(-1.0, -1.0),
    vec2( 3.0, -1.0),
    vec2(-1.0,  3.0)
  );
  vec2 position = positions[gl_VertexID];
  v_uv = position * 0.5 + 0.5;
  gl_Position = vec4(position, 0.0, 1.0);
}`;

export const fragmentShader = `#version 300 es
precision highp float;
precision highp int;

in vec2 v_uv;
out vec4 out_color;

uniform sampler2D u_source;
uniform uint u_seed;
uniform uint u_frame;
uniform int u_order[4];
uniform int u_enabled[4];
uniform float u_chaos;
uniform float u_brightness;
uniform float u_contrast;
uniform float u_gamma;
uniform float u_noise;
uniform float u_noise_size;
uniform int u_print_mode;
uniform float u_levels;
uniform float u_threshold;
uniform float u_halftone_scale;
uniform float u_dot_gain;
uniform float u_paper;
uniform float u_banding;

uint hash32(uint seed, uint frame, uint layer, uint channel) {
  uint value = seed ^ frame * 0x9e3779b9u ^ layer * 0x85ebca6bu ^ channel * 0xc2b2ae35u;
  value = (value ^ (value >> 16u)) * 0x21f0aaadu;
  value = (value ^ (value >> 15u)) * 0x735a2d97u;
  return value ^ (value >> 15u);
}

float random_value(uint layer, uint channel) {
  return float(hash32(u_seed, u_frame, layer, channel)) / 4294967296.0;
}

float pixel_noise(vec2 pixel, float size) {
  uvec2 cell = uvec2(floor(pixel / max(1.0, size)));
  uint channel = cell.x * 1973u + cell.y * 9277u;
  return float(hash32(u_seed, u_frame, 1u, channel)) / 4294967296.0;
}

float luminance(vec3 color) {
  return dot(color, vec3(0.2126, 0.7152, 0.0722));
}

float bayer4(vec2 pixel) {
  int x = int(mod(pixel.x, 4.0));
  int y = int(mod(pixel.y, 4.0));
  int index = x + y * 4;
  float matrix[16] = float[16](
    0.0, 8.0, 2.0, 10.0,
    12.0, 4.0, 14.0, 6.0,
    3.0, 11.0, 1.0, 9.0,
    15.0, 7.0, 13.0, 5.0
  );
  return (matrix[index] + 0.5) / 16.0;
}

vec3 apply_levels(vec3 color) {
  color = (color - 0.5) * u_contrast + 0.5 + u_brightness;
  return pow(clamp(color, 0.0, 1.0), vec3(1.0 / max(0.05, u_gamma)));
}

vec3 apply_noise(vec3 color) {
  float variation = mix(1.0, 0.45 + random_value(1u, 2u), u_chaos);
  float noise = pixel_noise(gl_FragCoord.xy, u_noise_size) - 0.5;
  return clamp(color + noise * u_noise * variation, 0.0, 1.0);
}

vec3 apply_print(vec3 color) {
  float gray = luminance(color);
  if (u_print_mode == 0) {
    float threshold = bayer4(gl_FragCoord.xy);
    float shifted = gray + (threshold - u_threshold) / max(2.0, u_levels);
    float quantized = floor(clamp(shifted, 0.0, 1.0) * (u_levels - 1.0) + 0.5) / (u_levels - 1.0);
    return vec3(quantized);
  }
  float scale = max(3.0, u_halftone_scale);
  vec2 cell = fract(gl_FragCoord.xy / scale) - 0.5;
  float radius = sqrt(max(0.0, 1.0 - gray)) * 0.58 + u_dot_gain * 0.2;
  float dot_value = smoothstep(radius + 0.08, radius - 0.08, length(cell));
  return vec3(1.0 - dot_value);
}

vec3 apply_paper(vec3 color) {
  float frame_shift = (random_value(3u, 0u) - 0.5) * 60.0 * u_chaos;
  float band = sin((gl_FragCoord.y + frame_shift) * 0.16) * u_banding;
  float fine = (pixel_noise(gl_FragCoord.xy, 5.0) - 0.5) * u_paper;
  float edge = smoothstep(0.0, 0.18, min(min(v_uv.x, 1.0 - v_uv.x), min(v_uv.y, 1.0 - v_uv.y)));
  return clamp(color + fine + band * 0.25 - (1.0 - edge) * u_paper * 0.35, 0.0, 1.0);
}

void main() {
  vec2 uv = vec2(v_uv.x, 1.0 - v_uv.y);
  vec4 source = texture(u_source, uv);
  vec3 color = source.rgb;

  for (int index = 0; index < 4; index++) {
    int effect = u_order[index];
    if (u_enabled[effect] == 0) continue;
    if (effect == 0) color = apply_levels(color);
    if (effect == 1) color = apply_noise(color);
    if (effect == 2) color = apply_print(color);
    if (effect == 3) color = apply_paper(color);
  }

  out_color = vec4(color, source.a);
}`;
