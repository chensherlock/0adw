import './style.css';
import { AudioManager } from './audio/AudioManager';
import { TEMPLATES } from './config/entities';
import {
  formatLocalizedCost,
  getCivName,
  getCivSkillText,
  getMapLabel,
  getResourceName,
  getTechText,
  getTemplateText,
  t,
  toggleLanguage,
} from './config/i18n';
import { CheatAction, SimEvent } from './config/types';
import { InputController } from './input/InputController';
import { SceneManager } from './render/SceneManager';
import { SkirmishAI } from './sim/ai/SkirmishAI';
import { MatchConfig, SerializedWorldState, SIM_DT, World } from './sim/World';
import { HUDManager } from './ui/HUDManager';
import { Minimap } from './ui/Minimap';

const SAVE_STORAGE_KEY = 'web0ad_save_slot_1';

class Web0ADApp {
  private readonly viewportEl = document.getElementById('viewport')!;
  private readonly selectionBoxEl = document.getElementById('selection-box')!;
  private readonly minimapCanvas = document.getElementById('minimap-canvas') as HTMLCanvasElement;

  private readonly audio = new AudioManager();
  private world!: World;
  private aiList: SkirmishAI[] = [];
  private aiProxyEnabled = false;
  private playerProxyAI: SkirmishAI | null = null;
  private readonly aiProxyBtn = document.getElementById('btn-ai-proxy') as HTMLButtonElement | null;
  private sceneManager!: SceneManager;
  private input!: InputController;
  private minimap!: Minimap;
  private hud!: HUDManager;
  private detachCamera: (() => void) | null = null;

  private paused = true;
  private simSpeed = 1;
  private edgeScroll = true;
  private revealAll = false;
  private accumulator = 0;
  private lastFrameMs = performance.now();
  private elapsedSec = 0;
  private lastHudUpdateMs = 0;
  private victoryShown = false;

  constructor() {
    this.hud = new HUDManager({
      onStartMatch: (config) => this.startNewMatch(config, false),
      onQuickRandomMap: () => {
        const cfg = this.hud.buildMatchConfigFromSettings(true);
        cfg.mapType = 'random';
        this.startNewMatch(cfg, false);
      },
      onSaveGame: () => this.saveCurrentMatch(),
      onLoadGame: () => this.loadSavedMatch(),
      hasSavedGame: () => this.hasSavedGame(),
      onSetupClosed: () => {
        this.paused = false;
        this.syncTopBar();
      },
      onActivateSkill: () => this.triggerHumanCivSkill(),
      onCheat: (action) => this.handleCheatAction(action),
      onTogglePause: () => {
        this.paused = !this.paused;
        this.syncTopBar();
      },
      onCycleSpeed: () => {
        this.simSpeed = this.simSpeed === 1 ? 2 : 1;
        this.syncTopBar();
      },
      onToggleEdgeScroll: () => {
        this.edgeScroll = !this.edgeScroll;
        this.sceneManager.rtsCamera.edgeScrollEnabled = this.edgeScroll;
        this.syncTopBar();
      },
      onToggleReveal: () => {
        this.revealAll = !this.revealAll;
        this.sceneManager.terrainRenderer.setRevealAll(this.revealAll);
        this.syncTopBar();
      },
      onToggleMusic: () => {
        this.audio.unlock();
        this.audio.musicEnabled = !this.audio.musicEnabled;
        this.syncTopBar();
      },
      onToggleSfx: () => {
        this.audio.unlock();
        this.audio.sfxEnabled = !this.audio.sfxEnabled;
        if (this.audio.sfxEnabled) this.audio.playSelect();
        this.syncTopBar();
      },
      onToggleLanguage: () => {
        toggleLanguage();
        this.hud.applyLanguage();
        this.syncTopBar();
        this.syncAiProxyButton();
      },
      onJumpTo: (x, z) => {
        this.sceneManager.rtsCamera.jumpTo(x, z);
        if (this.world) {
          const y = this.world.terrain.getHeightAt(x, z);
          this.sceneManager.spawnClickPing(x, z, y, 0xef4444);
        }
      },
    });

    this.aiProxyBtn?.addEventListener('click', (e) => {
      e.stopPropagation();
      this.toggleAiProxy();
    });

    // Boot cleanly from saved Skirmish Settings, paused behind Setup Modal so reload NEVER flashes a chaotic screen!
    const initialCfg = this.hud.buildMatchConfigFromSettings(false);
    this.startNewMatch(initialCfg, true);
    this.hud.refreshLoadSaveButtons();
    // Reveal UI cleanly after all localization, saved settings & initial WebGL scene are ready!
    document.body.classList.add('app-ready');

    window.addEventListener('resize', () => {
      this.sceneManager.resize(this.viewportEl.clientWidth, this.viewportEl.clientHeight);
    });

    window.addEventListener('keydown', (e) => {
      if (e.code === 'F9') {
        e.preventDefault();
        this.hud.toggleCheatModal();
        return;
      }
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement) return;
      if (e.code === 'KeyF' && !e.ctrlKey && !e.metaKey && !e.altKey) {
        this.triggerHumanCivSkill();
      } else if (e.code === 'KeyH' && !e.ctrlKey && !e.metaKey && !e.altKey) {
        this.hud.toggleDockCompact();
      }
    });

