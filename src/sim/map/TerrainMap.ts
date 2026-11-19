import { MapType, ResolvedMapType } from '../../config/types';
import { fbm2D, SeededRNG } from '../rng';

export const MAP_TILES = 128;
export const TILE_SIZE = 2.0;
export const WORLD_SIZE = MAP_TILES * TILE_SIZE; // 256 world units
export const WATER_LEVEL = 0.0;

export const ALL_MAP_TYPES: readonly ResolvedMapType[] = [
  'aegean_valley',
  'medit_highlands',
  'twin_peninsulas',
  'inland_oasis',
  'open_plains',
];

export const MAP_TYPE_LABELS: Record<ResolvedMapType, string> = {
  aegean_valley: 'Aegean River Valley',
  medit_highlands: 'Mediterranean Highlands',
  twin_peninsulas: 'Twin Peninsulas',
  inland_oasis: 'Inland Oasis',
  open_plains: 'Peloponnesian Plains',
};

export interface BaseSpawn {
  playerId: number;
  tileX: number;
  tileZ: number;
}

export interface RiverFord {
  tileX: number;
  tileZ: number;
  radius: number;
}

interface MountainPeak {
  x: number;
  z: number;
  r: number;
  peak: number;
}

interface LakeSpec {
  x: number;
  z: number;
  rx: number;
  rz: number;
  depth: number;
}

export class TerrainMap {
  readonly width = MAP_TILES;
  readonly height = MAP_TILES;
  readonly tileSize = TILE_SIZE;
  readonly worldSize = WORLD_SIZE;
  readonly seed: number;
  readonly requestedMapType: MapType;
  readonly resolvedMapType: ResolvedMapType;
  readonly mapLabel: string;

  /** Vertex heights: (width + 1) * (height + 1) */
  readonly heights: Float32Array;
  /** Static tile passability: 1 = walkable, 0 = blocked (deep water or steep mountain) */
  readonly staticPassable: Uint8Array;
  /** Shallow river ford mask (1 = walkable shallow crossing) */
  readonly fordMask: Uint8Array;
  /** Base spawn tile centers */
  readonly spawns: BaseSpawn[];
  /** River crossings */
  readonly fords: RiverFord[] = [];
  /** Generated inland lakes (useful for biome resource placement) */
  readonly lakes: LakeSpec[] = [];

  private readonly riverAxisCos: number;
  private readonly riverAxisSin: number;
  private readonly riverFreq1: number;
  private readonly riverAmp1: number;
  private readonly riverFreq2: number;
  private readonly riverAmp2: number;
  private readonly hasRiver: boolean;

