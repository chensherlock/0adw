import { MapSize, MapType, ResolvedMapType } from '../../config/types';
import { fbm2D, SeededRNG } from '../rng';

export const MAP_TILES = 128;
export const TILE_SIZE = 2.0;
export const WORLD_SIZE = MAP_TILES * TILE_SIZE; // 256 world units (default medium)
export const WATER_LEVEL = 0.0;

export const MAP_SIZE_TILES: Record<MapSize, number> = {
  small: 96,
  medium: 128,
  large: 160,
  huge: 192,
};

export const ALL_MAP_TYPES: readonly ResolvedMapType[] = [
  'aegean_valley',
  'medit_highlands',
  'twin_peninsulas',
  'inland_oasis',
  'open_plains',
  'alpine_passes',
  'island',
  'mountain',
  'plateau',
  'hills',
  'mesa',
  'swamp',
  'rainforest',
  'forest',
  'volcano',
];

export const MAP_TYPE_LABELS: Record<ResolvedMapType, string> = {
  aegean_valley: 'Aegean River Valley',
  medit_highlands: 'Mediterranean Highlands',
  twin_peninsulas: 'Twin Peninsulas',
  inland_oasis: 'Desert Oasis',
  open_plains: 'Peloponnesian Plains',
  alpine_passes: 'Alpine Snow Passes',
  island: 'Sea Island',
  mountain: 'Mountain Range',
  plateau: 'Highland Plateau',
  hills: 'Rolling Hills',
  mesa: 'Stepped Mesa',
  swamp: 'Misty Swamp',
  rainforest: 'Tropical Rainforest',
  forest: 'Ancient Forest',
  volcano: 'Volcanic Caldera',
};

