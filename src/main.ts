import './style.css';
import { AudioManager } from './audio/AudioManager';
import { getCivName, getMapLabel, getTechText, getTemplateText, t, toggleLanguage } from './config/i18n';
import { CivId, Difficulty, MapType, SimEvent } from './config/types';
import { InputController } from './input/InputController';
import { SceneManager } from './render/SceneManager';
import { SkirmishAI } from './sim/ai/SkirmishAI';
import { SIM_DT, World } from './sim/World';
import { HUDManager } from './ui/HUDManager';
import { Minimap } from './ui/Minimap';

class Web0ADApp {
  private readonly viewportEl = document.getElementById('viewport')!;
  private readonly selectionBoxEl = document.getElementById('selection-box')!;
  private readonly minimapCanvas = document.getElementById('minimap-canvas') as HTMLCanvasElement;

  private readonly audio = new AudioManager();
  private world!: World;
  private ai!: SkirmishAI;
  private sceneManager!: SceneManager;
  private input!: InputController;
  private minimap!: Minimap;
  private hud!: HUDManager;
  private detachCamera: (() => void) | null = null;

  private paused = false;
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
      onStartMatch: (pCiv, aiCiv, diff, seed, mapType) => this.startNewMatch(pCiv, aiCiv, diff, seed, mapType),
      onQuickRandomMap: () => {
        const cur = this.world?.config;
        const freshSeed = Math.floor(Math.random() * 900000) + 100000;
        this.startNewMatch(cur?.playerCiv ?? 'athenians', cur?.aiCiv ?? 'romans', cur?.difficulty ?? 'medium', freshSeed, 'random');
      },
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
      },
      onJumpTo: (x, z) => this.sceneManager.rtsCamera.jumpTo(x, z),
    });

    const initialSeed = Math.floor(Math.random() * 900000) + 100000;
    this.startNewMatch('athenians', 'romans', 'medium', initialSeed, 'random');

    window.addEventListener('resize', () => {
      this.sceneManager.resize(this.viewportEl.clientWidth, this.viewportEl.clientHeight);
    });

    requestAnimationFrame((t) => this.loop(t));
  }

  private startNewMatch(
    playerCiv: CivId,
    aiCiv: CivId,
    difficulty: Difficulty,
    seed: number,
    mapType: MapType = 'random'
  ): void {
    if (this.detachCamera) {
      this.detachCamera();
      this.detachCamera = null;
    }
    if (this.sceneManager) {
      this.sceneManager.dispose();
    }

    this.world = new World({
      seed,
      playerCiv,
      aiCiv,
      difficulty,
      mapType,
    });
    this.ai = new SkirmishAI(2, difficulty);
    this.sceneManager = new SceneManager(this.viewportEl, this.world);
    this.sceneManager.rtsCamera.edgeScrollEnabled = this.edgeScroll;
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

    this.paused = false;
    this.victoryShown = false;
    this.accumulator = 0;
    this.hud.bind(this.world, this.input);
    this.hud.applyLanguage();
    this.syncTopBar();
    this.hud.pushToast(
      `${getMapLabel(this.world.terrain.resolvedMapType)} (#${seed}) • ${getCivName(playerCiv)} vs ${getCivName(aiCiv)}`,
      'good'
    );
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
        case 'under_attack':
          if (ev.playerId === 1) {
            this.hud.pushToast(t('toastUnderAttack'), 'warn', { x: ev.x, z: ev.z });
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
        this.ai.update(this.world);
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
