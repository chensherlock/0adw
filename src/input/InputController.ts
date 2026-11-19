import { AudioManager } from '../audio/AudioManager';
import { TEMPLATES } from '../config/entities';
import { t, translateBuildReason } from '../config/i18n';
import { BuildingOrderMode, Entity } from '../config/types';
import { SceneManager } from '../render/SceneManager';
import { World } from '../sim/World';

export interface InputCallbacks {
  onSelectionChanged: () => void;
  onStatusToast: (msg: string, tone?: 'info' | 'warn' | 'good') => void;
  onPlacementChanged: (templateId: string | null) => void;
}

export class InputController {
  readonly selectedIds = new Set<number>();
  readonly controlGroups = new Map<number, number[]>();

  placementTemplateId: string | null = null;
  attackMoveMode = false;
  garrisonTargetMode = false;
  buildingOrderMode: BuildingOrderMode = 'capture';

  private readonly humanPlayerId = 1;
  private isDraggingBox = false;
  private dragStartX = 0;
  private dragStartY = 0;
  private isRightDown = false;
  private rightStartX = 0;
  private rightStartY = 0;
  private lastClickTime = 0;
  private lastClickedEntityId: number | null = null;
  private lastGroupRecallKey = -1;
  private lastGroupRecallTime = 0;
  private idleWorkerCursor = 0;

  private readonly boxEl: HTMLElement;
  private readonly callbacks: InputCallbacks;
  private cleanupFns: Array<() => void> = [];

  constructor(
    private world: World,
    private sceneManager: SceneManager,
    private audio: AudioManager,
    boxEl: HTMLElement,
    callbacks: InputCallbacks
  ) {
    this.boxEl = boxEl;
    this.callbacks = callbacks;
    this.attach();
  }

  rebind(world: World, sceneManager: SceneManager): void {
    this.detach();
    this.world = world;
    this.sceneManager = sceneManager;
    this.selectedIds.clear();
    this.controlGroups.clear();
    this.placementTemplateId = null;
    this.attackMoveMode = false;
    this.garrisonTargetMode = false;
    this.attach();
  }

  setPlacementMode(templateId: string | null): void {
    this.placementTemplateId = templateId;
    this.attackMoveMode = false;
    this.garrisonTargetMode = false;
    if (!templateId) {
      this.sceneManager.updateGhostPreview(null, this.world.config.playerCiv, 0, 0, 0, false);
    }
    this.callbacks.onPlacementChanged(templateId);
  }

  selectIdleWorker(): void {
    const idles: Entity[] = [];
    for (const e of this.world.entities.values()) {
      if (
        e.alive &&
        e.owner === this.humanPlayerId &&
        e.garrisonedIn === null &&
        e.order.type === 'idle' &&
        TEMPLATES[e.templateId].gather
      ) {
        idles.push(e);
      }
    }
    if (idles.length === 0) {
      this.callbacks.onStatusToast(t('toastNoIdle'), 'info');
      return;
    }
    const chosen = idles[this.idleWorkerCursor % idles.length];
    this.idleWorkerCursor++;
    this.selectedIds.clear();
    this.selectedIds.add(chosen.id);
    this.sceneManager.rtsCamera.jumpTo(chosen.x, chosen.z);
    this.audio.playSelect(chosen.templateId);
    this.callbacks.onSelectionChanged();
  }

  jumpToCivicCenter(): void {
    for (const e of this.world.entities.values()) {
      if (e.alive && e.owner === this.humanPlayerId && TEMPLATES[e.templateId].isCivicCenter) {
        this.sceneManager.rtsCamera.jumpTo(e.x, e.z);
        return;
      }
    }
  }