  constructor(seed: number, mapType: MapType = 'random') {
    this.seed = seed;
    this.requestedMapType = mapType;
    const rng = new SeededRNG((seed * 2654435761) >>> 0);

    this.resolvedMapType =
      mapType === 'random'
        ? ALL_MAP_TYPES[rng.int(0, ALL_MAP_TYPES.length - 1)]
        : mapType;
    this.mapLabel = MAP_TYPE_LABELS[this.resolvedMapType];

    const vw = this.width + 1;
    const vh = this.height + 1;
    this.heights = new Float32Array(vw * vh);
    this.staticPassable = new Uint8Array(this.width * this.height);
    this.fordMask = new Uint8Array(this.width * this.height);

    // Randomize opposing symmetrical spawn positions around map center (64, 64)
    const spawnAngle = rng.range(0, Math.PI * 2);
    const spawnDist =
      this.resolvedMapType === 'inland_oasis'
        ? rng.range(43, 47)
        : this.resolvedMapType === 'twin_peninsulas'
          ? rng.range(40, 45)
          : rng.range(40, 48);

    const sx1 = Math.max(22, Math.min(this.width - 22, Math.round(64 + Math.cos(spawnAngle) * spawnDist)));
    const sz1 = Math.max(22, Math.min(this.height - 22, Math.round(64 + Math.sin(spawnAngle) * spawnDist)));
    const sx2 = this.width - sx1;
    const sz2 = this.height - sz1;

    this.spawns = [
      { playerId: 1, tileX: sx1, tileZ: sz1 },
      { playerId: 2, tileX: sx2, tileZ: sz2 },
    ];

    // River flows perpendicular to the spawn-to-spawn axis
    const axisX = sx2 - sx1;
    const axisZ = sz2 - sz1;
    const axisLen = Math.max(1, Math.hypot(axisX, axisZ));
    // Perpendicular unit vector along river centerline
    this.riverAxisCos = -axisZ / axisLen;
    this.riverAxisSin = axisX / axisLen;

    this.riverFreq1 = rng.range(0.065, 0.095);
    this.riverAmp1 = rng.range(4.5, 8.5) * (rng.next() < 0.5 ? 1 : -1);
    this.riverFreq2 = rng.range(0.14, 0.2);
    this.riverAmp2 = rng.range(1.4, 3.2) * (rng.next() < 0.5 ? 1 : -1);

    this.hasRiver =
      this.resolvedMapType === 'aegean_valley' ||
      this.resolvedMapType === 'open_plains';

    if (this.hasRiver) {
      const fordCount = this.resolvedMapType === 'open_plains' ? 3 : rng.int(2, 3);
      if (fordCount === 2) {
        const off = rng.range(16, 25);
        this.fords.push(this.makeFordAtS(-off, rng.range(7.2, 8.8)));
        this.fords.push(this.makeFordAtS(off, rng.range(7.2, 8.8)));
      } else {
        const off = rng.range(22, 30);
        this.fords.push(this.makeFordAtS(0, rng.range(7.8, 9.2)));
        this.fords.push(this.makeFordAtS(-off, rng.range(6.8, 8.2)));
        this.fords.push(this.makeFordAtS(off, rng.range(6.8, 8.2)));
      }
    }

    this.generateHeights(rng);
    this.computeStaticPassability();
    this.ensureSpawnConnectivity();
  }

  private getRiverMeander(s: number): number {
    // Odd-symmetric meander around s = 0 so both map halves stay balanced
    return Math.sin(s * this.riverFreq1) * this.riverAmp1 + Math.sin(s * this.riverFreq2) * this.riverAmp2;
  }

  private makeFordAtS(s: number, radius: number): RiverFord {
    const m = this.getRiverMeander(s);
    // Perpendicular unit vector to river direction is (-riverAxisSin, riverAxisCos)
    const perpX = -this.riverAxisSin;
    const perpZ = this.riverAxisCos;
    const tileX = Math.max(12, Math.min(this.width - 12, Math.round(64 + s * this.riverAxisCos + m * perpX)));
    const tileZ = Math.max(12, Math.min(this.height - 12, Math.round(64 + s * this.riverAxisSin + m * perpZ)));
    return { tileX, tileZ, radius };
  }

  /** Signed perpendicular distance from meandering river centerline */
  private getRiverCenterOffset(vx: number, vz: number): number {
    const dx = vx - 64;
    const dz = vz - 64;
    const s = dx * this.riverAxisCos + dz * this.riverAxisSin;
    const perp = dx * -this.riverAxisSin + dz * this.riverAxisCos;
    return perp - this.getRiverMeander(s);
  }

  private isFarFromSpawns(x: number, z: number, minDist: number): boolean {
    for (const s of this.spawns) {
      if (Math.hypot(x - s.tileX, z - s.tileZ) < minDist) return false;
    }
    return true;
  }

  private isFarFromFords(x: number, z: number, minDist: number): boolean {
    for (const f of this.fords) {
      if (Math.hypot(x - f.tileX, z - f.tileZ) < minDist) return false;
    }
    return true;
  }

