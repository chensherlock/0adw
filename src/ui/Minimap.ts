import { TEMPLATES } from '../config/entities';
import { RTSCamera } from '../render/RTSCamera';
import { extractTerritoryContours, TerritoryLoop } from '../render/TerritoryBorderBuilder';
import { TerrainMap, WATER_LEVEL } from '../sim/map/TerrainMap';
import { World } from '../sim/World';

export class Minimap {
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly size: number;
  private readonly baseCanvas: HTMLCanvasElement;
  private isLeftDragging = false;
  private cachedTerrainVersion = -1;
  private cachedTerritoryVersion = -1;
  private cachedTerritoryLoops: TerritoryLoop[] = [];

  constructor(
    canvas: HTMLCanvasElement,
    terrain: TerrainMap,
    private onJumpCamera: (wx: number, wz: number) => void,
    private onRightClickOrder: (wx: number, wz: number) => void
  ) {
    this.canvas = canvas;
    this.size = canvas.width;
    this.ctx = canvas.getContext('2d')!;

    this.baseCanvas = document.createElement('canvas');
    this.baseCanvas.width = terrain.width;
    this.baseCanvas.height = terrain.height;
    this.bakeTerrain(terrain);
    this.attachEvents(terrain);
  }

  rebuildTerrain(terrain: TerrainMap): void {
    this.cachedTerrainVersion = terrain.version;
    this.cachedTerritoryVersion = -1;
    this.cachedTerritoryLoops = [];
    this.bakeTerrain(terrain);
  }

  private bakeTerrain(terrain: TerrainMap): void {
    const bctx = this.baseCanvas.getContext('2d')!;
    const img = bctx.createImageData(terrain.width, terrain.height);
    const data = img.data;
    const mt = terrain.resolvedMapType;
    const isDesert = mt === 'inland_oasis';
    const isAlpine = mt === 'alpine_passes';
    const isMesa = mt === 'mesa';
    const isSwamp = mt === 'swamp';
    const isRainforest = mt === 'rainforest';
    const isForest = mt === 'forest';
    const isVolcano = mt === 'volcano';

    for (let z = 0; z < terrain.height; z++) {
      for (let x = 0; x < terrain.width; x++) {
        const h = terrain.getVertexHeight(x, z);
        const hR = terrain.getVertexHeight(x + 1, z);
        const hD = terrain.getVertexHeight(x, z + 1);
        const slope = terrain.getTileSlope(x, z);
        const isFord = terrain.fordMask[z * terrain.width + x] === 1;
        // Directional NW hillshade for crisp mountain & valley relief on minimap
        const shade = Math.max(0.68, Math.min(1.26, 1.0 + ((h - hR) + (h - hD)) * 0.16));

        let r = 108;
        let g = 140;
        let b = 74;

        const midX = terrain.width * 0.5;
        const midZ = terrain.height * 0.5;
        const sizeScale = terrain.width / 128;

        if (isFord) {
          // Bright sandy turquoise river crossing
          r = 165;
          g = 195;
          b = 168;
        } else if (h <= WATER_LEVEL - 1.8) {
          // Deep sea / glacial lake / volcano lava crater
          if (isVolcano && Math.hypot(x - midX, z - midZ) < 16 * sizeScale) {
            r = 235;
            g = 96;
            b = 24;
          } else if (isSwamp) {
            r = 32;
            g = 56;
            b = 42;
          } else {
            r = isAlpine ? 22 : 18;
            g = isAlpine ? 64 : 72;
            b = isAlpine ? 110 : 118;
          }
        } else if (h <= WATER_LEVEL) {
          if (isVolcano && Math.hypot(x - midX, z - midZ) < 16 * sizeScale) {
            r = 250;
            g = 140;
            b = 42;
          } else if (isSwamp) {
            r = 58;
            g = 84;
            b = 58;
          } else {
            r = isAlpine ? 62 : 42;
            g = isAlpine ? 132 : 136;
            b = isAlpine ? 172 : 166;
          }
        } else if (isVolcano) {
          r = h > 6.5 ? 58 : 82;
          g = h > 6.5 ? 50 : 76;
          b = h > 6.5 ? 48 : 68;
        } else if (isMesa) {
          r = slope > 0.9 ? 156 : 196;
          g = slope > 0.9 ? 76 : 118;
          b = slope > 0.9 ? 48 : 74;
        } else if (isSwamp) {
          r = 72;
          g = 104;
          b = 62;
        } else if (isRainforest) {
          r = 46;
          g = 128;
          b = 54;
        } else if (isForest) {
          r = 68;
          g = 116;
          b = 56;
        } else if (isDesert) {
          const distCenter = Math.hypot(x - midX, z - midZ);
          if (h > 7.8 || slope > 1.05) {
            r = 158;
            g = 114;
            b = 76;
          } else if (distCenter < 29 * sizeScale) {
            r = 92;
            g = 148;
            b = 68;
          } else {
            r = 216;
            g = 184;
            b = 122;
          }
        } else if (isAlpine) {
          if (slope > 1.05) {
            r = 104;
            g = 112;
            b = 124;
          } else if (h > 3.2) {
            r = 228;
            g = 236;
            b = 244;
          } else {
            r = 96;
            g = 126;
            b = 98;
          }
        } else if (h < 0.75) {
          // Golden beach / lakeshore
          r = 216;
          g = 196;
          b = 144;
        } else if (h > 11.8) {
          // Alpine snow peak
          r = 232;
          g = 236;
          b = 242;
        } else if (h > 7.8 || slope > 1.05) {
          // Rugged mountain rock
          r = 136;
          g = 130;
          b = 122;
        } else if (h > 4.4) {
          // Olive highland
          r = 152;
          g = 146;
          b = 92;
        }

        const dug = terrain.dugMask[z * (terrain.width + 1) + x];
        if (dug > 0.25 && h > WATER_LEVEL) {
          const blend = Math.min(0.65, dug * 0.65);
          r = r * (1 - blend) + 126 * blend;
          g = g * (1 - blend) + 94 * blend;
          b = b * (1 - blend) + 62 * blend;
        }

        const idx = (z * terrain.width + x) * 4;
        const mult = h <= WATER_LEVEL ? 1.0 : shade;
        data[idx] = Math.min(255, Math.round(r * mult));
        data[idx + 1] = Math.min(255, Math.round(g * mult));
        data[idx + 2] = Math.min(255, Math.round(b * mult));
        data[idx + 3] = 255;
      }
    }
    bctx.putImageData(img, 0, 0);
  }

