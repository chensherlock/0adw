import * as THREE from 'three';
import { EFFECT_TEXTURES, FIELD_TEXTURES } from '../config/assets';
import { CIVS } from '../config/civs';
import { CivId } from '../config/types';
import { getZeroADModelSpec, UnitAnimator, zeroADAssets } from './ZeroADAssetLoader';

export interface EntityVisualParts {
  root: THREE.Group;
  bodyGroup: THREE.Group;
  weaponPivot?: THREE.Object3D;
  animator?: UnitAnimator;
  cropGroup?: THREE.Group;
  cropMat?: THREE.MeshStandardMaterial;
  sparkleSprites?: THREE.Sprite[];
  carcassDecal?: THREE.Mesh;
  rankBadge?: THREE.Mesh;
  teamMeshes: THREE.Mesh[];
}

const matCache = new Map<string, THREE.MeshStandardMaterial>();
let farmlandDecalMatCache: THREE.MeshStandardMaterial | null = null;
let stoneDecalMatCache: THREE.MeshStandardMaterial | null = null;
let wheatCropMatCache: THREE.MeshStandardMaterial | null = null;
let wheatClusterGeomCache: THREE.BufferGeometry | null = null;

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
  const stoneMat = getMat(civ.stoneColor, 0.85, 0.03);
  const darkStoneMat = getMat(0x888175, 0.9, 0.04);
  const roofMat = getMat(civ.roofColor, 0.78, 0.05);
  const woodMat = getMat(0x7a5230, 0.88, 0.02);
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
  } else if (templateId === 'deer_herd' || templateId === 'wild_boar') {
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

  // Prefer genuine 0 A.D. 3D COLLADA (.dae) models + textures when available
  const zeroADSpec = getZeroADModelSpec(templateId, civId);
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
      // 1. Authentic 0 A.D. ploughed Mediterranean farmland decal with feathered edges & normal map
      const soilGeom = new THREE.PlaneGeometry(5.6, 5.6);
      soilGeom.rotateX(-Math.PI / 2);
      const soil = new THREE.Mesh(soilGeom, getFarmlandDecalMat());
      soil.position.y = 0.06;
      soil.receiveShadow = true;
      bodyGroup.add(soil);

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
      const fenceWood = getMat(0x6b4a2b, 0.92, 0.02);
      const corners: Array<[number, number]> = [
        [-2.25, -2.25],
        [2.25, -2.25],
        [-2.25, 2.25],
        [2.25, 2.25],
      ];
      for (const [cx, cz] of corners) {
        addCyl(bodyGroup, 0.07, 0.09, 0.72, 6, cx, 0.36, cz, fenceWood);
      }
      // Partial rustic wooden rails along two opposite edges (leaving open entry for farmers)
      addBox(bodyGroup, 1.55, 0.07, 0.06, -1.45, 0.48, -2.25, fenceWood, false);
      addBox(bodyGroup, 1.55, 0.07, 0.06, -1.45, 0.26, -2.25, fenceWood, false);
      addBox(bodyGroup, 0.06, 0.07, 1.55, -2.25, 0.48, -1.45, fenceWood, false);
      addBox(bodyGroup, 0.06, 0.07, 1.55, -2.25, 0.26, -1.45, fenceWood, false);
      addBox(bodyGroup, 1.55, 0.07, 0.06, 1.45, 0.48, 2.25, fenceWood, false);
      addBox(bodyGroup, 0.06, 0.07, 1.55, 2.25, 0.48, 1.45, fenceWood, false);

      // Harvested straw bundle + team pennant on one corner post
      const hay = addCyl(bodyGroup, 0.26, 0.28, 0.56, 7, -1.95, 0.28, -1.85, getMat(0xd6b052, 0.94, 0));
      hay.rotation.z = Math.PI * 0.5;
      addCyl(bodyGroup, 0.04, 0.05, 1.15, 5, 2.25, 0.58, 2.25, fenceWood);
      const pennant = addBox(bodyGroup, 0.48, 0.26, 0.04, 2.48, 1.0, 2.25, teamMat, false);
      teamMeshes.push(pennant);
      break;
    }
    case 'barracks': {
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
      addBox(bodyGroup, 2.5, 0.4, 2.5, 0, 0.2, 0, darkStoneMat);
      addBox(bodyGroup, 1.95, 4.4, 1.95, 0, 2.6, 0, stoneMat);
      addBox(bodyGroup, 2.35, 0.55, 2.35, 0, 4.95, 0, darkStoneMat);
      const roof = new THREE.Mesh(new THREE.ConeGeometry(1.75, 1.25, 4), roofMat);
      roof.position.set(0, 5.85, 0);
      roof.rotation.y = Math.PI * 0.25;
      roof.castShadow = true;
      bodyGroup.add(roof);
      const banner = addBox(bodyGroup, 0.7, 1.5, 0.12, 0, 3.4, 1.02, teamMat);
      teamMeshes.push(banner);
      break;
    }
    case 'outpost': {
      for (const sx of [-0.65, 0.65]) {
        for (const sz of [-0.65, 0.65]) {
          addCyl(bodyGroup, 0.09, 0.11, 3.2, 5, sx, 1.6, sz, woodMat);
        }
      }
      addBox(bodyGroup, 1.65, 0.25, 1.65, 0, 3.1, 0, woodMat);
      addBox(bodyGroup, 1.55, 0.65, 1.55, 0, 3.55, 0, woodMat);
      addCyl(bodyGroup, 0.05, 0.05, 1.8, 5, 0, 4.6, 0, woodMat);
      const flag = addBox(bodyGroup, 0.95, 0.55, 0.08, 0.48, 5.2, 0, teamMat);
      teamMeshes.push(flag);
      break;
    }
    case 'fortress': {
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
    case 'rome_champion': {
      const isRome = templateId.startsWith('rome');
      const isChamp = templateId.includes('champion');
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
    case 'rome_velite': {
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
    case 'rome_cavalry': {
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
