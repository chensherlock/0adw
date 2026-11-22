import { TerrainMap } from '../sim/map/TerrainMap';
import { TerritoryGrid } from '../sim/map/TerritoryGrid';

export interface Point2D {
  x: number;
  z: number;
}

export interface TerritoryLoop {
  owner: number;
  points: Point2D[];
  perimeter: number;
}

// Marching Squares lookup table: pairs of [fromEdge, toEdge] oriented so owned (1) is on the right
// Edges: 0 = Top, 1 = Right, 2 = Bottom, 3 = Left
const MS_SEGMENTS: ReadonlyArray<ReadonlyArray<readonly [number, number]>> = [
  [], // 0000
  [[3, 2]], // 0001 (BL)
  [[2, 1]], // 0010 (BR)
  [[3, 1]], // 0011 (BL, BR)
  [[1, 0]], // 0100 (TR)
  [[1, 0], [3, 2]], // 0101 (TR, BL)
  [[2, 0]], // 0110 (TR, BR)
  [[3, 0]], // 0111 (TR, BR, BL)
  [[0, 3]], // 1000 (TL)
  [[0, 2]], // 1001 (TL, BL)
  [[0, 3], [2, 1]], // 1010 (TL, BR)
  [[0, 1]], // 1011 (TL, BR, BL)
  [[1, 3]], // 1100 (TL, TR)
  [[1, 2]], // 1101 (TL, TR, BL)
  [[2, 3]], // 1110 (TL, TR, BR)
  [], // 1111
];

function edgeDoubledCoords(cx: number, cz: number, edge: number): [number, number] {
  switch (edge) {
    case 0:
      return [2 * cx + 2, 2 * cz + 1]; // Top
    case 1:
      return [2 * cx + 3, 2 * cz + 2]; // Right
    case 2:
      return [2 * cx + 2, 2 * cz + 3]; // Bottom
    default:
      return [2 * cx + 1, 2 * cz + 2]; // Left
  }
}

function smoothClosedLoopTaubin(pts: Point2D[], passes: number, worldSize: number): Point2D[] {
  const n = pts.length;
  if (n < 4) return pts;

  let cur = pts;
  const lambda = 0.5;
  const mu = -0.52;
  const minCoord = 0.5;
  const maxCoord = worldSize - 0.5;

  for (let p = 0; p < passes; p++) {
    const mid: Point2D[] = new Array(n);
    for (let i = 0; i < n; i++) {
      const prev = cur[(i - 1 + n) % n];
      const c = cur[i];
      const next = cur[(i + 1) % n];
      mid[i] = {
        x: c.x + lambda * ((prev.x + next.x) * 0.5 - c.x),
        z: c.z + lambda * ((prev.z + next.z) * 0.5 - c.z),
      };
    }

    const out: Point2D[] = new Array(n);
    for (let i = 0; i < n; i++) {
      const prev = mid[(i - 1 + n) % n];
      const c = mid[i];
      const next = mid[(i + 1) % n];
      const nx = c.x + mu * ((prev.x + next.x) * 0.5 - c.x);
      const nz = c.z + mu * ((prev.z + next.z) * 0.5 - c.z);
      out[i] = {
        x: Math.max(minCoord, Math.min(maxCoord, nx)),
        z: Math.max(minCoord, Math.min(maxCoord, nz)),
      };
    }
    cur = out;
  }

  return cur;
}

function subdivideClosedLoop(pts: Point2D[], maxSegLen: number): Point2D[] {
  const n = pts.length;
  if (n < 3) return pts;

  const out: Point2D[] = [];
  for (let i = 0; i < n; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % n];
    const dist = Math.hypot(b.x - a.x, b.z - a.z);
    if (dist < 1e-4) continue;
    const steps = Math.max(1, Math.ceil(dist / maxSegLen));
    for (let s = 0; s < steps; s++) {
      const t = s / steps;
      out.push({
        x: a.x + (b.x - a.x) * t,
        z: a.z + (b.z - a.z) * t,
      });
    }
  }
  return out;
}