  private generateHeights(rng: SeededRNG): void {
    const vw = this.width + 1;
    const vh = this.height + 1;

    // 1. Procedurally generate symmetrical inland lakes (湖)
    const lakes: LakeSpec[] = [];
    if (this.resolvedMapType === 'inland_oasis') {
      // Iconic central Aegean freshwater sea / oasis lake
      lakes.push({
        x: 64,
        z: 64,
        rx: rng.range(16, 21),
        rz: rng.range(14, 19),
        depth: 3.4,
      });
    }

    const lakePairs =
      this.resolvedMapType === 'aegean_valley'
        ? rng.int(1, 2)
        : this.resolvedMapType === 'medit_highlands'
          ? rng.int(1, 2)
          : this.resolvedMapType === 'open_plains'
            ? 1
            : this.resolvedMapType === 'inland_oasis'
              ? 1
              : 0;

    for (let i = 0; i < lakePairs; i++) {
      for (let tries = 0; tries < 25; tries++) {
        const lx = rng.range(18, 110);
        const lz = rng.range(18, 110);
        const rx = rng.range(7.0, 11.0);
        const rz = rng.range(6.0, 9.5);
        const mx = this.width - lx;
        const mz = this.height - lz;
        if (
          Math.hypot(lx - 64, lz - 64) > (this.resolvedMapType === 'inland_oasis' ? 28 : 16) &&
          this.isFarFromSpawns(lx, lz, 18) &&
          this.isFarFromSpawns(mx, mz, 18) &&
          this.isFarFromFords(lx, lz, 14) &&
          this.isFarFromFords(mx, mz, 14)
        ) {
          const depth = rng.range(2.2, 3.2);
          lakes.push({ x: lx, z: lz, rx, rz, depth });
          lakes.push({ x: mx, z: mz, rx, rz, depth });
          break;
        }
      }
    }
    this.lakes.push(...lakes);

    // 2. Procedurally generate symmetrical dramatic mountain peaks, ridges & strategic hills (山/高地)
    const mountains: MountainPeak[] = [];
    const mountainPairs =
      this.resolvedMapType === 'medit_highlands'
        ? rng.int(7, 9)
        : this.resolvedMapType === 'open_plains'
          ? rng.int(3, 5)
          : rng.int(5, 7);

    for (let i = 0; i < mountainPairs; i++) {
      for (let tries = 0; tries < 30; tries++) {
        const mx = rng.range(10, 118);
        const mz = rng.range(10, 118);
        const oppX = this.width - mx;
        const oppZ = this.height - mz;
        const r =
          this.resolvedMapType === 'medit_highlands'
            ? rng.range(11, 18)
            : rng.range(9.5, 16.0);
        const peak =
          this.resolvedMapType === 'medit_highlands'
            ? rng.range(13.0, 18.5)
            : rng.range(10.5, 16.5);

        const clearFromCenter = this.resolvedMapType === 'inland_oasis' ? 25 : 10;
        if (
          Math.hypot(mx - 64, mz - 64) > clearFromCenter &&
          this.isFarFromSpawns(mx, mz, 19) &&
          this.isFarFromSpawns(oppX, oppZ, 19) &&
          this.isFarFromFords(mx, mz, 12) &&
          this.isFarFromFords(oppX, oppZ, 12)
        ) {
          mountains.push({ x: mx, z: mz, r, peak });
          mountains.push({ x: oppX, z: oppZ, r, peak });
          // Flanking sub-peaks to form authentic connected Mediterranean mountain ridges
          if (rng.next() < 0.78) {
            const subAng = rng.range(0, Math.PI * 2);
            const subDist = r * 0.62;
            const sx = mx + Math.cos(subAng) * subDist;
            const sz = mz + Math.sin(subAng) * subDist;
            if (this.isFarFromSpawns(sx, sz, 16) && this.isFarFromFords(sx, sz, 10)) {
              mountains.push({ x: sx, z: sz, r: r * 0.76, peak: peak * 0.78 });
              mountains.push({ x: this.width - sx, z: this.height - sz, r: r * 0.76, peak: peak * 0.78 });
            }
          }
          break;
        }
      }
    }

    // 2b. Walkable tactical high-ground hills & terraced plateaus (climbable hills for elevation advantage!)
    const tacticalHills: MountainPeak[] = [];
    const hillPairs = rng.int(5, 8);
    for (let i = 0; i < hillPairs; i++) {
      for (let tries = 0; tries < 25; tries++) {
        const hx = rng.range(14, 114);
        const hz = rng.range(14, 114);
        const oppX = this.width - hx;
        const oppZ = this.height - hz;
        if (
          this.isFarFromSpawns(hx, hz, 12.5) &&
          this.isFarFromSpawns(oppX, oppZ, 12.5) &&
          this.isFarFromFords(hx, hz, 9) &&
          this.isFarFromFords(oppX, oppZ, 9)
        ) {
          const r = rng.range(8.5, 14.5);
          const peak = rng.range(3.2, 5.8);
          tacticalHills.push({ x: hx, z: hz, r, peak });
          tacticalHills.push({ x: oppX, z: oppZ, r, peak });
          break;
        }
      }
    }

    // Coastal sea bay centers aligned with river mouths (or flanking twin peninsulas)
    const bay1X = 64 + this.riverAxisCos * 60;
    const bay1Z = 64 + this.riverAxisSin * 60;
    const bay2X = 64 - this.riverAxisCos * 60;
    const bay2Z = 64 - this.riverAxisSin * 60;
    const bayRadius =
      this.resolvedMapType === 'twin_peninsulas'
        ? rng.range(41, 46)
        : this.resolvedMapType === 'aegean_valley'
          ? rng.range(28, 35)
          : this.resolvedMapType === 'open_plains'
            ? rng.range(18, 24)
            : rng.range(16, 22);

    const hillScale =
      this.resolvedMapType === 'open_plains'
        ? 0.85
        : this.resolvedMapType === 'medit_highlands'
          ? 1.5
          : 1.25;

    const baseElevation =
      this.resolvedMapType === 'medit_highlands'
        ? 3.2
        : this.resolvedMapType === 'twin_peninsulas'
          ? 2.1
          : 2.4;

    const riverHalfWidthBase =
      this.resolvedMapType === 'open_plains'
        ? rng.range(2.6, 3.2)
        : rng.range(3.3, 4.3);

    const seedA = this.seed + 241;
    const seedB = this.seed + 521;
    const seedC = this.seed + 911;

    for (let vz = 0; vz < vh; vz++) {
      for (let vx = 0; vx < vw; vx++) {
        // 1. Rich rolling Mediterranean hills, terraced swells & winding valleys
        const nBroad = fbm2D(vx * 0.036, vz * 0.036, this.seed, 4);
        const nMed = fbm2D(vx * 0.082, vz * 0.082, seedA, 3);
        const nDetail = fbm2D(vx * 0.16, vz * 0.16, seedB, 2);
        const nRidge = 1 - Math.abs(fbm2D(vx * 0.052, vz * 0.052, seedC, 3) * 2 - 1);

        let h =
          baseElevation +
          ((nBroad - 0.45) * 7.8 +
            (nMed - 0.5) * 3.1 +
            (nDetail - 0.5) * 0.95 +
            Math.pow(nRidge, 1.4) * 2.4) *
            hillScale;

        // Subtle natural terracing on mid-hills for authentic Mediterranean hillside steps
        if (h > 2.2 && h < 8.5) {
          const step = Math.sin(h * 1.65) * 0.24;
          h += step;
        }

        // 2a. Walkable tactical hills & terraced mesas
        for (const hill of tacticalHills) {
          const d = Math.hypot(vx - hill.x, vz - hill.z);
          if (d < hill.r) {
            const t = 1 - d / hill.r;
            // Smooth broad hilltop plateau profile
            const plateau = Math.min(1, t * 1.45);
            const smooth = plateau * plateau * (3 - 2 * plateau);
            h += smooth * hill.peak * (0.85 + nDetail * 0.3);
          }
        }

        // 2b. Dramatic Mountain Massifs (山)
        for (const m of mountains) {
          const d = Math.hypot(vx - m.x, vz - m.z);
          if (d < m.r) {
            const t = 1 - d / m.r;
            const ridgeMod = 0.78 + nRidge * 0.42 + (nDetail - 0.5) * 0.28;
            h += Math.pow(t, 1.55) * m.peak * ridgeMod;
          }
        }

        // 3. Aegean Sea Bays & Coastlines (海)
        const dBay1 = Math.hypot(vx - bay1X, vz - bay1Z);
        const dBay2 = Math.hypot(vx - bay2X, vz - bay2Z);
        const coastNoise = (nBroad - 0.5) * 8.5 + (nDetail - 0.5) * 3.0;
        const seaDist = Math.min(dBay1, dBay2) + coastNoise;
        if (seaDist < bayRadius) {
          const t = 1 - seaDist / bayRadius;
          h -= Math.pow(t, 1.45) * (this.resolvedMapType === 'twin_peninsulas' ? 12.5 : 10.5);
        }

        // Outer map coastal drop
        const borderDist = Math.min(vx, vz, this.width - vx, this.height - vz);
        if (borderDist < 4.5) {
          h -= (1 - borderDist / 4.5) * (this.resolvedMapType === 'inland_oasis' ? 2.0 : 4.8);
        }

        // 4. Winding River (河) with strategic shallow fords (淺灘渡口)
        if (this.hasRiver) {
          const riverDist = Math.abs(this.getRiverCenterOffset(vx, vz));
          const riverHalfWidth = riverHalfWidthBase + Math.sin((vx + vz) * 0.07) * 0.45;
          if (riverDist < riverHalfWidth + 4.5) {
            const bankT = Math.max(0, 1 - riverDist / (riverHalfWidth + 4.5));
            const smoothBank = bankT * bankT * (3 - 2 * bankT);
            let riverTarget = -2.25;

            let fordFactor = 0;
            for (const f of this.fords) {
              const fd = Math.hypot(vx - f.tileX, vz - f.tileZ);
              if (fd < f.radius + 2.5) {
                const ft = Math.max(0, 1 - Math.max(0, fd - f.radius * 0.65) / (f.radius * 0.35 + 2.5));
                fordFactor = Math.max(fordFactor, ft * ft * (3 - 2 * ft));
              }
            }
            if (fordFactor > 0) {
              riverTarget = riverTarget * (1 - fordFactor) + -0.05 * fordFactor;
            }

            if (riverDist < riverHalfWidth) {
              const coreT = 1 - riverDist / riverHalfWidth;
              const channelH = riverTarget + (1 - coreT * coreT) * (fordFactor > 0.3 ? 0.55 : 0.45);
              h = Math.min(h, h * (1 - smoothBank) + channelH * smoothBank);
            } else {
              h = h * (1 - smoothBank * 0.7) + 1.15 * (smoothBank * 0.7);
            }
          }
        }

        // 5. Scenic Inland Lakes (湖)
        for (const lake of lakes) {
          const lx = (vx - lake.x) / lake.rx;
          const lz = (vz - lake.z) / lake.rz;
          const ld = Math.hypot(lx, lz) + (nDetail - 0.5) * 0.22;
          if (ld < 1.42) {
            const t = Math.max(0, 1 - ld / 1.42);
            const smooth = t * t * (3 - 2 * t);
            const targetH = ld < 1.0 ? -lake.depth * (1 - ld * ld * 0.65) : 0.8;
            h = h * (1 - smooth) + targetH * smooth;
          }
        }

        // 6. Keep immediate Civic Center core buildable while letting natural hills rise right nearby
        for (const s of this.spawns) {
          const d = Math.hypot(vx - s.tileX, vz - s.tileZ);
          if (d < 10.5) {
            const targetH = 2.2 + (nMed - 0.5) * 0.75 + (nDetail - 0.5) * 0.32;
            const blend = d < 5.2 ? 1.0 : 1 - (d - 5.2) / 5.3;
            const smooth = blend * blend * (3 - 2 * blend);
            h = h * (1 - smooth) + targetH * smooth;
          }
        }

        this.heights[vz * vw + vx] = h;
      }
    }
  }

