import { AudioManager } from '../audio/AudioManager';
import { TEMPLATES } from '../config/entities';
import { getTemplateText, t, translateBuildReason } from '../config/i18n';
import { BuildingOrderMode, Entity, TerraformMode } from '../config/types';
import { SceneManager } from '../render/SceneManager';
import { WATER_LEVEL } from '../sim/map/TerrainMap';
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
  placementFacing = 0;
  terraformMode: TerraformMode | null = null;
  pendingDigSource: { tx: number; tz: number; x: number; y: number; z: number } | null = null;
  attackMoveMode = false;
  garrisonTargetMode = false;
  rallyTargetMode = false;
  plantTreeMode = false;
  plantSourceTreeId: number | null = null;
  hybridTreeMode = false;
  hybridTreeAId: number | null = null;
  hybridTreeBId: number | null = null;
  captureAnimalMode = false;
  buildingOrderMode: BuildingOrderMode = 'capture';

  private readonly humanPlayerId = 1;
  private isDraggingBox = false;
  private dragStartX = 0;
  private dragStartY = 0;
  private isDraggingWall = false;
  private wallDragStartTile: { tx: number; tz: number } | null = null;
  private wallDragSegments: Array<{ tx: number; tz: number; facing: number }> = [];
  private isDraggingTunnel = false;
  private tunnelDragStartTile: { tx: number; tz: number } | null = null;
  private tunnelDragEndTile: { tx: number; tz: number } | null = null;
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
    this.terraformMode = null;
    this.pendingDigSource = null;
    this.attackMoveMode = false;
    this.garrisonTargetMode = false;
    this.rallyTargetMode = false;
    this.plantTreeMode = false;
    this.plantSourceTreeId = null;
    this.hybridTreeMode = false;
    this.hybridTreeAId = null;
    this.hybridTreeBId = null;
    this.captureAnimalMode = false;
    this.attach();
  }

  startRallyTargetMode(): void {
    this.setPlacementMode(null);
    this.terraformMode = null;
    this.attackMoveMode = false;
    this.garrisonTargetMode = false;
    this.plantTreeMode = false;
    this.plantSourceTreeId = null;
    this.hybridTreeMode = false;
    this.hybridTreeAId = null;
    this.hybridTreeBId = null;
    this.captureAnimalMode = false;
    this.rallyTargetMode = true;
    this.callbacks.onStatusToast(t('toastRallyModeHint'), 'info');
  }

  startPlantTreeMode(): void {
    const workers = Array.from(this.selectedIds).filter((id) => {
      const e = this.world.entities.get(id);
      if (!e || !e.alive || e.owner !== this.humanPlayerId || e.garrisonedIn !== null) return false;
      const tpl = TEMPLATES[e.templateId];
      return Boolean(tpl.gather && !tpl.isNaval);
    });
    if (workers.length === 0) {
      this.audio.playError();
      this.callbacks.onStatusToast(t('toastNeedWorkers'), 'warn');
      return;
    }
    this.setPlacementMode(null);
    this.terraformMode = null;
    this.attackMoveMode = false;
    this.garrisonTargetMode = false;
    this.rallyTargetMode = false;
    this.hybridTreeMode = false;
    this.hybridTreeAId = null;
    this.hybridTreeBId = null;
    this.captureAnimalMode = false;
    this.plantTreeMode = true;
    this.plantSourceTreeId = null;
    this.callbacks.onStatusToast(t('toastPlantSelectTree'), 'info');
    this.callbacks.onSelectionChanged();
  }

  cancelPlantTreeMode(): void {
    this.plantTreeMode = false;
    this.plantSourceTreeId = null;
    this.callbacks.onSelectionChanged();
  }

  startHybridTreeMode(): void {
    const workers = Array.from(this.selectedIds).filter((id) => {
      const e = this.world.entities.get(id);
      if (!e || !e.alive || e.owner !== this.humanPlayerId || e.garrisonedIn !== null) return false;
      const tpl = TEMPLATES[e.templateId];
      return Boolean(tpl.gather && !tpl.isNaval);
    });
    if (workers.length === 0) {
      this.audio.playError();
      this.callbacks.onStatusToast(t('toastNeedWorkers'), 'warn');
      return;
    }
    this.setPlacementMode(null);
    this.terraformMode = null;
    this.attackMoveMode = false;
    this.garrisonTargetMode = false;
    this.rallyTargetMode = false;
    this.plantTreeMode = false;
    this.plantSourceTreeId = null;
    this.captureAnimalMode = false;
    this.hybridTreeMode = true;
    this.hybridTreeAId = null;
    this.hybridTreeBId = null;
    this.callbacks.onStatusToast(t('toastHybridStep1'), 'info');
    this.callbacks.onSelectionChanged();
  }

  cancelHybridTreeMode(): void {
    this.hybridTreeMode = false;
    this.hybridTreeAId = null;
    this.hybridTreeBId = null;
    this.callbacks.onSelectionChanged();
  }

  startCaptureAnimalMode(): void {
    const workers = Array.from(this.selectedIds).filter((id) => {
      const e = this.world.entities.get(id);
      if (!e || !e.alive || e.owner !== this.humanPlayerId || e.garrisonedIn !== null) return false;
      const tpl = TEMPLATES[e.templateId];
      return Boolean(tpl.gather && !tpl.isNaval);
    });
    if (workers.length === 0) {
      this.audio.playError();
      this.callbacks.onStatusToast(t('toastNeedWorkers'), 'warn');
      return;
    }
    let hasPasture = false;
    for (const ent of this.world.entities.values()) {
      if (ent.alive && ent.owner === this.humanPlayerId && !ent.isFoundation && TEMPLATES[ent.templateId]?.isPasture) {
        hasPasture = true;
        break;
      }
    }
    if (!hasPasture) {
      this.audio.playError();
      this.callbacks.onStatusToast(t('toastCaptureNeedPasture'), 'warn');
      return;
    }
    const firstW = this.world.entities.get(workers[0])!;
    if (!this.world.findNearestAvailablePasture(this.humanPlayerId, firstW.x, firstW.z)) {
      this.audio.playError();
      this.callbacks.onStatusToast(t('toastCapturePastureFull'), 'warn');
      return;
    }
    this.setPlacementMode(null);
    this.terraformMode = null;
    this.attackMoveMode = false;
    this.garrisonTargetMode = false;
    this.rallyTargetMode = false;
    this.plantTreeMode = false;
    this.plantSourceTreeId = null;
    this.hybridTreeMode = false;
    this.hybridTreeAId = null;
    this.hybridTreeBId = null;
    this.captureAnimalMode = true;
    this.callbacks.onStatusToast(t('toastCaptureSelectAnimal'), 'info');
    this.callbacks.onSelectionChanged();
  }

  cancelCaptureAnimalMode(): void {
    this.captureAnimalMode = false;
    this.callbacks.onSelectionChanged();
  }

  setPlacementMode(templateId: string | null): void {
    this.placementTemplateId = templateId;
    this.placementFacing = 0;
    this.terraformMode = null;
    this.pendingDigSource = null;
    this.isDraggingWall = false;
    this.wallDragStartTile = null;
    this.wallDragSegments = [];
    this.isDraggingTunnel = false;
    this.tunnelDragStartTile = null;
    this.tunnelDragEndTile = null;
    this.attackMoveMode = false;
    this.garrisonTargetMode = false;
    this.plantTreeMode = false;
    this.plantSourceTreeId = null;
    this.hybridTreeMode = false;
    this.hybridTreeAId = null;
    this.hybridTreeBId = null;
    this.captureAnimalMode = false;
    this.sceneManager.updateWallLinePreview([]);
    this.sceneManager.updateTunnelDragPreview(null, null, false);
    this.sceneManager.updateTerraformPreview(0, 0, 0, null, false);
    if (!templateId) {
      this.sceneManager.updateGhostPreview(null, this.world.config.playerCiv, 0, 0, 0, false);
    }
    this.callbacks.onPlacementChanged(templateId);
    if (templateId === 'tunnel_portal') {
      this.callbacks.onStatusToast(t('toastTunnelDragHint'), 'info');
    }
  }

  setTerraformMode(mode: TerraformMode | null): void {
    if (this.placementTemplateId) {
      this.setPlacementMode(null);
    }
    this.terraformMode = mode;
    this.pendingDigSource = null;
    this.attackMoveMode = false;
    this.garrisonTargetMode = false;
    this.plantTreeMode = false;
    this.plantSourceTreeId = null;
    this.hybridTreeMode = false;
    this.hybridTreeAId = null;
    this.hybridTreeBId = null;
    this.captureAnimalMode = false;
    if (!mode) {
      this.sceneManager.updateTerraformPreview(0, 0, 0, null, false);
    } else {
      this.callbacks.onStatusToast(
        mode === 'dig' ? t('toastDigMode') : mode === 'level' ? t('toastLevelMode') : t('toastRaiseMode'),
        'info'
      );
    }
    this.callbacks.onSelectionChanged();
  }

  /** Triggered from the top UI buttons: auto-selects available workers if none are currently selected */
  activateTerraformFromUI(mode: TerraformMode): void {
    if (this.terraformMode === mode) {
      this.setTerraformMode(null);
      return;
    }
    const selectedWorkers = Array.from(this.selectedIds).filter((id) => {
      const e = this.world.entities.get(id);
      if (!e || !e.alive || e.owner !== this.humanPlayerId || e.garrisonedIn !== null) return false;
      const tpl = TEMPLATES[e.templateId];
      return Boolean(tpl.gather && !tpl.isNaval);
    });
    if (selectedWorkers.length === 0) {
      const idleWorkers: Entity[] = [];
      const busyWorkers: Entity[] = [];
      for (const e of this.world.entities.values()) {
        if (!e.alive || e.owner !== this.humanPlayerId || e.garrisonedIn !== null) continue;
        const tpl = TEMPLATES[e.templateId];
        if (!tpl.gather || tpl.isNaval) continue;
        if (e.order.type === 'idle') idleWorkers.push(e);
        else busyWorkers.push(e);
      }
      const chosen = (idleWorkers.length > 0 ? idleWorkers : busyWorkers).slice(0, 3);
      if (chosen.length === 0) {
        this.audio.playError();
        this.callbacks.onStatusToast(t('toastNeedWorkers'), 'warn');
        return;
      }
      this.selectedIds.clear();
      for (const w of chosen) this.selectedIds.add(w.id);
      this.audio.playSelect(chosen[0].templateId);
    }
    this.setTerraformMode(mode);
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
        // Placement mode confirmation (drag-line for walls/bridges, straight underground drag for tunnels!)
        if (this.placementTemplateId) {
          if (this.placementTemplateId === 'tunnel_portal') {
            const hit = this.sceneManager.raycastTerrain(e.clientX, e.clientY);
            if (hit) {
              const start = this.world.terrain.worldToTile(hit.x, hit.z);
              this.isDraggingTunnel = true;
              this.tunnelDragStartTile = start;
              this.tunnelDragEndTile = start;
              this.updateTunnelDrag(start.tx, start.tz);
              return;
            }
          }
          if (this.placementTemplateId === 'stone_wall' || this.placementTemplateId === 'stone_bridge') {
            const hit = this.sceneManager.raycastTerrain(e.clientX, e.clientY);
            if (hit) {
              const start = this.world.terrain.worldToTile(hit.x, hit.z);
              this.isDraggingWall = true;
              this.wallDragStartTile = start;
              this.updateWallDrag(start.tx, start.tz);
              return;
            }
          }
          this.tryConfirmPlacement(e.clientX, e.clientY, e.shiftKey);
          return;
        }
        // Worker terraforming mode (Dig / Raise terrain)
        if (this.terraformMode) {
          this.tryConfirmTerraform(e.clientX, e.clientY, e.shiftKey);
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
        // Rally Point target click (for Civic Center & all production buildings!)
        if (this.rallyTargetMode) {
          const picked = this.pickEntityAtScreen(e.clientX, e.clientY);
          const terrainHit = this.sceneManager.raycastTerrain(e.clientX, e.clientY);
          const targetPos = picked
            ? { x: picked.x, z: picked.z }
            : terrainHit
              ? { x: terrainHit.x, z: terrainHit.z }
              : null;
          if (targetPos) {
            const prodBuildings = Array.from(this.selectedIds)
              .map((id) => this.world.entities.get(id))
              .filter(
                (ent): ent is Entity =>
                  !!ent && ent.alive && ent.owner === this.humanPlayerId && TEMPLATES[ent.templateId].kind === 'building' && Boolean(TEMPLATES[ent.templateId].trains)
              );
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
            if (prodBuildings.length > 0) {
              this.audio.playOrder();
              this.sceneManager.spawnClickPing(
                targetPos.x,
                targetPos.z,
                this.world.terrain.getHeightAt(targetPos.x, targetPos.z),
                0xfacc15
              );
              this.callbacks.onStatusToast(t('toastRallyUpdated'), 'good');
            }
          }
          this.rallyTargetMode = false;
          return;
        }
        // Tree Branch Planting 2-step mode: Step 1 click existing tree -> Step 2 click empty dry land!
        if (this.plantTreeMode) {
          if (this.plantSourceTreeId === null) {
            let picked = this.pickEntityAtScreen(e.clientX, e.clientY);
            if (!picked || !World.isTreeTemplate(picked.templateId)) {
              const hit = this.sceneManager.raycastTerrain(e.clientX, e.clientY);
              if (hit) {
                let bestTree: Entity | null = null;
                let bestD2 = 3.6 * 3.6;
                for (const ent of this.world.entities.values()) {
                  if (!ent.alive || !World.isTreeTemplate(ent.templateId)) continue;
                  const dx = ent.x - hit.x;
                  const dz = ent.z - hit.z;
                  const d2 = dx * dx + dz * dz;
                  if (d2 < bestD2) {
                    bestD2 = d2;
                    bestTree = ent;
                  }
                }
                picked = bestTree;
              }
            }
            if (picked && picked.alive && World.isTreeTemplate(picked.templateId)) {
              this.plantSourceTreeId = picked.id;
              this.audio.playOrder();
              this.sceneManager.spawnClickPing(
                picked.x,
                picked.z,
                this.world.terrain.getHeightAt(picked.x, picked.z),
                0x22c55e
              );
              this.callbacks.onStatusToast(`${t('toastPlantSelectSpot')} (${getTemplateText(picked.templateId).name})`, 'info');
              this.callbacks.onSelectionChanged();
            } else {
              this.audio.playError();
              this.callbacks.onStatusToast(t('toastPlantSelectTree'), 'warn');
            }
            return;
          } else {
            const hit = this.sceneManager.raycastTerrain(e.clientX, e.clientY);
            const spot = hit ? this.world.findNearestPlantableSpot(hit.x, hit.z, 3.8) : null;
            if (!hit || !spot) {
              this.audio.playError();
              this.callbacks.onStatusToast(t('toastPlantInvalidSpot'), 'warn');
              return;
            }
            const workers = Array.from(this.selectedIds).filter((id) => {
              const ent = this.world.entities.get(id);
              if (!ent || !ent.alive || ent.owner !== this.humanPlayerId || ent.garrisonedIn !== null) return false;
              const tpl = TEMPLATES[ent.templateId];
              return Boolean(tpl.gather && !tpl.isNaval);
            });
            if (workers.length === 0) {
              this.cancelPlantTreeMode();
              return;
            }
            this.world.enqueueCommand({
              type: 'plant_tree',
              playerId: this.humanPlayerId,
              entityIds: workers,
              sourceTreeId: this.plantSourceTreeId,
              x: spot.x,
              z: spot.z,
              queued: e.shiftKey,
            });
            this.audio.playOrder();
            this.sceneManager.spawnClickPing(spot.x, spot.z, this.world.terrain.getHeightAt(spot.x, spot.z), 0x22c55e);
            if (!e.shiftKey) {
              this.cancelPlantTreeMode();
            }
            return;
          }
        }
        // Tree Hybridization 3-step mode: Step 1 click tree A -> Step 2 click DIFFERENT species tree B -> Step 3 click dry ground!
        if (this.hybridTreeMode) {
          const pickNearbyTree = (): Entity | null => {
            let picked = this.pickEntityAtScreen(e.clientX, e.clientY);
            if (!picked || !World.isTreeTemplate(picked.templateId)) {
              const hit = this.sceneManager.raycastTerrain(e.clientX, e.clientY);
              if (hit) {
                let bestTree: Entity | null = null;
                let bestD2 = 3.6 * 3.6;
                for (const ent of this.world.entities.values()) {
                  if (!ent.alive || !World.isTreeTemplate(ent.templateId)) continue;
                  const dx = ent.x - hit.x;
                  const dz = ent.z - hit.z;
                  const d2 = dx * dx + dz * dz;
                  if (d2 < bestD2) {
                    bestD2 = d2;
                    bestTree = ent;
                  }
                }
                picked = bestTree;
              }
            }
            return picked && picked.alive && World.isTreeTemplate(picked.templateId) ? picked : null;
          };

          if (this.hybridTreeAId === null) {
            const treeA = pickNearbyTree();
            if (treeA) {
              this.hybridTreeAId = treeA.id;
              this.audio.playOrder();
              this.sceneManager.spawnClickPing(
                treeA.x,
                treeA.z,
                this.world.terrain.getHeightAt(treeA.x, treeA.z),
                0x22c55e
              );
              this.callbacks.onStatusToast(`${t('toastHybridStep2')} (${getTemplateText(treeA.templateId).name})`, 'info');
              this.callbacks.onSelectionChanged();
            } else {
              this.audio.playError();
              this.callbacks.onStatusToast(t('toastHybridStep1'), 'warn');
            }
            return;
          } else if (this.hybridTreeBId === null) {
            const treeA = this.world.entities.get(this.hybridTreeAId);
            const treeB = pickNearbyTree();
            if (!treeA || !treeA.alive) {
              this.hybridTreeAId = null;
              this.audio.playError();
              this.callbacks.onStatusToast(t('toastHybridStep1'), 'warn');
              return;
            }
            if (!treeB) {
              this.audio.playError();
              this.callbacks.onStatusToast(t('toastHybridStep2'), 'warn');
              return;
            }
            const resultTpl = World.resolveHybridTreeTemplate(treeA.templateId, treeB.templateId);
            if (!resultTpl) {
              this.audio.playError();
              this.callbacks.onStatusToast(t('toastHybridNeedDifferent'), 'warn');
              return;
            }
            this.hybridTreeBId = treeB.id;
            this.audio.playOrder();
            this.sceneManager.spawnClickPing(
              treeB.x,
              treeB.z,
              this.world.terrain.getHeightAt(treeB.x, treeB.z),
              0xfacc15
            );
            this.callbacks.onStatusToast(
              `${t('toastHybridStep3')} (${getTemplateText(treeA.templateId).shortName} × ${getTemplateText(treeB.templateId).shortName} → ${getTemplateText(resultTpl).name})`,
              'good'
            );
            this.callbacks.onSelectionChanged();
            return;
          } else {
            const hit = this.sceneManager.raycastTerrain(e.clientX, e.clientY);
            const spot = hit ? this.world.findNearestPlantableSpot(hit.x, hit.z, 3.8) : null;
            if (!hit || !spot) {
              this.audio.playError();
              this.callbacks.onStatusToast(t('toastPlantInvalidSpot'), 'warn');
              return;
            }
            const workers = Array.from(this.selectedIds).filter((id) => {
              const ent = this.world.entities.get(id);
              if (!ent || !ent.alive || ent.owner !== this.humanPlayerId || ent.garrisonedIn !== null) return false;
              const tpl = TEMPLATES[ent.templateId];
              return Boolean(tpl.gather && !tpl.isNaval);
            });
            if (workers.length === 0) {
              this.cancelHybridTreeMode();
              return;
            }
            this.world.enqueueCommand({
              type: 'hybridize_tree',
              playerId: this.humanPlayerId,
              entityIds: workers,
              treeAId: this.hybridTreeAId,
              treeBId: this.hybridTreeBId,
              x: spot.x,
              z: spot.z,
              queued: e.shiftKey,
            });
            this.audio.playOrder();
            this.sceneManager.spawnClickPing(spot.x, spot.z, this.world.terrain.getHeightAt(spot.x, spot.z), 0xfacc15);
            if (!e.shiftKey) {
              this.cancelHybridTreeMode();
            }
            return;
          }
        }
        // Capture Wild Animal to Pasture mode: click any live wild huntable land animal!
        if (this.captureAnimalMode) {
          let picked = this.pickEntityAtScreen(e.clientX, e.clientY);
          if (!picked || !World.isDomesticableAnimal(picked)) {
            const hit = this.sceneManager.raycastTerrain(e.clientX, e.clientY);
            if (hit) {
              let bestAnimal: Entity | null = null;
              let bestD2 = 3.8 * 3.8;
              for (const ent of this.world.entities.values()) {
                if (!World.isDomesticableAnimal(ent)) continue;
                const dx = ent.x - hit.x;
                const dz = ent.z - hit.z;
                const d2 = dx * dx + dz * dz;
                if (d2 < bestD2) {
                  bestD2 = d2;
                  bestAnimal = ent;
                }
              }
              picked = bestAnimal;
            }
          }
          if (!picked || !World.isDomesticableAnimal(picked)) {
            this.audio.playError();
            this.callbacks.onStatusToast(t('toastCaptureSelectAnimal'), 'warn');
            return;
          }
          const pasture = this.world.findNearestAvailablePasture(this.humanPlayerId, picked.x, picked.z);
          if (!pasture) {
            this.audio.playError();
            this.callbacks.onStatusToast(t('toastCapturePastureFull'), 'warn');
            this.cancelCaptureAnimalMode();
            return;
          }
          const workers = Array.from(this.selectedIds).filter((id) => {
            const ent = this.world.entities.get(id);
            if (!ent || !ent.alive || ent.owner !== this.humanPlayerId || ent.garrisonedIn !== null) return false;
            const tpl = TEMPLATES[ent.templateId];
            return Boolean(tpl.gather && !tpl.isNaval);
          });
          if (workers.length === 0) {
            this.cancelCaptureAnimalMode();
            return;
          }
          this.world.enqueueCommand({
            type: 'capture_animal',
            playerId: this.humanPlayerId,
            entityIds: workers,
            animalId: picked.id,
            pastureId: pasture.id,
          });
          this.audio.playOrder();
          this.sceneManager.spawnClickPing(
            picked.x,
            picked.z,
            this.world.terrain.getHeightAt(picked.x, picked.z),
            0x34d399
          );
          if (!e.shiftKey) {
            this.cancelCaptureAnimalMode();
          }
          return;
        }
        // Garrison target click (Buildings, Beacon Towers, AND Warships!)
        if (this.garrisonTargetMode) {
          const picked = this.pickEntityAtScreen(e.clientX, e.clientY);
          const cap = picked ? this.world.getMaxGarrisonCapacity(picked) : 0;
          if (picked && picked.owner === this.humanPlayerId && !picked.isFoundation && cap > 0) {
            const pickedTpl = TEMPLATES[picked.templateId];
            const landIds = Array.from(this.selectedIds).filter((id) => {
              const u = this.world.entities.get(id);
              return Boolean(u && u.alive && u.owner === this.humanPlayerId && u.id !== picked.id && TEMPLATES[u.templateId].kind === 'unit' && !TEMPLATES[u.templateId].isNaval);
            });
            if (landIds.length === 0) {
              this.audio.playError();
              this.callbacks.onStatusToast(t('toastShipsCantGarrison'), 'warn');
            } else if (picked.garrisonedIds.length >= cap) {
              this.audio.playError();
              const fullKey = pickedTpl?.isNaval ? 'toastShipFull' : 'toastBeaconGarrisonFull';
              this.callbacks.onStatusToast(`${t(fullKey)} (${picked.garrisonedIds.length}/${cap})`, 'warn');
            } else {
              this.world.enqueueCommand({
                type: 'garrison',
                playerId: this.humanPlayerId,
                entityIds: landIds,
                buildingId: picked.id,
              });
              this.audio.playOrder();
              const pingY = pickedTpl?.isNaval ? WATER_LEVEL : this.world.terrain.getHeightAt(picked.x, picked.z);
              this.sceneManager.spawnClickPing(picked.x, picked.z, pingY, 0x38bdf8);
              if (pickedTpl?.isNaval) {
                this.callbacks.onStatusToast(`${t('toastShipBoardStart')} (${picked.garrisonedIds.length}/${cap})`, 'good');
              } else if (pickedTpl?.isBeaconTower) {
                this.callbacks.onStatusToast(`${t('toastBeaconGarrisonStart')} (${picked.garrisonedIds.length}/${cap})`, 'good');
              }
            }
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
      if (this.isDraggingTunnel && this.tunnelDragStartTile && this.placementTemplateId === 'tunnel_portal') {
        const hit = this.sceneManager.raycastTerrain(e.clientX, e.clientY);
        if (hit) {
          const cur = this.world.terrain.worldToTile(hit.x, hit.z);
          this.updateTunnelDrag(cur.tx, cur.tz);
        }
        return;
      }
      if (
        this.isDraggingWall &&
        this.wallDragStartTile &&
        (this.placementTemplateId === 'stone_wall' || this.placementTemplateId === 'stone_bridge')
      ) {
        const hit = this.sceneManager.raycastTerrain(e.clientX, e.clientY);
        if (hit) {
          const cur = this.world.terrain.worldToTile(hit.x, hit.z);
          this.updateWallDrag(cur.tx, cur.tz);
        }
        return;
      }

      if (this.placementTemplateId) {
        const hit = this.sceneManager.raycastTerrain(e.clientX, e.clientY);
        if (hit) {
          const { tx, tz } = this.world.terrain.worldToTile(hit.x, hit.z);
          const center = this.world.terrain.tileToWorldCenter(tx, tz);
          const check = this.world.canPlaceBuilding(this.humanPlayerId, this.placementTemplateId, tx, tz);
          const y = this.world.terrain.getHeightAt(center.x, center.z);
          const pTpl = TEMPLATES[this.placementTemplateId];
          const facingY = pTpl?.isDock ? this.world.terrain.getCoastalDockInfo(tx, tz).waterAngle : this.placementFacing;
          this.sceneManager.updateGhostPreview(
            this.placementTemplateId,
            this.world.config.playerCiv,
            center.x,
            center.z,
            y,
            check.ok,
            facingY,
            check.ok ? null : translateBuildReason(check.reason)
          );
        }
      } else if (this.terraformMode) {
        const hit = this.sceneManager.raycastTerrain(e.clientX, e.clientY);
        if (hit) {
          const { tx, tz } = this.world.terrain.worldToTile(hit.x, hit.z);
          const center = this.world.terrain.tileToWorldCenter(tx, tz);
          const y = this.world.terrain.getHeightAt(center.x, center.z);
          const valid = this.world.canTerraformTile(tx, tz);
          const avgH = this.terraformMode === 'level' ? this.world.terrain.computeLevelAverageHeight(tx, tz) : undefined;
          this.sceneManager.updateTerraformPreview(center.x, y, center.z, this.terraformMode, valid, this.pendingDigSource, avgH);
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
          if (this.terraformMode) {
            this.setTerraformMode(null);
            return;
          }
          if (this.plantTreeMode) {
            this.cancelPlantTreeMode();
            return;
          }
          if (this.hybridTreeMode) {
            this.cancelHybridTreeMode();
            return;
          }
          if (this.captureAnimalMode) {
            this.cancelCaptureAnimalMode();
            return;
          }
          if (this.rallyTargetMode) {
            this.rallyTargetMode = false;
            return;
          }
          this.attackMoveMode = false;
          this.garrisonTargetMode = false;
          this.handleRightClick(e);
        }
        return;
      }

      if (e.button === 0 && this.isDraggingTunnel) {
        this.isDraggingTunnel = false;
        this.commitTunnelDrag(e.shiftKey);
        return;
      }

      if (e.button === 0 && this.isDraggingWall) {
        this.isDraggingWall = false;
        this.commitWallDrag(e.shiftKey);
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
        } else if (this.terraformMode) {
          this.setTerraformMode(null);
        } else if (this.plantTreeMode) {
          this.cancelPlantTreeMode();
        } else if (this.hybridTreeMode) {
          this.cancelHybridTreeMode();
        } else if (this.captureAnimalMode) {
          this.cancelCaptureAnimalMode();
        } else if (this.rallyTargetMode) {
          this.rallyTargetMode = false;
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

      if (e.code === 'KeyR' && this.placementTemplateId) {
        const allow45 =
          this.placementTemplateId === 'stone_bridge' ||
          this.placementTemplateId === 'stone_wall' ||
          this.placementTemplateId === 'stone_gate';
        const step = allow45 ? Math.PI * 0.25 : Math.PI * 0.5;
        this.placementFacing = (this.placementFacing + step) % (Math.PI * 2);
        return;
      }

      if (e.code === 'KeyG' && this.selectedIds.size > 0) {
        this.garrisonTargetMode = true;
        this.callbacks.onStatusToast(t('toastGarrison'), 'info');
        return;
      }

      if (e.code === 'KeyT' || e.code === 'KeyY' || e.code === 'KeyU') {
        this.activateTerraformFromUI(e.code === 'KeyT' ? 'dig' : e.code === 'KeyU' ? 'level' : 'raise');
        return;
      }

      if (e.code === 'KeyX' && this.selectedIds.size > 0) {
        const ownedBuildings = Array.from(this.selectedIds).filter((id) => {
          const ent = this.world.entities.get(id);
          return ent && ent.alive && ent.owner === this.humanPlayerId && TEMPLATES[ent.templateId].kind === 'building';
        });
        if (ownedBuildings.length > 0) {
          this.world.enqueueCommand({
            type: 'demolish',
            playerId: this.humanPlayerId,
            entityIds: ownedBuildings,
          });
          this.selectedIds.clear();
          this.callbacks.onSelectionChanged();
          return;
        }
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

    const pTpl = TEMPLATES[this.placementTemplateId];
    const facing = pTpl?.isDock ? undefined : this.placementFacing;
    this.world.enqueueCommand({
      type: 'build',
      playerId: this.humanPlayerId,
      entityIds: builders,
      templateId: this.placementTemplateId,
      tileX: tx,
      tileZ: tz,
      facing,
    });
    this.audio.playOrder();
    this.sceneManager.spawnClickPing(hit.x, hit.z, hit.y, 0x22c55e);

    if (!keepPlacing) {
      this.setPlacementMode(null);
    }
  }

  private tryConfirmTerraform(clientX: number, clientY: number, keepTerraforming: boolean): void {
    if (!this.terraformMode) return;
    const hit = this.sceneManager.raycastTerrain(clientX, clientY);
    if (!hit) return;

    const { tx, tz } = this.world.terrain.worldToTile(hit.x, hit.z);
    if (!this.world.canTerraformTile(tx, tz)) {
      this.audio.playError();
      this.callbacks.onStatusToast(t('toastCannotTerraform'), 'warn');
      return;
    }

    const workers = Array.from(this.selectedIds).filter((id) => {
      const e = this.world.entities.get(id);
      if (!e || !e.alive || e.owner !== this.humanPlayerId) return false;
      const tpl = TEMPLATES[e.templateId];
      return Boolean(tpl.gather && !tpl.isNaval);
    });
    if (workers.length === 0) {
      this.setTerraformMode(null);
      return;
    }

    // 2-step mass-conserving Dig & Haul: Step 1 selects where to DIG, Step 2 selects where to DUMP the soil!
    if (this.terraformMode === 'dig' && !this.pendingDigSource) {
      const center = this.world.terrain.tileToWorldCenter(tx, tz);
      this.pendingDigSource = { tx, tz, x: center.x, y: hit.y, z: center.z };
      this.audio.playOrder();
      this.sceneManager.spawnClickPing(center.x, center.z, hit.y, 0xf59e0b);
      this.callbacks.onStatusToast(t('toastDigStep2'), 'info');
      this.callbacks.onSelectionChanged();
      return;
    }

    const srcTx = this.terraformMode === 'dig' && this.pendingDigSource ? this.pendingDigSource.tx : tx;
    const srcTz = this.terraformMode === 'dig' && this.pendingDigSource ? this.pendingDigSource.tz : tz;
    const destTx = this.terraformMode === 'dig' ? tx : undefined;
    const destTz = this.terraformMode === 'dig' ? tz : undefined;

    this.world.enqueueCommand({
      type: 'terraform',
      playerId: this.humanPlayerId,
      entityIds: workers,
      tileX: srcTx,
      tileZ: srcTz,
      destTileX: destTx,
      destTileZ: destTz,
      mode: this.terraformMode,
      queued: keepTerraforming,
    });
    this.audio.playOrder();
    this.sceneManager.spawnClickPing(
      hit.x,
      hit.z,
      hit.y,
      this.terraformMode === 'dig' ? 0x22c55e : 0x22c55e
    );

    this.pendingDigSource = null;
    if (!keepTerraforming) {
      this.setTerraformMode(null);
    } else {
      this.callbacks.onSelectionChanged();
    }
  }

  private updateWallDrag(endTx: number, endTz: number): void {
    if (!this.wallDragStartTile) return;
    const { tx: sx, tz: sz } = this.wallDragStartTile;
    const dx = endTx - sx;
    const dz = endTz - sz;
    const segs: Array<{ tx: number; tz: number; facing: number }> = [];

    const dragTplId = this.placementTemplateId === 'stone_bridge' ? 'stone_bridge' : 'stone_wall';
    const isBridge = dragTplId === 'stone_bridge';

    // BOTH Stone Bridges AND Stone Walls support arbitrary-angle straight lines (diagonal, oblique, or orthogonal!)
    const maxSegs = 32;
    const adx = Math.abs(dx);
    const adz = Math.abs(dz);
    const stepX = dx >= 0 ? 1 : -1;
    const stepZ = dz >= 0 ? 1 : -1;
    // Align local +X span along world direction (dx, dz): in Three.js Y-up, +X rotated by theta -> (cos theta, 0, -sin theta)
    const spanFacing = adx === 0 && adz === 0 ? this.placementFacing : Math.atan2(-dz, dx);
    let cx = sx;
    let cz = sz;
    let err = adx - adz;
    while (segs.length < maxSegs) {
      segs.push({ tx: cx, tz: cz, facing: spanFacing });
      if (cx === endTx && cz === endTz) break;
      const e2 = err * 2;
      if (e2 > -adz) {
        err -= adz;
        cx += stepX;
      }
      if (e2 < adx) {
        err += adx;
        cz += stepZ;
      }
    }

    if (segs.length === 1) {
      segs[0].facing = this.placementFacing;
    }

    this.wallDragSegments = segs;
    const existingBridgeLen = isBridge && segs.length > 0 ? this.world.countConnectedBridgeTiles(segs[0].tx, segs[0].tz) : 0;
    this.sceneManager.updateGhostPreview(null, this.world.config.playerCiv, 0, 0, 0, false);
    this.sceneManager.updateWallLinePreview(
      segs.map((s, idx) => {
        const c = this.world.terrain.tileToWorldCenter(s.tx, s.tz);
        let y = this.world.terrain.getHeightAt(c.x, c.z);
        let slopeYX = 0;
        if (!isBridge) {
          const halfSpan = 1.44;
          const cosF = Math.cos(s.facing);
          const sinF = Math.sin(s.facing);
          const hPlus = this.world.terrain.getHeightAt(c.x + cosF * halfSpan, c.z - sinF * halfSpan);
          const hMinus = this.world.terrain.getHeightAt(c.x - cosF * halfSpan, c.z + sinF * halfSpan);
          y = (hPlus + hMinus) * 0.5;
          slopeYX = Math.max(-1.35, Math.min(1.35, (hPlus - hMinus) / (halfSpan * 2)));
        }
        const check = this.world.canPlaceBuilding(this.humanPlayerId, dragTplId, s.tx, s.tz);
        const overBridgeMax = isBridge && existingBridgeLen + idx + 1 > World.MAX_BRIDGE_LENGTH_TILES;
        const bridgeSpanOk = isBridge && !overBridgeMax && !this.world.terrain.isTileDryLand(s.tx, s.tz);
        const validSeg = !overBridgeMax && (check.ok || bridgeSpanOk);
        const failReason = overBridgeMax
          ? `Bridge exceeds maximum length (${World.MAX_BRIDGE_LENGTH_TILES} tiles)`
          : check.reason;
        return {
          x: c.x,
          y,
          z: c.z,
          facing: s.facing,
          valid: validSeg,
          slopeYX,
          reason: validSeg ? undefined : translateBuildReason(failReason),
        };
      }),
      isBridge
    );
  }

  private commitWallDrag(keepPlacing: boolean): void {
    const dragTplId = this.placementTemplateId === 'stone_bridge' ? 'stone_bridge' : 'stone_wall';
    const isBridge = dragTplId === 'stone_bridge';
    const segs = this.wallDragSegments.slice();
    this.wallDragStartTile = null;
    this.wallDragSegments = [];
    this.sceneManager.updateWallLinePreview([]);
    if (segs.length === 0) return;

    const builders = Array.from(this.selectedIds).filter((id) => {
      const e = this.world.entities.get(id);
      return e && e.alive && e.owner === this.humanPlayerId && TEMPLATES[e.templateId].canBuild?.includes(dragTplId);
    });

    const p = this.world.players.get(this.humanPlayerId);
    const segCost = TEMPLATES[dragTplId].cost!;
    let remWood = p?.resources.wood ?? 0;
    let remStone = p?.resources.stone ?? 0;
    let remMetal = p?.resources.metal ?? 0;
    let placed = 0;
    let lastReason: string | undefined;
    const existingBridgeLen = isBridge ? this.world.countConnectedBridgeTiles(segs[0].tx, segs[0].tz) : 0;

    for (const seg of segs) {
      if (isBridge && existingBridgeLen + placed + 1 > World.MAX_BRIDGE_LENGTH_TILES) {
        lastReason = `Bridge exceeds maximum length (${World.MAX_BRIDGE_LENGTH_TILES} tiles)`;
        break;
      }
      if (remWood < segCost.wood || remStone < segCost.stone || remMetal < segCost.metal) {
        lastReason = 'Not enough resources';
        break;
      }
      const check = this.world.canPlaceBuilding(this.humanPlayerId, dragTplId, seg.tx, seg.tz);
      const chainOk = isBridge && placed > 0 && !this.world.terrain.isTileDryLand(seg.tx, seg.tz);
      if (!check.ok && !chainOk) {
        lastReason = check.reason;
        continue;
      }
      remWood -= segCost.wood;
      remStone -= segCost.stone;
      remMetal -= segCost.metal;
      this.world.enqueueCommand({
        type: 'build',
        playerId: this.humanPlayerId,
        entityIds: builders,
        templateId: dragTplId,
        tileX: seg.tx,
        tileZ: seg.tz,
        facing: seg.facing,
      });
      const c = this.world.terrain.tileToWorldCenter(seg.tx, seg.tz);
      this.sceneManager.spawnClickPing(c.x, c.z, this.world.terrain.getHeightAt(c.x, c.z), 0x22c55e);
      placed++;
    }

    if (placed > 0) {
      this.audio.playOrder();
    } else if (lastReason) {
      this.audio.playError();
      this.callbacks.onStatusToast(translateBuildReason(lastReason), 'warn');
    }

    if (!keepPlacing) {
      this.setPlacementMode(null);
    }
  }

  private updateTunnelDrag(endTx: number, endTz: number): void {
    if (!this.tunnelDragStartTile) return;
    this.tunnelDragEndTile = { tx: endTx, tz: endTz };
    const s = this.tunnelDragStartTile;
    const sc = this.world.terrain.tileToWorldCenter(s.tx, s.tz);
    const ec = this.world.terrain.tileToWorldCenter(endTx, endTz);
    const sy = this.world.terrain.getHeightAt(sc.x, sc.z);
    const ey = this.world.terrain.getHeightAt(ec.x, ec.z);
    const len = Math.hypot(endTx - s.tx, endTz - s.tz);
    const checkStart = this.world.canPlaceBuilding(this.humanPlayerId, 'tunnel_portal', s.tx, s.tz);
    const checkEnd = this.world.canPlaceBuilding(this.humanPlayerId, 'tunnel_portal', endTx, endTz);
    const valid = len >= 4 && checkStart.ok && checkEnd.ok;
    this.sceneManager.updateGhostPreview(null, this.world.config.playerCiv, 0, 0, 0, false);
    this.sceneManager.updateTunnelDragPreview({ x: sc.x, y: sy, z: sc.z }, { x: ec.x, y: ey, z: ec.z }, valid);
    const reason =
      len < 4
        ? t('toastTunnelTooShort')
        : !checkStart.ok
          ? translateBuildReason(checkStart.reason)
          : !checkEnd.ok
            ? translateBuildReason(checkEnd.reason)
            : null;
    this.sceneManager.updatePlacementHint(ec.x, ey, ec.z, reason);
  }

  private commitTunnelDrag(keepPlacing: boolean): void {
    const start = this.tunnelDragStartTile;
    const end = this.tunnelDragEndTile;
    this.tunnelDragStartTile = null;
    this.tunnelDragEndTile = null;
    this.sceneManager.updateTunnelDragPreview(null, null, false);
    this.sceneManager.updatePlacementHint(0, 0, 0, null);
    if (!start || !end) return;

    const len = Math.round(Math.hypot(end.tx - start.tx, end.tz - start.tz));
    if (len < 4) {
      this.audio.playError();
      this.callbacks.onStatusToast(t('toastTunnelTooShort'), 'warn');
      return;
    }

    const checkA = this.world.canPlaceBuilding(this.humanPlayerId, 'tunnel_portal', start.tx, start.tz);
    const checkB = this.world.canPlaceBuilding(this.humanPlayerId, 'tunnel_portal', end.tx, end.tz);
    if (!checkA.ok || !checkB.ok) {
      this.audio.playError();
      this.callbacks.onStatusToast(translateBuildReason(checkA.reason ?? checkB.reason), 'warn');
      return;
    }

    const builders = Array.from(this.selectedIds).filter((id) => {
      const e = this.world.entities.get(id);
      return e && e.alive && e.owner === this.humanPlayerId && TEMPLATES[e.templateId].canBuild?.includes('tunnel_portal');
    });

    this.world.enqueueCommand({
      type: 'build_tunnel',
      playerId: this.humanPlayerId,
      entityIds: builders,
      startTileX: start.tx,
      startTileZ: start.tz,
      endTileX: end.tx,
      endTileZ: end.tz,
    });
    this.audio.playOrder();
    const sc = this.world.terrain.tileToWorldCenter(start.tx, start.tz);
    const ec = this.world.terrain.tileToWorldCenter(end.tx, end.tz);
    this.sceneManager.spawnClickPing(sc.x, sc.z, this.world.terrain.getHeightAt(sc.x, sc.z), 0x38bdf8);
    this.sceneManager.spawnClickPing(ec.x, ec.z, this.world.terrain.getHeightAt(ec.x, ec.z), 0x38bdf8);

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

    // Quick Tree Protection: when NOTHING is selected, directly left-clicking a tree toggles its Protection (圍籬) on/off!
    if (this.selectedIds.size === 0 && !additive && World.isTreeTemplate(picked.templateId)) {
      const willProtect = !picked.protectedByPlayer;
      this.world.enqueueCommand({
        type: 'toggle_protect_tree',
        playerId: this.humanPlayerId,
        entityId: picked.id,
      });
      this.audio.playOrder();
      this.sceneManager.spawnClickPing(
        picked.x,
        picked.z,
        this.world.terrain.getHeightAt(picked.x, picked.z),
        willProtect ? 0x22c55e : 0xf59e0b
      );
      this.callbacks.onStatusToast(
        `${willProtect ? t('toastTreeProtectedSet') : t('toastTreeProtectedRemoved')} (${getTemplateText(picked.templateId).name})`,
        willProtect ? 'good' : 'info'
      );
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
      const baseY = tpl.isNaval || tpl.isDock ? WATER_LEVEL : this.world.terrain.getHeightAt(e.x, e.z);
      const y = baseY + (tpl.kind === 'building' ? 1.5 : 0.9);
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
        this.callbacks.onStatusToast(t('toastRallyUpdated'), 'good');
      }
      return;
    }

    if (units.length === 0) return;
    const unitIds = units.map((u) => u.id);

    // Case 2: Right-click on an entity
    if (picked) {
      const pTpl = TEMPLATES[picked.templateId];
      const py = this.world.terrain.getHeightAt(picked.x, picked.z);

      // Friendly Warship right-click -> land units (citizens, soldiers, doctors, scouts, cavalry) board the vessel!
      if (picked.owner === this.humanPlayerId && pTpl.kind === 'unit' && pTpl.isNaval && pTpl.garrisonCapacity) {
        const landUnits = units.filter((u) => u.id !== picked.id && !TEMPLATES[u.templateId]?.isNaval);
        if (landUnits.length > 0) {
          const cap = this.world.getMaxGarrisonCapacity(picked);
          if (picked.garrisonedIds.length >= cap) {
            this.audio.playError();
            this.callbacks.onStatusToast(`${t('toastShipFull')} (${picked.garrisonedIds.length}/${cap})`, 'warn');
            return;
          }
          this.world.enqueueCommand({
            type: 'garrison',
            playerId: this.humanPlayerId,
            entityIds: landUnits.map((u) => u.id),
            buildingId: picked.id,
          });
          this.audio.playOrder();
          this.sceneManager.spawnClickPing(picked.x, picked.z, WATER_LEVEL, 0x38bdf8);
          this.callbacks.onStatusToast(`${t('toastShipBoardStart')} (${picked.garrisonedIds.length}/${cap})`, 'good');
          return;
        }
      }

      // Doctor / Healer right-click on a friendly or allied unit -> heal target directly!
      if (picked.owner !== 0 && this.world.isAlliedOrOwn(this.humanPlayerId, picked.owner) && pTpl.kind === 'unit') {
        const healerIds = units.filter((u) => TEMPLATES[u.templateId]?.isHealer && u.id !== picked.id).map((u) => u.id);
        if (healerIds.length > 0) {
          this.world.enqueueCommand({
            type: 'heal',
            playerId: this.humanPlayerId,
            entityIds: healerIds,
            targetId: picked.id,
          });
          this.audio.playOrder();
          this.sceneManager.spawnClickPing(picked.x, picked.z, py, 0x10b981);
          this.callbacks.onStatusToast(t('toastDoctorHealing'), 'good');
          return;
        }
      }

      // Allied or Friendly Market / Tunnel right-click support (0 A.D. Alliance trade & passage!)
      if (picked.owner !== 0 && this.world.isAlliedOrOwn(this.humanPlayerId, picked.owner) && pTpl.kind === 'building') {
        if (pTpl.isMarket && !picked.isFoundation) {
          const traderIds = units.filter((u) => TEMPLATES[u.templateId]?.isTrader).map((u) => u.id);
          if (traderIds.length > 0) {
            const partner = this.world.findBestPartnerMarket(this.humanPlayerId, picked.id);
            if (!partner) {
              this.audio.playError();
              this.callbacks.onStatusToast(t('toastTradeNeedTwoMarkets'), 'warn');
              return;
            }
            this.world.enqueueCommand({
              type: 'trade',
              playerId: this.humanPlayerId,
              entityIds: traderIds,
              targetMarketId: picked.id,
              homeMarketId: partner.id,
            });
            this.audio.playOrder();
            this.sceneManager.spawnClickPing(picked.x, picked.z, py, 0xfacc15);
            this.callbacks.onStatusToast(t('toastTradeRouteSet'), 'good');
            return;
          }
        }
        if (pTpl.isTunnel && !picked.isFoundation && picked.linkedTunnelId) {
          this.world.enqueueCommand({
            type: 'use_tunnel',
            playerId: this.humanPlayerId,
            entityIds: unitIds,
            portalId: picked.id,
          });
          this.audio.playOrder();
          this.sceneManager.spawnClickPing(picked.x, picked.z, py, 0x38bdf8);
          this.callbacks.onStatusToast(t('toastTunnelTransit'), 'info');
          return;
        }
      }

      // Enemy -> Attack or Capture (blocked for Allies/Neutrals & in Peaceful Mode!)
      if (picked.owner !== 0 && picked.owner !== this.humanPlayerId) {
        if (!this.world.areHostile(this.humanPlayerId, picked.owner)) {
          this.audio.playError();
          this.callbacks.onStatusToast(
            this.world.areAllies(this.humanPlayerId, picked.owner) ? t('toastAllyNoAttack') : t('toastPeacefulNoAttack'),
            'info'
          );
          return;
        }
        const attackerIds = units.filter((u) => Boolean(TEMPLATES[u.templateId]?.attack)).map((u) => u.id);
        if (attackerIds.length === 0) {
          return;
        }
        const mode: BuildingOrderMode =
          pTpl.kind === 'building' ? (e.altKey ? 'attack' : this.buildingOrderMode) : 'attack';
        this.world.enqueueCommand({
          type: 'attack',
          playerId: this.humanPlayerId,
          entityIds: attackerIds,
          targetId: picked.id,
          mode,
        });
        this.audio.playOrder();
        this.sceneManager.spawnClickPing(picked.x, picked.z, py, mode === 'capture' && pTpl.kind === 'building' ? 0x38bdf8 : 0xef4444);
        return;
      }

      // Friendly building -> Beacon Tower Garrison (always prioritized for soldiers!), Repair/Build, Tunnel, Market, Farm Field, or Alt+RightClick Garrison
      if (picked.owner === this.humanPlayerId && pTpl.kind === 'building') {
        if (pTpl.isBeaconTower && !picked.isFoundation) {
          const landUnits = units.filter((u) => !TEMPLATES[u.templateId]?.isNaval);
          const hasAnyMilitary = landUnits.some((u) => this.world.isMilitaryUnit(u.templateId));
          const shouldRepair = !e.altKey && !hasAnyMilitary && picked.hp < picked.maxHp && landUnits.some((u) => Boolean(TEMPLATES[u.templateId]?.gather));
          if (!shouldRepair) {
            const cap = this.world.getMaxGarrisonCapacity(picked);
            if (landUnits.length === 0) {
              this.audio.playError();
              this.callbacks.onStatusToast(t('toastShipsCantGarrison'), 'warn');
              return;
            }
            if (picked.garrisonedIds.length >= cap) {
              this.audio.playError();
              this.callbacks.onStatusToast(`${t('toastBeaconGarrisonFull')} (${picked.garrisonedIds.length}/${cap})`, 'warn');
              return;
            }
            this.world.enqueueCommand({
              type: 'garrison',
              playerId: this.humanPlayerId,
              entityIds: landUnits.map((u) => u.id),
              buildingId: picked.id,
            });
            this.audio.playOrder();
            this.sceneManager.spawnClickPing(picked.x, picked.z, py, 0x38bdf8);
            this.callbacks.onStatusToast(`${t('toastBeaconGarrisonStart')} (${picked.garrisonedIds.length}/${cap})`, 'good');
            return;
          }
        }
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
        if (pTpl.isTunnel && picked.linkedTunnelId) {
          this.world.enqueueCommand({
            type: 'use_tunnel',
            playerId: this.humanPlayerId,
            entityIds: unitIds,
            portalId: picked.id,
          });
          this.audio.playOrder();
          this.sceneManager.spawnClickPing(picked.x, picked.z, py, 0x38bdf8);
          this.callbacks.onStatusToast(t('toastTunnelTransit'), 'info');
          return;
        }
        if (pTpl.isMarket) {
          const traderIds = units.filter((u) => TEMPLATES[u.templateId]?.isTrader).map((u) => u.id);
          if (traderIds.length > 0) {
            const partner = this.world.findBestPartnerMarket(this.humanPlayerId, picked.id);
            if (!partner) {
              this.audio.playError();
              this.callbacks.onStatusToast(t('toastTradeNeedTwoMarkets'), 'warn');
              return;
            }
            this.world.enqueueCommand({
              type: 'trade',
              playerId: this.humanPlayerId,
              entityIds: traderIds,
              targetMarketId: picked.id,
              homeMarketId: partner.id,
            });
            this.audio.playOrder();
            this.sceneManager.spawnClickPing(picked.x, picked.z, py, 0xfacc15);
            this.callbacks.onStatusToast(t('toastTradeRouteSet'), 'good');
            return;
          }
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
        if ((e.altKey || pTpl.isBeaconTower) && pTpl.garrisonCapacity) {
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

      // Friendly worker currently digging/terraforming -> Right-click to join & accelerate the SAME job!
      if (picked.owner === this.humanPlayerId && picked.order.type === 'terraform') {
        const landWorkers = units
          .filter((u) => {
            const ut = TEMPLATES[u.templateId];
            return Boolean(ut.gather && !ut.isNaval);
          })
          .map((u) => u.id);
        if (landWorkers.length > 0) {
          const ord = picked.order;
          const cmdTileX = ord.mode === 'raise' ? ord.destTileX : ord.tileX;
          const cmdTileZ = ord.mode === 'raise' ? ord.destTileZ : ord.tileZ;
          const cmdDestX = ord.mode === 'raise' ? ord.tileX : ord.destTileX;
          const cmdDestZ = ord.mode === 'raise' ? ord.tileZ : ord.destTileZ;
          this.world.enqueueCommand({
            type: 'terraform',
            playerId: this.humanPlayerId,
            entityIds: landWorkers,
            tileX: cmdTileX,
            tileZ: cmdTileZ,
            destTileX: cmdDestX,
            destTileZ: cmdDestZ,
            mode: ord.mode,
            queued: e.shiftKey,
          });
          this.audio.playOrder();
          this.sceneManager.spawnClickPing(picked.x, picked.z, py, 0xf59e0b);
          this.callbacks.onStatusToast(t('toastAssistDig'), 'info');
          return;
        }
      }

      // Random Wilderness Treasure -> ANY land unit (Worker, Scout, Soldier, Doctor) walks over to claim it!
      if (picked.owner === 0 && pTpl.isTreasure && picked.resourceRemaining > 0) {
        const landIds = units.filter((u) => !TEMPLATES[u.templateId]?.isNaval).map((u) => u.id);
        if (landIds.length > 0) {
          this.world.enqueueCommand({
            type: 'move',
            playerId: this.humanPlayerId,
            entityIds: landIds,
            x: picked.x,
            z: picked.z,
            queued: e.shiftKey,
          });
          this.audio.playOrder();
          this.sceneManager.spawnClickPing(picked.x, picked.z, py, 0xfacc15);
          return;
        }
      }

      // Live wild predator, sea/lake monster, OR docile wildlife clicked by non-gathering combat soldiers -> Attack!
      if (picked.owner === 0 && picked.hp > 0 && !pTpl.isFlying) {
        const isMonsterOrPredator = Boolean(pTpl.isPredator || pTpl.isSeaMonster);
        const isDocileAnimal =
          Boolean(pTpl.isPassiveFauna) ||
          picked.templateId === 'deer_herd' ||
          picked.templateId === 'wild_boar' ||
          picked.templateId === 'wild_gazelle' ||
          picked.templateId === 'wild_elephant';
        if (isMonsterOrPredator) {
          const combatIds = units.filter((u) => Boolean(TEMPLATES[u.templateId].attack)).map((u) => u.id);
          if (combatIds.length > 0) {
            this.world.enqueueCommand({
              type: 'attack',
              playerId: this.humanPlayerId,
              entityIds: combatIds,
              targetId: picked.id,
              mode: 'attack',
            });
            this.audio.playOrder();
            this.sceneManager.spawnClickPing(picked.x, picked.z, py, 0xef4444);
            return;
          }
        } else if (isDocileAnimal) {
          const pureCombatIds = units
            .filter((u) => Boolean(TEMPLATES[u.templateId].attack) && !TEMPLATES[u.templateId].gather)
            .map((u) => u.id);
          if (pureCombatIds.length === units.length && pureCombatIds.length > 0) {
            this.world.enqueueCommand({
              type: 'attack',
              playerId: this.humanPlayerId,
              entityIds: pureCombatIds,
              targetId: picked.id,
              mode: 'attack',
            });
            this.audio.playOrder();
            this.sceneManager.spawnClickPing(picked.x, picked.z, py, 0xef4444);
            return;
          }
        }
      }

      // Natural resource -> Gather (including shoreline rod/cast-net/spear fishing for land workers!)
      if (pTpl.resourceType) {
        if (World.isProtectedTree(picked)) {
          this.audio.playError();
          this.callbacks.onStatusToast(t('toastTreeProtected'), 'warn');
          return;
        }
        if (World.isSapling(picked)) {
          this.audio.playError();
          this.callbacks.onStatusToast(t('toastSaplingNotMature'), 'warn');
          return;
        }
        if (World.isFruitNotRipe(picked)) {
          this.audio.playError();
          this.callbacks.onStatusToast(t('toastFruitNotRipe'), 'warn');
          return;
        }
        if (picked.resourceRemaining <= 0) return;
        if (pTpl.isAquatic) {
          const hasNavalGatherer = units.some((u) => Boolean(TEMPLATES[u.templateId].isNaval && TEMPLATES[u.templateId].gather));
          const hasLandGatherer = units.some((u) => Boolean(!TEMPLATES[u.templateId].isNaval && TEMPLATES[u.templateId].gather));
          if (hasLandGatherer && !hasNavalGatherer) {
            if (!this.world.canLandWorkerFish(picked)) {
              this.audio.playError();
              this.callbacks.onStatusToast(t('toastFishTooFarFromShore'), 'warn');
              return;
            }
            this.world.enqueueCommand({
              type: 'gather',
              playerId: this.humanPlayerId,
              entityIds: unitIds,
              targetId: picked.id,
            });
            this.audio.playOrder();
            this.sceneManager.spawnClickPing(picked.x, picked.z, WATER_LEVEL + 0.1, 0x38bdf8);
            this.callbacks.onStatusToast(t('toastShoreFishStart'), 'good');
            return;
          }
        }
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

    // Case 3: Ground click -> If workers right-click an active excavation/fill site, assist it! Otherwise Move.
    if (terrainHit) {
      const landWorkers = units
        .filter((u) => {
          const ut = TEMPLATES[u.templateId];
          return Boolean(ut.gather && !ut.isNaval);
        })
        .map((u) => u.id);
      if (landWorkers.length > 0 && !e.altKey) {
        const hitTile = this.world.terrain.worldToTile(terrainHit.x, terrainHit.z);
        const job = this.world.findActiveTerraformJobAt(this.humanPlayerId, hitTile.tx, hitTile.tz);
        if (job) {
          const cmdTileX = job.mode === 'raise' ? job.destTileX : job.tileX;
          const cmdTileZ = job.mode === 'raise' ? job.destTileZ : job.tileZ;
          const cmdDestX = job.mode === 'raise' ? job.tileX : job.destTileX;
          const cmdDestZ = job.mode === 'raise' ? job.tileZ : job.destTileZ;
          this.world.enqueueCommand({
            type: 'terraform',
            playerId: this.humanPlayerId,
            entityIds: landWorkers,
            tileX: cmdTileX,
            tileZ: cmdTileZ,
            destTileX: cmdDestX,
            destTileZ: cmdDestZ,
            mode: job.mode,
            queued: e.shiftKey,
          });
          this.audio.playOrder();
          const c = this.world.terrain.tileToWorldCenter(cmdTileX, cmdTileZ);
          this.sceneManager.spawnClickPing(c.x, c.z, this.world.terrain.getHeightAt(c.x, c.z), 0xf59e0b);
          this.callbacks.onStatusToast(t('toastAssistDig'), 'info');
          return;
        }
      }
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

      const groundY =
        tpl.isNaval || tpl.isDock || tpl.isAquatic ? WATER_LEVEL : this.world.terrain.getHeightAt(e.x, e.z);

      // Buildings (Civic Center, Fortress, Wonder, Barracks, Temple, etc.):
      // Project full 3D bounding box to exact zoom-accurate screen rectangle AND test 3D terrain footprint!
      if (tpl.kind === 'building') {
        const halfW = Math.max(tpl.radius * 0.95, (tpl.footprintTiles ?? 2) * 0.95);
        const topH = tpl.isBeaconTower
          ? (e.beaconLevel ?? 1) >= 3
            ? 9.8
            : (e.beaconLevel ?? 1) === 2
              ? 7.2
              : 5.4
          : tpl.isCivicCenter || tpl.isFortress || tpl.isWonder
            ? 6.2
            : tpl.isFarmField
              ? 1.1
              : 4.2;

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
        // Normalize score so clicking anywhere inside a large Civic Center beats distant units;
        // give Beacon Towers priority over flanking wall segments so clicking them is effortless!
        const rawScore = Math.min(centerDistPx * 0.25, 22) + 10;
        const score = tpl.isBeaconTower ? rawScore * 0.65 : rawScore;
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
