import * as THREE from 'three';
import { ASSET_BASE } from '../config/assets';
import { TEMPLATES } from '../config/entities';
import { CivId, Entity, TerraformMode } from '../config/types';
import { SOIL_UNITS_PER_TILE, WATER_LEVEL } from '../sim/map/TerrainMap';
import { World } from '../sim/World';
import { createEntityVisual, EntityVisualParts } from './AssetFactory';
import { RTSCamera } from './RTSCamera';
import { TerrainRenderer } from './TerrainRenderer';
import { getZeroADModelSpec, preloadZeroADModels, UnitAnimator, zeroADAssets } from './ZeroADAssetLoader';

const CROP_SPROUT_COLOR = new THREE.Color(0x6da83b);
const CROP_MID_COLOR = new THREE.Color(0xc5cf56);
const CROP_RIPE_COLOR = new THREE.Color(0xffffff);
const CROP_TEMP_COLOR = new THREE.Color();

interface ManagedVisual {
  id: number;
  owner: number;
  templateId: string;
  parts: EntityVisualParts;
  selectionRing: THREE.Mesh;
  hpBarGroup: THREE.Group;
  hpFill: THREE.Mesh;
  capFill: THREE.Mesh;
  smoothFacing: number;
  facingInit: boolean;
  /** Gradual crop growth 0..1 for Wheat Fields */
  fieldGrowth: number;
  lastResourceRemaining: number;
  /** Smooth collapse interpolation 0..1 for slain wildlife */
  deathCollapse: number;
  /** Floating overhead countdown sprite for newly spawned Civic Center workers */
  countdownSprite?: THREE.Sprite;
  countdownLastVal?: number;
}

interface ClickPing {
  mesh: THREE.Mesh;
  age: number;
  duration: number;
}

export class SceneManager {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene: THREE.Scene;
  readonly rtsCamera: RTSCamera;
  readonly terrainRenderer: TerrainRenderer;

  private readonly visuals = new Map<number, ManagedVisual>();
  private readonly projectileMeshes = new Map<number, THREE.Mesh>();
  private readonly pings: ClickPing[] = [];
  private readonly countdownTextures = new Map<number, THREE.CanvasTexture>();

  // Building placement ghost preview
  private ghostGroup: THREE.Group | null = null;
  private ghostTemplateId: string | null = null;
  private wallDragGroup = new THREE.Group();
  private readonly wallPreviewGeom = new THREE.BoxGeometry(2.84, 2.35, 0.92);
  private readonly bridgePreviewGeom = new THREE.BoxGeometry(2.86, 0.72, 2.1);
  private ghostValidMat = new THREE.MeshBasicMaterial({ color: 0x22c55e, transparent: true, opacity: 0.45, wireframe: false });
  private ghostInvalidMat = new THREE.MeshBasicMaterial({ color: 0xef4444, transparent: true, opacity: 0.45, wireframe: false });
  private readonly terraformRing: THREE.Mesh;
  private readonly terraformRingMat = new THREE.MeshBasicMaterial({
    color: 0xf59e0b,
    transparent: true,
    opacity: 0.85,
    side: THREE.DoubleSide,
  });
  private readonly terraformSrcRing: THREE.Mesh;
  private readonly terraformLinkLine: THREE.Line;
  private readonly terraformElevCanvas: HTMLCanvasElement;
  private readonly terraformElevTex: THREE.CanvasTexture;
  private readonly terraformElevSprite: THREE.Sprite;
  private lastTerraformElevKey = '';
  private readonly tunnelDragGroup = new THREE.Group();
  private readonly tunnelLinksGroup = new THREE.Group();
  private readonly xrayScene = new THREE.Scene();
  private readonly tunnelXrayCorridorGroup = new THREE.Group();
  private readonly tunnelXrayCanvas: HTMLCanvasElement;
  private readonly tunnelXrayTex: THREE.CanvasTexture;
  private readonly tunnelXraySprite: THREE.Sprite;
  private lastTunnelXrayLabel = '';
  private readonly placementHintCanvas: HTMLCanvasElement;
  private readonly placementHintTex: THREE.CanvasTexture;
  private readonly placementHintSprite: THREE.Sprite;
  private lastPlacementHintText = '';
  private readonly beaconRangeRing: THREE.Mesh;
  private readonly soilProgressGroup = new THREE.Group();
  private readonly shoreFishingGroup = new THREE.Group();
  private readonly rodMat = new THREE.MeshStandardMaterial({ color: 0x8b5a2b, roughness: 0.85 });
  private readonly lineMat = new THREE.LineBasicMaterial({ color: 0xe2e8f0, transparent: true, opacity: 0.88 });
  private readonly bobberMat = new THREE.MeshBasicMaterial({ color: 0xef4444 });
  private readonly netMat = new THREE.MeshBasicMaterial({
    color: 0xd6c7a1,
    wireframe: true,
    transparent: true,
    opacity: 0.85,
  });
  private readonly fishRippleMat = new THREE.MeshBasicMaterial({
    color: 0xbae6fd,
    transparent: true,
    opacity: 0.55,
    side: THREE.DoubleSide,
  });
  private readonly rodGeom = new THREE.CylinderGeometry(0.02, 0.035, 2.35, 5);
  private readonly bobberGeom = new THREE.SphereGeometry(0.11, 6, 5);
  private readonly netGeom = new THREE.CircleGeometry(1.15, 10);
  private readonly fishRippleGeom = new THREE.RingGeometry(0.35, 0.52, 16);
  private readonly tunnelTexLoader = new THREE.TextureLoader();
  private tunnelRockTex: THREE.Texture | null = null;
  private tunnelFloorTex: THREE.Texture | null = null;
  private tunnelRibTex: THREE.Texture | null = null;
  private readonly soilMarkers = new Map<
    number,
    {
      group: THREE.Group;
      ringMat: THREE.MeshBasicMaterial;
      patchMesh: THREE.Mesh;
      patchMat: THREE.MeshBasicMaterial;
      sprite: THREE.Sprite;
      canvas: HTMLCanvasElement;
      tex: THREE.CanvasTexture;
      lastKey: string;
    }
  >();

  // Rally point marker (authentic 0 A.D. waypoint banner flag)
  private readonly rallyLine: THREE.Line;
  private readonly rallyFlag: THREE.Group;
  private rallyFlagCiv: CivId | null = null;
  private rallyFlagIsZeroAD = false;
  private rallyFlagAnimator: UnitAnimator | null = null;

  private readonly arrowGeom = new THREE.CylinderGeometry(0.03, 0.03, 0.95, 4);
  private readonly boltGeom = new THREE.CylinderGeometry(0.055, 0.055, 1.55, 5);
  private readonly boulderGeom = new THREE.DodecahedronGeometry(0.32, 0);
  private readonly arrowMat = new THREE.MeshBasicMaterial({ color: 0xfef08a });
  private readonly javelinMat = new THREE.MeshBasicMaterial({ color: 0xfca5a5 });
  private readonly fireArrowMat = new THREE.MeshBasicMaterial({ color: 0xff6b00 });
  private readonly boltMat = new THREE.MeshBasicMaterial({ color: 0xe2e8f0 });
  private readonly boulderMat = new THREE.MeshStandardMaterial({ color: 0x9ca3af, roughness: 0.92 });
  private readonly flamingBoulderMat = new THREE.MeshBasicMaterial({ color: 0xff5500 });

  constructor(container: HTMLElement, world: World) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(container.clientWidth, container.clientHeight);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.08;
    container.appendChild(this.renderer.domElement);

    this.scene = new THREE.Scene();
    const mapType = world.terrain.resolvedMapType;
    const skyHex =
      mapType === 'volcano'
        ? 0x7c5342
        : mapType === 'swamp'
          ? 0x8ea69a
          : mapType === 'rainforest'
            ? 0x8ec5b4
            : mapType === 'inland_oasis' || mapType === 'mesa'
              ? 0xdec8a0
              : mapType === 'alpine_passes' || mapType === 'mountain'
                ? 0xc2d8ea
                : 0x9bc8e4;
    const fogDensity =
      mapType === 'swamp' ? 0.0042 : mapType === 'volcano' ? 0.0036 : mapType === 'inland_oasis' ? 0.0024 : 0.0028;
    this.scene.background = new THREE.Color(skyHex);
    this.scene.fog = new THREE.FogExp2(skyHex, fogDensity);

    // Biome-aware sunlight
    const hemiSky = mapType === 'inland_oasis' ? 0xfff1d6 : mapType === 'alpine_passes' ? 0xe0f2fe : 0xdbeafe;
    const hemiGround = mapType === 'inland_oasis' ? 0xa38554 : mapType === 'alpine_passes' ? 0x7c8a96 : 0x8a7554;
    const hemi = new THREE.HemisphereLight(hemiSky, hemiGround, 0.75);
    this.scene.add(hemi);

    const sunColor = mapType === 'inland_oasis' ? 0xffe8b8 : mapType === 'alpine_passes' ? 0xf5faff : 0xfff4d6;
    const sun = new THREE.DirectionalLight(sunColor, mapType === 'inland_oasis' ? 1.75 : 1.65);
    const halfWorld = world.terrain.worldSize * 0.5;
    sun.position.set(halfWorld + 38, 135, halfWorld - 32);
    sun.castShadow = true;
    sun.shadow.mapSize.width = 2048;
    sun.shadow.mapSize.height = 2048;
    sun.shadow.camera.near = 20;
    sun.shadow.camera.far = Math.max(420, world.terrain.worldSize * 1.85);
    const d = Math.max(155, world.terrain.worldSize * 0.62);
    sun.shadow.camera.left = -d;
    sun.shadow.camera.right = d;
    sun.shadow.camera.top = d;
    sun.shadow.camera.bottom = -d;
    sun.shadow.bias = -0.0005;
    sun.target.position.set(halfWorld, 0, halfWorld);
    this.scene.add(sun);
    this.scene.add(sun.target);

    this.terrainRenderer = new TerrainRenderer(world.terrain);
    this.scene.add(this.terrainRenderer.group);
    preloadZeroADModels([world.config.playerCiv, world.config.aiCiv]);

    this.rtsCamera = new RTSCamera(container.clientWidth / Math.max(1, container.clientHeight), world.terrain);