  private attachEvents(terrain: TerrainMap): void {
    const toWorld = (e: MouseEvent) => {
      const rect = this.canvas.getBoundingClientRect();
      const nx = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
      const nz = Math.max(0, Math.min(1, (e.clientY - rect.top) / rect.height));
      return { wx: nx * terrain.worldSize, wz: nz * terrain.worldSize };
    };

    this.canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    this.canvas.addEventListener('mousedown', (e) => {
      e.stopPropagation();
      const { wx, wz } = toWorld(e);
      if (e.button === 0) {
        this.isLeftDragging = true;
        this.onJumpCamera(wx, wz);
      } else if (e.button === 2) {
        this.onRightClickOrder(wx, wz);
      }
    });
    window.addEventListener('mousemove', (e) => {
      if (!this.isLeftDragging) return;
      const { wx, wz } = toWorld(e);
      this.onJumpCamera(wx, wz);
    });
    window.addEventListener('mouseup', () => {
      this.isLeftDragging = false;
    });
  }

  render(world: World, camera: RTSCamera, humanPlayerId: number, revealAll: boolean): void {
    const ctx = this.ctx;
    const s = this.size;
    const scale = s / world.terrain.worldSize;
    const tilePx = s / world.terrain.width;

    // 1. Base terrain (re-bake automatically if workers dug/raised terrain)
    if (this.cachedTerrainVersion !== world.terrain.version) {
      this.cachedTerrainVersion = world.terrain.version;
      this.bakeTerrain(world.terrain);
    }
    ctx.drawImage(this.baseCanvas, 0, 0, s, s);

    // 2. Fog overlay (sampled every 2 tiles for ultra-fast 60fps canvas draw)
    const fogGrid = world.fog.getGrid(humanPlayerId);

    for (let tz = 0; tz < world.terrain.height; tz += 2) {
      for (let tx = 0; tx < world.terrain.width; tx += 2) {
        const idx = tz * world.terrain.width + tx;
        const f = revealAll ? 2 : fogGrid[idx];
        if (f === 0) {
          ctx.fillStyle = 'rgba(10, 14, 20, 0.88)';
          ctx.fillRect(tx * tilePx, tz * tilePx, tilePx * 2.1, tilePx * 2.1);
        } else if (f === 1) {
          ctx.fillStyle = 'rgba(10, 14, 20, 0.42)';
          ctx.fillRect(tx * tilePx, tz * tilePx, tilePx * 2.1, tilePx * 2.1);
        }
      }
    }

    // 2b. Crisp dashed territory border contours for all 2..8 nations (only over explored tiles)
    if (this.cachedTerritoryVersion !== world.territory.version) {
      this.cachedTerritoryVersion = world.territory.version;
      const owners = Array.from(world.players.keys());
      this.cachedTerritoryLoops = extractTerritoryContours(world.territory, world.terrain, {
        owners: owners.length > 0 ? owners : [1, 2],
        smoothingPasses: 3,
        maxSegmentLength: 0,
        minPerimeter: 6.0,
      });
    }

    if (this.cachedTerritoryLoops.length > 0) {
      ctx.save();
      ctx.lineWidth = 1.4;
      ctx.setLineDash([4, 3]);
      ctx.lineCap = 'butt';

      for (const loop of this.cachedTerritoryLoops) {
        const pts = loop.points;
        const n = pts.length;
        if (n < 3) continue;

        ctx.strokeStyle = world.players.get(loop.owner)?.cssColor ?? '#ef4444';
        ctx.beginPath();
        let drawing = false;

        for (let i = 0; i <= n; i++) {
          const p = pts[i % n];
          const { tx, tz } = world.terrain.worldToTile(p.x, p.z);
          const visible = revealAll || fogGrid[tz * world.terrain.width + tx] > 0;
          if (visible) {
            const px = p.x * scale;
            const pz = p.z * scale;
            if (!drawing) {
              ctx.moveTo(px, pz);
              drawing = true;
            } else {
              ctx.lineTo(px, pz);
            }
          } else {
            drawing = false;
          }
        }
        ctx.stroke();
      }

      ctx.restore();
    }

    // 3. Entities
    for (const e of world.entities.values()) {
      if (!e.alive || e.garrisonedIn !== null) continue;
      const tpl = TEMPLATES[e.templateId];
      if (!revealAll && e.owner !== humanPlayerId) {
        if (tpl.kind === 'unit' && !world.fog.isVisibleTo(humanPlayerId, e.x, e.z)) continue;
        if (tpl.kind !== 'unit' && !world.fog.isExploredBy(humanPlayerId, e.x, e.z)) continue;
      }

      const mx = e.x * scale;
      const mz = e.z * scale;

      if (tpl.kind === 'resource') {
        if (tpl.isFlying) continue;
        if (tpl.isSeaMonster) {
          ctx.fillStyle = '#f43f5e';
          ctx.fillRect(mx - 2.0, mz - 2.0, 4.0, 4.0);
        } else if (tpl.isAquatic) {
          ctx.fillStyle = '#38bdf8';
          ctx.fillRect(mx - 1.3, mz - 1.3, 2.6, 2.6);
        } else {
          ctx.fillStyle =
            tpl.resourceType === 'wood'
              ? '#234c28'
              : tpl.resourceType === 'food'
                ? '#e11d48'
                : tpl.resourceType === 'stone'
                  ? '#d6d3d1'
                  : '#f59e0b';
          ctx.fillRect(mx - 1, mz - 1, 2, 2);
        }
      } else if (tpl.kind === 'building') {
        ctx.fillStyle = world.players.get(e.owner)?.cssColor ?? '#f87171';
        const bs = tpl.isCivicCenter || tpl.isFortress ? 6 : 4;
        ctx.fillRect(mx - bs * 0.5, mz - bs * 0.5, bs, bs);
        ctx.strokeStyle = '#0f172a';
        ctx.lineWidth = 0.8;
        ctx.strokeRect(mx - bs * 0.5, mz - bs * 0.5, bs, bs);
      } else if (tpl.isNaval) {
        ctx.fillStyle = world.players.get(e.owner)?.cssColor ?? '#fca5a5';
        ctx.fillRect(mx - 2.0, mz - 2.0, 4.0, 4.0);
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 0.7;
        ctx.strokeRect(mx - 2.0, mz - 2.0, 4.0, 4.0);
      } else {
        ctx.fillStyle = world.players.get(e.owner)?.cssColor ?? '#fca5a5';
        ctx.fillRect(mx - 1.4, mz - 1.4, 2.8, 2.8);
      }
    }

    // 4. Camera viewport trapezoid
    const poly = camera.getMinimapViewportPolygon();
    if (poly.length >= 3) {
      ctx.beginPath();
      poly.forEach((p, idx) => {
        const px = p.x * scale;
        const pz = p.z * scale;
        if (idx === 0) ctx.moveTo(px, pz);
        else ctx.lineTo(px, pz);
      });
      ctx.closePath();
      ctx.strokeStyle = 'rgba(255, 250, 230, 0.9)';
      ctx.lineWidth = 1.4;
      ctx.stroke();
    }
  }
}
