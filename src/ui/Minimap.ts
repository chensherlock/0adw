import { TEMPLATES } from '../config/entities';
import { RTSCamera } from '../render/RTSCamera';
import { TerrainMap, WATER_LEVEL } from '../sim/map/TerrainMap';
import { World } from '../sim/World';

export class Minimap {
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly size: number;
  private readonly baseCanvas: HTMLCanvasElement;
  private isLeftDragging = false;

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
    this.bakeTerrain(terrain);
  }

  private bakeTerrain(terrain: TerrainMap): void {
    const bctx = this.baseCanvas.getContext('2d')!;
    const img = bctx.createImageData(terrain.width, terrain.height);
    const data = img.data;

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

        if (isFord) {
          // Bright sandy turquoise river crossing
          r = 165;
          g = 195;
          b = 168;
        } else if (h <= WATER_LEVEL - 1.8) {
          // Deep sea
          r = 18;
          g = 72;
          b = 118;
        } else if (h <= WATER_LEVEL) {
          // Shallow sea / river / inland lake
          r = 42;
          g = 136;
          b = 166;
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

    // 1. Base terrain
    ctx.drawImage(this.baseCanvas, 0, 0, s, s);

    // 2. Territory borders + Fog overlay (sampled every 2 tiles for ultra-fast 60fps canvas draw)
    const fogGrid = world.fog.getGrid(humanPlayerId);
    const terrOwner = world.territory.owner;
    const terrBorder = world.territory.border;
    const p1Css = world.players.get(1)?.cssColor ?? '#3b82f6';
    const p2Css = world.players.get(2)?.cssColor ?? '#ef4444';

    for (let tz = 0; tz < world.terrain.height; tz += 2) {
      for (let tx = 0; tx < world.terrain.width; tx += 2) {
        const idx = tz * world.terrain.width + tx;
        const f = revealAll ? 2 : fogGrid[idx];
        if (f === 0) {
          ctx.fillStyle = 'rgba(10, 14, 20, 0.88)';
          ctx.fillRect(tx * tilePx, tz * tilePx, tilePx * 2.1, tilePx * 2.1);
          continue;
        }
        const o = terrOwner[idx];
        if (o > 0) {
          const isB = terrBorder[idx] === 1;
          ctx.fillStyle = o === 1 ? p1Css : p2Css;
          ctx.globalAlpha = isB ? 0.85 : 0.16;
          ctx.fillRect(tx * tilePx, tz * tilePx, tilePx * 2.1, tilePx * 2.1);
          ctx.globalAlpha = 1;
        }
        if (f === 1) {
          ctx.fillStyle = 'rgba(10, 14, 20, 0.42)';
          ctx.fillRect(tx * tilePx, tz * tilePx, tilePx * 2.1, tilePx * 2.1);
        }
      }
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
        ctx.fillStyle =
          tpl.resourceType === 'wood'
            ? '#234c28'
            : tpl.resourceType === 'food'
              ? '#e11d48'
              : tpl.resourceType === 'stone'
                ? '#d6d3d1'
                : '#f59e0b';
        ctx.fillRect(mx - 1, mz - 1, 2, 2);
      } else if (tpl.kind === 'building') {
        ctx.fillStyle = e.owner === 1 ? '#60a5fa' : '#f87171';
        const bs = tpl.isCivicCenter || tpl.isFortress ? 6 : 4;
        ctx.fillRect(mx - bs * 0.5, mz - bs * 0.5, bs, bs);
        ctx.strokeStyle = '#0f172a';
        ctx.lineWidth = 0.8;
        ctx.strokeRect(mx - bs * 0.5, mz - bs * 0.5, bs, bs);
      } else {
        ctx.fillStyle = e.owner === 1 ? '#93c5fd' : '#fca5a5';
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
