const mixA = 0x21f0aaad;
const mixB = 0x735a2d97;

export function hash32(seed: number, frame: number, layer: number, channel: number) {
  let value = (
    seed ^
    Math.imul(frame, 0x9e3779b9) ^
    Math.imul(layer, 0x85ebca6b) ^
    Math.imul(channel, 0xc2b2ae35)
  ) >>> 0;
  value = Math.imul(value ^ (value >>> 16), mixA) >>> 0;
  value = Math.imul(value ^ (value >>> 15), mixB) >>> 0;
  return (value ^ (value >>> 15)) >>> 0;
}

export function randomFloat(seed: number, frame: number, layer: number, channel: number) {
  return hash32(seed, frame, layer, channel) / 0x1_0000_0000;
}
