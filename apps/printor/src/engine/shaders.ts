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

/**
 * The whole print pipeline in a single pass.
 *
 * Ranges are already resolved to scalars on the CPU (see frameParams.ts), so
 * nothing here draws random parameters — only the spatial noise used by grain
 * and torn edges is generated in the shader, seeded by frame.
 *
 * Stage order matches the UI top to bottom:
 *   motion blur → soft paper → grain & gain → torn edges
 *   → wiggle → displacement → halftone → paper cuts → overlay
 *
 * Wiggle and displacement come after torn edges, but because every stage above
 * them is a function of the sampling coordinate, they are applied by shifting
 * that coordinate rather than by resampling an intermediate buffer. The result
 * is identical and keeps the pipeline to one draw call.
 */
export const fragmentShader = `#version 300 es
precision highp float;
precision highp int;

in vec2 v_uv;
out vec4 out_color;

uniform sampler2D u_source;
uniform sampler2D u_paper;
uniform sampler2D u_displace;
uniform sampler2D u_cutout;
uniform sampler2D u_overlay;

uniform vec2 u_resolution;
/**
 * Frame height over 1080. Every parameter denominated in pixels is multiplied
 * by this, so "8 px of grain" means 8 px at 1080p and the proxy preview shows
 * the same print as the full-resolution export instead of a finer one.
 */
uniform float u_pixel;
uniform uint u_seed;
uniform uint u_frame;
uniform int u_bypass;
uniform int u_invert;
uniform int u_ink;

// 0 motion, 1 paper, 2 grain, 3 torn, 4 wiggle, 5 displace, 6 halftone, 7 cutout, 8 overlay
uniform int u_active[9];

uniform float u_motion_strength;
uniform float u_motion_angle;
uniform int u_motion_samples;
uniform int u_motion_both;

uniform vec4 u_paper_placement;   // scale, rotation, offset x, offset y
uniform float u_paper_opacity;
uniform int u_paper_blend;

uniform float u_grain_amount;
uniform float u_grain_gain;
uniform float u_grain_size;

uniform float u_torn_balance;
uniform float u_torn_smoothness;
uniform float u_torn_contrast;
uniform float u_torn_roughness;

uniform vec2 u_wiggle_offset;
uniform float u_wiggle_rotation;

uniform vec4 u_displace_placement;
uniform float u_displace_amount;

uniform float u_halftone_cell;
uniform float u_halftone_angle;
uniform float u_halftone_strength;

uniform vec4 u_cutout_placement;
uniform float u_cutout_feather;
uniform int u_cutout_invert;

uniform vec4 u_overlay_placement;
uniform float u_overlay_opacity;
uniform int u_overlay_blend;

uint hash32(uint seed, uint frame, uint layer, uint channel) {
  uint value = seed ^ frame * 0x9e3779b9u ^ layer * 0x85ebca6bu ^ channel * 0xc2b2ae35u;
  value = (value ^ (value >> 16u)) * 0x21f0aaadu;
  value = (value ^ (value >> 15u)) * 0x735a2d97u;
  return value ^ (value >> 15u);
}

// Stable per-cell value in 0..1. The +4096 bias keeps negative cells distinct.
float cell_value(vec2 cell, uint layer) {
  ivec2 c = ivec2(floor(cell)) + 4096;
  uint key = uint(c.x) * 73856093u ^ uint(c.y) * 19349663u;
  return float(hash32(u_seed, u_frame, layer, key)) / 4294967296.0;
}

float value_noise(vec2 point, uint layer) {
  vec2 cell = floor(point);
  vec2 fraction = fract(point);
  vec2 weight = fraction * fraction * (3.0 - 2.0 * fraction);
  float a = cell_value(cell, layer);
  float b = cell_value(cell + vec2(1.0, 0.0), layer);
  float c = cell_value(cell + vec2(0.0, 1.0), layer);
  float d = cell_value(cell + vec2(1.0, 1.0), layer);
  return mix(mix(a, b, weight.x), mix(c, d, weight.x), weight.y);
}

// Three octaves is enough to read as torn fibre without banding.
float fbm(vec2 point, uint layer) {
  float sum = 0.0;
  float amplitude = 0.5;
  float total = 0.0;
  for (int octave = 0; octave < 3; octave++) {
    sum += value_noise(point, layer + uint(octave) * 7u) * amplitude;
    total += amplitude;
    point *= 2.03;
    amplitude *= 0.5;
  }
  return sum / total;
}

mat2 rotation(float angle) {
  return mat2(cos(angle), -sin(angle), sin(angle), cos(angle));
}

float luminance(vec3 color) {
  return dot(color, vec3(0.2126, 0.7152, 0.0722));
}

float blend_value(float base, float layer, int mode) {
  if (mode == 0) return base * layer;
  if (mode == 1) return 1.0 - (1.0 - base) * (1.0 - layer);
  if (mode == 2) {
    return base < 0.5 ? 2.0 * base * layer : 1.0 - 2.0 * (1.0 - base) * (1.0 - layer);
  }
  // soft light, Photoshop's formulation
  return layer < 0.5
    ? base - (1.0 - 2.0 * layer) * base * (1.0 - base)
    : base + (2.0 * layer - 1.0) * ((base < 0.25 ? ((16.0 * base - 12.0) * base + 4.0) * base : sqrt(base)) - base);
}

/**
 * Maps a frame coordinate into a placed texture. Scale is a multiplier where
 * 1.0 fits the frame, so 4.0 shows a quarter of the texture.
 */
vec2 placed_uv(vec2 uv, vec4 placement) {
  vec2 point = uv - 0.5;
  point = rotation(placement.y) * point;
  point /= max(0.05, placement.x);
  point += placement.zw;
  return point + 0.5;
}

vec3 motion_sample(vec2 uv) {
  if (u_active[0] == 0) return texture(u_source, uv).rgb;
  vec2 direction = vec2(cos(u_motion_angle), sin(u_motion_angle)) * u_motion_strength * u_pixel / u_resolution;
  vec3 sum = vec3(0.0);
  float count = 0.0;
  for (int index = 0; index < 24; index++) {
    if (index >= u_motion_samples) break;
    float position = float(index) / max(1.0, float(u_motion_samples - 1));
    float offset = u_motion_both == 1 ? position - 0.5 : -position;
    sum += texture(u_source, clamp(uv + direction * offset, 0.0, 1.0)).rgb;
    count += 1.0;
  }
  return sum / max(1.0, count);
}

/**
 * The silkscreen threshold.
 *
 * Grain and gain have already broken the tone into speckle; here a low
 * frequency fbm pushes the luminance across the balance point so the boundary
 * tears along paper-fibre shapes instead of cutting a clean line. Smoothness
 * sets the fibre size, roughness how far the boundary can wander, contrast how
 * hard the final transition is.
 */
float torn_edges(float value, vec2 uv) {
  float feature = mix(2.5, 26.0, clamp(u_torn_smoothness, 0.0, 1.0)) * u_pixel;
  vec2 point = uv * u_resolution / feature;
  float fibre = fbm(point, 11u);
  // A second, finer octave set keeps the edge from looking like smooth blobs.
  float detail = fbm(point * 3.7, 29u);
  float noise = mix(fibre, detail, 0.35) - 0.5;
  float perturbed = value + noise * u_torn_roughness;
  float width = mix(0.22, 0.004, clamp(u_torn_contrast, 0.0, 1.0));
  return smoothstep(u_torn_balance - width, u_torn_balance + width, perturbed);
}

float halftone(float value, vec2 uv) {
  vec2 point = rotation(u_halftone_angle) * (uv * u_resolution) / max(1.5, u_halftone_cell * u_pixel);
  vec2 cell = fract(point) - 0.5;
  float distance_to_centre = length(cell) * 2.0;
  // Darker input grows the dot until neighbouring cells merge.
  float radius = sqrt(clamp(1.0 - value, 0.0, 1.0)) * 1.25;
  float dot_mask = smoothstep(radius + 0.12, radius - 0.12, distance_to_centre);
  return mix(value, 1.0 - dot_mask, clamp(u_halftone_strength, 0.0, 1.0));
}

/**
 * Gradient-based warp. Using the slope of the height map rather than its raw
 * value pushes pixels away from ridges, which reads as paper buckling instead
 * of a flat diagonal smear.
 */
vec2 displacement(vec2 uv) {
  if (u_active[5] == 0) return vec2(0.0);
  vec2 step_size = 1.5 / u_resolution;
  vec2 base = placed_uv(uv, u_displace_placement);
  vec2 scaled_step = step_size / max(0.05, u_displace_placement.x);
  float left = texture(u_displace, base - vec2(scaled_step.x, 0.0)).r;
  float right = texture(u_displace, base + vec2(scaled_step.x, 0.0)).r;
  float down = texture(u_displace, base - vec2(0.0, scaled_step.y)).r;
  float up = texture(u_displace, base + vec2(0.0, scaled_step.y)).r;
  vec2 gradient = vec2(right - left, up - down);
  return gradient * u_displace_amount * u_pixel / u_resolution;
}

void main() {
  vec2 uv = vec2(v_uv.x, 1.0 - v_uv.y);

  if (u_bypass == 1) {
    out_color = vec4(texture(u_source, uv).rgb, 1.0);
    return;
  }

  // Wiggle and displacement act on everything upstream, so they move the
  // coordinate the upstream stages read from.
  vec2 print_uv = uv;
  if (u_active[4] == 1) {
    print_uv = rotation(u_wiggle_rotation) * (print_uv - 0.5) + 0.5 - u_wiggle_offset * u_pixel / u_resolution;
  }
  print_uv += displacement(uv);

  vec2 clamped = clamp(print_uv, 0.0, 1.0);
  float value = luminance(motion_sample(clamped));

  if (u_active[1] == 1) {
    float stock = texture(u_paper, placed_uv(print_uv, u_paper_placement)).r;
    value = mix(value, blend_value(value, stock, u_paper_blend), clamp(u_paper_opacity, 0.0, 1.0));
  }

  if (u_active[2] == 1) {
    value = (value - 0.5) * u_grain_gain + 0.5;
    // Interpolated rather than per-pixel: white noise thresholds into television
    // static, while a smoothed field breaks the fill into ink-sized clumps.
    vec2 grain_point = print_uv * u_resolution / max(1.0, u_grain_size * u_pixel);
    float noise = mix(value_noise(grain_point, 3u), value_noise(grain_point * 2.6, 41u), 0.4);
    value += (noise - 0.5) * u_grain_amount * 2.0;
  }

  if (u_active[3] == 1) value = torn_edges(value, print_uv);
  value = clamp(value, 0.0, 1.0);

  if (u_active[6] == 1) value = halftone(value, uv);

  float mask = 1.0;
  if (u_active[7] == 1) {
    float shape = texture(u_cutout, placed_uv(uv, u_cutout_placement)).r;
    float feather = max(0.001, u_cutout_feather);
    mask = smoothstep(0.5 - feather, 0.5 + feather, shape);
    if (u_cutout_invert == 1) mask = 1.0 - mask;
  }

  if (u_active[8] == 1) {
    float stock = texture(u_overlay, placed_uv(uv, u_overlay_placement)).r;
    value = mix(value, blend_value(value, stock, u_overlay_blend), clamp(u_overlay_opacity, 0.0, 1.0));
  }

  value = clamp(value, 0.0, 1.0);
  if (u_invert == 1) value = 1.0 - value;

  if (u_ink == 1) {
    // Keep the white ink, black becomes transparent.
    out_color = vec4(1.0, 1.0, 1.0, value * mask);
  } else if (u_ink == 2) {
    // Keep the black ink, white becomes transparent.
    out_color = vec4(0.0, 0.0, 0.0, (1.0 - value) * mask);
  } else {
    out_color = vec4(vec3(value), mask);
  }
}`;
