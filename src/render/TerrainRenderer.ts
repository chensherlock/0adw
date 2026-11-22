import * as THREE from 'three';
import { RUIN_TEXTURES, TERRAIN_TEXTURES } from '../config/assets';
import { TerrainMap, WATER_LEVEL } from '../sim/map/TerrainMap';
import { SeededRNG } from '../sim/rng';
import { World } from '../sim/World';
import { extractTerritoryContours, TerritoryLoop } from './TerritoryBorderBuilder';

function loadTiledTexture(loader: THREE.TextureLoader, url: string, isSRGB: boolean, repeat = 1): THREE.Texture {
  const tex = loader.load(url);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(repeat, repeat);
  tex.colorSpace = isSRGB ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  tex.anisotropy = 4;
  return tex;
}

function createGroundDetailTextures(): { map: THREE.CanvasTexture; bumpMap: THREE.CanvasTexture } {
  const size = 512;
  const colorCanvas = document.createElement('canvas');
  colorCanvas.width = size;
  colorCanvas.height = size;
  const ctx = colorCanvas.getContext('2d')!;

  const bumpCanvas = document.createElement('canvas');
  bumpCanvas.width = size;
  bumpCanvas.height = size;
  const bctx = bumpCanvas.getContext('2d')!;

  const rng = new SeededRNG(90210);

  // Neutral-bright base so vertex colors drive biome hues cleanly
  ctx.fillStyle = '#e8eae0';
  ctx.fillRect(0, 0, size, size);
  bctx.fillStyle = '#808080';
  bctx.fillRect(0, 0, size, size);

  // Soft organic mottling patches (clover, dry soil, dappled shade)
  for (let i = 0; i < 420; i++) {
    const x = rng.range(0, size);
    const y = rng.range(0, size);
    const r = rng.range(8, 34);
    const bright = rng.next() > 0.5;
    ctx.fillStyle = bright ? 'rgba(255, 255, 240, 0.08)' : 'rgba(65, 78, 42, 0.09)';
    // Tile-wrap across edges for seamless repeating
    for (const ox of [-size, 0, size]) {
      for (const oy of [-size, 0, size]) {
        if (x + ox + r < 0 || x + ox - r > size || y + oy + r < 0 || y + oy - r > size) continue;
        ctx.beginPath();
        ctx.arc(x + ox, y + oy, r, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    bctx.fillStyle = bright ? 'rgba(210, 210, 210, 0.12)' : 'rgba(55, 55, 55, 0.12)';
    bctx.beginPath();
    bctx.arc(x, y, r * 0.7, 0, Math.PI * 2);
    bctx.fill();
  }

  // Crisp grass-blade strokes & soil grain
  for (let i = 0; i < 4800; i++) {
    const x = rng.range(0, size);
    const y = rng.range(0, size);
    const len = rng.range(3, 9);
    const ang = rng.range(-0.6, 0.6) - Math.PI * 0.5;
    const dx = Math.cos(ang) * len;
    const dy = Math.sin(ang) * len;
    const shade = rng.next();

    ctx.strokeStyle =
      shade < 0.38
        ? 'rgba(72, 98, 44, 0.24)'
        : shade < 0.74
          ? 'rgba(182, 198, 128, 0.22)'
          : 'rgba(138, 122, 78, 0.2)';
    ctx.lineWidth = rng.range(0.8, 1.8);
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + dx, y + dy);
    ctx.stroke();

    bctx.strokeStyle = shade < 0.5 ? 'rgba(240,240,240,0.28)' : 'rgba(35,35,35,0.22)';
    bctx.lineWidth = 1.2;
    bctx.beginPath();
    bctx.moveTo(x, y);
    bctx.lineTo(x + dx, y + dy);
    bctx.stroke();
  }

  // Tiny soil specks & sunlit pebbles
  for (let i = 0; i < 1200; i++) {
    const x = rng.range(0, size);
    const y = rng.range(0, size);
    const r = rng.range(0.7, 2.0);
    ctx.fillStyle = rng.next() < 0.5 ? 'rgba(92, 82, 58, 0.22)' : 'rgba(235, 228, 200, 0.2)';
    ctx.fillRect(x, y, r, r);
  }

  const map = new THREE.CanvasTexture(colorCanvas);
  map.wrapS = THREE.RepeatWrapping;
  map.wrapT = THREE.RepeatWrapping;
  map.repeat.set(44, 44);
  map.colorSpace = THREE.SRGBColorSpace;
  map.anisotropy = 4;

  const bumpMap = new THREE.CanvasTexture(bumpCanvas);
  bumpMap.wrapS = THREE.RepeatWrapping;
  bumpMap.wrapT = THREE.RepeatWrapping;
  bumpMap.repeat.set(44, 44);

  return { map, bumpMap };
}

const CROSS_SECTION_BOTTOM_Y = -14.0;

/** Creates a richly layered geological strata cutaway texture (topsoil -> clay -> sandstone strata -> fractured granite bedrock) */
function createGeologicalStrataTextures(
  mapType: string
): { map: THREE.CanvasTexture; bumpMap: THREE.CanvasTexture } {
  const size = 512;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;

  const bCanvas = document.createElement('canvas');
  bCanvas.width = size;
  bCanvas.height = size;
  const bctx = bCanvas.getContext('2d')!;

  const rng = new SeededRNG(51423);
  const isVolcano = mapType === 'volcano';
  const isDesert = mapType === 'inland_oasis' || mapType === 'mesa';
  const isSnow = mapType === 'alpine_passes' || mapType === 'mountain';

  // Vertical gradient across geological horizons (y=0 is top grass/humus crust, y=512 is deep bedrock)
  const grad = ctx.createLinearGradient(0, 0, 0, size);
  if (isVolcano) {
    grad.addColorStop(0.0, '#3a352f');
    grad.addColorStop(0.07, '#4c382c');
    grad.addColorStop(0.22, '#5a3b2a');
    grad.addColorStop(0.45, '#3d2c28');
    grad.addColorStop(0.72, '#272022');
    grad.addColorStop(1.0, '#161316');
  } else if (isDesert) {
    grad.addColorStop(0.0, '#c89b62');
    grad.addColorStop(0.09, '#b87d48');
    grad.addColorStop(0.26, '#a56338');
    grad.addColorStop(0.5, '#8a5234');
    grad.addColorStop(0.75, '#594238');
    grad.addColorStop(1.0, '#2e2726');
  } else if (isSnow) {
    grad.addColorStop(0.0, '#7c8a86');
    grad.addColorStop(0.08, '#5f5648');
    grad.addColorStop(0.25, '#6b655d');
    grad.addColorStop(0.52, '#52555c');
    grad.addColorStop(0.78, '#383d46');
    grad.addColorStop(1.0, '#20242c');
  } else {
    grad.addColorStop(0.0, '#3f5a2c'); // Turf root edge
    grad.addColorStop(0.05, '#5c3f26'); // Dark organic topsoil
    grad.addColorStop(0.18, '#7a5233'); // Warm brown subsoil & clay
    grad.addColorStop(0.36, '#926f49'); // Ochre sandstone band
    grad.addColorStop(0.54, '#706050'); // Weathered limestone strata
    grad.addColorStop(0.74, '#4d4d52'); // Slate rock shelf
    grad.addColorStop(1.0, '#26282e'); // Deep granite bedrock
  }
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, size, size);

  bctx.fillStyle = '#808080';
  bctx.fillRect(0, 0, size, size);

  // Undulating sedimentary strata bands (seamless horizontal wrap!)
  const bandCount = 22;
  for (let b = 0; b < bandCount; b++) {
    const baseY = 36 + (b / bandCount) * (size - 48);
    const thickness = rng.range(7, 22);
    const freq1 = (Math.floor(rng.range(1, 3)) * Math.PI * 2) / size;
    const freq2 = (Math.floor(rng.range(2, 5)) * Math.PI * 2) / size;
    const amp1 = rng.range(2.5, 8.0);
    const amp2 = rng.range(1.2, 3.8);
    const ph1 = rng.range(0, Math.PI * 2);
    const ph2 = rng.range(0, Math.PI * 2);

    const lighter = rng.next() > 0.45;
    ctx.fillStyle =
      baseY < 140
        ? lighter
          ? 'rgba(176, 128, 78, 0.24)'
          : 'rgba(62, 38, 22, 0.28)'
        : baseY < 330
          ? lighter
            ? isDesert
              ? 'rgba(218, 152, 92, 0.3)'
              : 'rgba(168, 150, 122, 0.25)'
            : 'rgba(48, 42, 38, 0.3)'
          : lighter
            ? 'rgba(98, 102, 114, 0.26)'
            : 'rgba(18, 20, 26, 0.36)';

    ctx.beginPath();
    for (let x = 0; x <= size; x += 8) {
      const yy = baseY + Math.sin(x * freq1 + ph1) * amp1 + Math.cos(x * freq2 + ph2) * amp2;
      if (x === 0) ctx.moveTo(x, yy);
      else ctx.lineTo(x, yy);
    }
    for (let x = size; x >= 0; x -= 8) {
      const yy = baseY + thickness + Math.sin(x * freq1 + ph1) * amp1 + Math.cos(x * freq2 + ph2) * amp2;
      ctx.lineTo(x, yy);
    }
    ctx.closePath();
    ctx.fill();

    // Crisp dark bedding seam line
    ctx.strokeStyle = 'rgba(22, 18, 16, 0.32)';
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    for (let x = 0; x <= size; x += 8) {
      const yy = baseY + Math.sin(x * freq1 + ph1) * amp1 + Math.cos(x * freq2 + ph2) * amp2;
      if (x === 0) ctx.moveTo(x, yy);
      else ctx.lineTo(x, yy);
    }
    ctx.stroke();

    bctx.strokeStyle = lighter ? 'rgba(225,225,225,0.42)' : 'rgba(35,35,35,0.48)';
    bctx.lineWidth = thickness * 0.45;
    bctx.beginPath();
    for (let x = 0; x <= size; x += 8) {
      const yy = baseY + thickness * 0.5 + Math.sin(x * freq1 + ph1) * amp1 + Math.cos(x * freq2 + ph2) * amp2;
      if (x === 0) ctx.moveTo(x, yy);
      else ctx.lineTo(x, yy);
    }
    bctx.stroke();
  }

  // Embedded cobbles, limestone pebbles & granite fractures
  for (let i = 0; i < 320; i++) {
    const x = rng.range(0, size);
    const y = rng.range(24, size - 10);
    const rx = rng.range(3, 14);
    const ry = rng.range(2, 7.5);
    const rot = rng.range(-0.35, 0.35);
    const shade = rng.next();
    ctx.fillStyle =
      y < 145
        ? shade > 0.5
          ? 'rgba(136, 114, 88, 0.38)'
          : 'rgba(54, 40, 28, 0.4)'
        : shade > 0.5
          ? 'rgba(128, 128, 134, 0.32)'
          : 'rgba(28, 30, 36, 0.42)';
    for (const ox of [-size, 0, size]) {
      if (x + ox + rx < 0 || x + ox - rx > size) continue;
      ctx.beginPath();
      ctx.ellipse(x + ox, y, rx, ry, rot, 0, Math.PI * 2);
      ctx.fill();
    }
    bctx.fillStyle = shade > 0.5 ? 'rgba(220,220,220,0.38)' : 'rgba(42,42,42,0.38)';
    bctx.beginPath();
    bctx.ellipse(x, y, rx * 0.85, ry * 0.85, rot, 0, Math.PI * 2);
    bctx.fill();
  }

  // Fine vertical rock joints & rootlets near top edge
  for (let i = 0; i < 95; i++) {
    const x = rng.range(0, size);
    const y0 = rng.range(180, size - 40);
    const len = rng.range(18, 68);
    ctx.strokeStyle = isVolcano && i % 7 === 0 ? 'rgba(245, 110, 30, 0.45)' : 'rgba(14, 15, 18, 0.44)';
    ctx.lineWidth = isVolcano && i % 7 === 0 ? 1.8 : rng.range(0.8, 1.8);
    ctx.beginPath();
    ctx.moveTo(x, y0);
    ctx.lineTo(x + rng.range(-10, 10), y0 + len * 0.5);
    ctx.lineTo(x + rng.range(-14, 14), y0 + len);
    ctx.stroke();

    bctx.strokeStyle = 'rgba(16,16,16,0.55)';
    bctx.lineWidth = 1.6;
    bctx.beginPath();
    bctx.moveTo(x, y0);
    bctx.lineTo(x + rng.range(-10, 10), y0 + len * 0.5);
    bctx.lineTo(x + rng.range(-14, 14), y0 + len);
    bctx.stroke();
  }

  const map = new THREE.CanvasTexture(canvas);
  map.wrapS = THREE.RepeatWrapping;
  map.wrapT = THREE.ClampToEdgeWrapping;
  map.colorSpace = THREE.SRGBColorSpace;
  map.anisotropy = 4;

  const bumpMap = new THREE.CanvasTexture(bCanvas);
  bumpMap.wrapS = THREE.RepeatWrapping;
  bumpMap.wrapT = THREE.ClampToEdgeWrapping;

  return { map, bumpMap };
}

/** Builds a 3D multi-blade grass tuft geometry (4 angled tapered blades per clump) */
function createGrassTuftGeometry(bladeCount = 4, height = 0.52, spread = 0.24): THREE.BufferGeometry {
  const positions: number[] = [];
  const normals: number[] = [];
  const uvs: number[] = [];

  for (let i = 0; i < bladeCount; i++) {
    const angle = (i / bladeCount) * Math.PI * 2 + (i % 2) * 0.35;
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    const px = -sin;
    const pz = cos;

    const baseOffset = spread * 0.35;
    const bx = cos * baseOffset;
    const bz = sin * baseOffset;
    const halfW = 0.065;

    const tipX = cos * (spread * 1.15);
    const tipZ = sin * (spread * 1.15);
    const tipY = height * (0.82 + (i % 3) * 0.14);

    // Triangle 1 (base-left, base-right, tip)
    positions.push(
      bx - px * halfW, 0, bz - pz * halfW,
      bx + px * halfW, 0, bz + pz * halfW,
      tipX, tipY, tipZ
    );
    // Point normal slightly upward + outward for rich sunlit shading
    const nx = cos * 0.35;
    const nz = sin * 0.35;
    normals.push(nx, 0.92, nz, nx, 0.92, nz, nx, 0.98, nz);
    uvs.push(0, 0, 1, 0, 0.5, 1);
  }

  const geom = new THREE.BufferGeometry();
  geom.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geom.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  geom.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  return geom;
}

export class TerrainRenderer {
  readonly group = new THREE.Group();
  readonly terrainMesh: THREE.Mesh;
  readonly waterMesh: THREE.Mesh;

  private readonly territoryBorderGroup = new THREE.Group();
  private readonly territoryBorderMeshes: THREE.Mesh[] = [];
  private readonly fogData: Uint8Array;
  private readonly fogTex: THREE.DataTexture;
  private readonly depthData: Uint8Array;
  private readonly depthTex: THREE.DataTexture;
  private readonly detailMap: THREE.CanvasTexture;
  private readonly detailBump: THREE.CanvasTexture;
  private readonly grassTex: THREE.Texture;
  private readonly grassNormTex: THREE.Texture;
  private readonly dirtTex: THREE.Texture;
  private readonly cliffTex: THREE.Texture;
  private readonly waterNormSeaTex: THREE.Texture;
  private readonly waterNormRippleTex: THREE.Texture;
  private readonly ruinStoneTex: THREE.Texture;
  private readonly ruinStoneNormTex: THREE.Texture;
  private readonly ruinPavingTex: THREE.Texture;
  private readonly ruinPavingNormTex: THREE.Texture;
  private readonly foliageMeshes: THREE.InstancedMesh[] = [];
  private readonly biomeMode: number;
  private crossSectionSides: Array<{
    side: 'north' | 'south' | 'west' | 'east';
    earthGeom: THREE.BufferGeometry;
    waterGeom: THREE.BufferGeometry;
  }> = [];

  private lastTerritoryVersion = -1;
  private lastFogVersion = -1;
  private lastTerrainVersion = -1;
  private revealAll = false;

  private shaderUniforms: {
    uFogTex: { value: THREE.DataTexture };
    uGrassTex: { value: THREE.Texture };
    uDirtTex: { value: THREE.Texture };
    uCliffTex: { value: THREE.Texture };
    uWorldSize: { value: number };
    uRevealAll: { value: number };
    uBiomeMode: { value: number };
  };

  private waterUniforms: {
    uTime: { value: number };
    uDepthTex: { value: THREE.DataTexture };
    uFogTex: { value: THREE.DataTexture };
    uWaterNormSea: { value: THREE.Texture };
    uWaterNormRipple: { value: THREE.Texture };
    uWorldSize: { value: number };
    uRevealAll: { value: number };
    uSkyColor: { value: THREE.Color };
  };

  private foliageUniforms: {
    uTime: { value: number };
    uFogTex: { value: THREE.DataTexture };
    uWorldSize: { value: number };
    uRevealAll: { value: number };
  };

  private borderSharedUniforms: {
    uFogTex: { value: THREE.DataTexture };
    uWorldSize: { value: number };
    uRevealAll: { value: number };
  };

  constructor(terrain: TerrainMap) {
    const w = terrain.width;
    const h = terrain.height;

    this.fogData = new Uint8Array(w * h * 4);
    this.fogData.fill(255);
    this.fogTex = new THREE.DataTexture(this.fogData, w, h, THREE.RGBAFormat);
    this.fogTex.magFilter = THREE.LinearFilter;
    this.fogTex.minFilter = THREE.LinearFilter;
    this.fogTex.needsUpdate = true;

    const detail = createGroundDetailTextures();
    this.detailMap = detail.map;
    this.detailBump = detail.bumpMap;

    const texLoader = new THREE.TextureLoader();
    this.grassTex = loadTiledTexture(texLoader, TERRAIN_TEXTURES.grass, true);
    this.grassNormTex = loadTiledTexture(texLoader, TERRAIN_TEXTURES.grassNorm, false, 36);
    this.dirtTex = loadTiledTexture(texLoader, TERRAIN_TEXTURES.dirt, true);
    this.cliffTex = loadTiledTexture(texLoader, TERRAIN_TEXTURES.cliff, true);
    this.waterNormSeaTex = loadTiledTexture(texLoader, TERRAIN_TEXTURES.waterNormalSea, false, 1);
    this.waterNormRippleTex = loadTiledTexture(texLoader, TERRAIN_TEXTURES.waterNormalRipple, false, 1);
    this.ruinStoneTex = loadTiledTexture(texLoader, RUIN_TEXTURES.stone, true, 1.5);
    this.ruinStoneNormTex = loadTiledTexture(texLoader, RUIN_TEXTURES.stoneNorm, false, 1.5);
    this.ruinPavingTex = loadTiledTexture(texLoader, RUIN_TEXTURES.paving, true, 2.0);
    this.ruinPavingNormTex = loadTiledTexture(texLoader, RUIN_TEXTURES.pavingNorm, false, 2.0);

    // Water depth texture (re-uploaded live whenever workers dig moats or raise land!)
    this.depthData = new Uint8Array(w * h * 4);
    this.depthTex = new THREE.DataTexture(this.depthData, w, h, THREE.RGBAFormat);
    this.depthTex.magFilter = THREE.LinearFilter;
    this.depthTex.minFilter = THREE.LinearFilter;

    const mt = terrain.resolvedMapType;
    this.biomeMode =
      mt === 'inland_oasis' || mt === 'mesa'
        ? 1
        : mt === 'alpine_passes' || mt === 'mountain'
          ? 2
          : 0;
    const biomeMode = this.biomeMode;

    this.shaderUniforms = {
      uFogTex: { value: this.fogTex },
      uGrassTex: { value: this.grassTex },
      uDirtTex: { value: this.dirtTex },
      uCliffTex: { value: this.cliffTex },
      uWorldSize: { value: terrain.worldSize },
      uRevealAll: { value: 0 },
      uBiomeMode: { value: biomeMode },
    };

    this.foliageUniforms = {
      uTime: { value: 0 },
      uFogTex: { value: this.fogTex },
      uWorldSize: { value: terrain.worldSize },
      uRevealAll: { value: 0 },
    };

    this.borderSharedUniforms = {
      uFogTex: { value: this.fogTex },
      uWorldSize: { value: terrain.worldSize },
      uRevealAll: { value: 0 },
    };

    // Build terrain BufferGeometry
    const geom = new THREE.PlaneGeometry(terrain.worldSize, terrain.worldSize, w, h);
    geom.rotateX(-Math.PI / 2);
    geom.translate(terrain.worldSize * 0.5, 0, terrain.worldSize * 0.5);

    const pos = geom.attributes.position as THREE.BufferAttribute;
    const colors = new Float32Array(pos.count * 3);
    geom.setAttribute('color', new THREE.BufferAttribute(colors, 3));

    const mat = new THREE.MeshStandardMaterial({
      vertexColors: true,
      map: this.detailMap,
      normalMap: this.grassNormTex,
      normalScale: new THREE.Vector2(0.72, 0.72),
      roughness: 0.91,
      metalness: 0.02,
    });

    mat.onBeforeCompile = (shader) => {
      shader.uniforms.uFogTex = this.shaderUniforms.uFogTex;
      shader.uniforms.uGrassTex = this.shaderUniforms.uGrassTex;
      shader.uniforms.uDirtTex = this.shaderUniforms.uDirtTex;
      shader.uniforms.uCliffTex = this.shaderUniforms.uCliffTex;
      shader.uniforms.uWorldSize = this.shaderUniforms.uWorldSize;
      shader.uniforms.uRevealAll = this.shaderUniforms.uRevealAll;
      shader.uniforms.uBiomeMode = this.shaderUniforms.uBiomeMode;

      shader.vertexShader = shader.vertexShader
        .replace(
          '#include <common>',
          `#include <common>
          uniform float uWorldSize;
          varying vec2 vWorldMapUv;
          varying vec3 vTerrainWorldPos;
          varying vec3 vTerrainWorldNorm;`
        )
        .replace(
          '#include <begin_vertex>',
          `#include <begin_vertex>
          vWorldMapUv = vec2(position.x / uWorldSize, position.z / uWorldSize);
          vTerrainWorldPos = position;
          vTerrainWorldNorm = normalize(normal);`
        );

      shader.fragmentShader = shader.fragmentShader
        .replace(
          '#include <common>',
          `#include <common>
          uniform sampler2D uFogTex;
          uniform sampler2D uGrassTex;
          uniform sampler2D uDirtTex;
          uniform sampler2D uCliffTex;
          uniform float uWorldSize;
          uniform float uRevealAll;
          uniform float uBiomeMode;
          varying vec2 vWorldMapUv;
          varying vec3 vTerrainWorldPos;
          varying vec3 vTerrainWorldNorm;`
        )
        .replace(
          '#include <color_fragment>',
          `#include <color_fragment>
          {
            vec2 tileUv = vTerrainWorldPos.xz * 0.14;
            vec3 grassCol = texture2D(uGrassTex, tileUv).rgb;
            vec3 dirtCol = texture2D(uDirtTex, tileUv * 0.85).rgb;
            vec3 cliffCol = texture2D(uCliffTex, tileUv * 0.65).rgb;

            float slopeFactor = smoothstep(0.10, 0.34, 1.0 - vTerrainWorldNorm.y);
            float dryFactor = smoothstep(2.8, 7.6, vTerrainWorldPos.y);
            float beachMask = smoothstep(-0.2, 0.9, vTerrainWorldPos.y);

            if (uBiomeMode > 1.5) {
              // Alpine Snow biome: snow-covered upper slopes + crisp rocky ridges
              float snowMask = 1.0 - smoothstep(2.4, 5.2, vTerrainWorldPos.y);
              vec3 zeroAdTex = mix(grassCol, cliffCol, slopeFactor);
              float splatStrength = beachMask * snowMask * 0.68;
              vec3 tint = mix(vec3(1.0), vColor.rgb * 1.35, 0.55);
              diffuseColor.rgb = mix(diffuseColor.rgb, zeroAdTex * tint, splatStrength);
              diffuseColor.rgb = mix(diffuseColor.rgb, cliffCol * vColor.rgb * 1.2, slopeFactor * 0.55);
            } else if (uBiomeMode > 0.5) {
              // Desert Oasis biome: sandy dirt texture + green oasis ring near center
              float oasisDist = length(vTerrainWorldPos.xz - vec2(uWorldSize * 0.5, uWorldSize * 0.5));
              float oasisGreen = 1.0 - smoothstep(uWorldSize * 0.148, uWorldSize * 0.258, oasisDist);
              vec3 baseTex = mix(dirtCol, grassCol, oasisGreen * 0.85);
              baseTex = mix(baseTex, cliffCol, slopeFactor);
              vec3 tint = mix(vec3(1.0), vColor.rgb * 1.48, 0.62);
              diffuseColor.rgb = mix(diffuseColor.rgb, baseTex * tint, beachMask * 0.62);
            } else {
              float snowMask = 1.0 - smoothstep(10.8, 13.5, vTerrainWorldPos.y);
              vec3 zeroAdTex = mix(grassCol, dirtCol, dryFactor * 0.72);
              zeroAdTex = mix(zeroAdTex, cliffCol, slopeFactor);

              // Blend authentic 0 A.D. Mediterranean textures while preserving beach sand, riverbeds & alpine peaks
              float splatStrength = beachMask * snowMask * 0.78;
              vec3 tint = mix(vec3(1.0), vColor.rgb * 1.45, 0.42);
              diffuseColor.rgb = mix(diffuseColor.rgb, zeroAdTex * tint, splatStrength);
            }
          }`
        )
        .replace(
          '#include <dithering_fragment>',
          `
          if (uRevealAll < 0.5) {
            float fogVal = texture2D(uFogTex, vWorldMapUv).r;
            float visMult = mix(0.14, 1.0, smoothstep(0.05, 0.95, fogVal));
            gl_FragColor.rgb *= visMult;
          }
          #include <dithering_fragment>`
        );
    };

    this.terrainMesh = new THREE.Mesh(geom, mat);
    this.terrainMesh.receiveShadow = true;
    this.terrainMesh.name = 'terrain';
    this.buildMapCrossSection(terrain);
    this.syncTerrainGeometry(terrain);
    this.group.add(this.terrainMesh);
    this.group.add(this.territoryBorderGroup);

    // Populate lush 3D grass tufts, wildflowers, lakeside reeds & ground rocks
    this.buildGroundFoliage(terrain);
    // Populate ancient Mediterranean cultural landmarks (ruined columns, obelisks, ford waystones)
    this.buildCulturalLandmarks(terrain);

    // Realistic 0 A.D. Ocean Water Shader (Official dual normal-map layers, Beer-Lambert absorption, Schlick Fresnel & organic shore lapping)
    const waterSkyHex =
      terrain.resolvedMapType === 'volcano'
        ? 0xd97736
        : terrain.resolvedMapType === 'swamp'
          ? 0x7b9987
          : terrain.resolvedMapType === 'inland_oasis' || terrain.resolvedMapType === 'mesa'
            ? 0xdec8a0
            : terrain.resolvedMapType === 'alpine_passes'
              ? 0xc6daec
              : 0x93c5e6;

    const waterStyle =
      terrain.resolvedMapType === 'volcano' ? 2 : terrain.resolvedMapType === 'swamp' ? 1 : 0;

    this.waterUniforms = {
      uTime: { value: 0 },
      uDepthTex: { value: this.depthTex },
      uFogTex: { value: this.fogTex },
      uWaterNormSea: { value: this.waterNormSeaTex },
      uWaterNormRipple: { value: this.waterNormRippleTex },
      uWorldSize: { value: terrain.worldSize },
      uRevealAll: { value: 0 },
      uSkyColor: { value: new THREE.Color(waterSkyHex) },
    };

    // Clip ocean/water strictly to map bounds so the underground geological cross-section is cleanly visible outside the map!
    const waterGeom = new THREE.PlaneGeometry(terrain.worldSize, terrain.worldSize, 96, 96);
    waterGeom.rotateX(-Math.PI / 2);
    waterGeom.translate(terrain.worldSize * 0.5, WATER_LEVEL, terrain.worldSize * 0.5);

    const waterMat = new THREE.ShaderMaterial({
      uniforms: {
        ...this.waterUniforms,
        uWaterStyle: { value: waterStyle },
      },
      transparent: true,
      depthWrite: false,
      vertexShader: `
        uniform float uTime;
        uniform sampler2D uDepthTex;
        uniform float uWorldSize;
        varying vec3 vWorldPos;
        void main() {
          vec4 wp = modelMatrix * vec4(position, 1.0);
          vec2 uv = wp.xz / uWorldSize;
          float depth = 1.0;
          if (uv.x >= 0.0 && uv.x <= 1.0 && uv.y >= 0.0 && uv.y <= 1.0) {
            depth = texture2D(uDepthTex, uv).r;
          }
          float swellAmp = smoothstep(0.06, 0.45, depth) * 0.07;
          float swell =
            sin(wp.x * 0.16 + wp.z * 0.09 + uTime * 1.15) * 0.65 +
            cos(wp.z * 0.21 - wp.x * 0.11 + uTime * 0.9) * 0.35;
          wp.y += swell * swellAmp;
          vWorldPos = wp.xyz;
          gl_Position = projectionMatrix * viewMatrix * wp;
        }
      `,
      fragmentShader: `
        uniform float uTime;
        uniform sampler2D uDepthTex;
        uniform sampler2D uFogTex;
        uniform sampler2D uWaterNormSea;
        uniform sampler2D uWaterNormRipple;
        uniform float uWorldSize;
        uniform float uRevealAll;
        uniform vec3 uSkyColor;
        uniform float uWaterStyle;
        varying vec3 vWorldPos;

        vec3 sampleWaterNormal(vec2 p, float t, out float chopFactor) {
          // 3 scrolling, rotated layers of official 0 A.D. water normal textures (zero repeating grid patterns)
          vec2 uv1 = p * 0.032 + vec2(t * 0.018, t * 0.011);
          mat2 rot63 = mat2(0.454, -0.891, 0.891, 0.454);
          vec2 uv2 = (rot63 * p) * 0.068 + vec2(-t * 0.026, t * 0.019);
          mat2 rot127 = mat2(-0.602, -0.799, 0.799, -0.602);
          vec2 uv3 = (rot127 * p) * 0.145 + vec2(t * 0.034, -t * 0.028);

          vec3 n1 = texture2D(uWaterNormSea, uv1).xyz * 2.0 - 1.0;
          vec3 n2 = texture2D(uWaterNormSea, uv2).xyz * 2.0 - 1.0;
          vec3 n3 = texture2D(uWaterNormRipple, uv3).xyz * 2.0 - 1.0;

          // Combine tangent-space XY perturbations; boost Z for realistic ocean slope steepness
          vec2 xy = n1.xy * 0.48 + n2.xy * 0.36 + n3.xy * 0.26;
          chopFactor = clamp(length(n1.xy + n2.xy) * 0.65, 0.0, 1.0);
          return normalize(vec3(xy.x, 1.85, xy.y));
        }

        void main() {
          vec2 uv = vWorldPos.xz / uWorldSize;
          bool inBounds = uv.x >= 0.0 && uv.x <= 1.0 && uv.y >= 0.0 && uv.y <= 1.0;

          float depth = 1.0;
          float isFord = 0.0;
          if (inBounds) {
            vec4 dSample = texture2D(uDepthTex, uv);
            depth = dSample.r;
            isFord = dSample.g;
          }

          // Smooth shoreline feathering: completely transparent right at dry land edge
          if (depth < 0.004) discard;

          float chop = 0.0;
          vec3 N = sampleWaterNormal(vWorldPos.xz, uTime, chop);
          vec3 V = normalize(cameraPosition - vWorldPos);
          vec3 L = normalize(vec3(0.54, 0.68, 0.46)); // Mediterranean afternoon sun
          vec3 H = normalize(L + V);
          vec3 R = reflect(-V, N);

          // Realistic Mediterranean ocean Beer-Lambert depth absorption (plus Swamp murky marsh & Volcano glowing magma!)
          float absorb = 1.0 - exp(-depth * 4.6);
          vec3 shallowTint = vec3(0.11, 0.35, 0.37);
          vec3 midOcean = vec3(0.035, 0.19, 0.30);
          vec3 deepAbyss = vec3(0.015, 0.085, 0.175);

          if (uWaterStyle > 1.5) {
            // Volcano central magma crater glows fiery orange-red; outer map water stays dark volcanic sea
            float dCenter = length(vWorldPos.xz - vec2(uWorldSize * 0.5));
            if (dCenter < 34.0) {
              float pulse = 0.5 + 0.5 * sin(uTime * 2.2 + vWorldPos.x * 0.45 + vWorldPos.z * 0.38 + chop * 4.0);
              vec3 lavaCol = mix(vec3(0.75, 0.14, 0.02), vec3(1.0, 0.62, 0.12), pulse * 0.72 + depth * 0.25);
              if (inBounds && uRevealAll < 0.5) {
                float fogVal = texture2D(uFogTex, uv).r;
                lavaCol *= mix(0.14, 1.0, smoothstep(0.05, 0.95, fogVal));
              }
              gl_FragColor = vec4(lavaCol, 0.96);
              return;
            }
          } else if (uWaterStyle > 0.5) {
            // Misty wetland Swamp olive-teal marsh water
            shallowTint = vec3(0.18, 0.27, 0.18);
            midOcean = vec3(0.10, 0.18, 0.14);
            deepAbyss = vec3(0.05, 0.10, 0.08);
          }

          vec3 waterBody = mix(shallowTint, midOcean, smoothstep(0.0, 0.55, absorb));
          waterBody = mix(waterBody, deepAbyss, smoothstep(0.45, 1.0, absorb));

          // Subtle translucent green-teal subsurface scatter on sunlit wave crests
          float sss = pow(max(dot(V, -L + N * 0.6), 0.0), 3.0) * smoothstep(0.05, 0.4, depth);
          waterBody += vec3(0.03, 0.14, 0.16) * (sss * 0.55 + chop * 0.18);

          // Physical Schlick Fresnel sky & horizon reflection
          float NdotV = max(dot(N, V), 0.0);
          float fresnel = 0.03 + 0.92 * pow(1.0 - NdotV, 4.4);
          float skyGrad = clamp(R.y * 0.75 + 0.25, 0.0, 1.0);
          vec3 horizonCol = mix(uSkyColor * 0.92, vec3(0.84, 0.90, 0.95), 0.35);
          vec3 zenithCol = mix(uSkyColor * 0.62, vec3(0.28, 0.52, 0.76), 0.55);
          vec3 skyRefl = mix(horizonCol, zenithCol, skyGrad);

          float sunDiff = 0.72 + 0.28 * max(dot(N, L), 0.0);
          vec3 col = mix(waterBody * sunDiff, skyRefl, clamp(fresnel * 0.85, 0.05, 0.84));

          // Dual-lobe crisp sunlit sea glints across actual normal-mapped ripples
          float specSharp = pow(max(dot(N, H), 0.0), 220.0) * 1.35;
          float specGlint = pow(max(dot(N, H), 0.0), 38.0) * 0.22;
          col += vec3(1.0, 0.96, 0.88) * (specSharp + specGlint);

          // Organic, normal-broken gentle shore foam (soft and natural, never solid white bands)
          float shoreBand = smoothstep(0.075, 0.006, depth) * smoothstep(0.002, 0.014, depth);
          float lapWave = 0.5 + 0.5 * sin(depth * 34.0 - uTime * 2.1 + (N.x - N.z) * 5.2);
          float organicFoam = shoreBand * smoothstep(0.32, 0.82, lapWave * 0.7 + chop * 0.55);
          col = mix(col, vec3(0.89, 0.93, 0.95), organicFoam * 0.52);

          // Natural depth-based opacity: seamless wet-sand fade at shore -> rich translucent shallows -> deep ocean
          float shoreFade = smoothstep(0.004, 0.045, depth);
          float deepOpacity = mix(0.42, 0.95, smoothstep(0.02, 0.38, depth));
          float alpha = shoreFade * max(deepOpacity, organicFoam * 0.68);
          if (isFord > 0.2) {
            alpha *= 0.42;
          }

          if (inBounds && uRevealAll < 0.5) {
            float fogVal = texture2D(uFogTex, uv).r;
            float visMult = mix(0.14, 1.0, smoothstep(0.05, 0.95, fogVal));
            col *= visMult;
          }

          gl_FragColor = vec4(col, alpha);
        }
      `,
    });

    this.waterMesh = new THREE.Mesh(waterGeom, waterMat);
    this.group.add(this.waterMesh);
  }

  /** Re-syncs terrain mesh vertex heights, biome/dug-earth vertex colors, normals, and water depth texture */
  private syncTerrainGeometry(terrain: TerrainMap): void {
    const w = terrain.width;
    const h = terrain.height;
    const vw = w + 1;
    const biomeMode = this.biomeMode;

    // 1. Update water depth texture so dug trenches/moats below WATER_LEVEL fill with water live!
    for (let z = 0; z < h; z++) {
      for (let x = 0; x < w; x++) {
        const y = terrain.getVertexHeight(x, z);
        const depth = Math.max(0, WATER_LEVEL - y);
        const normDepth = Math.min(255, Math.round((depth / 5.0) * 255));
        const isFord = terrain.fordMask[z * w + x] === 1 ? 255 : 0;
        const idx = (z * w + x) * 4;
        this.depthData[idx] = normDepth;
        this.depthData[idx + 1] = isFord;
        this.depthData[idx + 2] = 0;
        this.depthData[idx + 3] = 255;
      }
    }
    this.depthTex.needsUpdate = true;

    // 2. Update terrain vertex positions & vertex colors
    const geom = this.terrainMesh.geometry as THREE.BufferGeometry;
    const pos = geom.attributes.position as THREE.BufferAttribute;
    const colAttr = geom.attributes.color as THREE.BufferAttribute;
    const colors = colAttr.array as Float32Array;
    const col = new THREE.Color();

    const mt = terrain.resolvedMapType;
    const isMesa = mt === 'mesa';
    const isSwamp = mt === 'swamp';
    const isRainforest = mt === 'rainforest';
    const isForest = mt === 'forest';
    const isVolcano = mt === 'volcano';
    const isPlateau = mt === 'plateau';

    const cDeepBed = new THREE.Color(isVolcano ? 0x3b1810 : isSwamp ? 0x222c20 : biomeMode === 2 ? 0x16364c : 0x1f495c);
    const cShallowBed = new THREE.Color(isVolcano ? 0x5c2414 : isSwamp ? 0x454f38 : biomeMode === 1 ? 0xd9c282 : biomeMode === 2 ? 0x8ea3b0 : 0xcab683);
    const cSand = new THREE.Color(isVolcano ? 0x4a4542 : isMesa ? 0xd49664 : isSwamp ? 0x5c5c40 : biomeMode === 1 ? 0xe8cb84 : biomeMode === 2 ? 0xbec9d2 : 0xe6cf98);
    const cLushGrass = new THREE.Color(
      isVolcano
        ? 0x494b3c
        : isRainforest
          ? 0x2f7d32
          : isSwamp
            ? 0x415e34
            : isForest
              ? 0x3f6e33
              : isMesa
                ? 0xc47f4d
                : biomeMode === 1
                  ? 0x5c8f3c
                  : biomeMode === 2
                    ? 0x4b6e49
                    : 0x5e833d
    );
    const cMeadow = new THREE.Color(
      isVolcano
        ? 0x544e47
        : isRainforest
          ? 0x428f38
          : isSwamp
            ? 0x556b3a
            : isForest
              ? 0x557d3c
              : isMesa
                ? 0xb8663d
                : isPlateau
                  ? 0x8ea352
                  : biomeMode === 1
                    ? 0xdfb972
                    : biomeMode === 2
                      ? 0x6a8668
                      : 0x7c9748
    );
    const cDryHill = new THREE.Color(
      isVolcano ? 0x47423e : isMesa ? 0xa34d2c : isRainforest ? 0x3a7033 : biomeMode === 1 ? 0xcfa05e : biomeMode === 2 ? 0xdde6ee : 0xa69b56
    );
    const cDirtPatch = new THREE.Color(isVolcano ? 0x3d3835 : isSwamp ? 0x4d4634 : biomeMode === 1 ? 0xc29356 : biomeMode === 2 ? 0x7a7f86 : 0x9e8c63);
    const cDugSoil = new THREE.Color(isVolcano ? 0x3b322c : biomeMode === 1 ? 0xb88446 : biomeMode === 2 ? 0x685a4c : 0x7c5b3b);
    const cWetMud = new THREE.Color(0x453a2a);
    const cFoothillRock = new THREE.Color(isVolcano ? 0x383432 : isMesa ? 0x9c492a : biomeMode === 1 ? 0xab784b : biomeMode === 2 ? 0x6f7782 : 0x837b70);
    const cCliffRock = new THREE.Color(isVolcano ? 0x292524 : isMesa ? 0x7d3721 : biomeMode === 1 ? 0x8f5f3b : biomeMode === 2 ? 0x535c68 : 0x6c6660);
    const cAlpineStone = new THREE.Color(isVolcano ? 0x3d2a24 : isMesa ? 0xb86742 : biomeMode === 1 ? 0xb58d63 : 0xa6a39d);
    const cSnow = new THREE.Color(isVolcano ? 0x573026 : biomeMode === 1 ? 0xd6b078 : 0xf2f6fa);

    for (let i = 0; i < pos.count; i++) {
      const vx = i % vw;
      const vz = Math.floor(i / vw);
      const y = terrain.getVertexHeight(vx, vz);
      pos.setY(i, y);

      const hL = terrain.getVertexHeight(vx - 1, vz);
      const hR = terrain.getVertexHeight(vx + 1, vz);
      const hU = terrain.getVertexHeight(vx, vz - 1);
      const hD = terrain.getVertexHeight(vx, vz + 1);
      const slope = Math.hypot(hR - hL, hD - hU) * 0.5;

      const patch1 = Math.sin(vx * 0.21 + vz * 0.13) * Math.cos(vz * 0.19 - vx * 0.09) * 0.5 + 0.5;
      const patch2 = Math.sin(vx * 0.47 - vz * 0.38) * 0.5 + 0.5;
      const tx = Math.min(w - 1, vx);
      const tz = Math.min(h - 1, vz);
      const isFord = terrain.fordMask[tz * w + tx] === 1;

      if (isFord) {
        col.copy(cSand).lerp(cShallowBed, 0.35);
      } else if (y < WATER_LEVEL - 1.2) {
        col.copy(cDeepBed);
      } else if (y < WATER_LEVEL + 0.05) {
        const t = THREE.MathUtils.clamp((y - (WATER_LEVEL - 1.2)) / 1.25, 0, 1);
        col.copy(cDeepBed).lerp(cShallowBed, t);
      } else if (biomeMode === 1) {
        const distCenter = Math.hypot(vx - w * 0.5, vz - h * 0.5);
        const oScale = w / 128;
        const oasisGreen = THREE.MathUtils.clamp(1 - Math.max(0, distCenter - 21 * oScale) / (14 * oScale), 0, 1);
        if (y < WATER_LEVEL + 0.9) {
          const t = THREE.MathUtils.clamp((y - (WATER_LEVEL + 0.05)) / 0.85, 0, 1);
          col.copy(cSand).lerp(cLushGrass, t * oasisGreen);
        } else if (y < 6.0) {
          const t = THREE.MathUtils.clamp((y - 0.9) / 5.1, 0, 1);
          col.copy(cSand).lerp(cDryHill, t * 0.65 + patch1 * 0.3);
          if (oasisGreen > 0.05) {
            col.lerp(cLushGrass, oasisGreen * 0.72 * (1 - t * 0.6));
          }
        } else {
          const t = THREE.MathUtils.clamp((y - 6.0) / 5.0, 0, 1);
          col.copy(cFoothillRock).lerp(cAlpineStone, t);
        }
      } else if (biomeMode === 2) {
        if (y < WATER_LEVEL + 0.7) {
          const t = THREE.MathUtils.clamp((y - (WATER_LEVEL + 0.05)) / 0.65, 0, 1);
          col.copy(cSand).lerp(cLushGrass, t);
        } else if (y < 3.4) {
          const t = THREE.MathUtils.clamp((y - 0.7) / 2.7, 0, 1);
          col.copy(cLushGrass).lerp(cMeadow, patch1 * 0.55).lerp(cSnow, t * 0.65);
        } else if (y < 7.2) {
          const t = THREE.MathUtils.clamp((y - 3.4) / 3.8, 0, 1);
          col.copy(cDryHill).lerp(cSnow, 0.55 + t * 0.4);
        } else {
          const t = THREE.MathUtils.clamp((y - 7.2) / 3.0, 0, 1);
          col.copy(cAlpineStone).lerp(cSnow, 0.65 + t * 0.35);
        }
      } else if (y < WATER_LEVEL + 0.85) {
        const t = THREE.MathUtils.clamp((y - (WATER_LEVEL + 0.05)) / 0.8, 0, 1);
        col.copy(cSand).lerp(cLushGrass, t * t);
      } else if (y < 4.8) {
        const t = THREE.MathUtils.clamp((y - 0.85) / 3.95, 0, 1);
        col.copy(cLushGrass).lerp(cMeadow, patch1 * 0.72).lerp(cDryHill, t * 0.55);
        if (patch2 > 0.76) {
          col.lerp(cDirtPatch, (patch2 - 0.76) * 1.4);
        }
      } else if (y < 8.5) {
        const t = THREE.MathUtils.clamp((y - 4.8) / 3.7, 0, 1);
        col.copy(cDryHill).lerp(cFoothillRock, t * 0.85);
      } else if (y < 12.2) {
        const t = THREE.MathUtils.clamp((y - 8.5) / 3.7, 0, 1);
        col.copy(cFoothillRock).lerp(cAlpineStone, t);
      } else {
        const t = THREE.MathUtils.clamp((y - 12.2) / 2.2, 0, 1);
        col.copy(cAlpineStone).lerp(cSnow, t * 0.92);
      }

      for (const s of terrain.spawns) {
        const ds = Math.hypot(vx - s.tileX, vz - s.tileZ);
        if (ds < 5.5) {
          col.lerp(cDirtPatch, (1 - ds / 5.5) * 0.55);
        }
      }

      if (slope > 0.6 && y > WATER_LEVEL + 0.3) {
        const rockBlend = THREE.MathUtils.clamp((slope - 0.6) / 1.0, 0, 0.92);
        col.lerp(y > 9.0 ? cAlpineStone : cCliffRock, rockBlend);
      }

      // Freshly dug / mounded earth coloration from worker terraforming
      const dug = terrain.dugMask[i];
      if (dug > 0.02) {
        const targetEarth = y <= WATER_LEVEL + 0.25 ? cWetMud : cDugSoil;
        col.lerp(targetEarth, Math.min(0.88, dug * 0.82));
      }

      colors[i * 3] = col.r;
      colors[i * 3 + 1] = col.g;
      colors[i * 3 + 2] = col.b;
    }

    pos.needsUpdate = true;
    colAttr.needsUpdate = true;
    geom.computeVertexNormals();
    geom.computeBoundingSphere();
    this.syncCrossSectionGeometry(terrain);
    this.lastTerrainVersion = terrain.version;
  }

  /** Builds the 3D underground geological strata cross-section & translucent water cutaways around all 4 map borders */
  private buildMapCrossSection(terrain: TerrainMap): void {
    const strata = createGeologicalStrataTextures(terrain.resolvedMapType);
    const earthMat = new THREE.MeshStandardMaterial({
      map: strata.map,
      bumpMap: strata.bumpMap,
      bumpScale: 0.22,
      roughness: 0.92,
      metalness: 0.04,
      side: THREE.DoubleSide,
    });

    const isSwamp = terrain.resolvedMapType === 'swamp';
    const isVolcano = terrain.resolvedMapType === 'volcano';
    const waterCutMat = new THREE.MeshStandardMaterial({
      color: isVolcano ? 0x164254 : isSwamp ? 0x2a4a3a : 0x126b8c,
      emissive: isVolcano ? 0x061b26 : isSwamp ? 0x0a1c14 : 0x05283a,
      emissiveIntensity: 0.35,
      roughness: 0.18,
      metalness: 0.1,
      transparent: true,
      opacity: 0.72,
      depthWrite: false,
      side: THREE.DoubleSide,
    });

    const makeRibbonGeom = (steps: number, flipWinding: boolean): THREE.BufferGeometry => {
      const vCount = (steps + 1) * 2;
      const positions = new Float32Array(vCount * 3);
      const uvs = new Float32Array(vCount * 2);
      const indices: number[] = [];
      for (let i = 0; i < steps; i++) {
        const t0 = i * 2;
        const b0 = t0 + 1;
        const t1 = (i + 1) * 2;
        const b1 = t1 + 1;
        if (flipWinding) {
          indices.push(t0, b0, t1, t1, b0, b1);
        } else {
          indices.push(t0, t1, b0, t1, b1, b0);
        }
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(positions, 3));
      g.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
      g.setIndex(indices);
      return g;
    };

    const specs: Array<{ side: 'north' | 'south' | 'west' | 'east'; steps: number; flip: boolean }> = [
      { side: 'north', steps: terrain.width, flip: false },
      { side: 'south', steps: terrain.width, flip: true },
      { side: 'west', steps: terrain.height, flip: true },
      { side: 'east', steps: terrain.height, flip: false },
    ];

    this.crossSectionSides = [];
    for (const s of specs) {
      const earthGeom = makeRibbonGeom(s.steps, s.flip);
      const waterGeom = makeRibbonGeom(s.steps, s.flip);

      const earthMesh = new THREE.Mesh(earthGeom, earthMat);
      earthMesh.receiveShadow = true;
      earthMesh.castShadow = false;
      this.group.add(earthMesh);

      const waterCutMesh = new THREE.Mesh(waterGeom, waterCutMat);
      waterCutMesh.renderOrder = 2;
      this.group.add(waterCutMesh);

      this.crossSectionSides.push({ side: s.side, earthGeom, waterGeom });
    }

    // Solid dark bedrock bottom cap so camera angles from below never see hollow geometry
    const bottomGeom = new THREE.PlaneGeometry(terrain.worldSize, terrain.worldSize);
    bottomGeom.rotateX(Math.PI / 2);
    bottomGeom.translate(terrain.worldSize * 0.5, CROSS_SECTION_BOTTOM_Y, terrain.worldSize * 0.5);
    const bottomMat = new THREE.MeshStandardMaterial({
      color: 0x1a1c22,
      roughness: 0.96,
      metalness: 0.04,
      side: THREE.DoubleSide,
    });
    const bottomMesh = new THREE.Mesh(bottomGeom, bottomMat);
    this.group.add(bottomMesh);
  }

  /** Syncs the top contour of the 4 geological strata & water cutaway walls with live terrain vertex heights */
  private syncCrossSectionGeometry(terrain: TerrainMap): void {
    const w = terrain.width;
    const h = terrain.height;
    const ts = terrain.tileSize;
    const ws = terrain.worldSize;

    for (const entry of this.crossSectionSides) {
      const ePos = entry.earthGeom.attributes.position as THREE.BufferAttribute;
      const eUv = entry.earthGeom.attributes.uv as THREE.BufferAttribute;
      const wPos = entry.waterGeom.attributes.position as THREE.BufferAttribute;
      const wUv = entry.waterGeom.attributes.uv as THREE.BufferAttribute;
      const steps = entry.side === 'north' || entry.side === 'south' ? w : h;

      for (let i = 0; i <= steps; i++) {
        let wx = 0;
        let wz = 0;
        let y = 0;
        if (entry.side === 'north') {
          wx = i * ts;
          wz = 0;
          y = terrain.getVertexHeight(i, 0);
        } else if (entry.side === 'south') {
          wx = i * ts;
          wz = ws;
          y = terrain.getVertexHeight(i, h);
        } else if (entry.side === 'west') {
          wx = 0;
          wz = i * ts;
          y = terrain.getVertexHeight(0, i);
        } else {
          wx = ws;
          wz = i * ts;
          y = terrain.getVertexHeight(w, i);
        }

        const u = (i * ts) / 22.0;
        const topIdx = i * 2;
        const botIdx = topIdx + 1;

        // Geological cutaway earth wall: exact surface height down to CROSS_SECTION_BOTTOM_Y
        ePos.setXYZ(topIdx, wx, y, wz);
        ePos.setXYZ(botIdx, wx, CROSS_SECTION_BOTTOM_Y, wz);
        // Align topsoil band right at the surface top (v=1.0 -> topsoil crust, v=0.0 -> deep granite bedrock)
        eUv.setXY(topIdx, u, 1.0);
        eUv.setXY(botIdx, u, 0.0);

        // Translucent water cutaway wall wherever edge seabed lies below WATER_LEVEL
        const waterTop = y < WATER_LEVEL ? WATER_LEVEL : y;
        const waterBot = y < WATER_LEVEL ? y : y;
        wPos.setXYZ(topIdx, wx, waterTop, wz);
        wPos.setXYZ(botIdx, wx, waterBot, wz);
        wUv.setXY(topIdx, u, 1.0);
        wUv.setXY(botIdx, u, 0.0);
      }

      ePos.needsUpdate = true;
      eUv.needsUpdate = true;
      entry.earthGeom.computeVertexNormals();
      entry.earthGeom.computeBoundingSphere();

      wPos.needsUpdate = true;
      wUv.needsUpdate = true;
      entry.waterGeom.computeVertexNormals();
      entry.waterGeom.computeBoundingSphere();
    }
  }

  private createFoliageMaterial(swayStrength: number, doubleSided = true): THREE.MeshStandardMaterial {
    const mat = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      roughness: 0.88,
      metalness: 0.0,
      side: doubleSided ? THREE.DoubleSide : THREE.FrontSide,
    });

    mat.onBeforeCompile = (shader) => {
      shader.uniforms.uTime = this.foliageUniforms.uTime;
      shader.uniforms.uFogTex = this.foliageUniforms.uFogTex;
      shader.uniforms.uWorldSize = this.foliageUniforms.uWorldSize;
      shader.uniforms.uRevealAll = this.foliageUniforms.uRevealAll;
      shader.uniforms.uSway = { value: swayStrength };

      shader.vertexShader = shader.vertexShader
        .replace(
          '#include <common>',
          `#include <common>
          uniform float uTime;
          uniform float uWorldSize;
          uniform float uSway;
          varying vec2 vFoliageMapUv;`
        )
        .replace(
          '#include <begin_vertex>',
          `#include <begin_vertex>
          vec4 instWorld = vec4(transformed, 1.0);
          #ifdef USE_INSTANCING
            instWorld = instanceMatrix * instWorld;
          #endif
          if (uSway > 0.001) {
            float wind = sin(uTime * 2.1 + instWorld.x * 0.32 + instWorld.z * 0.24) * uSway * max(0.0, position.y);
            transformed.x += wind;
            transformed.z += wind * 0.5;
          }
          vFoliageMapUv = vec2(instWorld.x / uWorldSize, instWorld.z / uWorldSize);`
        );

      shader.fragmentShader = shader.fragmentShader
        .replace(
          '#include <common>',
          `#include <common>
          uniform sampler2D uFogTex;
          uniform float uRevealAll;
          varying vec2 vFoliageMapUv;`
        )
        .replace(
          '#include <dithering_fragment>',
          `
          if (uRevealAll < 0.5) {
            float fogVal = texture2D(uFogTex, vFoliageMapUv).r;
            float visMult = mix(0.14, 1.0, smoothstep(0.05, 0.95, fogVal));
            gl_FragColor.rgb *= visMult;
          }
          #include <dithering_fragment>`
        );
    };

    return mat;
  }

  private buildGroundFoliage(terrain: TerrainMap): void {
    const rng = new SeededRNG(terrain.seed ^ 0x5a3c91);
    const dummy = new THREE.Object3D();
    const color = new THREE.Color();

    const grassMatrices: THREE.Matrix4[] = [];
    const grassColors: THREE.Color[] = [];
    const flowerMatrices: THREE.Matrix4[] = [];
    const flowerColors: THREE.Color[] = [];
    const reedMatrices: THREE.Matrix4[] = [];
    const reedColors: THREE.Color[] = [];
    const rockMatrices: THREE.Matrix4[] = [];
    const rockColors: THREE.Color[] = [];

    const grassPalette = [0x4c7c32, 0x5c8b38, 0x6c9842, 0x829f4a, 0x9aa44f, 0x456f2d];
    const flowerPalette = [0xf4c430, 0xe86b4a, 0xd9a7c7, 0xf7e7a1, 0x73994b];
    const reedPalette = [0x467638, 0x5e8842, 0x8c8e45];
    const rockPalette = [0x8b857b, 0xa09b90, 0x726d65];

    const isNearSpawnPad = (wx: number, wz: number): boolean => {
      for (const s of terrain.spawns) {
        const c = terrain.tileToWorldCenter(s.tileX, s.tileZ);
        if (Math.hypot(wx - c.x, wz - c.z) < 7.2) return true;
      }
      return false;
    };

    // 1. Dense Meadow Grass Tufts & Wildflowers across lush valleys & hills
    const isDesert = terrain.resolvedMapType === 'inland_oasis';
    const isAlpine = terrain.resolvedMapType === 'alpine_passes';
    const grassTarget = isDesert ? 2400 : isAlpine ? 2800 : 6200;
    for (let i = 0; i < grassTarget * 2 && grassMatrices.length < grassTarget; i++) {
      const wx = rng.range(8, terrain.worldSize - 8);
      const wz = rng.range(8, terrain.worldSize - 8);
      if (isNearSpawnPad(wx, wz)) continue;

      const y = terrain.getHeightAt(wx, wz);
      const { tx, tz } = terrain.worldToTile(wx, wz);
      const slope = terrain.getTileSlope(tx, tz);
      if (y < WATER_LEVEL + 0.65 || y > (isAlpine ? 3.2 : 6.6) || slope > 0.95) continue;
      if (isDesert && Math.hypot(wx - terrain.worldSize * 0.5, wz - terrain.worldSize * 0.5) > terrain.worldSize * 0.25 && rng.next() < 0.85) continue;

      // Cluster grass naturally using sine patch density
      const density = Math.sin(wx * 0.09) * Math.cos(wz * 0.09) * 0.5 + 0.5;
      if (rng.next() > 0.35 + density * 0.65) continue;

      dummy.position.set(wx, y - 0.03, wz);
      dummy.rotation.set(0, rng.range(0, Math.PI * 2), 0);
      const s = rng.range(0.75, 1.55);
      dummy.scale.set(s, s * rng.range(0.85, 1.35), s);
      dummy.updateMatrix();
      grassMatrices.push(dummy.matrix.clone());

      color.setHex(rng.pick(grassPalette));
      // Drier golden grass higher on hillsides
      if (y > 3.6) color.lerp(new THREE.Color(0xb2a559), 0.38);
      grassColors.push(color.clone());

      // Sprinkle Mediterranean wildflowers & scrub tufts among the grass
      if (flowerMatrices.length < 1200 && rng.next() < 0.19) {
        dummy.position.set(wx + rng.range(-0.4, 0.4), y + 0.14, wz + rng.range(-0.4, 0.4));
        dummy.rotation.set(rng.range(-0.2, 0.2), rng.range(0, Math.PI * 2), rng.range(-0.2, 0.2));
        const fs = rng.range(0.55, 1.15);
        dummy.scale.set(fs, fs * 0.85, fs);
        dummy.updateMatrix();
        flowerMatrices.push(dummy.matrix.clone());
        flowerColors.push(new THREE.Color(rng.pick(flowerPalette)));
      }
    }

    // 2. Lakeside & Riverbank Reeds hugging shorelines (0.02..0.75m elevation)
    for (let i = 0; i < 4200 && reedMatrices.length < 850; i++) {
      const wx = rng.range(10, terrain.worldSize - 10);
      const wz = rng.range(10, terrain.worldSize - 10);
      const y = terrain.getHeightAt(wx, wz);
      if (y < WATER_LEVEL - 0.08 || y > WATER_LEVEL + 0.68) continue;
      const { tx, tz } = terrain.worldToTile(wx, wz);
      if (terrain.fordMask[tz * terrain.width + tx] === 1) continue; // Keep ford crossings unobstructed

      dummy.position.set(wx, y - 0.05, wz);
      dummy.rotation.set(0, rng.range(0, Math.PI * 2), 0);
      const s = rng.range(0.95, 1.75);
      dummy.scale.set(s * 0.8, s * 1.45, s * 0.8);
      dummy.updateMatrix();
      reedMatrices.push(dummy.matrix.clone());
      reedColors.push(new THREE.Color(rng.pick(reedPalette)));
    }

    // 3. Scattered Mediterranean Fieldstones & Foothill Pebbles
    for (let i = 0; i < 3600 && rockMatrices.length < 900; i++) {
      const wx = rng.range(8, terrain.worldSize - 8);
      const wz = rng.range(8, terrain.worldSize - 8);
      if (isNearSpawnPad(wx, wz)) continue;
      const y = terrain.getHeightAt(wx, wz);
      if (y < WATER_LEVEL + 0.15 || y > 11.5) continue;
      const { tx, tz } = terrain.worldToTile(wx, wz);
      const slope = terrain.getTileSlope(tx, tz);
      // Prefer hills, mountain bases, and beaches
      if (y > 1.0 && y < 3.4 && slope < 0.45 && rng.next() < 0.72) continue;

      dummy.position.set(wx, y - 0.04, wz);
      dummy.rotation.set(rng.range(0, 3), rng.range(0, 3), rng.range(0, 3));
      const sx = rng.range(0.22, 0.68);
      const sy = sx * rng.range(0.45, 0.85);
      const sz = sx * rng.range(0.7, 1.25);
      dummy.scale.set(sx, sy, sz);
      dummy.updateMatrix();
      rockMatrices.push(dummy.matrix.clone());
      rockColors.push(new THREE.Color(rng.pick(rockPalette)));
    }

    const addInstanced = (
      geom: THREE.BufferGeometry,
      mat: THREE.Material,
      matrices: THREE.Matrix4[],
      colors: THREE.Color[]
    ) => {
      if (matrices.length === 0) return;
      const mesh = new THREE.InstancedMesh(geom, mat, matrices.length);
      for (let i = 0; i < matrices.length; i++) {
        mesh.setMatrixAt(i, matrices[i]);
        mesh.setColorAt(i, colors[i]);
      }
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      mesh.receiveShadow = true;
      mesh.castShadow = false;
      this.group.add(mesh);
      this.foliageMeshes.push(mesh);
    };

    addInstanced(createGrassTuftGeometry(4, 0.54, 0.25), this.createFoliageMaterial(0.18, true), grassMatrices, grassColors);
    addInstanced(new THREE.DodecahedronGeometry(0.18, 0), this.createFoliageMaterial(0.08, false), flowerMatrices, flowerColors);
    addInstanced(createGrassTuftGeometry(5, 0.85, 0.2), this.createFoliageMaterial(0.24, true), reedMatrices, reedColors);
    addInstanced(new THREE.DodecahedronGeometry(0.35, 0), this.createFoliageMaterial(0.0, false), rockMatrices, rockColors);
  }

  /** Textured weathered-stone PBR material with Fog-of-War shading for ancient ruins & monuments */
  private createRuinMaterial(
    map: THREE.Texture,
    normalMap: THREE.Texture,
    normalStrength = 1.05
  ): THREE.MeshStandardMaterial {
    const mat = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      map,
      normalMap,
      normalScale: new THREE.Vector2(normalStrength, normalStrength),
      roughness: 0.94,
      metalness: 0.03,
    });

    mat.onBeforeCompile = (shader) => {
      shader.uniforms.uFogTex = this.foliageUniforms.uFogTex;
      shader.uniforms.uWorldSize = this.foliageUniforms.uWorldSize;
      shader.uniforms.uRevealAll = this.foliageUniforms.uRevealAll;

      shader.vertexShader = shader.vertexShader
        .replace(
          '#include <common>',
          `#include <common>
          uniform float uWorldSize;
          varying vec2 vRuinMapUv;`
        )
        .replace(
          '#include <begin_vertex>',
          `#include <begin_vertex>
          vec4 instWorld = vec4(transformed, 1.0);
          #ifdef USE_INSTANCING
            instWorld = instanceMatrix * instWorld;
          #endif
          vRuinMapUv = vec2(instWorld.x / uWorldSize, instWorld.z / uWorldSize);`
        );

      shader.fragmentShader = shader.fragmentShader
        .replace(
          '#include <common>',
          `#include <common>
          uniform sampler2D uFogTex;
          uniform float uRevealAll;
          varying vec2 vRuinMapUv;`
        )
        .replace(
          '#include <dithering_fragment>',
          `
          if (uRevealAll < 0.5) {
            float fogVal = texture2D(uFogTex, vRuinMapUv).r;
            float visMult = mix(0.14, 1.0, smoothstep(0.05, 0.95, fogVal));
            gl_FragColor.rgb *= visMult;
          }
          #include <dithering_fragment>`
        );
    };

    return mat;
  }

  /**
   * Populates scenic ancient Mediterranean cultural landmarks (weathered limestone Doric ruins
   * with stepped stylobates, fluted columns, broken architrave lintels, fallen drums & rubble).
   */
  private buildCulturalLandmarks(terrain: TerrainMap): void {
    const rng = new SeededRNG(terrain.seed ^ 0x7b2d19);
    const dummy = new THREE.Object3D();

    const columnMatrices: THREE.Matrix4[] = [];
    const columnColors: THREE.Color[] = [];
    const slabMatrices: THREE.Matrix4[] = [];
    const slabColors: THREE.Color[] = [];
    const masonryMatrices: THREE.Matrix4[] = [];
    const masonryColors: THREE.Color[] = [];
    const obeliskMatrices: THREE.Matrix4[] = [];
    const obeliskColors: THREE.Color[] = [];

    // Aged limestone / mossy marble / desert sandstone tints multiplying real 0 A.D. stone textures
    const marblePalette = [0xd8d1c2, 0xc7bfb0, 0xb7b2a2, 0xc3c6b2];
    const sandstonePalette = [0xd9be90, 0xc4a472, 0xb39162, 0xcfb484];
    const alpinePalette = [0xc2c5c8, 0xaab0b5, 0xb6bbb4, 0xd0d4d6];
    const stonePalette =
      terrain.resolvedMapType === 'inland_oasis'
        ? sandstonePalette
        : terrain.resolvedMapType === 'alpine_passes'
          ? alpinePalette
          : marblePalette;

    // Note: ALL standing stone pillars & obelisks are now spawned as real clickable, harvestable `ancient_ruin_pillar` Stone entities in World.ts!
    // Keep only subtle flat weathered flagstone pads at river fords so zero non-clickable stone pillars exist!
    for (const f of terrain.fords) {
      const c = terrain.tileToWorldCenter(f.tileX, f.tileZ);
      for (let k = 0; k < 2; k++) {
        const ang = k * Math.PI + 0.5;
        const px = c.x + Math.cos(ang) * (f.radius * terrain.tileSize + 2.5);
        const pz = c.z + Math.sin(ang) * (f.radius * terrain.tileSize + 2.5);
        const py = terrain.getHeightAt(px, pz);
        if (py < WATER_LEVEL + 0.45 || py > 6.0) continue;
        dummy.position.set(px, py - 0.05, pz);
        dummy.rotation.set(0, rng.range(0, Math.PI), 0);
        dummy.scale.set(1.1, 0.24, 1.1);
        dummy.updateMatrix();
        slabMatrices.push(dummy.matrix.clone());
        slabColors.push(new THREE.Color(rng.pick(stonePalette)));
      }
    }

    const addInstancedRuin = (
      geom: THREE.BufferGeometry,
      mat: THREE.Material,
      matrices: THREE.Matrix4[],
      colors: THREE.Color[]
    ) => {
      if (matrices.length === 0) return;
      const mesh = new THREE.InstancedMesh(geom, mat, matrices.length);
      for (let i = 0; i < matrices.length; i++) {
        mesh.setMatrixAt(i, matrices[i]);
        mesh.setColorAt(i, colors[i]);
      }
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      mesh.receiveShadow = true;
      mesh.castShadow = true;
      this.group.add(mesh);
      this.foliageMeshes.push(mesh);
    };

    const ruinStoneMat = this.createRuinMaterial(this.ruinStoneTex, this.ruinStoneNormTex, 1.15);
    const ruinPavingMat = this.createRuinMaterial(this.ruinPavingTex, this.ruinPavingNormTex, 1.0);
    // Separate cloned materials so dispose() can safely dispose each mesh's material cleanly
    addInstancedRuin(new THREE.CylinderGeometry(0.42, 0.5, 1.0, 12), ruinStoneMat, columnMatrices, columnColors);
    addInstancedRuin(new THREE.BoxGeometry(1.0, 1.0, 1.0), ruinPavingMat, slabMatrices, slabColors);
    addInstancedRuin(new THREE.BoxGeometry(1.0, 1.0, 1.0), ruinStoneMat.clone(), masonryMatrices, masonryColors);
    addInstancedRuin(new THREE.CylinderGeometry(0.14, 0.44, 1.0, 4), ruinStoneMat.clone(), obeliskMatrices, obeliskColors);
  }

  setRevealAll(reveal: boolean): void {
    this.revealAll = reveal;
    this.shaderUniforms.uRevealAll.value = reveal ? 1 : 0;
    this.waterUniforms.uRevealAll.value = reveal ? 1 : 0;
    this.foliageUniforms.uRevealAll.value = reveal ? 1 : 0;
    this.borderSharedUniforms.uRevealAll.value = reveal ? 1 : 0;
  }

  isRevealAll(): boolean {
    return this.revealAll;
  }

  update(world: World, humanPlayerId: number, elapsedSec: number): void {
    this.waterUniforms.uTime.value = elapsedSec;
    this.foliageUniforms.uTime.value = elapsedSec;
    this.waterMesh.position.y = Math.sin(elapsedSec * 1.2) * 0.025;

    if (this.lastTerrainVersion !== world.terrain.version) {
      this.syncTerrainGeometry(world.terrain);
      this.rebuildTerritoryBorders(world);
    }

    if (this.lastTerritoryVersion !== world.territory.version) {
      this.lastTerritoryVersion = world.territory.version;
      this.rebuildTerritoryBorders(world);
    }

    if (this.lastFogVersion !== world.fog.version) {
      this.lastFogVersion = world.fog.version;
      this.uploadFogTexture(world, humanPlayerId);
    }
  }

  private clearTerritoryBorders(): void {
    for (const mesh of this.territoryBorderMeshes) {
      this.territoryBorderGroup.remove(mesh);
      mesh.geometry.dispose();
      (mesh.material as THREE.Material).dispose();
    }
    this.territoryBorderMeshes.length = 0;
  }

  private createTerritoryBorderMaterial(hexColor: number): THREE.ShaderMaterial {
    const r = ((hexColor >> 16) & 255) / 255;
    const g = ((hexColor >> 8) & 255) / 255;
    const b = (hexColor & 255) / 255;

    return new THREE.ShaderMaterial({
      uniforms: {
        uColor: { value: new THREE.Vector3(r, g, b) },
        uFogTex: this.borderSharedUniforms.uFogTex,
        uWorldSize: this.borderSharedUniforms.uWorldSize,
        uRevealAll: this.borderSharedUniforms.uRevealAll,
        uDashPeriod: { value: 3.0 },
        uDashFill: { value: 1.75 },
      },
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
      vertexShader: `
        uniform float uWorldSize;
        varying vec2 vBorderUv;
        varying vec2 vWorldMapUv;
        void main() {
          vBorderUv = uv;
          vec4 wp = modelMatrix * vec4(position, 1.0);
          vWorldMapUv = wp.xz / uWorldSize;
          gl_Position = projectionMatrix * viewMatrix * wp;
        }
      `,
      fragmentShader: `
        uniform vec3 uColor;
        uniform sampler2D uFogTex;
        uniform float uRevealAll;
        uniform float uDashPeriod;
        uniform float uDashFill;
        varying vec2 vBorderUv;
        varying vec2 vWorldMapUv;

        void main() {
          float cycle = mod(vBorderUv.x, uDashPeriod);
          float dashStart = smoothstep(0.0, 0.12, cycle);
          float dashEnd = 1.0 - smoothstep(uDashFill - 0.12, uDashFill, cycle);
          float dashMask = dashStart * dashEnd;
          if (dashMask < 0.02) discard;

          float edgeDist = abs(vBorderUv.y - 0.5) * 2.0;
          float widthAlpha = 1.0 - smoothstep(0.84, 1.0, edgeDist);

          // Crisp thin dark casing framing each team-colored dash (authentic 0 A.D. border style)
          float coreWidth = 1.0 - smoothstep(0.56, 0.72, edgeDist);
          float coreCap =
            smoothstep(0.10, 0.24, cycle) *
            (1.0 - smoothstep(uDashFill - 0.24, uDashFill - 0.10, cycle));
          float coreMask = coreWidth * coreCap;

          vec3 outlineCol = vec3(0.05, 0.08, 0.12);
          vec3 fillCol = mix(uColor, vec3(1.0), 0.24);
          vec3 col = mix(outlineCol, fillCol, coreMask);
          float alpha = dashMask * widthAlpha * mix(0.68, 0.92, coreMask);

          if (uRevealAll < 0.5) {
            float fogVal = texture2D(uFogTex, vWorldMapUv).r;
            if (fogVal < 0.08) discard;
            float visMult = mix(0.45, 1.0, smoothstep(0.2, 0.95, fogVal));
            col *= visMult;
            alpha *= smoothstep(0.08, 0.35, fogVal);
          }

          gl_FragColor = vec4(col, alpha);
        }
      `,
    });
  }

  private buildBorderRibbonGeometry(loops: TerritoryLoop[], terrain: TerrainMap): THREE.BufferGeometry | null {
    const positions: number[] = [];
    const uvs: number[] = [];
    const indices: number[] = [];

    const halfWidth = 0.24;
    const heightLift = 0.16;
    const dashPeriod = 3.0;
    let vertexOffset = 0;

    for (const loop of loops) {
      const pts = loop.points;
      const n = pts.length;
      if (n < 3) continue;

      const dashCount = Math.max(4, Math.round(loop.perimeter / dashPeriod));
      const arcScale = (dashCount * dashPeriod) / Math.max(0.001, loop.perimeter);

      let accumArc = 0;
      for (let i = 0; i <= n; i++) {
        const idx = i % n;
        const p = pts[idx];
        if (i > 0) {
          const prevStep = pts[(i - 1) % n];
          accumArc += Math.hypot(p.x - prevStep.x, p.z - prevStep.z);
        }

        const prev = pts[(idx - 1 + n) % n];
        const next = pts[(idx + 1) % n];
        let tx = next.x - prev.x;
        let tz = next.z - prev.z;
        const tLen = Math.hypot(tx, tz);
        if (tLen > 1e-5) {
          tx /= tLen;
          tz /= tLen;
        } else {
          tx = 1;
          tz = 0;
        }

        const nx = -tz;
        const nz = tx;

        const lx = p.x - nx * halfWidth;
        const lz = p.z - nz * halfWidth;
        const rx = p.x + nx * halfWidth;
        const rz = p.z + nz * halfWidth;

        const cy = terrain.getHeightAt(p.x, p.z);
        const minY = WATER_LEVEL + 0.08;
        const ly = Math.max(minY, Math.max(terrain.getHeightAt(lx, lz), cy - 0.06) + heightLift);
        const ry = Math.max(minY, Math.max(terrain.getHeightAt(rx, rz), cy - 0.06) + heightLift);

        const u = accumArc * arcScale;
        positions.push(lx, ly, lz, rx, ry, rz);
        uvs.push(u, 0, u, 1);

        if (i < n) {
          const a = vertexOffset + i * 2;
          const b = a + 1;
          const c = a + 2;
          const d = a + 3;
          indices.push(a, b, c, b, d, c);
        }
      }

      vertexOffset += (n + 1) * 2;
    }

    if (indices.length === 0) return null;
    const geom = new THREE.BufferGeometry();
    geom.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geom.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    geom.setIndex(indices);
    return geom;
  }

  private rebuildTerritoryBorders(world: World): void {
    this.clearTerritoryBorders();

    const ownerIds = Array.from(world.players.keys());
    const loops = extractTerritoryContours(world.territory, world.terrain, {
      owners: ownerIds.length > 0 ? ownerIds : [1, 2],
      smoothingPasses: 3,
      maxSegmentLength: 1.0,
      minPerimeter: 6.0,
    });

    const byOwner = new Map<number, TerritoryLoop[]>();
    for (const loop of loops) {
      let arr = byOwner.get(loop.owner);
      if (!arr) {
        arr = [];
        byOwner.set(loop.owner, arr);
      }
      arr.push(loop);
    }

    for (const [ownerId, ownerLoops] of byOwner.entries()) {
      const geom = this.buildBorderRibbonGeometry(ownerLoops, world.terrain);
      if (!geom) continue;
      const defaultHex = ownerId === 1 ? 0x3b82f6 : 0xef4444;
      const hexColor = world.players.get(ownerId)?.color ?? defaultHex;
      const mat = this.createTerritoryBorderMaterial(hexColor);
      const mesh = new THREE.Mesh(geom, mat);
      mesh.renderOrder = 2;
      mesh.frustumCulled = false;
      this.territoryBorderGroup.add(mesh);
      this.territoryBorderMeshes.push(mesh);
    }
  }

  private uploadFogTexture(world: World, playerId: number): void {
    const grid = world.fog.getGrid(playerId);
    for (let i = 0; i < grid.length; i++) {
      const v = grid[i];
      const byteVal = v === 2 ? 255 : v === 1 ? 132 : 0;
      const idx = i * 4;
      this.fogData[idx] = byteVal;
      this.fogData[idx + 1] = byteVal;
      this.fogData[idx + 2] = byteVal;
      this.fogData[idx + 3] = 255;
    }
    this.fogTex.needsUpdate = true;
  }

  dispose(): void {
    this.clearTerritoryBorders();
    this.terrainMesh.geometry.dispose();
    (this.terrainMesh.material as THREE.Material).dispose();
    this.waterMesh.geometry.dispose();
    (this.waterMesh.material as THREE.Material).dispose();
    for (const m of this.foliageMeshes) {
      m.geometry.dispose();
      (m.material as THREE.Material).dispose();
    }
    this.detailMap.dispose();
    this.detailBump.dispose();
    this.grassTex.dispose();
    this.grassNormTex.dispose();
    this.dirtTex.dispose();
    this.cliffTex.dispose();
    this.waterNormSeaTex.dispose();
    this.waterNormRippleTex.dispose();
    this.ruinStoneTex.dispose();
    this.ruinStoneNormTex.dispose();
    this.ruinPavingTex.dispose();
    this.ruinPavingNormTex.dispose();
    this.fogTex.dispose();
    this.depthTex.dispose();
  }
}