  private attach(): void {
    const canvas = this.sceneManager.renderer.domElement;

    const onContextMenu = (e: MouseEvent) => e.preventDefault();

    const onMouseDown = (e: MouseEvent) => {
      this.audio.unlock();
      if (e.button === 0) {
        // Placement mode confirmation
        if (this.placementTemplateId) {
          this.tryConfirmPlacement(e.clientX, e.clientY, e.shiftKey);
          return;
        }
        // Attack-move mode click
        if (this.attackMoveMode) {
          const hit = this.sceneManager.raycastTerrain(e.clientX, e.clientY);
          if (hit) {
            this.issueMove(hit.x, hit.z, e.shiftKey, true);
          }
          this.attackMoveMode = false;
          return;
        }
        // Garrison target click
        if (this.garrisonTargetMode) {
          const picked = this.pickEntityAtScreen(e.clientX, e.clientY);
          if (picked && picked.owner === this.humanPlayerId && TEMPLATES[picked.templateId].garrisonCapacity) {
            this.world.enqueueCommand({
              type: 'garrison',
              playerId: this.humanPlayerId,
              entityIds: Array.from(this.selectedIds),
              buildingId: picked.id,
            });
            this.audio.playOrder();
            this.sceneManager.spawnClickPing(picked.x, picked.z, this.world.terrain.getHeightAt(picked.x, picked.z), 0x38bdf8);
          }
          this.garrisonTargetMode = false;
          return;
        }

        this.isDraggingBox = true;
        this.dragStartX = e.clientX;
        this.dragStartY = e.clientY;
      } else if (e.button === 2) {
        this.isRightDown = true;
        this.rightStartX = e.clientX;
        this.rightStartY = e.clientY;
      }
    };

    const onMouseMove = (e: MouseEvent) => {
      if (this.placementTemplateId) {
        const hit = this.sceneManager.raycastTerrain(e.clientX, e.clientY);
        if (hit) {
          const { tx, tz } = this.world.terrain.worldToTile(hit.x, hit.z);
          const center = this.world.terrain.tileToWorldCenter(tx, tz);
          const check = this.world.canPlaceBuilding(this.humanPlayerId, this.placementTemplateId, tx, tz);
          const y = this.world.terrain.getHeightAt(center.x, center.z);
          this.sceneManager.updateGhostPreview(
            this.placementTemplateId,
            this.world.config.playerCiv,
            center.x,
            center.z,
            y,
            check.ok
          );
        }
      }

      if (this.isDraggingBox) {
        const dx = Math.abs(e.clientX - this.dragStartX);
        const dy = Math.abs(e.clientY - this.dragStartY);
        if (dx > 5 || dy > 5) {
          const left = Math.min(this.dragStartX, e.clientX);
          const top = Math.min(this.dragStartY, e.clientY);
          this.boxEl.style.display = 'block';
          this.boxEl.style.left = `${left}px`;
          this.boxEl.style.top = `${top}px`;
          this.boxEl.style.width = `${dx}px`;
          this.boxEl.style.height = `${dy}px`;
        }
      }
    };

    const onMouseUp = (e: MouseEvent) => {
      if (e.button === 2 && this.isRightDown) {
        this.isRightDown = false;
        const moved = Math.hypot(e.clientX - this.rightStartX, e.clientY - this.rightStartY);
        if (moved <= 6) {
          if (this.placementTemplateId) {
            this.setPlacementMode(null);
            return;
          }
          this.attackMoveMode = false;
          this.garrisonTargetMode = false;
          this.handleRightClick(e);
        }
        return;
      }

      if (e.button !== 0 || !this.isDraggingBox) return;
      this.isDraggingBox = false;
      this.boxEl.style.display = 'none';

      const dx = Math.abs(e.clientX - this.dragStartX);
      const dy = Math.abs(e.clientY - this.dragStartY);

      if (dx <= 6 && dy <= 6) {
        this.handleSingleClickSelect(e.clientX, e.clientY, e.shiftKey);
      } else {
        this.handleBoxSelect(
          Math.min(this.dragStartX, e.clientX),
          Math.min(this.dragStartY, e.clientY),
          Math.max(this.dragStartX, e.clientX),
          Math.max(this.dragStartY, e.clientY),
          e.shiftKey
        );
      }
    };

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement) return;

