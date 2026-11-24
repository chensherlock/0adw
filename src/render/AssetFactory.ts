import * as THREE from 'three';
import { ASSET_BASE, EFFECT_TEXTURES, FIELD_TEXTURES } from '../config/assets';
import { CIVS } from '../config/civs';
import { TEMPLATES } from '../config/entities';
import { CivId } from '../config/types';
import { getZeroADModelSpec, UnitAnimator, zeroADAssets } from './ZeroADAssetLoader';

export interface EntityVisualParts {
  root: THREE.Group;
  bodyGroup: THREE.Group;
  weaponPivot?: THREE.Object3D;
  animator?: UnitAnimator;
  cropGroup?: THREE.Group;
  cropMat?: THREE.MeshStandardMaterial;
  soilMesh?: THREE.Mesh;
  fenceGroup?: THREE.Group;
  foundationPlinth?: THREE.Group;
  wallShearGroup?: THREE.Group;
  wallCornerBastion?: THREE.Object3D;
  gateDoorLeft?: THREE.Object3D;
  gateDoorRight?: THREE.Object3D;
  gateLockBar?: THREE.Object3D;
  beaconTier2?: THREE.Object3D;
  beaconTier3?: THREE.Object3D;
  beaconFireGroup?: THREE.Group;
  beaconSmokeGroup?: THREE.Group;
  beaconLight?: THREE.PointLight;
  beaconCoalMesh?: THREE.Mesh;
  floor2Roof?: THREE.Object3D;
  floor3Group?: THREE.Object3D;
  fishGroup?: THREE.Group;
  rippleMeshes?: THREE.Mesh[];
  oarGroup?: THREE.Group;
  leftWing?: THREE.Object3D;
  rightWing?: THREE.Object3D;
  seaMonsterCoils?: THREE.Object3D[];
  sparkleSprites?: THREE.Sprite[];
  carcassDecal?: THREE.Mesh;
  rankBadge?: THREE.Mesh;
  teamMeshes: THREE.Mesh[];
}

const BESPOKE_MODELS = new Set([
  'gymnasium',
  'stone_wall',
  'stone_gate',
  'beacon_tower',
  'stone_bridge',
  'tunnel_portal',
  'trader',
  'ancient_ruin_pillar',
  'sea_monster',
  'sea_kraken',
  'lake_nessie',
  'merchant_ship',
  'fish_shoal',
  'han_ministry',
  'brit_kennel',
  'gaul_tavern',
  'iber_monument',
  'kush_pyramid',
  'mace_arsenal',
  'maur_pillar',
  'sele_colony',
  'maur_champion',
  'tree_bamboo',
  'tree_hybrid_iron_bamboo',
  'siege_cannon',
]);

const matCache = new Map<string, THREE.MeshStandardMaterial>();
let farmlandDecalMatCache: THREE.MeshStandardMaterial | null = null;
let stoneDecalMatCache: THREE.MeshStandardMaterial | null = null;
let foundationStoneMatCache: THREE.MeshStandardMaterial | null = null;
let wheatCropMatCache: THREE.MeshStandardMaterial | null = null;
let wheatClusterGeomCache: THREE.BufferGeometry | null = null;

interface AquaticMonsterMatSet {
  primary: THREE.MeshStandardMaterial;
  secondary: THREE.MeshStandardMaterial;
  accent: THREE.MeshStandardMaterial;
  eye: THREE.MeshStandardMaterial;
}

const aquaticMonsterMatCache = new Map<string, AquaticMonsterMatSet>();

let realisticFlameTexCache: THREE.CanvasTexture | null = null;
let realisticEmberTexCache: THREE.CanvasTexture | null = null;
let realisticSmokeTexCache: THREE.CanvasTexture | null = null;