  private computeStaticPassability(): void {
    const maxSlope = 2.15;
    const maxWalkableHeight = 11.5;
    this.fordMask.fill(0);

    for (let tz = 0; tz < this.height; tz++) {
      for (let tx = 0; tx < this.width; tx++) {
        const idx = tz * this.width + tx;
        if (tx < 2 || tz < 2 || tx >= this.width - 2 || tz >= this.height - 2) {
          this.staticPassable[idx] = 0;
          continue;
        }
        const h00 = this.getVertexHeight(tx, tz);
        const h10 = this.getVertexHeight(tx + 1, tz);
        const h01 = this.getVertexHeight(tx, tz + 1);
        const h11 = this.getVertexHeight(tx + 1, tz + 1);
        const minH = Math.min(h00, h10, h01, h11);
        const maxH = Math.max(h00, h10, h01, h11);
        const avgH = (h00 + h10 + h01 + h11) * 0.25;
        const slope = maxH - minH;

        let inFord = false;
        for (const f of this.fords) {
          if (Math.hypot(tx - f.tileX, tz - f.tileZ) <= f.radius) {
            inFord = true;
            break;
          }
        }

        if (inFord && minH > WATER_LEVEL - 0.55 && slope <= maxSlope) {
          this.staticPassable[idx] = 1;
          this.fordMask[idx] = avgH < WATER_LEVEL + 0.35 ? 1 : 0;
        } else {
          const passable = minH > WATER_LEVEL + 0.08 && avgH < maxWalkableHeight && slope <= maxSlope;
          this.staticPassable[idx] = passable ? 1 : 0;
        }
      }
    }

    // Smooth isolated 1-tile impassable slope pinholes on climbable hillsides so units never snag mid-climb
    const copy = this.staticPassable.slice();
    for (let tz = 3; tz < this.height - 3; tz++) {
      for (let tx = 3; tx < this.width - 3; tx++) {
        const idx = tz * this.width + tx;
        if (copy[idx] === 1) continue;
        const h00 = this.getVertexHeight(tx, tz);
        const h10 = this.getVertexHeight(tx + 1, tz);
        const h01 = this.getVertexHeight(tx, tz + 1);
        const h11 = this.getVertexHeight(tx + 1, tz + 1);
        const minH = Math.min(h00, h10, h01, h11);
        const avgH = (h00 + h10 + h01 + h11) * 0.25;
        if (minH <= WATER_LEVEL + 0.12 || avgH >= maxWalkableHeight + 0.4) continue;
        const walkableNeighbors =
          copy[idx - 1] + copy[idx + 1] + copy[idx - this.width] + copy[idx + this.width];
        if (walkableNeighbors >= 3) {
          this.staticPassable[idx] = 1;
        }
      }
    }
  }