    // Rally line & flag
    const lineGeom = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]);
    this.rallyLine = new THREE.Line(
      lineGeom,
      new THREE.LineBasicMaterial({ color: 0xfef08a, transparent: true, opacity: 0.85 })
    );
    this.rallyLine.visible = false;
    this.scene.add(this.rallyLine);

    this.rallyFlag = new THREE.Group();
    this.rallyFlag.visible = false;
    this.scene.add(this.rallyFlag);
    this.scene.add(this.wallDragGroup);

    const tfRingGeom = new THREE.RingGeometry(1.75, 2.35, 28);
    tfRingGeom.rotateX(-Math.PI / 2);
    this.terraformRing = new THREE.Mesh(tfRingGeom, this.terraformRingMat);
    this.terraformRing.visible = false;
    this.scene.add(this.terraformRing);

    this.terraformSrcRing = new THREE.Mesh(
      tfRingGeom.clone(),
      new THREE.MeshBasicMaterial({ color: 0xf59e0b, transparent: true, opacity: 0.9, side: THREE.DoubleSide })
    );
    this.terraformSrcRing.visible = false;
    this.scene.add(this.terraformSrcRing);

    const tfLineGeom = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]);
    this.terraformLinkLine = new THREE.Line(
      tfLineGeom,
      new THREE.LineBasicMaterial({ color: 0xfbbf24, transparent: true, opacity: 0.9 })
    );
    this.terraformLinkLine.visible = false;
    this.scene.add(this.terraformLinkLine);
    this.scene.add(this.tunnelDragGroup);
    this.scene.add(this.tunnelLinksGroup);
    this.scene.add(this.soilProgressGroup);
    this.netGeom.rotateX(-Math.PI / 2);
    this.fishRippleGeom.rotateX(-Math.PI / 2);
    this.scene.add(this.shoreFishingGroup);

    // Dedicated X-Ray Scene for underground vaulted tunnels + REAL 0 A.D. animated underground workers & travelers!
    const xrayHemi = new THREE.HemisphereLight(0xffe8c2, 0x3b2c1a, 1.35);
    const xrayDir = new THREE.DirectionalLight(0xfff1d6, 1.4);
    xrayDir.position.set(25, 45, 25);
    this.xrayScene.add(xrayHemi, xrayDir, this.tunnelXrayCorridorGroup);

    // Floating X-Ray status banner shown when inspecting a selected underground tunnel
    this.tunnelXrayCanvas = document.createElement('canvas');
    this.tunnelXrayCanvas.width = 440;
    this.tunnelXrayCanvas.height = 68;
    this.tunnelXrayTex = new THREE.CanvasTexture(this.tunnelXrayCanvas);
    this.tunnelXrayTex.minFilter = THREE.LinearFilter;
    this.tunnelXraySprite = new THREE.Sprite(
      new THREE.SpriteMaterial({ map: this.tunnelXrayTex, transparent: true, depthTest: false })
    );
    this.tunnelXraySprite.scale.set(7.8, 1.25, 1);
    this.tunnelXraySprite.renderOrder = 15;
    this.tunnelXraySprite.visible = false;
    this.scene.add(this.tunnelXraySprite);

    // Floating red placement-blocked reason badge shown when hovering invalid building spots
    this.placementHintCanvas = document.createElement('canvas');
    this.placementHintCanvas.width = 420;
    this.placementHintCanvas.height = 64;
    this.placementHintTex = new THREE.CanvasTexture(this.placementHintCanvas);
    this.placementHintTex.minFilter = THREE.LinearFilter;
    this.placementHintSprite = new THREE.Sprite(
      new THREE.SpriteMaterial({ map: this.placementHintTex, transparent: true, depthTest: false })
    );
    this.placementHintSprite.scale.set(6.8, 1.05, 1);
    this.placementHintSprite.renderOrder = 18;
    this.placementHintSprite.visible = false;
    this.scene.add(this.placementHintSprite);

    // Translucent ground signal/rally radius ring shown when a Great Wall Beacon Tower is selected
    const beaconRingGeom = new THREE.RingGeometry(0.975, 1.0, 64);
    beaconRingGeom.rotateX(-Math.PI / 2);
    this.beaconRangeRing = new THREE.Mesh(
      beaconRingGeom,
      new THREE.MeshBasicMaterial({
        color: 0xf97316,
        transparent: true,
        opacity: 0.45,
        side: THREE.DoubleSide,
        depthWrite: false,
      })
    );
    this.beaconRangeRing.visible = false;
    this.scene.add(this.beaconRangeRing);

    // Floating elevation height label shown while hovering in Dig / Raise / Level mode!
    this.terraformElevCanvas = document.createElement('canvas');
    this.terraformElevCanvas.width = 256;
    this.terraformElevCanvas.height = 56;
    this.terraformElevTex = new THREE.CanvasTexture(this.terraformElevCanvas);
    this.terraformElevTex.minFilter = THREE.LinearFilter;
    this.terraformElevSprite = new THREE.Sprite(
      new THREE.SpriteMaterial({ map: this.terraformElevTex, transparent: true, depthTest: false })
    );
    this.terraformElevSprite.scale.set(3.2, 0.72, 1);
    this.terraformElevSprite.renderOrder = 16;
    this.terraformElevSprite.visible = false;
    this.scene.add(this.terraformElevSprite);
  }

  resize(width: number, height: number): void {
    this.renderer.setSize(width, height);
    this.rtsCamera.resize(width / Math.max(1, height));
  }

  spawnClickPing(x: number, z: number, terrainY: number, color = 0x4ade80): void {
    const geom = new THREE.RingGeometry(0.35, 0.58, 24);
    geom.rotateX(-Math.PI / 2);
    const mat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.95, side: THREE.DoubleSide });
    const mesh = new THREE.Mesh(geom, mat);
    mesh.position.set(x, terrainY + 0.16, z);
    this.scene.add(mesh);
    this.pings.push({ mesh, age: 0, duration: 0.55 });
  }

  /** Displays or hides the floating placement-blocked reason badge directly over the invalid ghost/preview */
  updatePlacementHint(x: number, y: number, z: number, reason: string | null): void {
    if (!reason) {
      this.placementHintSprite.visible = false;
      return;
    }
    this.placementHintSprite.position.set(x, Math.max(WATER_LEVEL + 0.8, y) + 3.4, z);
    this.placementHintSprite.visible = true;
    const text = `❌ ${reason}`;
    if (this.lastPlacementHintText !== text) {
      this.lastPlacementHintText = text;
      const ctx = this.placementHintCanvas.getContext('2d');
      if (ctx) {
        ctx.clearRect(0, 0, 420, 64);
        ctx.fillStyle = 'rgba(45, 10, 14, 0.92)';
        ctx.strokeStyle = '#ef4444';
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.roundRect(6, 6, 408, 52, 11);
        ctx.fill();
        ctx.stroke();
        ctx.font = 'bold 20px system-ui, sans-serif';
        ctx.fillStyle = '#fecaca';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(text, 210, 32, 388);
        this.placementHintTex.needsUpdate = true;
      }
    }
  }

  updateGhostPreview(
    templateId: string | null,
    civId: CivId,
    x: number,
    z: number,
    y: number,
    isValid: boolean,
    facingY = 0,
    invalidReason?: string | null
  ): void {
    if (!templateId) {
      if (this.ghostGroup) {
        this.scene.remove(this.ghostGroup);
        this.ghostGroup = null;
        this.ghostTemplateId = null;
      }
      this.placementHintSprite.visible = false;
      return;
    }

    if (this.ghostTemplateId !== templateId) {
      if (this.ghostGroup) this.scene.remove(this.ghostGroup);
      const vis = createEntityVisual(templateId, civId, 0x22c55e);
      this.ghostGroup = vis.root;
      this.ghostTemplateId = templateId;
      this.scene.add(this.ghostGroup);
    }

    if (this.ghostGroup) {
      const gTpl = TEMPLATES[templateId];
      const gy = gTpl?.isDock ? WATER_LEVEL + 0.08 : gTpl?.isBridge ? WATER_LEVEL + 0.14 : y;
      this.ghostGroup.position.set(x, gy, z);
      this.ghostGroup.rotation.y = facingY;
      const mat = isValid ? this.ghostValidMat : this.ghostInvalidMat;
      this.ghostGroup.traverse((obj) => {
        if (obj instanceof THREE.Mesh) {
          obj.material = mat;
          obj.castShadow = false;
        }
      });
      this.updatePlacementHint(x, gy, z, !isValid && invalidReason ? invalidReason : null);
    }
  }

  updateWallLinePreview(
    segments: Array<{ x: number; y: number; z: number; facing: number; valid: boolean; slopeYX?: number; reason?: string }>,
    isBridge = false
  ): void {
    this.wallDragGroup.clear();
    const geom = isBridge ? this.bridgePreviewGeom : this.wallPreviewGeom;
    let firstInvalid: { x: number; y: number; z: number; reason: string } | null = null;
    for (const seg of segments) {
      const holder = new THREE.Group();
      holder.position.set(seg.x, isBridge ? WATER_LEVEL + 0.48 : seg.y + 1.18, seg.z);
      holder.rotation.y = seg.facing;
      const m = new THREE.Mesh(geom, seg.valid ? this.ghostValidMat : this.ghostInvalidMat);
      if (!isBridge && seg.slopeYX) {
        m.matrixAutoUpdate = false;
        m.matrix.identity();
        m.matrix.elements[1] = seg.slopeYX;
        m.matrixWorldNeedsUpdate = true;
      }
      holder.add(m);
      this.wallDragGroup.add(holder);
      if (!seg.valid && seg.reason && !firstInvalid) {
        firstInvalid = { x: seg.x, y: seg.y, z: seg.z, reason: seg.reason };
      }
    }
    if (firstInvalid) {
      this.updatePlacementHint(firstInvalid.x, firstInvalid.y, firstInvalid.z, firstInvalid.reason);
    } else if (segments.length === 0 || segments.every((s) => s.valid)) {
      this.placementHintSprite.visible = false;
    }
  }

  updateTerraformPreview(
    x: number,
    y: number,
    z: number,
    mode: TerraformMode | null,
    isValid: boolean,
    pendingSrc?: { x: number; y: number; z: number } | null
  ): void {
    if (!mode) {
      this.terraformRing.visible = false;
      this.terraformSrcRing.visible = false;
      this.terraformLinkLine.visible = false;
      this.terraformElevSprite.visible = false;
      return;
    }
    const curY = Math.max(WATER_LEVEL + 0.08, y + 0.18);
    this.terraformRing.visible = true;
    this.terraformRing.position.set(x, curY, z);
    const ringHex = !isValid
      ? 0xef4444
      : pendingSrc
        ? 0x22c55e
        : mode === 'level'
          ? 0x38bdf8
          : mode === 'dig'
            ? 0xf59e0b
            : 0x22c55e;
    this.terraformRingMat.color.setHex(ringHex);

    // Show crisp ground elevation badge above hovered tile (e.g. "⛰ 高 2.4m" or "⛰ 3.1m → 1.4m")!
    this.terraformElevSprite.visible = true;
    this.terraformElevSprite.position.set(x, curY + 1.55, z);
    const elevStr = pendingSrc
      ? `⛰ ${pendingSrc.y.toFixed(1)}m → ${y.toFixed(1)}m`
      : `⛰ 高度 ${y >= 0 ? '+' : ''}${y.toFixed(1)}m`;
    const elevKey = `${elevStr}_${ringHex}`;
    if (this.lastTerraformElevKey !== elevKey) {
      this.lastTerraformElevKey = elevKey;
      const ctx = this.terraformElevCanvas.getContext('2d');
      if (ctx) {
        ctx.clearRect(0, 0, 256, 56);
        ctx.fillStyle = 'rgba(15, 23, 42, 0.88)';
        ctx.strokeStyle = `#${ringHex.toString(16).padStart(6, '0')}`;
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.roundRect(6, 4, 244, 48, 10);
        ctx.fill();
        ctx.stroke();
        ctx.font = 'bold 24px system-ui, sans-serif';
        ctx.fillStyle = '#f8fafc';
        ctx.textAlign = 'center';
        ctx.fillText(elevStr, 128, 36);
        this.terraformElevTex.needsUpdate = true;
      }
    }

    if (pendingSrc) {
      const srcY = Math.max(WATER_LEVEL + 0.08, pendingSrc.y + 0.22);
      this.terraformSrcRing.visible = true;
      this.terraformSrcRing.position.set(pendingSrc.x, srcY, pendingSrc.z);
      this.terraformLinkLine.visible = true;
      const posAttr = this.terraformLinkLine.geometry.attributes.position as THREE.BufferAttribute;
      posAttr.setXYZ(0, pendingSrc.x, srcY + 0.4, pendingSrc.z);
      posAttr.setXYZ(1, x, curY + 0.4, z);
      posAttr.needsUpdate = true;
    } else {
      this.terraformSrcRing.visible = false;
      this.terraformLinkLine.visible = false;
    }
  }

  /** Draws live dragged straight-line hidden underground tunnel preview from entrance to exit! */
  updateTunnelDragPreview(
    start: { x: number; y: number; z: number } | null,
    end: { x: number; y: number; z: number } | null,
    valid: boolean
  ): void {
    this.tunnelDragGroup.clear();
    if (!start || !end) return;

    const col = valid ? 0x38bdf8 : 0xef4444;
    const ringGeom = new THREE.RingGeometry(1.4, 2.0, 24);
    ringGeom.rotateX(-Math.PI / 2);
    const ringMat = new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: 0.9, side: THREE.DoubleSide });
    const rA = new THREE.Mesh(ringGeom, ringMat);
    rA.position.set(start.x, start.y + 0.22, start.z);
    const rB = new THREE.Mesh(ringGeom, ringMat);
    rB.position.set(end.x, end.y + 0.22, end.z);
    this.tunnelDragGroup.add(rA, rB);

    // Straight hidden underground tunnel tube preview rendered through mountains (depthTest: false so visible underground!)
    const pts = [new THREE.Vector3(start.x, start.y + 0.7, start.z), new THREE.Vector3(end.x, end.y + 0.7, end.z)];
    const lineGeom = new THREE.BufferGeometry().setFromPoints(pts);
    const lineMat = new THREE.LineDashedMaterial({
      color: col,
      dashSize: 1.2,
      gapSize: 0.65,
      transparent: true,
      opacity: 0.95,
      depthTest: false,
    });
    const line = new THREE.Line(lineGeom, lineMat);
    line.computeLineDistances();
    line.renderOrder = 12;
    this.tunnelDragGroup.add(line);
  }

  syncAndRender(
    world: World,
    humanPlayerId: number,
    selectedIds: Set<number>,
    alpha: number,
    dt: number,
    elapsedSec: number
  ): void {
    this.rtsCamera.update(dt);
    this.terrainRenderer.update(world, humanPlayerId, elapsedSec);

    const revealAll = this.terrainRenderer.isRevealAll();
    const seen = new Set<number>();

    // Pre-collect fortification nodes (walls, gates, beacon towers) for zero-gap continuous 0 A.D. wall stitching!
    const wallNodes: Entity[] = [];
    for (const e of world.entities.values()) {
      if (!e.alive) continue;
      const t = TEMPLATES[e.templateId];
      if (t.isWall || t.isGate || t.isBeaconTower) {
        wallNodes.push(e);
      }
    }

    // Identify currently selected underground tunnel pair (if any) so REAL 0 A.D. underground unit models render via xrayScene!
    let selectedTunnelPair: { a: Entity; b: Entity; ay: number; by: number } | null = null;
    for (const selId of selectedIds) {
      const selE = world.entities.get(selId);
      if (selE && selE.alive && selE.owner === humanPlayerId && selE.linkedTunnelId) {
        const partner = world.entities.get(selE.linkedTunnelId);
        if (partner && partner.alive) {
          // Canonicalize order so portalA is the foundation anchor (or smaller id)
          const a = selE.id < partner.id ? selE : partner;
          const b = selE.id < partner.id ? partner : selE;
          selectedTunnelPair = {
            a,
            b,
            ay: world.terrain.getHeightAt(a.x, a.z),
            by: world.terrain.getHeightAt(b.x, b.z),
          };
          break;
        }
      }
    }
    const xrayUndergroundRoots: THREE.Group[] = [];

    // 1. Sync Entities
    for (const e of world.entities.values()) {
      if (!e.alive) continue;
      seen.add(e.id);

      let mv = this.visuals.get(e.id);
      if (!mv || mv.owner !== e.owner || mv.templateId !== e.templateId) {
        if (mv) {
          this.scene.remove(mv.parts.root);
          this.visuals.delete(e.id);
        }
        mv = this.createManagedVisual(e, world);
        this.visuals.set(e.id, mv);
        this.scene.add(mv.parts.root);
      }

      // Visibility rules (garrisoned, underground in tunnel transit/shaft excavation, or shrouded enemy units)
      const tpl = TEMPLATES[e.templateId];
      const inTunnelTransit = e.order.type === 'enter_tunnel' && (e.order.transitRemaining ?? 0) > 0;
      const inTunnelShaft = e.order.type === 'build' && Boolean(e.order.inShaft);
      const isUndergroundInSelectedTunnel =
        selectedTunnelPair !== null &&
        ((inTunnelShaft &&
          e.order.type === 'build' &&
          (e.order.targetId === selectedTunnelPair.a.id || e.order.targetId === selectedTunnelPair.b.id)) ||
          (inTunnelTransit &&
            e.order.type === 'enter_tunnel' &&
            (e.order.portalId === selectedTunnelPair.a.id ||
              e.order.portalId === selectedTunnelPair.b.id ||
              e.order.exitPortalId === selectedTunnelPair.a.id ||
              e.order.exitPortalId === selectedTunnelPair.b.id)));

      let visible = e.garrisonedIn === null && ((!inTunnelTransit && !inTunnelShaft) || isUndergroundInSelectedTunnel);
      if (visible && !revealAll && e.owner !== humanPlayerId) {
        if (tpl.kind === 'unit') {
          visible = world.fog.isVisibleTo(humanPlayerId, e.x, e.z);
        } else {
          visible = world.fog.isExploredBy(humanPlayerId, e.x, e.z);
        }
      }
      mv.parts.root.visible = visible;
      if (!visible) continue;

      const ix = e.prevX + (e.x - e.prevX) * alpha;
      const iz = e.prevZ + (e.z - e.prevZ) * alpha;
      let iy: number;
      let wallAutoFacing: number | null = null;
      if (isUndergroundInSelectedTunnel && selectedTunnelPair) {
        // Place REAL 0 A.D. animated worker/soldier right on the underground tunnel floor!
        const { a, b, ay, by } = selectedTunnelPair;
        const tdx = b.x - a.x;
        const tdz = b.z - a.z;
        const tLenSq = Math.max(0.01, tdx * tdx + tdz * tdz);
        const projT = Math.max(0, Math.min(1, ((ix - a.x) * tdx + (iz - a.z) * tdz) / tLenSq));
        iy = ay + (by - ay) * projT + 0.02;
        xrayUndergroundRoots.push(mv.parts.root);
      } else if (tpl.isFlying) {
        const groundOrWater = Math.max(world.terrain.getHeightAt(ix, iz), WATER_LEVEL);
        iy = groundOrWater + (tpl.flightAltitude ?? 12.5) + Math.sin(elapsedSec * 1.55 + e.id * 1.3) * 0.85;
      } else if (tpl.isSeaMonster) {
        iy = WATER_LEVEL - 0.1 + Math.sin(elapsedSec * 1.85 + e.id * 1.4) * 0.14;
      } else if (tpl.isNaval) {
        iy = WATER_LEVEL + 0.04 + Math.sin(elapsedSec * 2.2 + e.id * 1.7) * 0.05;
      } else if (tpl.isDock) {
        iy = WATER_LEVEL + 0.08;
      } else if (tpl.isBridge) {
        iy = WATER_LEVEL + 0.14;
      } else if (tpl.isAquatic) {
        iy = WATER_LEVEL - 0.12;
      } else if (tpl.isWall && mv.parts.wallShearGroup) {
        // Continuous 0 A.D. wall auto-stitching: align & scale smoothly across adjacent wall/gate/beacon neighbors with 0 gaps!
        const adj: Array<{ ent: Entity; dist: number; dx: number; dz: number }> = [];
        for (let wi = 0; wi < wallNodes.length; wi++) {
          const nb = wallNodes[wi];
          if (nb.id === e.id || nb.owner !== e.owner) continue;
          const dx = nb.x - ix;
          const dz = nb.z - iz;
          const dist = Math.hypot(dx, dz);
          const maxLink = TEMPLATES[nb.templateId].isGate ? 5.2 : 3.35;
          if (dist >= 1.2 && dist <= maxLink) {
            adj.push({ ent: nb, dist, dx, dz });
          }
        }
        adj.sort((a1, a2) => a1.dist - a2.dist);

        let useFacing = e.facing;
        let spanMeters = 2.65;
        let showBastion = adj.length <= 1;

        if (adj.length >= 2) {
          const n1 = adj[0];
          const n2 = adj[1];
          // Check angle between the two neighbors: straight/gentle curve -> smooth continuous wall; sharp corner -> bastion turret!
          const dot = (n1.dx * n2.dx + n1.dz * n2.dz) / Math.max(0.01, n1.dist * n2.dist);
          if (dot < -0.55) {
            // Neighbors are roughly opposite: bridge smoothly along vector from n1 -> n2!
            const vx = n2.ent.x - n1.ent.x;
            const vz = n2.ent.z - n1.ent.z;
            useFacing = Math.atan2(-vz, vx);
            spanMeters = Math.min(3.55, Math.max(2.15, Math.hypot(vx, vz) * 0.56));
            showBastion = dot > -0.9; // Add corner turret only on bends > ~25 deg
          } else {
            // Sharp 90-deg corner!
            useFacing = Math.atan2(-n1.dz, n1.dx);
            spanMeters = Math.min(3.2, Math.max(2.2, n1.dist * 1.05));
            showBastion = true;
          }
        } else if (adj.length === 1) {
          const n1 = adj[0];
          useFacing = Math.atan2(-n1.dz, n1.dx);
          spanMeters = Math.min(3.25, Math.max(2.2, n1.dist * 1.08));
          showBastion = true;
        }

        wallAutoFacing = useFacing;
        const scaleX = spanMeters / 2.0;
        const halfSpan = spanMeters * 0.5;
        const cosF = Math.cos(useFacing);
        const sinF = Math.sin(useFacing);
        const hPlus = world.terrain.getHeightAt(ix + cosF * halfSpan, iz - sinF * halfSpan);
        const hMinus = world.terrain.getHeightAt(ix - cosF * halfSpan, iz + sinF * halfSpan);
        iy = (hPlus + hMinus) * 0.5;
        const slopeYX = THREE.MathUtils.clamp((hPlus - hMinus) / Math.max(0.5, halfSpan * 2), -1.35, 1.35);
        const sg = mv.parts.wallShearGroup;
        sg.matrixAutoUpdate = false;
        sg.matrix.identity();
        sg.matrix.elements[0] = scaleX; // Stretch wall curtain cleanly across exact neighbor spacing
        sg.matrix.elements[1] = slopeYX * scaleX; // y' = y + slopeYX * (scaleX * x) -> exact plumb vertical wall matching slope!
        sg.matrixWorldNeedsUpdate = true;

        if (mv.parts.wallCornerBastion) {
          mv.parts.wallCornerBastion.visible = showBastion && !e.isFoundation;
        }
      } else if (tpl.kind === 'building' && !tpl.isFarmField) {
        // Seat land buildings flush on the ground at centerY (0 A.D. buildings already have real underground foundations!)
        iy = world.terrain.getHeightAt(ix, iz);
      } else {
        const groundY = world.terrain.getHeightAt(ix, iz);
        const uTile = world.terrain.worldToTile(ix, iz);
        iy =
          tpl.kind === 'unit' && world.terrain.isTileBridge(uTile.tx, uTile.tz)
            ? Math.max(groundY, WATER_LEVEL + 0.68)
            : groundY;
      }
      mv.parts.root.position.set(ix, iy, iz);
      if (tpl.isRuinPillar) {
        const ratio = Math.max(0.28, e.resourceRemaining / Math.max(1, tpl.resourceAmount ?? 380));
        mv.parts.bodyGroup.scale.y = 0.35 + ratio * 0.65;
      }

      // Smooth shortest-arc angular turn for units & ALL land/sea wildlife (so dead animals collapse properly!)
      const isPrey =
        e.templateId === 'deer_herd' ||
        e.templateId === 'wild_boar' ||
        e.templateId === 'wild_gazelle' ||
        e.templateId === 'wild_elephant' ||
        Boolean(tpl.isPassiveFauna) ||
        Boolean(tpl.isPredator);
      if (tpl.kind === 'unit' || isPrey) {
        if (!mv.facingInit) {
          mv.smoothFacing = e.facing;
          mv.facingInit = true;
        } else {
          let diff = e.facing - mv.smoothFacing;
          while (diff > Math.PI) diff -= Math.PI * 2;
          while (diff < -Math.PI) diff += Math.PI * 2;
          const turnLerp = Math.min(1, dt * (isPrey ? 9 : 13));
          mv.smoothFacing += diff * turnLerp;
        }
        mv.parts.bodyGroup.rotation.y = mv.smoothFacing;
      } else {
        const bFacing = wallAutoFacing !== null ? wallAutoFacing : e.facing;
        mv.parts.bodyGroup.rotation.y = bFacing;
        if (mv.parts.foundationPlinth) {
          mv.parts.foundationPlinth.rotation.y = bFacing;
        }
      }

      // Construction rise animation for foundations + gradual crop growth & breeze sway on Wheat Fields
      if (tpl.kind === 'building') {
        if (tpl.isFarmField) {
          // Keep soil decal & fence flat on ground while wheat stalks sprout & grow gradually
          mv.parts.bodyGroup.scale.y = 1.0;
          if (mv.parts.cropGroup) {
            const foodMax = tpl.farmFoodTotal ?? 1600;
            if (e.isFoundation) {
              // Seeds germinate only after ploughing reaches 25%, emerging as tiny green shoots
              const targetGrow = e.buildProgress > 0.25 ? ((e.buildProgress - 0.25) / 0.75) * 0.16 : 0;
              mv.fieldGrowth += (targetGrow - mv.fieldGrowth) * Math.min(1, dt * 4);
              mv.lastResourceRemaining = e.resourceRemaining;
            } else {
              // Detect automatic replanting when depleted field refreshes food -> restart growth from tiny shoots
              if (mv.lastResourceRemaining >= 0 && e.resourceRemaining > mv.lastResourceRemaining + 120) {
                mv.fieldGrowth = 0.04;
              }
              mv.lastResourceRemaining = e.resourceRemaining;
              // Gradual ~18s growth cycle from seedling to tall golden wheat
              mv.fieldGrowth = Math.min(1.0, mv.fieldGrowth + dt * 0.055);
            }

            if (mv.fieldGrowth <= 0.015) {
              mv.parts.cropGroup.visible = false;
            } else {
              mv.parts.cropGroup.visible = true;
              const smoothG = mv.fieldGrowth * mv.fieldGrowth * (3 - 2 * mv.fieldGrowth);
              const harvestRatio = e.isFoundation ? 1.0 : Math.max(0.32, e.resourceRemaining / Math.max(1, foodMax));
              const cropScaleY = Math.max(0.04, (0.06 + smoothG * 0.98) * (0.45 + harvestRatio * 0.55));
              const cropScaleXZ = 0.52 + smoothG * 0.48;
              mv.parts.cropGroup.scale.set(cropScaleXZ, cropScaleY, cropScaleXZ);

              if (mv.parts.cropMat) {
                if (mv.fieldGrowth < 0.55) {
                  CROP_TEMP_COLOR.copy(CROP_SPROUT_COLOR).lerp(CROP_MID_COLOR, mv.fieldGrowth / 0.55);
                } else {
                  CROP_TEMP_COLOR.copy(CROP_MID_COLOR).lerp(CROP_RIPE_COLOR, (mv.fieldGrowth - 0.55) / 0.45);
                }
                mv.parts.cropMat.color.copy(CROP_TEMP_COLOR);
              }

              const swayAmp = 0.01 + smoothG * 0.028;
              mv.parts.cropGroup.rotation.z = Math.sin(elapsedSec * 1.9 + e.id * 1.3) * swayAmp;
              mv.parts.cropGroup.rotation.x = Math.cos(elapsedSec * 1.5 + e.id * 0.9) * (swayAmp * 0.72);
            }
          }
        } else {
          const sY = e.isFoundation ? 0.18 + e.buildProgress * 0.82 : 1.0;
          mv.parts.bodyGroup.scale.y = sY;
          if (tpl.isApartment) {
            const floors = e.floors ?? 2;
            if (mv.parts.floor2Roof) mv.parts.floor2Roof.visible = floors < 3;
            if (mv.parts.floor3Group) mv.parts.floor3Group.visible = floors >= 3;
          }
          // Animated Stone Gate double doors & Crimson Lock Bar
          if (tpl.isGate && mv.parts.gateDoorLeft && mv.parts.gateDoorRight) {
            const openAmt = e.gateOpenAmount ?? 0;
            mv.parts.gateDoorLeft.rotation.y = -openAmt * (Math.PI * 0.48);
            mv.parts.gateDoorRight.rotation.y = openAmt * (Math.PI * 0.48);
            if (mv.parts.gateLockBar) {
              mv.parts.gateLockBar.visible = e.gateMode === 'locked' && openAmt < 0.15;
            }
          }
          // Great Wall Beacon Tower 3 visual tiers + blazing signal fire & soaring wolf-smoke column!
          if (tpl.isBeaconTower) {
            const lv = e.beaconLevel ?? 1;
            if (mv.parts.beaconTier2) mv.parts.beaconTier2.visible = lv >= 2;
            if (mv.parts.beaconTier3) mv.parts.beaconTier3.visible = lv >= 3;
            const lit = (e.beaconLitTimer ?? 0) > 0;
            const fireBaseY = lv >= 3 ? 8.15 : lv === 2 ? 6.5 : 5.05;
            if (mv.parts.beaconFireGroup) {
              mv.parts.beaconFireGroup.visible = lit;
              if (lit) {
                mv.parts.beaconFireGroup.position.y = fireBaseY;
                const flick = 0.88 + Math.sin(elapsedSec * 14 + e.id * 2.1) * 0.18;
                const sway = Math.cos(elapsedSec * 9 + e.id) * 0.1;
                mv.parts.beaconFireGroup.scale.set(0.95 + sway, flick, 0.95 - sway);
              }
            }
            if (mv.parts.beaconSmokeGroup) {
              mv.parts.beaconSmokeGroup.visible = lit;
              if (lit) {
                mv.parts.beaconSmokeGroup.position.y = fireBaseY + 0.45;
                const puffs = mv.parts.beaconSmokeGroup.children;
                for (let pi = 0; pi < puffs.length; pi++) {
                  const cyc = (elapsedSec * 0.42 + pi / puffs.length + e.id * 0.17) % 1.0;
                  const puff = puffs[pi];
                  puff.position.set(
                    Math.sin(elapsedSec * 1.1 + pi * 1.4) * (0.25 + cyc * 1.45),
                    cyc * (11.5 + lv * 2.2),
                    Math.cos(elapsedSec * 0.9 + pi) * (0.2 + cyc * 0.9)
                  );
                  const sc = 0.55 + cyc * 1.45;
                  puff.scale.setScalar(sc);
                  const mat = (puff as THREE.Mesh).material as THREE.MeshBasicMaterial;
                  mat.opacity = Math.max(0.05, (1 - cyc) * 0.62);
                }
              }
            }
          }
        }
      } else if (tpl.kind === 'unit') {
        const gatherResType = e.order.type === 'gather' ? e.order.resourceType : null;
        const gatherTargetTpl =
          e.order.type === 'gather' ? world.entities.get(e.order.targetId)?.templateId ?? null : null;
        const speedMag = Math.hypot(e.vx, e.vz);
        const baseSpeed = tpl.speed ?? 6.0;
        const speedRatio = baseSpeed > 0.1 ? Math.max(0.75, speedMag / baseSpeed) : 1.0;

        if (mv.parts.animator) {
          mv.parts.animator.update(dt, e.animState, gatherResType, speedRatio, gatherTargetTpl);
        }

        const usingSkeletal = mv.parts.animator?.isPlayingSkeletal() ?? false;
        if (tpl.isNaval) {
          // Gentle sea wave pitch & roll + rhythmic Trireme rowing oars
          mv.parts.bodyGroup.position.y = 0;
          mv.parts.bodyGroup.rotation.x = Math.sin(elapsedSec * 1.9 + e.id) * 0.045;
          mv.parts.bodyGroup.rotation.z = Math.cos(elapsedSec * 1.6 + e.id * 0.8) * 0.055;
          if (mv.parts.oarGroup) {
            const rowRate = speedMag > 0.4 ? 6.5 : 1.6;
            mv.parts.oarGroup.rotation.x = Math.sin(elapsedSec * rowRate + e.id) * (speedMag > 0.4 ? 0.24 : 0.06);
          }
        } else if (usingSkeletal) {
          // Real 0 A.D. skeletal clip is driving bones; keep root grounded cleanly
          mv.parts.bodyGroup.position.y = 0;
          mv.parts.bodyGroup.rotation.x = e.animState === 'walk' ? 0.04 : 0;
          if (mv.parts.weaponPivot) mv.parts.weaponPivot.rotation.x = 0;
        } else {
          // Lightweight fallback motion until skeletal .dae finishes loading
          mv.parts.bodyGroup.position.y = e.animState === 'walk' ? Math.abs(Math.sin(e.animTime * 11)) * 0.12 : 0;
          mv.parts.bodyGroup.rotation.x = 0;
          if (mv.parts.weaponPivot) {
            if (e.animState === 'attack' || e.animState === 'gather' || e.animState === 'build') {
              mv.parts.weaponPivot.rotation.x = Math.sin(e.animTime * 12) * 0.65;
            } else {
              mv.parts.weaponPivot.rotation.x = 0;
            }
          }
        }

        if (mv.parts.rankBadge) {
          mv.parts.rankBadge.visible = e.rank >= 2;
          mv.parts.rankBadge.rotation.y = elapsedSec * 2.4;
          mv.parts.rankBadge.scale.setScalar(e.rank === 3 ? 1.35 : 0.9);
        }
      } else {
        // Animate wild deer & boars (graze when calm, flee/fight back when hunted, smoothly collapse when slain)
        const isSlainPrey = isPrey && e.hp <= 0;
        const preyAnimState = isSlainPrey ? 'death' : e.animState;
        const preySpeedMag = Math.hypot(e.vx, e.vz);
        const preySpeedRatio =
          preyAnimState === 'attack' ? 1.35 : preyAnimState === 'walk' ? Math.max(0.85, preySpeedMag / 3.8) : 1.0;
        if (mv.parts.animator) {
          mv.parts.animator.update(dt, preyAnimState, null, preySpeedRatio);
        }
        if (tpl.isFlying) {
          // Graceful wing flapping & subtle aerodynamic roll while gliding across the sky!
          const flapSpeed = e.templateId === 'wild_seagull' ? 7.8 : 5.4;
          const flapAmp = 0.58 * (0.45 + 0.55 * Math.max(0, Math.sin(elapsedSec * 0.75 + e.id)));
          const wingAngle = Math.sin(elapsedSec * flapSpeed + e.id * 1.9) * flapAmp;
          if (mv.parts.leftWing) mv.parts.leftWing.rotation.z = -wingAngle;
          if (mv.parts.rightWing) mv.parts.rightWing.rotation.z = wingAngle;
          mv.parts.bodyGroup.rotation.z = Math.sin(elapsedSec * 0.65 + e.id) * 0.18;
        } else if (tpl.isSeaMonster) {
          // Undulating Sea Dragon, Giant Octopus Kraken & Loch Ness Lake Monster animations!
          if (e.hp <= 0) {
            mv.parts.bodyGroup.position.y = -0.55;
            mv.parts.bodyGroup.rotation.z = Math.PI * 0.35;
          } else {
            mv.parts.bodyGroup.position.y = 0;
            mv.parts.bodyGroup.rotation.z = Math.sin(elapsedSec * 1.7 + e.id) * 0.06;
            if (mv.parts.seaMonsterCoils) {
              const attacking = e.animState === 'attack';
              const rate = attacking ? 5.6 : 2.3;
              if (e.templateId === 'sea_kraken') {
                // Giant Octopus: pulsing mantle head (index 0) + 8 sweeping tentacles (1..8)
                for (let ci = 0; ci < mv.parts.seaMonsterCoils.length; ci++) {
                  const part = mv.parts.seaMonsterCoils[ci];
                  if (ci === 0) {
                    part.position.y = Math.sin(elapsedSec * 2.1 + e.id) * 0.16;
                    part.rotation.x = Math.sin(elapsedSec * 1.5 + e.id) * 0.08;
                  } else {
                    part.rotation.x = Math.sin(elapsedSec * (rate * 0.9) + ci * 0.9 + e.id) * (attacking ? 0.28 : 0.14);
                    part.rotation.z = Math.cos(elapsedSec * (rate * 0.8) + ci * 1.2 + e.id) * (attacking ? 0.26 : 0.13);
                  }
                }
              } else if (e.templateId === 'lake_nessie') {
                // Loch Ness Plesiosaur: graceful swaying S-neck (0), bobbing hump (1), wagging tail (2), paddling flippers (3..6)
                for (let ci = 0; ci < mv.parts.seaMonsterCoils.length; ci++) {
                  const part = mv.parts.seaMonsterCoils[ci];
                  if (ci === 0) {
                    part.rotation.x = Math.sin(elapsedSec * (attacking ? 4.8 : 1.7) + e.id) * (attacking ? 0.24 : 0.08);
                    part.rotation.y = Math.cos(elapsedSec * 1.25 + e.id) * 0.18;
                  } else if (ci === 1) {
                    part.position.y = Math.sin(elapsedSec * 1.8 + e.id) * 0.1;
                  } else if (ci === 2) {
                    part.rotation.y = Math.sin(elapsedSec * 2.5 + e.id) * 0.22;
                  } else {
                    const sideSign = ci % 2 === 1 ? -1 : 1;
                    part.rotation.z = sideSign * Math.sin(elapsedSec * 3.1 + ci * 0.8 + e.id) * 0.24;
                  }
                }
              } else {
                // Sea Dragon: lunging neck (0), breaching back coils (1..2), beating wing-fins (3..4), swishing tail (5)
                for (let ci = 0; ci < mv.parts.seaMonsterCoils.length; ci++) {
                  const coil = mv.parts.seaMonsterCoils[ci];
                  if (ci === 0) {
                    coil.rotation.x = Math.sin(elapsedSec * rate + e.id) * (attacking ? 0.28 : 0.09);
                    coil.rotation.y = Math.cos(elapsedSec * 1.6 + e.id) * 0.14;
                  } else if (ci <= 2) {
                    coil.position.y = Math.sin(elapsedSec * 2.2 + ci * 1.5 + e.id) * 0.16;
                  } else if (ci <= 4) {
                    const sideSign = ci === 3 ? -1 : 1;
                    coil.rotation.z = sideSign * Math.sin(elapsedSec * (rate * 1.1) + e.id) * (attacking ? 0.34 : 0.18);
                  } else {
                    coil.rotation.y = Math.sin(elapsedSec * (rate * 0.9) + e.id) * 0.26;
                  }
                }
              }
            }
          }
        } else if (isPrey) {
          if (isSlainPrey) {
            mv.deathCollapse = Math.min(1, mv.deathCollapse + dt * 2.2);
          } else {
            mv.deathCollapse = 0;
          }
          if (mv.parts.carcassDecal) {
            mv.parts.carcassDecal.visible = isSlainPrey && mv.deathCollapse > 0.2;
            const decalMat = mv.parts.carcassDecal.material as THREE.MeshBasicMaterial;
            decalMat.opacity = Math.min(0.62, mv.deathCollapse * 0.62);
          }
          const playingSkeletal = mv.parts.animator?.isPlayingSkeletal() ?? false;
          if (isSlainPrey) {
            // ALWAYS topple slain land animals smoothly onto their side on the ground so every dead animal visibly falls down!
            const ease = 1 - (1 - mv.deathCollapse) * (1 - mv.deathCollapse);
            mv.parts.bodyGroup.rotation.z = Math.PI * 0.48 * ease;
            mv.parts.bodyGroup.rotation.x = 0;
            mv.parts.bodyGroup.position.set(0, 0.26 * ease, 0);
          } else if (preyAnimState === 'attack') {
            // Lively animal strike animation: pounce/lunge forward, bear rear-up / elephant tusk thrust / lion bite!
            const atkCycle = (elapsedSec * 5.6 + e.id * 1.7) % (Math.PI * 2);
            const strike = Math.pow(Math.max(0, Math.sin(atkCycle)), 1.4);
            const isRearing = e.templateId === 'predator_bear' || e.templateId === 'wild_elephant';
            mv.parts.bodyGroup.rotation.z = Math.sin(atkCycle) * 0.08;
            mv.parts.bodyGroup.rotation.x = isRearing ? -strike * 0.34 : strike * 0.24;
            mv.parts.bodyGroup.position.set(
              Math.sin(mv.smoothFacing) * strike * 0.42,
              strike * (isRearing ? 0.32 : 0.2),
              Math.cos(mv.smoothFacing) * strike * 0.42
            );
          } else {
            mv.parts.bodyGroup.rotation.z = 0;
            mv.parts.bodyGroup.rotation.x = 0;
            mv.parts.bodyGroup.position.set(
              0,
              !playingSkeletal && preyAnimState === 'walk' ? Math.abs(Math.sin(elapsedSec * 12 + e.id)) * 0.14 : 0,
              0
            );
          }
        }
        if (mv.parts.sparkleSprites) {
          for (let i = 0; i < mv.parts.sparkleSprites.length; i++) {
            const sp = mv.parts.sparkleSprites[i];
            const phase = elapsedSec * 2.6 + e.id * 1.9 + i * 1.45;
            const wave = Math.max(0, Math.sin(phase));
            const glint = wave * wave * wave;
            (sp.material as THREE.SpriteMaterial).opacity = 0.12 + glint * 0.85;
            sp.scale.setScalar(0.35 + glint * 0.45);
          }
        }
        if (mv.parts.fishGroup) {
          mv.parts.fishGroup.rotation.y = elapsedSec * 0.72 + e.id * 1.3;
          mv.parts.fishGroup.position.y = Math.sin(elapsedSec * 2.0 + e.id) * 0.04;
        }
        if (mv.parts.rippleMeshes) {
          for (let i = 0; i < mv.parts.rippleMeshes.length; i++) {
            const ring = mv.parts.rippleMeshes[i];
            const cyc = (elapsedSec * 0.55 + i * 0.5 + e.id * 0.23) % 1.0;
            ring.scale.setScalar(0.65 + cyc * 1.05);
            (ring.material as THREE.MeshBasicMaterial).opacity = (1.0 - cyc) * 0.55;
          }
        }
      }

      // Selection ring & Health/Capture bar
      const isSelected = selectedIds.has(e.id);
      mv.selectionRing.visible = isSelected;

      const hpRatio = Math.max(0, Math.min(1, e.hp / Math.max(1, e.maxHp)));
      const ownerCap = e.captureMax > 0 ? (e.capturePoints[e.owner] ?? e.captureMax) / e.captureMax : 1;
      const showResourceCombatBar = Boolean(tpl.isPredator) && e.hp > 0 && (isSelected || hpRatio < 0.99);
      const showBars = ((isSelected || hpRatio < 0.99 || ownerCap < 0.99) && tpl.kind !== 'resource') || showResourceCombatBar;
      mv.hpBarGroup.visible = showBars;

      if (showBars) {
        mv.hpBarGroup.quaternion.copy(this.rtsCamera.camera.quaternion);
        mv.hpFill.scale.x = Math.max(0.01, hpRatio);
        mv.hpFill.position.x = -(1 - hpRatio) * 0.5;
        const fillMat = mv.hpFill.material as THREE.MeshBasicMaterial;
        fillMat.color.setHex(hpRatio > 0.55 ? 0x22c55e : hpRatio > 0.25 ? 0xfacc15 : 0xef4444);

        const showCap = tpl.kind === 'building' && !e.isFoundation && ownerCap < 0.99;
        mv.capFill.visible = showCap;
        if (showCap) {
          mv.capFill.scale.x = Math.max(0.01, ownerCap);
          mv.capFill.position.x = -(1 - ownerCap) * 0.5;
        }
      }

      // Floating overhead countdown badge (10..1) while newly trained Civic Center workers wait to auto-work
      const autoDelay = e.autoWorkDelay ?? 0;
      if (e.owner === humanPlayerId && autoDelay > 0) {
        const sec = Math.max(1, Math.ceil(autoDelay));
        if (!mv.countdownSprite) {
          const mat = new THREE.SpriteMaterial({
            map: this.getCountdownTexture(sec),
            transparent: true,
            depthTest: false,
          });
          const sprite = new THREE.Sprite(mat);
          sprite.position.set(0, 3.15, 0);
          sprite.scale.set(0.95, 0.95, 1);
          sprite.renderOrder = 12;
          mv.parts.root.add(sprite);
          mv.countdownSprite = sprite;
          mv.countdownLastVal = sec;
        } else if (mv.countdownLastVal !== sec) {
          (mv.countdownSprite.material as THREE.SpriteMaterial).map = this.getCountdownTexture(sec);
          (mv.countdownSprite.material as THREE.SpriteMaterial).needsUpdate = true;
          mv.countdownLastVal = sec;
        }
        const frac = autoDelay - Math.floor(autoDelay);
        const pulse = 0.92 + Math.sin(frac * Math.PI) * 0.14;
        mv.countdownSprite.scale.set(pulse, pulse, 1);
        mv.countdownSprite.visible = true;
      } else if (mv.countdownSprite) {
        mv.countdownSprite.visible = false;
      }
    }

    // Remove dead visuals
    for (const [id, mv] of this.visuals.entries()) {
      if (!seen.has(id)) {
        if (mv.countdownSprite) {
          (mv.countdownSprite.material as THREE.SpriteMaterial).dispose();
        }
        this.scene.remove(mv.parts.root);
        this.visuals.delete(id);
      }
    }

    // 2. Sync Rally Point indicator, Linked Tunnel X-Ray Cutaway, Beacon Range Ring & Live Terraforming Soil Progress Markers!
    this.syncRallyMarker(world, humanPlayerId, selectedIds, dt);
    this.syncTunnelLinks(world, humanPlayerId, selectedIds, elapsedSec);
    this.syncBeaconRangeRing(world, humanPlayerId, selectedIds);
    this.syncSoilProgressOverlays(world, humanPlayerId);
    this.syncShoreFishingVisuals(world, elapsedSec);

    // 3. Sync Projectiles
    const activeProj = new Set<number>();
    for (const p of world.projectiles) {
      activeProj.add(p.id);
      let mesh = this.projectileMeshes.get(p.id);
      if (!mesh) {
        if (p.kind === 'flaming_boulder') {
          mesh = new THREE.Mesh(this.boulderGeom, this.flamingBoulderMat);
          mesh.scale.setScalar(1.35);
        } else if (p.kind === 'boulder') {
          mesh = new THREE.Mesh(this.boulderGeom, this.boulderMat);
          mesh.scale.setScalar(1.15);
        } else if (p.kind === 'bolt') {
          mesh = new THREE.Mesh(this.boltGeom, this.boltMat);
        } else if (p.kind === 'fire_arrow') {
          mesh = new THREE.Mesh(this.arrowGeom, this.fireArrowMat);
          mesh.scale.set(1.5, 1.25, 1.5);
        } else {
          mesh = new THREE.Mesh(this.arrowGeom, p.kind === 'javelin' ? this.javelinMat : this.arrowMat);
        }
        this.scene.add(mesh);
        this.projectileMeshes.set(p.id, mesh);
      }
      mesh.position.set(p.x, p.y, p.z);
      // Orient along velocity tangent
      const tNext = Math.min(1, p.progress + 0.05);
      const nx = p.startX + (p.targetX - p.startX) * tNext;
      const nz = p.startZ + (p.targetZ - p.startZ) * tNext;
      const ny = p.startY + (p.targetY - p.startY) * tNext + Math.sin(tNext * Math.PI) * p.arcHeight;
      mesh.lookAt(nx, ny, nz);
      mesh.rotateX(Math.PI / 2);
    }
    for (const [id, mesh] of this.projectileMeshes.entries()) {
      if (!activeProj.has(id)) {
        this.scene.remove(mesh);
        this.projectileMeshes.delete(id);
      }
    }

    // 4. Animate Click Pings
    for (let i = this.pings.length - 1; i >= 0; i--) {
      const ping = this.pings[i];
      ping.age += dt;
      const p = ping.age / ping.duration;
      if (p >= 1) {
        this.scene.remove(ping.mesh);
        ping.mesh.geometry.dispose();
        (ping.mesh.material as THREE.Material).dispose();
        this.pings.splice(i, 1);
      } else {
        ping.mesh.scale.setScalar(1 + p * 2.2);
        (ping.mesh.material as THREE.MeshBasicMaterial).opacity = 1 - p;
      }
    }

    this.renderer.render(this.scene, this.rtsCamera.camera);

    // 5. Overlay X-Ray Pass: when a tunnel is selected, render textured 3D vaulted underground tunnel + REAL 0 A.D. animated underground units cleanly through mountains!
    if (selectedTunnelPair !== null) {
      for (let i = 0; i < xrayUndergroundRoots.length; i++) {
        this.xrayScene.add(xrayUndergroundRoots[i]);
      }
      this.renderer.autoClear = false;
      this.renderer.clearDepth();
      this.renderer.render(this.xrayScene, this.rtsCamera.camera);
      this.renderer.autoClear = true;
      for (let i = 0; i < xrayUndergroundRoots.length; i++) {
        this.scene.add(xrayUndergroundRoots[i]);
      }
    }
  }

  private ensureRallyFlagVisual(civId: CivId, teamColor: number): void {
    const spec = getZeroADModelSpec('rally_flag', civId);
    const ready = Boolean(spec && zeroADAssets.isSpecReady(spec));

    if (this.rallyFlagCiv === civId && (this.rallyFlagIsZeroAD || !ready)) {
      return;
    }

    while (this.rallyFlag.children.length > 0) {
      this.rallyFlag.remove(this.rallyFlag.children[0]);
    }
    this.rallyFlagAnimator = null;
    this.rallyFlagCiv = civId;

    if (spec && ready) {
      const built = zeroADAssets.buildSync(spec, teamColor);
      this.rallyFlag.add(built.container);
      this.rallyFlagAnimator = built.animator ?? null;
      this.rallyFlagIsZeroAD = true;
    } else {
      // Minimal pole + banner placeholder only for the brief moment while waypoint_flag.dae loads
      const pole = new THREE.Mesh(
        new THREE.CylinderGeometry(0.04, 0.05, 2.8, 6),
        new THREE.MeshStandardMaterial({ color: 0x6b4f31, roughness: 0.85 })
      );
      pole.position.y = 1.4;
      const cloth = new THREE.Mesh(
        new THREE.PlaneGeometry(0.95, 1.1),
        new THREE.MeshStandardMaterial({ color: teamColor, side: THREE.DoubleSide, roughness: 0.7 })
      );
      cloth.position.set(0, 2.2, 0.08);
      this.rallyFlag.add(pole, cloth);
      this.rallyFlagIsZeroAD = false;
    }
  }

  private syncRallyMarker(world: World, humanPlayerId: number, selectedIds: Set<number>, dt: number): void {
    if (selectedIds.size !== 1) {
      this.rallyLine.visible = false;
      this.rallyFlag.visible = false;
      return;
    }
    const id = selectedIds.values().next().value!;
    const e = world.entities.get(id);
    if (!e || !e.alive || e.owner !== humanPlayerId || e.isFoundation || !TEMPLATES[e.templateId].trains) {
      this.rallyLine.visible = false;
      this.rallyFlag.visible = false;
      return;
    }

    const player = world.players.get(humanPlayerId);
    const civId: CivId = player?.civ ?? world.config.playerCiv;
    const teamColor = player?.color ?? 0x2563eb;
    this.ensureRallyFlagVisual(civId, teamColor);

    const startY = world.terrain.getHeightAt(e.x, e.z) + 0.5;
    const groundEndY = world.terrain.getHeightAt(e.rallyX, e.rallyZ);
    const posAttr = this.rallyLine.geometry.attributes.position as THREE.BufferAttribute;
    posAttr.setXYZ(0, e.x, startY, e.z);
    posAttr.setXYZ(1, e.rallyX, groundEndY + 0.35, e.rallyZ);
    posAttr.needsUpdate = true;

    this.rallyFlag.position.set(e.rallyX, groundEndY, e.rallyZ);
    // Face banner slightly toward camera for instant readability
    this.rallyFlag.rotation.y = this.rtsCamera.yaw;
    if (this.rallyFlagAnimator) {
      this.rallyFlagAnimator.update(dt, 'idle', null, 1.0);
    }
    this.rallyLine.visible = true;
    this.rallyFlag.visible = true;
  }

  private lastTunnelSig = '';

  private ensureTunnelInteriorTextures(): void {
    if (this.tunnelRockTex) return;
    const loadRep = (rel: string, rx: number, ry: number): THREE.Texture => {
      const tex = this.tunnelTexLoader.load(`${ASSET_BASE}/${rel}`);
      tex.wrapS = THREE.RepeatWrapping;
      tex.wrapT = THREE.RepeatWrapping;
      tex.repeat.set(rx, ry);
      tex.colorSpace = THREE.SRGBColorSpace;
      return tex;
    };
    this.tunnelRockTex = loadRep('terrain/cliff.png', 2.4, 1.5);
    this.tunnelFloorTex = loadRep('textures/decal_stone_medit_01.png', 1.4, 3.0);
    this.tunnelRibTex = loadRep('textures/stone_aegean_01.png', 2.0, 1.0);
  }

  /**
   * Renders underground tunnel links AND activates full interactive 3D Textured X-Ray Cutaway view
   * whenever the player clicks/selects a tunnel (showing real 0 A.D. animated workers digging & travelers walking
   * inside a properly oriented, textured vaulted stone/rock tunnel!).
   */
  private syncTunnelLinks(world: World, humanPlayerId: number, selectedIds: Set<number>, _elapsedSec: number): void {
    const pairs: Array<{ a: Entity; b: Entity; hi: boolean; prog: number }> = [];
    const visited = new Set<number>();
    for (const e of world.entities.values()) {
      if (!e.alive || e.owner !== humanPlayerId || !e.linkedTunnelId) continue;
      if (visited.has(e.id)) continue;
      const partner = world.entities.get(e.linkedTunnelId);
      if (!partner || !partner.alive) continue;
      visited.add(e.id);
      visited.add(partner.id);
      // Canonicalize order so portalA is always the excavation anchor (smaller id)
      const a = e.id < partner.id ? e : partner;
      const b = e.id < partner.id ? partner : e;
      const hi = selectedIds.has(a.id) || selectedIds.has(b.id);
      const prog = a.isFoundation ? Math.max(0.03, Math.min(1, a.buildProgress)) : 1.0;
      pairs.push({ a, b, hi, prog });
    }

    const sig = pairs.map((p) => `${p.a.id}-${p.b.id}-${p.hi ? 1 : 0}-${Math.round(p.prog * 100)}`).join('|');
    if (sig !== this.lastTunnelSig) {
      this.lastTunnelSig = sig;
      this.tunnelLinksGroup.clear();
      this.tunnelXrayCorridorGroup.clear();

      for (const { a, b, hi, prog } of pairs) {
        const ay = world.terrain.getHeightAt(a.x, a.z);
        const by = world.terrain.getHeightAt(b.x, b.z);
        const dugX = a.x + (b.x - a.x) * prog;
        const dugY = ay + (by - ay) * prog;
        const dugZ = a.z + (b.z - a.z) * prog;

        if (hi) {
          this.ensureTunnelInteriorTextures();
          // Exact 3D alignment from Portal A doorway -> Portal B doorway (0.0 deg yaw & slope pitch error!)
          const dugVec = new THREE.Vector3(dugX - a.x, dugY - ay, dugZ - a.z);
          const dugLen = Math.max(1.2, dugVec.length());

          const corridorGroup = new THREE.Group();
          corridorGroup.position.set(a.x, ay, a.z);
          corridorGroup.lookAt(b.x, by, b.z); // Local +Z now points EXACTLY along tunnel centerline A -> B!

          // 1. Textured stone-paved underground tunnel road floor (runs z = 0 .. dugLen)
          const floorTex = this.tunnelFloorTex!.clone();
          floorTex.needsUpdate = true;
          floorTex.repeat.set(1.2, Math.max(1, dugLen * 0.45));
          const floorMat = new THREE.MeshStandardMaterial({
            map: floorTex,
            color: prog >= 1 ? 0xd6ccb8 : 0xb59c7a,
            roughness: 0.92,
            metalness: 0.04,
          });
          const floor = new THREE.Mesh(new THREE.BoxGeometry(2.75, 0.24, dugLen), floorMat);
          floor.position.set(0, -0.1, dugLen * 0.5);
          corridorGroup.add(floor);

          // 2. Textured 3D upright vaulted rock/masonry arch shell (BackSide inward-facing, proper upright +Y arch!)
          const rockTex = this.tunnelRockTex!.clone();
          rockTex.needsUpdate = true;
          rockTex.repeat.set(2.2, Math.max(1, dugLen * 0.35));
          const vaultMat = new THREE.MeshStandardMaterial({
            map: rockTex,
            color: prog >= 1 ? 0x9b9284 : 0x8f7455,
            roughness: 0.94,
            metalness: 0.02,
            side: THREE.BackSide,
            transparent: true,
            opacity: 0.86,
          });
          // CylinderGeometry axis=+Y, theta=[-PI/2..+PI/2] (+Z half) -> rotateX(-PI/2) puts arch cleanly UPRIGHT on +Y along Z!
          const vault = new THREE.Mesh(
            new THREE.CylinderGeometry(1.48, 1.48, dugLen, 14, 1, true, -Math.PI * 0.5, Math.PI),
            vaultMat
          );
          vault.rotation.x = -Math.PI / 2;
          vault.position.set(0, 0.02, dugLen * 0.5);
          corridorGroup.add(vault);

          // 3. Textured 3D ashlar stone support arch ribs + warm glowing wall torches spaced every ~3.4m
          const ribMat = new THREE.MeshStandardMaterial({
            map: this.tunnelRibTex,
            color: 0xd8d0be,
            roughness: 0.88,
            metalness: 0.05,
          });
          const torchMat = new THREE.MeshBasicMaterial({ color: 0xffb703 });
          const ribCount = Math.max(2, Math.floor(dugLen / 3.4));
          for (let ri = 0; ri <= ribCount; ri++) {
            const rz = (ri / ribCount) * dugLen;
            const rib = new THREE.Mesh(new THREE.TorusGeometry(1.42, 0.12, 7, 14, Math.PI), ribMat);
            rib.position.set(0, 0.02, rz);
            corridorGroup.add(rib);
            if (ri > 0 && ri < ribCount && ri % 2 === 1) {
              const torchL = new THREE.Mesh(new THREE.OctahedronGeometry(0.14, 0), torchMat);
              torchL.position.set(-1.18, 1.05, rz);
              const torchR = new THREE.Mesh(new THREE.OctahedronGeometry(0.14, 0), torchMat);
              torchR.position.set(1.18, 1.05, rz);
              corridorGroup.add(torchL, torchR);
            }
          }

          // 4. Rocky excavation bore wall cap when still digging (prog < 1)
          if (prog < 1) {
            const faceMat = new THREE.MeshStandardMaterial({
              map: this.tunnelRockTex,
              color: 0x7c5b3e,
              roughness: 0.96,
            });
            const boreFace = new THREE.Mesh(new THREE.CircleGeometry(1.46, 12, 0, Math.PI), faceMat);
            boreFace.rotation.y = Math.PI;
            boreFace.position.set(0, 0.02, dugLen);
            corridorGroup.add(boreFace);
          }

          this.tunnelXrayCorridorGroup.add(corridorGroup);
        }

        // Subtle surface guide line when unselected, or remaining dashed planned bore line while digging
        if (!hi) {
          const dugGeom = new THREE.BufferGeometry().setFromPoints([
            new THREE.Vector3(a.x, ay + 0.65, a.z),
            new THREE.Vector3(dugX, dugY + 0.65, dugZ),
          ]);
          const dugMat = new THREE.LineDashedMaterial({
            color: prog >= 1 ? 0x38bdf8 : 0xf59e0b,
            dashSize: 1.15,
            gapSize: 0.65,
            transparent: true,
            opacity: 0.62,
            depthTest: false,
          });
          const dugLine = new THREE.Line(dugGeom, dugMat);
          dugLine.computeLineDistances();
          dugLine.renderOrder = 10;
          this.tunnelLinksGroup.add(dugLine);
        }

        if (prog < 1) {
          const remGeom = new THREE.BufferGeometry().setFromPoints([
            new THREE.Vector3(dugX, dugY + 0.65, dugZ),
            new THREE.Vector3(b.x, by + 0.65, b.z),
          ]);
          const remMat = new THREE.LineDashedMaterial({
            color: hi ? 0xfde68a : 0x94a3b8,
            dashSize: 0.65,
            gapSize: 0.85,
            transparent: true,
            opacity: hi ? 0.78 : 0.35,
            depthTest: false,
          });
          const remLine = new THREE.Line(remGeom, remMat);
          remLine.computeLineDistances();
          remLine.renderOrder = 9;
          this.tunnelLinksGroup.add(remLine);
        }
      }
    }

    const selectedPair = pairs.find((p) => p.hi);
    if (!selectedPair) {
      this.tunnelXraySprite.visible = false;
      return;
    }

    const { a, b, prog } = selectedPair;
    const ay = world.terrain.getHeightAt(a.x, a.z);
    const by = world.terrain.getHeightAt(b.x, b.z);
    const totalDx = b.x - a.x;
    const totalDz = b.z - a.z;

    let diggerCount = 0;
    let walkerCount = 0;
    for (const u of world.entities.values()) {
      if (!u.alive || u.garrisonedIn !== null) continue;
      if (u.order.type === 'build' && u.order.inShaft && (u.order.targetId === a.id || u.order.targetId === b.id)) {
        diggerCount++;
      } else if (
        u.order.type === 'enter_tunnel' &&
        (u.order.transitRemaining ?? 0) > 0 &&
        (u.order.portalId === a.id || u.order.portalId === b.id || u.order.exitPortalId === a.id || u.order.exitPortalId === b.id)
      ) {
        walkerCount++;
      }
    }

    // Update floating X-Ray status banner above the tunnel bore face / center!
    const pct = Math.round(prog * 100);
    const lenTiles = a.tunnelLengthTiles ?? Math.round(Math.hypot(totalDx, totalDz) / 2);
    const labelText =
      prog < 1
        ? `👁️ 隧道透視 ${pct}% • 地下挖掘工人: ${diggerCount} 人 (長 ${lenTiles} 格)`
        : `👁️ 隧道透視 (已貫通 • 長 ${lenTiles} 格) • 地下通行中: ${walkerCount} 人`;
    const anchorT = prog < 1 ? prog : 0.5;
    const lx = a.x + totalDx * anchorT;
    const lz = a.z + totalDz * anchorT;
    const ly = Math.max(world.terrain.getHeightAt(lx, lz), ay + (by - ay) * anchorT) + 3.2;
    this.tunnelXraySprite.position.set(lx, ly, lz);
    this.tunnelXraySprite.visible = true;

    if (this.lastTunnelXrayLabel !== labelText) {
      this.lastTunnelXrayLabel = labelText;
      const ctx = this.tunnelXrayCanvas.getContext('2d');
      if (ctx) {
        ctx.clearRect(0, 0, 440, 68);
        ctx.fillStyle = 'rgba(15, 23, 42, 0.90)';
        ctx.strokeStyle = prog < 1 ? '#f59e0b' : '#38bdf8';
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.roundRect(6, 6, 428, 56, 12);
        ctx.fill();
        ctx.stroke();
        ctx.font = 'bold 20px system-ui, sans-serif';
        ctx.fillStyle = '#f8fafc';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(labelText, 220, 34);
        this.tunnelXrayTex.needsUpdate = true;
      }
    }
  }

  /** Renders 3D bamboo fishing rods + bobbers & cast fishing nets whenever land workers fish at the water's edge! */
  private syncShoreFishingVisuals(world: World, elapsedSec: number): void {
    this.shoreFishingGroup.clear();
    for (const u of world.entities.values()) {
      if (!u.alive || u.garrisonedIn !== null || u.animState !== 'gather' || u.order.type !== 'gather') continue;
      const uTpl = TEMPLATES[u.templateId];
      if (!uTpl || uTpl.isNaval) continue;
      const fish = world.entities.get(u.order.targetId);
      if (!fish || !fish.alive || !TEMPLATES[fish.templateId]?.isAquatic) continue;

      const uY = world.terrain.getHeightAt(u.x, u.z);
      const dx = fish.x - u.x;
      const dz = fish.z - u.z;
      const dist = Math.max(0.5, Math.hypot(dx, dz));
      const dirX = dx / dist;
      const dirZ = dz / dist;

      const handX = u.x + dirX * 0.35;
      const handY = uY + 1.15;
      const handZ = u.z + dirZ * 0.35;

      const waterY = WATER_LEVEL + 0.08;
      const useCastNet = u.id % 2 === 1;

      if (useCastNet) {
        // Cast fishing net expanding & rippling across the water onto the fish shoal!
        const castCycle = (elapsedSec * 0.85 + u.id * 0.37) % 1.0;
        const flyT = Math.min(1, castCycle * 2.2);
        const netX = handX + (fish.x - handX) * flyT;
        const netZ = handZ + (fish.z - handZ) * flyT;
        const netY = handY * (1 - flyT) + waterY * flyT + Math.sin(flyT * Math.PI) * 1.15;

        const net = new THREE.Mesh(this.netGeom, this.netMat);
        net.position.set(netX, netY, netZ);
        const netScale = 0.45 + flyT * 0.85;
        net.scale.set(netScale, 1, netScale);
        this.shoreFishingGroup.add(net);

        // Rope tether from worker's hand to the cast net
        const ropeGeom = new THREE.BufferGeometry().setFromPoints([
          new THREE.Vector3(handX, handY, handZ),
          new THREE.Vector3(netX, netY, netZ),
        ]);
        this.shoreFishingGroup.add(new THREE.Line(ropeGeom, this.lineMat));

        if (flyT >= 0.95) {
          const rip = new THREE.Mesh(this.fishRippleGeom, this.fishRippleMat);
          rip.position.set(fish.x, waterY + 0.02, fish.z);
          rip.scale.setScalar(1.0 + (castCycle - 0.45) * 2.2);
          this.shoreFishingGroup.add(rip);
        }
      } else {
        // Bamboo fishing rod + dipping fishing line + bobbing red float on the water!
        const bob = Math.sin(elapsedSec * 4.5 + u.id) * 0.07;
        const tipX = handX + dirX * 1.75;
        const tipY = handY + 1.25 + bob * 0.6;
        const tipZ = handZ + dirZ * 1.75;

        const rod = new THREE.Mesh(this.rodGeom, this.rodMat);
        rod.position.set((handX + tipX) * 0.5, (handY + tipY) * 0.5, (handZ + tipZ) * 0.5);
        rod.lookAt(tipX, tipY, tipZ);
        rod.rotateX(Math.PI / 2);
        this.shoreFishingGroup.add(rod);

        const floatX = fish.x - dirX * 0.2;
        const floatZ = fish.z - dirZ * 0.2;
        const floatY = waterY + bob;
        const bobber = new THREE.Mesh(this.bobberGeom, this.bobberMat);
        bobber.position.set(floatX, floatY, floatZ);
        this.shoreFishingGroup.add(bobber);

        const lineGeom = new THREE.BufferGeometry().setFromPoints([
          new THREE.Vector3(tipX, tipY, tipZ),
          new THREE.Vector3((tipX + floatX) * 0.5, (tipY + floatY) * 0.5 - 0.25, (tipZ + floatZ) * 0.5),
          new THREE.Vector3(floatX, floatY, floatZ),
        ]);
        this.shoreFishingGroup.add(new THREE.Line(lineGeom, this.lineMat));

        const rip = new THREE.Mesh(this.fishRippleGeom, this.fishRippleMat);
        rip.position.set(floatX, waterY + 0.02, floatZ);
        const rPulse = 0.75 + ((elapsedSec * 0.9 + u.id * 0.2) % 1.0) * 1.2;
        rip.scale.setScalar(rPulse);
        this.shoreFishingGroup.add(rip);
      }
    }
  }

  /** Shows the Great Wall Beacon Tower's signal/rally radius ring on the terrain when selected */
  private syncBeaconRangeRing(world: World, humanPlayerId: number, selectedIds: Set<number>): void {
    if (selectedIds.size !== 1) {
      this.beaconRangeRing.visible = false;
      return;
    }
    const id = selectedIds.values().next().value!;
    const e = world.entities.get(id);
    if (!e || !e.alive || e.owner !== humanPlayerId || e.isFoundation || !TEMPLATES[e.templateId]?.isBeaconTower) {
      this.beaconRangeRing.visible = false;
      return;
    }
    const stats = World.getBeaconStats(e.beaconLevel ?? 1);
    const groundY = world.terrain.getHeightAt(e.x, e.z);
    this.beaconRangeRing.position.set(e.x, groundY + 0.35, e.z);
    this.beaconRangeRing.scale.set(stats.relayRange, 1, stats.relayRange);
    const mat = this.beaconRangeRing.material as THREE.MeshBasicMaterial;
    const hasSoldiers = world.getBeaconGarrisonSoldiers(e).length > 0;
    mat.color.setHex((e.beaconLitTimer ?? 0) > 0 ? 0xff6b00 : hasSoldiers ? 0xfbbf24 : 0x94a3b8);
    this.beaconRangeRing.visible = true;
  }

  /**
   * Renders live 3D excavation / dumping / leveling progress markers directly over every active terraforming tile
   * so players immediately see exact soil unit progress (e.g. "⛏ 24/100") before the tile subsides or rises!
   */
  private syncSoilProgressOverlays(world: World, humanPlayerId: number): void {
    const active = new Map<number, { tx: number; tz: number; mode: TerraformMode; current: number; max: number }>();

    // 1. All tiles that already have partial soil removed (<100) or dumped (>0)
    for (const st of world.terrain.getActiveSoilTiles()) {
      if (st.dugUnits > 0) {
        active.set(st.idx, { tx: st.tx, tz: st.tz, mode: 'dig', current: st.dugUnits, max: SOIL_UNITS_PER_TILE });
      } else if (st.fillUnits > 0) {
        active.set(st.idx, { tx: st.tx, tz: st.tz, mode: 'raise', current: st.fillUnits, max: SOIL_UNITS_PER_TILE });
      }
    }

    // 2. Also highlight tiles actively targeted by friendly workers (even at 0/100, and detect 'level' / 'raise' mode!)
    for (const e of world.entities.values()) {
      if (!e.alive || e.owner !== humanPlayerId || e.order.type !== 'terraform') continue;
      const ord = e.order;
      const srcIdx = ord.tileZ * world.terrain.width + ord.tileX;
      const dugUnits = SOIL_UNITS_PER_TILE - world.terrain.getSoilUnits(ord.tileX, ord.tileZ);
      active.set(srcIdx, {
        tx: ord.tileX,
        tz: ord.tileZ,
        mode: ord.mode === 'level' ? 'level' : 'dig',
        current: dugUnits,
        max: SOIL_UNITS_PER_TILE,
      });
      if (ord.mode === 'dig' || ord.mode === 'raise') {
        const dumpIdx = ord.destTileZ * world.terrain.width + ord.destTileX;
        if (dumpIdx !== srcIdx) {
          const fillUnits = world.terrain.getFillUnits(ord.destTileX, ord.destTileZ);
          active.set(dumpIdx, {
            tx: ord.destTileX,
            tz: ord.destTileZ,
            mode: 'raise',
            current: fillUnits,
            max: SOIL_UNITS_PER_TILE,
          });
        }
      }
    }

    // Update or create 3D tile progress markers
    for (const [idx, info] of active.entries()) {
      let marker = this.soilMarkers.get(idx);
      const pos = world.terrain.tileToWorldCenter(info.tx, info.tz);
      const groundY = world.terrain.getHeightAt(pos.x, pos.z);

      if (!marker) {
        const group = new THREE.Group();
        const ringGeom = new THREE.RingGeometry(0.86, 1.04, 4);
        ringGeom.rotateX(-Math.PI / 2);
        ringGeom.rotateY(Math.PI / 4);
        const ringMat = new THREE.MeshBasicMaterial({
          color: 0xf59e0b,
          transparent: true,
          opacity: 0.85,
          side: THREE.DoubleSide,
          depthWrite: false,
        });
        const ring = new THREE.Mesh(ringGeom, ringMat);
        ring.position.y = 0.09;
        group.add(ring);

        const patchGeom = new THREE.CircleGeometry(0.82, 12);
        patchGeom.rotateX(-Math.PI / 2);
        const patchMat = new THREE.MeshBasicMaterial({
          color: 0x5c4024,
          transparent: true,
          opacity: 0.35,
          depthWrite: false,
        });
        const patchMesh = new THREE.Mesh(patchGeom, patchMat);
        patchMesh.position.y = 0.06;
        group.add(patchMesh);

        const canvas = document.createElement('canvas');
        canvas.width = 256;
        canvas.height = 76;
        const tex = new THREE.CanvasTexture(canvas);
        tex.minFilter = THREE.LinearFilter;
        const spriteMat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false });
        const sprite = new THREE.Sprite(spriteMat);
        sprite.scale.set(2.85, 0.85, 1);
        sprite.position.y = 1.65;
        sprite.renderOrder = 14;
        group.add(sprite);

        this.soilProgressGroup.add(group);
        marker = { group, ringMat, patchMesh, patchMat, sprite, canvas, tex, lastKey: '' };
        this.soilMarkers.set(idx, marker);
      }

      marker.group.position.set(pos.x, groundY, pos.z);
      const pct = Math.max(0, Math.min(1, info.current / Math.max(1, info.max)));
      marker.patchMesh.scale.setScalar(0.35 + pct * 0.65);
      marker.patchMat.opacity = 0.16 + pct * 0.48;
      marker.patchMat.color.setHex(info.mode === 'raise' ? 0x7c5a32 : info.mode === 'level' ? 0x6b7c54 : 0x452d17);
      marker.ringMat.color.setHex(info.mode === 'raise' ? 0x22c55e : info.mode === 'level' ? 0x38bdf8 : 0xf59e0b);

      const heightLabel = `${groundY >= 0 ? '+' : ''}${groundY.toFixed(1)}m`;
      const key = `${info.mode}_${info.current}_${info.max}_${heightLabel}`;
      if (marker.lastKey !== key) {
        marker.lastKey = key;
        const ctx = marker.canvas.getContext('2d');
        if (ctx) {
          ctx.clearRect(0, 0, 256, 76);
          // Rounded pill backdrop
          ctx.fillStyle = 'rgba(15, 23, 42, 0.88)';
          ctx.strokeStyle = info.mode === 'raise' ? '#22c55e' : info.mode === 'level' ? '#38bdf8' : '#f59e0b';
          ctx.lineWidth = 3;
          ctx.beginPath();
          ctx.roundRect(6, 5, 244, 66, 12);
          ctx.fill();
          ctx.stroke();

          // Label text: exact 0.01m excavation depth + live ground elevation!
          const icon = info.mode === 'raise' ? '⬆' : info.mode === 'level' ? '📐' : '⛏';
          const depthMeters = (info.current * 0.01).toFixed(2);
          ctx.font = 'bold 20px system-ui, sans-serif';
          ctx.fillStyle = '#f8fafc';
          ctx.textAlign = 'center';
          ctx.fillText(`${icon} ${depthMeters}m/1.00m • 高${heightLabel}`, 128, 33);

          // Progress bar track + fill
          ctx.fillStyle = 'rgba(255, 255, 255, 0.16)';
          ctx.beginPath();
          ctx.roundRect(22, 46, 212, 14, 7);
          ctx.fill();

          ctx.fillStyle = info.mode === 'raise' ? '#4ade80' : info.mode === 'level' ? '#38bdf8' : '#fbbf24';
          const fillW = Math.max(8, Math.round(212 * pct));
          ctx.beginPath();
          ctx.roundRect(22, 46, fillW, 14, 7);
          ctx.fill();
          marker.tex.needsUpdate = true;
        }
      }
    }

    // Remove finished markers
    for (const [idx, marker] of this.soilMarkers.entries()) {
      if (!active.has(idx)) {
        this.soilProgressGroup.remove(marker.group);
        marker.tex.dispose();
        (marker.sprite.material as THREE.SpriteMaterial).dispose();
        marker.ringMat.dispose();
        marker.patchMat.dispose();
        this.soilMarkers.delete(idx);
      }
    }
  }

  private createManagedVisual(e: Entity, world: World): ManagedVisual {
    const tpl = TEMPLATES[e.templateId];
    const player = world.players.get(e.owner);
    const civId: CivId = player?.civ ?? world.config.playerCiv;
    const teamColor = player?.color ?? 0x888888;
    const parts = createEntityVisual(e.templateId, civId, teamColor);

    // Conform Wheat Fields smoothly to local hillside terrain so farms never float on slopes
    if (tpl.isFarmField) {
      const centerY = world.terrain.getHeightAt(e.x, e.z);
      if (parts.soilMesh) {
        const posAttr = parts.soilMesh.geometry.attributes.position as THREE.BufferAttribute;
        for (let i = 0; i < posAttr.count; i++) {
          const lx = posAttr.getX(i);
          const lz = posAttr.getZ(i);
          const localH = world.terrain.getHeightAt(e.x + lx, e.z + lz) - centerY;
          posAttr.setY(i, localH);
        }
        posAttr.needsUpdate = true;
        parts.soilMesh.geometry.computeVertexNormals();
      }
      if (parts.cropGroup) {
        for (const child of parts.cropGroup.children) {
          const dy = world.terrain.getHeightAt(e.x + child.position.x, e.z + child.position.z) - centerY;
          child.position.y += dy;
        }
      }
      if (parts.fenceGroup) {
        for (const child of parts.fenceGroup.children) {
          const dy = world.terrain.getHeightAt(e.x + child.position.x, e.z + child.position.z) - centerY;
          child.position.y += dy;
        }
      }
    }

    const ringRadius = Math.max(0.75, tpl.radius * 1.15);
    const ringGeom = new THREE.RingGeometry(ringRadius * 0.84, ringRadius, 24);
    ringGeom.rotateX(-Math.PI / 2);
    const ringColor = e.owner === 1 ? 0x4ade80 : e.owner === 2 ? 0xf87171 : 0xfacc15;
    const selectionRing = new THREE.Mesh(
      ringGeom,
      new THREE.MeshBasicMaterial({ color: ringColor, side: THREE.DoubleSide, transparent: true, opacity: 0.9 })
    );
    selectionRing.position.y = 0.14;
    selectionRing.visible = false;
    parts.root.add(selectionRing);

    // Floating HP + Capture bar
    const hpBarGroup = new THREE.Group();
    const barWidth = tpl.kind === 'building' ? Math.max(1.8, tpl.radius * 1.05) : 1.1;
    const barY = tpl.kind === 'building' ? (tpl.isCivicCenter || tpl.isFortress ? 7.6 : 4.2) : 2.35;
    hpBarGroup.position.y = barY;
    hpBarGroup.scale.set(barWidth, 1, 1);

    const bg = new THREE.Mesh(
      new THREE.PlaneGeometry(1.04, 0.17),
      new THREE.MeshBasicMaterial({ color: 0x0f172a, transparent: true, opacity: 0.78 })
    );
    hpBarGroup.add(bg);

    const hpFill = new THREE.Mesh(
      new THREE.PlaneGeometry(1.0, 0.12),
      new THREE.MeshBasicMaterial({ color: 0x22c55e })
    );
    hpFill.position.z = 0.01;
    hpBarGroup.add(hpFill);

    const capFill = new THREE.Mesh(
      new THREE.PlaneGeometry(1.0, 0.09),
      new THREE.MeshBasicMaterial({ color: 0x38bdf8 })
    );
    capFill.position.set(0, -0.14, 0.01);
    capFill.visible = false;
    hpBarGroup.add(capFill);

    hpBarGroup.visible = false;
    parts.root.add(hpBarGroup);

    return {
      id: e.id,
      owner: e.owner,
      templateId: e.templateId,
      parts,
      selectionRing,
      hpBarGroup,
      hpFill,
      capFill,
      smoothFacing: e.facing,
      facingInit: false,
      fieldGrowth: e.isFoundation ? 0 : 0.12,
      lastResourceRemaining: e.resourceRemaining,
      deathCollapse: 0,
    };
  }

  /** Raycast screen pixel onto terrain surface */
  raycastTerrain(clientX: number, clientY: number): THREE.Vector3 | null {
    const rect = this.renderer.domElement.getBoundingClientRect();
    const ndc = new THREE.Vector2(
      ((clientX - rect.left) / rect.width) * 2 - 1,
      -((clientY - rect.top) / rect.height) * 2 + 1
    );
    const rc = new THREE.Raycaster();
    rc.setFromCamera(ndc, this.rtsCamera.camera);
    const hits = rc.intersectObject(this.terrainRenderer.terrainMesh, false);
    return hits.length > 0 ? hits[0].point : null;
  }

  /** Project a world position to 2D canvas coordinates */
  projectToScreen(x: number, y: number, z: number): { sx: number; sy: number; inFront: boolean } {
    const rect = this.renderer.domElement.getBoundingClientRect();
    const v = new THREE.Vector3(x, y, z).project(this.rtsCamera.camera);
    return {
      sx: ((v.x + 1) * 0.5) * rect.width + rect.left,
      sy: ((-v.y + 1) * 0.5) * rect.height + rect.top,
      inFront: v.z >= -1 && v.z <= 1,
    };
  }

  private getCountdownTexture(sec: number): THREE.CanvasTexture {
    const cached = this.countdownTextures.get(sec);
    if (cached) return cached;

    const canvas = document.createElement('canvas');
    canvas.width = 96;
    canvas.height = 96;
    const ctx = canvas.getContext('2d');
    if (ctx) {
      ctx.clearRect(0, 0, 96, 96);
      // Dark circular badge with gold/emerald ring border
      ctx.beginPath();
      ctx.arc(48, 48, 39, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(15, 23, 42, 0.88)';
      ctx.fill();
      ctx.lineWidth = 6;
      ctx.strokeStyle = sec <= 3 ? '#4ade80' : '#fbbf24';
      ctx.stroke();

      // Bold high-contrast countdown digit
      ctx.font = 'bold 46px system-ui, -apple-system, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.lineWidth = 5;
      ctx.strokeStyle = 'rgba(0, 0, 0, 0.75)';
      ctx.strokeText(String(sec), 48, 50);
      ctx.fillStyle = sec <= 3 ? '#dcfce7' : '#fef3c7';
      ctx.fillText(String(sec), 48, 50);
    }

    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    this.countdownTextures.set(sec, tex);
    return tex;
  }

  dispose(): void {
    for (const tex of this.countdownTextures.values()) {
      tex.dispose();
    }
    this.countdownTextures.clear();
    this.tunnelXrayTex.dispose();
    this.placementHintTex.dispose();
    this.tunnelRockTex?.dispose();
    this.tunnelFloorTex?.dispose();
    this.tunnelRibTex?.dispose();
    this.terrainRenderer.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }
}