    requestAnimationFrame((t) => this.loop(t));
  }

  private hasSavedGame(): boolean {
    try {
      return Boolean(localStorage.getItem(SAVE_STORAGE_KEY));
    } catch {
      return false;
    }
  }

  private saveCurrentMatch(): void {
    if (!this.world || !this.sceneManager) return;
    try {
      const cam = this.sceneManager.rtsCamera;
      const snap = this.world.serializeState({
        x: cam.target.x,
        z: cam.target.z,
        distance: cam.distance,
        yaw: cam.yaw,
      });
      localStorage.setItem(SAVE_STORAGE_KEY, JSON.stringify(snap));
      this.hud.refreshLoadSaveButtons();
      this.audio.playSelect();
      this.hud.pushToast(t('toastGameSaved'), 'good');
    } catch {
      this.audio.playError();
      this.hud.pushToast('Save failed (storage full)', 'warn');
    }
  }

  private loadSavedMatch(): void {
    try {
      const raw = localStorage.getItem(SAVE_STORAGE_KEY);
      if (!raw) {
        this.audio.playError();
        this.hud.pushToast(t('toastNoSave'), 'warn');
        return;
      }
      const data = JSON.parse(raw) as SerializedWorldState;
      const restored = World.deserializeState(data);
      this.attachWorld(restored, false, data.camera);
      this.audio.playSelect();
      this.hud.pushToast(t('toastGameLoaded'), 'good');
    } catch {
      this.audio.playError();
      this.hud.pushToast(t('toastNoSave'), 'warn');
    }
  }

  private handleCheatAction(action: CheatAction | 'reveal_map'): void {
    this.audio.unlock();
    if (action === 'reveal_map') {
      this.revealAll = !this.revealAll;
      this.sceneManager.terrainRenderer.setRevealAll(this.revealAll);
      this.syncTopBar();
      this.hud.pushToast(this.revealAll ? `👁️ ${t('mapBtn')}: ON` : `👁️ ${t('mapBtn')}: OFF`, 'good');
      return;
    }

    const p = this.world?.players.get(1);
    const willFastBeOn = action === 'fast_build' ? !p?.fastBuildCheat : false;
    this.world.enqueueCommand({ type: 'cheat', playerId: 1, action });
    this.audio.playSelect();

    switch (action) {
      case 'resources':
        this.hud.pushToast(t('cheatToastRes'), 'good');
        break;
      case 'fast_build':
        this.hud.pushToast(willFastBeOn ? t('cheatToastFastOn') : t('cheatToastFastOff'), 'good');
        break;
      case 'all_techs':
        this.hud.pushToast(t('cheatToastTech'), 'good');
        break;
      case 'reset_skill':
        this.hud.pushToast(t('cheatToastSkill'), 'good');
        break;
      case 'spawn_army':
        this.hud.pushToast(t('cheatToastArmy'), 'good');
        break;
      case 'heal_all':
        this.hud.pushToast(t('cheatToastHeal'), 'good');
        break;
      case 'instant_win':
        this.hud.pushToast(t('cheatToastWin'), 'good');
        break;
    }
  }

  private triggerHumanCivSkill(): void {
    const p = this.world?.players.get(1);
    if (!p || p.defeated) return;
    if (p.skillCooldown > 0) {
      this.audio.playError();
      this.hud.pushToast(`${t('toastSkillCooldown')} ${Math.ceil(p.skillCooldown)}s`, 'warn');
      return;
    }
    this.audio.unlock();
    this.world.enqueueCommand({ type: 'activate_skill', playerId: 1 });
  }

  private startNewMatch(config: MatchConfig, keepPaused = false): void {
    const world = new World(config);
    this.attachWorld(world, keepPaused);
    if (!keepPaused) {
      const p1 = this.world.players.get(1);
      const nationCount = this.world.players.size;
      const vsLabel =
        nationCount === 2
          ? `${getCivName(p1?.civ ?? config.playerCiv)} vs ${getCivName(this.world.players.get(2)?.civ ?? config.aiCiv)}`
          : `${getCivName(p1?.civ ?? config.playerCiv)} • ${nationCount} 國`;
      this.hud.pushToast(
        `${getMapLabel(this.world.terrain.resolvedMapType)} (#${config.seed}) • ${vsLabel}`,
        'good'
      );
    }
  }

  private attachWorld(
    world: World,
    keepPaused: boolean,
    cameraRestore?: { x: number; z: number; distance: number; yaw: number }
  ): void {
    if (this.detachCamera) {
      this.detachCamera();
      this.detachCamera = null;
    }
    if (this.sceneManager) {
      this.sceneManager.dispose();
    }

    this.world = world;
    this.aiList = [];
    for (const p of this.world.players.values()) {
      if (p.isAI) {
        this.aiList.push(new SkirmishAI(p.id, this.world.config.difficulty));
      }
    }
    this.aiProxyEnabled = false;
    this.playerProxyAI = new SkirmishAI(1, this.world.config.difficulty);
    this.syncAiProxyButton();

    this.sceneManager = new SceneManager(this.viewportEl, this.world);
    this.sceneManager.rtsCamera.edgeScrollEnabled = this.edgeScroll;
    if (cameraRestore) {
      this.sceneManager.rtsCamera.distance = cameraRestore.distance;
      this.sceneManager.rtsCamera.yaw = cameraRestore.yaw;
      this.sceneManager.rtsCamera.jumpTo(cameraRestore.x, cameraRestore.z);
    }
    this.sceneManager.terrainRenderer.setRevealAll(this.revealAll);
    this.detachCamera = this.sceneManager.rtsCamera.attachListeners(this.sceneManager.renderer.domElement);

    if (!this.input) {
      this.input = new InputController(this.world, this.sceneManager, this.audio, this.selectionBoxEl, {
        onSelectionChanged: () => this.hud.renderSelectionAndCommands(),
        onStatusToast: (msg, tone) => this.hud.pushToast(msg, tone),
        onPlacementChanged: (tplId) => {
          if (tplId) {
            this.hud.pushToast(`${t('toastPlacing')} ${getTemplateText(tplId).name} ${t('toastPlacingHint')}`, 'info');
          }
        },
      });
    } else {
      this.input.rebind(this.world, this.sceneManager);
    }

    if (!this.minimap) {
      this.minimap = new Minimap(
        this.minimapCanvas,
        this.world.terrain,
        (wx, wz) => this.sceneManager.rtsCamera.jumpTo(wx, wz),
        (wx, wz) => this.input.issueMove(wx, wz, false, true)
      );
    } else {
      this.minimap.rebuildTerrain(this.world.terrain);
    }

    this.paused = keepPaused;
    this.victoryShown = false;
    this.accumulator = 0;
    this.hud.bind(this.world, this.input);
    this.hud.applyLanguage();
    this.syncTopBar();
  }

  private toggleAiProxy(): void {
    this.audio.unlock();
    this.aiProxyEnabled = !this.aiProxyEnabled;
    if (this.aiProxyEnabled && !this.playerProxyAI && this.world) {
      this.playerProxyAI = new SkirmishAI(1, this.world.config.difficulty);
    }
    this.syncAiProxyButton();
    if (this.aiProxyEnabled) {
      this.audio.playOrder();
      this.hud.pushToast(t('toastAiProxyOn'), 'good');
    } else {
      this.audio.playSelect();
      this.hud.pushToast(t('toastAiProxyOff'), 'info');
    }
  }

  private syncAiProxyButton(): void {
    if (!this.aiProxyBtn) return;
    this.aiProxyBtn.classList.toggle('ai-proxy-active', this.aiProxyEnabled);
    this.aiProxyBtn.textContent = this.aiProxyEnabled ? t('aiProxyOnBtn') : t('aiProxyOffBtn');
    this.aiProxyBtn.title = t('aiProxyTip');
  }

  private syncTopBar(): void {
    this.hud.setTopBarStates(
      this.paused,
      this.simSpeed,
      this.edgeScroll,
      this.revealAll,
      this.audio.musicEnabled,
      this.audio.sfxEnabled
    );
  }

  private handleSimEvents(events: SimEvent[]): void {
    for (const ev of events) {
      this.audio.playSimEvent(ev, 1);

      switch (ev.type) {
        case 'building_complete':
          if (ev.playerId === 1) {
            this.hud.pushToast(`${getTemplateText(ev.templateId).name} ${t('toastConstructed')}`, 'good', {
              x: ev.x,
              z: ev.z,
            });
          }
          break;
        case 'building_demolished':
          if (ev.playerId === 1) {
            this.hud.pushToast(
              `${t('toastDemolished')} ${formatLocalizedCost(ev.refund)}`,
              'info'
            );
          }
          break;
        case 'building_captured':
          if (ev.newOwner === 1) {
            this.hud.pushToast(
              `${t('toastCapturedEnemy')} ${getTemplateText(ev.templateId).name}${t('toastTerritoryExpanded')}`,
              'good',
              { x: ev.x, z: ev.z }
            );
          } else {
            this.hud.pushToast(`${t('toastEnemyCaptured')} ${getTemplateText(ev.templateId).name}!`, 'warn', {
              x: ev.x,
              z: ev.z,
            });
          }
          break;
        case 'tech_complete':
          if (ev.playerId === 1) {
            const tech = getTechText(ev.techId);
            this.hud.pushToast(`${t('toastResearched')} ${tech.name}!`, 'good');
          }
          break;
        case 'building_upgraded':
          if (ev.playerId === 1) {
            const bName = getTemplateText(ev.templateId).name;
            const msg =
              ev.templateId === 'beacon_tower'
                ? `🔥 ${bName} → Lv.${ev.floors}!`
                : ev.templateId === 'stone_gate' || ev.templateId === 'stone_wall'
                  ? `🧱 ${bName} 升級完成！`
                  : `🏢 ${bName} → ${ev.floors} 層!`;
            this.hud.pushToast(msg, 'good', { x: ev.x, z: ev.z });
          }
          break;
        case 'beacon_lit':
          if (ev.playerId === 1) {
            this.audio.playSelect();
            this.hud.pushToast(
              ev.autoDetected ? t('beaconAutoLitToast') : t('beaconLitToast'),
              ev.autoDetected ? 'warn' : 'good',
              { x: ev.x, z: ev.z }
            );
          }
          break;
        case 'trade_payout':
          if (ev.playerId === 1) {
            this.hud.pushToast(`${t('toastTradePayout')} +${ev.amount} 🪙`, 'good', { x: ev.x, z: ev.z });
          }
          break;
        case 'treasure_claimed':
          if (ev.playerId === 1) {
            this.audio.playOrder();
            const y = this.world.terrain.getHeightAt(ev.x, ev.z);
            this.sceneManager.spawnClickPing(ev.x, ev.z, y, 0xfacc15);
            this.hud.pushToast(
              `${t('toastTreasureClaimed')} ${formatLocalizedCost(ev.reward)}`,
              'good',
              { x: ev.x, z: ev.z }
            );
          }
          break;
        case 'tree_planted':
          if (ev.playerId === 1) {
            const y = this.world.terrain.getHeightAt(ev.x, ev.z);
            this.sceneManager.spawnClickPing(ev.x, ev.z, y, 0x22c55e);
            this.hud.pushToast(
              `${t('toastTreePlanted')} (${getTemplateText(ev.templateId).name})`,
              'good',
              { x: ev.x, z: ev.z }
            );
          }
          break;
        case 'tree_hybridized':
          if (ev.playerId === 1) {
            this.audio.playOrder();
            const y = this.world.terrain.getHeightAt(ev.x, ev.z);
            this.sceneManager.spawnClickPing(ev.x, ev.z, y, 0xfacc15);
            this.hud.pushToast(
              `${t('toastHybridPlanted')} (${getTemplateText(ev.templateId).name})`,
              'good',
              { x: ev.x, z: ev.z }
            );
          }
          break;
        case 'animal_captured':
          if (ev.playerId === 1) {
            this.audio.playOrder();
            const y = this.world.terrain.getHeightAt(ev.x, ev.z);
            this.sceneManager.spawnClickPing(ev.x, ev.z, y, 0x34d399);
            this.hud.pushToast(
              `${t('toastAnimalCaptured')} (${getTemplateText(ev.templateId).name})`,
              'good',
              { x: ev.x, z: ev.z }
            );
          }
          break;
        case 'animal_born':
          if (ev.playerId === 1) {
            const y = this.world.terrain.getHeightAt(ev.x, ev.z);
            this.sceneManager.spawnClickPing(ev.x, ev.z, y, 0xfde047);
            this.hud.pushToast(
              `${t('toastAnimalBorn')} (${getTemplateText(ev.templateId).name})`,
              'good',
              { x: ev.x, z: ev.z }
            );
          }
          break;
        case 'diplomacy_changed':
          if (ev.playerId === 1) {
            const targetP = this.world.players.get(ev.targetPlayerId);
            const stLabel =
              ev.stance === 'ally' ? t('stanceAlly') : ev.stance === 'neutral' ? t('stanceNeutral') : t('stanceEnemy');
            this.hud.pushToast(
              `${t('toastDiplomacyUpdated')} ${targetP ? getCivName(targetP.civ) : `#${ev.targetPlayerId}`} → ${stLabel}`,
              ev.stance === 'enemy' ? 'warn' : 'good'
            );
            this.hud.renderDiplomacyModal();
          }
          break;
        case 'tribute_sent':
          if (ev.fromPlayerId === 1) {
            const targetP = this.world.players.get(ev.toPlayerId);
            this.hud.pushToast(
              `${t('toastTributeSent')} ${ev.amount} ${getResourceName(ev.resource)} → ${targetP ? getCivName(targetP.civ) : `#${ev.toPlayerId}`}`,
              'good'
            );
          }
          break;
        case 'skill_activated':
          if (ev.playerId === 1) {
            const p = this.world.players.get(1);
            if (p) {
              const skillText = getCivSkillText(p.civ);
              this.hud.pushToast(`${t('toastSkillActivated')} ${skillText.name}!`, 'good');
            }
          }
          break;
        case 'under_attack':
          if (ev.playerId === 1) {
            let msg = t('toastUnderAttack');
            if (ev.attackerTemplateId && ev.victimTemplateId) {
              const victimName = getTemplateText(ev.victimTemplateId).name;
              const attackerName = getTemplateText(ev.attackerTemplateId).name;
              const isMonster = Boolean(ev.attackerTemplateId && TEMPLATES[ev.attackerTemplateId]?.isSeaMonster);
              const templateStr = isMonster
                ? t('toastAttackedByMonster')
                : ev.isWildlife
                  ? t('toastAttackedByBeast')
                  : t('toastAttackedByEnemy');
              msg = templateStr.replace('{victim}', victimName).replace('{attacker}', attackerName);
            }
            this.hud.pushToast(msg, 'warn', { x: ev.x, z: ev.z });
          }
          break;
        case 'unit_promoted':
          if (ev.playerId === 1) {
            const rankName = ev.rank === 3 ? t('rankElite') : t('rankAdv');
            this.hud.pushToast(`${t('toastPromoted')} ${rankName}!`, 'good', { x: ev.x, z: ev.z });
          }
          break;
        case 'match_over':
          if (!this.victoryShown) {
            this.victoryShown = true;
            this.hud.showVictory(ev.winnerId);
          }
          break;
      }
    }
  }

  private loop(nowMs: number): void {
    requestAnimationFrame((t) => this.loop(t));

    const frameDt = Math.min(0.1, (nowMs - this.lastFrameMs) / 1000);
    this.lastFrameMs = nowMs;
    this.elapsedSec += frameDt;

    if (!this.paused && this.world.winnerId === null) {
      this.accumulator += frameDt * this.simSpeed;
      let maxSteps = 5;
      while (this.accumulator >= SIM_DT && maxSteps > 0) {
        if (this.aiProxyEnabled && this.playerProxyAI && !this.world.config.aiVsAi) {
          this.playerProxyAI.update(this.world);
        }
        for (const ai of this.aiList) {
          ai.update(this.world);
        }
        this.world.step();
        const events = this.world.drainEvents();
        if (events.length > 0) this.handleSimEvents(events);
        this.accumulator -= SIM_DT;
        maxSteps--;
      }
    }

    const alpha = Math.max(0, Math.min(1, this.accumulator / SIM_DT));
    this.sceneManager.syncAndRender(this.world, 1, this.input.selectedIds, alpha, frameDt, this.elapsedSec);
    this.minimap.render(this.world, this.sceneManager.rtsCamera, 1, this.revealAll);

    if (nowMs - this.lastHudUpdateMs >= 110) {
      this.lastHudUpdateMs = nowMs;
      this.hud.updatePeriodic();
    }
  }
}

new Web0ADApp();