/** Procedural soft organic roaring flame tongue sprite texture for realistic Beacon fire */
function getRealisticFlameTexture(): THREE.CanvasTexture {
  if (realisticFlameTexCache) return realisticFlameTexCache;
  const size = 128;
  const c = document.createElement('canvas');
  c.width = size;
  c.height = size;
  const ctx = c.getContext('2d')!;
  ctx.clearRect(0, 0, size, size);

  // Layered flame teardrop with hot white-yellow core, golden body, & wispy orange-red halo
  const drawLobe = (cx: number, cy: number, rx: number, ry: number, alpha: number) => {
    ctx.save();
    ctx.translate(cx, cy);
    ctx.scale(1, ry / rx);
    const g = ctx.createRadialGradient(0, 0, rx * 0.05, 0, 0, rx);
    g.addColorStop(0.0, `rgba(255, 252, 224, ${alpha})`);
    g.addColorStop(0.24, `rgba(255, 214, 72, ${alpha * 0.92})`);
    g.addColorStop(0.55, `rgba(255, 108, 18, ${alpha * 0.66})`);
    g.addColorStop(0.82, `rgba(195, 34, 6, ${alpha * 0.28})`);
    g.addColorStop(1.0, 'rgba(120, 12, 0, 0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(0, 0, rx, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  };

  drawLobe(64, 82, 42, 48, 0.95);
  drawLobe(56, 60, 28, 44, 0.82);
  drawLobe(72, 54, 24, 42, 0.78);
  drawLobe(64, 38, 18, 34, 0.65);

  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.needsUpdate = true;
  realisticFlameTexCache = tex;
  return tex;
}

/** Procedural glowing hot ember spark sprite texture */
function getRealisticEmberTexture(): THREE.CanvasTexture {
  if (realisticEmberTexCache) return realisticEmberTexCache;
  const size = 64;
  const c = document.createElement('canvas');
  c.width = size;
  c.height = size;
  const ctx = c.getContext('2d')!;
  const g = ctx.createRadialGradient(32, 32, 1, 32, 32, 28);
  g.addColorStop(0.0, 'rgba(255, 255, 235, 1.0)');
  g.addColorStop(0.25, 'rgba(255, 195, 70, 0.95)');
  g.addColorStop(0.6, 'rgba(255, 92, 15, 0.45)');
  g.addColorStop(1.0, 'rgba(200, 40, 0, 0.0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.needsUpdate = true;
  realisticEmberTexCache = tex;
  return tex;
}

/** Procedural multi-puff volumetric billowing smoke cloud sprite texture (soft organic edges, zero hard polygons!) */
function getRealisticSmokePuffTexture(): THREE.CanvasTexture {
  if (realisticSmokeTexCache) return realisticSmokeTexCache;
  const size = 128;
  const c = document.createElement('canvas');
  c.width = size;
  c.height = size;
  const ctx = c.getContext('2d')!;
  ctx.clearRect(0, 0, size, size);

  const blobs: Array<[number, number, number, number, number]> = [
    [64, 64, 42, 210, 0.44],
    [48, 56, 30, 228, 0.36],
    [80, 58, 31, 195, 0.34],
    [60, 44, 28, 238, 0.3],
    [54, 78, 29, 175, 0.35],
    [76, 76, 27, 165, 0.32],
    [66, 62, 22, 244, 0.25],
  ];
  for (const [bx, by, br, lum, alpha] of blobs) {
    const g = ctx.createRadialGradient(bx, by, br * 0.08, bx, by, br);
    g.addColorStop(0.0, `rgba(${lum}, ${lum}, ${Math.min(255, lum + 4)}, ${alpha})`);
    g.addColorStop(0.55, `rgba(${Math.max(40, lum - 30)}, ${Math.max(40, lum - 30)}, ${Math.max(44, lum - 26)}, ${alpha * 0.62})`);
    g.addColorStop(1.0, 'rgba(90, 90, 95, 0.0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(bx, by, br, 0, Math.PI * 2);
    ctx.fill();
  }

  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.needsUpdate = true;
  realisticSmokeTexCache = tex;
  return tex;
}

/** Generates rich tiled PBR canvas textures (diffuse + bumpMap) for textured aquatic monsters */
function getAquaticMonsterMaterials(kind: 'dragon' | 'kraken' | 'nessie'): AquaticMonsterMatSet {
  const cached = aquaticMonsterMatCache.get(kind);
  if (cached) return cached;

  const size = 256;
  const colCanvas = document.createElement('canvas');
  colCanvas.width = size;
  colCanvas.height = size;
  const ctx = colCanvas.getContext('2d')!;

  const bumpCanvas = document.createElement('canvas');
  bumpCanvas.width = size;
  bumpCanvas.height = size;
  const bctx = bumpCanvas.getContext('2d')!;

  const secCanvas = document.createElement('canvas');
  secCanvas.width = size;
  secCanvas.height = size;
  const sctx = secCanvas.getContext('2d')!;

  let seed = kind === 'dragon' ? 1337 : kind === 'kraken' ? 4242 : 7789;
  const rand = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 0xffffffff;
  };

  if (kind === 'dragon') {
    // Iridescent emerald-teal overlapping dragon scales + metallic sheen
    const bg = ctx.createLinearGradient(0, 0, size, size);
    bg.addColorStop(0, '#0f4c4c');
    bg.addColorStop(0.5, '#196f63');
    bg.addColorStop(1, '#0c3b46');
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, size, size);
    bctx.fillStyle = '#555555';
    bctx.fillRect(0, 0, size, size);

    const stepX = 22;
    const stepY = 18;
    for (let row = -1; row <= size / stepY + 1; row++) {
      for (let col = -1; col <= size / stepX + 1; col++) {
        const cx = col * stepX + (row % 2 === 0 ? 0 : stepX * 0.5);
        const cy = row * stepY;
        const r = 12.5;
        const g = ctx.createRadialGradient(cx, cy - 3, 1, cx, cy, r);
        const hueShift = rand() > 0.65;
        g.addColorStop(0, hueShift ? '#4fd1a5' : '#2fb696');
        g.addColorStop(0.6, '#14625a');
        g.addColorStop(1, '#082c30');
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(cx, cy, r, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = 'rgba(180, 255, 224, 0.25)';
        ctx.lineWidth = 1.1;
        ctx.stroke();

        const bgRad = bctx.createRadialGradient(cx, cy - 2, 1, cx, cy, r);
        bgRad.addColorStop(0, '#f0f0f0');
        bgRad.addColorStop(0.7, '#999999');
        bgRad.addColorStop(1, '#222222');
        bctx.fillStyle = bgRad;
        bctx.beginPath();
        bctx.arc(cx, cy, r, 0, Math.PI * 2);
        bctx.fill();
      }
    }

    // Ribbed golden-ivory dragon belly plates
    sctx.fillStyle = '#9ecbb4';
    sctx.fillRect(0, 0, size, size);
    for (let y = 0; y < size; y += 20) {
      const sg = sctx.createLinearGradient(0, y, 0, y + 20);
      sg.addColorStop(0, '#e8e0b5');
      sg.addColorStop(0.55, '#a8c8a2');
      sg.addColorStop(1, '#4b6e64');
      sctx.fillStyle = sg;
      sctx.fillRect(0, y, size, 19);
    }
  } else if (kind === 'kraken') {
    // Deep crimson-violet mottled octopus chromatophore skin with organic warts
    const bg = ctx.createLinearGradient(0, 0, size, size);
    bg.addColorStop(0, '#5a1e3c');
    bg.addColorStop(0.5, '#7c2444');
    bg.addColorStop(1, '#431533');
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, size, size);
    bctx.fillStyle = '#787878';
    bctx.fillRect(0, 0, size, size);

    // Mottled cephalopod blotches & iridescent rings
    for (let i = 0; i < 160; i++) {
      const x = rand() * size;
      const y = rand() * size;
      const r = 4 + rand() * 18;
      const tone = rand();
      ctx.fillStyle =
        tone < 0.35
          ? 'rgba(186, 68, 72, 0.38)'
          : tone < 0.7
            ? 'rgba(54, 14, 46, 0.45)'
            : 'rgba(222, 134, 88, 0.32)';
      for (const ox of [-size, 0, size]) {
        for (const oy of [-size, 0, size]) {
          if (x + ox + r < 0 || x + ox - r > size || y + oy + r < 0 || y + oy - r > size) continue;
          ctx.beginPath();
          ctx.arc(x + ox, y + oy, r, 0, Math.PI * 2);
          ctx.fill();
        }
      }
      bctx.fillStyle = tone < 0.5 ? 'rgba(225,225,225,0.34)' : 'rgba(35,35,35,0.3)';
      bctx.beginPath();
      bctx.arc(x, y, r * 0.65, 0, Math.PI * 2);
      bctx.fill();
    }
    // Fine dark chromatophore freckles
    for (let i = 0; i < 520; i++) {
      ctx.fillStyle = rand() > 0.4 ? 'rgba(35, 8, 28, 0.5)' : 'rgba(246, 178, 134, 0.35)';
      ctx.beginPath();
      ctx.arc(rand() * size, rand() * size, 1 + rand() * 2.2, 0, Math.PI * 2);
      ctx.fill();
    }

    // Pale rosy-cream underside with crisp suction cup rings
    sctx.fillStyle = '#dfb1a6';
    sctx.fillRect(0, 0, size, size);
    for (let y = 16; y < size; y += 32) {
      for (let x = 16; x < size; x += 32) {
        sctx.fillStyle = '#f8dfd6';
        sctx.beginPath();
        sctx.arc(x, y, 11, 0, Math.PI * 2);
        sctx.fill();
        sctx.strokeStyle = '#9f525c';
        sctx.lineWidth = 2.5;
        sctx.stroke();
        sctx.fillStyle = '#b96d74';
        sctx.beginPath();
        sctx.arc(x, y, 4.5, 0, Math.PI * 2);
        sctx.fill();
      }
    }
  } else {
    // Loch Ness Plesiosaur: mottled highland mossy-slate, river-olive & silver-blue aquatic skin
    const bg = ctx.createLinearGradient(0, 0, 0, size);
    bg.addColorStop(0, '#2a4647');
    bg.addColorStop(0.5, '#3b5d56');
    bg.addColorStop(1, '#263e42');
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, size, size);
    bctx.fillStyle = '#707070';
    bctx.fillRect(0, 0, size, size);

    // Organic dappled lake-camouflage patches & pebbled reptilian hide
    for (let i = 0; i < 210; i++) {
      const x = rand() * size;
      const y = rand() * size;
      const r = 5 + rand() * 19;
      const tone = rand();
      ctx.fillStyle =
        tone < 0.36
          ? 'rgba(25, 44, 48, 0.42)'
          : tone < 0.72
            ? 'rgba(98, 134, 108, 0.34)'
            : 'rgba(148, 174, 152, 0.25)';
      for (const ox of [-size, 0, size]) {
        for (const oy of [-size, 0, size]) {
          if (x + ox + r < 0 || x + ox - r > size || y + oy + r < 0 || y + oy - r > size) continue;
          ctx.beginPath();
          ctx.ellipse(x + ox, y + oy, r * 1.25, r * 0.78, rand() * Math.PI, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    }
    for (let y = 6; y < size; y += 12) {
      for (let x = 6; x < size; x += 12) {
        const jx = x + (rand() - 0.5) * 4;
        const jy = y + (rand() - 0.5) * 4;
        ctx.strokeStyle = 'rgba(16, 30, 32, 0.26)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.arc(jx, jy, 4.2, 0, Math.PI * 2);
        ctx.stroke();

        bctx.fillStyle = 'rgba(215, 215, 215, 0.38)';
        bctx.beginPath();
        bctx.arc(jx, jy, 3.6, 0, Math.PI * 2);
        bctx.fill();
      }
    }

    // Pale misty-sage river underbelly
    sctx.fillStyle = '#8faea1';
    sctx.fillRect(0, 0, size, size);
    for (let y = 0; y < size; y += 16) {
      sctx.fillStyle = y % 32 === 0 ? 'rgba(210, 228, 214, 0.35)' : 'rgba(54, 78, 72, 0.2)';
      sctx.fillRect(0, y, size, 10);
    }
  }

  const map = new THREE.CanvasTexture(colCanvas);
  map.wrapS = THREE.RepeatWrapping;
  map.wrapT = THREE.RepeatWrapping;
  map.repeat.set(kind === 'dragon' ? 3 : 2, kind === 'dragon' ? 3 : 2);
  map.colorSpace = THREE.SRGBColorSpace;

  const bumpMap = new THREE.CanvasTexture(bumpCanvas);
  bumpMap.wrapS = THREE.RepeatWrapping;
  bumpMap.wrapT = THREE.RepeatWrapping;
  bumpMap.repeat.copy(map.repeat);

  const secMap = new THREE.CanvasTexture(secCanvas);
  secMap.wrapS = THREE.RepeatWrapping;
  secMap.wrapT = THREE.RepeatWrapping;
  secMap.repeat.set(2, 2);
  secMap.colorSpace = THREE.SRGBColorSpace;

  const primary = new THREE.MeshStandardMaterial({
    map,
    bumpMap,
    bumpScale: kind === 'dragon' ? 0.14 : 0.1,
    roughness: kind === 'kraken' ? 0.34 : 0.42,
    metalness: kind === 'dragon' ? 0.22 : 0.08,
  });
  const secondary = new THREE.MeshStandardMaterial({
    map: secMap,
    bumpMap,
    bumpScale: 0.06,
    roughness: 0.48,
    metalness: 0.05,
  });
  const accent = new THREE.MeshStandardMaterial({
    map,
    color: kind === 'dragon' ? 0x2dd4bf : kind === 'kraken' ? 0xc0395c : 0x5c8f7d,
    emissive: kind === 'dragon' ? 0x0b4b45 : kind === 'kraken' ? 0x3b0c22 : 0x102a29,
    emissiveIntensity: 0.32,
    roughness: 0.45,
    side: THREE.DoubleSide,
  });
  const eye = new THREE.MeshStandardMaterial({
    color: kind === 'nessie' ? 0xfde047 : 0xffb703,
    emissive: kind === 'kraken' ? 0xff6b00 : kind === 'nessie' ? 0xd97706 : 0xff8c00,
    emissiveIntensity: 2.1,
    roughness: 0.18,
  });

  const set: AquaticMonsterMatSet = { primary, secondary, accent, eye };
  aquaticMonsterMatCache.set(kind, set);
  return set;
}

function getFoundationStoneMat(): THREE.MeshStandardMaterial {
  if (!foundationStoneMatCache) {
    const map = zeroADAssets.loadTexture(`${ASSET_BASE}/textures/stone_aegean_01.png`, true);
    map.wrapS = THREE.RepeatWrapping;
    map.wrapT = THREE.RepeatWrapping;
    map.repeat.set(2, 1.5);
    const normalMap = zeroADAssets.loadTexture(`${ASSET_BASE}/textures/stone_india_01_norm.png`, false);
    normalMap.wrapS = THREE.RepeatWrapping;
    normalMap.wrapT = THREE.RepeatWrapping;
    normalMap.repeat.set(2, 1.5);
    foundationStoneMatCache = new THREE.MeshStandardMaterial({
      map,
      normalMap,
      normalScale: new THREE.Vector2(1.0, 1.0),
      color: 0xd6cfc0,
      roughness: 0.93,
      metalness: 0.04,
    });
  }
  return foundationStoneMatCache;
}

function getStoneDecalMat(): THREE.MeshStandardMaterial {
  if (!stoneDecalMatCache) {
    const map = zeroADAssets.loadTexture(EFFECT_TEXTURES.decalStone, true);
    map.wrapS = THREE.ClampToEdgeWrapping;
    map.wrapT = THREE.ClampToEdgeWrapping;
    const normalMap = zeroADAssets.loadTexture(EFFECT_TEXTURES.decalStoneNorm, false);
    normalMap.wrapS = THREE.ClampToEdgeWrapping;
    normalMap.wrapT = THREE.ClampToEdgeWrapping;
    stoneDecalMatCache = new THREE.MeshStandardMaterial({
      map,
      normalMap,
      normalScale: new THREE.Vector2(0.8, 0.8),
      transparent: true,
      alphaTest: 0.06,
      roughness: 0.94,
      metalness: 0.03,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
    });
  }
  return stoneDecalMatCache;
}

function getFarmlandDecalMat(): THREE.MeshStandardMaterial {
  if (!farmlandDecalMatCache) {
    const map = zeroADAssets.loadTexture(FIELD_TEXTURES.decalFarmland, true);
    map.wrapS = THREE.ClampToEdgeWrapping;
    map.wrapT = THREE.ClampToEdgeWrapping;
    const normalMap = zeroADAssets.loadTexture(FIELD_TEXTURES.decalFarmlandNorm, false);
    normalMap.wrapS = THREE.ClampToEdgeWrapping;
    normalMap.wrapT = THREE.ClampToEdgeWrapping;
    farmlandDecalMatCache = new THREE.MeshStandardMaterial({
      map,
      normalMap,
      normalScale: new THREE.Vector2(0.85, 0.85),
      transparent: true,
      alphaTest: 0.08,
      roughness: 0.95,
      metalness: 0.02,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
    });
  }
  return farmlandDecalMatCache;
}

function getWheatCropMat(): THREE.MeshStandardMaterial {
  if (!wheatCropMatCache) {
    const map = zeroADAssets.loadTexture(FIELD_TEXTURES.wheatCrop, true);
    map.wrapS = THREE.ClampToEdgeWrapping;
    map.wrapT = THREE.ClampToEdgeWrapping;
    wheatCropMatCache = new THREE.MeshStandardMaterial({
      map,
      alphaTest: 0.3,
      side: THREE.DoubleSide,
      roughness: 0.88,
      metalness: 0.02,
    });
  }
  return wheatCropMatCache;
}

/** 3 intersecting textured wheat-stalk cards (star-tuft) rendered with 0 A.D. farming_wheat_harvest_a.png */
function getWheatClusterGeometry(): THREE.BufferGeometry {
  if (wheatClusterGeomCache) return wheatClusterGeomCache;
  const positions: number[] = [];
  const normals: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];
  const w = 0.48;
  const h = 0.88;
  const planes = 3;

  for (let p = 0; p < planes; p++) {
    const ang = (p / planes) * Math.PI;
    const cx = Math.cos(ang) * w;
    const cz = Math.sin(ang) * w;
    const nx = -Math.sin(ang);
    const nz = Math.cos(ang);
    const base = p * 4;
    // Slightly flared top for lush golden wheat sheaves
    positions.push(
      -cx, 0, -cz,
      cx, 0, cz,
      cx * 1.12, h, cz * 1.12,
      -cx * 1.12, h, -cz * 1.12
    );
    normals.push(
      nx * 0.35, 0.94, nz * 0.35,
      nx * 0.35, 0.94, nz * 0.35,
      nx * 0.35, 0.94, nz * 0.35,
      nx * 0.35, 0.94, nz * 0.35
    );
    uvs.push(0, 0, 1, 0, 1, 1, 0, 1);
    indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }

  const geom = new THREE.BufferGeometry();
  geom.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geom.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  geom.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geom.setIndex(indices);
  wheatClusterGeomCache = geom;
  return geom;
}

function getMat(color: number, roughness = 0.78, metalness = 0.08): THREE.MeshStandardMaterial {
  const key = `${color}_${roughness}_${metalness}`;
  let m = matCache.get(key);
  if (!m) {
    m = new THREE.MeshStandardMaterial({ color, roughness, metalness });
    matCache.set(key, m);
  }
  return m;
}

/** Cached official 0 A.D. PBR textured material with tiled diffuse + optional normal map */
function getTexMat(
  texPath: string,
  normPath: string | null,
  tint = 0xffffff,
  repeatX = 1.5,
  repeatY = 1.5,
  roughness = 0.88,
  metalness = 0.04
): THREE.MeshStandardMaterial {
  const key = `tex_${texPath}_${normPath ?? ''}_${tint}_${repeatX}_${repeatY}_${roughness}_${metalness}`;
  let mat = matCache.get(key);
  if (!mat) {
    const map = zeroADAssets.loadTexture(`${ASSET_BASE}/${texPath}`, true).clone();
    map.wrapS = THREE.RepeatWrapping;
    map.wrapT = THREE.RepeatWrapping;
    map.repeat.set(repeatX, repeatY);
    map.needsUpdate = true;

    let normalMap: THREE.Texture | undefined;
    if (normPath) {
      normalMap = zeroADAssets.loadTexture(`${ASSET_BASE}/${normPath}`, false).clone();
      normalMap.wrapS = THREE.RepeatWrapping;
      normalMap.wrapT = THREE.RepeatWrapping;
      normalMap.repeat.set(repeatX, repeatY);
      normalMap.needsUpdate = true;
    }

    mat = new THREE.MeshStandardMaterial({
      color: tint,
      map,
      normalMap,
      normalScale: normalMap ? new THREE.Vector2(1.05, 1.05) : undefined,
      roughness,
      metalness,
    });
    matCache.set(key, mat);
  }
  return mat;
}

function addBox(
  parent: THREE.Object3D,
  w: number,
  h: number,
  d: number,
  x: number,
  y: number,
  z: number,
  mat: THREE.Material,
  castShadow = true
): THREE.Mesh {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  mesh.position.set(x, y, z);
  mesh.castShadow = castShadow;
  mesh.receiveShadow = true;
  parent.add(mesh);
  return mesh;
}

function addCyl(
  parent: THREE.Object3D,
  rt: number,
  rb: number,
  h: number,
  segs: number,
  x: number,
  y: number,
  z: number,
  mat: THREE.Material,
  castShadow = true
): THREE.Mesh {
  const mesh = new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, h, segs), mat);
  mesh.position.set(x, y, z);
  mesh.castShadow = castShadow;
  mesh.receiveShadow = true;
  parent.add(mesh);
  return mesh;
}

export function createEntityVisual(templateId: string, civId: CivId, teamColor: number): EntityVisualParts {
  const root = new THREE.Group();
  const bodyGroup = new THREE.Group();
  root.add(bodyGroup);

  const civ = CIVS[civId];
  const teamMat = new THREE.MeshStandardMaterial({ color: teamColor, roughness: 0.65, metalness: 0.1 });
  // Official 0 A.D. PBR textured building materials (every structure receives real stone/roof/timber textures!)
  const stoneMat = getTexMat('textures/hele_struct_b.png', 'textures/hele_struct_b_norm.png', civ.stoneColor, 1.4, 1.4, 0.88, 0.04);
  const darkStoneMat = getTexMat('textures/stone_aegean_01.png', 'textures/stone_india_01_norm.png', 0xbcb5a6, 1.8, 1.4, 0.92, 0.05);
  const roofMat = getTexMat('textures/hele_tile_b.png', null, civ.roofColor, 2.2, 2.2, 0.8, 0.05);
  const woodMat = getTexMat('textures/palisade_main.png', null, 0xc7a37a, 1.6, 1.4, 0.9, 0.03);
  const bronzeMat = getMat(0xc49a45, 0.35, 0.68);
  const steelMat = getMat(0xb8c0c8, 0.32, 0.75);
  const skinMat = getMat(0xe2b793, 0.8, 0.02);
  const teamMeshes: THREE.Mesh[] = [];

  const parts: EntityVisualParts = { root, bodyGroup, teamMeshes };

  // Authentic 0 A.D. geology ground decals & particle sparkles (NO primitive geometric blocks/crystals!)
  if (
    templateId === 'stone_quarry' ||
    templateId === 'marble_quarry' ||
    templateId === 'metal_mine' ||
    templateId === 'gold_vein'
  ) {
    const isRich = templateId === 'marble_quarry' || templateId === 'gold_vein';
    const isMetal = templateId === 'metal_mine' || templateId === 'gold_vein';
    const decalSize = isRich ? 5.8 : 5.4;
    const decalGeom = new THREE.PlaneGeometry(decalSize, decalSize);
    decalGeom.rotateX(-Math.PI / 2);
    const decal = new THREE.Mesh(decalGeom, getStoneDecalMat());
    decal.position.y = 0.06;
    decal.receiveShadow = true;
    root.add(decal);

    // Authentic 0 A.D. metalmine/goldmine particle sparkle sprites (art/textures/particles/sparkle_02.png)
    if (isMetal) {
      const sparkleTex = zeroADAssets.loadTexture(EFFECT_TEXTURES.sparkle, true);
      const isGold = templateId === 'gold_vein';
      const sparkleSprites: THREE.Sprite[] = [];
      const offsets: Array<[number, number, number]> = [
        [0.95, 1.35, 0.72],
        [-0.88, 1.15, 0.65],
        [0.45, 1.65, -0.82],
        [-0.55, 1.48, -0.74],
        [0.05, 1.92, 0.12],
      ];
      for (const [sx, sy, sz] of offsets) {
        const sMat = new THREE.SpriteMaterial({
          map: sparkleTex,
          color: isGold ? 0xffe57f : 0xffd28a,
          transparent: true,
          opacity: 0.75,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
        });
        const sprite = new THREE.Sprite(sMat);
        sprite.position.set(sx, sy, sz);
        sprite.scale.setScalar(0.62);
        root.add(sprite);
        sparkleSprites.push(sprite);
      }
      parts.sparkleSprites = sparkleSprites;
    }
  } else if (
    templateId === 'deer_herd' ||
    templateId === 'wild_boar' ||
    templateId === 'wild_gazelle' ||
    templateId === 'wild_elephant' ||
    templateId === 'predator_wolf' ||
    templateId === 'predator_lion' ||
    templateId === 'predator_bear'
  ) {
    const decalGeom = new THREE.CircleGeometry(0.95, 12);
    decalGeom.rotateX(-Math.PI / 2);
    const decal = new THREE.Mesh(
      decalGeom,
      new THREE.MeshBasicMaterial({
        color: 0x7f1d1d,
        transparent: true,
        opacity: 0.62,
        depthWrite: false,
      })
    );
    decal.position.y = 0.06;
    decal.visible = false;
    root.add(decal);
    parts.carcassDecal = decal;
  }

  // Optional golden XP rank star floating above promoted citizen-soldiers
  if (
    templateId.includes('hoplite') ||
    templateId.includes('hastatus') ||
    templateId.includes('archer') ||
    templateId.includes('velite') ||
    templateId.includes('cavalry')
  ) {
    const badge = new THREE.Mesh(
      new THREE.OctahedronGeometry(0.18, 0),
      new THREE.MeshStandardMaterial({ color: 0xfacc15, emissive: 0x92400e, metalness: 0.6, roughness: 0.2 })
    );
    badge.position.set(0, templateId.includes('cavalry') ? 2.65 : 2.2, 0);
    badge.visible = false;
    root.add(badge);
    parts.rankBadge = badge;
  }

  // Recessed sub-surface slope skirt ONLY below ground (y <= -0.06) so buildings on flat terrain show ZERO extra pedestal,
  // while downhill edges on steep hills never appear hollow underneath.
  const tplInfo = TEMPLATES[templateId];
  if (tplInfo && tplInfo.kind === 'building' && !tplInfo.isFarmField && !tplInfo.isDock && !tplInfo.isBridge) {
    const fpW = tplInfo.isGate ? 4.0 : tplInfo.isWall ? 2.1 : Math.max(1.8, (tplInfo.footprintTiles ?? 2) * 1.56);
    const fpD = tplInfo.isGate ? 1.5 : tplInfo.isWall ? 0.96 : fpW;
    const plinth = new THREE.Group();
    const fMat = getFoundationStoneMat();
    const deepWall = new THREE.Mesh(new THREE.BoxGeometry(fpW, 2.4, fpD), fMat);
    deepWall.position.y = -1.26; // Top face sits at y = -0.06 (hidden under ground on flat terrain!)
    deepWall.receiveShadow = true;
    plinth.add(deepWall);
    root.add(plinth);
    parts.foundationPlinth = plinth;
  }

  // Prefer genuine 0 A.D. 3D COLLADA (.dae) models + textures when available (except bespoke custom 3D structures/ships)
  const useZeroAD = !BESPOKE_MODELS.has(templateId);
  const zeroADSpec = useZeroAD ? getZeroADModelSpec(templateId, civId) : null;
  if (zeroADSpec && zeroADAssets.isSpecReady(zeroADSpec)) {
    const built = zeroADAssets.buildSync(zeroADSpec, teamColor);
    bodyGroup.add(built.container);
    parts.weaponPivot = built.weaponPivot;
    parts.animator = built.animator;
    return parts;
  }

  let weaponPivot: THREE.Object3D | undefined;

  switch (templateId) {
    // ======================== RESOURCES ========================
    case 'tree_cypress': {
      addCyl(bodyGroup, 0.16, 0.24, 1.4, 6, 0, 0.7, 0, woodMat);
      const foliageMat = getMat(0x2d5a34, 0.9, 0.0);
      addCyl(bodyGroup, 0.12, 0.78, 3.6, 7, 0, 3.0, 0, foliageMat);
      addCyl(bodyGroup, 0.04, 0.52, 2.0, 7, 0, 4.9, 0, getMat(0x36693d, 0.9, 0));
      break;
    }
    case 'tree_olive':
    case 'tree_oak': {
      addCyl(bodyGroup, 0.22, 0.34, 1.5, 6, 0, 0.75, 0, getMat(0x6d5740, 0.92, 0));
      const leaf1 = new THREE.Mesh(new THREE.DodecahedronGeometry(1.15, 0), getMat(0x6c8549, 0.88, 0));
      leaf1.position.set(0, 2.15, 0);
      leaf1.scale.set(1.2, 0.8, 1.15);
      leaf1.castShadow = true;
      bodyGroup.add(leaf1);
      const leaf2 = new THREE.Mesh(new THREE.DodecahedronGeometry(0.75, 0), getMat(0x7c9656, 0.88, 0));
      leaf2.position.set(0.65, 1.85, 0.35);
      leaf2.castShadow = true;
      bodyGroup.add(leaf2);
      break;
    }
    case 'tree_pine':
    case 'tree_palm': {
      addCyl(bodyGroup, 0.16, 0.24, 2.2, 6, 0, 1.1, 0, woodMat);
      addCyl(bodyGroup, 0.2, 1.05, 2.8, 7, 0, 3.2, 0, getMat(0x3a6e38, 0.9, 0));
      break;
    }
    case 'berry_bush':
    case 'grape_vine': {
      const bushMat = getMat(0x3f7036, 0.9, 0);
      const berryMat = getMat(templateId === 'grape_vine' ? 0x6b21a8 : 0xb82848, 0.5, 0.05);
      const b1 = new THREE.Mesh(new THREE.DodecahedronGeometry(0.78, 0), bushMat);
      b1.position.set(0, 0.55, 0);
      b1.scale.set(1.2, 0.8, 1.2);
      b1.castShadow = true;
      bodyGroup.add(b1);
      for (let i = 0; i < 6; i++) {
        const ang = (i / 6) * Math.PI * 2;
        const berry = new THREE.Mesh(new THREE.SphereGeometry(0.05, 5, 5), berryMat);
        berry.position.set(Math.cos(ang) * 0.52, 0.55 + (i % 2) * 0.16, Math.sin(ang) * 0.52);
        bodyGroup.add(berry);
      }
      break;
    }
    case 'deer_herd':
    case 'wild_boar': {
      const furMat = getMat(templateId === 'wild_boar' ? 0x5c4636 : 0xa67c52, 0.88, 0);
      addBox(bodyGroup, 0.42, 0.4, 0.95, 0, 0.65, 0, furMat);
      addBox(bodyGroup, 0.24, 0.24, 0.34, 0, 0.92, 0.55, furMat);
      break;
    }
    case 'stone_quarry':
    case 'marble_quarry': {
      const rMat = getMat(templateId === 'marble_quarry' ? 0xe7e5e0 : 0xb6b2a6, 0.92, 0.04);
      const rMat2 = getMat(templateId === 'marble_quarry' ? 0xd5d2cb : 0x9b968a, 0.94, 0.04);
      const m1 = new THREE.Mesh(new THREE.DodecahedronGeometry(1.25, 0), rMat);
      m1.position.set(0, 0.75, 0);
      m1.scale.set(1.3, 0.85, 1.1);
      m1.castShadow = true;
      bodyGroup.add(m1);
      const m2 = new THREE.Mesh(new THREE.DodecahedronGeometry(0.85, 0), rMat2);
      m2.position.set(0.95, 0.5, 0.55);
      m2.castShadow = true;
      bodyGroup.add(m2);
      const m3 = new THREE.Mesh(new THREE.DodecahedronGeometry(0.75, 0), rMat);
      m3.position.set(-0.85, 0.45, -0.5);
      m3.castShadow = true;
      bodyGroup.add(m3);
      break;
    }
    case 'metal_mine':
    case 'gold_vein': {
      const rockMat = getMat(0x5d5852, 0.85, 0.12);
      const oreMat = getMat(templateId === 'gold_vein' ? 0xf5c542 : 0xd69638, 0.3, 0.78);
      const m1 = new THREE.Mesh(new THREE.DodecahedronGeometry(1.2, 0), rockMat);
      m1.position.set(0, 0.72, 0);
      m1.scale.set(1.25, 0.9, 1.15);
      m1.castShadow = true;
      bodyGroup.add(m1);
      for (let i = 0; i < 4; i++) {
        const ang = i * 1.6;
        const vein = new THREE.Mesh(new THREE.OctahedronGeometry(0.38, 0), oreMat);
        vein.position.set(Math.cos(ang) * 0.85, 0.65 + (i % 2) * 0.35, Math.sin(ang) * 0.75);
        vein.castShadow = true;
        bodyGroup.add(vein);
      }
      break;
    }

    // ======================== BUILDINGS ========================
    case 'civic_center': {
      // Stepped marble stylobate
      addBox(bodyGroup, 6.8, 0.45, 6.8, 0, 0.22, 0, darkStoneMat);
      addBox(bodyGroup, 6.2, 0.35, 6.2, 0, 0.6, 0, stoneMat);
      // Inner sanctuary hall
      addBox(bodyGroup, 4.1, 2.7, 4.1, 0, 2.1, -0.35, stoneMat);
      // Front & side Doric columns
      for (let i = -2; i <= 2; i++) {
        addCyl(bodyGroup, 0.17, 0.21, 2.6, 8, i * 1.25, 2.05, 2.55, stoneMat);
        if (i === -2 || i === 2) {
          addCyl(bodyGroup, 0.17, 0.21, 2.6, 8, i * 1.25, 2.05, 0.8, stoneMat);
          addCyl(bodyGroup, 0.17, 0.21, 2.6, 8, i * 1.25, 2.05, -0.9, stoneMat);
          addCyl(bodyGroup, 0.17, 0.21, 2.6, 8, i * 1.25, 2.05, -2.4, stoneMat);
        }
      }
      // Roof & pediment
      const roof = new THREE.Mesh(new THREE.ConeGeometry(4.45, 1.85, 4), roofMat);
      roof.position.set(0, 4.35, 0);
      roof.rotation.y = Math.PI * 0.25;
      roof.castShadow = true;
      bodyGroup.add(roof);
      // Team colored banners & roof crest
      const crest = addBox(bodyGroup, 2.4, 0.32, 0.35, 0, 3.55, 2.65, teamMat);
      const bL = addBox(bodyGroup, 0.45, 1.4, 0.12, -2.5, 2.1, 2.85, teamMat);
      const bR = addBox(bodyGroup, 0.45, 1.4, 0.12, 2.5, 2.1, 2.85, teamMat);
      teamMeshes.push(crest, bL, bR);
      // Tall flagpole
      addCyl(bodyGroup, 0.05, 0.06, 2.2, 5, 0, 6.0, 0, woodMat);
      const flag = addBox(bodyGroup, 1.15, 0.65, 0.08, 0.58, 6.75, 0, teamMat);
      teamMeshes.push(flag);
      break;
    }
    case 'house': {
      addBox(bodyGroup, 2.8, 0.25, 2.6, 0, 0.12, 0, darkStoneMat);
      addBox(bodyGroup, 2.5, 1.6, 2.3, 0, 1.05, 0, stoneMat);
      const roof = new THREE.Mesh(new THREE.ConeGeometry(2.05, 1.0, 4), roofMat);
      roof.position.set(0, 2.35, 0);
      roof.rotation.y = Math.PI * 0.25;
      roof.castShadow = true;
      bodyGroup.add(roof);
      addBox(bodyGroup, 0.55, 0.95, 0.1, 0, 0.72, 1.16, woodMat);
      const awning = addBox(bodyGroup, 1.1, 0.18, 0.5, 0, 1.4, 1.32, teamMat);
      teamMeshes.push(awning);
      break;
    }
    case 'storehouse': {
      addBox(bodyGroup, 3.0, 0.2, 2.8, 0, 0.1, 0, darkStoneMat);
      addBox(bodyGroup, 2.6, 1.4, 2.1, 0, 0.9, -0.2, woodMat);
      const roof = addBox(bodyGroup, 2.9, 0.28, 2.4, 0, 1.72, -0.2, roofMat);
      roof.rotation.x = 0.08;
      // Stacked timber logs outside
      addCyl(bodyGroup, 0.18, 0.18, 1.5, 6, -0.5, 0.35, 1.05, getMat(0x5c3c1e)).rotation.z = Math.PI / 2;
      addCyl(bodyGroup, 0.18, 0.18, 1.5, 6, -0.5, 0.62, 1.05, getMat(0x6e4a28)).rotation.z = Math.PI / 2;
      const trim = addBox(bodyGroup, 2.4, 0.25, 0.15, 0, 1.45, 0.92, teamMat);
      teamMeshes.push(trim);
      break;
    }
    case 'farmstead': {
      addBox(bodyGroup, 3.0, 0.2, 2.8, 0, 0.1, 0, darkStoneMat);
      addBox(bodyGroup, 2.4, 1.55, 2.2, -0.1, 0.95, 0, stoneMat);
      const roof = new THREE.Mesh(new THREE.ConeGeometry(1.95, 1.0, 4), getMat(0xb88f46, 0.85, 0));
      roof.position.set(-0.1, 2.2, 0);
      roof.rotation.y = Math.PI * 0.25;
      roof.castShadow = true;
      bodyGroup.add(roof);
      // Hay bales
      addBox(bodyGroup, 0.65, 0.5, 0.65, 1.2, 0.35, 0.7, getMat(0xd4b252, 0.95, 0));
      const banner = addBox(bodyGroup, 0.6, 0.8, 0.1, -0.1, 1.2, 1.15, teamMat);
      teamMeshes.push(banner);
      break;
    }
    case 'field': {
      // 1. Authentic 0 A.D. ploughed Mediterranean farmland decal subdivided so it drapes cleanly on slopes
      const soilGeom = new THREE.PlaneGeometry(5.6, 5.6, 6, 6);
      soilGeom.rotateX(-Math.PI / 2);
      const soil = new THREE.Mesh(soilGeom, getFarmlandDecalMat());
      soil.position.y = 0.06;
      soil.receiveShadow = true;
      bodyGroup.add(soil);
      parts.soilMesh = soil;

      // 2. Dense rows of 0 A.D. wheat sheaves that grow gradually from tender sprouts to golden grain
      const cropGroup = new THREE.Group();
      cropGroup.position.y = 0.04;
      cropGroup.scale.set(1, 0.01, 1);
      cropGroup.visible = false;
      const clusterGeom = getWheatClusterGeometry();
      // Per-field cloned material so each plot transitions independently from sprout green -> ripe gold
      const cropMat = getWheatCropMat().clone();
      cropMat.color.setHex(0x6da83b);
      const rows = 6;
      const cols = 6;
      for (let r = 0; r < rows; r++) {
        const zBase = -1.85 + (r / (rows - 1)) * 3.7;
        for (let c = 0; c < cols; c++) {
          const xBase = -1.85 + (c / (cols - 1)) * 3.7;
          const hHash = Math.sin((r * 13.7 + c * 29.3) * 1.91);
          const ox = hHash * 0.16;
          const oz = Math.cos((r * 19.1 - c * 7.3) * 2.17) * 0.12;
          const tuft = new THREE.Mesh(clusterGeom, cropMat);
          tuft.position.set(xBase + ox, 0, zBase + oz);
          tuft.rotation.y = (r * 0.8 + c * 1.45) % Math.PI;
          const sXZ = 0.88 + (hHash * 0.5 + 0.5) * 0.28;
          const sY = 0.85 + (Math.cos(r * 4.2 + c * 3.1) * 0.5 + 0.5) * 0.34;
          tuft.scale.set(sXZ, sY, sXZ);
          tuft.castShadow = true;
          tuft.receiveShadow = true;
          cropGroup.add(tuft);
        }
      }
      bodyGroup.add(cropGroup);
      parts.cropGroup = cropGroup;
      parts.cropMat = cropMat;

      // 3. Rustic timber corner fence posts & low split rails + small team pennant
      const fenceGroup = new THREE.Group();
      bodyGroup.add(fenceGroup);
      parts.fenceGroup = fenceGroup;
      const fenceWood = getMat(0x6b4a2b, 0.92, 0.02);
      const corners: Array<[number, number]> = [
        [-2.25, -2.25],
        [2.25, -2.25],
        [-2.25, 2.25],
        [2.25, 2.25],
      ];
      for (const [cx, cz] of corners) {
        addCyl(fenceGroup, 0.07, 0.09, 0.72, 6, cx, 0.36, cz, fenceWood);
      }
      // Partial rustic wooden rails along two opposite edges (leaving open entry for farmers)
      addBox(fenceGroup, 1.55, 0.07, 0.06, -1.45, 0.48, -2.25, fenceWood, false);
      addBox(fenceGroup, 1.55, 0.07, 0.06, -1.45, 0.26, -2.25, fenceWood, false);
      addBox(fenceGroup, 0.06, 0.07, 1.55, -2.25, 0.48, -1.45, fenceWood, false);
      addBox(fenceGroup, 0.06, 0.07, 1.55, -2.25, 0.26, -1.45, fenceWood, false);
      addBox(fenceGroup, 1.55, 0.07, 0.06, 1.45, 0.48, 2.25, fenceWood, false);
      addBox(fenceGroup, 0.06, 0.07, 1.55, 2.25, 0.48, 1.45, fenceWood, false);

      // Harvested straw bundle + team pennant on one corner post
      const hay = addCyl(fenceGroup, 0.26, 0.28, 0.56, 7, -1.95, 0.28, -1.85, getMat(0xd6b052, 0.94, 0));
      hay.rotation.z = Math.PI * 0.5;
      addCyl(fenceGroup, 0.04, 0.05, 1.15, 5, 2.25, 0.58, 2.25, fenceWood);
      const pennant = addBox(fenceGroup, 0.48, 0.26, 0.04, 2.48, 1.0, 2.25, teamMat, false);
      teamMeshes.push(pennant);
      break;
    }
    case 'barracks':
    case 'syssition': {
      addBox(bodyGroup, 4.8, 0.35, 4.4, 0, 0.18, 0, darkStoneMat);
      addBox(bodyGroup, 4.3, 2.15, 3.6, 0, 1.4, -0.15, stoneMat);
      // Twin pitched roof wings
      addBox(bodyGroup, 4.6, 0.45, 4.0, 0, 2.65, -0.15, roofMat);
      addBox(bodyGroup, 3.2, 0.55, 2.4, 0, 3.1, -0.15, roofMat);
      // Courtyard doorway & shields
      addBox(bodyGroup, 1.1, 1.45, 0.2, 0, 1.05, 1.65, woodMat);
      const s1 = addCyl(bodyGroup, 0.4, 0.4, 0.12, 10, -1.35, 1.5, 1.72, teamMat);
      s1.rotation.x = Math.PI / 2;
      const s2 = addCyl(bodyGroup, 0.4, 0.4, 0.12, 10, 1.35, 1.5, 1.72, teamMat);
      s2.rotation.x = Math.PI / 2;
      addCyl(bodyGroup, 0.05, 0.05, 1.8, 5, 1.9, 3.8, 1.4, woodMat);
      const flag = addBox(bodyGroup, 0.95, 0.55, 0.08, 2.38, 4.4, 1.4, teamMat);
      teamMeshes.push(s1, s2, flag);
      break;
    }
    case 'defense_tower': {
      // Balanced proud watchtower height (~5.8m total)
      addBox(bodyGroup, 2.45, 0.4, 2.45, 0, 0.2, 0, darkStoneMat);
      addBox(bodyGroup, 1.92, 3.85, 1.92, 0, 2.32, 0, stoneMat);
      addBox(bodyGroup, 2.3, 0.48, 2.3, 0, 4.45, 0, darkStoneMat);
      const roof = new THREE.Mesh(new THREE.ConeGeometry(1.7, 1.15, 4), roofMat);
      roof.position.set(0, 5.26, 0);
      roof.rotation.y = Math.PI * 0.25;
      roof.castShadow = true;
      bodyGroup.add(roof);
      const banner = addBox(bodyGroup, 0.68, 1.35, 0.1, 0, 2.95, 1.0, teamMat);
      teamMeshes.push(banner);
      break;
    }
    case 'outpost': {
      for (const sx of [-0.62, 0.62]) {
        for (const sz of [-0.62, 0.62]) {
          addCyl(bodyGroup, 0.085, 0.105, 2.85, 5, sx, 1.42, sz, woodMat);
        }
      }
      addBox(bodyGroup, 1.6, 0.24, 1.6, 0, 2.82, 0, woodMat);
      addBox(bodyGroup, 1.5, 0.6, 1.5, 0, 3.24, 0, woodMat);
      addCyl(bodyGroup, 0.048, 0.055, 1.35, 5, 0, 4.1, 0, woodMat);
      const flag = addBox(bodyGroup, 0.9, 0.5, 0.07, 0.45, 4.5, 0, teamMat);
      teamMeshes.push(flag);
      break;
    }
    case 'fortress':
    case 'army_camp':
    case 'apadana':
    case 'carth_embassy':
    case 'ptol_library': {
      addBox(bodyGroup, 6.8, 0.55, 6.8, 0, 0.28, 0, darkStoneMat);
      // Main keep walls
      addBox(bodyGroup, 5.4, 3.3, 5.4, 0, 2.2, 0, stoneMat);
      // 4 tall corner towers
      for (const sx of [-2.55, 2.55]) {
        for (const sz of [-2.55, 2.55]) {
          addBox(bodyGroup, 1.65, 4.9, 1.65, sx, 2.95, sz, darkStoneMat);
          const cap = new THREE.Mesh(new THREE.ConeGeometry(1.25, 1.1, 4), roofMat);
          cap.position.set(sx, 5.9, sz);
          cap.rotation.y = Math.PI * 0.25;
          cap.castShadow = true;
          bodyGroup.add(cap);
        }
      }
      // Gate & central keep spire
      addBox(bodyGroup, 1.5, 2.0, 0.3, 0, 1.5, 2.7, woodMat);
      addBox(bodyGroup, 2.6, 1.5, 2.6, 0, 4.4, 0, stoneMat);
      addCyl(bodyGroup, 0.07, 0.08, 2.6, 6, 0, 6.4, 0, woodMat);
      const f1 = addBox(bodyGroup, 1.45, 0.8, 0.1, 0.72, 7.25, 0, teamMat);
      const f2 = addBox(bodyGroup, 1.8, 0.45, 0.15, 0, 3.25, 2.75, teamMat);
      teamMeshes.push(f1, f2);
      break;
    }

    // ======================== UNITS ========================
    case 'female_citizen': {
      // Flowing Mediterranean tunic
      const skirt = addCyl(bodyGroup, 0.22, 0.36, 0.95, 7, 0, 0.48, 0, teamMat);
      teamMeshes.push(skirt);
      addBox(bodyGroup, 0.36, 0.42, 0.26, 0, 1.05, 0, getMat(0xf1ead8, 0.85, 0));
      const head = new THREE.Mesh(new THREE.SphereGeometry(0.2, 7, 6), skinMat);
      head.position.set(0, 1.46, 0);
      head.castShadow = true;
      bodyGroup.add(head);
      // Hair bun
      const hair = new THREE.Mesh(new THREE.SphereGeometry(0.14, 6, 5), getMat(0x3b2a1e, 0.9, 0));
      hair.position.set(0, 1.52, -0.1);
      bodyGroup.add(hair);
      // Basket on arm
      weaponPivot = new THREE.Group();
      weaponPivot.position.set(0.26, 1.05, 0.15);
      addCyl(weaponPivot, 0.18, 0.14, 0.25, 6, 0, -0.1, 0.1, getMat(0xc49c62, 0.9, 0));
      bodyGroup.add(weaponPivot);
      break;
    }

    case 'scout': {
      // Nimble unarmed hooded scout with olive traveler cloak & slender walking staff
      const legs = addCyl(bodyGroup, 0.16, 0.22, 0.65, 6, 0, 0.34, 0, getMat(0x5c4a32, 0.9, 0));
      addBox(bodyGroup, 0.34, 0.56, 0.24, 0, 0.92, 0, getMat(0x6b6a3a, 0.88, 0));
      const cloak = addBox(bodyGroup, 0.42, 0.72, 0.14, 0, 0.94, -0.14, teamMat);
      teamMeshes.push(cloak);
      const head = new THREE.Mesh(new THREE.SphereGeometry(0.18, 7, 6), skinMat);
      head.position.set(0, 1.4, 0);
      bodyGroup.add(head);
      // Walking staff (unarmed)
      weaponPivot = new THREE.Group();
      weaponPivot.position.set(0.24, 0.96, 0.08);
      addCyl(weaponPivot, 0.03, 0.035, 1.45, 5, 0, -0.08, 0.08, getMat(0x6e4f30, 0.9, 0));
      bodyGroup.add(weaponPivot);
      void legs;
      break;
    }

    case 'doctor':
    case 'healer': {
      // Physician in white linen robe, teal healing mantle, & wooden Asclepius staff
      addCyl(bodyGroup, 0.2, 0.34, 1.02, 8, 0, 0.52, 0, getMat(0xf5f0e2, 0.85, 0));
      const mantle = addBox(bodyGroup, 0.4, 0.52, 0.28, 0, 1.06, 0, getMat(0x0f766e, 0.82, 0.05));
      const sash = addBox(bodyGroup, 0.16, 0.64, 0.3, -0.06, 0.96, 0, teamMat);
      teamMeshes.push(sash);
      const head = new THREE.Mesh(new THREE.SphereGeometry(0.19, 7, 6), skinMat);
      head.position.set(0, 1.46, 0);
      bodyGroup.add(head);
      // Healing staff with glowing emerald tip
      weaponPivot = new THREE.Group();
      weaponPivot.position.set(0.28, 1.02, 0.1);
      addCyl(weaponPivot, 0.035, 0.04, 1.5, 6, 0, -0.08, 0.06, getMat(0x785535, 0.9, 0));
      const orb = new THREE.Mesh(
        new THREE.SphereGeometry(0.09, 8, 6),
        new THREE.MeshBasicMaterial({ color: 0x34d399 })
      );
      orb.position.set(0, 0.7, 0.06);
      weaponPivot.add(orb);
      bodyGroup.add(weaponPivot);
      void mantle;
      break;
    }

    case 'athen_hoplite':
    case 'rome_hastatus':
    case 'athen_champion':
    case 'rome_champion':
    case 'athen_marine':
    case 'rome_praetorian':
    case 'spart_perioikos':
    case 'spart_spartiate':
    case 'spart_hero_guard':
    case 'pers_spearman':
    case 'pers_immortal':
    case 'carth_spearman':
    case 'carth_sacred_band':
    case 'carth_mercenary':
    case 'ptol_pikeman':
    case 'ptol_royal_guard':
    case 'ptol_klerouch': {
      const isRome = templateId.startsWith('rome');
      const isChamp =
        templateId.includes('champion') ||
        templateId.includes('praetorian') ||
        templateId.includes('spartiate') ||
        templateId.includes('hero_guard') ||
        templateId.includes('immortal');
      const scale = isChamp ? 1.24 : 1.0;

      // Legs
      addBox(bodyGroup, 0.14, 0.55, 0.14, -0.12, 0.28, 0, skinMat);
      addBox(bodyGroup, 0.14, 0.55, 0.14, 0.12, 0.28, 0, skinMat);
      // Armored torso
      const cuirass = addBox(bodyGroup, 0.46, 0.62, 0.3, 0, 0.84, 0, isChamp ? bronzeMat : teamMat);
      if (!isChamp) teamMeshes.push(cuirass);
      // Cape
      const cape = addBox(bodyGroup, 0.44, 0.72, 0.08, 0, 0.78, -0.2, teamMat);
      teamMeshes.push(cape);
      // Head + Helmet
      const head = new THREE.Mesh(new THREE.SphereGeometry(0.2, 7, 6), skinMat);
      head.position.set(0, 1.36, 0);
      bodyGroup.add(head);
      const helm = new THREE.Mesh(new THREE.SphereGeometry(0.22, 7, 5, 0, Math.PI * 2, 0, Math.PI * 0.62), isRome ? steelMat : bronzeMat);
      helm.position.set(0, 1.4, 0);
      bodyGroup.add(helm);
      // Helmet crest plume
      const crest = addBox(bodyGroup, isChamp ? 0.14 : 0.08, isChamp ? 0.34 : 0.22, 0.42, 0, 1.66, -0.02, teamMat);
      teamMeshes.push(crest);

      // Shield on left arm
      if (isRome) {
        // Rectangular Roman Scutum
        const scutum = addBox(bodyGroup, 0.12, 0.78, 0.52, -0.34, 0.84, 0.16, teamMat);
        teamMeshes.push(scutum);
        addBox(bodyGroup, 0.14, 0.16, 0.16, -0.35, 0.84, 0.16, bronzeMat);
      } else {
        // Round Greek Hoplon
        const hoplon = addCyl(bodyGroup, 0.36, 0.36, 0.09, 10, -0.34, 0.84, 0.14, bronzeMat);
        hoplon.rotation.z = Math.PI / 2;
        const face = addCyl(bodyGroup, 0.27, 0.27, 0.1, 10, -0.35, 0.84, 0.14, teamMat);
        face.rotation.z = Math.PI / 2;
        teamMeshes.push(face);
      }

      // Weapon arm pivot
      weaponPivot = new THREE.Group();
      weaponPivot.position.set(0.32, 0.96, 0.1);
      if (isRome) {
        // Gladius sword
        addBox(weaponPivot, 0.08, 0.72, 0.1, 0, 0.2, 0.25, steelMat).rotation.x = 0.7;
      } else {
        // Long Hoplite Dory spear
        const spear = addCyl(weaponPivot, 0.035, 0.04, 2.25, 5, 0, 0.4, 0.25, woodMat);
        spear.rotation.x = 0.55;
        const tip = new THREE.Mesh(new THREE.ConeGeometry(0.07, 0.28, 4), steelMat);
        tip.position.set(0, 1.35, 0.86);
        tip.rotation.x = 0.55;
        weaponPivot.add(tip);
      }
      bodyGroup.add(weaponPivot);

      bodyGroup.scale.setScalar(scale);
      break;
    }

    case 'athen_archer':
    case 'rome_velite':
    case 'spart_skirmisher':
    case 'pers_archer':
    case 'carth_slinger':
    case 'ptol_archer': {
      addBox(bodyGroup, 0.13, 0.52, 0.13, -0.11, 0.26, 0, skinMat);
      addBox(bodyGroup, 0.13, 0.52, 0.13, 0.11, 0.26, 0, skinMat);
      const tunic = addBox(bodyGroup, 0.4, 0.58, 0.26, 0, 0.8, 0, teamMat);
      teamMeshes.push(tunic);
      const head = new THREE.Mesh(new THREE.SphereGeometry(0.19, 7, 6), skinMat);
      head.position.set(0, 1.3, 0);
      bodyGroup.add(head);
      // Hood / wolf pelt cap
      addBox(bodyGroup, 0.34, 0.18, 0.34, 0, 1.44, -0.02, getMat(0x7c6852, 0.9, 0));
      // Quiver on back
      addCyl(bodyGroup, 0.08, 0.07, 0.52, 6, -0.12, 0.95, -0.18, woodMat);

      weaponPivot = new THREE.Group();
      weaponPivot.position.set(0.24, 0.96, 0.15);
      if (templateId === 'athen_archer') {
        // Curved bow
        const bow = new THREE.Mesh(new THREE.TorusGeometry(0.36, 0.04, 5, 10, Math.PI), woodMat);
        bow.rotation.y = Math.PI / 2;
        bow.rotation.z = -Math.PI / 2;
        bow.position.set(0, 0.05, 0.25);
        weaponPivot.add(bow);
      } else {
        // Javelin
        const jav = addCyl(weaponPivot, 0.03, 0.03, 1.5, 5, 0, 0.2, 0.25, woodMat);
        jav.rotation.x = 1.05;
      }
      bodyGroup.add(weaponPivot);
      break;
    }

    case 'athen_cavalry':
    case 'rome_cavalry':
    case 'spart_cavalry':
    case 'pers_cavalry':
    case 'pers_cataphract':
    case 'carth_cavalry':
    case 'ptol_cavalry': {
      const horseMat = getMat(templateId.startsWith('rome') ? 0x6b4226 : 0x8b5a34, 0.85, 0.02);
      // Horse body & 4 legs
      addBox(bodyGroup, 0.56, 0.54, 1.32, 0, 0.92, 0, horseMat);
      addBox(bodyGroup, 0.14, 0.72, 0.14, -0.19, 0.36, 0.45, horseMat);
      addBox(bodyGroup, 0.14, 0.72, 0.14, 0.19, 0.36, 0.45, horseMat);
      addBox(bodyGroup, 0.14, 0.72, 0.14, -0.19, 0.36, -0.45, horseMat);
      addBox(bodyGroup, 0.14, 0.72, 0.14, 0.19, 0.36, -0.45, horseMat);
      // Horse neck & head
      const neck = addBox(bodyGroup, 0.26, 0.62, 0.32, 0, 1.32, 0.62, horseMat);
      neck.rotation.x = 0.42;
      addBox(bodyGroup, 0.24, 0.26, 0.46, 0, 1.56, 0.86, horseMat);
      // Saddle cloth (team color)
      const saddle = addBox(bodyGroup, 0.62, 0.16, 0.55, 0, 1.18, -0.05, teamMat);
      teamMeshes.push(saddle);

      // Rider
      const torso = addBox(bodyGroup, 0.4, 0.54, 0.28, 0, 1.5, -0.05, teamMat);
      teamMeshes.push(torso);
      const head = new THREE.Mesh(new THREE.SphereGeometry(0.18, 7, 6), skinMat);
      head.position.set(0, 1.94, -0.05);
      bodyGroup.add(head);
      const helm = new THREE.Mesh(new THREE.SphereGeometry(0.2, 7, 5, 0, Math.PI * 2, 0, Math.PI * 0.6), bronzeMat);
      helm.position.set(0, 1.98, -0.05);
      bodyGroup.add(helm);

      weaponPivot = new THREE.Group();
      weaponPivot.position.set(0.32, 1.52, 0.1);
      const lance = addCyl(weaponPivot, 0.035, 0.04, 2.3, 5, 0, 0.15, 0.5, woodMat);
      lance.rotation.x = 1.1;
      bodyGroup.add(weaponPivot);
      break;
    }

    case 'gymnasium': {
      // Authentic Open-Air Greek Palaestra / Gymnasium athletic courtyard with 0 A.D. stone, marble & tile textures!
      const sandMat = getTexMat('terrain/dirt.png', null, 0xe8d09e, 2.0, 2.0, 0.95, 0.0);
      const marbleMat = getTexMat('textures/stonequarry_marble.png', 'textures/stone_india_01_norm.png', 0xf0eadc, 1.6, 1.4, 0.84, 0.04);
      const tileRoofMat = getTexMat('textures/hele_tile_b.png', null, 0xd87a56, 2.4, 1.6, 0.82, 0.04);
      const fireMat = new THREE.MeshStandardMaterial({
        color: 0xff9f1c,
        emissive: 0xff6b00,
        emissiveIntensity: 1.1,
        roughness: 0.4,
      });

      // Raised courtyard stone border & central open sandy wrestling/athletic arena (palaestra)
      addBox(bodyGroup, 5.8, 0.28, 5.8, 0, 0.14, 0, darkStoneMat);
      addBox(bodyGroup, 3.7, 0.12, 3.7, 0, 0.27, 0.25, sandMat);
      // Circular stone ring marking the wrestling pit in the sand
      const pitRing = new THREE.Mesh(new THREE.TorusGeometry(1.15, 0.06, 6, 20), marbleMat);
      pitRing.rotation.x = Math.PI / 2;
      pitRing.position.set(0, 0.34, 0.25);
      bodyGroup.add(pitRing);

      // U-shaped colonnaded stoa wings framing back (-Z), left (-X), and right (+X) sides
      // Back stoa wall & slanted terracotta roof
      addBox(bodyGroup, 5.5, 1.85, 0.32, 0, 1.2, -2.55, marbleMat);
      const backRoof = addBox(bodyGroup, 5.7, 0.24, 1.35, 0, 2.22, -2.1, tileRoofMat);
      backRoof.rotation.x = 0.18;
      // Left stoa wall & slanted roof
      addBox(bodyGroup, 0.32, 1.75, 4.7, -2.6, 1.15, -0.2, marbleMat);
      const leftRoof = addBox(bodyGroup, 1.25, 0.22, 4.9, -2.15, 2.12, -0.2, tileRoofMat);
      leftRoof.rotation.z = -0.18;
      // Right stoa wall & slanted roof
      addBox(bodyGroup, 0.32, 1.75, 4.7, 2.6, 1.15, -0.2, marbleMat);
      const rightRoof = addBox(bodyGroup, 1.25, 0.22, 4.9, 2.15, 2.12, -0.2, tileRoofMat);
      rightRoof.rotation.z = 0.18;

      // Inner peristyle Doric columns supporting the 3 stoa roofs
      for (const cx of [-1.6, -0.55, 0.55, 1.6]) {
        addCyl(bodyGroup, 0.1, 0.12, 1.85, 8, cx, 1.18, -1.62, marbleMat);
      }
      for (const cz of [-0.65, 0.45, 1.55]) {
        addCyl(bodyGroup, 0.1, 0.12, 1.78, 8, -1.65, 1.14, cz, marbleMat);
        addCyl(bodyGroup, 0.1, 0.12, 1.78, 8, 1.65, 1.14, cz, marbleMat);
      }

      // Front entrance pillars, Athenian banners & glowing bronze tripod braziers
      for (const sx of [-1.65, 1.65]) {
        addBox(bodyGroup, 0.52, 0.72, 0.52, sx, 0.62, 2.55, marbleMat);
        addCyl(bodyGroup, 0.18, 0.1, 0.26, 8, sx, 1.12, 2.55, bronzeMat);
        const flame = new THREE.Mesh(new THREE.OctahedronGeometry(0.14, 0), fireMat);
        flame.position.set(sx, 1.32, 2.55);
        bodyGroup.add(flame);
      }
      // Training dummy & weapon/shield rack along the courtyard edge
      addCyl(bodyGroup, 0.09, 0.1, 1.35, 6, -1.05, 0.92, -0.85, woodMat);
      addBox(bodyGroup, 0.72, 0.1, 0.1, -1.05, 1.25, -0.85, woodMat);
      const sh1 = addCyl(bodyGroup, 0.34, 0.34, 0.08, 10, 1.15, 0.72, -1.2, teamMat);
      sh1.rotation.x = Math.PI / 2;
      const sh2 = addCyl(bodyGroup, 0.34, 0.34, 0.08, 10, 0.55, 0.72, -1.2, bronzeMat);
      sh2.rotation.x = Math.PI / 2;
      // Tall athletic flagpole & banner
      addCyl(bodyGroup, 0.045, 0.055, 3.6, 6, 0, 2.0, -2.35, woodMat);
      const gymBanner = addBox(bodyGroup, 1.15, 0.62, 0.08, 0.58, 3.35, -2.35, teamMat);
      const trim = addBox(bodyGroup, 2.4, 0.26, 0.12, 0, 2.12, -1.5, teamMat);
      teamMeshes.push(sh1, gymBanner, trim);
      break;
    }

    case 'dock': {
      // Coastal Harbor Dock with official 0 A.D. timber, stone quay & terracotta roof textures!
      const plankMat = getTexMat('textures/palisade_main.png', null, 0xc79e72, 2.0, 2.2, 0.9, 0.02);
      const darkTimberMat = getTexMat('textures/palisade_main.png', null, 0x876240, 1.5, 1.5, 0.94, 0.02);
      const amphoraMat = getTexMat('textures/hele_tile_c.png', null, 0xc8744d, 1.0, 1.0, 0.82, 0.04);
      const ropeMat = getMat(0xc9b17b, 0.92, 0.0);

      // Stone quay & retaining wall anchored deeply on the shoreline side
      addBox(bodyGroup, 5.2, 4.0, 2.6, 0, -1.65, -1.6, getFoundationStoneMat());
      // Harbor warehouse shed on the quay
      addBox(bodyGroup, 3.4, 1.85, 2.0, -0.5, 1.25, -1.75, stoneMat);
      const shedRoof = addBox(bodyGroup, 3.8, 0.34, 2.35, -0.5, 2.32, -1.75, roofMat);
      shedRoof.rotation.x = 0.14;
      addBox(bodyGroup, 0.95, 1.35, 0.15, -0.5, 0.98, -0.72, darkTimberMat);
      const dockAwning = addBox(bodyGroup, 1.6, 0.18, 0.7, -0.5, 1.65, -0.45, teamMat);
      teamMeshes.push(dockAwning);

      // Long sturdy wooden jetty pier extending out over the sea (+Z = outward toward water)
      addBox(bodyGroup, 3.1, 0.24, 4.9, 0, 0.32, 1.75, plankMat);
      // Cross planks detail
      for (let pz = -0.35; pz <= 3.95; pz += 0.6) {
        addBox(bodyGroup, 3.22, 0.08, 0.28, 0, 0.44, pz, darkTimberMat, false);
      }
      // Deep timber pilings plunging down to -4.2m into seabed (never floats!)
      for (const px of [-1.35, 1.35]) {
        for (const pz of [0.1, 1.5, 2.9, 4.05]) {
          addCyl(bodyGroup, 0.15, 0.17, 4.7, 7, px, -1.8, pz, darkTimberMat);
          // Bollard cap rising above pier deck
          addCyl(bodyGroup, 0.16, 0.15, 0.38, 7, px, 0.62, pz, darkTimberMat);
        }
      }

      // Wooden cargo crane arm overhanging the pier
      addCyl(bodyGroup, 0.11, 0.13, 2.6, 6, 1.65, 1.6, -0.65, darkTimberMat);
      const boom = addBox(bodyGroup, 0.16, 0.16, 2.6, 1.65, 2.65, 0.45, darkTimberMat);
      boom.rotation.x = -0.28;
      addCyl(bodyGroup, 0.025, 0.025, 1.5, 5, 1.65, 2.15, 1.55, ropeMat, false);
      addBox(bodyGroup, 0.62, 0.56, 0.62, 1.65, 1.32, 1.55, plankMat);

      // Cargo amphorae & crates on the quay
      addCyl(bodyGroup, 0.16, 0.22, 0.58, 7, 1.55, 0.65, -1.65, amphoraMat);
      addCyl(bodyGroup, 0.16, 0.22, 0.54, 7, 1.95, 0.62, -1.9, amphoraMat);
      addBox(bodyGroup, 0.65, 0.52, 0.65, 1.85, 0.62, -1.2, plankMat);

      // Harbor beacon mast & waving team pennant
      addCyl(bodyGroup, 0.05, 0.06, 3.6, 6, -1.25, 2.2, 3.7, darkTimberMat);
      const harborFlag = addBox(bodyGroup, 1.25, 0.65, 0.08, -0.6, 3.65, 3.7, teamMat);
      teamMeshes.push(harborFlag);
      break;
    }

    case 'stone_wall': {
      // Authentic 0 A.D. Continuous Ashlar Stone Curtain Wall (normalized to 2.0m base span, dynamically stretched center-to-center in SceneManager for 0-gap continuous walls!)
      const wallStone = getTexMat('textures/stone_aegean_01.png', 'textures/stone_india_01_norm.png', 0xdfd7c6, 1.35, 1.25, 0.91, 0.04);
      const wallTrim = getTexMat('textures/rome_struct_2.png', 'textures/rome_struct_2_norm.png', 0xc9c0ae, 1.2, 1.0, 0.92, 0.05);
      const pavingMat = getTexMat('textures/decal_stone_medit_01.png', 'textures/decal_stone_medit_01_norm.png', 0xd0c7b4, 1.4, 1.0, 0.94, 0.03);
      const timberMat = getTexMat('textures/palisade_main.png', null, 0x6f4e32, 1.2, 1.0, 0.9, 0.03);

      const wallShearGroup = new THREE.Group();
      // Deep continuous mountain skirt + smooth battered 0 A.D. stone curtain (length 2.16m -> overlaps seamlessly when scaled to neighbor distance!)
      addBox(wallShearGroup, 2.16, 5.2, 1.46, 0, -2.45, 0, darkStoneMat);
      addBox(wallShearGroup, 2.16, 0.48, 1.42, 0, 0.24, 0, darkStoneMat);
      addBox(wallShearGroup, 2.16, 2.18, 1.18, 0, 1.35, 0, wallStone);
      // Moulded 0 A.D. cornice trim + wide flagstone rampart road + timber parapet railing
      addBox(wallShearGroup, 2.18, 0.18, 1.32, 0, 2.48, 0, wallTrim);
      addBox(wallShearGroup, 2.16, 0.08, 0.96, 0, 2.59, -0.02, pavingMat);
      // Inner rear guard wall (-Z)
      addBox(wallShearGroup, 2.16, 0.36, 0.18, 0, 2.74, -0.54, wallStone);
      addBox(wallShearGroup, 2.16, 0.08, 0.12, 0, 2.95, -0.54, timberMat);
      // Continuous outer 0 A.D. stone parapet breastwork + evenly spaced beveled crenellations (merlons)
      addBox(wallShearGroup, 2.16, 0.28, 0.24, 0, 2.7, 0.52, wallStone);
      for (const mx of [-0.72, 0, 0.72]) {
        addBox(wallShearGroup, 0.42, 0.46, 0.26, mx, 3.02, 0.52, wallStone);
        addBox(wallShearGroup, 0.46, 0.07, 0.3, mx, 3.27, 0.52, wallTrim);
      }
      bodyGroup.add(wallShearGroup);
      parts.wallShearGroup = wallShearGroup;

      // Authentic 0 A.D. stone wall corner/end bastion turret (ONLY shown at wall bends & endpoints so straight walls stay 100% seamless!)
      const cornerBastion = new THREE.Group();
      addBox(cornerBastion, 1.62, 5.2, 1.62, 0, -2.45, 0, darkStoneMat);
      addBox(cornerBastion, 1.56, 2.85, 1.56, 0, 1.42, 0, wallStone);
      addBox(cornerBastion, 1.72, 0.22, 1.72, 0, 2.92, 0, wallTrim);
      for (const bx of [-0.56, 0.56]) {
        for (const bz of [-0.56, 0.56]) {
          addBox(cornerBastion, 0.42, 0.46, 0.42, bx, 3.24, bz, wallStone);
        }
      }
      cornerBastion.visible = false;
      bodyGroup.add(cornerBastion);
      parts.wallCornerBastion = cornerBastion;
      break;
    }

    case 'stone_gate': {
      // Grand 3-Segment Great Wall Stone City Gate with animated swinging double doors & lock bar!
      const wallStone = getTexMat('textures/stone_aegean_01.png', 'textures/stone_india_01_norm.png', 0xdfd7c7, 1.6, 1.5, 0.91, 0.04);
      const wallTrim = getTexMat('textures/rome_struct_2.png', 'textures/rome_struct_2_norm.png', 0xc4bba9, 1.2, 1.2, 0.93, 0.05);
      const gateDoorMat = getTexMat('textures/hele_gate.png', null, 0xd8c3a5, 1.0, 1.0, 0.88, 0.06);
      const ironMat = getMat(0x374151, 0.45, 0.72);
      const lockMat = getMat(0xdc2626, 0.35, 0.65);

      // Extended flanking wall wings reaching ±4.4m so a 3-segment upgraded gate connects seamlessly into the continuous Great Wall!
      for (const side of [-1, 1]) {
        const wx = side * 3.1;
        addBox(bodyGroup, 2.68, 4.6, 1.36, wx, -2.15, 0, darkStoneMat);
        addBox(bodyGroup, 2.68, 2.34, 1.12, wx, 1.17, 0, wallStone);
        addBox(bodyGroup, 2.7, 0.16, 1.24, wx, 2.34, 0, wallTrim);
        addBox(bodyGroup, 2.68, 0.34, 0.18, wx, 2.58, -0.5, wallStone);
        for (const ox of [-0.8, 0, 0.8]) {
          addBox(bodyGroup, 0.46, 0.44, 0.24, wx + ox, 2.74, 0.48, wallStone);
        }
      }

      // Twin tall fortified gatehouse towers framing the 2.4m-wide central archway
      for (const tx of [-1.85, 1.85]) {
        addBox(bodyGroup, 1.52, 4.4, 1.78, tx, -2.0, 0, darkStoneMat);
        addBox(bodyGroup, 1.5, 0.42, 1.74, tx, 0.21, 0, darkStoneMat);
        addBox(bodyGroup, 1.36, 3.45, 1.54, tx, 1.96, 0, wallStone);
        addBox(bodyGroup, 1.52, 0.24, 1.68, tx, 3.74, 0, wallTrim);
        for (const bx of [-0.48, 0.48]) {
          for (const bz of [-0.58, 0.58]) {
            addBox(bodyGroup, 0.38, 0.44, 0.38, tx + bx, 4.04, bz, wallStone);
          }
        }
        const bFront = addBox(bodyGroup, 0.5, 1.32, 0.08, tx, 2.38, 0.81, teamMat);
        const bBack = addBox(bodyGroup, 0.5, 1.32, 0.08, tx, 2.38, -0.81, teamMat);
        teamMeshes.push(bFront, bBack);
      }

      // Elevated arched bridge & gatehouse parapet spanning above archway
      addBox(bodyGroup, 2.6, 1.05, 1.42, 0, 2.95, 0, wallStone);
      addBox(bodyGroup, 2.74, 0.18, 1.56, 0, 3.52, 0, wallTrim);
      for (const mx of [-0.82, 0, 0.82]) {
        addBox(bodyGroup, 0.44, 0.42, 0.24, mx, 3.78, 0.6, wallStone);
        addBox(bodyGroup, 0.44, 0.42, 0.24, mx, 3.78, -0.6, wallStone);
      }

      // Iron portcullis teeth above archway
      addBox(bodyGroup, 2.3, 0.1, 0.12, 0, 2.42, 0.46, ironMat);
      for (let gx = -0.96; gx <= 0.98; gx += 0.32) {
        addBox(bodyGroup, 0.06, 0.42, 0.08, gx, 2.26, 0.46, ironMat);
      }

      // Hinged animated double gate doors (closed = rotated 0 across opening; open = swung 90deg inward!)
      const leftHinge = new THREE.Group();
      leftHinge.position.set(-1.14, 0, 0.12);
      const leftLeaf = addBox(leftHinge, 1.12, 2.32, 0.18, 0.56, 1.16, 0, gateDoorMat);
      addBox(leftHinge, 1.12, 0.12, 0.22, 0.56, 0.65, 0, ironMat);
      addBox(leftHinge, 1.12, 0.12, 0.22, 0.56, 1.72, 0, ironMat);
      bodyGroup.add(leftHinge);
      parts.gateDoorLeft = leftHinge;
      void leftLeaf;

      const rightHinge = new THREE.Group();
      rightHinge.position.set(1.14, 0, 0.12);
      addBox(rightHinge, 1.12, 2.32, 0.18, -0.56, 1.16, 0, gateDoorMat);
      addBox(rightHinge, 1.12, 0.12, 0.22, -0.56, 0.65, 0, ironMat);
      addBox(rightHinge, 1.12, 0.12, 0.22, -0.56, 1.72, 0, ironMat);
      bodyGroup.add(rightHinge);
      parts.gateDoorRight = rightHinge;

      // Heavy iron & crimson lock bar shown across doors when gate is LOCKED!
      const lockBar = new THREE.Group();
      addBox(lockBar, 2.35, 0.24, 0.32, 0, 1.18, 0.28, lockMat);
      addBox(lockBar, 0.42, 0.48, 0.36, 0, 1.18, 0.32, ironMat);
      lockBar.visible = false;
      bodyGroup.add(lockBar);
      parts.gateLockBar = lockBar;

      const keystone = addBox(bodyGroup, 0.72, 0.58, 0.12, 0, 2.95, 0.75, teamMat);
      teamMeshes.push(keystone);
      break;
    }

    case 'beacon_tower': {
      // Great Wall Beacon Tower (長城烽火台) with 3 visual tiers, blazing fire brazier & towering wolf-smoke column!
      const wallStone = getTexMat('textures/stone_aegean_01.png', 'textures/stone_india_01_norm.png', 0xd6cfc0, 1.5, 1.6, 0.91, 0.04);
      const wallTrim = getTexMat('textures/rome_struct_2.png', 'textures/rome_struct_2_norm.png', 0xbab19f, 1.2, 1.2, 0.92, 0.05);
      const roofTileMat = getTexMat('textures/roof_tiles_medit.png', null, 0x8b3a2b, 1.6, 1.6, 0.78, 0.06);
      const ironMat = getMat(0x27272a, 0.45, 0.72);
      const timberMat = getMat(0x5c3a21, 0.88, 0.04);

      // Deep mountain anchor base + Level 1 square battered Great Wall brick watchtower
      addBox(bodyGroup, 3.4, 4.6, 3.4, 0, -2.1, 0, darkStoneMat);
      addBox(bodyGroup, 3.3, 0.55, 3.3, 0, 0.28, 0, darkStoneMat);
      addBox(bodyGroup, 2.95, 3.7, 2.95, 0, 2.35, 0, wallStone);
      // Connecting shoulder stubs so it fuses seamlessly with adjacent Great Wall segments
      addBox(bodyGroup, 3.3, 2.28, 1.12, 0, 1.18, 0, wallStone);
      // Top cornice & battlements (Lv.1 platform at y=4.3)
      addBox(bodyGroup, 3.25, 0.24, 3.25, 0, 4.28, 0, wallTrim);
      for (const sx of [-1.25, -0.42, 0.42, 1.25]) {
        addBox(bodyGroup, 0.48, 0.48, 0.26, sx, 4.62, 1.46, wallStone);
        addBox(bodyGroup, 0.48, 0.48, 0.26, sx, 4.62, -1.46, wallStone);
      }
      for (const sz of [-0.9, 0, 0.9]) {
        addBox(bodyGroup, 0.26, 0.48, 0.48, 1.46, 4.62, sz, wallStone);
        addBox(bodyGroup, 0.26, 0.48, 0.48, -1.46, 4.62, sz, wallStone);
      }
      // Stone signal brazier base + wood fuel pile on Lv.1 deck
      addCyl(bodyGroup, 0.68, 0.85, 0.58, 8, 0, 4.65, 0, ironMat);
      addBox(bodyGroup, 0.82, 0.24, 0.22, 0, 4.98, 0, timberMat);
      addBox(bodyGroup, 0.22, 0.24, 0.82, 0, 4.98, 0, timberMat);
      // Heraldic team banner on front face
      const bBanner1 = addBox(bodyGroup, 0.65, 1.65, 0.09, 0, 2.55, 1.51, teamMat);
      const bBanner2 = addBox(bodyGroup, 0.65, 1.65, 0.09, 0, 2.55, -1.51, teamMat);
      teamMeshes.push(bBanner1, bBanner2);

      // Level 2 fortified upper tier (shown when beaconLevel >= 2)
      const tier2 = new THREE.Group();
      addBox(tier2, 2.55, 1.65, 2.55, 0, 5.15, 0, wallStone);
      addBox(tier2, 2.85, 0.24, 2.85, 0, 6.02, 0, wallTrim);
      for (const cx of [-1.05, 0, 1.05]) {
        addBox(tier2, 0.44, 0.46, 0.24, cx, 6.32, 1.28, wallStone);
        addBox(tier2, 0.44, 0.46, 0.24, cx, 6.32, -1.28, wallStone);
      }
      addCyl(tier2, 0.72, 0.9, 0.55, 8, 0, 6.35, 0, ironMat);
      tier2.visible = false;
      bodyGroup.add(tier2);
      parts.beaconTier2 = tier2;

      // Level 3 grand imperial beacon watch-pavilion crown (shown when beaconLevel >= 3)
      const tier3 = new THREE.Group();
      addBox(tier3, 2.15, 1.35, 2.15, 0, 6.72, 0, wallStone);
      addBox(tier3, 2.95, 0.26, 2.95, 0, 7.45, 0, roofTileMat);
      addBox(tier3, 2.45, 0.24, 2.45, 0, 7.68, 0, roofTileMat);
      addCyl(tier3, 0.82, 0.98, 0.6, 8, 0, 7.98, 0, ironMat);
      // Four corner bronze signal braziers + tall command flag
      for (const [cx, cz] of [[-1.15, -1.15], [1.15, -1.15], [-1.15, 1.15], [1.15, 1.15]] as const) {
        addCyl(tier3, 0.2, 0.26, 0.38, 6, cx, 7.72, cz, ironMat);
      }
      addCyl(tier3, 0.05, 0.06, 2.6, 6, 1.1, 8.8, 1.1, timberMat);
      const topFlag = addBox(tier3, 1.15, 0.62, 0.08, 1.65, 9.65, 1.1, teamMat);
      teamMeshes.push(topFlag);
      tier3.visible = false;
      bodyGroup.add(tier3);
      parts.beaconTier3 = tier3;

      // Photorealistic Multi-Layer Particle Beacon Signal Fire (glowing coals + additive flames + rising embers + dynamic light!)
      const fireGroup = new THREE.Group();
      fireGroup.position.set(0, 5.05, 0);
      const flameTex = getRealisticFlameTexture();
      const emberTex = getRealisticEmberTexture();

      // Glowing bed of hot burning charcoal/embers inside the brazier
      const coalMat = new THREE.MeshStandardMaterial({
        color: 0x3b1206,
        emissive: 0xff4500,
        emissiveIntensity: 2.2,
        roughness: 0.85,
      });
      const coalBed = new THREE.Mesh(new THREE.CylinderGeometry(0.58, 0.68, 0.24, 10), coalMat);
      coalBed.position.y = 0.04;
      fireGroup.add(coalBed);
      parts.beaconCoalMesh = coalBed;

      // Dynamic warm flickering firelight illuminating the stone parapet & battlements
      const beaconLight = new THREE.PointLight(0xff7a1a, 0, 18, 1.6);
      beaconLight.position.set(0, 1.25, 0);
      fireGroup.add(beaconLight);
      parts.beaconLight = beaconLight;

      // 10 layered swirling additive flame tongue sprites (hot core + roaring outer tongues)
      for (let fi = 0; fi < 10; fi++) {
        const isCore = fi < 4;
        const fMat = new THREE.SpriteMaterial({
          map: flameTex,
          color: isCore ? 0xfff0b8 : fi % 2 === 0 ? 0xff9224 : 0xff5a12,
          transparent: true,
          opacity: isCore ? 0.94 : 0.82,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
        });
        const flameSprite = new THREE.Sprite(fMat);
        flameSprite.userData = {
          kind: 'flame',
          idx: fi,
          isCore,
          angle: (fi / 10) * Math.PI * 2,
          radius: isCore ? 0.14 : 0.34,
          phase: fi * 0.37,
        };
        flameSprite.position.set(0, 0.8, 0);
        flameSprite.scale.set(isCore ? 1.15 : 1.75, isCore ? 1.85 : 2.65, 1);
        fireGroup.add(flameSprite);
      }

      // 12 rising glowing ember sparks spiraling upward above the blaze
      for (let ei = 0; ei < 12; ei++) {
        const eMat = new THREE.SpriteMaterial({
          map: emberTex,
          color: ei % 2 === 0 ? 0xffd26a : 0xff7b22,
          transparent: true,
          opacity: 0.9,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
        });
        const ember = new THREE.Sprite(eMat);
        ember.userData = {
          kind: 'ember',
          idx: ei,
          phase: ei / 12,
          swirl: (ei % 2 === 0 ? 1 : -1) * (1.2 + (ei % 3) * 0.45),
        };
        ember.scale.set(0.24, 0.24, 1);
        fireGroup.add(ember);
      }

      fireGroup.visible = false;
      bodyGroup.add(fireGroup);
      parts.beaconFireGroup = fireGroup;

      // Realistic Towering Volumetric Billowing Wolf-Smoke Plume (狼煙) — 18 soft wind-swept cloud puffs!
      const smokeGroup = new THREE.Group();
      smokeGroup.position.set(0, 5.4, 0);
      const smokeTex = getRealisticSmokePuffTexture();
      for (let si = 0; si < 18; si++) {
        const sMat = new THREE.SpriteMaterial({
          map: smokeTex,
          color: 0x3f3f46,
          transparent: true,
          opacity: 0.55,
          depthWrite: false,
        });
        const puff = new THREE.Sprite(sMat);
        puff.userData = {
          phase: si / 18,
          driftSeed: si * 1.73,
          rotDir: si % 2 === 0 ? 1 : -1,
        };
        puff.scale.set(1.6, 1.6, 1);
        smokeGroup.add(puff);
      }
      smokeGroup.visible = false;
      bodyGroup.add(smokeGroup);
      parts.beaconSmokeGroup = smokeGroup;
      break;
    }

    case 'stone_bridge': {
      // Authentic Roman Arched Limestone Bridge spanning rivers, lakes & moats!
      const bridgeStone = getTexMat('textures/stone_aegean_01.png', 'textures/stone_india_01_norm.png', 0xdfd7c6, 1.5, 1.2, 0.92, 0.04);
      const bridgeDeck = getTexMat('textures/decal_stone_medit_01.png', 'textures/decal_stone_medit_01_norm.png', 0xd6cdb9, 1.4, 1.4, 0.94, 0.03);
      const bridgePier = getTexMat('textures/rome_struct_2.png', 'textures/rome_struct_2_norm.png', 0xada494, 1.2, 1.8, 0.94, 0.05);

      // Deep cutwater stone piers anchored down into the riverbed (-3.2m so bridge never floats!)
      addBox(bodyGroup, 0.56, 3.6, 2.35, -1.08, -1.45, 0, bridgePier);
      addBox(bodyGroup, 0.56, 3.6, 2.35, 1.08, -1.45, 0, bridgePier);
      // Extended arched masonry spandrel deck (2.92m long) so straight AND diagonal bridge segments fuse with zero gaps!
      addBox(bodyGroup, 2.92, 0.34, 2.24, 0, 0.32, 0, bridgeStone);
      addBox(bodyGroup, 2.94, 0.1, 2.04, 0, 0.51, 0, bridgeDeck);
      // Curved underside stone arch ribs
      const archL = new THREE.Mesh(new THREE.CylinderGeometry(0.76, 0.76, 2.18, 10, 1, true, 0, Math.PI), bridgeStone);
      archL.rotation.x = Math.PI / 2;
      archL.rotation.z = Math.PI / 2;
      archL.position.set(0, -0.05, 0);
      bodyGroup.add(archL);
      // Low carved stone side parapets & bollards along both edges
      addBox(bodyGroup, 2.92, 0.44, 0.24, 0, 0.72, 1.02, bridgeStone);
      addBox(bodyGroup, 2.92, 0.44, 0.24, 0, 0.72, -1.02, bridgeStone);
      for (const px of [-1.22, 1.22]) {
        addBox(bodyGroup, 0.3, 0.56, 0.32, px, 0.78, 1.02, bridgePier);
        addBox(bodyGroup, 0.3, 0.56, 0.32, px, 0.78, -1.02, bridgePier);
      }
      // Small team pennant shield on outer parapet
      const bridgeCrest = addBox(bodyGroup, 0.38, 0.28, 0.08, 0, 0.72, 1.16, teamMat);
      teamMeshes.push(bridgeCrest);
      break;
    }

    case 'apartment_house': {
      // Multi-Story Mediterranean Insula / Apartment (2 stories by default, expandable up to 3 stories!)
      const wallPlaster = getTexMat('textures/rome_struct_2.png', 'textures/rome_struct_2_norm.png', 0xebd9be, 1.8, 1.5, 0.88, 0.03);
      const baseStone = getTexMat('textures/stone_aegean_01.png', 'textures/stone_india_01_norm.png', 0xd8cebc, 1.6, 1.3, 0.92, 0.04);
      const tileRoof = getTexMat('textures/hele_tile_c.png', null, civ.roofColor, 2.2, 2.2, 0.8, 0.05);
      const timberMat = getTexMat('textures/palisade_main.png', null, 0x7b5637, 1.4, 1.4, 0.9, 0.03);
      const windowMat = getMat(0x272320, 0.65, 0.08);
      const trimStone = getTexMat('textures/decal_stone_medit_01.png', 'textures/decal_stone_medit_01_norm.png', 0xe5dccb, 1.5, 1.0, 0.9, 0.04);

      // ===== FLOOR 1: Ground-floor stone colonnade & arched entrance (y = 0 .. 1.95) =====
      addBox(bodyGroup, 3.35, 1.92, 3.25, 0, 0.96, 0, baseStone);
      // Recessed dark doorway & front colonnade arches
      addBox(bodyGroup, 0.72, 1.28, 0.14, 0, 0.64, 1.62, windowMat);
      for (const px of [-1.42, -0.52, 0.52, 1.42]) {
        addBox(bodyGroup, 0.26, 1.94, 0.26, px, 0.97, 1.62, trimStone);
        addBox(bodyGroup, 0.26, 1.94, 0.26, px, 0.97, -1.62, trimStone);
      }
      // Moulded stone belt cornice separating 1F & 2F
      addBox(bodyGroup, 3.62, 0.18, 3.52, 0, 1.98, 0, trimStone);

      // ===== FLOOR 2: Sunlit ochre plaster 2nd story with timber balconies & arched windows (y = 2.07 .. 3.85) =====
      addBox(bodyGroup, 3.22, 1.76, 3.12, 0, 2.95, 0, wallPlaster);
      // Timber balcony cantilevered on front & back + window shutters
      for (const sz of [1, -1]) {
        addBox(bodyGroup, 2.6, 0.1, 0.52, 0, 2.15, sz * 1.72, timberMat);
        addBox(bodyGroup, 2.55, 0.34, 0.08, 0, 2.36, sz * 1.94, timberMat);
        for (const wx of [-0.92, 0, 0.92]) {
          addBox(bodyGroup, 0.44, 0.74, 0.1, wx, 2.98, sz * 1.56, windowMat);
          addBox(bodyGroup, 0.54, 0.09, 0.16, wx, 3.4, sz * 1.58, trimStone);
        }
      }
      for (const sx of [-1, 1]) {
        for (const wz of [-0.82, 0.82]) {
          addBox(bodyGroup, 0.1, 0.74, 0.44, sx * 1.61, 2.98, wz, windowMat);
        }
      }
      const banner2F = addBox(bodyGroup, 0.56, 0.72, 0.08, 0, 2.48, 1.98, teamMat);
      teamMeshes.push(banner2F);

      // 2-story terracotta pitched roof cap (automatically hidden when upgraded to 3 stories!)
      const floor2Roof = new THREE.Group();
      const roof2L = addBox(floor2Roof, 3.68, 0.22, 2.05, 0, 4.18, 0.88, tileRoof);
      roof2L.rotation.x = 0.28;
      const roof2R = addBox(floor2Roof, 3.68, 0.22, 2.05, 0, 4.18, -0.88, tileRoof);
      roof2R.rotation.x = -0.28;
      addBox(floor2Roof, 3.74, 0.18, 0.26, 0, 4.48, 0, trimStone);
      bodyGroup.add(floor2Roof);
      parts.floor2Roof = floor2Roof;

      // ===== FLOOR 3: Grand 3rd story penthouse terrace & roof (visible when floors >= 3, max 3 stories!) =====
      const floor3Group = new THREE.Group();
      addBox(floor3Group, 3.46, 0.18, 3.36, 0, 3.88, 0, trimStone);
      addBox(floor3Group, 2.96, 1.68, 2.86, 0, 4.78, 0, wallPlaster);
      for (const px of [-1.42, 1.42]) {
        for (const pz of [-1.36, 1.36]) {
          addBox(floor3Group, 0.24, 1.7, 0.24, px, 4.78, pz, trimStone);
        }
      }
      for (const sz of [1, -1]) {
        addBox(floor3Group, 2.35, 0.1, 0.46, 0, 4.02, sz * 1.56, timberMat);
        addBox(floor3Group, 2.3, 0.32, 0.08, 0, 4.22, sz * 1.76, timberMat);
        for (const wx of [-0.78, 0, 0.78]) {
          addBox(floor3Group, 0.4, 0.68, 0.1, wx, 4.82, sz * 1.43, windowMat);
        }
      }
      // Grand 3rd-story pitched terracotta roof + pinnacle crest
      const roof3L = addBox(floor3Group, 3.48, 0.22, 1.92, 0, 5.96, 0.82, tileRoof);
      roof3L.rotation.x = 0.3;
      const roof3R = addBox(floor3Group, 3.48, 0.22, 1.92, 0, 5.96, -0.82, tileRoof);
      roof3R.rotation.x = -0.3;
      addBox(floor3Group, 3.54, 0.18, 0.26, 0, 6.26, 0, trimStone);
      const banner3F = addBox(floor3Group, 0.62, 0.78, 0.08, 0, 4.35, 1.82, teamMat);
      teamMeshes.push(banner3F);
      floor3Group.visible = false;
      bodyGroup.add(floor3Group);
      parts.floor3Group = floor3Group;
      break;
    }

    case 'trader': {
      // Mediterranean Trade Caravan: pack mule + wooden wheeled merchant cart loaded with amphorae & gold coin chest!
      const cartWood = getTexMat('textures/palisade_main.png', null, 0x9c6e42, 1.4, 1.4, 0.88, 0.03);
      const darkWood = getTexMat('textures/palisade_main.png', null, 0x5c3e24, 1.2, 1.2, 0.92, 0.03);
      const muleMat = getMat(0x876a4f, 0.88, 0.02);
      const maneMat = getMat(0x3a2a1d, 0.92, 0.0);
      const amphoraMat = getTexMat('textures/hele_tile_c.png', null, 0xc8744d, 1.0, 1.0, 0.8, 0.04);
      const goldMat = getMat(0xfacc15, 0.28, 0.82);
      const sackMat = getMat(0xe5d4b3, 0.92, 0.0);

      // Wooden cargo cart (rear, z = -0.45)
      addBox(bodyGroup, 0.92, 0.42, 1.18, 0, 0.68, -0.46, cartWood);
      addBox(bodyGroup, 0.98, 0.1, 1.24, 0, 0.46, -0.46, darkWood);
      // Two spoked wooden wheels
      for (const sx of [-0.54, 0.54]) {
        const wheel = addCyl(bodyGroup, 0.36, 0.36, 0.09, 10, sx, 0.36, -0.46, darkWood);
        wheel.rotation.z = Math.PI / 2;
      }
      // Wooden harness shafts connecting cart to pack mule
      addBox(bodyGroup, 0.06, 0.06, 0.95, -0.3, 0.64, 0.38, darkWood);
      addBox(bodyGroup, 0.06, 0.06, 0.95, 0.3, 0.64, 0.38, darkWood);
      // Team-colored sun canopy hoops & awning over cargo
      addBox(bodyGroup, 0.96, 0.08, 1.08, 0, 1.38, -0.48, teamMat);
      for (const [px, pz] of [[-0.44, -0.98], [0.44, -0.98], [-0.44, 0.04], [0.44, 0.04]] as const) {
        addCyl(bodyGroup, 0.03, 0.03, 0.56, 5, px, 1.12, pz, darkWood);
      }
      // Cargo inside cart: terracotta amphorae, grain sacks & gleaming gold chest!
      addCyl(bodyGroup, 0.13, 0.17, 0.44, 7, -0.22, 1.04, -0.72, amphoraMat);
      addCyl(bodyGroup, 0.12, 0.16, 0.4, 7, 0.22, 1.02, -0.76, amphoraMat);
      addBox(bodyGroup, 0.38, 0.26, 0.32, -0.16, 0.96, -0.22, sackMat);
      addBox(bodyGroup, 0.36, 0.24, 0.28, 0.22, 0.98, -0.24, goldMat);

      // Sturdy pack mule/donkey pulling the cart (+Z front!)
      const mTorso = new THREE.Mesh(new THREE.CapsuleGeometry(0.24, 0.62, 6, 9), muleMat);
      mTorso.rotation.x = Math.PI / 2;
      mTorso.position.set(0, 0.72, 0.62);
      mTorso.castShadow = true;
      bodyGroup.add(mTorso);
      const mNeck = new THREE.Mesh(new THREE.CapsuleGeometry(0.14, 0.36, 5, 7), muleMat);
      mNeck.rotation.x = -0.45;
      mNeck.position.set(0, 0.98, 0.98);
      bodyGroup.add(mNeck);
      const mHead = new THREE.Mesh(new THREE.SphereGeometry(0.16, 7, 6), muleMat);
      mHead.scale.set(0.78, 0.85, 1.38);
      mHead.position.set(0, 1.12, 1.18);
      bodyGroup.add(mHead);
      for (const sx of [-0.08, 0.08]) {
        const ear = new THREE.Mesh(new THREE.ConeGeometry(0.035, 0.24, 5), maneMat);
        ear.position.set(sx, 1.32, 1.08);
        ear.rotation.z = sx > 0 ? -0.25 : 0.25;
        bodyGroup.add(ear);
      }
      for (const [lx, lz] of [[-0.14, 0.86], [0.14, 0.86], [-0.14, 0.38], [0.14, 0.38]] as const) {
        addCyl(bodyGroup, 0.055, 0.045, 0.66, 6, lx, 0.33, lz, muleMat);
      }
      const saddleCloth = addBox(bodyGroup, 0.54, 0.24, 0.38, 0, 0.82, 0.6, teamMat);
      teamMeshes.push(saddleCloth);
      break;
    }

    case 'tree_bamboo':
    case 'tree_hybrid_iron_bamboo': {
      // Unmistakable Asian Bamboo Grove (竹林): tall slender segmented green culms with crisp pale nodal rings
      // & light feathery 0 A.D. lanceolate bamboo leaf sprays on the upper stalks (leaving lower culms clearly visible!)
      const isIron = templateId === 'tree_hybrid_iron_bamboo';
      const stalkMatA = getMat(isIron ? 0x2d8a68 : 0x6ea838, 0.42, 0.06);
      const stalkMatB = getMat(isIron ? 0x3b9d74 : 0x5c9430, 0.46, 0.06);
      const nodeRingMat = getMat(isIron ? 0xa7f3d0 : 0xdbe2a8, 0.62, 0.02);
      const leafKey = isIron ? 'bamboo_leaves_iron' : 'bamboo_leaves_std';
      let leafSprayMat = matCache.get(leafKey);
      if (!leafSprayMat) {
        const leafMap = zeroADAssets.loadTexture(`${ASSET_BASE}/textures/bamboo_leaves.png`, true);
        leafSprayMat = new THREE.MeshStandardMaterial({
          map: leafMap,
          color: isIron ? 0xa7f3d0 : 0xdff5c6,
          roughness: 0.78,
          metalness: 0.02,
          alphaTest: 0.36,
          transparent: false,
          side: THREE.DoubleSide,
        });
        matCache.set(leafKey, leafSprayMat);
      }

      // 15 slender vertical & gracefully arching culms tightly clustered like a real bamboo grove
      const heightBoost = isIron ? 1.16 : 1.0;
      const stalks: Array<[number, number, number, number, number, number]> = [
        // [x, z, height, baseRad, leanX, leanZ]
        [0.0, 0.0, 6.4, 0.056, 0.03, 0.02],
        [-0.24, 0.16, 6.0, 0.052, -0.05, 0.04],
        [0.25, -0.14, 6.1, 0.053, 0.05, -0.04],
        [-0.18, -0.26, 5.5, 0.048, -0.04, -0.06],
        [0.22, 0.24, 5.7, 0.05, 0.06, 0.05],
        [-0.44, -0.04, 5.1, 0.046, -0.09, 0.02],
        [0.44, 0.06, 5.2, 0.046, 0.09, 0.03],
        [0.04, -0.44, 4.9, 0.044, 0.02, -0.09],
        [-0.08, 0.42, 5.0, 0.045, -0.03, 0.08],
        [-0.36, 0.34, 4.6, 0.042, -0.08, 0.07],
        [0.36, -0.34, 4.7, 0.042, 0.08, -0.07],
        [-0.34, -0.36, 4.4, 0.04, -0.07, -0.08],
        [0.34, 0.36, 4.5, 0.04, 0.07, 0.08],
        [-0.54, 0.18, 4.1, 0.038, -0.11, 0.04],
        [0.52, -0.18, 4.2, 0.038, 0.11, -0.04],
      ];

      const sprayGeom = new THREE.PlaneGeometry(1.05, 1.05);
      for (let sIdx = 0; sIdx < stalks.length; sIdx++) {
        const [bx, bz, rawH, baseR, leanX, leanZ] = stalks[sIdx];
        const bh = rawH * heightBoost;
        const sMat = sIdx % 2 === 0 ? stalkMatA : stalkMatB;

        // Build each culm in 3 gracefully tapering & gently curving segments
        const segs = 3;
        const segH = bh / segs;
        let curX = bx;
        let curY = 0;
        let curZ = bz;
        for (let seg = 0; seg < segs; seg++) {
          const bendMult = 1 + seg * 0.85;
          const tX = leanX * bendMult;
          const tZ = leanZ * bendMult;
          const rBot = baseR * (1 - (seg / segs) * 0.38);
          const rTop = baseR * (1 - ((seg + 1) / segs) * 0.44);

          const segGroup = new THREE.Group();
          segGroup.position.set(curX, curY, curZ);
          segGroup.rotation.set(tZ, 0, -tX);

          addCyl(segGroup, rTop, rBot, segH + 0.03, 7, 0, segH * 0.5, 0, sMat);

          // Crisp pale bamboo node rings (竹節) every ~0.46m along the culm
          for (let ny = 0.24; ny < segH - 0.05; ny += 0.46) {
            const frac = ny / segH;
            const nr = (rBot * (1 - frac) + rTop * frac) * 1.16;
            addCyl(segGroup, nr, nr, 0.036, 7, 0, ny, 0, nodeRingMat, false);
          }

          // Light feathery lanceolate bamboo leaf sprays ONLY on upper segments (seg >= 1) so slender green stalks dominate!
          if (seg >= 1) {
            const spraysHere = seg === 2 ? 3 : 2;
            for (let li = 0; li < spraysHere; li++) {
              const ly = segH * (0.28 + (li / spraysHere) * 0.65);
              const ang = sIdx * 1.7 + seg * 2.1 + li * ((Math.PI * 2) / spraysHere);
              const spray = new THREE.Mesh(sprayGeom, leafSprayMat);
              const sc = seg === 2 ? 0.72 + (li % 2) * 0.18 : 0.58;
              spray.scale.setScalar(sc);
              spray.position.set(Math.cos(ang) * 0.34 * sc, ly, Math.sin(ang) * 0.34 * sc);
              spray.rotation.set(0.32, -ang + Math.PI * 0.5, 0.22);
              spray.castShadow = true;
              segGroup.add(spray);
            }
          }

          bodyGroup.add(segGroup);
          curX += Math.sin(tX) * segH;
          curY += Math.cos(Math.hypot(tX, tZ)) * segH;
          curZ += Math.sin(tZ) * segH;
        }
      }
      break;
    }

    case 'wild_gazelle': {
      // Smooth sculpted tawny steppe gazelle (zero blocky boxes!)
      const coatMat = getMat(0xc99c62, 0.86, 0.02);
      const bellyMat = getMat(0xf4ead5, 0.88, 0.0);
      const hornMat = getMat(0x2d2620, 0.7, 0.1);
      const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.19, 0.56, 6, 10), coatMat);
      torso.rotation.x = Math.PI / 2;
      torso.position.set(0, 0.72, 0);
      torso.castShadow = true;
      bodyGroup.add(torso);
      const belly = new THREE.Mesh(new THREE.CapsuleGeometry(0.14, 0.44, 5, 8), bellyMat);
      belly.rotation.x = Math.PI / 2;
      belly.position.set(0, 0.62, 0);
      bodyGroup.add(belly);
      for (const [lx, lz] of [[-0.11, 0.29], [0.11, 0.29], [-0.11, -0.29], [0.11, -0.29]]) {
        addCyl(bodyGroup, 0.028, 0.04, 0.62, 6, lx, 0.31, lz, coatMat);
      }
      const neck = addCyl(bodyGroup, 0.065, 0.095, 0.46, 7, 0, 1.02, 0.36, coatMat);
      neck.rotation.x = 0.35;
      const gHead = new THREE.Mesh(new THREE.SphereGeometry(0.11, 8, 6), coatMat);
      gHead.scale.set(0.85, 0.85, 1.45);
      gHead.position.set(0, 1.24, 0.52);
      bodyGroup.add(gHead);
      for (const hx of [-0.05, 0.05]) {
        const horn = addCyl(bodyGroup, 0.012, 0.024, 0.36, 5, hx, 1.44, 0.46, hornMat);
        horn.rotation.x = -0.35;
      }
      break;
    }

    case 'wild_elephant': {
      // Smooth sculpted wild jungle elephant fallback (rounded torso, domes & curved trunk/tusks!)
      const hideMat = getMat(0x75706a, 0.92, 0.03);
      const ivoryMat = getMat(0xfbf5e4, 0.45, 0.04);
      const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.76, 1.05, 8, 12), hideMat);
      torso.rotation.x = Math.PI / 2;
      torso.position.set(0, 1.62, 0);
      torso.castShadow = true;
      bodyGroup.add(torso);
      for (const lx of [-0.46, 0.46]) {
        for (const lz of [-0.66, 0.66]) {
          addCyl(bodyGroup, 0.22, 0.27, 1.26, 9, lx, 0.63, lz, hideMat);
        }
      }
      const eHead = new THREE.Mesh(new THREE.SphereGeometry(0.64, 10, 8), hideMat);
      eHead.position.set(0, 1.98, 1.18);
      eHead.castShadow = true;
      bodyGroup.add(eHead);
      for (const ex of [-0.62, 0.62]) {
        const ear = new THREE.Mesh(new THREE.SphereGeometry(0.45, 8, 6), hideMat);
        ear.scale.set(0.22, 1.05, 0.78);
        ear.position.set(ex, 2.02, 1.02);
        bodyGroup.add(ear);
      }
      const trunkCurve = new THREE.CatmullRomCurve3([
        new THREE.Vector3(0, 1.85, 1.72),
        new THREE.Vector3(0, 1.35, 1.96),
        new THREE.Vector3(0, 0.82, 1.86),
        new THREE.Vector3(0, 0.64, 2.04),
      ]);
      const trunk = new THREE.Mesh(new THREE.TubeGeometry(trunkCurve, 10, 0.12, 7, false), hideMat);
      trunk.castShadow = true;
      bodyGroup.add(trunk);
      for (const tx of [-0.3, 0.3]) {
        const tusk = addCyl(bodyGroup, 0.03, 0.085, 1.12, 7, tx, 1.54, 1.98, ivoryMat);
        tusk.rotation.x = 1.2;
      }
      break;
    }

    case 'predator_wolf': {
      // Sleek organic grey timber wolf fallback (smooth capsules & tapered snout/tail!)
      const furMat = getMat(0x6b7280, 0.9, 0.02);
      const darkFur = getMat(0x374151, 0.92, 0.02);
      const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.21, 0.66, 6, 10), furMat);
      torso.rotation.x = Math.PI / 2;
      torso.position.set(0, 0.62, 0);
      torso.castShadow = true;
      bodyGroup.add(torso);
      for (const [lx, lz] of [[-0.13, 0.34], [0.13, 0.34], [-0.13, -0.34], [0.13, -0.34]]) {
        addCyl(bodyGroup, 0.035, 0.055, 0.5, 6, lx, 0.25, lz, darkFur);
      }
      const wHead = new THREE.Mesh(new THREE.SphereGeometry(0.17, 8, 6), furMat);
      wHead.scale.set(0.9, 0.85, 1.15);
      wHead.position.set(0, 0.82, 0.56);
      bodyGroup.add(wHead);
      const snout = addCyl(bodyGroup, 0.045, 0.09, 0.26, 6, 0, 0.77, 0.78, darkFur);
      snout.rotation.x = Math.PI / 2;
      for (const ex of [-0.09, 0.09]) {
        const ear = new THREE.Mesh(new THREE.ConeGeometry(0.045, 0.14, 5), darkFur);
        ear.position.set(ex, 0.98, 0.52);
        bodyGroup.add(ear);
      }
      const tail = new THREE.Mesh(new THREE.CapsuleGeometry(0.055, 0.38, 5, 7), darkFur);
      tail.position.set(0, 0.56, -0.66);
      tail.rotation.x = -0.95;
      bodyGroup.add(tail);
      break;
    }

    case 'predator_lion': {
      // Smooth sculpted golden Savanna Lion fallback (muscular curved torso & layered mane!)
      const tawnyMat = getMat(0xd4a04a, 0.86, 0.02);
      const maneMat = getMat(0x6b3e18, 0.94, 0.02);
      const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.28, 0.78, 6, 10), tawnyMat);
      torso.rotation.x = Math.PI / 2;
      torso.position.set(0, 0.76, 0);
      torso.castShadow = true;
      bodyGroup.add(torso);
      for (const [lx, lz] of [[-0.19, 0.44], [0.19, 0.44], [-0.19, -0.44], [0.19, -0.44]]) {
        addCyl(bodyGroup, 0.055, 0.08, 0.58, 7, lx, 0.29, lz, tawnyMat);
      }
      const mane = new THREE.Mesh(new THREE.SphereGeometry(0.42, 10, 8), maneMat);
      mane.scale.set(0.95, 1.05, 1.05);
      mane.position.set(0, 0.94, 0.62);
      mane.castShadow = true;
      bodyGroup.add(mane);
      const lHead = new THREE.Mesh(new THREE.SphereGeometry(0.21, 8, 7), tawnyMat);
      lHead.scale.set(0.95, 0.9, 1.25);
      lHead.position.set(0, 0.92, 0.92);
      bodyGroup.add(lHead);
      const tailCurve = new THREE.CatmullRomCurve3([
        new THREE.Vector3(0, 0.76, -0.58),
        new THREE.Vector3(0, 0.68, -0.92),
        new THREE.Vector3(0, 0.84, -1.14),
      ]);
      bodyGroup.add(new THREE.Mesh(new THREE.TubeGeometry(tailCurve, 7, 0.032, 6, false), tawnyMat));
      const tuft = new THREE.Mesh(new THREE.SphereGeometry(0.075, 6, 5), maneMat);
      tuft.position.set(0, 0.84, -1.16);
      bodyGroup.add(tuft);
      break;
    }

    case 'predator_bear': {
      // Smooth sculpted hulking dark-brown Mountain Bear fallback (organic rounded shoulders & haunches!)
      const bearFur = getMat(0x523620, 0.94, 0.02);
      const snoutMat = getMat(0x7c5838, 0.9, 0.02);
      const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.48, 0.82, 8, 12), bearFur);
      torso.rotation.x = Math.PI / 2;
      torso.position.set(0, 0.92, 0);
      torso.castShadow = true;
      bodyGroup.add(torso);
      const hump = new THREE.Mesh(new THREE.SphereGeometry(0.42, 8, 7), bearFur);
      hump.position.set(0, 1.12, 0.36);
      bodyGroup.add(hump);
      for (const [lx, lz] of [[-0.29, 0.48], [0.29, 0.48], [-0.29, -0.48], [0.29, -0.48]]) {
        addCyl(bodyGroup, 0.1, 0.13, 0.62, 8, lx, 0.31, lz, bearFur);
      }
      const bHead = new THREE.Mesh(new THREE.SphereGeometry(0.36, 9, 8), bearFur);
      bHead.position.set(0, 1.12, 0.88);
      bHead.castShadow = true;
      bodyGroup.add(bHead);
      const bSnout = new THREE.Mesh(new THREE.CapsuleGeometry(0.11, 0.16, 5, 7), snoutMat);
      bSnout.rotation.x = Math.PI / 2;
      bSnout.position.set(0, 1.04, 1.22);
      bodyGroup.add(bSnout);
      for (const ex of [-0.22, 0.22]) {
        const ear = new THREE.Mesh(new THREE.SphereGeometry(0.085, 6, 5), bearFur);
        ear.position.set(ex, 1.42, 0.82);
        bodyGroup.add(ear);
      }
      break;
    }

    case 'wild_eagle':
    case 'wild_seagull': {
      // Graceful articulated soaring bird fallback with flapping wings!
      const isGull = templateId === 'wild_seagull';
      const bodyMat = getMat(isGull ? 0xf8fafc : 0x5c3c22, 0.8, 0.02);
      const wingTipMat = getMat(isGull ? 0x334155 : 0x3b2414, 0.85, 0.02);
      const beakMat = getMat(0xf59e0b, 0.5, 0.05);

      const bTorso = new THREE.Mesh(new THREE.CapsuleGeometry(isGull ? 0.1 : 0.14, isGull ? 0.34 : 0.48, 6, 8), bodyMat);
      bTorso.rotation.x = Math.PI / 2;
      bTorso.castShadow = true;
      bodyGroup.add(bTorso);
      const bHead = new THREE.Mesh(new THREE.SphereGeometry(isGull ? 0.095 : 0.12, 7, 6), bodyMat);
      bHead.position.set(0, 0.04, isGull ? 0.26 : 0.34);
      bodyGroup.add(bHead);
      const beak = new THREE.Mesh(new THREE.ConeGeometry(0.035, 0.14, 5), beakMat);
      beak.rotation.x = Math.PI / 2;
      beak.position.set(0, 0.02, isGull ? 0.38 : 0.48);
      bodyGroup.add(beak);
      const tailFan = new THREE.Mesh(new THREE.ConeGeometry(isGull ? 0.14 : 0.2, isGull ? 0.28 : 0.38, 4), wingTipMat);
      tailFan.rotation.x = -Math.PI / 2;
      tailFan.scale.set(1.2, 1, 0.2);
      tailFan.position.set(0, 0, isGull ? -0.34 : -0.46);
      bodyGroup.add(tailFan);

      const span = isGull ? 0.72 : 1.05;
      const leftWing = new THREE.Group();
      const lInner = new THREE.Mesh(new THREE.SphereGeometry(0.24, 7, 5), bodyMat);
      lInner.scale.set(span * 1.4, 0.12, 0.75);
      lInner.position.set(-span * 0.45, 0, 0.02);
      lInner.castShadow = true;
      const lOuter = new THREE.Mesh(new THREE.SphereGeometry(0.18, 6, 5), wingTipMat);
      lOuter.scale.set(span * 1.0, 0.1, 0.55);
      lOuter.position.set(-span * 0.92, 0, -0.05);
      leftWing.add(lInner, lOuter);
      bodyGroup.add(leftWing);
      parts.leftWing = leftWing;

      const rightWing = new THREE.Group();
      const rInner = new THREE.Mesh(new THREE.SphereGeometry(0.24, 7, 5), bodyMat);
      rInner.scale.set(span * 1.4, 0.12, 0.75);
      rInner.position.set(span * 0.45, 0, 0.02);
      rInner.castShadow = true;
      const rOuter = new THREE.Mesh(new THREE.SphereGeometry(0.18, 6, 5), wingTipMat);
      rOuter.scale.set(span * 1.0, 0.1, 0.55);
      rOuter.position.set(span * 0.92, 0, -0.05);
      rightWing.add(rInner, rOuter);
      bodyGroup.add(rightWing);
      parts.rightWing = rightWing;
      break;
    }

    case 'sea_monster': {
      // Authentic Prehistoric Sea Plesiosaur (深海蛇頸龍): extra-long graceful S-curved tapering neck,
      // sleek reptilian plesiosaur head, broad streamlined barrel torso, 4 huge wing-like flippers & tapered tail!
      const mats = getAquaticMonsterMaterials('dragon');
      const coils: THREE.Object3D[] = [];

      // Graceful extra-long slender S-curved Plesiosaur neck rising high above the water
      const neckGroup = new THREE.Group();
      const neckCurve = new THREE.CatmullRomCurve3([
        new THREE.Vector3(0, 0.05, 0.72),
        new THREE.Vector3(0, 1.05, 1.38),
        new THREE.Vector3(0, 2.25, 1.05),
        new THREE.Vector3(0, 3.22, 1.48),
      ]);
      // Tapered segments along the long neck so base is thick & neck narrows smoothly toward the small head
      const neckPts = neckCurve.getPoints(12);
      for (let ni = 0; ni < neckPts.length - 1; ni++) {
        const a = neckPts[ni];
        const b = neckPts[ni + 1];
        const t0 = ni / (neckPts.length - 1);
        const t1 = (ni + 1) / (neckPts.length - 1);
        const r0 = 0.38 * (1 - t0 * 0.56);
        const r1 = 0.38 * (1 - t1 * 0.56);
        const segLen = a.distanceTo(b) + 0.06;
        const seg = new THREE.Mesh(new THREE.CylinderGeometry(r1, r0, segLen, 10), mats.primary);
        seg.position.copy(a).lerp(b, 0.5);
        seg.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), new THREE.Vector3().subVectors(b, a).normalize());
        seg.castShadow = true;
        neckGroup.add(seg);
      }
      // Smooth pale cream under-throat stripe
      const throatCurve = new THREE.CatmullRomCurve3([
        new THREE.Vector3(0, 0.08, 0.98),
        new THREE.Vector3(0, 1.06, 1.62),
        new THREE.Vector3(0, 2.18, 1.24),
        new THREE.Vector3(0, 3.05, 1.56),
      ]);
      const throatMesh = new THREE.Mesh(new THREE.TubeGeometry(throatCurve, 12, 0.12, 7, false), mats.secondary);
      neckGroup.add(throatMesh);

      // Sleek, streamlined small Plesiosaur head & slender snout (NO dragon horns/whiskers!)
      const sHead = new THREE.Mesh(new THREE.SphereGeometry(0.27, 10, 8), mats.primary);
      sHead.scale.set(0.84, 0.68, 1.72);
      sHead.position.set(0, 3.28, 1.76);
      sHead.castShadow = true;
      neckGroup.add(sHead);
      const snout = new THREE.Mesh(new THREE.CapsuleGeometry(0.12, 0.42, 5, 8), mats.primary);
      snout.rotation.x = Math.PI * 0.52;
      snout.position.set(0, 3.22, 2.18);
      neckGroup.add(snout);
      const jaw = new THREE.Mesh(new THREE.CapsuleGeometry(0.1, 0.36, 5, 7), mats.secondary);
      jaw.rotation.x = Math.PI * 0.55;
      jaw.position.set(0, 3.06, 2.08);
      neckGroup.add(jaw);

      for (const sx of [-0.17, 0.17]) {
        const eye = new THREE.Mesh(new THREE.SphereGeometry(0.06, 8, 6), mats.eye);
        eye.position.set(sx, 3.35, 1.92);
        neckGroup.add(eye);
      }
      bodyGroup.add(neckGroup);
      coils.push(neckGroup);

      // Broad, smooth, turtle-like barrel Plesiosaur body rising cleanly from the waves
      const torsoGroup = new THREE.Group();
      const torso = new THREE.Mesh(new THREE.SphereGeometry(1.18, 16, 12), mats.primary);
      torso.scale.set(1.06, 0.62, 1.52);
      torso.position.set(0, 0.22, -0.35);
      torso.castShadow = true;
      torsoGroup.add(torso);
      const underBelly = new THREE.Mesh(new THREE.SphereGeometry(1.02, 12, 8), mats.secondary);
      underBelly.scale.set(0.95, 0.42, 1.38);
      underBelly.position.set(0, -0.05, -0.35);
      torsoGroup.add(underBelly);
      bodyGroup.add(torsoGroup);
      coils.push(torsoGroup);

      // 4 iconic large wing-like swimming Plesiosaur paddle flippers (2 front, 2 rear)!
      for (const [fx, fz, fLen, fWid] of [
        [-1.08, 0.32, 1.85, 0.62],
        [1.08, 0.32, 1.85, 0.62],
        [-0.95, -1.15, 1.58, 0.54],
        [0.95, -1.15, 1.58, 0.54],
      ] as const) {
        const side = fx > 0 ? 1 : -1;
        const flipGroup = new THREE.Group();
        flipGroup.position.set(fx, 0.08, fz);
        const flipper = new THREE.Mesh(new THREE.SphereGeometry(0.55, 10, 7), mats.primary);
        flipper.scale.set(fLen, 0.15, fWid);
        flipper.position.set(side * (fLen * 0.44), -0.04, -0.18);
        flipper.rotation.set(0.08, side * -0.42, side * -0.12);
        flipper.castShadow = true;
        flipGroup.add(flipper);
        bodyGroup.add(flipGroup);
        coils.push(flipGroup);
      }

      // Smoothly tapered swimming Plesiosaur tail trailing behind the body
      const tailGroup = new THREE.Group();
      const tailCurve = new THREE.CatmullRomCurve3([
        new THREE.Vector3(0, 0.12, -1.75),
        new THREE.Vector3(0, 0.28, -2.55),
        new THREE.Vector3(0, 0.04, -3.45),
      ]);
      const tailMesh = new THREE.Mesh(new THREE.TubeGeometry(tailCurve, 10, 0.18, 8, false), mats.primary);
      tailGroup.add(tailMesh);
      const tailTip = new THREE.Mesh(new THREE.ConeGeometry(0.14, 0.95, 7), mats.primary);
      tailTip.position.set(0, 0.04, -3.85);
      tailTip.rotation.x = -Math.PI * 0.5;
      tailGroup.add(tailTip);
      bodyGroup.add(tailGroup);
      coils.push(tailGroup);

      parts.seaMonsterCoils = coils;

      // Concentric water wake ripples around the swimming Plesiosaur
      const rippleMeshes: THREE.Mesh[] = [];
      for (let r = 0; r < 2; r++) {
        const ringGeom = new THREE.RingGeometry(1.42 + r * 0.68, 1.66 + r * 0.72, 28);
        ringGeom.rotateX(-Math.PI / 2);
        const ringMat = new THREE.MeshBasicMaterial({
          color: 0xdcfce7,
          transparent: true,
          opacity: 0.52,
          side: THREE.DoubleSide,
          depthWrite: false,
        });
        const ring = new THREE.Mesh(ringGeom, ringMat);
        ring.position.y = 0.14;
        bodyGroup.add(ring);
        rippleMeshes.push(ring);
      }
      parts.rippleMeshes = rippleMeshes;
      break;
    }

    case 'sea_kraken': {
      // Textured Colossal Giant Octopus / Kraken (深海大章魚) with bulbous mottled mantle & 8 suction-cupped tentacles!
      const mats = getAquaticMonsterMaterials('kraken');
      const coils: THREE.Object3D[] = [];

      // Central bulbous octopus mantle head + brow ridges + fierce glowing eyes
      const headGroup = new THREE.Group();
      const mantle = new THREE.Mesh(new THREE.SphereGeometry(0.95, 16, 12), mats.primary);
      mantle.scale.set(0.92, 1.24, 1.08);
      mantle.position.set(0, 1.25, -0.15);
      mantle.rotation.x = -0.22;
      mantle.castShadow = true;
      headGroup.add(mantle);

      const collar = new THREE.Mesh(new THREE.SphereGeometry(0.72, 12, 10), mats.primary);
      collar.scale.set(1.08, 0.72, 1.02);
      collar.position.set(0, 0.42, 0.18);
      headGroup.add(collar);

      for (const sx of [-1, 1]) {
        const brow = new THREE.Mesh(new THREE.SphereGeometry(0.24, 8, 6), mats.primary);
        brow.scale.set(1.1, 0.75, 1.2);
        brow.position.set(sx * 0.46, 0.88, 0.64);
        headGroup.add(brow);
        const eye = new THREE.Mesh(new THREE.SphereGeometry(0.14, 8, 8), mats.eye);
        eye.position.set(sx * 0.48, 0.82, 0.76);
        headGroup.add(eye);
        // Side mantle ear-fins
        const fin = new THREE.Mesh(new THREE.CircleGeometry(0.42, 8), mats.accent);
        fin.scale.set(1.2, 0.7, 1);
        fin.position.set(sx * 0.82, 1.65, -0.35);
        fin.rotation.set(0.2, sx * 0.4, sx * -0.5);
        headGroup.add(fin);
      }
      bodyGroup.add(headGroup);
      coils.push(headGroup);

      // 8 sweeping, textured, curling octopus tentacles studded with pale suction cups!
      for (let ti = 0; ti < 8; ti++) {
        const ang = (ti / 8) * Math.PI * 2 + Math.PI / 8;
        const reach = ti % 2 === 0 ? 2.15 : 1.78;
        const peakY = ti % 2 === 0 ? 2.25 : 1.65;
        const tGroup = new THREE.Group();
        const ca = Math.cos(ang);
        const sa = Math.sin(ang);
        const curve = new THREE.CatmullRomCurve3([
          new THREE.Vector3(ca * 0.45, -0.15, sa * 0.45),
          new THREE.Vector3(ca * (reach * 0.62), peakY * 0.55, sa * (reach * 0.62)),
          new THREE.Vector3(ca * reach, peakY * 0.92, sa * reach),
          new THREE.Vector3(ca * (reach * 0.78), peakY * 1.08, sa * (reach * 0.78)),
          new THREE.Vector3(ca * (reach * 0.94), peakY * 0.82, sa * (reach * 0.94)),
        ]);
        const armMesh = new THREE.Mesh(new THREE.TubeGeometry(curve, 16, 0.17, 8, false), mats.primary);
        armMesh.castShadow = true;
        tGroup.add(armMesh);

        // Pale textured suction-cup pads along inner underside of each tentacle
        for (const u of [0.28, 0.46, 0.64, 0.8]) {
          const pt = curve.getPoint(u);
          const sucker = new THREE.Mesh(new THREE.SphereGeometry(0.11 * (1.15 - u * 0.5), 7, 6), mats.secondary);
          sucker.position.set(pt.x - ca * 0.11, pt.y - 0.05, pt.z - sa * 0.11);
          tGroup.add(sucker);
        }
        bodyGroup.add(tGroup);
        coils.push(tGroup);
      }
      parts.seaMonsterCoils = coils;

      // Swirling ocean foam rings around the Kraken
      const rippleMeshes: THREE.Mesh[] = [];
      for (let r = 0; r < 2; r++) {
        const ringGeom = new THREE.RingGeometry(1.55 + r * 0.7, 1.85 + r * 0.76, 30);
        ringGeom.rotateX(-Math.PI / 2);
        const ringMat = new THREE.MeshBasicMaterial({
          color: 0xe0f2fe,
          transparent: true,
          opacity: 0.55,
          side: THREE.DoubleSide,
          depthWrite: false,
        });
        const ring = new THREE.Mesh(ringGeom, ringMat);
        ring.position.y = 0.14;
        bodyGroup.add(ring);
        rippleMeshes.push(ring);
      }
      parts.rippleMeshes = rippleMeshes;
      break;
    }

    case 'lake_nessie': {
      // Textured Loch Ness Plesiosaur (湖中水怪 / 尼斯湖水怪) with graceful long S-neck, broad mottled back hump & 4 flippers!
      const mats = getAquaticMonsterMaterials('nessie');
      const coils: THREE.Object3D[] = [];

      // Graceful towering curved S-neck & sleek ancient plesiosaur head
      const neckGroup = new THREE.Group();
      const neckCurve = new THREE.CatmullRomCurve3([
        new THREE.Vector3(0, -0.15, 0.45),
        new THREE.Vector3(0, 0.95, 0.92),
        new THREE.Vector3(0, 2.05, 0.68),
        new THREE.Vector3(0, 2.82, 1.05),
      ]);
      const neckMesh = new THREE.Mesh(new THREE.TubeGeometry(neckCurve, 18, 0.24, 10, false), mats.primary);
      neckMesh.castShadow = true;
      neckGroup.add(neckMesh);

      const throatCurve = new THREE.CatmullRomCurve3([
        new THREE.Vector3(0, 0.0, 0.68),
        new THREE.Vector3(0, 1.02, 1.12),
        new THREE.Vector3(0, 1.98, 0.88),
        new THREE.Vector3(0, 2.66, 1.18),
      ]);
      const throatMesh = new THREE.Mesh(new THREE.TubeGeometry(throatCurve, 12, 0.12, 7, false), mats.secondary);
      neckGroup.add(throatMesh);

      // Sleek elongated plesiosaur head & gentle snout
      const head = new THREE.Mesh(new THREE.SphereGeometry(0.28, 10, 8), mats.primary);
      head.scale.set(0.86, 0.72, 1.65);
      head.position.set(0, 2.86, 1.32);
      head.castShadow = true;
      neckGroup.add(head);
      const snout = new THREE.Mesh(new THREE.CapsuleGeometry(0.13, 0.34, 5, 7), mats.primary);
      snout.rotation.x = Math.PI * 0.52;
      snout.position.set(0, 2.8, 1.66);
      neckGroup.add(snout);
      for (const sx of [-0.18, 0.18]) {
        const eye = new THREE.Mesh(new THREE.SphereGeometry(0.06, 7, 6), mats.eye);
        eye.position.set(sx, 2.94, 1.46);
        neckGroup.add(eye);
        const crest = new THREE.Mesh(new THREE.ConeGeometry(0.045, 0.22, 5), mats.accent);
        crest.position.set(sx * 0.7, 3.06, 1.12);
        crest.rotation.x = -0.7;
        neckGroup.add(crest);
      }
      bodyGroup.add(neckGroup);
      coils.push(neckGroup);

      // Iconic broad rounded Loch Ness back hump emerging smoothly through lake surface
      const humpGroup = new THREE.Group();
      const bodyHump = new THREE.Mesh(new THREE.SphereGeometry(0.95, 14, 10), mats.primary);
      bodyHump.scale.set(0.95, 0.68, 1.42);
      bodyHump.position.set(0, 0.18, -0.55);
      bodyHump.castShadow = true;
      humpGroup.add(bodyHump);
      // Secondary smaller trailing arch
      const rearHump = new THREE.Mesh(new THREE.SphereGeometry(0.46, 10, 8), mats.primary);
      rearHump.scale.set(0.82, 0.62, 1.25);
      rearHump.position.set(0, 0.12, -2.05);
      humpGroup.add(rearHump);
      bodyGroup.add(humpGroup);
      coils.push(humpGroup);

      // Trailing tapered plesiosaur tail breaking the lake surface
      const tailGroup = new THREE.Group();
      const tailCurve = new THREE.CatmullRomCurve3([
        new THREE.Vector3(0, -0.1, -2.1),
        new THREE.Vector3(0, 0.36, -2.68),
        new THREE.Vector3(0, 0.05, -3.35),
      ]);
      const tailMesh = new THREE.Mesh(new THREE.TubeGeometry(tailCurve, 10, 0.14, 8, false), mats.primary);
      tailGroup.add(tailMesh);
      bodyGroup.add(tailGroup);
      coils.push(tailGroup);

      // 4 diamond-shaped paddling plesiosaur flippers
      for (const [fx, fz] of [[-0.85, 0.05], [0.85, 0.05], [-0.72, -1.25], [0.72, -1.25]] as const) {
        const flipGroup = new THREE.Group();
        flipGroup.position.set(fx, 0.02, fz);
        const flipper = new THREE.Mesh(new THREE.SphereGeometry(0.42, 8, 6), mats.primary);
        flipper.scale.set(1.55, 0.16, 0.65);
        flipper.position.set(fx > 0 ? 0.35 : -0.35, -0.05, -0.1);
        flipper.rotation.y = fx > 0 ? -0.35 : 0.35;
        flipGroup.add(flipper);
        bodyGroup.add(flipGroup);
        coils.push(flipGroup);
      }
      parts.seaMonsterCoils = coils;

      // Soft misty lake ripples around Nessie
      const rippleMeshes: THREE.Mesh[] = [];
      for (let r = 0; r < 2; r++) {
        const ringGeom = new THREE.RingGeometry(1.15 + r * 0.58, 1.38 + r * 0.62, 28);
        ringGeom.rotateX(-Math.PI / 2);
        const ringMat = new THREE.MeshBasicMaterial({
          color: 0xd1fae5,
          transparent: true,
          opacity: 0.48,
          side: THREE.DoubleSide,
          depthWrite: false,
        });
        const ring = new THREE.Mesh(ringGeom, ringMat);
        ring.position.y = 0.13;
        bodyGroup.add(ring);
        rippleMeshes.push(ring);
      }
      parts.rippleMeshes = rippleMeshes;
      break;
    }

    case 'tunnel_portal': {
      // Rugged Mountain Tunnel Portal carved into rock with cut-stone arch, timber beams & glowing torch lantern!
      const rockMat = getTexMat('terrain/cliff.png', 'terrain/cliff_norm.png', 0x9c9488, 1.5, 1.4, 0.95, 0.03);
      const archStone = getTexMat('textures/stone_aegean_01.png', 'textures/stone_india_01_norm.png', 0xd8d0be, 1.4, 1.4, 0.92, 0.04);
      const darkVoidMat = new THREE.MeshBasicMaterial({ color: 0x090b0f });
      const torchMat = new THREE.MeshStandardMaterial({
        color: 0xffb703,
        emissive: 0xff7b00,
        emissiveIntensity: 1.8,
        roughness: 0.3,
      });

      // Massive sculpted cliff rock mound housing the tunnel entrance
      addBox(bodyGroup, 4.1, 2.75, 2.9, 0, 1.32, -0.35, rockMat);
      const topRock = new THREE.Mesh(new THREE.DodecahedronGeometry(1.85, 0), rockMat);
      topRock.position.set(0, 2.55, -0.55);
      topRock.scale.set(1.25, 0.72, 0.92);
      topRock.castShadow = true;
      bodyGroup.add(topRock);
      // Cut-stone portal piers, lintel arch & heavy timber shoring frame (+Z facing entrance)
      addBox(bodyGroup, 0.65, 2.15, 0.75, -1.12, 1.08, 1.05, archStone);
      addBox(bodyGroup, 0.65, 2.15, 0.75, 1.12, 1.08, 1.05, archStone);
      addBox(bodyGroup, 3.05, 0.52, 0.82, 0, 2.28, 1.05, archStone);
      addBox(bodyGroup, 2.95, 0.24, 0.36, 0, 2.02, 1.35, woodMat);
      addBox(bodyGroup, 0.24, 1.95, 0.32, -0.82, 0.98, 1.32, woodMat);
      addBox(bodyGroup, 0.24, 1.95, 0.32, 0.82, 0.98, 1.32, woodMat);
      // Deep dark recessed tunnel passage
      addBox(bodyGroup, 1.42, 1.92, 0.6, 0, 0.96, 1.02, darkVoidMat, false);
      // Glowing warm torch lantern inside the tunnel mouth + team banner sign
      const lantern = new THREE.Mesh(new THREE.OctahedronGeometry(0.18, 0), torchMat);
      lantern.position.set(-0.55, 1.55, 1.38);
      bodyGroup.add(lantern);
      const tFlag = addBox(bodyGroup, 0.9, 0.44, 0.1, 0, 2.68, 1.38, teamMat);
      teamMeshes.push(tFlag);
      break;
    }

    case 'ancient_ruin_pillar': {
      // Harvestable Ancient Weathered Stone Temple Ruin Column (workers dismantle this for Stone!)
      const pavingMat = getTexMat('textures/decal_stone_medit_01.png', 'textures/decal_stone_medit_01_norm.png', 0xd4cbb8, 1.6, 1.6, 0.94, 0.03);
      const colStone = getTexMat('textures/stone_aegean_01.png', 'textures/stone_india_01_norm.png', 0xdad2c0, 1.3, 1.8, 0.93, 0.04);

      // Two-stepped ancient stylobate platform deeply embedded into slopes
      addBox(bodyGroup, 2.35, 0.56, 2.35, 0, 0.04, 0, pavingMat);
      addBox(bodyGroup, 1.78, 0.28, 1.78, 0, 0.38, 0, pavingMat);
      // Square column plinth + 12-seg fluted weathered limestone shaft + Doric abacus capital
      addBox(bodyGroup, 0.88, 0.24, 0.88, 0, 0.62, 0, colStone);
      addCyl(bodyGroup, 0.34, 0.42, 2.55, 12, 0, 1.98, 0, colStone);
      addBox(bodyGroup, 0.96, 0.24, 0.96, 0, 3.34, 0, colStone);
      // Broken lintel slab & tumbled stone drum beside the pillar base
      const lintel = addBox(bodyGroup, 1.35, 0.34, 0.66, 0.22, 3.62, 0, colStone);
      lintel.rotation.z = -0.06;
      const fallenDrum = addCyl(bodyGroup, 0.32, 0.34, 0.95, 10, 0.88, 0.34, 0.68, colStone);
      fallenDrum.rotation.set(Math.PI * 0.5, 0.55, 0.15);
      addBox(bodyGroup, 0.48, 0.32, 0.42, -0.82, 0.22, 0.72, colStone);
      break;
    }

    case 'tree_cedar': {
      // Majestic Lebanon Cedar (黎巴嫩雪松) — stout reddish-brown trunk + wide flat-tiered dark evergreen boughs!
      const barkMat = getMat(0x5c3d28, 0.94, 0.02);
      const cedarLeaf = getMat(0x214a32, 0.88, 0.02);
      const cedarTip = getMat(0x2d6140, 0.86, 0.02);
      addCyl(bodyGroup, 0.22, 0.36, 3.6, 8, 0, 1.8, 0, barkMat);
      for (const [ty, rad, h, mat] of [
        [2.3, 1.75, 0.58, cedarLeaf],
        [3.15, 1.5, 0.54, cedarTip],
        [3.95, 1.15, 0.48, cedarLeaf],
        [4.55, 0.72, 0.42, cedarTip],
      ] as const) {
        const tier = new THREE.Mesh(new THREE.CylinderGeometry(rad * 0.72, rad, h, 9), mat);
        tier.position.set(0, ty, 0);
        tier.castShadow = true;
        bodyGroup.add(tier);
      }
      break;
    }

    case 'tree_willow': {
      // Graceful Weeping Willow (河岸垂柳) — pale furrowed trunk + cascading emerald drooping frond curtains!
      const barkMat = getMat(0x6e5d4a, 0.92, 0.02);
      const willowLeaf = getMat(0x5b9a47, 0.86, 0.02);
      const willowDrape = getMat(0x73b558, 0.88, 0.02);
      addCyl(bodyGroup, 0.18, 0.3, 2.35, 8, 0, 1.18, 0, barkMat);
      const crown = new THREE.Mesh(new THREE.SphereGeometry(1.18, 10, 8), willowLeaf);
      crown.scale.set(1.15, 0.85, 1.15);
      crown.position.set(0, 2.85, 0);
      crown.castShadow = true;
      bodyGroup.add(crown);
      // 8 drooping weeping willow curtains around the crown
      for (let wi = 0; wi < 8; wi++) {
        const ang = (wi / 8) * Math.PI * 2;
        const drape = new THREE.Mesh(new THREE.ConeGeometry(0.32, 2.15, 6), willowDrape);
        drape.position.set(Math.cos(ang) * 0.92, 1.85, Math.sin(ang) * 0.92);
        drape.rotation.z = Math.cos(ang) * 0.14;
        drape.rotation.x = -Math.sin(ang) * 0.14;
        drape.castShadow = true;
        bodyGroup.add(drape);
      }
      break;
    }

    case 'tree_apple':
    case 'tree_orange':
    case 'tree_fig': {
      // Sunlit Fruit Orchard Tree (蘋果樹 / 柑橘樹 / 無花果樹) — lush leafy crown heavily laden with bright harvestable fruit!
      const isApple = templateId === 'tree_apple';
      const isOrange = templateId === 'tree_orange';
      const barkMat = getMat(isApple ? 0x6b4428 : isOrange ? 0x5c3e26 : 0x7a6e63, 0.92, 0.02);
      const leafMat = getMat(isApple ? 0x3f8c35 : isOrange ? 0x266b32 : 0x3b6e3c, 0.85, 0.02);
      const leafLight = getMat(isApple ? 0x52a842 : isOrange ? 0x35823d : 0x4c8248, 0.85, 0.02);
      const fruitMat = new THREE.MeshStandardMaterial({
        color: isApple ? 0xdc2626 : isOrange ? 0xf97316 : 0x7e22ce,
        emissive: isApple ? 0x7f1d1d : isOrange ? 0x9a3412 : 0x3b0764,
        emissiveIntensity: 0.25,
        roughness: 0.32,
        metalness: 0.05,
      });

      addCyl(bodyGroup, 0.16, 0.26, 2.1, 8, 0, 1.05, 0, barkMat);
      // Multi-lobe orchard foliage canopy
      for (const [cx, cy, cz, cr, m] of [
        [0, 2.55, 0, 1.08, leafMat],
        [0.62, 2.28, 0.42, 0.72, leafLight],
        [-0.62, 2.32, 0.35, 0.74, leafMat],
        [0.25, 2.3, -0.64, 0.72, leafLight],
        [-0.38, 2.48, -0.52, 0.68, leafMat],
      ] as const) {
        const puff = new THREE.Mesh(new THREE.DodecahedronGeometry(cr, 1), m);
        puff.position.set(cx, cy, cz);
        puff.castShadow = true;
        bodyGroup.add(puff);
      }
      // 14 plump visible fruits clustered around the outer foliage so players immediately recognize Fruit Trees!
      const fruitGeom = new THREE.SphereGeometry(isApple || isOrange ? 0.14 : 0.13, 7, 6);
      for (let fi = 0; fi < 14; fi++) {
        const ang = fi * 2.39996;
        const elev = 1.95 + (fi % 4) * 0.34;
        const rad = 0.88 + (fi % 3) * 0.16;
        const fruit = new THREE.Mesh(fruitGeom, fruitMat);
        fruit.position.set(Math.cos(ang) * rad, elev, Math.sin(ang) * rad);
        bodyGroup.add(fruit);
      }
      break;
    }

    case 'tree_date_palm': {
      // Fruiting Oasis Date Palm (結果棗椰樹) — slender ringed curved palm + arching fronds + hanging golden date clusters!
      const trunkMat = getMat(0x8c6d46, 0.94, 0.02);
      const frondMat = getMat(0x4a8f3b, 0.86, 0.02);
      const dateMat = new THREE.MeshStandardMaterial({
        color: 0xd97706,
        emissive: 0x78350f,
        emissiveIntensity: 0.25,
        roughness: 0.38,
      });
      // Gently curved segmented palm trunk
      const palmCurve = new THREE.CatmullRomCurve3([
        new THREE.Vector3(0, 0, 0),
        new THREE.Vector3(0.18, 1.4, 0.08),
        new THREE.Vector3(0.32, 2.9, 0.12),
        new THREE.Vector3(0.24, 4.1, 0.06),
      ]);
      const trunk = new THREE.Mesh(new THREE.TubeGeometry(palmCurve, 10, 0.16, 7, false), trunkMat);
      trunk.castShadow = true;
      bodyGroup.add(trunk);
      // 8 sweeping palm fronds
      for (let fi = 0; fi < 8; fi++) {
        const ang = (fi / 8) * Math.PI * 2;
        const frond = new THREE.Mesh(new THREE.ConeGeometry(0.32, 2.1, 5), frondMat);
        frond.scale.set(1.0, 1.0, 0.28);
        frond.position.set(0.24 + Math.cos(ang) * 0.92, 4.02, 0.06 + Math.sin(ang) * 0.92);
        frond.rotation.set(0, -ang, -Math.PI * 0.42);
        frond.castShadow = true;
        bodyGroup.add(frond);
      }
      // 4 hanging golden date fruit clusters right beneath the palm crown!
      for (let di = 0; di < 4; di++) {
        const ang = (di / 4) * Math.PI * 2 + 0.4;
        const cluster = new THREE.Mesh(new THREE.SphereGeometry(0.24, 7, 6), dateMat);
        cluster.scale.set(0.85, 1.35, 0.85);
        cluster.position.set(0.24 + Math.cos(ang) * 0.42, 3.62, 0.06 + Math.sin(ang) * 0.42);
        bodyGroup.add(cluster);
      }
      break;
    }

    case 'treasure_chest':
    case 'treasure_amphora':
    case 'treasure_relic': {
      // Gleaming Ancient Wilderness Treasure (隨機寶藏) — ornate bronze-bound chest, gold coins, gems & floating sparkles!
      const chestWood = getMat(0x5c361e, 0.82, 0.08);
      const goldMat = new THREE.MeshStandardMaterial({
        color: 0xfacc15,
        emissive: 0xb45309,
        emissiveIntensity: 0.45,
        roughness: 0.25,
        metalness: 0.85,
      });
      const rubyMat = new THREE.MeshStandardMaterial({
        color: 0xef4444,
        emissive: 0x991b1b,
        emissiveIntensity: 0.55,
        roughness: 0.18,
        metalness: 0.2,
      });
      const emeraldMat = new THREE.MeshStandardMaterial({
        color: 0x10b981,
        emissive: 0x065f46,
        emissiveIntensity: 0.55,
        roughness: 0.18,
        metalness: 0.2,
      });
      const amphoraMat = getMat(0xc86a3d, 0.78, 0.05);

      // Low sunlit stone base slab so treasure sits crisply on slopes
      addBox(bodyGroup, 1.65, 0.18, 1.35, 0, 0.06, 0, getMat(0xb8ad98, 0.92, 0.03));

      // Ornate chest body + bronze/gold straps + half-open lid
      addBox(bodyGroup, 1.15, 0.58, 0.72, 0, 0.44, 0, chestWood);
      addBox(bodyGroup, 1.18, 0.09, 0.76, 0, 0.24, 0, goldMat);
      addBox(bodyGroup, 1.18, 0.09, 0.76, 0, 0.68, 0, goldMat);
      addBox(bodyGroup, 0.18, 0.22, 0.08, 0, 0.56, 0.37, goldMat);
      const lid = addBox(bodyGroup, 1.15, 0.22, 0.72, 0, 0.92, -0.26, chestWood);
      lid.rotation.x = -0.68;

      // Overflowing mound of gleaming gold coins & jewels
      const coinMound = new THREE.Mesh(new THREE.SphereGeometry(0.46, 10, 8), goldMat);
      coinMound.scale.set(1.15, 0.48, 0.72);
      coinMound.position.set(0, 0.76, 0.02);
      bodyGroup.add(coinMound);
      const ruby = new THREE.Mesh(new THREE.OctahedronGeometry(0.14, 0), rubyMat);
      ruby.position.set(-0.22, 0.92, 0.1);
      const emerald = new THREE.Mesh(new THREE.OctahedronGeometry(0.13, 0), emeraldMat);
      emerald.position.set(0.24, 0.9, 0.06);
      bodyGroup.add(ruby, emerald);

      // Flanking clay amphorae or golden chalice for extra silhouette richness
      if (templateId === 'treasure_amphora') {
        addCyl(bodyGroup, 0.16, 0.22, 0.68, 8, -0.78, 0.44, 0.18, amphoraMat);
        addCyl(bodyGroup, 0.14, 0.19, 0.58, 8, 0.78, 0.39, -0.1, amphoraMat);
      } else if (templateId === 'treasure_relic') {
        const crown = new THREE.Mesh(new THREE.TorusGeometry(0.24, 0.065, 8, 14), goldMat);
        crown.rotation.x = Math.PI * 0.5;
        crown.position.set(0, 1.06, 0.02);
        bodyGroup.add(crown);
      } else {
        addCyl(bodyGroup, 0.12, 0.1, 0.32, 8, 0.74, 0.3, 0.25, goldMat);
      }

      // Floating glowing golden shimmer sparkles so players spot treasures easily!
      const sparkleTex = getRealisticEmberTexture();
      const sparkles: THREE.Sprite[] = [];
      for (let si = 0; si < 4; si++) {
        const sMat = new THREE.SpriteMaterial({
          map: sparkleTex,
          color: 0xfef08a,
          transparent: true,
          opacity: 0.9,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
        });
        const sp = new THREE.Sprite(sMat);
        sp.position.set(Math.cos(si * 1.57) * 0.55, 1.15 + (si % 2) * 0.35, Math.sin(si * 1.57) * 0.55);
        sp.scale.set(0.36, 0.36, 1);
        bodyGroup.add(sp);
        sparkles.push(sp);
      }
      parts.sparkleSprites = sparkles;
      break;
    }

    case 'fish_shoal': {
      // Lively animated school of shimmering silver-turquoise Mediterranean fish + water surface ripples!
      const fishGroup = new THREE.Group();
      bodyGroup.add(fishGroup);
      parts.fishGroup = fishGroup;

      const fishMatA = new THREE.MeshStandardMaterial({
        color: 0x7dd3fc,
        emissive: 0x0e7490,
        emissiveIntensity: 0.35,
        roughness: 0.25,
        metalness: 0.65,
      });
      const fishMatB = new THREE.MeshStandardMaterial({
        color: 0xe0f2fe,
        emissive: 0x0369a1,
        emissiveIntensity: 0.3,
        roughness: 0.22,
        metalness: 0.72,
      });

      const count = 9;
      for (let i = 0; i < count; i++) {
        const ang = (i / count) * Math.PI * 2;
        const rad = 0.55 + (i % 3) * 0.42;
        const fishObj = new THREE.Group();
        const body = new THREE.Mesh(new THREE.ConeGeometry(0.11, 0.52, 5), i % 2 === 0 ? fishMatA : fishMatB);
        body.rotation.x = Math.PI / 2;
        body.scale.set(0.65, 1, 1.15);
        const tail = new THREE.Mesh(new THREE.ConeGeometry(0.1, 0.22, 3), i % 2 === 0 ? fishMatB : fishMatA);
        tail.rotation.x = -Math.PI / 2;
        tail.position.z = -0.32;
        tail.scale.set(0.45, 1, 1.2);
        fishObj.add(body, tail);
        fishObj.position.set(Math.cos(ang) * rad, -0.04 - (i % 2) * 0.08, Math.sin(ang) * rad);
        fishObj.rotation.y = -ang;
        fishGroup.add(fishObj);
      }

      // Subtle translucent surface ripples so Fish Shoals are immediately visible from RTS camera
      const rippleMeshes: THREE.Mesh[] = [];
      for (let r = 0; r < 2; r++) {
        const ringGeom = new THREE.RingGeometry(0.65 + r * 0.45, 0.8 + r * 0.48, 24);
        ringGeom.rotateX(-Math.PI / 2);
        const ringMat = new THREE.MeshBasicMaterial({
          color: 0xe0f7ff,
          transparent: true,
          opacity: 0.52,
          side: THREE.DoubleSide,
          depthWrite: false,
        });
        const ring = new THREE.Mesh(ringGeom, ringMat);
        ring.position.y = 0.15;
        bodyGroup.add(ring);
        rippleMeshes.push(ring);
      }
      parts.rippleMeshes = rippleMeshes;
      break;
    }

    case 'fishing_boat': {
      const hullMat = getTexMat('textures/hele_fishing_boat.png', null, 0xd9c7ad, 1.0, 1.0, 0.85, 0.03);
      const oarMat = getMat(0x6e4724, 0.86, 0.02);

      // Sleek Mediterranean rowing fishing skiff fallback matching official 0 A.D. hele_fishing_boat.dae
      const hull = new THREE.Mesh(new THREE.CapsuleGeometry(0.45, 1.85, 6, 10), hullMat);
      hull.rotation.x = Math.PI / 2;
      hull.scale.set(1.15, 1.0, 0.52);
      hull.position.set(0, 0.14, 0);
      hull.castShadow = true;
      bodyGroup.add(hull);
      // Curved prow & sternposts with team color trim
      const prow = addCyl(bodyGroup, 0.06, 0.14, 0.9, 6, 0, 0.56, 1.25, teamMat);
      prow.rotation.x = 0.42;
      const stern = addCyl(bodyGroup, 0.06, 0.12, 0.72, 6, 0, 0.48, -1.2, teamMat);
      stern.rotation.x = -0.38;
      teamMeshes.push(prow, stern);
      // Wooden fish basket + twin oars
      addCyl(bodyGroup, 0.22, 0.18, 0.34, 7, 0, 0.36, 0.48, getMat(0xb88b4a, 0.9, 0));
      const oarGroup = new THREE.Group();
      for (const side of [-1, 1]) {
        const oar = addCyl(oarGroup, 0.025, 0.035, 1.85, 5, side * 0.78, 0.24, -0.1, oarMat, false);
        oar.rotation.z = side * 1.15;
      }
      bodyGroup.add(oarGroup);
      parts.oarGroup = oarGroup;
      break;
    }

    case 'merchant_ship': {
      const hullMat = getMat(0x6e4423, 0.85, 0.04);
      const trimMat = getMat(0x9a6d3e, 0.86, 0.03);
      const amphoraMat = getMat(0xb85d38, 0.82, 0.04);
      const sailMat = new THREE.MeshStandardMaterial({ color: 0xfbf5e6, roughness: 0.76, side: THREE.DoubleSide });

      // Broad Mediterranean round-ship hull
      addBox(bodyGroup, 1.85, 0.78, 3.2, 0, 0.32, 0, hullMat);
      const prow = new THREE.Mesh(new THREE.ConeGeometry(0.96, 1.25, 4), hullMat);
      prow.rotation.x = Math.PI / 2;
      prow.rotation.y = Math.PI / 4;
      prow.scale.set(1.0, 1.0, 0.65);
      prow.position.set(0, 0.42, 2.1);
      prow.castShadow = true;
      bodyGroup.add(prow);
      addBox(bodyGroup, 1.55, 0.16, 2.75, 0, 0.68, 0, trimMat);
      // Aft deck cabin & amphora cargo
      addBox(bodyGroup, 1.28, 0.68, 0.95, 0, 1.02, -0.95, trimMat);
      addBox(bodyGroup, 1.4, 0.16, 1.05, 0, 1.42, -0.95, teamMat);
      addCyl(bodyGroup, 0.15, 0.2, 0.5, 6, -0.35, 0.95, 0.75, amphoraMat);
      addCyl(bodyGroup, 0.15, 0.2, 0.5, 6, 0.35, 0.95, 0.75, amphoraMat);

      // Tall mast & billowing striped square sail
      addCyl(bodyGroup, 0.07, 0.09, 3.4, 7, 0, 2.1, 0.2, hullMat);
      addCyl(bodyGroup, 0.05, 0.05, 2.65, 6, 0, 3.1, 0.28, hullMat).rotation.z = Math.PI / 2;
      const sail = new THREE.Mesh(new THREE.PlaneGeometry(2.4, 1.95), sailMat);
      sail.position.set(0, 2.18, 0.45);
      sail.castShadow = true;
      bodyGroup.add(sail);
      const band = addBox(bodyGroup, 2.42, 0.44, 0.08, 0, 2.18, 0.46, teamMat);
      const pennant = addBox(bodyGroup, 0.1, 0.4, 0.95, 0, 3.68, -0.25, teamMat);
      teamMeshes.push(band, pennant);
      break;
    }

    case 'warship_trireme': {
      // Iconic Mediterranean Trireme Warship with gleaming bronze ram, twin oar banks & billowing war sail!
      const hullMat = getMat(0x5d391d, 0.84, 0.06);
      const deckMat = getMat(0x8c633a, 0.86, 0.03);
      const sailMat = new THREE.MeshStandardMaterial({ color: 0xf7efe0, roughness: 0.74, side: THREE.DoubleSide });

      // Sleek elongated war galley hull
      addBox(bodyGroup, 1.65, 0.72, 4.6, 0, 0.32, 0, hullMat);
      addBox(bodyGroup, 1.38, 0.16, 4.2, 0, 0.68, 0, deckMat);
      // Pointed prow & gleaming bronze naval battering ram!
      const prow = new THREE.Mesh(new THREE.ConeGeometry(0.84, 1.6, 4), hullMat);
      prow.rotation.x = Math.PI / 2;
      prow.rotation.y = Math.PI / 4;
      prow.scale.set(1.0, 1.0, 0.65);
      prow.position.set(0, 0.42, 2.95);
      prow.castShadow = true;
      bodyGroup.add(prow);
      const ram = new THREE.Mesh(new THREE.ConeGeometry(0.28, 1.15, 5), bronzeMat);
      ram.rotation.x = Math.PI / 2;
      ram.position.set(0, 0.24, 3.85);
      ram.castShadow = true;
      bodyGroup.add(ram);

      // Curved stern aphlaston ornament
      const stern = addBox(bodyGroup, 0.55, 1.45, 0.26, 0, 1.1, -2.35, hullMat);
      stern.rotation.x = -0.32;
      const sternCrest = addBox(bodyGroup, 0.62, 0.36, 0.32, 0, 1.82, -2.55, teamMat);

      // Shields mounted along both gunwales
      for (let sz = -1.4; sz <= 1.5; sz += 0.72) {
        const sL = addCyl(bodyGroup, 0.24, 0.24, 0.06, 8, -0.86, 0.82, sz, teamMat);
        sL.rotation.z = Math.PI / 2;
        const sR = addCyl(bodyGroup, 0.24, 0.24, 0.06, 8, 0.86, 0.82, sz, teamMat);
        sR.rotation.z = Math.PI / 2;
        teamMeshes.push(sL, sR);
      }

      // Twin banks of animated rowing oars
      const oarGroup = new THREE.Group();
      bodyGroup.add(oarGroup);
      parts.oarGroup = oarGroup;
      for (let oz = -1.5; oz <= 1.5; oz += 0.6) {
        const oarL = addCyl(oarGroup, 0.03, 0.035, 1.85, 5, -1.45, 0.22, oz, deckMat, false);
        oarL.rotation.z = 1.25;
        const oarR = addCyl(oarGroup, 0.03, 0.035, 1.85, 5, 1.45, 0.22, oz, deckMat, false);
        oarR.rotation.z = -1.25;
      }

      // Tall main mast, square war sail & team battle banner
      addCyl(bodyGroup, 0.08, 0.1, 3.8, 7, 0, 2.25, 0.25, hullMat);
      addCyl(bodyGroup, 0.05, 0.05, 3.05, 6, 0, 3.35, 0.38, hullMat).rotation.z = Math.PI / 2;
      const sail = new THREE.Mesh(new THREE.PlaneGeometry(2.75, 2.1), sailMat);
      sail.position.set(0, 2.35, 0.55);
      sail.castShadow = true;
      bodyGroup.add(sail);
      const warStripe = addBox(bodyGroup, 2.78, 0.52, 0.08, 0, 2.35, 0.56, teamMat);
      const warFlag = addBox(bodyGroup, 0.09, 0.45, 1.15, 0, 3.98, -0.3, teamMat);
      teamMeshes.push(sternCrest, warStripe, warFlag);
      break;
    }

    case 'han_ministry': {
      // Traditional Han Dynasty Imperial Academy (漢代官署太學) with carved marble terrace,
      // vermilion lacquered colonnade & authentic double-tiered curved ceramic barrel-tile roofs (青瓦重簷歇山頂)!
      const terraceMat = getTexMat('textures/stonequarry_marble.png', 'textures/stone_india_01_norm.png', 0xe2dac9, 1.6, 1.2, 0.88, 0.04);
      const lacqRedMat = getTexMat('textures/palisade_main.png', null, 0xb82828, 1.2, 1.2, 0.65, 0.1);
      const roofTileMat = getTexMat(
        'textures/han_rooftile.png',
        'textures/han_rooftile_norm.png',
        0xdde6f0,
        3.2,
        1.4,
        0.58,
        0.16
      );
      const roofTileSideMat = getTexMat(
        'textures/han_rooftile.png',
        'textures/han_rooftile_norm.png',
        0xdde6f0,
        2.2,
        1.4,
        0.58,
        0.16
      );
      const ridgeSlateMat = getMat(0x2c3440, 0.62, 0.18);
      const eaveTimberMat = getMat(0x5c3620, 0.82, 0.04);
      const goldTrimMat = getMat(0xd4a437, 0.35, 0.72);

      // Helper: builds a traditional Han Dynasty concave hipped ceramic barrel-tile roof tier with upturned eaves & ridge beams!
      const addHanTiledRoofTier = (
        yBase: number,
        baseW: number,
        baseD: number,
        ridgeW: number,
        ridgeD: number,
        roofH: number
      ) => {
        const tier = new THREE.Group();
        tier.position.y = yBase;

        // Under-eave timber bracket fascia (斗拱簷口)
        addBox(tier, baseW * 0.92, 0.18, baseD * 0.92, 0, -0.06, 0, eaveTimberMat);

        // Front & Back concave tiled roof slopes (built in 2 pitch bands for authentic sweeping Han eaves!)
        const makeSlopeBand = (
          y0: number,
          y1: number,
          z0: number,
          z1: number,
          w0: number,
          w1: number,
          zSign: number,
          mat: THREE.Material
        ) => {
          const hw0 = w0 * 0.5;
          const hw1 = w1 * 0.5;
          const geom = new THREE.BufferGeometry();
          const verts = new Float32Array([
            -hw0, y0, zSign * z0,
            hw0, y0, zSign * z0,
            hw1, y1, zSign * z1,
            -hw1, y1, zSign * z1,
          ]);
          const uvs = new Float32Array([0, 0, 1, 0, 1, 1, 0, 1]);
          geom.setAttribute('position', new THREE.BufferAttribute(verts, 3));
          geom.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
          geom.setIndex(zSign > 0 ? [0, 1, 2, 0, 2, 3] : [0, 2, 1, 0, 3, 2]);
          geom.computeVertexNormals();
          const mesh = new THREE.Mesh(geom, mat);
          mesh.castShadow = true;
          mesh.receiveShadow = true;
          tier.add(mesh);
        };

        const makeSideBand = (
          y0: number,
          y1: number,
          x0: number,
          x1: number,
          d0: number,
          d1: number,
          xSign: number,
          mat: THREE.Material
        ) => {
          const hd0 = d0 * 0.5;
          const hd1 = d1 * 0.5;
          const geom = new THREE.BufferGeometry();
          const verts = new Float32Array([
            xSign * x0, y0, -hd0,
            xSign * x0, y0, hd0,
            xSign * x1, y1, hd1,
            xSign * x1, y1, -hd1,
          ]);
          const uvs = new Float32Array([0, 0, 1, 0, 1, 1, 0, 1]);
          geom.setAttribute('position', new THREE.BufferAttribute(verts, 3));
          geom.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
          geom.setIndex(xSign > 0 ? [0, 2, 1, 0, 3, 2] : [0, 1, 2, 0, 2, 3]);
          geom.computeVertexNormals();
          const mesh = new THREE.Mesh(geom, mat);
          mesh.castShadow = true;
          mesh.receiveShadow = true;
          tier.add(mesh);
        };

        const midY = roofH * 0.36;
        const midZ = baseD * 0.34 + ridgeD * 0.16;
        const midW = baseW * 0.72 + ridgeW * 0.28;
        const midX = baseW * 0.34 + ridgeW * 0.16;
        const midD = baseD * 0.72 + ridgeD * 0.28;

        for (const sgn of [1, -1]) {
          // Lower gentle sweeping eave band (飛簷緩坡) + upper steeper barrel-tile roof slope
          makeSlopeBand(0.02, midY, baseD * 0.5, midZ, baseW, midW, sgn, roofTileMat);
          makeSlopeBand(midY, roofH, midZ, ridgeD * 0.5, midW, ridgeW, sgn, roofTileMat);
          makeSideBand(0.02, midY, baseW * 0.5, midX, baseD, midD, sgn, roofTileSideMat);
          makeSideBand(midY, roofH, midX, ridgeW * 0.5, midD, ridgeD, sgn, roofTileSideMat);
        }

        // Solid dark cap under the ridge so no light leaks through seams
        if (ridgeW > 0.2 && ridgeD > 0.2) {
          addBox(tier, ridgeW + 0.08, 0.12, ridgeD + 0.08, 0, roofH - 0.04, 0, ridgeSlateMat);
        }

        // 4 diagonal ceramic hip ridges (垂脊) with upturned corner eave ornaments (翹角脊獸)
        for (const sx of [-1, 1]) {
          for (const sz of [-1, 1]) {
            const p0 = new THREE.Vector3(sx * baseW * 0.5, 0.06, sz * baseD * 0.5);
            const p1 = new THREE.Vector3(sx * ridgeW * 0.5, roofH + 0.04, sz * ridgeD * 0.5);
            const len = p0.distanceTo(p1);
            const hip = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.14, len), ridgeSlateMat);
            hip.position.copy(p0).add(p1).multiplyScalar(0.5);
            hip.lookAt(p1);
            hip.castShadow = true;
            tier.add(hip);
            // Upturned corner finial tip (飛簷翹角)
            const tip = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.14, 0.34), ridgeSlateMat);
            tip.position.set(sx * (baseW * 0.5 + 0.06), 0.12, sz * (baseD * 0.5 + 0.06));
            tip.rotation.y = Math.atan2(sx * baseW, sz * baseD);
            tip.rotation.x = -0.38;
            tier.add(tip);
          }
        }

        bodyGroup.add(tier);
      };

      // Two-tiered marble/stone platform with front ceremonial steps
      addBox(bodyGroup, 5.8, 0.45, 5.4, 0, 0.22, 0, darkStoneMat);
      addBox(bodyGroup, 5.1, 0.38, 4.7, 0, 0.62, 0, terraceMat);
      addBox(bodyGroup, 1.6, 0.32, 0.75, 0, 0.36, 2.75, terraceMat);

      // Main hall walls + vermilion perimeter columns
      addBox(bodyGroup, 3.9, 1.85, 3.3, 0, 1.72, -0.1, terraceMat);
      for (const cx of [-2.1, -0.75, 0.75, 2.1]) {
        addCyl(bodyGroup, 0.11, 0.12, 1.95, 8, cx, 1.75, 1.85, lacqRedMat);
        addCyl(bodyGroup, 0.11, 0.12, 1.95, 8, cx, 1.75, -1.95, lacqRedMat);
      }

      // Lower sweeping Han ceramic barrel-tile roof tier (下層重簷瓦頂)
      addHanTiledRoofTier(2.68, 5.75, 5.05, 3.1, 2.55, 1.08);

      // Upper lacquered gallery pavilion (二樓重簷閣樓)
      addBox(bodyGroup, 2.75, 0.92, 2.25, 0, 4.18, 0, lacqRedMat);
      addBox(bodyGroup, 2.86, 0.14, 2.36, 0, 3.74, 0, goldTrimMat);

      // Upper sweeping Han hip-and-gable ceramic tiled roof tier (上層歇山瓦頂) + main ridge & Chiwen finials (正脊鴟尾)
      addHanTiledRoofTier(4.62, 4.15, 3.45, 1.95, 0.24, 1.18);
      addBox(bodyGroup, 2.12, 0.2, 0.22, 0, 5.86, 0, ridgeSlateMat);
      addBox(bodyGroup, 1.95, 0.1, 0.12, 0, 5.98, 0, goldTrimMat);
      for (const fx of [-1.06, 1.06]) {
        const finial = addBox(bodyGroup, 0.18, 0.36, 0.2, fx, 6.02, 0, goldTrimMat);
        finial.rotation.z = fx < 0 ? 0.28 : -0.28;
      }

      // Red imperial lanterns, golden academy plaque & silk banner
      for (const lx of [-1.45, 1.45]) {
        const lan = new THREE.Mesh(new THREE.SphereGeometry(0.18, 7, 6), teamMat);
        lan.position.set(lx, 2.35, 1.95);
        bodyGroup.add(lan);
        teamMeshes.push(lan);
      }
      const plaque = addBox(bodyGroup, 1.25, 0.42, 0.12, 0, 2.48, 1.72, goldTrimMat);
      const flag = addBox(bodyGroup, 0.95, 0.58, 0.08, 2.35, 3.65, 2.1, teamMat);
      addCyl(bodyGroup, 0.045, 0.055, 3.4, 6, 1.85, 2.2, 2.1, woodMat);
      teamMeshes.push(plaque, flag);
      break;
    }

    case 'brit_kennel':
    case 'gaul_tavern': {
      // Iconic Celtic Thatched Roundhouse / Tribal Assembly Hall with real thatch, wattle plaster & timber textures!
      const thatchMat = getTexMat('textures/rooftiles_broken.png', null, 0xc9ab6d, 2.4, 1.8, 0.95, 0.0);
      const plasterMat = getTexMat('textures/hele_struct_b.png', 'textures/hele_struct_b_norm.png', 0xe3dac6, 1.8, 1.2, 0.9, 0.02);
      const timberMat = getTexMat('textures/palisade_main.png', null, 0x8a643d, 1.5, 1.5, 0.92, 0.02);

      addCyl(bodyGroup, 2.45, 2.6, 0.35, 14, 0, 0.18, 0, darkStoneMat);
      addCyl(bodyGroup, 2.15, 2.25, 1.85, 14, 0, 1.22, 0, plasterMat);
      const thatchRoof = new THREE.Mesh(new THREE.ConeGeometry(2.85, 2.1, 14), thatchMat);
      thatchRoof.position.set(0, 3.05, 0);
      thatchRoof.castShadow = true;
      bodyGroup.add(thatchRoof);
      // Timber doorway porch
      addBox(bodyGroup, 1.15, 1.45, 0.85, 0, 0.98, 2.15, timberMat);
      const porchRoof = addBox(bodyGroup, 1.45, 0.22, 1.05, 0, 1.82, 2.2, thatchMat);
      porchRoof.rotation.x = 0.22;
      // Painted Celtic round shields & war banners
      for (const sx of [-1.2, 1.2]) {
        const sh = addCyl(bodyGroup, 0.38, 0.38, 0.09, 10, sx, 1.25, 2.05, teamMat);
        sh.rotation.x = Math.PI / 2;
        teamMeshes.push(sh);
      }
      addCyl(bodyGroup, 0.045, 0.055, 3.8, 6, 2.25, 2.0, 1.65, timberMat);
      const celtFlag = addBox(bodyGroup, 1.05, 0.62, 0.08, 2.78, 3.55, 1.65, teamMat);
      teamMeshes.push(celtFlag);
      break;
    }

    case 'iber_monument': {
      // Iberian Stone Bull Monument with 0 A.D. weathered sandstone ashlar texture
      const warmStone = getTexMat('textures/stone_aegean_01.png', 'textures/stone_india_01_norm.png', 0xe2cfa9, 1.5, 1.5, 0.88, 0.04);
      addBox(bodyGroup, 5.2, 0.45, 5.2, 0, 0.22, 0, darkStoneMat);
      addBox(bodyGroup, 3.8, 1.4, 3.8, 0, 1.12, 0, warmStone);
      addBox(bodyGroup, 2.3, 1.85, 2.3, 0, 2.65, 0, warmStone);
      // Sculpted bronze Iberian Bull statue atop pedestal
      addBox(bodyGroup, 1.45, 0.72, 0.72, 0, 4.15, 0, bronzeMat);
      addBox(bodyGroup, 0.48, 0.48, 0.48, 0.82, 4.35, 0, bronzeMat);
      addBox(bodyGroup, 0.16, 0.48, 0.16, -0.5, 3.72, -0.22, bronzeMat);
      addBox(bodyGroup, 0.16, 0.48, 0.16, 0.5, 3.72, -0.22, bronzeMat);
      addBox(bodyGroup, 0.16, 0.48, 0.16, -0.5, 3.72, 0.22, bronzeMat);
      addBox(bodyGroup, 0.16, 0.48, 0.16, 0.5, 3.72, 0.22, bronzeMat);
      const trim = addBox(bodyGroup, 2.5, 0.35, 2.5, 0, 1.95, 0, teamMat);
      const banner = addBox(bodyGroup, 0.9, 1.4, 0.1, 0, 2.75, 1.22, teamMat);
      teamMeshes.push(trim, banner);
      break;
    }

    case 'kush_pyramid': {
      // Authentic steep-angled Meroitic Nubian Kushite Sandstone Pyramid with 0 A.D. sandstone ashlar texture!
      const sandstone = getTexMat('textures/stone_aegean_01.png', 'textures/stone_india_01_norm.png', 0xe0ba7d, 2.4, 2.4, 0.9, 0.04);
      const darkSand = getTexMat('textures/decal_stone_medit_01.png', 'textures/decal_stone_medit_01_norm.png', 0xc4985a, 2.0, 2.0, 0.92, 0.04);
      const goldCap = getMat(0xf2c94c, 0.3, 0.78);

      addBox(bodyGroup, 6.2, 0.42, 6.2, 0, 0.21, 0, darkSand);
      // Steep stepped Nubian pyramid body
      const pyr = new THREE.Mesh(new THREE.ConeGeometry(3.85, 5.8, 4), sandstone);
      pyr.position.set(0, 3.25, -0.25);
      pyr.rotation.y = Math.PI / 4;
      pyr.castShadow = true;
      pyr.receiveShadow = true;
      bodyGroup.add(pyr);
      // Golden pyramidion capstone
      const cap = new THREE.Mesh(new THREE.ConeGeometry(0.68, 1.0, 4), goldCap);
      cap.position.set(0, 5.75, -0.25);
      cap.rotation.y = Math.PI / 4;
      bodyGroup.add(cap);
      // Front Egyptian/Nubian pylon offering chapel (+Z)
      addBox(bodyGroup, 2.45, 2.1, 1.45, 0, 1.25, 2.35, sandstone);
      addBox(bodyGroup, 0.95, 1.4, 0.25, 0, 0.95, 3.05, getMat(0x2d2318));
      const frieze = addBox(bodyGroup, 2.6, 0.32, 0.16, 0, 2.1, 3.08, teamMat);
      const ob1 = addBox(bodyGroup, 0.38, 2.8, 0.38, -1.75, 1.6, 2.75, goldCap);
      const ob2 = addBox(bodyGroup, 0.38, 2.8, 0.38, 1.75, 1.6, 2.75, goldCap);
      teamMeshes.push(frieze, ob1, ob2);
      break;
    }

    case 'maur_pillar': {
      // Mauryan Pillar of Ashoka & Royal Elephant Pavilion with 0 A.D. stone & dome textures!
      const redSand = getTexMat('textures/stone_aegean_01.png', 'textures/stone_india_01_norm.png', 0xd07152, 1.8, 1.6, 0.85, 0.05);
      const creamStone = getTexMat('textures/stonequarry_marble.png', 'textures/stone_india_01_norm.png', 0xf2e6cc, 1.5, 1.5, 0.86, 0.03);
      const goldMat = getMat(0xeab308, 0.32, 0.72);

      addBox(bodyGroup, 5.8, 0.4, 5.4, 0, 0.2, 0, darkStoneMat);
      // Royal arched elephant pavilion
      addBox(bodyGroup, 3.8, 2.2, 3.2, -0.75, 1.45, -0.2, creamStone);
      const dome = new THREE.Mesh(new THREE.SphereGeometry(1.75, 12, 8, 0, Math.PI * 2, 0, Math.PI * 0.55), redSand);
      dome.position.set(-0.75, 2.5, -0.2);
      dome.castShadow = true;
      bodyGroup.add(dome);
      const finial = new THREE.Mesh(new THREE.ConeGeometry(0.28, 0.8, 8), goldMat);
      finial.position.set(-0.75, 4.45, -0.2);
      bodyGroup.add(finial);
      const archBanner = addBox(bodyGroup, 1.8, 0.42, 0.14, -0.75, 2.15, 1.46, teamMat);
      // Tall polished sandstone Pillar of Ashoka (+X)
      addCyl(bodyGroup, 0.48, 0.6, 0.65, 10, 1.85, 0.7, 1.15, redSand);
      addCyl(bodyGroup, 0.24, 0.32, 4.1, 10, 1.85, 2.85, 1.15, creamStone);
      addCyl(bodyGroup, 0.42, 0.26, 0.45, 10, 1.85, 5.05, 1.15, goldMat);
      const lionCap = new THREE.Mesh(new THREE.DodecahedronGeometry(0.45, 0), goldMat);
      lionCap.position.set(1.85, 5.55, 1.15);
      bodyGroup.add(lionCap);
      teamMeshes.push(archBanner);
      break;
    }

    case 'mace_arsenal':
    case 'sele_colony': {
      // Hellenistic Royal Military Hall / Seleucid Fortified Colony with 0 A.D. Hellenic marble & tiled roof textures!
      const marble = getTexMat('textures/hele_struct_b.png', 'textures/hele_struct_b_norm.png', 0xf0e8d6, 1.6, 1.4, 0.84, 0.04);
      const roofCol =
        templateId === 'mace_arsenal'
          ? getTexMat('textures/hele_tile_c.png', null, 0x5c5ab0, 2.2, 2.0, 0.78, 0.08)
          : getTexMat('textures/hele_tile_b.png', null, 0x2a88b8, 2.2, 2.0, 0.78, 0.08);
      addBox(bodyGroup, 5.6, 0.45, 5.2, 0, 0.22, 0, darkStoneMat);
      addBox(bodyGroup, 4.8, 2.3, 4.1, 0, 1.55, -0.15, marble);
      const roof = new THREE.Mesh(new THREE.ConeGeometry(3.8, 1.4, 4), roofCol);
      roof.position.set(0, 3.38, -0.15);
      roof.rotation.y = Math.PI / 4;
      roof.scale.set(1.15, 1.0, 0.95);
      roof.castShadow = true;
      bodyGroup.add(roof);
      // Front Doric columns
      for (const cx of [-1.7, -0.6, 0.6, 1.7]) {
        addCyl(bodyGroup, 0.13, 0.15, 2.25, 8, cx, 1.52, 2.15, marble);
      }
      const pediment = addBox(bodyGroup, 4.2, 0.35, 0.22, 0, 2.62, 2.18, teamMat);
      addCyl(bodyGroup, 0.05, 0.06, 3.8, 6, 2.35, 2.4, 2.0, woodMat);
      const flag = addBox(bodyGroup, 1.2, 0.65, 0.08, 2.95, 4.0, 2.0, teamMat);
      teamMeshes.push(pediment, flag);
      break;
    }

    case 'brit_chariot':
    case 'pers_chariot':
    case 'han_chariot': {
      // Iconic Two-Horse War Chariot (Celtic, Persian Scythed, or Han Imperial!) with spoked wheels & bronze trim
      const isScythed = templateId === 'pers_chariot';
      const isHanC = templateId === 'han_chariot';
      const horseMat = getMat(isHanC ? 0x5c3a21 : isScythed ? 0x8f5b34 : 0x7c4e2a, 0.84, 0.03);
      const cabMat = getTexMat('textures/palisade_main.png', null, isHanC ? 0x992828 : 0xa5743c, 1.2, 1.2, 0.85, 0.04);
      // Twin sculpted warhorses pulling ahead (+Z)
      for (const hx of [-0.52, 0.52]) {
        const hBody = new THREE.Mesh(new THREE.CapsuleGeometry(0.22, 0.72, 6, 8), horseMat);
        hBody.rotation.x = Math.PI / 2;
        hBody.position.set(hx, 0.86, 0.92);
        hBody.castShadow = true;
        bodyGroup.add(hBody);
        for (const [lx, lz] of [[-0.1, 1.28], [0.1, 1.28], [-0.1, 0.56], [0.1, 0.56]]) {
          addCyl(bodyGroup, 0.04, 0.055, 0.64, 6, hx + lx, 0.32, lz, horseMat);
        }
        const hNeck = addCyl(bodyGroup, 0.09, 0.13, 0.52, 6, hx, 1.18, 1.38, horseMat);
        hNeck.rotation.x = 0.42;
        const hHead = new THREE.Mesh(new THREE.CapsuleGeometry(0.085, 0.2, 5, 6), horseMat);
        hHead.rotation.x = Math.PI * 0.62;
        hHead.position.set(hx, 1.42, 1.6);
        bodyGroup.add(hHead);
      }
      // Yoke beam + spoked wheels (+ bronze scythe blades for Persian Scythed Chariot!)
      addBox(bodyGroup, 1.25, 0.08, 0.1, 0, 0.88, 1.15, woodMat);
      addBox(bodyGroup, 0.1, 0.08, 1.35, 0, 0.64, 0.45, woodMat);
      for (const wx of [-0.74, 0.74]) {
        const wheel = new THREE.Mesh(new THREE.TorusGeometry(0.45, 0.07, 6, 14), bronzeMat);
        wheel.rotation.y = Math.PI / 2;
        wheel.position.set(wx, 0.45, -0.42);
        wheel.castShadow = true;
        bodyGroup.add(wheel);
        if (isScythed) {
          const scythe = new THREE.Mesh(new THREE.ConeGeometry(0.06, 0.62, 4), steelMat);
          scythe.rotation.z = wx > 0 ? -Math.PI / 2 : Math.PI / 2;
          scythe.position.set(wx + (wx > 0 ? 0.32 : -0.32), 0.45, -0.42);
          bodyGroup.add(scythe);
        }
      }
      addBox(bodyGroup, 1.25, 0.75, 1.05, 0, 0.82, -0.45, cabMat);
      const chariotTrim = addBox(bodyGroup, 1.3, 0.3, 0.12, 0, 1.02, 0.1, teamMat);
      // Warrior standing in chariot
      const warriorTorso = addBox(bodyGroup, 0.4, 0.58, 0.28, 0, 1.52, -0.45, teamMat);
      const wHead = new THREE.Mesh(new THREE.SphereGeometry(0.18, 7, 6), skinMat);
      wHead.position.set(0, 1.98, -0.45);
      bodyGroup.add(wHead);
      weaponPivot = new THREE.Group();
      weaponPivot.position.set(0.28, 1.62, -0.35);
      const jav = addCyl(weaponPivot, 0.03, 0.03, 1.7, 5, 0, 0.2, 0.35, woodMat);
      jav.rotation.x = 1.05;
      bodyGroup.add(weaponPivot);
      teamMeshes.push(chariotTrim, warriorTorso);
      break;
    }

    case 'kush_elephant':
    case 'maur_elephant':
    case 'maur_champion':
    case 'sele_elephant':
    case 'pers_elephant':
    case 'ptol_elephant':
    case 'carth_elephant': {
      // Colossal Armored War Elephant with ivory tusks, curved trunk, flapping ears, team caparison & wooden battle howdah!
      const hideMat = getMat(templateId === 'kush_elephant' ? 0x6b6760 : 0x7a7672, 0.9, 0.04);
      const ivoryMat = getMat(0xfaf3e0, 0.45, 0.05);
      const armorMat = getMat(templateId === 'sele_elephant' ? 0xb8860b : 0x64748b, 0.42, 0.65);

      // Massive barrel body & 4 pillar legs
      addBox(bodyGroup, 1.48, 1.35, 2.35, 0, 1.68, 0, hideMat);
      for (const lx of [-0.48, 0.48]) {
        for (const lz of [-0.72, 0.72]) {
          addCyl(bodyGroup, 0.24, 0.28, 1.28, 8, lx, 0.64, lz, hideMat);
        }
      }
      // Armored head, flapping ears, curved trunk & long ivory tusks (+Z)
      const eHead = new THREE.Mesh(new THREE.SphereGeometry(0.68, 8, 7), hideMat);
      eHead.position.set(0, 2.08, 1.28);
      eHead.castShadow = true;
      bodyGroup.add(eHead);
      // Forehead bronze armor plate
      addBox(bodyGroup, 0.68, 0.68, 0.22, 0, 2.22, 1.88, armorMat);
      // Ears
      addBox(bodyGroup, 0.14, 0.85, 0.62, -0.74, 2.1, 1.15, hideMat);
      addBox(bodyGroup, 0.14, 0.85, 0.62, 0.74, 2.1, 1.15, hideMat);
      // Trunk
      const trunk = addCyl(bodyGroup, 0.18, 0.1, 1.45, 7, 0, 1.32, 1.98, hideMat);
      trunk.rotation.x = 0.28;
      // Twin gleaming curved tusks
      for (const tx of [-0.34, 0.34]) {
        const tusk = addCyl(bodyGroup, 0.04, 0.1, 1.25, 6, tx, 1.58, 2.12, ivoryMat);
        tusk.rotation.x = 1.22;
      }
      // Team-colored caparison blanket draped over elephant's back
      const blanket = addBox(bodyGroup, 1.6, 0.92, 1.55, 0, 1.85, -0.05, teamMat);
      // Timber battle howdah tower atop elephant back + archer/driver
      addBox(bodyGroup, 1.25, 0.78, 1.25, 0, 2.75, -0.1, woodMat);
      const howdahTrim = addBox(bodyGroup, 1.32, 0.22, 1.32, 0, 3.08, -0.1, teamMat);
      const rider = addBox(bodyGroup, 0.38, 0.52, 0.26, 0, 3.32, -0.1, teamMat);
      const rHead = new THREE.Mesh(new THREE.SphereGeometry(0.16, 7, 6), skinMat);
      rHead.position.set(0, 3.72, -0.1);
      bodyGroup.add(rHead);
      weaponPivot = new THREE.Group();
      weaponPivot.position.set(0, 2.2, 1.5);
      bodyGroup.add(weaponPivot);
      teamMeshes.push(blanket, howdahTrim, rider);
      break;
    }

    case 'siege_cannon': {
      // Heavy cast-bronze Imperial Bombard Cannon on reinforced oak artillery carriage with spoked wheels & iron cannonballs!
      const carriageWood = getTexMat('textures/palisade_main.png', null, 0x6b4322, 1.4, 1.2, 0.85, 0.05);
      const bronzeBarrelMat = getMat(0xa87c32, 0.34, 0.78);
      const bronzeRingMat = getMat(0xd4a64a, 0.28, 0.84);
      const ironMat = getMat(0x2f343d, 0.45, 0.72);

      // Twin heavy oak trail cheeks & cross-axle
      for (const sx of [-0.46, 0.46]) {
        const cheek = addBox(bodyGroup, 0.18, 0.34, 2.05, sx, 0.54, -0.25, carriageWood);
        cheek.rotation.x = 0.14;
      }
      addBox(bodyGroup, 1.38, 0.18, 0.2, 0, 0.56, 0.34, ironMat);
      addBox(bodyGroup, 0.96, 0.16, 0.26, 0, 0.34, -1.12, carriageWood);

      // Large spoked artillery wheels with iron rims
      for (const sx of [-0.72, 0.72]) {
        const wheelGroup = new THREE.Group();
        wheelGroup.position.set(sx, 0.56, 0.34);
        const rim = new THREE.Mesh(new THREE.TorusGeometry(0.54, 0.065, 8, 18), ironMat);
        rim.rotation.y = Math.PI * 0.5;
        rim.castShadow = true;
        wheelGroup.add(rim);
        const woodRim = new THREE.Mesh(new THREE.TorusGeometry(0.47, 0.05, 6, 16), carriageWood);
        woodRim.rotation.y = Math.PI * 0.5;
        wheelGroup.add(woodRim);
        const hub = addCyl(wheelGroup, 0.13, 0.13, 0.22, 10, 0, 0, 0, bronzeRingMat);
        hub.rotation.z = Math.PI * 0.5;
        for (let k = 0; k < 8; k++) {
          const ang = (k / 8) * Math.PI * 2;
          const spoke = addCyl(wheelGroup, 0.032, 0.038, 0.94, 5, 0, 0, 0, carriageWood);
          spoke.rotation.x = ang;
        }
        bodyGroup.add(wheelGroup);
      }

      // Pivoting heavy cast-bronze cannon barrel (angled slightly upward toward +Z)
      const cannonPivot = new THREE.Group();
      cannonPivot.position.set(0, 0.92, 0.32);
      cannonPivot.rotation.x = -0.14;

      const barrel = addCyl(cannonPivot, 0.18, 0.26, 2.15, 14, 0, 0, 0.36, bronzeBarrelMat);
      barrel.rotation.x = Math.PI * 0.5;
      // Decorative reinforcement rings along barrel
      for (const rz of [-0.58, -0.12, 0.42, 1.02, 1.38]) {
        const rr = 0.27 - (rz + 0.6) * 0.035;
        const band = new THREE.Mesh(new THREE.TorusGeometry(rr, 0.032, 6, 14), bronzeRingMat);
        band.position.set(0, 0, rz);
        cannonPivot.add(band);
      }
      // Cascabel breech knob & trunnions
      const breech = new THREE.Mesh(new THREE.SphereGeometry(0.24, 10, 8), bronzeBarrelMat);
      breech.position.set(0, 0, -0.74);
      cannonPivot.add(breech);
      const knob = new THREE.Mesh(new THREE.SphereGeometry(0.11, 8, 6), bronzeRingMat);
      knob.position.set(0, 0, -0.98);
      cannonPivot.add(knob);
      // Dark hollow muzzle bore
      const bore = addCyl(cannonPivot, 0.12, 0.12, 0.08, 10, 0, 0, 1.42, getMat(0x111318, 0.9, 0.1));
      bore.rotation.x = Math.PI * 0.5;
      // Glowing red-orange slow-match touchhole spark
      const ember = new THREE.Mesh(
        new THREE.SphereGeometry(0.06, 6, 6),
        new THREE.MeshBasicMaterial({ color: 0xff6b00 })
      );
      ember.position.set(0, 0.26, -0.52);
      cannonPivot.add(ember);

      bodyGroup.add(cannonPivot);
      weaponPivot = cannonPivot;

      // Team-colored side banner & stacked iron cannonballs on carriage
      const banner = addBox(bodyGroup, 0.06, 0.42, 0.52, -0.56, 0.85, -0.55, teamMat);
      teamMeshes.push(banner);
      for (const [bx, by, bz] of [[-0.14, 0.52, -0.78], [0.14, 0.52, -0.78], [0, 0.68, -0.78]]) {
        const ball = new THREE.Mesh(new THREE.SphereGeometry(0.11, 8, 6), ironMat);
        ball.position.set(bx, by, bz);
        bodyGroup.add(ball);
      }
      break;
    }

    default: {
      if (templateId.startsWith('tree_')) {
        addCyl(bodyGroup, 0.16, 0.26, 2.0, 6, 0, 1.0, 0, getMat(0x6d5740, 0.92, 0));
        const crown = new THREE.Mesh(
          new THREE.DodecahedronGeometry(1.05, 0),
          getMat(templateId === 'tree_hybrid_royal_orchard' ? 0xeab308 : 0x4f7f42, 0.86, 0)
        );
        crown.position.set(0, 2.55, 0);
        crown.castShadow = true;
        bodyGroup.add(crown);
      } else {
        addBox(bodyGroup, 1, 1, 1, 0, 0.5, 0, teamMat);
      }
      break;
    }
  }

  parts.weaponPivot = weaponPivot;

  // Asynchronously upgrade placeholder geometry to genuine 0 A.D. .dae model once loaded
  if (zeroADSpec) {
    zeroADAssets
      .ensureSpecLoaded(zeroADSpec)
      .then(() => {
        const built = zeroADAssets.buildSync(zeroADSpec, teamColor);
        bodyGroup.clear();
        bodyGroup.scale.set(1, 1, 1);
        bodyGroup.add(built.container);
        parts.weaponPivot = built.weaponPivot;
        parts.animator = built.animator;
      })
      .catch((err) => {
        console.warn(`[0ad-assets] Fallback kept for ${templateId} (${civId}):`, err);
      });
  }

  return parts;
}