  /** Guarantees a walkable land/ford connection exists between Player 1 and Player 2 spawns */
  private ensureSpawnConnectivity(): void {
    if (this.areSpawnsConnected()) return;

    const s1 = this.spawns[0];
    const s2 = this.spawns[1];
    const vw = this.width + 1;
    const steps = 80;

    // Carve a smooth, continuous land pass / causeway connecting both bases
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const cx = s1.tileX + (s2.tileX - s1.tileX) * t;
      const cz = s1.tileZ + (s2.tileZ - s1.tileZ) * t;
      const rad = 8.0;
      const minX = Math.max(2, Math.floor(cx - rad));
      const maxX = Math.min(this.width - 2, Math.ceil(cx + rad));
      const minZ = Math.max(2, Math.floor(cz - rad));
      const maxZ = Math.min(this.height - 2, Math.ceil(cz + rad));
      for (let vz = minZ; vz <= maxZ; vz++) {
        for (let vx = minX; vx <= maxX; vx++) {
          const d = Math.hypot(vx - cx, vz - cz);
          if (d < rad) {
            const blend = 1 - d / rad;
            const smooth = blend * blend * (3 - 2 * blend);
            const cur = this.heights[vz * vw + vx];
            this.heights[vz * vw + vx] = cur * (1 - smooth) + 2.0 * smooth;
          }
        }
      }
    }