function computePerimeter(pts: Point2D[]): number {
  let len = 0;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % pts.length];
    len += Math.hypot(b.x - a.x, b.z - a.z);
  }
  return len;
}

/**
 * Extracts smooth closed territory boundary contours for each player using Marching Squares
 * on the tile-center dual grid, followed by radius-preserving Taubin smoothing.
 */
export function extractTerritoryContours(
  territory: TerritoryGrid,
  terrain: TerrainMap,
  options?: {
    owners?: readonly number[];
    smoothingPasses?: number;
    maxSegmentLength?: number;
    minPerimeter?: number;
  }
): TerritoryLoop[] {
  const owners = options?.owners ?? [1, 2];
  const smoothingPasses = options?.smoothingPasses ?? 3;
  const maxSegmentLength = options?.maxSegmentLength ?? 1.0;
  const minPerimeter = options?.minPerimeter ?? 6.0;

  const w = territory.width;
  const h = territory.height;
  const tileSize = terrain.tileSize;
  const halfTile = tileSize * 0.5;
  const grid = territory.owner;
  const stride = 2 * w + 16;

  const loops: TerritoryLoop[] = [];

  for (const ownerId of owners) {
    const isOwned = (tx: number, tz: number): number =>
      tx >= 0 && tz >= 0 && tx < w && tz < h && grid[tz * w + tx] === ownerId ? 1 : 0;

    interface Segment {
      fromKey: number;
      toKey: number;
      x: number;
      z: number;
      used: boolean;
    }

    const segments: Segment[] = [];
    const outgoing = new Map<number, number[]>();

    for (let cz = -1; cz < h; cz++) {
      for (let cx = -1; cx < w; cx++) {
        const tl = isOwned(cx, cz);
        const tr = isOwned(cx + 1, cz);
        const br = isOwned(cx + 1, cz + 1);
        const bl = isOwned(cx, cz + 1);
        const mask = (tl << 3) | (tr << 2) | (br << 1) | bl;
        if (mask === 0 || mask === 15) continue;

        const pairs = MS_SEGMENTS[mask];
        for (let i = 0; i < pairs.length; i++) {
          const [eFrom, eTo] = pairs[i];
          const [fkx, fkz] = edgeDoubledCoords(cx, cz, eFrom);
          const [tkx, tkz] = edgeDoubledCoords(cx, cz, eTo);
          const fromKey = (fkz + 4) * stride + (fkx + 4);
          const toKey = (tkz + 4) * stride + (tkx + 4);
          const segIdx = segments.length;
          segments.push({
            fromKey,
            toKey,
            x: fkx * halfTile,
            z: fkz * halfTile,
            used: false,
          });
          let list = outgoing.get(fromKey);
          if (!list) {
            list = [];
            outgoing.set(fromKey, list);
          }
          list.push(segIdx);
        }
      }
    }

    // Stitch directed segments into closed loops
    for (let i = 0; i < segments.length; i++) {
      if (segments[i].used) continue;

      const rawPts: Point2D[] = [];
      let curIdx = i;
      const startKey = segments[i].fromKey;

      while (true) {
        const seg = segments[curIdx];
        seg.used = true;
        rawPts.push({ x: seg.x, z: seg.z });

        if (seg.toKey === startKey) break;
        const nextList = outgoing.get(seg.toKey);
        if (!nextList) break;

        let nextIdx = -1;
        for (let k = 0; k < nextList.length; k++) {
          if (!segments[nextList[k]].used) {
            nextIdx = nextList[k];
            break;
          }
        }
        if (nextIdx === -1) break;
        curIdx = nextIdx;
      }

      if (rawPts.length < 4) continue;
      const smoothed = smoothClosedLoopTaubin(rawPts, smoothingPasses, terrain.worldSize);
      const subdivided = maxSegmentLength > 0 ? subdivideClosedLoop(smoothed, maxSegmentLength) : smoothed;
      const perimeter = computePerimeter(subdivided);
      if (perimeter < minPerimeter) continue;

      loops.push({
        owner: ownerId,
        points: subdivided,
        perimeter,
      });
    }
  }

  return loops;
}
