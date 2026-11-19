import { Entity } from '../../config/types';

export class SpatialHash {
  private readonly cellSize: number;
  private readonly invCellSize: number;
  private readonly gridCols: number;
  private readonly buckets: Map<number, Entity[]> = new Map();

  constructor(worldSize: number, cellSize = 6) {
    this.cellSize = cellSize;
    this.invCellSize = 1 / cellSize;
    this.gridCols = Math.ceil(worldSize / cellSize) + 2;
  }

  clear(): void {
    for (const arr of this.buckets.values()) {
      arr.length = 0;
    }
  }

  private key(cx: number, cz: number): number {
    return cz * this.gridCols + cx;
  }

  insert(entity: Entity): void {
    const cx = Math.floor(entity.x * this.invCellSize);
    const cz = Math.floor(entity.z * this.invCellSize);
    const k = this.key(cx, cz);
    let bucket = this.buckets.get(k);
    if (!bucket) {
      bucket = [];
      this.buckets.set(k, bucket);
    }
    bucket.push(entity);
  }

  queryRadius(x: number, z: number, radius: number, out: Entity[] = []): Entity[] {
    out.length = 0;
    const minX = Math.floor((x - radius) * this.invCellSize);
    const maxX = Math.floor((x + radius) * this.invCellSize);
    const minZ = Math.floor((z - radius) * this.invCellSize);
    const maxZ = Math.floor((z + radius) * this.invCellSize);
    const r2 = radius * radius;

    for (let cz = minZ; cz <= maxZ; cz++) {
      for (let cx = minX; cx <= maxX; cx++) {
        const bucket = this.buckets.get(this.key(cx, cz));
        if (!bucket || bucket.length === 0) continue;
        for (let i = 0; i < bucket.length; i++) {
          const e = bucket[i];
          const dx = e.x - x;
          const dz = e.z - z;
          if (dx * dx + dz * dz <= r2) {
            out.push(e);
          }
        }
      }
    }
    return out;
  }
}