      if (e.code === 'Escape') {
        if (this.placementTemplateId) {
          this.setPlacementMode(null);
        } else {
          this.attackMoveMode = false;
          this.garrisonTargetMode = false;
          this.selectedIds.clear();
          this.callbacks.onSelectionChanged();
        }
        return;
      }

      if (e.code === 'Period') {
        this.selectIdleWorker();
        return;
      }

      if (e.code === 'Home' || e.code === 'Space') {
        e.preventDefault();
        this.jumpToCivicCenter();
        return;
      }

      if (e.code === 'KeyH') {
        this.jumpToCivicCenter();
        return;
      }

      if (e.code === 'KeyG' && this.selectedIds.size > 0) {
        this.garrisonTargetMode = true;
        this.callbacks.onStatusToast(t('toastGarrison'), 'info');
        return;
      }

      if (e.code === 'KeyC') {
        this.buildingOrderMode = this.buildingOrderMode === 'capture' ? 'attack' : 'capture';
        this.callbacks.onStatusToast(
          this.buildingOrderMode === 'capture' ? t('toastModeCapture') : t('toastModeDestroy'),
          'info'
        );
        this.callbacks.onSelectionChanged();
        return;
      }

      if (e.code === 'Delete' || e.code === 'Backspace') {
        const owned = Array.from(this.selectedIds).filter((id) => {
          const ent = this.world.entities.get(id);
          return ent && ent.owner === this.humanPlayerId;
        });
        if (owned.length > 0) {
          this.world.enqueueCommand({ type: 'delete', playerId: this.humanPlayerId, entityIds: owned });
          this.selectedIds.clear();
          this.callbacks.onSelectionChanged();
        }
        return;
      }