export const SOIL_UNITS_PER_TILE = 100;

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
  readonly width: number;
  readonly height: number;
  readonly tileSize = TILE_SIZE;
  readonly worldSize: number;
  readonly mapSize: MapSize;
  readonly seed: number;
  readonly requestedMapType: MapType;
  readonly resolvedMapType: ResolvedMapType;
  readonly mapLabel: string;

  /** Vertex heights: (width + 1) * (height + 1) */
  readonly heights: Float32Array;
  /** Per-vertex freshly dug/shaped soil intensity (0..1) for live terraforming visuals */
  readonly dugMask: Float32Array;
  /** Incremented whenever live terraforming modifies heights/passability */
  version = 0;
  /** Static tile passability: 1 = walkable, 0 = blocked (deep water or steep mountain) */
  readonly staticPassable: Uint8Array;
  /** Navigable water tile mask: 1 = deep sea/lake/river navigable by ships */
  readonly waterPassable: Uint8Array;
  /** Shallow river ford mask (1 = walkable shallow crossing) */
  readonly fordMask: Uint8Array;
  /** Completed stone/suspension bridge mask (1 = land-walkable bridge spanning over water or ravine) */
  readonly bridgeMask: Uint8Array;
  /** Remaining soil units per tile (starts at 100; tile only subsides when all 100 units are excavated!) */
  readonly tileSoilUnits: Uint8Array;
  /** Accumulated dumped soil units per tile (0..99; tile rises when 100 units are deposited!) */
  readonly tileFillUnits: Uint8Array;
  /** Per-tile completed terraform generation counter (so multiple workers assisting a tile accelerate 1 layer instead of digging deeper!) */
  readonly tileTerraformEpoch: Uint16Array;
  /** Incremented whenever any tile's partial excavation/fill unit progress changes (for live 3D progress bars) */
  soilProgressVersion = 0;
  private readonly activeSoilIndices = new Set<number>();
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

  constructor(seed: number, mapType: MapType = 'random', mapSize: MapSize = 'medium', numPlayers = 2) {
    this.seed = seed;
    this.mapSize = mapSize;
    this.width = MAP_SIZE_TILES[mapSize] ?? MAP_TILES;
    this.height = this.width;
    this.worldSize = this.width * this.tileSize;
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
    this.dugMask = new Float32Array(vw * vh);
    this.staticPassable = new Uint8Array(this.width * this.height);
    this.waterPassable = new Uint8Array(this.width * this.height);
    this.fordMask = new Uint8Array(this.width * this.height);
    this.bridgeMask = new Uint8Array(this.width * this.height);
    this.tileSoilUnits = new Uint8Array(this.width * this.height);
    this.tileSoilUnits.fill(SOIL_UNITS_PER_TILE);
    this.tileFillUnits = new Uint8Array(this.width * this.height);
    this.tileTerraformEpoch = new Uint16Array(this.width * this.height);

    // Randomize opposing symmetrical spawn positions around map center for 2..8 nations!
    const playerCount = Math.max(2, Math.min(8, Math.round(numPlayers)));
    const midX = this.width * 0.5;
    const midZ = this.height * 0.5;
    const sizeScale = this.width / 128;
    const spawnAngle = rng.range(0, Math.PI * 2);
    const spawnDist =
      (this.resolvedMapType === 'island'
        ? rng.range(30, 35)
        : this.resolvedMapType === 'inland_oasis' || this.resolvedMapType === 'volcano'
          ? rng.range(43, 47)
          : this.resolvedMapType === 'twin_peninsulas'
            ? rng.range(40, 45)
            : rng.range(39, 46)) * sizeScale;

    const margin = Math.max(14, Math.round(20 * sizeScale));
    const sx1 = Math.max(margin, Math.min(this.width - margin, Math.round(midX + Math.cos(spawnAngle) * spawnDist)));
    const sz1 = Math.max(margin, Math.min(this.height - margin, Math.round(midZ + Math.sin(spawnAngle) * spawnDist)));
    const sx2 = this.width - sx1;
    const sz2 = this.height - sz1;

    if (playerCount === 2) {
      this.spawns = [
        { playerId: 1, tileX: sx1, tileZ: sz1 },
        { playerId: 2, tileX: sx2, tileZ: sz2 },
      ];
    } else {
      const ringDist = Math.min(this.width * 0.5 - margin, Math.max(spawnDist, 42 * sizeScale));
      this.spawns = [];
      for (let i = 0; i < playerCount; i++) {
        const ang = spawnAngle + (i / playerCount) * Math.PI * 2;
        const px = Math.max(margin, Math.min(this.width - margin, Math.round(midX + Math.cos(ang) * ringDist)));
        const pz = Math.max(margin, Math.min(this.height - margin, Math.round(midZ + Math.sin(ang) * ringDist)));
        this.spawns.push({ playerId: i + 1, tileX: px, tileZ: pz });
      }
    }

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
      this.resolvedMapType === 'open_plains' ||
      this.resolvedMapType === 'rainforest' ||
      this.resolvedMapType === 'swamp';

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
    const midX = this.width * 0.5;
    const midZ = this.height * 0.5;
    const tileX = Math.max(12, Math.min(this.width - 12, Math.round(midX + s * this.riverAxisCos + m * perpX)));
    const tileZ = Math.max(12, Math.min(this.height - 12, Math.round(midZ + s * this.riverAxisSin + m * perpZ)));
    return { tileX, tileZ, radius };
  }

  /** Signed perpendicular distance from meandering river centerline */
  private getRiverCenterOffset(vx: number, vz: number): number {
    const dx = vx - this.width * 0.5;
    const dz = vz - this.height * 0.5;
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
    const midX = this.width * 0.5;
    const midZ = this.height * 0.5;
    const sizeScale = this.width / 128;

    // 1. Procedurally generate symmetrical inland lakes (湖)
    const lakes: LakeSpec[] = [];
    if (this.resolvedMapType === 'inland_oasis') {
      // Iconic central Aegean freshwater sea / oasis lake
      lakes.push({
        x: midX,
        z: midZ,
        rx: rng.range(16, 21) * sizeScale,
        rz: rng.range(14, 19) * sizeScale,
        depth: 3.4,
      });
    }

    const lakePairs =
      this.resolvedMapType === 'swamp'
        ? 4
        : this.resolvedMapType === 'aegean_valley' ||
            this.resolvedMapType === 'medit_highlands' ||
            this.resolvedMapType === 'alpine_passes' ||
            this.resolvedMapType === 'forest' ||
            this.resolvedMapType === 'rainforest'
          ? rng.int(1, 2)
          : this.resolvedMapType === 'open_plains' ||
              this.resolvedMapType === 'hills' ||
              this.resolvedMapType === 'inland_oasis'
            ? 1
            : 0;

    for (let i = 0; i < lakePairs; i++) {
      for (let tries = 0; tries < 25; tries++) {
        const lx = rng.range(16, this.width - 16);
        const lz = rng.range(16, this.height - 16);
        const rx = rng.range(7.0, 11.0);
        const rz = rng.range(6.0, 9.5);
        const mx = this.width - lx;
        const mz = this.height - lz;
        if (
          Math.hypot(lx - midX, lz - midZ) > (this.resolvedMapType === 'inland_oasis' ? 28 : 16) * sizeScale &&
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
      this.resolvedMapType === 'mountain'
        ? rng.int(9, 11)
        : this.resolvedMapType === 'medit_highlands' || this.resolvedMapType === 'alpine_passes'
          ? rng.int(7, 9)
          : this.resolvedMapType === 'swamp' || this.resolvedMapType === 'island' || this.resolvedMapType === 'plateau'
            ? rng.int(1, 3)
            : this.resolvedMapType === 'open_plains' || this.resolvedMapType === 'hills' || this.resolvedMapType === 'forest'
              ? rng.int(3, 5)
              : rng.int(5, 7);

    for (let i = 0; i < mountainPairs; i++) {
      for (let tries = 0; tries < 30; tries++) {
        const mx = rng.range(10, this.width - 10);
        const mz = rng.range(10, this.height - 10);
        const oppX = this.width - mx;
        const oppZ = this.height - mz;
        const r =
          this.resolvedMapType === 'medit_highlands' || this.resolvedMapType === 'alpine_passes'
            ? rng.range(11, 18)
            : rng.range(9.5, 16.0);
        const peak =
          this.resolvedMapType === 'alpine_passes'
            ? rng.range(14.5, 20.0)
            : this.resolvedMapType === 'medit_highlands'
              ? rng.range(13.0, 18.5)
              : rng.range(10.5, 16.5);

        const clearFromCenter = (this.resolvedMapType === 'inland_oasis' ? 25 : 10) * sizeScale;
        if (
          Math.hypot(mx - midX, mz - midZ) > clearFromCenter &&
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
        const hx = rng.range(14, this.width - 14);
        const hz = rng.range(14, this.height - 14);
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
    const bayOffset = 60 * sizeScale;
    const bay1X = midX + this.riverAxisCos * bayOffset;
    const bay1Z = midZ + this.riverAxisSin * bayOffset;
    const bay2X = midX - this.riverAxisCos * bayOffset;
    const bay2Z = midZ - this.riverAxisSin * bayOffset;
    const bayRadius =
      (this.resolvedMapType === 'twin_peninsulas'
        ? rng.range(41, 46)
        : this.resolvedMapType === 'aegean_valley'
          ? rng.range(28, 35)
          : this.resolvedMapType === 'open_plains'
            ? rng.range(18, 24)
            : rng.range(16, 22)) * sizeScale;

    const hillScale =
      this.resolvedMapType === 'open_plains' || this.resolvedMapType === 'swamp'
        ? 0.72
        : this.resolvedMapType === 'hills'
          ? 1.65
          : this.resolvedMapType === 'mountain' ||
              this.resolvedMapType === 'medit_highlands' ||
              this.resolvedMapType === 'alpine_passes'
            ? 1.55
            : this.resolvedMapType === 'plateau'
              ? 0.65
              : 1.2;

    const baseElevation =
      this.resolvedMapType === 'swamp'
        ? 0.85
        : this.resolvedMapType === 'plateau'
          ? 5.6
          : this.resolvedMapType === 'mesa'
            ? 3.6
            : this.resolvedMapType === 'alpine_passes' || this.resolvedMapType === 'mountain'
              ? 3.5
              : this.resolvedMapType === 'medit_highlands'
                ? 3.2
                : this.resolvedMapType === 'twin_peninsulas' || this.resolvedMapType === 'island'
                  ? 2.2
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

        // Archetype-specific macro landform sculpting for the 9 new terrains!
        const distCenter = Math.hypot(vx - midX, vz - midZ);
        if (this.resolvedMapType === 'island') {
          // Lush central Sea Island ringed by deep navigable ocean + sandy beaches
          const islandRad = 49 * sizeScale + (nBroad - 0.5) * 14 + (nMed - 0.5) * 6;
          if (distCenter > islandRad - 10 * sizeScale) {
            const drop = Math.max(0, (distCenter - (islandRad - 10 * sizeScale)) / (18 * sizeScale));
            h -= drop * drop * 11.5;
          }
        } else if (this.resolvedMapType === 'plateau') {
          // High flat-topped central Highland Plateau with sheer cliff rim dropping to outer ring
          const platRad = 48 * sizeScale + (nBroad - 0.5) * 10;
          if (distCenter < platRad - 4) {
            h = 5.4 + (nMed - 0.5) * 1.1 + (nDetail - 0.5) * 0.4;
          } else {
            const edgeT = Math.min(1, (distCenter - (platRad - 4)) / 10);
            const smooth = edgeT * edgeT * (3 - 2 * edgeT);
            h = 5.4 * (1 - smooth) + 1.5 * smooth + (nDetail - 0.5) * 0.5;
          }
        } else if (this.resolvedMapType === 'mesa') {
          // Stepped flat-topped red-rock Mesa tablelands & eroded canyons
          const stepH = 2.35;
          const level = Math.floor(h / stepH);
          const frac = (h / stepH) - level;
          const terraced = level + Math.pow(frac, 4.0);
          h = Math.max(0.9, terraced * stepH);
        } else if (this.resolvedMapType === 'swamp') {
          // Low boggy wetland marshes with shallow murky water pools & winding channels
          const marshPool = Math.sin(vx * 0.14 + nBroad * 4.0) * Math.cos(vz * 0.14 - nMed * 3.5);
          if (marshPool > 0.32) {
            h -= (marshPool - 0.32) * 3.4;
          }
        } else if (this.resolvedMapType === 'volcano') {
          // Iconic towering central Volcanic Caldera with sunken glowing lava crater!
          const coneRad = 32 * sizeScale;
          const craterRad = 11.5 * sizeScale;
          if (distCenter < coneRad) {
            const coneT = 1 - distCenter / coneRad;
            const rimH = Math.pow(Math.sin(coneT * Math.PI * 0.82), 1.2) * 12.5;
            h = Math.max(h, 2.5 + rimH + (nDetail - 0.5) * 0.9);
          }
          if (distCenter < craterRad) {
            const crT = 1 - distCenter / craterRad;
            const smooth = crT * crT * (3 - 2 * crT);
            h = h * (1 - smooth) + -2.8 * smooth;
          }
        }

        // 3. Aegean Sea Bays & Coastlines (海) — only on coastal archetypes
        const isInlandArchetype =
          this.resolvedMapType === 'inland_oasis' ||
          this.resolvedMapType === 'alpine_passes' ||
          this.resolvedMapType === 'mountain' ||
          this.resolvedMapType === 'plateau' ||
          this.resolvedMapType === 'hills' ||
          this.resolvedMapType === 'mesa' ||
          this.resolvedMapType === 'forest' ||
          this.resolvedMapType === 'volcano' ||
          this.resolvedMapType === 'island';
        if (!isInlandArchetype) {
          const dBay1 = Math.hypot(vx - bay1X, vz - bay1Z);
          const dBay2 = Math.hypot(vx - bay2X, vz - bay2Z);
          const coastNoise = (nBroad - 0.5) * 8.5 + (nDetail - 0.5) * 3.0;
          const seaDist = Math.min(dBay1, dBay2) + coastNoise;
          if (seaDist < bayRadius) {
            const t = 1 - seaDist / bayRadius;
            h -= Math.pow(t, 1.45) * (this.resolvedMapType === 'twin_peninsulas' ? 12.5 : 10.5);
          }
        }

        // Outer map coastal drop
        const borderDist = Math.min(vx, vz, this.width - vx, this.height - vz);
        if (borderDist < 4.5 && this.resolvedMapType !== 'island') {
          const edgeDrop = isInlandArchetype ? 1.2 : 4.8;
          h -= (1 - borderDist / 4.5) * edgeDrop;
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
    this.waterPassable.fill(0);

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

        if (this.bridgeMask[idx] === 1) {
          this.staticPassable[idx] = 1;
          this.waterPassable[idx] = 0;
          continue;
        }

        if (inFord && minH > WATER_LEVEL - 0.55 && slope <= maxSlope) {
          this.staticPassable[idx] = 1;
          this.fordMask[idx] = avgH < WATER_LEVEL + 0.35 ? 1 : 0;
        } else {
          const passable = minH > WATER_LEVEL + 0.08 && avgH < maxWalkableHeight && slope <= maxSlope;
          this.staticPassable[idx] = passable ? 1 : 0;
          if (avgH <= WATER_LEVEL - 0.28) {
            this.waterPassable[idx] = 1;
          }
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

  /** Guarantees a walkable land/ford connection exists between Player 1 and EVERY other spawn (2..8 nations) */
  private ensureSpawnConnectivity(): void {
    if (this.areSpawnsConnected()) return;

    const s1 = this.spawns[0];
    const vw = this.width + 1;
    const steps = 80;

    for (let si = 1; si < this.spawns.length; si++) {
      if (this.isPairConnected(s1, this.spawns[si])) continue;
      const s2 = this.spawns[si];
      // Carve a smooth, continuous land pass / causeway connecting both bases
      for (let i = 0; i <= steps; i++) {
        const t = i / steps;
        const cx = s1.tileX + (s2.tileX - s1.tileX) * t;
        const cz = s1.tileZ + (s2.tileZ - s1.tileZ) * t;
        const rad = 7.5;
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
    }

    this.computeStaticPassability();
  }

  private isPairConnected(s1: BaseSpawn, s2: BaseSpawn): boolean {
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

  areSpawnsConnected(): boolean {
    const s1 = this.spawns[0];
    for (let i = 1; i < this.spawns.length; i++) {
      if (!this.isPairConnected(s1, this.spawns[i])) return false;
    }
    return true;
  }

  /** Exports mutable terraforming & bridge state for Save/Load */
  exportMutableState(): {
    heights: number[];
    dugMask: number[];
    bridgeMask: number[];
    tileSoilUnits: number[];
    tileFillUnits: number[];
    tileTerraformEpoch: number[];
  } {
    return {
      heights: Array.from(this.heights, (v) => Math.round(v * 1000) / 1000),
      dugMask: Array.from(this.dugMask, (v) => Math.round(v * 100) / 100),
      bridgeMask: Array.from(this.bridgeMask),
      tileSoilUnits: Array.from(this.tileSoilUnits),
      tileFillUnits: Array.from(this.tileFillUnits),
      tileTerraformEpoch: Array.from(this.tileTerraformEpoch),
    };
  }

  importMutableState(data: {
    heights: number[];
    dugMask: number[];
    bridgeMask: number[];
    tileSoilUnits: number[];
    tileFillUnits: number[];
    tileTerraformEpoch: number[];
  }): void {
    if (data.heights.length === this.heights.length) this.heights.set(data.heights);
    if (data.dugMask.length === this.dugMask.length) this.dugMask.set(data.dugMask);
    if (data.bridgeMask.length === this.bridgeMask.length) this.bridgeMask.set(data.bridgeMask);
    if (data.tileSoilUnits.length === this.tileSoilUnits.length) this.tileSoilUnits.set(data.tileSoilUnits);
    if (data.tileFillUnits.length === this.tileFillUnits.length) this.tileFillUnits.set(data.tileFillUnits);
    if (data.tileTerraformEpoch.length === this.tileTerraformEpoch.length) {
      this.tileTerraformEpoch.set(data.tileTerraformEpoch);
    }
    this.computeStaticPassability();
    this.version++;
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

  isTileWaterNavigable(tx: number, tz: number): boolean {
    if (tx < 0 || tz < 0 || tx >= this.width || tz >= this.height) return false;
    return this.waterPassable[tz * this.width + tx] === 1;
  }

  /**
   * Checks whether (tx, tz) sits cleanly on a coastline suitable for a Harbor Dock:
   * requires nearby dry land for builders to reach AND open navigable water right off the pier.
   */
  getCoastalDockInfo(tx: number, tz: number): {
    ok: boolean;
    waterAngle: number;
    waterTile: { tx: number; tz: number } | null;
  } {
    if (tx < 4 || tz < 4 || tx >= this.width - 4 || tz >= this.height - 4) {
      return { ok: false, waterAngle: 0, waterTile: null };
    }
    const centerH = this.getVertexHeight(tx, tz);
    if (centerH < WATER_LEVEL - 1.5 || centerH > WATER_LEVEL + 1.8) {
      return { ok: false, waterAngle: 0, waterTile: null };
    }

    let landCount = 0;
    let waterCount = 0;
    let waterDx = 0;
    let waterDz = 0;
    let bestWater: { tx: number; tz: number } | null = null;
    let bestWaterDist = Infinity;

    for (let dz = -3; dz <= 3; dz++) {
      for (let dx = -3; dx <= 3; dx++) {
        const nx = tx + dx;
        const nz = tz + dz;
        const d = Math.hypot(dx, dz);
        if (d > 3.5) continue;
        if (this.isTileDryLand(nx, nz) && d <= 2.8) {
          landCount++;
        }
        if (this.isTileWaterNavigable(nx, nz)) {
          waterCount++;
          waterDx += dx;
          waterDz += dz;
          if (d >= 1.4 && d < bestWaterDist) {
            bestWaterDist = d;
            bestWater = { tx: nx, tz: nz };
          }
        }
      }
    }

    if (landCount < 2 || waterCount < 4 || !bestWater) {
      return { ok: false, waterAngle: 0, waterTile: null };
    }

    const waterAngle = Math.atan2(waterDx, waterDz);
    return { ok: true, waterAngle, waterTile: bestWater };
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

  /**
   * Reshapes live terrain around a tile by `deltaHeight` meters (negative = dig, positive = pile/raise).
   * Returns true if any vertex height changed.
   */
  modifyTerrainDelta(tileX: number, tileZ: number, deltaHeight: number): boolean {
    if (tileX < 3 || tileZ < 3 || tileX > this.width - 4 || tileZ > this.height - 4) {
      return false;
    }
    const vw = this.width + 1;
    const cx = tileX + 0.5;
    const cz = tileZ + 0.5;
    const radius = 2.45;
    const flatCore = 0.75;
    const minH = WATER_LEVEL - 2.6;
    const maxH = 12.0;

    let changed = false;
    const minVx = Math.max(2, Math.floor(cx - radius));
    const maxVx = Math.min(this.width - 2, Math.ceil(cx + radius));
    const minVz = Math.max(2, Math.floor(cz - radius));
    const maxVz = Math.min(this.height - 2, Math.ceil(cz + radius));

    for (let vz = minVz; vz <= maxVz; vz++) {
      for (let vx = minVx; vx <= maxVx; vx++) {
        const d = Math.hypot(vx - cx, vz - cz);
        if (d >= radius) continue;
        const t = d <= flatCore ? 1 : 1 - (d - flatCore) / (radius - flatCore);
        const weight = t * t * (3 - 2 * t);
        const idx = vz * vw + vx;
        const prev = this.heights[idx];
        const next = Math.max(minH, Math.min(maxH, prev + deltaHeight * weight));
        if (Math.abs(next - prev) > 0.001) {
          this.heights[idx] = next;
          changed = true;
        }
        this.dugMask[idx] = Math.min(1, this.dugMask[idx] + weight * 0.9);
      }
    }

    if (!changed) return false;
    this.computeStaticPassability();
    this.version++;
    return true;
  }

  modifyTerrain(tileX: number, tileZ: number, mode: 'dig' | 'raise'): boolean {
    return this.modifyTerrainDelta(tileX, tileZ, mode === 'dig' ? -1.25 : 1.25);
  }

  /** Marks or clears a bridge tile spanning over water so land units can walk straight across */
  setBridgeTile(tileX: number, tileZ: number, active: boolean): void {
    if (tileX < 2 || tileZ < 2 || tileX >= this.width - 2 || tileZ >= this.height - 2) return;
    const idx = tileZ * this.width + tileX;
    this.bridgeMask[idx] = active ? 1 : 0;
    this.computeStaticPassability();
    this.version++;
  }

  isTileBridge(tx: number, tz: number): boolean {
    if (tx < 0 || tz < 0 || tx >= this.width || tz >= this.height) return false;
    return this.bridgeMask[tz * this.width + tx] === 1;
  }

  getSoilUnits(tx: number, tz: number): number {
    if (tx < 0 || tz < 0 || tx >= this.width || tz >= this.height) return 0;
    return this.tileSoilUnits[tz * this.width + tx];
  }

  getFillUnits(tx: number, tz: number): number {
    if (tx < 0 || tz < 0 || tx >= this.width || tz >= this.height) return 0;
    return this.tileFillUnits[tz * this.width + tx];
  }

  getTerraformEpoch(tx: number, tz: number): number {
    if (tx < 0 || tz < 0 || tx >= this.width || tz >= this.height) return 0;
    return this.tileTerraformEpoch[tz * this.width + tx];
  }

  /** Returns all tiles that currently have partial excavation (<100 soil remaining) or fill (>0 soil dumped) */
  getActiveSoilTiles(): Array<{ idx: number; tx: number; tz: number; dugUnits: number; fillUnits: number }> {
    const out: Array<{ idx: number; tx: number; tz: number; dugUnits: number; fillUnits: number }> = [];
    for (const idx of this.activeSoilIndices) {
      const rem = this.tileSoilUnits[idx];
      const fill = this.tileFillUnits[idx];
      const dugUnits = SOIL_UNITS_PER_TILE - rem;
      if (dugUnits <= 0 && fill <= 0) {
        this.activeSoilIndices.delete(idx);
        continue;
      }
      out.push({
        idx,
        tx: idx % this.width,
        tz: Math.floor(idx / this.width),
        dugUnits,
        fillUnits: fill,
      });
    }
    return out;
  }

  private syncActiveSoilIndex(idx: number): void {
    if (this.tileSoilUnits[idx] < SOIL_UNITS_PER_TILE || this.tileFillUnits[idx] > 0) {
      this.activeSoilIndices.add(idx);
    } else {
      this.activeSoilIndices.delete(idx);
    }
    this.soilProgressVersion++;
  }

  /**
   * Excavates `units` (default 1 per worker dig cycle) from a tile's 100-unit soil layer.
   * Only when all 100 units are removed does the terrain actually subside & visually drop!
   */
  digSoilUnit(tileX: number, tileZ: number, units = 1): { subsided: boolean; remaining: number } {
    if (tileX < 3 || tileZ < 3 || tileX > this.width - 4 || tileZ > this.height - 4) {
      return { subsided: false, remaining: 0 };
    }
    const idx = tileZ * this.width + tileX;
    const prev = this.tileSoilUnits[idx];
    const next = Math.max(0, prev - units);
    if (next === 0) {
      this.modifyTerrainDelta(tileX, tileZ, -1.05);
      this.tileSoilUnits[idx] = SOIL_UNITS_PER_TILE;
      this.tileTerraformEpoch[idx]++;
      this.syncActiveSoilIndex(idx);
      return { subsided: true, remaining: SOIL_UNITS_PER_TILE };
    }
    this.tileSoilUnits[idx] = next;
    this.syncActiveSoilIndex(idx);
    return { subsided: false, remaining: next };
  }

  /**
   * Deposits `units` of hauled earth onto a destination tile.
   * Once 100 units accumulate, the destination tile rises by +1.05m!
   */
  depositSoilUnit(tileX: number, tileZ: number, units = 1): { raised: boolean; filled: number } {
    if (tileX < 3 || tileZ < 3 || tileX > this.width - 4 || tileZ > this.height - 4) {
      return { raised: false, filled: 0 };
    }
    const idx = tileZ * this.width + tileX;
    const total = this.tileFillUnits[idx] + units;
    if (total >= SOIL_UNITS_PER_TILE) {
      this.modifyTerrainDelta(tileX, tileZ, 1.05);
      this.tileFillUnits[idx] = total - SOIL_UNITS_PER_TILE;
      this.tileTerraformEpoch[idx]++;
      this.syncActiveSoilIndex(idx);
      return { raised: true, filled: this.tileFillUnits[idx] };
    }
    this.tileFillUnits[idx] = total;
    this.syncActiveSoilIndex(idx);
    return { raised: false, filled: total };
  }

  /**
   * Grades and flattens an uneven hillside/slope around (tileX, tileZ) into a level buildable terrace
   * once 100 soil units of grading work are completed!
   */
  levelSoilUnit(tileX: number, tileZ: number, units = 1): { leveled: boolean; remaining: number } {
    if (tileX < 3 || tileZ < 3 || tileX > this.width - 4 || tileZ > this.height - 4) {
      return { leveled: false, remaining: 0 };
    }
    const idx = tileZ * this.width + tileX;
    const next = Math.max(0, this.tileSoilUnits[idx] - units);
    if (next === 0) {
      this.flattenTerrace(tileX, tileZ);
      this.tileSoilUnits[idx] = SOIL_UNITS_PER_TILE;
      this.tileTerraformEpoch[idx]++;
      this.syncActiveSoilIndex(idx);
      return { leveled: true, remaining: SOIL_UNITS_PER_TILE };
    }
    this.tileSoilUnits[idx] = next;
    this.syncActiveSoilIndex(idx);
    return { leveled: false, remaining: next };
  }

  /** Smoothly flattens a 4x4 tile area around (tileX, tileZ) so buildings can be constructed on formerly uneven slopes */
  flattenTerrace(tileX: number, tileZ: number): boolean {
    if (tileX < 3 || tileZ < 3 || tileX > this.width - 4 || tileZ > this.height - 4) return false;
    const vw = this.width + 1;
    const cx = tileX + 0.5;
    const cz = tileZ + 0.5;

    // Target height = average height of immediate center, clamped to dry buildable land
    const avgH =
      (this.getVertexHeight(tileX, tileZ) +
        this.getVertexHeight(tileX + 1, tileZ) +
        this.getVertexHeight(tileX, tileZ + 1) +
        this.getVertexHeight(tileX + 1, tileZ + 1)) *
      0.25;
    const targetH = Math.max(WATER_LEVEL + 0.9, Math.min(9.5, avgH));

    const flatRad = 2.6;
    const blendRad = 4.5;
    const minVx = Math.max(2, Math.floor(cx - blendRad));
    const maxVx = Math.min(this.width - 2, Math.ceil(cx + blendRad));
    const minVz = Math.max(2, Math.floor(cz - blendRad));
    const maxVz = Math.min(this.height - 2, Math.ceil(cz + blendRad));

    for (let vz = minVz; vz <= maxVz; vz++) {
      for (let vx = minVx; vx <= maxVx; vx++) {
        const d = Math.hypot(vx - cx, vz - cz);
        if (d >= blendRad) continue;
        const t = d <= flatRad ? 1 : 1 - (d - flatRad) / (blendRad - flatRad);
        const smooth = t * t * (3 - 2 * t);
        const vIdx = vz * vw + vx;
        this.heights[vIdx] = this.heights[vIdx] * (1 - smooth) + targetH * smooth;
        this.dugMask[vIdx] = Math.min(1, this.dugMask[vIdx] + smooth * 0.75);
      }
    }
    this.computeStaticPassability();
    this.version++;
    return true;
  }
}
