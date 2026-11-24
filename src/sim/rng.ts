export class SeededRNG {
  private state: number;

  constructor(seed: number) {
    this.state = seed >>> 0 || 0x12345678;
  }

  getState(): number {
    return this.state;
  }

  setState(state: number): void {
    this.state = state >>> 0 || 0x12345678;
  }

  next(): number {
    let t = (this.state += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  range(min: number, max: number): number {
    return min + this.next() * (max - min);
  }

  int(min: number, maxInclusive: number): number {
    return Math.floor(this.range(min, maxInclusive + 1));
  }

  pick<T>(arr: readonly T[]): T {
    return arr[Math.floor(this.next() * arr.length)];
  }
}

export function hash2D(x: number, z: number, seed: number): number {
  let h = Math.imul(x, 374761393) + Math.imul(z, 668265263) + Math.imul(seed, 1442695041);
  h = (h ^ (h >>> 13)) * 1274126177;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

export function valueNoise2D(x: number, z: number, seed: number): number {
  const xi = Math.floor(x);
  const zi = Math.floor(z);
  const xf = x - xi;
  const zf = z - zi;
  const u = xf * xf * (3 - 2 * xf);
  const v = zf * zf * (3 - 2 * zf);

  const a = hash2D(xi, zi, seed);
  const b = hash2D(xi + 1, zi, seed);
  const c = hash2D(xi, zi + 1, seed);
  const d = hash2D(xi + 1, zi + 1, seed);

  return (a * (1 - u) + b * u) * (1 - v) + (c * (1 - u) + d * u) * v;
}

export function fbm2D(x: number, z: number, seed: number, octaves = 4): number {
  let value = 0;
  let amp = 0.5;
  let freq = 1;
  let norm = 0;
  for (let i = 0; i < octaves; i++) {
    value += amp * valueNoise2D(x * freq, z * freq, seed + i * 97);
    norm += amp;
    amp *= 0.5;
    freq *= 2.02;
  }
  return value / norm;
}

/**
 * Ken Musgrave-style Ridged Multifractal noise (0..1):
 * Produces sharp alpine ridges, terraced foothills, and carved drainage valleys.
 */
export function ridgedMultifractal2D(x: number, z: number, seed: number, octaves = 4): number {
  let sum = 0;
  let amp = 0.5;
  let freq = 1.0;
  let weight = 1.0;
  let norm = 0;
  for (let i = 0; i < octaves; i++) {
    const n = valueNoise2D(x * freq, z * freq, seed + i * 131);
    let signal = 1.0 - Math.abs(n * 2.0 - 1.0);
    signal = signal * signal * weight;
    weight = Math.max(0.15, Math.min(1.0, signal * 1.9));
    sum += signal * amp;
    norm += amp;
    amp *= 0.5;
    freq *= 2.07;
  }
  return sum / Math.max(1e-6, norm);
}

/**
 * Two-stage Inigo Quilez Domain Warping:
 * Organically twists and folds 2D coordinates to eliminate circular/grid artifacts
 * and produce authentic bays, fjords, peninsulas, and curved coastlines.
 */
export function domainWarp2D(
  x: number,
  z: number,
  seed: number,
  scale: number,
  amp1: number,
  amp2: number
): { wx: number; wz: number; qx: number; qz: number } {
  const sx = x * scale;
  const sz = z * scale;
  const qx = fbm2D(sx, sz, seed + 17, 3) - 0.5;
  const qz = fbm2D(sx + 5.2, sz + 1.3, seed + 53, 3) - 0.5;
  const rx = fbm2D(sx * 1.7 + qx * 2.6 + 1.7, sz * 1.7 + qz * 2.6 + 9.2, seed + 109, 3) - 0.5;
  const rz = fbm2D(sx * 1.7 + qx * 2.6 + 8.3, sz * 1.7 + qz * 2.6 + 2.8, seed + 173, 3) - 0.5;
  return {
    wx: x + qx * amp1 + rx * amp2,
    wz: z + qz * amp1 + rz * amp2,
    qx,
    qz,
  };
}

export function smoothstep(edge0: number, edge1: number, x: number): number {
  const denom = edge1 - edge0;
  if (Math.abs(denom) < 1e-6) return x >= edge1 ? 1 : 0;
  const t = Math.max(0, Math.min(1, (x - edge0) / denom));
  return t * t * (3 - 2 * t);
}
