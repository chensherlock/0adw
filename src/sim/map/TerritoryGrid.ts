import { TEMPLATES } from '../../config/entities';
import { Entity } from '../../config/types';
import { TerrainMap } from './TerrainMap';

export class TerritoryGrid {
  readonly width: number;
  readonly height: number;
  /** 0 = neutral, 1 = player 1, 2 = player 2 */
  readonly owner: Uint8Array;
  /** 1 = tile lies on a territory border edge */
  readonly border: Uint8Array;
  version = 0;

  private readonly bestScore: Float32Array;
  private readonly terrain: TerrainMap;

  constructor(terrain: TerrainMap) {
    this.terrain = terrain;
    this.width = terrain.width;
    this.height = terrain.height;
    const total = this.width * this.height;
    this.owner = new Uint8Array(total);
    this.border = new Uint8Array(total);
    this.bestScore = new Float32Array(total);
  }

  recompute(entities: Iterable<Entity>, playerPhases?: Map<number, number>): void {
    this.owner.fill(0);
    this.border.fill(0);
    this.bestScore.fill(0);

    for (const e of entities) {
      if (!e.alive || e.owner === 0 || e.isFoundation) continue;
      const tpl = TEMPLATES[e.templateId];
      if (!tpl || !tpl.territoryRadius || tpl.territoryRadius <= 0) continue;

      const phase = playerPhases?.get(e.owner) ?? 1;
      const phaseBonus = tpl.isCivicCenter
        ? phase >= 4
          ? 12
          : phase === 3
            ? 7
            : phase === 2
              ? 3
              : 0
        : 0;
      const rad = tpl.territoryRadius + phaseBonus;
      const rad2 = rad * rad;
      const weight = tpl.territoryWeight ?? 1.0;
      const cx = e.tileX;
      const cz = e.tileZ;
      const minX = Math.max(0, Math.floor(cx - rad));
      const maxX = Math.min(this.width - 1, Math.ceil(cx + rad));
      const minZ = Math.max(0, Math.floor(cz - rad));
      const maxZ = Math.min(this.height - 1, Math.ceil(cz + rad));

      for (let tz = minZ; tz <= maxZ; tz++) {
        const dz = tz - cz;
        for (let tx = minX; tx <= maxX; tx++) {
          const dx = tx - cx;
          const d2 = dx * dx + dz * dz;
          if (d2 > rad2) continue;
          const idx = tz * this.width + tx;
          // Territory encompasses land, coasts, water bodies AND mountain peaks!
          const falloff = 1 - Math.sqrt(d2) / rad;
          const score = falloff * falloff * weight;
          if (score > this.bestScore[idx]) {
            this.bestScore[idx] = score;
            this.owner[idx] = e.owner;
          }
        }
      }
    }

    // Mark border edge tiles
    for (let tz = 1; tz < this.height - 1; tz++) {
      for (let tx = 1; tx < this.width - 1; tx++) {
        const idx = tz * this.width + tx;
        const o = this.owner[idx];
        if (o === 0) continue;
        if (
          this.owner[idx - 1] !== o ||
          this.owner[idx + 1] !== o ||
          this.owner[idx - this.width] !== o ||
          this.owner[idx + this.width] !== o
        ) {
          this.border[idx] = 1;
        }
      }
    }

    this.version++;
  }

  getOwnerAtTile(tx: number, tz: number): number {
    if (tx < 0 || tz < 0 || tx >= this.width || tz >= this.height) return 0;
    return this.owner[tz * this.width + tx];
  }

  getOwnerAtWorld(wx: number, wz: number): number {
    const { tx, tz } = this.terrain.worldToTile(wx, wz);
    return this.getOwnerAtTile(tx, tz);
  }
}
