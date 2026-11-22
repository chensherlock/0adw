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
  'dock',
  'stone_wall',
  'stone_gate',
  'beacon_tower',
  'stone_bridge',
  'tunnel_portal',
  'apartment_house',
  'trader',
  'ancient_ruin_pillar',
  'sea_monster',
  'sea_kraken',
  'lake_nessie',
  'merchant_ship',
  'warship_trireme',
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
        const berry = new THREE.Mesh(new THREE.SphereGeometry(0.11, 5, 5), berryMat);
        berry.position.set(Math.cos(ang) * 0.65, 0.65 + (i % 2) * 0.22, Math.sin(ang) * 0.65);
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

      // Blazing Beacon Signal Fire (visible whenever beaconLitTimer > 0!)
      const fireGroup = new THREE.Group();
      fireGroup.position.set(0, 5.1, 0);
      const flameOuterMat = new THREE.MeshBasicMaterial({ color: 0xff5a00, transparent: true, opacity: 0.92 });
      const flameMidMat = new THREE.MeshBasicMaterial({ color: 0xffa600, transparent: true, opacity: 0.95 });
      const flameCoreMat = new THREE.MeshBasicMaterial({ color: 0xfff3b0, transparent: true, opacity: 0.98 });
      const cone1 = new THREE.Mesh(new THREE.ConeGeometry(0.75, 2.1, 7), flameOuterMat);
      cone1.position.y = 0.95;
      const cone2 = new THREE.Mesh(new THREE.ConeGeometry(0.52, 1.75, 7), flameMidMat);
      cone2.position.set(0.14, 0.85, -0.08);
      const cone3 = new THREE.Mesh(new THREE.ConeGeometry(0.32, 1.25, 6), flameCoreMat);
      cone3.position.set(-0.08, 0.68, 0.1);
      fireGroup.add(cone1, cone2, cone3);
      fireGroup.visible = false;
      bodyGroup.add(fireGroup);
      parts.beaconFireGroup = fireGroup;

      // Towering Wolf-Smoke Column (狼煙) visible from across the map when lit!
      const smokeGroup = new THREE.Group();
      smokeGroup.position.set(0, 5.4, 0);
      for (let si = 0; si < 7; si++) {
        const sMat = new THREE.MeshBasicMaterial({
          color: si < 2 ? 0x52525b : 0x27272a,
          transparent: true,
          opacity: 0.68 - si * 0.075,
        });
        const puff = new THREE.Mesh(new THREE.DodecahedronGeometry(0.62 + si * 0.24, 0), sMat);
        puff.position.set(0, si * 1.95, 0);
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

    case 'tree_bamboo': {
      // Slender segmented bamboo grove fallback with crisp pale nodal rings & feathery narrow lanceolate leaf blades
      const stalkMat = getMat(0x6da842, 0.52, 0.04);
      const nodeRingMat = getMat(0xcbd59a, 0.68, 0.02);
      const leafBladeMat = new THREE.MeshStandardMaterial({
        color: 0x4f9130,
        roughness: 0.78,
        side: THREE.DoubleSide,
      });

      const stalks: Array<[number, number, number, number, number]> = [
        [0, 0, 5.4, 0.04, 0.03],
        [-0.28, 0.2, 4.9, -0.07, 0.05],
        [0.3, -0.18, 5.1, 0.06, -0.05],
        [-0.22, -0.3, 4.3, -0.05, -0.07],
        [0.24, 0.28, 4.6, 0.07, 0.06],
        [0.05, -0.4, 3.9, 0.02, -0.08],
        [-0.4, -0.04, 4.1, -0.08, 0.02],
        [0.42, 0.08, 3.8, 0.09, 0.03],
        [-0.1, 0.38, 4.2, -0.03, 0.08],
      ];
      for (const [bx, bz, bh, tiltX, tiltZ] of stalks) {
        const culmGroup = new THREE.Group();
        culmGroup.position.set(bx, 0, bz);
        culmGroup.rotation.set(tiltX, 0, tiltZ);
        addCyl(culmGroup, 0.038, 0.058, bh, 7, 0, bh * 0.5, 0, stalkMat);
        // Pale cream bamboo node rings every ~0.55m
        for (let ny = 0.55; ny < bh - 0.35; ny += 0.55) {
          const r = 0.06 - (ny / bh) * 0.018;
          addCyl(culmGroup, r, r, 0.032, 7, 0, ny, 0, nodeRingMat, false);
        }
        // Delicate willow-like narrow bamboo leaf sprays fanning from upper nodes
        for (let lIdx = 0; lIdx < 6; lIdx++) {
          const ly = bh * (0.58 + (lIdx / 6) * 0.4);
          const ang = lIdx * 1.15 + bx * 5;
          const blade = new THREE.Mesh(new THREE.PlaneGeometry(0.14, 0.72), leafBladeMat);
          blade.position.set(Math.cos(ang) * 0.34, ly, Math.sin(ang) * 0.34);
          blade.rotation.set(0.55, -ang, 0.25);
          culmGroup.add(blade);
        }
        bodyGroup.add(culmGroup);
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
      // Textured Winged Ancient Sea Dragon (海龍) emerging from churning ocean waves!
      const mats = getAquaticMonsterMaterials('dragon');
      const fangMat = getMat(0xf8fafc, 0.35, 0.1);
      const coils: THREE.Object3D[] = [];

      // Rising S-curved scaled sea dragon neck & horned draconic head
      const neckGroup = new THREE.Group();
      const neckCurve = new THREE.CatmullRomCurve3([
        new THREE.Vector3(0, -0.4, 0.25),
        new THREE.Vector3(0, 0.85, 0.52),
        new THREE.Vector3(0, 1.9, 0.2),
        new THREE.Vector3(0, 2.55, 0.88),
      ]);
      const neckMesh = new THREE.Mesh(new THREE.TubeGeometry(neckCurve, 16, 0.42, 10, false), mats.primary);
      neckMesh.castShadow = true;
      neckGroup.add(neckMesh);

      // Ribbed golden-ivory underbelly throat crest
      const bellyCurve = new THREE.CatmullRomCurve3([
        new THREE.Vector3(0, -0.2, 0.62),
        new THREE.Vector3(0, 0.88, 0.84),
        new THREE.Vector3(0, 1.82, 0.55),
        new THREE.Vector3(0, 2.24, 1.08),
      ]);
      const bellyMesh = new THREE.Mesh(new THREE.TubeGeometry(bellyCurve, 12, 0.2, 8, false), mats.secondary);
      neckGroup.add(bellyMesh);

      // Sculpted dragon head, elongated snout, jaw, whiskers, swept horns & glowing amber eyes
      const sHead = new THREE.Mesh(new THREE.SphereGeometry(0.46, 12, 10), mats.primary);
      sHead.scale.set(0.88, 0.78, 1.55);
      sHead.position.set(0, 2.6, 1.24);
      sHead.castShadow = true;
      neckGroup.add(sHead);
      const snout = new THREE.Mesh(new THREE.CapsuleGeometry(0.24, 0.58, 6, 8), mats.primary);
      snout.rotation.x = Math.PI * 0.52;
      snout.position.set(0, 2.54, 1.72);
      neckGroup.add(snout);
      const jaw = new THREE.Mesh(new THREE.CapsuleGeometry(0.2, 0.48, 5, 7), mats.secondary);
      jaw.rotation.x = Math.PI * 0.58;
      jaw.position.set(0, 2.25, 1.56);
      neckGroup.add(jaw);

      for (const sx of [-0.22, 0.22]) {
        const eye = new THREE.Mesh(new THREE.SphereGeometry(0.095, 8, 6), mats.eye);
        eye.position.set(sx * 1.48, 2.74, 1.44);
        neckGroup.add(eye);
        // Swept stag-like dragon horns
        const horn = new THREE.Mesh(new THREE.ConeGeometry(0.08, 0.85, 6), mats.secondary);
        horn.position.set(sx * 1.15, 3.08, 0.88);
        horn.rotation.set(-0.68, 0, sx > 0 ? -0.32 : 0.32);
        neckGroup.add(horn);
        // Flowing draconic whiskers
        const whisker = new THREE.Mesh(new THREE.ConeGeometry(0.03, 0.65, 5), mats.accent);
        whisker.position.set(sx * 1.25, 2.38, 1.88);
        whisker.rotation.set(0.45, 0, sx > 0 ? -1.15 : 1.15);
        neckGroup.add(whisker);
        // White fangs
        const fang = new THREE.Mesh(new THREE.ConeGeometry(0.035, 0.2, 5), fangMat);
        fang.rotation.x = Math.PI;
        fang.position.set(sx * 0.72, 2.38, 1.88);
        neckGroup.add(fang);
      }
      // Jagged dorsal crest spines down the sea dragon neck
      for (let sp = 0; sp < 6; sp++) {
        const spine = new THREE.Mesh(new THREE.ConeGeometry(0.09, 0.48, 4), mats.accent);
        spine.position.set(0, 0.65 + sp * 0.38, -0.15 + Math.sin(sp * 0.55) * 0.16);
        spine.rotation.x = -0.82;
        neckGroup.add(spine);
      }
      bodyGroup.add(neckGroup);
      coils.push(neckGroup);

      // Two breaching scaled dragon body coils arching through the waves + flared tail fin!
      for (const [cz, ch, cr] of [[-0.95, 1.02, 0.4], [-2.2, 0.74, 0.28]] as const) {
        const archCurve = new THREE.CatmullRomCurve3([
          new THREE.Vector3(0, -0.38, cz + 0.62),
          new THREE.Vector3(0, ch, cz),
          new THREE.Vector3(0, -0.38, cz - 0.62),
        ]);
        const arch = new THREE.Mesh(new THREE.TubeGeometry(archCurve, 12, cr, 9, false), mats.primary);
        arch.castShadow = true;
        // Dorsal ridge fin along each breaching coil
        const ridge = new THREE.Mesh(new THREE.ConeGeometry(0.11, 0.44, 4), mats.accent);
        ridge.position.set(0, ch + cr * 0.85, cz);
        ridge.rotation.x = -0.45;
        const coilGroup = new THREE.Group();
        coilGroup.add(arch, ridge);
        bodyGroup.add(coilGroup);
        coils.push(coilGroup);
      }

      // Winged Sea-Dragon pectoral fin-wings & forked tail fin!
      for (const side of [-1, 1]) {
        const wingGroup = new THREE.Group();
        wingGroup.position.set(side * 0.42, 0.75, 0.1);
        const wingMembrane = new THREE.Mesh(new THREE.CircleGeometry(1.18, 6, 0, Math.PI * 0.85), mats.accent);
        wingMembrane.scale.set(1.25, 0.75, 1);
        wingMembrane.rotation.set(-0.35, side > 0 ? 0.35 : Math.PI - 0.35, side * -0.4);
        wingMembrane.position.set(side * 0.65, 0.28, -0.25);
        wingMembrane.castShadow = true;
        wingGroup.add(wingMembrane);
        const wingSpar = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.075, 1.45, 6), mats.primary);
        wingSpar.rotation.z = side * -1.15;
        wingSpar.position.set(side * 0.58, 0.35, -0.08);
        wingGroup.add(wingSpar);
        bodyGroup.add(wingGroup);
        coils.push(wingGroup);
      }

      // Sweeping forked dragon tail rising behind last coil
      const tailGroup = new THREE.Group();
      tailGroup.position.set(0, 0.1, -2.95);
      const tailStem = new THREE.Mesh(new THREE.ConeGeometry(0.18, 1.35, 7), mats.primary);
      tailStem.position.set(0, 0.55, -0.22);
      tailStem.rotation.x = -0.42;
      const tailFin = new THREE.Mesh(new THREE.CircleGeometry(0.62, 5), mats.accent);
      tailFin.position.set(0, 1.15, -0.52);
      tailFin.rotation.y = Math.PI * 0.5;
      tailGroup.add(tailStem, tailFin);
      bodyGroup.add(tailGroup);
      coils.push(tailGroup);

      parts.seaMonsterCoils = coils;

      // Churning white sea-foam vortex rings around the Sea Dragon
      const rippleMeshes: THREE.Mesh[] = [];
      for (let r = 0; r < 2; r++) {
        const ringGeom = new THREE.RingGeometry(1.35 + r * 0.65, 1.62 + r * 0.72, 28);
        ringGeom.rotateX(-Math.PI / 2);
        const ringMat = new THREE.MeshBasicMaterial({
          color: 0xdcfce7,
          transparent: true,
          opacity: 0.56,
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
      // Traditional Han Dynasty Imperial Hall with 0 A.D. carved marble, lacquered timber & slate roof tiles!
      const terraceMat = getTexMat('textures/stonequarry_marble.png', 'textures/stone_india_01_norm.png', 0xe2dac9, 1.6, 1.2, 0.88, 0.04);
      const lacqRedMat = getTexMat('textures/palisade_main.png', null, 0xb82828, 1.2, 1.2, 0.65, 0.1);
      const slateRoofMat = getTexMat('textures/hele_tile_c.png', null, 0x526173, 2.4, 2.0, 0.78, 0.08);
      const goldTrimMat = getMat(0xd4a437, 0.35, 0.72);

      // Two-tiered marble/stone platform with front steps
      addBox(bodyGroup, 5.8, 0.45, 5.4, 0, 0.22, 0, darkStoneMat);
      addBox(bodyGroup, 5.1, 0.38, 4.7, 0, 0.62, 0, terraceMat);
      addBox(bodyGroup, 1.6, 0.32, 0.75, 0, 0.36, 2.75, terraceMat);

      // Main lacquered hall + red perimeter columns
      addBox(bodyGroup, 3.9, 1.85, 3.3, 0, 1.72, -0.1, terraceMat);
      for (const cx of [-2.1, -0.75, 0.75, 2.1]) {
        addCyl(bodyGroup, 0.11, 0.12, 1.95, 8, cx, 1.75, 1.85, lacqRedMat);
        addCyl(bodyGroup, 0.11, 0.12, 1.95, 8, cx, 1.75, -1.95, lacqRedMat);
      }
      // Double-tiered pagoda roof with sweeping eaves & golden ridge crest
      const lowerRoof = new THREE.Mesh(new THREE.ConeGeometry(4.1, 1.15, 4), slateRoofMat);
      lowerRoof.position.set(0, 3.22, 0);
      lowerRoof.rotation.y = Math.PI / 4;
      lowerRoof.scale.set(1.08, 1.0, 0.96);
      lowerRoof.castShadow = true;
      bodyGroup.add(lowerRoof);

      addBox(bodyGroup, 2.6, 0.9, 2.2, 0, 3.85, 0, lacqRedMat);
      const upperRoof = new THREE.Mesh(new THREE.ConeGeometry(2.85, 1.15, 4), slateRoofMat);
      upperRoof.position.set(0, 4.78, 0);
      upperRoof.rotation.y = Math.PI / 4;
      upperRoof.scale.set(1.06, 1.0, 0.92);
      upperRoof.castShadow = true;
      bodyGroup.add(upperRoof);
      addBox(bodyGroup, 1.5, 0.16, 0.16, 0, 5.38, 0, goldTrimMat);
      // Red imperial lanterns & silk banner
      for (const lx of [-1.45, 1.45]) {
        const lan = new THREE.Mesh(new THREE.SphereGeometry(0.18, 7, 6), teamMat);
        lan.position.set(lx, 2.35, 1.95);
        bodyGroup.add(lan);
        teamMeshes.push(lan);
      }
      const plaque = addBox(bodyGroup, 1.25, 0.42, 0.12, 0, 2.52, 1.72, goldTrimMat);
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

    default: {
      addBox(bodyGroup, 1, 1, 1, 0, 0.5, 0, teamMat);
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
