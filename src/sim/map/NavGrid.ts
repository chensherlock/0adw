import { TerrainMap } from './TerrainMap';

interface HeapNode {
  idx: number;
  f: number;
}

class MinHeap {
  private data: HeapNode[] = [];

  get size(): number {
    return this.data.length;
  }

  clear(): void {
    this.data.length = 0;
  }

  push(idx: number, f: number): void {
    const node = { idx, f };
    this.data.push(node);
    this.bubbleUp(this.data.length - 1);
  }

  pop(): number {
    const top = this.data[0].idx;
    const last = this.data.pop()!;
    if (this.data.length > 0) {
      this.data[0] = last;
      this.sinkDown(0);
    }
    return top;
  }

  private bubbleUp(i: number): void {
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (this.data[i].f >= this.data[p].f) break;
      const tmp = this.data[i];
      this.data[i] = this.data[p];
      this.data[p] = tmp;
      i = p;
    }
  }

  private sinkDown(i: number): void {
    const n = this.data.length;
    while (true) {
      let smallest = i;
      const l = (i << 1) + 1;
      const r = l + 1;
      if (l < n && this.data[l].f < this.data[smallest].f) smallest = l;
      if (r < n && this.data[r].f < this.data[smallest].f) smallest = r;
      if (smallest === i) break;
      const tmp = this.data[i];
      this.data[i] = this.data[smallest];
      this.data[smallest] = tmp;
      i = smallest;
    }
  }
}

const DIRS: ReadonlyArray<readonly [number, number, number]> = [
  [1, 0, 1.0],
  [-1, 0, 1.0],
  [0, 1, 1.0],
  [0, -1, 1.0],
  [1, 1, 1.4142],
  [1, -1, 1.4142],
  [-1, 1, 1.4142],
  [-1, -1, 1.4142],
];

export class NavGrid {
  readonly width: number;
  readonly height: number;
  private readonly terrain: TerrainMap;
  /** Number of blocking structures covering each tile */
  private readonly blockedCount: Uint16Array;

  // Reusable A* buffers to avoid per-query allocations
  private readonly gScore: Float32Array;
  private readonly cameFrom: Int32Array;
  private readonly visitedStamp: Uint32Array;
  private readonly closedStamp: Uint32Array;
  private stamp = 1;
  private readonly heap = new MinHeap();

  constructor(terrain: TerrainMap) {
    this.terrain = terrain;
    this.width = terrain.width;
    this.height = terrain.height;
    const total = this.width * this.height;
    this.blockedCount = new Uint16Array(total);
    this.gScore = new Float32Array(total);
    this.cameFrom = new Int32Array(total);
    this.visitedStamp = new Uint32Array(total);
    this.closedStamp = new Uint32Array(total);
  }

  isWalkable(tx: number, tz: number): boolean {
    if (tx < 0 || tz < 0 || tx >= this.width || tz >= this.height) return false;
    const idx = tz * this.width + tx;
    return this.terrain.staticPassable[idx] === 1 && this.blockedCount[idx] === 0;
  }

  setFootprint(centerTx: number, centerTz: number, size: number, blocked: boolean): void {
    const startX = centerTx - Math.floor(size / 2);
    const startZ = centerTz - Math.floor(size / 2);
    for (let dz = 0; dz < size; dz++) {
      for (let dx = 0; dx < size; dx++) {
        const tx = startX + dx;
        const tz = startZ + dz;
        if (tx < 0 || tz < 0 || tx >= this.width || tz >= this.height) continue;
        const idx = tz * this.width + tx;
        if (blocked) {
          this.blockedCount[idx]++;
        } else if (this.blockedCount[idx] > 0) {
          this.blockedCount[idx]--;
        }
      }
    }
  }

  canPlaceFootprint(centerTx: number, centerTz: number, size: number): boolean {
    const startX = centerTx - Math.floor(size / 2);
    const startZ = centerTz - Math.floor(size / 2);
    for (let dz = 0; dz < size; dz++) {
      for (let dx = 0; dx < size; dx++) {
        const tx = startX + dx;
        const tz = startZ + dz;
        if (!this.isWalkable(tx, tz)) return false;
        if (!this.terrain.isTileDryLand(tx, tz)) return false;
        if (this.terrain.getTileSlope(tx, tz) > 0.85) return false;
      }
    }
    return true;
  }