      // Control groups: Digit1 .. Digit9
      if (e.code.startsWith('Digit')) {
        const num = parseInt(e.code.slice(5), 10);
        if (num >= 1 && num <= 9) {
          if (e.ctrlKey || e.metaKey) {
            e.preventDefault();
            const owned = Array.from(this.selectedIds).filter((id) => {
              const ent = this.world.entities.get(id);
              return ent && ent.alive && ent.owner === this.humanPlayerId;
            });
            this.controlGroups.set(num, owned);
            this.callbacks.onStatusToast(`${t('toastGroupAssigned')} ${num} (${owned.length})`, 'info');
          } else {
            const grp = (this.controlGroups.get(num) ?? []).filter((id) => {
              const ent = this.world.entities.get(id);
              return ent && ent.alive && ent.garrisonedIn === null;
            });
            if (grp.length > 0) {
              this.selectedIds.clear();
              grp.forEach((id) => this.selectedIds.add(id));
              this.audio.playSelect();
              this.callbacks.onSelectionChanged();

              const now = performance.now();
              if (this.lastGroupRecallKey === num && now - this.lastGroupRecallTime < 380) {
                const first = this.world.entities.get(grp[0]);
                if (first) this.sceneManager.rtsCamera.jumpTo(first.x, first.z);
              }
              this.lastGroupRecallKey = num;
              this.lastGroupRecallTime = now;
            }
          }
        }
      }
    };

    canvas.addEventListener('contextmenu', onContextMenu);
    canvas.addEventListener('mousedown', onMouseDown);
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
    window.addEventListener('keydown', onKeyDown);

    this.cleanupFns = [
      () => canvas.removeEventListener('contextmenu', onContextMenu),
      () => canvas.removeEventListener('mousedown', onMouseDown),
      () => window.removeEventListener('mousemove', onMouseMove),
      () => window.removeEventListener('mouseup', onMouseUp),
      () => window.removeEventListener('keydown', onKeyDown),
    ];
  }

  private tryConfirmPlacement(clientX: number, clientY: number, keepPlacing: boolean): void {
    if (!this.placementTemplateId) return;
    const hit = this.sceneManager.raycastTerrain(clientX, clientY);
    if (!hit) return;

    const { tx, tz } = this.world.terrain.worldToTile(hit.x, hit.z);
    const check = this.world.canPlaceBuilding(this.humanPlayerId, this.placementTemplateId, tx, tz);
    if (!check.ok) {
      this.audio.playError();
      this.callbacks.onStatusToast(translateBuildReason(check.reason), 'warn');
      return;
    }

    const builders = Array.from(this.selectedIds).filter((id) => {
      const e = this.world.entities.get(id);
      return e && e.alive && e.owner === this.humanPlayerId && TEMPLATES[e.templateId].canBuild?.includes(this.placementTemplateId!);
    });

    this.world.enqueueCommand({
      type: 'build',
      playerId: this.humanPlayerId,
      entityIds: builders,
      templateId: this.placementTemplateId,
      tileX: tx,
      tileZ: tz,
    });
    this.audio.playOrder();
    this.sceneManager.spawnClickPing(hit.x, hit.z, hit.y, 0x22c55e);

    if (!keepPlacing) {
      this.setPlacementMode(null);
    }
  }

  private handleSingleClickSelect(clientX: number, clientY: number, additive: boolean): void {
    const picked = this.pickEntityAtScreen(clientX, clientY);
    const now = performance.now();

    if (!picked) {
      if (!additive) {
        this.selectedIds.clear();
        this.callbacks.onSelectionChanged();
      }
      return;
    }

    // Double click selects all visible friendly units of the same type on screen
    if (
      picked.owner === this.humanPlayerId &&
      TEMPLATES[picked.templateId].kind === 'unit' &&
      picked.id === this.lastClickedEntityId &&
      now - this.lastClickTime < 350
    ) {
      const rect = this.sceneManager.renderer.domElement.getBoundingClientRect();
      this.selectedIds.clear();
      for (const e of this.world.entities.values()) {
        if (!e.alive || e.owner !== this.humanPlayerId || e.templateId !== picked.templateId || e.garrisonedIn !== null) {
          continue;
        }
        const y = this.world.terrain.getHeightAt(e.x, e.z) + 0.9;
        const proj = this.sceneManager.projectToScreen(e.x, y, e.z);
        if (proj.inFront && proj.sx >= rect.left && proj.sx <= rect.right && proj.sy >= rect.top && proj.sy <= rect.bottom) {
          this.selectedIds.add(e.id);
        }
      }
      this.audio.playSelect();
      this.callbacks.onSelectionChanged();
      this.lastClickTime = 0;
      return;
    }

    this.lastClickedEntityId = picked.id;
    this.lastClickTime = now;

    if (additive && picked.owner === this.humanPlayerId) {
      if (this.selectedIds.has(picked.id)) this.selectedIds.delete(picked.id);
      else this.selectedIds.add(picked.id);
    } else {
      this.selectedIds.clear();
      this.selectedIds.add(picked.id);
    }
    this.audio.playSelect(picked.templateId);
    this.callbacks.onSelectionChanged();
  }

  private handleBoxSelect(minX: number, minY: number, maxX: number, maxY: number, additive: boolean): void {
    const foundUnits: number[] = [];
    const foundBuildings: number[] = [];

    for (const e of this.world.entities.values()) {
      if (!e.alive || e.owner !== this.humanPlayerId || e.garrisonedIn !== null) continue;
      const tpl = TEMPLATES[e.templateId];
      const y = this.world.terrain.getHeightAt(e.x, e.z) + (tpl.kind === 'building' ? 1.5 : 0.9);
      const proj = this.sceneManager.projectToScreen(e.x, y, e.z);
      if (!proj.inFront) continue;
      if (proj.sx >= minX && proj.sx <= maxX && proj.sy >= minY && proj.sy <= maxY) {
        if (tpl.kind === 'unit') foundUnits.push(e.id);
        else foundBuildings.push(e.id);
      }
    }

    const chosen = foundUnits.length > 0 ? foundUnits : foundBuildings;
    if (!additive) this.selectedIds.clear();
    for (const id of chosen) this.selectedIds.add(id);

    if (chosen.length > 0) this.audio.playSelect();
    this.callbacks.onSelectionChanged();
  }

  private handleRightClick(e: MouseEvent): void {
    if (this.selectedIds.size === 0) return;

    const selectedEntities = Array.from(this.selectedIds)
      .map((id) => this.world.entities.get(id))
      .filter((ent): ent is Entity => !!ent && ent.alive && ent.owner === this.humanPlayerId);

    if (selectedEntities.length === 0) return;

    const pickedDirect = this.pickEntityAtScreen(e.clientX, e.clientY);
    const terrainHit = this.sceneManager.raycastTerrain(e.clientX, e.clientY);

    // If right-clicking near a tree/mine/berry on terrain and screen-pick missed the canopy/base, snap to nearest resource
    let picked = pickedDirect;
    if (!picked && terrainHit) {
      let bestRes: Entity | null = null;
      let bestD2 = 2.4 * 2.4;
      for (const ent of this.world.entities.values()) {
        if (!ent.alive || ent.resourceRemaining <= 0) continue;
        const tpl = TEMPLATES[ent.templateId];
        if (!tpl.resourceType) continue;
        if (tpl.isFarmField && (ent.owner !== this.humanPlayerId || ent.isFoundation)) continue;
        const dx = ent.x - terrainHit.x;
        const dz = ent.z - terrainHit.z;
        const d2 = dx * dx + dz * dz;
        const maxR = tpl.radius + 1.15;
        if (d2 <= maxR * maxR && d2 < bestD2) {
          bestD2 = d2;
          bestRes = ent;
        }
      }
      if (bestRes) picked = bestRes;
    }

    // Case 1: Production building(s) selected -> Set Rally Point
    const prodBuildings = selectedEntities.filter(
      (ent) => TEMPLATES[ent.templateId].kind === 'building' && TEMPLATES[ent.templateId].trains
    );
    const units = selectedEntities.filter((ent) => TEMPLATES[ent.templateId].kind === 'unit');

    if (units.length === 0 && prodBuildings.length > 0) {
      const targetPos = picked ? { x: picked.x, z: picked.z } : terrainHit ? { x: terrainHit.x, z: terrainHit.z } : null;
      if (targetPos) {
        for (const b of prodBuildings) {
          this.world.enqueueCommand({
            type: 'set_rally',
            playerId: this.humanPlayerId,
            buildingId: b.id,
            x: targetPos.x,
            z: targetPos.z,
            targetId: picked && TEMPLATES[picked.templateId].resourceType ? picked.id : undefined,
          });
        }
        this.audio.playOrder();
        this.sceneManager.spawnClickPing(
          targetPos.x,
          targetPos.z,
          this.world.terrain.getHeightAt(targetPos.x, targetPos.z),
          0xfacc15
        );
      }
      return;
    }

    if (units.length === 0) return;
    const unitIds = units.map((u) => u.id);

    // Case 2: Right-click on an entity
    if (picked) {
      const pTpl = TEMPLATES[picked.templateId];
      const py = this.world.terrain.getHeightAt(picked.x, picked.z);

      // Enemy -> Attack or Capture
      if (picked.owner !== 0 && picked.owner !== this.humanPlayerId) {
        const mode: BuildingOrderMode =
          pTpl.kind === 'building' ? (e.altKey ? 'attack' : this.buildingOrderMode) : 'attack';
        this.world.enqueueCommand({
          type: 'attack',
          playerId: this.humanPlayerId,
          entityIds: unitIds,
          targetId: picked.id,
          mode,
        });
        this.audio.playOrder();
        this.sceneManager.spawnClickPing(picked.x, picked.z, py, mode === 'capture' && pTpl.kind === 'building' ? 0x38bdf8 : 0xef4444);
        return;
      }

      // Friendly building -> Garrison (Alt+RightClick), Repair/Build, or Farm Field
      if (picked.owner === this.humanPlayerId && pTpl.kind === 'building') {
        if (picked.isFoundation || picked.hp < picked.maxHp) {
          this.world.enqueueCommand({
            type: 'repair',
            playerId: this.humanPlayerId,
            entityIds: unitIds,
            targetId: picked.id,
          });
          this.audio.playOrder();
          this.sceneManager.spawnClickPing(picked.x, picked.z, py, 0x22c55e);
          return;
        }
        if (pTpl.isFarmField) {
          this.world.enqueueCommand({
            type: 'gather',
            playerId: this.humanPlayerId,
            entityIds: unitIds,
            targetId: picked.id,
          });
          this.audio.playOrder();
          this.sceneManager.spawnClickPing(picked.x, picked.z, py, 0xfacc15);
          return;
        }
        if (e.altKey && pTpl.garrisonCapacity) {
          this.world.enqueueCommand({
            type: 'garrison',
            playerId: this.humanPlayerId,
            entityIds: unitIds,
            buildingId: picked.id,
          });
          this.audio.playOrder();
          this.sceneManager.spawnClickPing(picked.x, picked.z, py, 0x38bdf8);
          return;
        }
      }

      // Natural resource -> Gather
      if (pTpl.resourceType && picked.resourceRemaining > 0) {
        this.world.enqueueCommand({
          type: 'gather',
          playerId: this.humanPlayerId,
          entityIds: unitIds,
          targetId: picked.id,
        });
        this.audio.playOrder();
        this.sceneManager.spawnClickPing(picked.x, picked.z, py, 0xfacc15);
        return;
      }
    }

    // Case 3: Ground click -> Move
    if (terrainHit) {
      this.issueMove(terrainHit.x, terrainHit.z, e.shiftKey, false);
    }
  }

  issueMove(x: number, z: number, queued: boolean, attackMove: boolean): void {
    const unitIds = Array.from(this.selectedIds).filter((id) => {
      const e = this.world.entities.get(id);
      return e && e.alive && e.owner === this.humanPlayerId && TEMPLATES[e.templateId].kind === 'unit';
    });
    if (unitIds.length === 0) return;

    this.world.enqueueCommand({
      type: 'move',
      playerId: this.humanPlayerId,
      entityIds: unitIds,
      x,
      z,
      queued,
      attackMove,
    });
    this.audio.playOrder();
    this.sceneManager.spawnClickPing(x, z, this.world.terrain.getHeightAt(x, z), attackMove ? 0xf97316 : 0x4ade80);
  }

  private pickEntityAtScreen(clientX: number, clientY: number): Entity | null {
    const revealAll = this.sceneManager.terrainRenderer.isRevealAll();
    const terrainHit = this.sceneManager.raycastTerrain(clientX, clientY);
    let best: Entity | null = null;
    let bestScore = Infinity;

    for (const e of this.world.entities.values()) {
      if (!e.alive || e.garrisonedIn !== null) continue;
      const tpl = TEMPLATES[e.templateId];
      if (!revealAll && e.owner !== this.humanPlayerId) {
        if (tpl.kind === 'unit' && !this.world.fog.isVisibleTo(this.humanPlayerId, e.x, e.z)) continue;
        if (tpl.kind !== 'unit' && !this.world.fog.isExploredBy(this.humanPlayerId, e.x, e.z)) continue;
      }

      const groundY = this.world.terrain.getHeightAt(e.x, e.z);

      // Buildings (Civic Center, Fortress, Wonder, Barracks, Temple, etc.):
      // Project full 3D bounding box to exact zoom-accurate screen rectangle AND test 3D terrain footprint!
      if (tpl.kind === 'building') {
        const halfW = Math.max(tpl.radius * 0.95, (tpl.footprintTiles ?? 2) * 0.95);
        const topH = tpl.isCivicCenter || tpl.isFortress || tpl.isWonder ? 6.2 : tpl.isFarmField ? 1.1 : 4.2;

        // 1. Direct 3D footprint hit on terrain
        let hit = false;
        let centerDistPx = Infinity;
        if (terrainHit) {
          const wdx = Math.abs(terrainHit.x - e.x);
          const wdz = Math.abs(terrainHit.z - e.z);
          if (wdx <= halfW * 1.06 && wdz <= halfW * 1.06) {
            hit = true;
          }
        }

        // 2. Exact projected 8-corner 3D bounding box hit on screen (works clicking roofs, columns, towers at any zoom!)
        let minSx = Infinity;
        let maxSx = -Infinity;
        let minSy = Infinity;
        let maxSy = -Infinity;
        let anyInFront = false;
        for (const sxOff of [-halfW, halfW]) {
          for (const szOff of [-halfW, halfW]) {
            for (const syOff of [0.1, topH]) {
              const p = this.sceneManager.projectToScreen(e.x + sxOff, groundY + syOff, e.z + szOff);
              if (!p.inFront) continue;
              anyInFront = true;
              if (p.sx < minSx) minSx = p.sx;
              if (p.sx > maxSx) maxSx = p.sx;
              if (p.sy < minSy) minSy = p.sy;
              if (p.sy > maxSy) maxSy = p.sy;
            }
          }
        }
        if (!anyInFront) continue;

        const pad = 8;
        if (clientX >= minSx - pad && clientX <= maxSx + pad && clientY >= minSy - pad && clientY <= maxSy + pad) {
          hit = true;
        }
        if (!hit) continue;

        const midX = (minSx + maxSx) * 0.5;
        const midY = (minSy + maxSy) * 0.5;
        centerDistPx = Math.hypot(clientX - midX, clientY - midY);
        // Normalize score so clicking anywhere inside a large Civic Center beats distant units
        const score = Math.min(centerDistPx * 0.25, 22) + 10;
        if (score < bestScore) {
          bestScore = score;
          best = e;
        }
        continue;
      }

      const isTree = tpl.kind === 'resource' && tpl.resourceType === 'wood';
      const yLow = isTree ? 0.7 : 0.45;
      const yHigh = isTree ? 4.4 : tpl.kind === 'unit' ? 1.65 : 1.5;

      const pLow = this.sceneManager.projectToScreen(e.x, groundY + yLow, e.z);
      const pHigh = this.sceneManager.projectToScreen(e.x, groundY + yHigh, e.z);
      if (!pLow.inFront && !pHigh.inFront) continue;

      // Distance from click pixel to screen-space vertical capsule (trunk-to-canopy / feet-to-head)
      const segDx = pHigh.sx - pLow.sx;
      const segDy = pHigh.sy - pLow.sy;
      const segLen2 = segDx * segDx + segDy * segDy;
      const t =
        segLen2 > 0.001
          ? Math.max(0, Math.min(1, ((clientX - pLow.sx) * segDx + (clientY - pLow.sy) * segDy) / segLen2))
          : 0;
      const cx = pLow.sx + segDx * t;
      const cy = pLow.sy + segDy * t;
      const d = Math.hypot(cx - clientX, cy - clientY);

      const pixelRadius = isTree
        ? 30
        : tpl.kind === 'resource'
          ? Math.max(28, tpl.radius * 18)
          : 22;

      if (d <= pixelRadius) {
        const priorityBias = tpl.kind === 'unit' ? 0 : 6;
        const score = d + priorityBias;
        if (score < bestScore) {
          bestScore = score;
          best = e;
        }
      }
    }
    return best;
  }

  detach(): void {
    for (const fn of this.cleanupFns) fn();
    this.cleanupFns = [];
  }
}
