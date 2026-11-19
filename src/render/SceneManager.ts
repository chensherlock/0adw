import * as THREE from 'three';
import { TEMPLATES } from '../config/entities';
import { CivId, Entity } from '../config/types';
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

  // Building placement ghost preview
  private ghostGroup: THREE.Group | null = null;
  private ghostTemplateId: string | null = null;
  private ghostValidMat = new THREE.MeshBasicMaterial({ color: 0x22c55e, transparent: true, opacity: 0.45, wireframe: false });
  private ghostInvalidMat = new THREE.MeshBasicMaterial({ color: 0xef4444, transparent: true, opacity: 0.45, wireframe: false });

  // Rally point marker (authentic 0 A.D. waypoint banner flag)
  private readonly rallyLine: THREE.Line;
  private readonly rallyFlag: THREE.Group;
  private rallyFlagCiv: CivId | null = null;
  private rallyFlagIsZeroAD = false;
  private rallyFlagAnimator: UnitAnimator | null = null;

  private readonly arrowGeom = new THREE.CylinderGeometry(0.03, 0.03, 0.95, 4);
  private readonly arrowMat = new THREE.MeshBasicMaterial({ color: 0xfef08a });
  private readonly javelinMat = new THREE.MeshBasicMaterial({ color: 0xfca5a5 });

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
    this.scene.background = new THREE.Color(0x9bc8e4);
    this.scene.fog = new THREE.FogExp2(0x9bc8e4, 0.0028);

    // Warm Mediterranean sunlight
    const hemi = new THREE.HemisphereLight(0xdbeafe, 0x8a7554, 0.72);
    this.scene.add(hemi);

    const sun = new THREE.DirectionalLight(0xfff4d6, 1.65);
    sun.position.set(165, 130, 95);
    sun.castShadow = true;
    sun.shadow.mapSize.width = 2048;
    sun.shadow.mapSize.height = 2048;
    sun.shadow.camera.near = 20;
    sun.shadow.camera.far = 420;
    const d = 155;
    sun.shadow.camera.left = -d;
    sun.shadow.camera.right = d;
    sun.shadow.camera.top = d;
    sun.shadow.camera.bottom = -d;
    sun.shadow.bias = -0.0005;
    sun.target.position.set(128, 0, 128);
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

  updateGhostPreview(
    templateId: string | null,
    civId: CivId,
    x: number,
    z: number,
    y: number,
    isValid: boolean
  ): void {
    if (!templateId) {
      if (this.ghostGroup) {
        this.scene.remove(this.ghostGroup);
        this.ghostGroup = null;
        this.ghostTemplateId = null;
      }
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
      this.ghostGroup.position.set(x, y, z);
      const mat = isValid ? this.ghostValidMat : this.ghostInvalidMat;
      this.ghostGroup.traverse((obj) => {
        if (obj instanceof THREE.Mesh) {
          obj.material = mat;
          obj.castShadow = false;
        }
      });
    }
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

    // 1. Sync Entities
    for (const e of world.entities.values()) {
      if (!e.alive) continue;
      seen.add(e.id);

      let mv = this.visuals.get(e.id);
      if (!mv || mv.owner !== e.owner) {
        if (mv) {
          this.scene.remove(mv.parts.root);
          this.visuals.delete(e.id);
        }
        mv = this.createManagedVisual(e, world);
        this.visuals.set(e.id, mv);
        this.scene.add(mv.parts.root);
      }

      // Visibility rules (garrisoned or shrouded/fogged enemy units are hidden)
      const tpl = TEMPLATES[e.templateId];
      let visible = e.garrisonedIn === null;
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
      const iy = world.terrain.getHeightAt(ix, iz);
      mv.parts.root.position.set(ix, iy, iz);

      // Smooth shortest-arc angular turn for units & live wildlife (buildings & static resources use fixed facing)
      const isPrey = e.templateId === 'deer_herd' || e.templateId === 'wild_boar';
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
        mv.parts.bodyGroup.rotation.y = e.facing;
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
        if (usingSkeletal) {
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
        const preySpeedRatio = preyAnimState === 'walk' ? Math.max(0.85, preySpeedMag / 3.8) : 1.0;
        if (mv.parts.animator) {
          mv.parts.animator.update(dt, preyAnimState, null, preySpeedRatio);
        }
        if (isPrey) {
          if (isSlainPrey) {
            mv.deathCollapse = Math.min(1, mv.deathCollapse + dt * 1.85);
          } else {
            mv.deathCollapse = 0;
          }
          if (mv.parts.carcassDecal) {
            mv.parts.carcassDecal.visible = isSlainPrey && mv.deathCollapse > 0.25;
            const decalMat = mv.parts.carcassDecal.material as THREE.MeshBasicMaterial;
            decalMat.opacity = Math.min(0.62, mv.deathCollapse * 0.62);
          }
          const playingSkeletal = mv.parts.animator?.isPlayingSkeletal() ?? false;
          if (isSlainPrey && !playingSkeletal) {
            // Smooth ease-out collapse instead of snapping down in a single frame
            const ease = 1 - (1 - mv.deathCollapse) * (1 - mv.deathCollapse);
            mv.parts.bodyGroup.rotation.z = Math.PI * 0.48 * ease;
            mv.parts.bodyGroup.position.y = 0.22 * ease;
          } else if (!isSlainPrey) {
            mv.parts.bodyGroup.rotation.z = 0;
            mv.parts.bodyGroup.position.y =
              !playingSkeletal && preyAnimState === 'walk' ? Math.abs(Math.sin(elapsedSec * 12 + e.id)) * 0.14 : 0;
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
      }

      // Selection ring & Health/Capture bar
      const isSelected = selectedIds.has(e.id);
      mv.selectionRing.visible = isSelected;

      const hpRatio = Math.max(0, Math.min(1, e.hp / Math.max(1, e.maxHp)));
      const ownerCap = e.captureMax > 0 ? (e.capturePoints[e.owner] ?? e.captureMax) / e.captureMax : 1;
      const showBars = (isSelected || hpRatio < 0.99 || ownerCap < 0.99) && tpl.kind !== 'resource';
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
    }

    // Remove dead visuals
    for (const [id, mv] of this.visuals.entries()) {
      if (!seen.has(id)) {
        this.scene.remove(mv.parts.root);
        this.visuals.delete(id);
      }
    }

    // 2. Sync Rally Point indicator when a single friendly production building is selected
    this.syncRallyMarker(world, humanPlayerId, selectedIds, dt);

    // 3. Sync Projectiles
    const activeProj = new Set<number>();
    for (const p of world.projectiles) {
      activeProj.add(p.id);
      let mesh = this.projectileMeshes.get(p.id);
      if (!mesh) {
        mesh = new THREE.Mesh(this.arrowGeom, p.kind === 'javelin' ? this.javelinMat : this.arrowMat);
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

  private createManagedVisual(e: Entity, world: World): ManagedVisual {
    const tpl = TEMPLATES[e.templateId];
    const player = world.players.get(e.owner);
    const civId: CivId = player?.civ ?? world.config.playerCiv;
    const teamColor = player?.color ?? 0x888888;
    const parts = createEntityVisual(e.templateId, civId, teamColor);

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

  dispose(): void {
    this.terrainRenderer.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }
}