    this.computeStaticPassability();
  }

  areSpawnsConnected(): boolean {
    const s1 = this.spawns[0];
    const s2 = this.spawns[1];
    const visited = new Uint8Array(this.width * this.height);
    const queue = new Int32Array(this.width * this.height);
    let head = 0;
    let tail = 0;

    const startIdx = s1.tileZ * this.width + s1.tileX;
    visited[startIdx] = 1;
    queue[tail++] = startIdx;

    while (head < tail) {
      const idx = queue[head++];
      const tx = idx % this.width;
      const tz = (idx - tx) / this.width;
      if (Math.abs(tx - s2.tileX) <= 3 && Math.abs(tz - s2.tileZ) <= 3) return true;

      const neighbors = [idx - 1, idx + 1, idx - this.width, idx + this.width];
      for (const n of neighbors) {
        if (n < 0 || n >= visited.length || visited[n]) continue;
        if (this.staticPassable[n] === 0) continue;
        visited[n] = 1;
        queue[tail++] = n;
      }
    }
    return false;
  }

  getVertexHeight(vx: number, vz: number): number {
    const cx = Math.max(0, Math.min(this.width, vx));
    const cz = Math.max(0, Math.min(this.height, vz));
    return this.heights[cz * (this.width + 1) + cx];
  }

  getHeightAt(wx: number, wz: number): number {
    const fx = Math.max(0, Math.min(this.width - 0.001, wx / this.tileSize));
    const fz = Math.max(0, Math.min(this.height - 0.001, wz / this.tileSize));
    const x0 = Math.floor(fx);
    const z0 = Math.floor(fz);
    const tx = fx - x0;
    const tz = fz - z0;

    const h00 = this.getVertexHeight(x0, z0);
    const h10 = this.getVertexHeight(x0 + 1, z0);
    const h01 = this.getVertexHeight(x0, z0 + 1);
    const h11 = this.getVertexHeight(x0 + 1, z0 + 1);

    const a = h00 * (1 - tx) + h10 * tx;
    const b = h01 * (1 - tx) + h11 * tx;
    return a * (1 - tz) + b * tz;
  }

  getTileSlope(tx: number, tz: number): number {
    const h00 = this.getVertexHeight(tx, tz);
    const h10 = this.getVertexHeight(tx + 1, tz);
    const h01 = this.getVertexHeight(tx, tz + 1);
    const h11 = this.getVertexHeight(tx + 1, tz + 1);
    return Math.max(h00, h10, h01, h11) - Math.min(h00, h10, h01, h11);
  }

  isTileStaticPassable(tx: number, tz: number): boolean {
    if (tx < 0 || tz < 0 || tx >= this.width || tz >= this.height) return false;
    return this.staticPassable[tz * this.width + tx] === 1;
  }

  isTileDryLand(tx: number, tz: number): boolean {
    if (!this.isTileStaticPassable(tx, tz)) return false;
    return this.fordMask[tz * this.width + tx] === 0 && this.getVertexHeight(tx, tz) > WATER_LEVEL + 0.25;
  }

  worldToTile(wx: number, wz: number): { tx: number; tz: number } {
    return {
      tx: Math.max(0, Math.min(this.width - 1, Math.floor(wx / this.tileSize))),
      tz: Math.max(0, Math.min(this.height - 1, Math.floor(wz / this.tileSize))),
    };
  }

  tileToWorldCenter(tx: number, tz: number): { x: number; z: number } {
    return {
      x: (tx + 0.5) * this.tileSize,
      z: (tz + 0.5) * this.tileSize,
    };
  }
}