  findNearestWalkable(
    tx: number,
    tz: number,
    maxRadius = 10,
    preferTx?: number,
    preferTz?: number
  ): { tx: number; tz: number } | null {
    if (this.isWalkable(tx, tz)) return { tx, tz };
    const px = preferTx ?? tx;
    const pz = preferTz ?? tz;
    for (let r = 1; r <= maxRadius; r++) {
      let best: { tx: number; tz: number } | null = null;
      let bestD2 = Infinity;
      for (let dz = -r; dz <= r; dz++) {
        for (let dx = -r; dx <= r; dx++) {
          if (Math.abs(dx) !== r && Math.abs(dz) !== r) continue;
          const nx = tx + dx;
          const nz = tz + dz;
          if (!this.isWalkable(nx, nz)) continue;
          const d2 = (nx - px) * (nx - px) + (nz - pz) * (nz - pz);
          if (d2 < bestD2) {
            bestD2 = d2;
            best = { tx: nx, tz: nz };
          }
        }
      }
      if (best) return best;
    }
    return null;
  }

  findPath(startX: number, startZ: number, goalX: number, goalZ: number, maxExpansions = 4500): Array<{ x: number; z: number }> {
    const sTile = this.terrain.worldToTile(startX, startZ);
    const gTileRaw = this.terrain.worldToTile(goalX, goalZ);

    const start = this.isWalkable(sTile.tx, sTile.tz)
      ? sTile
      : this.findNearestWalkable(sTile.tx, sTile.tz, 8, gTileRaw.tx, gTileRaw.tz);
    const goal = this.isWalkable(gTileRaw.tx, gTileRaw.tz)
      ? gTileRaw
      : this.findNearestWalkable(gTileRaw.tx, gTileRaw.tz, 16, sTile.tx, sTile.tz);

    if (!start || !goal) {
      return goal ? [this.terrain.tileToWorldCenter(goal.tx, goal.tz)] : [];
    }

    const goalWasWalkable = goal.tx === gTileRaw.tx && goal.tz === gTileRaw.tz;
    if (start.tx === goal.tx && start.tz === goal.tz) {
      return [goalWasWalkable ? { x: goalX, z: goalZ } : this.terrain.tileToWorldCenter(goal.tx, goal.tz)];
    }

    // Fast direct line-of-sight shortcut
    if (this.hasLineOfSight(start.tx, start.tz, goal.tx, goal.tz)) {
      const targetWorld = goalWasWalkable
        ? { x: goalX, z: goalZ }
        : this.terrain.tileToWorldCenter(goal.tx, goal.tz);
      return [targetWorld];
    }

    this.stamp++;
    if (this.stamp >= 0xffffff00) {
      this.visitedStamp.fill(0);
      this.closedStamp.fill(0);
      this.stamp = 1;
    }
    const st = this.stamp;
    this.heap.clear();

    const startIdx = start.tz * this.width + start.tx;
    const goalIdx = goal.tz * this.width + goal.tx;

    this.visitedStamp[startIdx] = st;
    this.gScore[startIdx] = 0;
    this.cameFrom[startIdx] = -1;
    this.heap.push(startIdx, this.heuristic(start.tx, start.tz, goal.tx, goal.tz));

    let bestIdx = startIdx;
    let bestH = this.heuristic(start.tx, start.tz, goal.tx, goal.tz);
    let expansions = 0;

    while (this.heap.size > 0 && expansions < maxExpansions) {
      const curIdx = this.heap.pop();
      if (this.closedStamp[curIdx] === st) continue;
      this.closedStamp[curIdx] = st;
      expansions++;

      if (curIdx === goalIdx) {
        bestIdx = curIdx;
        break;
      }

      const cx = curIdx % this.width;
      const cz = (curIdx - cx) / this.width;
      const curG = this.gScore[curIdx];

      for (let i = 0; i < DIRS.length; i++) {
        const [dx, dz, stepCost] = DIRS[i];
        const nx = cx + dx;
        const nz = cz + dz;
        if (!this.isWalkable(nx, nz)) continue;

        // Prevent diagonal corner cutting across blocked corners
        if (dx !== 0 && dz !== 0) {
          if (!this.isWalkable(cx + dx, cz) || !this.isWalkable(cx, cz + dz)) continue;
        }

        const nIdx = nz * this.width + nx;
        if (this.closedStamp[nIdx] === st) continue;

        const tentativeG = curG + stepCost;
        if (this.visitedStamp[nIdx] !== st || tentativeG < this.gScore[nIdx]) {
          this.visitedStamp[nIdx] = st;
          this.gScore[nIdx] = tentativeG;
          this.cameFrom[nIdx] = curIdx;
          const h = this.heuristic(nx, nz, goal.tx, goal.tz);
          if (h < bestH) {
            bestH = h;
            bestIdx = nIdx;
          }
          this.heap.push(nIdx, tentativeG + h * 1.05);
        }
      }
    }

    // Reconstruct tile path
    const tilePath: Array<{ tx: number; tz: number }> = [];
    let cur = bestIdx;
    while (cur !== -1 && cur !== startIdx) {
      const tx = cur % this.width;
      const tz = (cur - tx) / this.width;
      tilePath.push({ tx, tz });
      cur = this.cameFrom[cur];
    }
    tilePath.reverse();

    if (tilePath.length === 0) {
      return [this.terrain.tileToWorldCenter(goal.tx, goal.tz)];
    }

    // Smooth path using line-of-sight pruning
    const smoothed: Array<{ tx: number; tz: number }> = [];
    let anchorTx = start.tx;
    let anchorTz = start.tz;
    let i = 0;
    while (i < tilePath.length) {
      let furthest = i;
      for (let j = Math.min(tilePath.length - 1, i + 12); j > i; j--) {
        if (this.hasLineOfSight(anchorTx, anchorTz, tilePath[j].tx, tilePath[j].tz)) {
          furthest = j;
          break;
        }
      }
      smoothed.push(tilePath[furthest]);
      anchorTx = tilePath[furthest].tx;
      anchorTz = tilePath[furthest].tz;
      i = furthest + 1;
    }

    const worldPath = smoothed.map((p) => this.terrain.tileToWorldCenter(p.tx, p.tz));
    // Replace final waypoint with exact click coordinate if destination tile was walkable
    if (bestIdx === goalIdx && goal.tx === gTileRaw.tx && goal.tz === gTileRaw.tz) {
      worldPath[worldPath.length - 1] = { x: goalX, z: goalZ };
    }
    return worldPath;
  }

  private heuristic(ax: number, az: number, bx: number, bz: number): number {
    const dx = Math.abs(ax - bx);
    const dz = Math.abs(az - bz);
    return Math.max(dx, dz) + 0.4142 * Math.min(dx, dz);
  }

  private hasLineOfSight(x0: number, z0: number, x1: number, z1: number): boolean {
    let cx = x0;
    let cz = z0;
    const dx = Math.abs(x1 - x0);
    const dz = Math.abs(z1 - z0);
    const sx = x0 < x1 ? 1 : -1;
    const sz = z0 < z1 ? 1 : -1;
    let err = dx - dz;

    while (true) {
      if (!this.isWalkable(cx, cz)) return false;
      if (cx === x1 && cz === z1) return true;
      const e2 = err * 2;
      const stepX = e2 > -dz;
      const stepZ = e2 < dx;
      // Prevent diagonal LOS pruning from clipping impassable cliff/mountain corners!
      if (stepX && stepZ) {
        if (!this.isWalkable(cx + sx, cz) || !this.isWalkable(cx, cz + sz)) {
          return false;
        }
      }
      if (stepX) {
        err -= dz;
        cx += sx;
      }
      if (stepZ) {
        err += dx;
        cz += sz;
      }
    }
  }
}
