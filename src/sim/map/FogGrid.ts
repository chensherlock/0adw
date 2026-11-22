import { TEMPLATES } from '../../config/entities';
import { Entity } from '../../config/types';
import { TerrainMap } from './TerrainMap';

/**
 * 0 = Unexplored shroud
 * 1 = Explored fog of war
 * 2 = Currently visible
 */
export class FogGrid {
  readonly width: number;
  readonly height: number;
  private readonly terrain: TerrainMap;
  private readonly grids: Map<number, Uint8Array> = new Map();
  private readonly circleCache: Map<number, Int16Array> = new Map();
  version = 0;

  constructor(terrain: TerrainMap, playerIds: number[]) {
    this.terrain = terrain;
    this.width = terrain.width;
    this.height = terrain.height;
    for (const pid of playerIds) {
      this.grids.set(pid, new Uint8Array(this.width * this.height));
    }
  }

  getGrid(playerId: number): Uint8Array {
    let g = this.grids.get(playerId);
    if (!g) {
      g = new Uint8Array(this.width * this.height);
      this.grids.set(playerId, g);
    }
    return g;
  }

  update(entities: Iterable<Entity>, sharedAllies?: Map<number, number[]>): void {
    // Demote visible (2) to explored fog (1)
    for (const grid of this.grids.values()) {
      for (let i = 0; i < grid.length; i++) {
        if (grid[i] === 2) grid[i] = 1;
      }
    }

    for (const e of entities) {
      if (!e.alive || e.owner === 0 || e.garrisonedIn !== null) continue;
      const tpl = TEMPLATES[e.templateId];
      if (!tpl || tpl.visionRange <= 0) continue;

      const grid = this.grids.get(e.owner);
      if (!grid) continue;

      const radiusTiles = Math.max(2, Math.round(tpl.visionRange / this.terrain.tileSize));
      const { tx, tz } = this.terrain.worldToTile(e.x, e.z);
      const offsets = this.getCircleOffsets(radiusTiles);
      const allies = sharedAllies?.get(e.owner);
      for (let i = 0; i < offsets.length; i += 2) {
        const nx = tx + offsets[i];
        const nz = tz + offsets[i + 1];
        if (nx >= 0 && nz >= 0 && nx < this.width && nz < this.height) {
          const idx = nz * this.width + nx;
          grid[idx] = 2;
          // Authentic 0 A.D. Shared Allied Vision!
          if (allies) {
            for (let a = 0; a < allies.length; a++) {
              const ag = this.grids.get(allies[a]);
              if (ag) ag[idx] = 2;
            }
          }
        }
      }
    }

    this.version++;
  }

  exportState(): Record<number, number[]> {
    const out: Record<number, number[]> = {};
    for (const [pid, g] of this.grids.entries()) {
      out[pid] = Array.from(g);
    }
    return out;
  }

  importState(data: Record<number, number[]>): void {
    for (const [k, arr] of Object.entries(data)) {
      const pid = Number(k);
      const g = this.getGrid(pid);
      if (arr.length === g.length) {
        g.set(arr);
      }
    }
    this.version++;
  }

  isVisibleTo(playerId: number, wx: number, wz: number): boolean {
    const grid = this.grids.get(playerId);
    if (!grid) return true;
    const { tx, tz } = this.terrain.worldToTile(wx, wz);
    return grid[tz * this.width + tx] === 2;
  }

  isExploredBy(playerId: number, wx: number, wz: number): boolean {
    const grid = this.grids.get(playerId);
    if (!grid) return true;
    const { tx, tz } = this.terrain.worldToTile(wx, wz);
    return grid[tz * this.width + tx] >= 1;
  }

  private getCircleOffsets(radius: number): Int16Array {
    let cached = this.circleCache.get(radius);
    if (cached) return cached;
    const pts: number[] = [];
    const r2 = radius * radius + radius * 0.5;
    for (let dz = -radius; dz <= radius; dz++) {
      for (let dx = -radius; dx <= radius; dx++) {
        if (dx * dx + dz * dz <= r2) {
          pts.push(dx, dz);
        }
      }
    }
    cached = new Int16Array(pts);
    this.circleCache.set(radius, cached);
    return cached;
  }
}
