import { getCivEmblem, getEntityPortrait, TECH_PORTRAITS, UI_ICONS } from '../config/assets';
import { ALL_CIV_IDS, CIVS } from '../config/civs';
import { resolveUnitTemplateId, TECHS, TEMPLATES } from '../config/entities';
import {
  formatLocalizedCost,
  getCivBonusText,
  getCivName,
  getCivSkillText,
  getLanguage,
  getMapDescription,
  getMapLabel,
  getOrderName,
  getResourceName,
  getStanceLabel,
  getTechText,
  getTemplateText,
  setLanguage,
  t,
} from '../config/i18n';
import {
  CheatAction,
  CivChoice,
  CivId,
  Difficulty,
  DiplomaticStance,
  Entity,
  GameMode,
  GateMode,
  MapSize,
  MapType,
  PlayerSlotConfig,
  PlayerState,
  ResourceBag,
  ResourceType,
  UnitStance,
} from '../config/types';
import { InputController } from '../input/InputController';
import { ALL_MAP_TYPES, SOIL_UNITS_PER_TILE } from '../sim/map/TerrainMap';
import { MatchConfig, PLAYER_COLOR_PALETTE, World } from '../sim/World';

export interface SkirmishSettings {
  playerCiv: CivChoice;
  mapType: MapType;
  numPlayers: number;
  difficulty: Difficulty;
  gameMode: GameMode;
  mapSize: MapSize;
  seedText: string;
  playerTeams: number[]; // index 0..7 -> playerId 1..8
  aiCivs: CivChoice[]; // index 0..7 -> playerId 1..8 (index 0 unused/mirrors playerCiv)
}

const SETTINGS_STORAGE_KEY = 'web0ad_skirmish_settings_v1';

function createDefaultSettings(): SkirmishSettings {
  return {
    playerCiv: 'athenians',
    mapType: 'random',
    numPlayers: 2,
    difficulty: 'medium',
    gameMode: 'skirmish',
    mapSize: 'medium',
    seedText: '',
    playerTeams: [0, 0, 0, 0, 0, 0, 0, 0],
    aiCivs: ['athenians', 'romans', 'spartans', 'persians', 'carthaginians', 'han', 'britons', 'mauryas'],
  };
}

export interface HUDCallbacks {
  onStartMatch: (config: MatchConfig) => void;
  onQuickRandomMap: () => void;
  onSaveGame: () => void;
  onLoadGame: () => void;
  hasSavedGame: () => boolean;
  onSetupClosed: () => void;
  onActivateSkill: () => void;
  onCheat: (action: CheatAction | 'reveal_map') => void;
  onTogglePause: () => void;
  onCycleSpeed: () => void;
  onToggleEdgeScroll: () => void;
  onToggleReveal: () => void;
  onToggleMusic: () => void;
  onToggleSfx: () => void;
  onToggleLanguage: () => void;
  onJumpTo: (x: number, z: number) => void;
}

const MAP_CARD_META: Record<MapType, { icon: string; swatch: string }> = {
  random: { icon: '🎲', swatch: 'linear-gradient(135deg,#60a5fa,#4ade80,#facc15)' },
  aegean_valley: { icon: '🌊', swatch: 'linear-gradient(135deg,#38bdf8,#5e833d)' },
  medit_highlands: { icon: '⛰️', swatch: 'linear-gradient(135deg,#837b70,#a69b56)' },
  twin_peninsulas: { icon: '🏝️', swatch: 'linear-gradient(135deg,#0ea5e9,#e6cf98)' },
  inland_oasis: { icon: '🏜️', swatch: 'linear-gradient(135deg,#e8cb84,#5c8f3c)' },
  open_plains: { icon: '🌾', swatch: 'linear-gradient(135deg,#7c9748,#4c7c32)' },
  alpine_passes: { icon: '❄️', swatch: 'linear-gradient(135deg,#f1f5f9,#64748b)' },
  island: { icon: '🌴', swatch: 'linear-gradient(135deg,#0284c7,#4ade80)' },
  archipelago: { icon: '⛵', swatch: 'linear-gradient(135deg,#0369a1,#38bdf8,#4ade80)' },
  mountain: { icon: '🏔️', swatch: 'linear-gradient(135deg,#64748b,#cbd5e1)' },
  plateau: { icon: '🌄', swatch: 'linear-gradient(135deg,#8ea352,#837b70)' },
  hills: { icon: '🏞️', swatch: 'linear-gradient(135deg,#7c9748,#b59f52)' },
  mesa: { icon: '🏜️', swatch: 'linear-gradient(135deg,#c46d40,#8a3c22)' },
  swamp: { icon: '🐸', swatch: 'linear-gradient(135deg,#3f5e36,#274030)' },
  rainforest: { icon: '🦜', swatch: 'linear-gradient(135deg,#15803d,#4ade80)' },
  forest: { icon: '🌲', swatch: 'linear-gradient(135deg,#2f5d2c,#658c44)' },
  volcano: { icon: '🌋', swatch: 'linear-gradient(135deg,#ef4444,#292524)' },
};

export class HUDManager {
  private readonly humanPlayerId = 1;
  private lastCommandSig = '';
  private lastWinnerId: number | null = null;
  private settings: SkirmishSettings = createDefaultSettings();
  private selectedSetupCiv: CivChoice = 'athenians';
  private selectedSetupMap: MapType = 'random';

  // Cached DOM nodes
  private readonly elCivBadgeBtn = document.getElementById('btn-civ-badge');
  private readonly elCivEmblem = document.getElementById('civ-emblem') as HTMLImageElement | null;
  private readonly elCivEmblemFallback = document.getElementById('civ-emblem-fallback');
  private readonly elCivNamePill = document.getElementById('civ-name-pill');
  private readonly elMapNamePill = document.getElementById('map-name-pill');
  private readonly elCivSkillBtn = document.getElementById('btn-civ-skill');
  private readonly elCivSkillIcon = document.getElementById('civ-skill-icon');
  private readonly elCivSkillName = document.getElementById('civ-skill-name');
  private readonly elCivSkillState = document.getElementById('civ-skill-state');
  private readonly elFood = document.getElementById('res-food')!;
  private readonly elWood = document.getElementById('res-wood')!;
  private readonly elStone = document.getElementById('res-stone')!;
  private readonly elMetal = document.getElementById('res-metal')!;
  private readonly elPop = document.getElementById('res-pop')!;
  private readonly elPhase = document.getElementById('res-phase')!;
  private readonly elPeacefulPill = document.getElementById('peaceful-pill');
  private readonly elClock = document.getElementById('match-clock')!;
  private readonly elTerraformDigBtn = document.getElementById('btn-terraform-dig');
  private readonly elTerraformRaiseBtn = document.getElementById('btn-terraform-raise');
  private readonly elTerraformLevelBtn = document.getElementById('btn-terraform-level');
  private readonly elModeBanner = document.getElementById('mode-banner');
  private readonly elIdleBtn = document.getElementById('btn-idle')!;
  private readonly elIdleCount = document.getElementById('idle-count')!;
  private readonly elModeBtn = document.getElementById('btn-order-mode')!;
  private readonly elPauseBtn = document.getElementById('btn-pause')!;
  private readonly elSpeedBtn = document.getElementById('btn-speed')!;
  private readonly elEdgeBtn = document.getElementById('btn-edge')!;
  private readonly elRevealBtn = document.getElementById('btn-reveal')!;
  private readonly elMusicBtn = document.getElementById('btn-music')!;
  private readonly elSfxBtn = document.getElementById('btn-sfx')!;
  private readonly elLangBtn = document.getElementById('btn-lang')!;
  private readonly elDiplomacyBtn = document.getElementById('btn-diplomacy');
  private readonly elSaveGameBtn = document.getElementById('btn-save-game');
  private readonly elLoadGameBtn = document.getElementById('btn-load-game');
  private readonly elRandomMapBtn = document.getElementById('btn-random-map');
  private readonly elCheatBtn = document.getElementById('btn-cheat');
  private readonly elDockToggleBtn = document.getElementById('btn-dock-toggle');
  private readonly elBottomDock = document.getElementById('bottom-dock');
  private readonly elMenuBtn = document.getElementById('btn-menu')!;

  private readonly elSelectionPanel = document.getElementById('selection-panel')!;
  private readonly elCommandPanel = document.getElementById('command-panel')!;
  private readonly elToastContainer = document.getElementById('toast-container')!;
  private readonly elSetupModal = document.getElementById('setup-modal')!;
  private readonly elSetupCivGrid = document.getElementById('setup-civ-grid');
  private readonly elSetupMapGrid = document.getElementById('setup-map-grid');
  private readonly elSetupPlayersList = document.getElementById('setup-players-list');
  private readonly elDiplomacyModal = document.getElementById('diplomacy-modal');
  private readonly elDiplomacyList = document.getElementById('diplomacy-list');
  private readonly elCheatModal = document.getElementById('cheat-modal');
  private readonly elCheatInput = document.getElementById('cheat-code-input') as HTMLInputElement | null;
  private readonly elVictoryModal = document.getElementById('victory-modal')!;
  private readonly elVictoryBody = document.getElementById('victory-body')!;

  private dockCompact = false;
  private world!: World;
  private input!: InputController;

  constructor(private readonly callbacks: HUDCallbacks) {
    setLanguage(getLanguage());
    this.loadSavedSettings();
    this.wireStaticButtons();
    this.syncSettingsToDom();
    this.applyLanguage();
  }

  private loadSavedSettings(): void {
    const def = createDefaultSettings();
    try {
      const raw = localStorage.getItem(SETTINGS_STORAGE_KEY);
      if (!raw) {
        this.settings = def;
      } else {
        const parsed = JSON.parse(raw) as Partial<SkirmishSettings>;
        this.settings = {
          playerCiv: parsed.playerCiv === 'random' || (parsed.playerCiv && CIVS[parsed.playerCiv]) ? parsed.playerCiv : def.playerCiv,
          mapType: parsed.mapType && MAP_CARD_META[parsed.mapType] ? parsed.mapType : def.mapType,
          numPlayers: Math.max(2, Math.min(8, Number(parsed.numPlayers) || def.numPlayers)),
          difficulty: parsed.difficulty === 'easy' || parsed.difficulty === 'medium' || parsed.difficulty === 'hard' ? parsed.difficulty : def.difficulty,
          gameMode: parsed.gameMode === 'peaceful' ? 'peaceful' : 'skirmish',
          mapSize: parsed.mapSize === 'small' || parsed.mapSize === 'medium' || parsed.mapSize === 'large' || parsed.mapSize === 'huge' ? parsed.mapSize : def.mapSize,
          seedText: typeof parsed.seedText === 'string' ? parsed.seedText : '',
          playerTeams: Array.isArray(parsed.playerTeams) && parsed.playerTeams.length === 8
            ? parsed.playerTeams.map((n) => Math.max(0, Math.min(4, Number(n) || 0)))
            : def.playerTeams,
          aiCivs: Array.isArray(parsed.aiCivs) && parsed.aiCivs.length === 8
            ? parsed.aiCivs.map((c, idx) => (c === 'random' || (c && CIVS[c as CivId]) ? (c as CivChoice) : def.aiCivs[idx]))
            : def.aiCivs,
        };
      }
    } catch {
      this.settings = def;
    }
    this.selectedSetupCiv = this.settings.playerCiv;
    this.selectedSetupMap = this.settings.mapType;
  }

  private saveSettings(): void {
    try {
      localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(this.settings));
    } catch {
      // Ignore private-browsing storage errors
    }
  }

  private syncSettingsToDom(): void {
    const setVal = (id: string, val: string) => {
      const el = document.getElementById(id) as HTMLSelectElement | HTMLInputElement | null;
      if (el) el.value = val;
    };
    setVal('setup-num-players', String(this.settings.numPlayers));
    setVal('setup-difficulty', this.settings.difficulty);
    setVal('setup-game-mode', this.settings.gameMode);
    setVal('setup-map-size', this.settings.mapSize);
    setVal('setup-seed', this.settings.seedText);
    const loadSetupBtn = document.getElementById('btn-load-setup-save');
    if (loadSetupBtn) {
      loadSetupBtn.classList.toggle('hidden', !this.callbacks.hasSavedGame());
    }
  }

  buildMatchConfigFromSettings(forceRandomSeed = false): MatchConfig {
    const resolveCiv = (c: CivChoice): CivId =>
      c === 'random' ? ALL_CIV_IDS[Math.floor(Math.random() * ALL_CIV_IDS.length)] : c;
    const pCiv = resolveCiv(this.settings.playerCiv);
    const ai2Civ = resolveCiv(this.settings.aiCivs[1] ?? 'romans');
    const seedRaw = forceRandomSeed ? '' : this.settings.seedText.trim();
    const seed = seedRaw ? parseInt(seedRaw, 10) || Date.now() : Math.floor(Math.random() * 900000) + 100000;
    const playerSlots: PlayerSlotConfig[] = [];
    for (let i = 0; i < this.settings.numPlayers; i++) {
      playerSlots.push({
        playerId: i + 1,
        civ: i === 0 ? pCiv : resolveCiv(this.settings.aiCivs[i] ?? 'random'),
        team: this.settings.playerTeams[i] ?? 0,
        isAI: i > 0,
      });
    }
    return {
      seed,
      playerCiv: pCiv,
      aiCiv: ai2Civ,
      difficulty: this.settings.difficulty,
      mapType: this.settings.mapType,
      mapSize: this.settings.mapSize,
      gameMode: this.settings.gameMode,
      numPlayers: this.settings.numPlayers,
      playerSlots,
    };
  }

  isSetupOpen(): boolean {
    return !this.elSetupModal.classList.contains('hidden');
  }

  refreshLoadSaveButtons(): void {
    const hasSave = this.callbacks.hasSavedGame();
    document.getElementById('btn-load-setup-save')?.classList.toggle('hidden', !hasSave);
    if (this.elLoadGameBtn) {
      this.elLoadGameBtn.style.opacity = hasSave ? '1' : '0.45';
    }
  }

  bind(world: World, input: InputController): void {
    this.world = world;
    this.input = input;
    this.lastCommandSig = '';
    this.lastWinnerId = null;
    this.elVictoryModal.classList.add('hidden');
    this.elDiplomacyModal?.classList.add('hidden');
    const humanCiv = world.players.get(this.humanPlayerId)?.civ ?? world.config.playerCiv;
    this.updateTopCivEmblem(humanCiv);
    this.updateCivHeaderAndSkill();
    this.refreshLoadSaveButtons();
    this.renderSetupCards();
    this.renderSelectionAndCommands();
  }

  private updateTopCivEmblem(civId: CivId): void {
    const src = getCivEmblem(civId);
    const cfg = CIVS[civId];
    if (this.elCivEmblem && this.elCivEmblemFallback) {
      if (src) {
        this.elCivEmblem.src = src;
        this.elCivEmblem.alt = getCivName(civId);
        this.elCivEmblem.style.borderColor = cfg.cssColor;
        this.elCivEmblem.classList.remove('hidden');
        this.elCivEmblemFallback.classList.add('hidden');
      } else {
        this.elCivEmblem.classList.add('hidden');
        this.elCivEmblemFallback.textContent = cfg.skill.icon;
        this.elCivEmblemFallback.style.borderColor = cfg.cssColor;
        this.elCivEmblemFallback.classList.remove('hidden');
      }
    }
  }

  toggleDockCompact(): void {
    this.dockCompact = !this.dockCompact;
    this.elBottomDock?.classList.toggle('dock-compact', this.dockCompact);
    if (this.elDockToggleBtn) {
      this.elDockToggleBtn.textContent = this.dockCompact ? '▴' : '▾';
      this.elDockToggleBtn.classList.toggle('active', this.dockCompact);
    }
  }

  toggleCheatModal(): void {
    if (!this.elCheatModal) return;
    const opening = this.elCheatModal.classList.contains('hidden');
    this.elCheatModal.classList.toggle('hidden');
    this.syncCheatModalState();
    if (opening) {
      setTimeout(() => this.elCheatInput?.focus(), 30);
    }
  }

  syncCheatModalState(): void {
    const fastBtn = document.getElementById('btn-cheat-fast');
    const p = this.world?.players.get(this.humanPlayerId);
    if (fastBtn) {
      const on = Boolean(p?.fastBuildCheat);
      fastBtn.classList.toggle('active', on);
      fastBtn.textContent = on ? t('cheatFastOn') : t('cheatFastBtn');
    }
  }

  private executeCheatCode(raw: string): void {
    const code = raw.trim().toLowerCase();
    if (!code) return;
    const codeMap: Record<string, CheatAction | 'reveal_map'> = {
      'i want pizza': 'resources',
      'i want the monkeys': 'spawn_army',
      greedisgood: 'resources',
      resources: 'resources',
      gold: 'resources',
      fastbuild: 'fast_build',
      aegis: 'fast_build',
      alltech: 'all_techs',
      alltechs: 'all_techs',
      revealmap: 'reveal_map',
      marco: 'reveal_map',
      iseedeadpeople: 'reveal_map',
      noskillcd: 'reset_skill',
      skill: 'reset_skill',
      spawnarmy: 'spawn_army',
      army: 'spawn_army',
      healall: 'heal_all',
      heal: 'heal_all',
      victory: 'instant_win',
      win: 'instant_win',
    };
    const action = codeMap[code];
    if (!action) {
      this.pushToast(t('cheatToastUnknown'), 'warn');
      return;
    }
    this.callbacks.onCheat(action);
    this.syncCheatModalState();
  }

  private wireStaticButtons(): void {
    this.elTerraformDigBtn?.addEventListener('click', () => {
      this.input?.activateTerraformFromUI('dig');
      this.syncTerraformUI();
    });
    this.elTerraformRaiseBtn?.addEventListener('click', () => {
      this.input?.activateTerraformFromUI('raise');
      this.syncTerraformUI();
    });
    this.elTerraformLevelBtn?.addEventListener('click', () => {
      this.input?.activateTerraformFromUI('level');
      this.syncTerraformUI();
    });
    this.elIdleBtn.addEventListener('click', () => this.input?.selectIdleWorker());
    this.elModeBtn.addEventListener('click', () => {
      if (!this.input) return;
      this.input.buildingOrderMode = this.input.buildingOrderMode === 'capture' ? 'attack' : 'capture';
      this.updateModeButton();
    });
    this.elCivBadgeBtn?.addEventListener('click', () => {
      this.renderSetupCards();
      this.elSetupModal.classList.remove('hidden');
    });
    this.elCivSkillBtn?.addEventListener('click', () => this.callbacks.onActivateSkill());
    this.elPauseBtn.addEventListener('click', () => this.callbacks.onTogglePause());
    this.elSpeedBtn.addEventListener('click', () => this.callbacks.onCycleSpeed());
    this.elEdgeBtn.addEventListener('click', () => this.callbacks.onToggleEdgeScroll());
    this.elRevealBtn.addEventListener('click', () => this.callbacks.onToggleReveal());
    this.elMusicBtn.addEventListener('click', () => this.callbacks.onToggleMusic());
    this.elSfxBtn.addEventListener('click', () => this.callbacks.onToggleSfx());
    this.elLangBtn.addEventListener('click', () => this.callbacks.onToggleLanguage());
    this.elDiplomacyBtn?.addEventListener('click', () => this.toggleDiplomacyModal());
    this.elSaveGameBtn?.addEventListener('click', () => this.callbacks.onSaveGame());
    this.elLoadGameBtn?.addEventListener('click', () => this.callbacks.onLoadGame());
    this.elRandomMapBtn?.addEventListener('click', () => this.callbacks.onQuickRandomMap());
    this.elCheatBtn?.addEventListener('click', () => this.toggleCheatModal());
    this.elDockToggleBtn?.addEventListener('click', () => this.toggleDockCompact());
    this.elMenuBtn.addEventListener('click', () => {
      this.syncSettingsToDom();
      this.renderSetupCards();
      this.elSetupModal.classList.remove('hidden');
    });

    document.getElementById('btn-close-diplomacy')?.addEventListener('click', () => {
      this.elDiplomacyModal?.classList.add('hidden');
    });

    document.getElementById('btn-close-cheat')?.addEventListener('click', () => {
      this.elCheatModal?.classList.add('hidden');
    });
    document.getElementById('cheat-code-form')?.addEventListener('submit', (ev) => {
      ev.preventDefault();
      if (!this.elCheatInput) return;
      this.executeCheatCode(this.elCheatInput.value);
      this.elCheatInput.value = '';
    });
    document.querySelectorAll<HTMLButtonElement>('[data-cheat]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const action = btn.dataset.cheat as CheatAction | 'reveal_map';
        this.callbacks.onCheat(action);
        this.syncCheatModalState();
      });
    });

    const onInlineChange = () => {
      this.settings.numPlayers = Math.max(
        2,
        Math.min(8, Number((document.getElementById('setup-num-players') as HTMLSelectElement | null)?.value ?? 2))
      );
      this.settings.difficulty = ((document.getElementById('setup-difficulty') as HTMLSelectElement | null)?.value ??
        'medium') as Difficulty;
      this.settings.gameMode = ((document.getElementById('setup-game-mode') as HTMLSelectElement | null)?.value ??
        'skirmish') as GameMode;
      this.settings.mapSize = ((document.getElementById('setup-map-size') as HTMLSelectElement | null)?.value ??
        'medium') as MapSize;
      this.settings.seedText = (document.getElementById('setup-seed') as HTMLInputElement | null)?.value ?? '';
      this.saveSettings();
      this.renderSetupPlayersList();
    };
    ['setup-num-players', 'setup-difficulty', 'setup-game-mode', 'setup-map-size'].forEach((id) => {
      document.getElementById(id)?.addEventListener('change', onInlineChange);
    });
    document.getElementById('setup-seed')?.addEventListener('input', onInlineChange);

    document.getElementById('btn-reset-setup')?.addEventListener('click', () => {
      this.settings = createDefaultSettings();
      this.selectedSetupCiv = this.settings.playerCiv;
      this.selectedSetupMap = this.settings.mapType;
      try {
        localStorage.removeItem(SETTINGS_STORAGE_KEY);
      } catch {
        // ignore
      }
      this.syncSettingsToDom();
      this.renderSetupCards();
      this.pushToast(t('toastSettingsReset'), 'info');
    });

    document.getElementById('btn-load-setup-save')?.addEventListener('click', () => {
      this.elSetupModal.classList.add('hidden');
      this.callbacks.onLoadGame();
    });

    const btnCloseModal = document.getElementById('btn-close-setup')!;
    btnCloseModal.addEventListener('click', () => {
      this.elSetupModal.classList.add('hidden');
      this.callbacks.onSetupClosed();
    });

    const btnLaunch = document.getElementById('btn-launch-match')!;
    btnLaunch.addEventListener('click', () => {
      onInlineChange();
      this.elSetupModal.classList.add('hidden');
      this.callbacks.onStartMatch(this.buildMatchConfigFromSettings(false));
    });

    const btnPlayAgain = document.getElementById('btn-play-again')!;
    btnPlayAgain.addEventListener('click', () => {
      this.elVictoryModal.classList.add('hidden');
      this.renderSetupCards();
      this.elSetupModal.classList.remove('hidden');
    });
  }

  private renderSetupCards(): void {
    if (this.elSetupCivGrid) {
      const randomSelected = this.selectedSetupCiv === 'random';
      const randomCardHtml = `
        <button type="button" class="civ-card ${randomSelected ? 'selected' : ''}" data-pick-civ="random" style="--civ-accent:#facc15">
          <div class="civ-card-head">
            <span class="civ-card-emblem-fallback">🎲</span>
            <div>
              <div class="civ-card-title">🎲 ${t('randomCivName')}</div>
              <div class="civ-card-bonus">${t('randomCivBonus')}</div>
            </div>
          </div>
        </button>
      `;
      this.elSetupCivGrid.innerHTML =
        randomCardHtml +
        ALL_CIV_IDS.map((civId) => {
          const cfg = CIVS[civId];
          const bText = getTemplateText(cfg.uniqueBuilding);
          const u1 = getTemplateText(cfg.units.infantryMelee).shortName;
          const u2 = getTemplateText(cfg.units.special).shortName;
          const u3 = getTemplateText(cfg.units.champion).shortName;
          const skillText = getCivSkillText(civId);
          const selected = this.selectedSetupCiv === civId;
          const emblemSrc = getCivEmblem(civId);
          const emblemHtml = emblemSrc
            ? `<img class="civ-card-emblem" src="${emblemSrc}" alt="${getCivName(civId)}" />`
            : `<span class="civ-card-emblem-fallback">${cfg.skill.icon}</span>`;
          return `
            <button type="button" class="civ-card ${selected ? 'selected' : ''}" data-pick-civ="${civId}" style="--civ-accent:${cfg.cssColor}">
              <div class="civ-card-head">
                ${emblemHtml}
                <div>
                  <div class="civ-card-title">${getCivName(civId)}</div>
                  <div class="civ-card-bonus">${getCivBonusText(civId)}</div>
                </div>
              </div>
              <div class="civ-card-traits">
                <div>🏛️ <b>${t('setupUniqueBuildingLabel')}:</b> ${bText.name}</div>
                <div>⚔️ <b>${t('setupUniqueUnitsLabel')}:</b> ${u1} • ${u2} • ${u3}</div>
                <div>${cfg.skill.icon} <b>${t('setupSkillLabel')}:</b> ${skillText.name}</div>
              </div>
            </button>
          `;
        }).join('');

      this.elSetupCivGrid.querySelectorAll<HTMLButtonElement>('[data-pick-civ]').forEach((btn) => {
        btn.addEventListener('click', () => {
          this.selectedSetupCiv = btn.dataset.pickCiv as CivChoice;
          this.settings.playerCiv = this.selectedSetupCiv;
          this.saveSettings();
          this.renderSetupCards();
        });
      });
    }

    if (this.elSetupMapGrid) {
      const mapOptions: MapType[] = ['random', ...ALL_MAP_TYPES];
      this.elSetupMapGrid.innerHTML = mapOptions
        .map((mId) => {
          const meta = MAP_CARD_META[mId];
          const selected = this.selectedSetupMap === mId;
          return `
            <button type="button" class="map-card ${selected ? 'selected' : ''}" data-pick-map="${mId}">
              <div class="map-card-head">
                <span class="map-swatch" style="background:${meta.swatch}"></span>
                <span>${meta.icon} ${getMapLabel(mId)}</span>
              </div>
              <div class="map-card-desc">${getMapDescription(mId)}</div>
            </button>
          `;
        })
        .join('');

      this.elSetupMapGrid.querySelectorAll<HTMLButtonElement>('[data-pick-map]').forEach((btn) => {
        btn.addEventListener('click', () => {
          this.selectedSetupMap = btn.dataset.pickMap as MapType;
          this.settings.mapType = this.selectedSetupMap;
          this.saveSettings();
          this.renderSetupCards();
        });
      });
    }

    this.renderSetupPlayersList();
  }

  private renderSetupPlayersList(): void {
    if (!this.elSetupPlayersList) return;
    const n = this.settings.numPlayers;
    const teamOpts = (selectedTeam: number) =>
      [0, 1, 2, 3, 4]
        .map(
          (tm) =>
            `<option value="${tm}" ${selectedTeam === tm ? 'selected' : ''}>${
              tm === 0 ? t('teamNone') : `${t('teamPrefix')} ${tm}`
            }</option>`
        )
        .join('');
    const civOpts = (selectedCiv: CivChoice) =>
      `<option value="random" ${selectedCiv === 'random' ? 'selected' : ''}>🎲 ${t('randomCivName')}</option>` +
      ALL_CIV_IDS.map(
        (cid) => `<option value="${cid}" ${selectedCiv === cid ? 'selected' : ''}>${getCivName(cid)}</option>`
      ).join('');

    const rows: string[] = [];
    for (let i = 0; i < n; i++) {
      const pal = PLAYER_COLOR_PALETTE[i % PLAYER_COLOR_PALETTE.length];
      const isHuman = i === 0;
      const label = isHuman ? t('nationHumanLabel') : `${t('nationAiPrefix')} ${i + 1}`;
      const civControl = isHuman
        ? `<span style="flex:1;color:var(--gold-bright);font-weight:600">${
            this.settings.playerCiv === 'random' ? `🎲 ${t('randomCivName')}` : getCivName(this.settings.playerCiv)
          }</span>`
        : `<select data-slot-civ="${i}">${civOpts(this.settings.aiCivs[i] ?? 'random')}</select>`;
      rows.push(`
        <div class="player-slot-row">
          <span class="player-color-dot" style="background:${pal.css}"></span>
          <span class="player-slot-name">${label}</span>
          ${civControl}
          <select data-slot-team="${i}">${teamOpts(this.settings.playerTeams[i] ?? 0)}</select>
        </div>
      `);
    }
    this.elSetupPlayersList.innerHTML = rows.join('');

    this.elSetupPlayersList.querySelectorAll<HTMLSelectElement>('[data-slot-civ]').forEach((sel) => {
      sel.addEventListener('change', () => {
        const idx = Number(sel.dataset.slotCiv);
        this.settings.aiCivs[idx] = sel.value as CivChoice;
        this.saveSettings();
      });
    });
    this.elSetupPlayersList.querySelectorAll<HTMLSelectElement>('[data-slot-team]').forEach((sel) => {
      sel.addEventListener('change', () => {
        const idx = Number(sel.dataset.slotTeam);
        this.settings.playerTeams[idx] = Number(sel.value) || 0;
        this.saveSettings();
      });
    });
  }

  toggleDiplomacyModal(): void {
    if (!this.elDiplomacyModal || !this.world) return;
    const opening = this.elDiplomacyModal.classList.contains('hidden');
    this.elDiplomacyModal.classList.toggle('hidden');
    if (opening) this.renderDiplomacyModal();
  }

  renderDiplomacyModal(): void {
    if (!this.elDiplomacyList || !this.world) return;
    const human = this.world.players.get(this.humanPlayerId);
    if (!human) return;
    const others = Array.from(this.world.players.values()).filter((p) => p.id !== this.humanPlayerId);
    this.elDiplomacyList.innerHTML = others
      .map((p) => {
        const stance = this.world.getDiplomacy(this.humanPlayerId, p.id);
        const mutualAlly = this.world.areAllies(this.humanPlayerId, p.id);
        const emblem = getCivEmblem(p.civ);
        const statusTag = p.defeated
          ? `<span style="color:#f87171;font-size:11px">(${t('defeatedTag')})</span>`
          : mutualAlly
            ? `<span style="color:#4ade80;font-size:11px">(${t('stanceAlly')})</span>`
            : '';
        return `
          <div class="diplo-row ${p.defeated ? 'defeated' : ''}">
            <div class="diplo-nation">
              <span class="player-color-dot" style="background:${p.cssColor}"></span>
              ${emblem ? `<img class="diplo-emblem" src="${emblem}" alt="${getCivName(p.civ)}" />` : ''}
              <div>
                <div style="font-weight:700">${t('nationAiPrefix')} ${p.id} • ${getCivName(p.civ)} ${statusTag}</div>
                <div style="font-size:11px;color:var(--text-muted)">${p.team > 0 ? `${t('teamPrefix')} ${p.team}` : t('teamNone')}</div>
              </div>
            </div>
            <div class="diplo-stances">
              <button type="button" class="diplo-btn ${stance === 'ally' ? 'active-ally' : ''}" data-diplo-pid="${p.id}" data-diplo-stance="ally" ${p.defeated ? 'disabled' : ''}>${t('stanceAlly')}</button>
              <button type="button" class="diplo-btn ${stance === 'neutral' ? 'active-neutral' : ''}" data-diplo-pid="${p.id}" data-diplo-stance="neutral" ${p.defeated ? 'disabled' : ''}>${t('stanceNeutral')}</button>
              <button type="button" class="diplo-btn ${stance === 'enemy' ? 'active-enemy' : ''}" data-diplo-pid="${p.id}" data-diplo-stance="enemy" ${p.defeated ? 'disabled' : ''}>${t('stanceEnemy')}</button>
            </div>
            <div class="diplo-tribute">
              <span>${t('tributeLabel')}</span>
              <button type="button" class="tribute-btn" data-trib-pid="${p.id}" data-trib-res="food" ${p.defeated ? 'disabled' : ''}>🌾</button>
              <button type="button" class="tribute-btn" data-trib-pid="${p.id}" data-trib-res="wood" ${p.defeated ? 'disabled' : ''}>🪵</button>
              <button type="button" class="tribute-btn" data-trib-pid="${p.id}" data-trib-res="stone" ${p.defeated ? 'disabled' : ''}>🪨</button>
              <button type="button" class="tribute-btn" data-trib-pid="${p.id}" data-trib-res="metal" ${p.defeated ? 'disabled' : ''}>🪙</button>
            </div>
          </div>
        `;
      })
      .join('');

    this.elDiplomacyList.querySelectorAll<HTMLButtonElement>('[data-diplo-pid]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const pid = Number(btn.dataset.diploPid);
        const stance = btn.dataset.diploStance as DiplomaticStance;
        this.world.enqueueCommand({
          type: 'set_diplomacy',
          playerId: this.humanPlayerId,
          targetPlayerId: pid,
          stance,
        });
        setTimeout(() => this.renderDiplomacyModal(), 60);
      });
    });
    this.elDiplomacyList.querySelectorAll<HTMLButtonElement>('[data-trib-pid]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const pid = Number(btn.dataset.tribPid);
        const res = btn.dataset.tribRes as ResourceType;
        if ((human.resources[res] ?? 0) < 100) {
          this.pushToast(`${t('needPrefix')} 100 ${getResourceName(res)}`, 'warn');
          return;
        }
        this.world.enqueueCommand({
          type: 'send_tribute',
          playerId: this.humanPlayerId,
          targetPlayerId: pid,
          resource: res,
          amount: 100,
        });
      });
    });
  }

  private updateCivHeaderAndSkill(): void {
    if (!this.world) return;
    const p = this.world.players.get(this.humanPlayerId);
    if (!p) return;
    const civ = CIVS[p.civ];
    const skillText = getCivSkillText(p.civ);

    if (this.elCivBadgeBtn) this.elCivBadgeBtn.title = t('civBadgeTip');
    if (this.elCivNamePill) this.elCivNamePill.textContent = getCivName(p.civ);
    if (this.elMapNamePill) this.elMapNamePill.textContent = getMapLabel(this.world.terrain.resolvedMapType);

    if (this.elCivSkillBtn && this.elCivSkillIcon && this.elCivSkillName && this.elCivSkillState) {
      this.elCivSkillIcon.textContent = civ.skill.icon;
      this.elCivSkillName.textContent = skillText.name;
      this.elCivSkillBtn.title = `${skillText.name} [F]\n${skillText.description}`;

      if (p.skillActiveTimer > 0) {
        this.elCivSkillBtn.className = 'skill-pill active-buff';
        this.elCivSkillState.textContent = `${t('skillActive')} ${Math.ceil(p.skillActiveTimer)}s`;
      } else if (p.skillCooldown > 0) {
        this.elCivSkillBtn.className = 'skill-pill cooldown';
        this.elCivSkillState.textContent = `${t('skillCooldown')} ${Math.ceil(p.skillCooldown)}s`;
      } else {
        this.elCivSkillBtn.className = 'skill-pill ready';
        this.elCivSkillState.textContent = t('skillReady');
      }
    }
  }

  /** Instantly applies the active language across every static & dynamic UI element */
  applyLanguage(): void {
    const setText = (id: string, val: string) => {
      const el = document.getElementById(id);
      if (el) el.textContent = val;
    };
    const setTitle = (id: string, val: string) => {
      const el = document.getElementById(id);
      if (el) el.title = val;
    };

    // Top bar resources & compact icon tooltips
    setTitle('pill-food', `${t('resFood')} — ${t('resFoodTip')}`);
    setTitle('pill-wood', `${t('resWood')} — ${t('resWoodTip')}`);
    setTitle('pill-stone', `${t('resStone')} — ${t('resStoneTip')}`);
    setTitle('pill-metal', `${t('resMetal')} — ${t('resMetalTip')}`);
    setTitle('pill-pop', t('resPopTip'));

    this.elIdleBtn.title = t('idleTip');
    if (this.elTerraformDigBtn) this.elTerraformDigBtn.title = t('digTip');
    if (this.elTerraformRaiseBtn) this.elTerraformRaiseBtn.title = t('raiseTip');
    if (this.elTerraformLevelBtn) this.elTerraformLevelBtn.title = t('levelTip');
    if (this.elPeacefulPill) this.elPeacefulPill.textContent = t('peacefulBadge');
    setText('lbl-setup-game-mode', t('labelGameMode'));
    const modeSel = document.getElementById('setup-game-mode') as HTMLSelectElement | null;
    if (modeSel && modeSel.options.length >= 2) {
      modeSel.options[0].textContent = t('modeSkirmish');
      modeSel.options[1].textContent = t('modePeaceful');
    }
    this.elSpeedBtn.title = t('speedTip');
    this.elEdgeBtn.textContent = '🖱️';
    this.elEdgeBtn.title = t('edgeTip');
    this.elRevealBtn.textContent = '👁️';
    this.elRevealBtn.title = t('mapTip');
    this.elMusicBtn.title = t('musicTip');
    this.elSfxBtn.title = t('sfxTip');
    this.elLangBtn.textContent = getLanguage() === 'zh-TW' ? 'EN' : '中';
    this.elLangBtn.title = t('langTip');
    if (this.elRandomMapBtn) {
      this.elRandomMapBtn.textContent = '🎲';
      this.elRandomMapBtn.title = t('randomMapTip');
    }
    if (this.elCheatBtn) {
      this.elCheatBtn.textContent = t('cheatBtn');
      this.elCheatBtn.title = t('cheatTip');
    }
    if (this.elDockToggleBtn) {
      this.elDockToggleBtn.title = t('dockToggleTip');
    }
    this.elMenuBtn.textContent = '⚙️';
    this.elMenuBtn.title = t('newMatchTip');

    // Cheat console labels
    setText('cheat-title', t('cheatTitle'));
    if (this.elCheatInput) this.elCheatInput.placeholder = t('cheatPlaceholder');
    setText('btn-cheat-run', t('cheatRunBtn'));
    setText('btn-cheat-res', t('cheatResBtn'));
    setText('btn-cheat-tech', t('cheatTechBtn'));
    setText('btn-cheat-map', t('cheatMapBtn'));
    setText('btn-cheat-skill', t('cheatSkillBtn'));
    setText('btn-cheat-army', t('cheatArmyBtn'));
    setText('btn-cheat-heal', t('cheatHealBtn'));
    setText('btn-cheat-win', t('cheatWinBtn'));
    this.syncCheatModalState();

    // Setup modal labels & options
    setText('setup-title', t('setupTitle'));
    setText('lbl-setup-player-civ', t('labelPlayerCiv'));
    setText('lbl-setup-num-players', t('setupNumPlayersLabel'));
    setText('lbl-setup-players', t('setupPlayersSectionTitle'));
    setText('lbl-setup-difficulty', t('labelDifficulty'));
    setText('lbl-setup-map-type', t('labelMapType'));
    setText('lbl-setup-seed', t('labelSeed'));
    setText('btn-reset-setup', t('resetSetupBtn'));
    setText('btn-load-setup-save', t('loadSaveBtn'));
    setText('diplomacy-title', t('diplomacyTitle'));
    setText('diplomacy-desc', t('diplomacyDesc'));
    if (this.elDiplomacyBtn) this.elDiplomacyBtn.title = t('diplomacyTip');
    if (this.elSaveGameBtn) this.elSaveGameBtn.title = t('saveGameTip');
    if (this.elLoadGameBtn) this.elLoadGameBtn.title = t('loadGameTip');
    const seedInput = document.getElementById('setup-seed') as HTMLInputElement | null;
    if (seedInput) seedInput.placeholder = t('seedPlaceholder');

    const setSelectOpts = (id: string, map: Record<string, string>) => {
      const sel = document.getElementById(id) as HTMLSelectElement | null;
      if (!sel) return;
      for (const opt of Array.from(sel.options)) {
        if (map[opt.value]) opt.textContent = map[opt.value];
      }
    };
    const isZh = getLanguage() === 'zh-TW';
    setSelectOpts('setup-num-players', {
      '2': isZh ? '2 國對戰' : '2 Nations',
      '3': isZh ? '3 國混戰' : '3 Nations',
      '4': isZh ? '4 國混戰' : '4 Nations',
      '5': isZh ? '5 國混戰' : '5 Nations',
      '6': isZh ? '6 國混戰' : '6 Nations',
      '7': isZh ? '7 國混戰' : '7 Nations',
      '8': isZh ? '8 國大戰' : '8 Nations',
    });
    setSelectOpts('setup-difficulty', {
      easy: t('optDiffEasy'),
      medium: t('optDiffMedium'),
      hard: t('optDiffHard'),
    });
    setText('lbl-setup-map-size', t('setupMapSizeLabel'));
    setSelectOpts('setup-map-size', {
      small: t('optMapSmall'),
      medium: t('optMapMedium'),
      large: t('optMapLarge'),
      huge: t('optMapHuge'),
    });

    this.renderSetupCards();
    const guide = document.getElementById('setup-controls-guide');
    if (guide) guide.innerHTML = t('controlsGuideHtml');
    setText('btn-launch-match', t('launchMatchBtn'));
    setText('btn-play-again', t('playAgainBtn'));

    // Force refresh of dynamic HUD sections
    this.lastCommandSig = '';
    if (this.world && this.input) {
      if (this.elCivEmblem) this.elCivEmblem.alt = getCivName(this.world.config.playerCiv);
      this.updateCivHeaderAndSkill();
      this.updatePeriodic();
      if (this.lastWinnerId !== null && !this.elVictoryModal.classList.contains('hidden')) {
        this.showVictory(this.lastWinnerId);
      }
    }
  }

  setTopBarStates(
    paused: boolean,
    speed: number,
    edgeScroll: boolean,
    revealAll: boolean,
    musicEnabled: boolean,
    sfxEnabled: boolean
  ): void {
    this.elPauseBtn.textContent = paused ? '▶' : '⏸';
    this.elPauseBtn.title = paused ? t('resumeBtn') : t('pauseBtn');
    this.elSpeedBtn.textContent = `${speed}×`;
    this.elEdgeBtn.classList.toggle('active', edgeScroll);
    this.elRevealBtn.classList.toggle('active', revealAll);
    this.elMusicBtn.textContent = musicEnabled ? '🎵' : '🔕';
    this.elMusicBtn.classList.toggle('active', musicEnabled);
    this.elSfxBtn.textContent = sfxEnabled ? '🔊' : '🔇';
    this.elSfxBtn.classList.toggle('active', sfxEnabled);
    this.updateModeButton();
  }

  private updateModeButton(): void {
    if (!this.input) return;
    const isCap = this.input.buildingOrderMode === 'capture';
    this.elModeBtn.textContent = isCap ? '🚩' : '🔥';
    this.elModeBtn.title = `${isCap ? t('captureBtn') : t('destroyBtn')} — ${t('modeTip')}`;
    this.elModeBtn.classList.toggle('active', isCap);
  }

  private syncTerraformUI(): void {
    if (!this.input) return;
    const mode = this.input.terraformMode;
    this.elTerraformDigBtn?.classList.toggle('active', mode === 'dig');
    this.elTerraformRaiseBtn?.classList.toggle('active', mode === 'raise');
    this.elTerraformLevelBtn?.classList.toggle('active', mode === 'level');
    if (this.elPeacefulPill && this.world) {
      this.elPeacefulPill.classList.toggle('hidden', !this.world.isPeaceful());
    }
    if (this.elModeBanner) {
      if (!mode) {
        this.elModeBanner.classList.add('hidden');
      } else {
        this.elModeBanner.classList.remove('hidden');
        this.elModeBanner.textContent =
          mode === 'dig'
            ? this.input.pendingDigSource
              ? t('toastDigStep2')
              : t('toastDigMode')
            : mode === 'level'
              ? t('toastLevelMode')
              : t('toastRaiseMode');
      }
    }
  }

  pushToast(message: string, tone: 'info' | 'warn' | 'good' = 'info', jumpPos?: { x: number; z: number }): void {
    const el = document.createElement('div');
    el.className = `toast toast-${tone}${jumpPos ? ' toast-clickable' : ''}`;
    if (jumpPos) {
      const msgSpan = document.createElement('span');
      msgSpan.textContent = message;
      const badge = document.createElement('span');
      badge.className = 'toast-jump-tag';
      badge.textContent = t('toastJumpBadge');
      el.append(msgSpan, badge);
      el.title = t('toastClickJump');
      el.addEventListener('mousedown', (ev) => ev.stopPropagation());
      el.addEventListener('click', (ev) => {
        ev.stopPropagation();
        this.callbacks.onJumpTo(jumpPos.x, jumpPos.z);
      });
    } else {
      el.textContent = message;
    }
    this.elToastContainer.appendChild(el);
    while (this.elToastContainer.children.length > 6) {
      this.elToastContainer.removeChild(this.elToastContainer.firstChild!);
    }
    const lifetimeMs = jumpPos ? 7500 : 4200;
    setTimeout(() => {
      el.classList.add('fade-out');
      setTimeout(() => el.remove(), 350);
    }, lifetimeMs);
  }

  private formatPlayerLabel(playerId: number): string {
    const p = this.world.players.get(playerId);
    if (!p) return t('gaia');
    const civName = getCivName(p.civ);
    if (playerId === this.humanPlayerId && !p.isAI) return `${t('youPrefix')} (${civName})`;
    return `${t('petraAi')} (${civName})`;
  }

  showVictory(winnerId: number): void {
    this.lastWinnerId = winnerId;
    const p1 = this.world.players.get(1)!;
    const p2 = this.world.players.get(2)!;
    const won = winnerId === this.humanPlayerId;
    const mins = Math.floor(this.world.time / 60);
    const secs = Math.floor(this.world.time % 60);

    this.elVictoryBody.innerHTML = `
      <h2 class="${won ? 'victory-title-win' : 'victory-title-loss'}">
        ${won ? t('victoryWin') : t('victoryLoss')}
      </h2>
      <p class="victory-sub">${t('matchDuration')}: ${mins}:${secs.toString().padStart(2, '0')}</p>
      <table class="stats-table">
        <thead>
          <tr><th>${t('metric')}</th><th>${this.formatPlayerLabel(1)}</th><th>${this.formatPlayerLabel(2)}</th></tr>
        </thead>
        <tbody>
          <tr><td>${t('statGathered')}</td><td>${p1.stats.resourcesGathered}</td><td>${p2.stats.resourcesGathered}</td></tr>
          <tr><td>${t('statTrained')}</td><td>${p1.stats.unitsTrained}</td><td>${p2.stats.unitsTrained}</td></tr>
          <tr><td>${t('statDefeated')}</td><td>${p1.stats.enemiesKilled}</td><td>${p2.stats.enemiesKilled}</td></tr>
          <tr><td>${t('statBuilt')}</td><td>${p1.stats.buildingsConstructed}</td><td>${p2.stats.buildingsConstructed}</td></tr>
          <tr><td>${t('statCaptured')}</td><td>${p1.stats.buildingsCaptured}</td><td>${p2.stats.buildingsCaptured}</td></tr>
        </tbody>
      </table>
    `;
    this.elVictoryModal.classList.remove('hidden');
  }

  updatePeriodic(): void {
    if (!this.world || !this.input) return;
    const p = this.world.players.get(this.humanPlayerId)!;

    this.elFood.textContent = `${Math.floor(p.resources.food)}`;
    this.elWood.textContent = `${Math.floor(p.resources.wood)}`;
    this.elStone.textContent = `${Math.floor(p.resources.stone)}`;
    this.elMetal.textContent = `${Math.floor(p.resources.metal)}`;
    this.elPop.textContent = `${p.popUsed}/${p.popCap}`;
    this.elPop.classList.toggle('pop-warn', p.popUsed >= p.popCap);
    const phaseRoman = p.phase === 1 ? 'I' : p.phase === 2 ? 'II' : p.phase === 3 ? 'III' : 'IV';
    const phaseTitle =
      p.phase === 1 ? t('phase1') : p.phase === 2 ? t('phase2') : p.phase === 3 ? t('phase3') : t('phase4');
    this.elPhase.textContent = phaseRoman;
    this.elPhase.title = phaseTitle;
    this.syncTerraformUI();
    this.updateCivHeaderAndSkill();

    const mins = Math.floor(this.world.time / 60);
    const secs = Math.floor(this.world.time % 60);
    this.elClock.textContent = `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;

    // Count idle workers
    let idleCount = 0;
    for (const e of this.world.entities.values()) {
      if (e.alive && e.owner === this.humanPlayerId && e.garrisonedIn === null && e.order.type === 'idle' && TEMPLATES[e.templateId].gather) {
        idleCount++;
      }
    }
    this.elIdleCount.textContent = `${idleCount}`;
    this.elIdleBtn.classList.toggle('has-idle', idleCount > 0);
    this.updateModeButton();
    this.syncTerraformUI();

    // Prune dead selections
    for (const id of Array.from(this.input.selectedIds)) {
      const e = this.world.entities.get(id);
      if (!e || !e.alive || e.garrisonedIn !== null) this.input.selectedIds.delete(id);
    }

    this.renderSelectionAndCommands();
  }

  renderSelectionAndCommands(): void {
    if (!this.world || !this.input) return;
    const selected = Array.from(this.input.selectedIds)
      .map((id) => this.world.entities.get(id))
      .filter((e): e is Entity => !!e && e.alive);

    if (selected.length === 0) {
      this.elBottomDock?.classList.add('no-selection');
      this.elCommandPanel.classList.add('hidden');
      this.lastCommandSig = `empty_${getLanguage()}`;
      return;
    }

    this.elBottomDock?.classList.remove('no-selection');

    if (selected.length === 1) {
      this.renderSingleSelection(selected[0]);
    } else {
      this.renderMultiSelection(selected);
    }

    this.renderCommandGrid(selected);
  }

  private renderSingleSelection(e: Entity): void {
    const tpl = TEMPLATES[e.templateId];
    const tplText = getTemplateText(e.templateId);
    const ownerP = this.world.players.get(e.owner);
    const hpPct = Math.round((e.hp / Math.max(1, e.maxHp)) * 100);
    const rankLabel = e.rank === 3 ? t('rankElite') : e.rank === 2 ? t('rankAdv') : t('rankBasic');
    const armor = this.world.getEntityArmor(e);

    const isPrey =
      e.templateId === 'deer_herd' ||
      e.templateId === 'wild_boar' ||
      Boolean(tpl.isPassiveFauna && !tpl.isFlying) ||
      Boolean(tpl.isPredator);
    const isSlainPrey = isPrey && e.hp <= 0;
    const displayName = isSlainPrey ? `${tplText.name}${t('carcassSuffix')}` : tplText.name;

    let extraHtml = '';
    if (tpl.kind === 'resource') {
      if (tpl.isFlying) {
        extraHtml = `<div class="sel-meta">${tplText.description}</div>`;
      } else {
        const resLabel = tpl.resourceType ? getResourceName(tpl.resourceType) : '';
        extraHtml = isSlainPrey
          ? `<div class="sel-meta">${t('slainMeta')} <b>${Math.ceil(e.resourceRemaining)}</b></div>`
          : `<div class="sel-meta">${t('remainingPrefix')} ${resLabel}: <b>${Math.ceil(e.resourceRemaining)}</b></div>`;
      }
    } else if (tpl.kind === 'building') {
      const capPts = e.capturePoints[e.owner] ?? e.captureMax;
      const capPct = e.captureMax > 0 ? Math.round((capPts / e.captureMax) * 100) : 100;
      const statusText = e.isFoundation
        ? `${t('constructing')}: ${Math.round(e.buildProgress * 100)}%`
        : e.upgradeTargetTemplateId
          ? `🏗️ ${t('upgradingLabel')}: ${Math.round((e.upgradeProgress ?? 0) * 100)}%`
          : !e.inTerritory && tpl.mustBeInTerritory
            ? t('decaying')
            : `${t('loyalty')}: ${capPct}%`;
      const upgradeLabel =
        e.upgradeTargetTemplateId === 'stone_gate'
          ? getTemplateText('stone_gate').shortName
          : e.upgradeTargetTemplateId === 'stone_wall'
            ? getTemplateText('stone_wall').shortName
            : e.upgradeTargetTemplateId === 'beacon_tower'
              ? `${getTemplateText('beacon_tower').shortName} Lv.${e.upgradeTargetFloors ?? 1}`
              : `${e.upgradeTargetFloors ?? 2}F`;
      const upgradeBarHtml = e.upgradeTargetTemplateId
        ? `<div class="terraform-progress-row">
             <div class="tf-prog-text"><span>🏗️ ${t('upgradingLabel')} → ${upgradeLabel}</span><b>${Math.round((e.upgradeProgress ?? 0) * 100)}%</b></div>
             <div class="tf-prog-track"><div class="tf-prog-fill tf-level" style="width:${Math.min(100, Math.round((e.upgradeProgress ?? 0) * 100))}%"></div></div>
           </div>`
        : '';
      const maxGarrison = this.world.getMaxGarrisonCapacity(e);
      let beaconMeta = '';
      if (tpl.isBeaconTower && !e.isFoundation) {
        const lv = e.beaconLevel ?? 1;
        const stats = World.getBeaconStats(lv);
        const soldiers = this.world.getBeaconGarrisonSoldiers(e);
        const fillRatio = Math.min(1, e.garrisonedIds.length / Math.max(5, maxGarrison));
        const dmgRed = e.garrisonedIds.length > 0 ? Math.round(Math.min(0.65, Math.max(e.garrisonedIds.length * 0.11, fillRatio * 0.65)) * 100) : 0;
        const litNote = (e.beaconLitTimer ?? 0) > 0 ? ` • 🔥 ${Math.ceil(e.beaconLitTimer!)}s` : '';
        beaconMeta = ` • Lv.${lv} (${stats.relayRange}m) • ${soldiers.length > 0 ? `✅ ${t('beaconActiveLabel')}` : `⚠️ ${t('beaconInactiveLabel')}`}${dmgRed > 0 ? ` • 🛡️-${dmgRed}%` : ''}${litNote}`;
      }
      let garrisonRosterHtml = '';
      if (e.owner === this.humanPlayerId && e.garrisonedIds.length > 0) {
        const chips = e.garrisonedIds
          .map((uid) => {
            const gu = this.world.entities.get(uid);
            if (!gu || !gu.alive) return '';
            const gTpl = TEMPLATES[gu.templateId];
            const gText = getTemplateText(gu.templateId);
            const gPct = Math.round((gu.hp / Math.max(1, gu.maxHp)) * 100);
            const wBadge = gTpl.attack?.isRanged ? '🏹' : gTpl.attack ? '⚔️' : '🛠️';
            return `
              <button class="unit-chip garrison-chip" data-ungarrison-id="${gu.id}" title="${gText.name} (${Math.ceil(gu.hp)}/${gu.maxHp}) — ${t('clickToUngarrisonTip')}">
                <span class="chip-icon">${renderEntityIcon(gu.templateId, ownerP?.civ, 'chip-icon-img', gTpl.icon)}</span>
                <span class="garrison-wbadge">${wBadge}</span>
                <span class="chip-hp"><span style="width:${gPct}%"></span></span>
              </button>
            `;
          })
          .join('');
        garrisonRosterHtml = `
          <div class="garrison-roster">
            <div class="garrison-roster-label">${t('garrisonRosterTitle')}</div>
            <div class="garrison-roster-grid">${chips}</div>
          </div>
        `;
      }
      extraHtml = `
        <div class="sel-meta">${statusText}${tpl.isFarmField ? ` • ${t('resFood')}: ${Math.ceil(e.resourceRemaining)}` : ''}${beaconMeta}</div>
        <div class="sel-stats">🛡️ ${t('hack')} ${armor.hack} • ${t('pierce')} ${armor.pierce} • ${t('crush')} ${armor.crush}${
          maxGarrison > 0 ? ` • 🏰 ${t('garrison')} ${e.garrisonedIds.length}/${maxGarrison}` : ''
        }</div>
        ${upgradeBarHtml}
        ${garrisonRosterHtml}
      `;
      if (e.queue.length > 0 && e.owner === this.humanPlayerId) {
        const cur = e.queue[0];
        const pct = Math.min(100, Math.round((cur.progress / cur.totalTime) * 100));
        const curName = cur.kind === 'unit' ? getTemplateText(cur.id).shortName : getTechText(cur.id).name;
        extraHtml += `
          <div class="queue-row">
            <span class="queue-label">${curName} (${pct}%)</span>
            <div class="queue-items">
              ${e.queue
                .map((q, idx) => {
                  const iconHtml =
                    q.kind === 'unit'
                      ? renderEntityIcon(q.id, ownerP?.civ, 'queue-chip-img', TEMPLATES[q.id].icon)
                      : renderTechIcon(q.id, 'queue-chip-img', TECHS[q.id].icon);
                  return `<button class="queue-chip" data-cancel-idx="${idx}" title="${t('cancelTip')}">${iconHtml}</button>`;
                })
                .join('')}
            </div>
          </div>
        `;
      }
    } else {
      const carryText =
        e.carryAmount > 0 && e.carryType ? ` • ${t('carrying')} ${Math.floor(e.carryAmount)} ${getResourceName(e.carryType)}` : '';
      let terraformHtml = '';
      if (e.order.type === 'terraform') {
        const ord = e.order;
        const isLevel = ord.mode === 'level';
        const isRaiseHaul = ord.mode === 'raise';
        const dug = SOIL_UNITS_PER_TILE - this.world.terrain.getSoilUnits(ord.tileX, ord.tileZ);
        const filled = this.world.terrain.getFillUnits(ord.destTileX, ord.destTileZ);
        const curVal = isRaiseHaul ? filled : dug;
        const pct = Math.min(100, Math.round((curVal / SOIL_UNITS_PER_TILE) * 100));
        const label = isLevel ? t('levelProgressLabel') : isRaiseHaul ? t('fillProgressLabel') : t('digProgressLabel');
        const fillClass = isLevel ? 'tf-level' : isRaiseHaul ? 'tf-raise' : 'tf-dig';
        const haulingNote = ord.stage === 'dump' ? ` • ${t('carryingSoilLabel')}` : '';
        const depthMeters = (curVal * 0.01).toFixed(2);
        terraformHtml = `
          <div class="terraform-progress-row">
            <div class="tf-prog-text"><span>${label}${haulingNote}</span><b>${depthMeters}m / 1.00m (${pct}%)</b></div>
            <div class="tf-prog-track"><div class="tf-prog-fill ${fillClass}" style="width:${pct}%"></div></div>
          </div>
        `;
      }
      extraHtml = `
        <div class="sel-meta">${tpl.isCitizenSoldier ? `${t('rank')}: <b>${rankLabel}</b> (${Math.floor(e.xp)} XP)` : tplText.shortName}${carryText}</div>
        <div class="sel-stats">
          ⚔️ ${tpl.attack ? `${tpl.attack.hack || tpl.attack.pierce || tpl.attack.crush} ${t('dmg')}` : '—'} •
          🛡️ ${t('hack')}:${armor.hack} ${t('pierce')}:${armor.pierce} ${t('crush')}:${armor.crush} •
          ${t('orderLabel')}: <b>${getOrderName(e.order.type)}</b>
        </div>
        ${terraformHtml}
      `;
    }

    this.elSelectionPanel.innerHTML = `
      <div class="sel-single">
        <div class="sel-portrait ${isSlainPrey ? 'portrait-slain' : ''}" style="border-color:${isSlainPrey ? '#dc2626' : ownerP?.cssColor ?? '#d4a64a'}">
          ${renderEntityIcon(e.templateId, ownerP?.civ, 'sel-portrait-img', tpl.icon)}
          ${isSlainPrey ? `<span class="slain-badge">${t('slainBadge')}</span>` : ''}
        </div>
        <div class="sel-info">
          <div class="sel-header">
            <span class="sel-name">${displayName}</span>
            <span class="sel-owner" style="color:${ownerP?.cssColor ?? '#cbd5e1'}">${this.formatPlayerLabel(e.owner)}</span>
          </div>
          ${
            tpl.kind !== 'resource'
              ? `<div class="hp-bar-wrap"><div class="hp-bar-fill" style="width:${hpPct}%"></div><span>${Math.ceil(e.hp)} / ${e.maxHp}</span></div>`
              : ''
          }
          ${extraHtml}
        </div>
      </div>
    `;

    // Wire queue cancel buttons & clickable individual garrison exit buttons
    this.elSelectionPanel.querySelectorAll<HTMLButtonElement>('[data-cancel-idx]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const idx = parseInt(btn.dataset.cancelIdx!, 10);
        this.world.enqueueCommand({
          type: 'cancel_train',
          playerId: this.humanPlayerId,
          buildingId: e.id,
          index: idx,
        });
      });
    });
    this.elSelectionPanel.querySelectorAll<HTMLButtonElement>('[data-ungarrison-id]').forEach((btn) => {
      btn.addEventListener('click', (ev) => {
        ev.stopPropagation();
        const uid = parseInt(btn.dataset.ungarrisonId!, 10);
        this.world.enqueueCommand({
          type: 'ungarrison_one',
          playerId: this.humanPlayerId,
          buildingId: e.id,
          unitId: uid,
        });
        this.lastCommandSig = '';
        this.renderSelectionAndCommands();
      });
    });
  }

  private renderMultiSelection(selected: Entity[]): void {
    const shown = selected.slice(0, 18);
    this.elSelectionPanel.innerHTML = `
      <div class="sel-multi-header">${t('selectedUnits')} <b>${selected.length}</b> ${t('unitsWord')}</div>
      <div class="sel-multi-grid">
        ${shown
          .map((e) => {
            const tpl = TEMPLATES[e.templateId];
            const tplText = getTemplateText(e.templateId);
            const ownerP = this.world.players.get(e.owner);
            const pct = Math.round((e.hp / Math.max(1, e.maxHp)) * 100);
            return `
              <button class="unit-chip" data-focus-id="${e.id}" title="${tplText.name}">
                <span class="chip-icon">${renderEntityIcon(e.templateId, ownerP?.civ, 'chip-icon-img', tpl.icon)}</span>
                <span class="chip-hp"><span style="width:${pct}%"></span></span>
              </button>
            `;
          })
          .join('')}
      </div>
    `;

    this.elSelectionPanel.querySelectorAll<HTMLButtonElement>('[data-focus-id]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const id = parseInt(btn.dataset.focusId!, 10);
        this.input.selectedIds.clear();
        this.input.selectedIds.add(id);
        this.renderSelectionAndCommands();
      });
    });
  }

  private renderCommandGrid(selected: Entity[]): void {
    const owned = selected.filter((e) => e.owner === this.humanPlayerId);
    const p = this.world.players.get(this.humanPlayerId)!;
    const civ = CIVS[p.civ];

    if (owned.length === 0) {
      this.elCommandPanel.classList.add('hidden');
      this.lastCommandSig = `enemy_${selected[0].owner === 0 ? 'res' : 'foe'}_${getLanguage()}`;
      return;
    }
    this.elCommandPanel.classList.remove('hidden');

    const units = owned.filter((e) => TEMPLATES[e.templateId].kind === 'unit');
    const first = owned[0];
    const firstTpl = TEMPLATES[first.templateId];

    // Structural signature ONLY — never nuke innerHTML when resources/active state change so clicks on build buttons are NEVER dropped!
    const uniqueTplIds = Array.from(new Set(owned.map((e) => e.templateId))).sort();
    const anyTerraforming = units.some((u) => u.order.type === 'terraform');
    const sig = JSON.stringify({
      lang: getLanguage(),
      tpls: uniqueTplIds,
      bId: units.length === 0 ? first.id : 0,
      bCnt: units.length === 0 ? owned.length : 0,
      isF: first.isFoundation,
      bProg: first.isFoundation ? Math.round(first.buildProgress * 100) : -1,
      floors: first.floors ?? 1,
      bLv: first.beaconLevel ?? 0,
      bLit: (first.beaconLitTimer ?? 0) > 0 ? 1 : 0,
      gMode: first.gateMode ?? '',
      tfAct: anyTerraforming ? 1 : 0,
      upTgt: first.upgradeTargetTemplateId ?? '',
      upProg: first.upgradeTargetTemplateId ? Math.floor((first.upgradeProgress ?? 0) * 20) : -1,
      garr: first.garrisonedIds.length,
      phase: p.phase,
      techs: Array.from(p.researchedTechs),
      rTechs: Array.from(p.researchingTechs),
    });
    if (sig === this.lastCommandSig) {
      this.syncCommandPanelLiveStates(p, units, first);
      return;
    }
    this.lastCommandSig = sig;

    // 1. Units selected -> Build menu + Stances + Actions
    if (units.length > 0) {
      const blocked = new Set(civ.blockedBuildings ?? []);
      const buildSet = new Set<string>();
      for (const u of units) {
        TEMPLATES[u.templateId].canBuild?.forEach((b) => {
          if (blocked.has(b)) return;
          const bTpl = TEMPLATES[b];
          if (!bTpl) return;
          if (bTpl.civ && bTpl.civ !== p.civ) return;
          // Hide tech-gated structures (like Multi-Story Apartments) until city + House tech upgrade are completed!
          if (bTpl.requiresTech && (!p.researchedTechs.has(bTpl.requiresTech) || (bTpl.phaseRequired ?? 1) > p.phase)) {
            return;
          }
          buildSet.add(b);
        });
      }
      const buildButtons = Array.from(buildSet)
        .map((bId) => {
          const bTpl = TEMPLATES[bId];
          const bText = getTemplateText(bId);
          const locked = (bTpl.phaseRequired ?? 1) > p.phase;
          const afford = !bTpl.cost || this.world.canAfford(p.resources, bTpl.cost);
          const active = this.input.placementTemplateId === bId;
          const isUnique = Boolean(bTpl.isUniqueBuilding);
          return `
            <button class="cmd-btn ${isUnique ? 'unique-btn' : ''} ${locked || !afford ? 'disabled' : ''} ${active ? 'active' : ''}"
              data-build-id="${bId}"
              title="${bText.name}: ${bText.description}\n${t('costLabel')}: ${formatLocalizedCost(bTpl.cost)}${locked ? `\n${t('requiresTownPhase')}` : ''}">
              <span class="cmd-icon">${renderEntityIcon(bId, p.civ, 'cmd-icon-img', bTpl.icon)}</span>
              <span class="cmd-name">${isUnique ? '★ ' : ''}${bText.shortName}</span>
              <span class="cmd-cost">${formatShortCost(bTpl.cost)}</span>
            </button>
          `;
        })
        .join('');

      const curStance = units[0].stance;
      const stances: UnitStance[] = ['aggressive', 'defensive', 'stand_ground', 'passive'];
      const hasLandWorker = units.some((u) => {
        const uTpl = TEMPLATES[u.templateId];
        return Boolean(uTpl.gather && !uTpl.isNaval);
      });
      const digActive = this.input.terraformMode === 'dig';
      const raiseActive = this.input.terraformMode === 'raise';
      const levelActive = this.input.terraformMode === 'level';

      const isTraderOnly = units.every((u) => TEMPLATES[u.templateId]?.isTrader);
      this.elCommandPanel.innerHTML = `
        <div class="cmd-grid">${buildButtons || `<div class="empty-cmd">${isTraderOnly ? t('traderHint') : t('noBuildChamp')}</div>`}</div>
        <div class="cmd-footer-row">
          <div class="stance-row">
            ${stances
              .map(
                (st) =>
                  `<button class="mini-btn ${curStance === st ? 'active' : ''}" data-stance="${st}">${getStanceLabel(st)}</button>`
              )
              .join('')}
          </div>
          <div class="action-row">
            ${
              hasLandWorker
                ? `<button class="mini-btn" id="cmd-shore-fish" title="${t('shoreFishTip')}">${t('shoreFishBtn')}</button>
                   <button class="mini-btn terraform-btn ${digActive ? 'active' : ''}" id="cmd-dig" title="${t('digTip')}">${t('digBtn')}</button>
                   <button class="mini-btn terraform-btn ${raiseActive ? 'active' : ''}" id="cmd-raise" title="${t('raiseTip')}">${t('raiseBtn')}</button>
                   <button class="mini-btn terraform-btn ${levelActive ? 'active' : ''}" id="cmd-level" title="${t('levelTip')}">${t('levelBtn')}</button>
                   ${anyTerraforming ? `<button class="mini-btn danger-btn" id="cmd-cancel-terraform" title="${t('cancelTerraformTip')}">${t('cancelTerraformBtn')}</button>` : ''}`
                : ''
            }
            <button class="mini-btn" id="cmd-attack-move" title="${t('attackMoveTip')}">${t('attackMoveBtn')}</button>
            <button class="mini-btn" id="cmd-garrison" title="${t('garrisonTip')}">${t('garrisonBtn')}</button>
          </div>
        </div>
      `;

      this.elCommandPanel.querySelectorAll<HTMLButtonElement>('[data-build-id]').forEach((btn) => {
        btn.addEventListener('mousedown', (ev) => {
          ev.stopPropagation();
        });
        btn.addEventListener('click', (ev) => {
          ev.stopPropagation();
          const bId = btn.dataset.buildId!;
          const bTpl = TEMPLATES[bId];
          if ((bTpl.phaseRequired ?? 1) > p.phase) {
            this.pushToast(t('requiresTownToast'), 'warn');
            return;
          }
          if (bTpl.cost && !this.world.canAfford(p.resources, bTpl.cost)) {
            this.pushToast(`${t('needPrefix')} ${formatLocalizedCost(bTpl.cost)}`, 'warn');
            return;
          }
          this.input.setPlacementMode(this.input.placementTemplateId === bId ? null : bId);
          btn.blur();
          this.syncCommandPanelLiveStates(p, units, first);
        });
      });

      this.elCommandPanel.querySelectorAll<HTMLButtonElement>('[data-stance]').forEach((btn) => {
        btn.addEventListener('click', (ev) => {
          ev.stopPropagation();
          const st = btn.dataset.stance as UnitStance;
          const liveUnitIds: number[] = [];
          for (const id of this.input.selectedIds) {
            const e = this.world.entities.get(id);
            if (e && e.alive && e.owner === this.humanPlayerId && TEMPLATES[e.templateId].kind === 'unit') {
              liveUnitIds.push(id);
            }
          }
          if (liveUnitIds.length > 0) {
            this.world.enqueueCommand({
              type: 'set_stance',
              playerId: this.humanPlayerId,
              entityIds: liveUnitIds,
              stance: st,
            });
          }
          this.syncCommandPanelLiveStates(p, units, first);
        });
      });

      document.getElementById('cmd-shore-fish')?.addEventListener('click', (ev) => {
        ev.stopPropagation();
        const landWorkers: Entity[] = [];
        for (const id of this.input.selectedIds) {
          const e = this.world.entities.get(id);
          if (e && e.alive && e.owner === this.humanPlayerId) {
            const ut = TEMPLATES[e.templateId];
            if (ut.gather && !ut.isNaval) landWorkers.push(e);
          }
        }
        if (landWorkers.length === 0) return;
        const fish = this.world.findNearestShoreFish(landWorkers[0].x, landWorkers[0].z, 120);
        if (!fish) {
          this.pushToast(t('toastNoShoreFishNearby'), 'warn');
          return;
        }
        this.world.enqueueCommand({
          type: 'gather',
          playerId: this.humanPlayerId,
          entityIds: landWorkers.map((w) => w.id),
          targetId: fish.id,
        });
        this.pushToast(t('toastShoreFishStart'), 'good', { x: fish.x, z: fish.z });
      });
      document.getElementById('cmd-dig')?.addEventListener('click', (ev) => {
        ev.stopPropagation();
        this.input.setTerraformMode(this.input.terraformMode === 'dig' ? null : 'dig');
        this.syncCommandPanelLiveStates(p, units, first);
      });
      document.getElementById('cmd-raise')?.addEventListener('click', (ev) => {
        ev.stopPropagation();
        this.input.setTerraformMode(this.input.terraformMode === 'raise' ? null : 'raise');
        this.syncCommandPanelLiveStates(p, units, first);
      });
      document.getElementById('cmd-level')?.addEventListener('click', (ev) => {
        ev.stopPropagation();
        this.input.setTerraformMode(this.input.terraformMode === 'level' ? null : 'level');
        this.syncCommandPanelLiveStates(p, units, first);
      });
      document.getElementById('cmd-cancel-terraform')?.addEventListener('click', (ev) => {
        ev.stopPropagation();
        const workerIds: number[] = [];
        for (const id of this.input.selectedIds) {
          const e = this.world.entities.get(id);
          if (e && e.alive && e.owner === this.humanPlayerId && e.order.type === 'terraform') {
            workerIds.push(id);
          }
        }
        if (workerIds.length > 0) {
          this.world.enqueueCommand({
            type: 'cancel_terraform',
            playerId: this.humanPlayerId,
            entityIds: workerIds,
          });
          this.pushToast(t('toastTerraformCancelled'), 'info');
          this.lastCommandSig = '';
          this.renderSelectionAndCommands();
        }
      });
      document.getElementById('cmd-attack-move')?.addEventListener('click', (ev) => {
        ev.stopPropagation();
        this.input.setTerraformMode(null);
        this.input.attackMoveMode = true;
        this.pushToast(t('toastAttackMove'), 'info');
      });
      document.getElementById('cmd-garrison')?.addEventListener('click', (ev) => {
        ev.stopPropagation();
        this.input.setTerraformMode(null);
        this.input.garrisonTargetMode = true;
        this.pushToast(t('toastGarrison'), 'info');
      });
      this.syncCommandPanelLiveStates(p, units, first);
      return;
    }

    // 2. Building selected -> Train units + Research Techs + Ungarrison + Demolish & Salvage
    const ownedBuildingIds = owned.filter((e) => TEMPLATES[e.templateId].kind === 'building').map((e) => e.id);
    const salvageRatio = first.isFoundation ? 0.75 : 0.6 * Math.max(0.25, first.hp / Math.max(1, first.maxHp));
    const estRefund: ResourceBag | undefined = firstTpl.cost
      ? {
          food: Math.round(firstTpl.cost.food * salvageRatio),
          wood: Math.round(firstTpl.cost.wood * salvageRatio),
          stone: Math.round(firstTpl.cost.stone * salvageRatio),
          metal: Math.round(firstTpl.cost.metal * salvageRatio),
        }
      : undefined;
    const demolishBtn =
      ownedBuildingIds.length > 0
        ? `<button class="mini-btn danger-btn" id="cmd-demolish" title="${t('demolishTip')}${estRefund ? `\n+${formatLocalizedCost(estRefund)}` : ''}">${t('demolishBtn')}</button>`
        : '';

    const wireDemolish = () => {
      document.getElementById('cmd-demolish')?.addEventListener('click', () => {
        this.world.enqueueCommand({
          type: 'demolish',
          playerId: this.humanPlayerId,
          entityIds: ownedBuildingIds,
        });
        for (const id of ownedBuildingIds) this.input.selectedIds.delete(id);
        this.lastCommandSig = '';
        this.renderSelectionAndCommands();
      });
    };

    if (first.isFoundation) {
      const tunnelDetail =
        firstTpl.isTunnel && first.tunnelTotalUnits
          ? ` (${Math.floor(first.tunnelDugUnits ?? 0)} / ${first.tunnelTotalUnits} 土方 • ${first.tunnelLengthTiles ?? 0} 格 • ${t('tunnelXrayHint')})`
          : '';
      this.elCommandPanel.innerHTML = `
        <div class="empty-cmd">${t('underConstruction')} (${Math.round(first.buildProgress * 100)}%)${tunnelDetail}. ${t('sendCitizens')}</div>
        <div class="cmd-footer-row">
          <span class="rally-hint">${firstTpl.isTunnel ? t('tunnelXrayHint') : ''}</span>
          <div class="action-row">${demolishBtn}</div>
        </div>
      `;
      wireDemolish();
      return;
    }

    const trainBtns = (firstTpl.trains ?? [])
      .map((uKey) => resolveUnitTemplateId(civ.units, uKey))
      .filter((uId, idx, arr) => {
        if (arr.indexOf(uId) !== idx) return false;
        const uTpl = TEMPLATES[uId];
        if (!uTpl) return false;
        if (uTpl.civ && uTpl.civ !== p.civ) return false;
        if (uTpl.allowedCivs && !uTpl.allowedCivs.includes(p.civ)) return false;
        return true;
      })
      .map((uId) => {
        const uTpl = TEMPLATES[uId];
        const uText = getTemplateText(uId);
        const locked = (uTpl.phaseRequired ?? 1) > p.phase;
        const afford = !uTpl.cost || this.world.canAfford(p.resources, uTpl.cost);
        const isSpecial = uId === civ.units.special;
        return `
          <button class="cmd-btn ${isSpecial ? 'unique-btn' : ''} ${locked || !afford ? 'disabled' : ''}" data-train-id="${uId}"
            title="${uText.name}: ${uText.description}\n${t('costLabel')}: ${formatLocalizedCost(uTpl.cost)} • ${t('popLabel')}: ${uTpl.popCost ?? 1}">
            <span class="cmd-icon">${renderEntityIcon(uId, p.civ, 'cmd-icon-img', uTpl.icon)}</span>
            <span class="cmd-name">${isSpecial ? '★ ' : ''}${uText.shortName}</span>
            <span class="cmd-cost">${formatShortCost(uTpl.cost)}</span>
          </button>
        `;
      })
      .join('');

    const techBtns = (firstTpl.researches ?? [])
      .filter((tId) => {
        const tech = TECHS[tId];
        return Boolean(tech && (!tech.civ || tech.civ === p.civ));
      })
      .map((tId) => {
        const tech = TECHS[tId];
        const techText = getTechText(tId);
        const done = p.researchedTechs.has(tId);
        const inProg = p.researchingTechs.has(tId);
        const locked = tech.phaseRequired > p.phase;
        const afford = this.world.canAfford(p.resources, tech.cost);
        const isCivTech = Boolean(tech.civ);
        if (done) {
          return `
            <button class="cmd-btn researched ${isCivTech ? 'unique-btn' : ''}" disabled title="${techText.name}: ${techText.description}\n(${t('done')})">
              <span class="cmd-icon researched-icon">
                ${renderTechIcon(tId, 'cmd-icon-img', tech.icon)}
                <span class="tech-done-badge" aria-hidden="true">✓</span>
              </span>
              <span class="cmd-name">${isCivTech ? '★ ' : ''}${techText.name}</span>
              <span class="cmd-cost researched-tag">${t('done')}</span>
            </button>
          `;
        }
        return `
          <button class="cmd-btn tech-btn ${isCivTech ? 'unique-btn' : ''} ${locked || !afford || inProg ? 'disabled' : ''}" data-tech-id="${tId}"
            title="${techText.name}: ${techText.description}\n${t('costLabel')}: ${formatLocalizedCost(tech.cost)}">
            <span class="cmd-icon">${renderTechIcon(tId, 'cmd-icon-img', tech.icon)}</span>
            <span class="cmd-name">${isCivTech ? '★ ' : ''}${techText.name}</span>
            <span class="cmd-cost">${inProg ? t('working') : formatShortCost(tech.cost)}</span>
          </button>
        `;
      })
      .join('');

    const ungarrisonBtn =
      first.garrisonedIds.length > 0
        ? `<button class="mini-btn active" id="cmd-ungarrison">${t('ungarrisonAll')} (${first.garrisonedIds.length})</button>`
        : '';

    // Building upgrade & special fortification controls (Apartments, Wall <-> 3-Seg Gate, Gate Modes, 3-Level Beacon Towers!)
    let upgradeBtnHtml = '';
    let gateModeRowHtml = '';
    if (first.upgradeTargetTemplateId) {
      const pct = Math.min(100, Math.round((first.upgradeProgress ?? 0) * 100));
      const iconId = first.upgradeTargetTemplateId;
      upgradeBtnHtml = `
        <button class="cmd-btn tech-btn disabled" disabled>
          <span class="cmd-icon">${renderEntityIcon(iconId, p.civ, 'cmd-icon-img', TEMPLATES[iconId]?.icon ?? '🏗️')}</span>
          <span class="cmd-name">🏗️ ${t('upgradingLabel')} (${pct}%)</span>
          <span class="cmd-cost">${t('working')}</span>
        </button>
      `;
    } else if (first.templateId === 'stone_wall') {
      const hasNeighbors = this.world.findGateUpgradeNeighbors(first) !== null;
      const gateCost = World.UPGRADE_WALL_TO_GATE_COST;
      const affordGate = this.world.canAfford(p.resources, gateCost);
      const beaconCost = World.UPGRADE_WALL_TO_BEACON_COST;
      const affordBeacon = this.world.canAfford(p.resources, beaconCost);
      const linkedBusy = Boolean(first.upgradeLinkedIds && first.upgradeLinkedIds.length > 0);
      upgradeBtnHtml = `
        <button class="cmd-btn tech-btn ${!hasNeighbors || !affordGate ? 'disabled' : ''}" data-wall-upgrade="gate"
          title="${hasNeighbors ? t('upgradeWallToGateTip') : t('wallEdgeCannotGate')}\n${t('costLabel')}: ${formatLocalizedCost(gateCost)}">
          <span class="cmd-icon">${renderEntityIcon('stone_gate', p.civ, 'cmd-icon-img', '🚪')}</span>
          <span class="cmd-name">${t('upgradeWallToGateBtn')}</span>
          <span class="cmd-cost">${formatShortCost(gateCost)}</span>
        </button>
        <button class="cmd-btn tech-btn ${linkedBusy || !affordBeacon ? 'disabled' : ''}" data-wall-upgrade="beacon"
          title="${t('upgradeWallToBeaconTip')}\n${t('costLabel')}: ${formatLocalizedCost(beaconCost)}">
          <span class="cmd-icon">${renderEntityIcon('beacon_tower', p.civ, 'cmd-icon-img', '🔥')}</span>
          <span class="cmd-name">${t('upgradeWallToBeaconBtn')}</span>
          <span class="cmd-cost">${formatShortCost(beaconCost)}</span>
        </button>
      `;
    } else if (first.templateId === 'stone_gate') {
      const wallCost = World.CONVERT_GATE_TO_WALL_COST;
      const affordWall = this.world.canAfford(p.resources, wallCost);
      const curMode: GateMode = first.gateMode ?? 'auto';
      upgradeBtnHtml = `
        <button class="cmd-btn tech-btn ${!affordWall ? 'disabled' : ''}" data-wall-upgrade="wall"
          title="${t('convertGateToWallTip')}\n${t('costLabel')}: ${formatLocalizedCost(wallCost)}">
          <span class="cmd-icon">${renderEntityIcon('stone_wall', p.civ, 'cmd-icon-img', '🧱')}</span>
          <span class="cmd-name">${t('convertGateToWallBtn')}</span>
          <span class="cmd-cost">${formatShortCost(wallCost)}</span>
        </button>
      `;
      gateModeRowHtml = `
        <div class="stance-row">
          <button class="mini-btn ${curMode === 'auto' ? 'active' : ''}" data-gate-mode="auto">${t('gateModeAuto')}</button>
          <button class="mini-btn ${curMode === 'open' ? 'active' : ''}" data-gate-mode="open">${t('gateModeOpen')}</button>
          <button class="mini-btn ${curMode === 'locked' ? 'active' : ''}" data-gate-mode="locked">${t('gateModeLocked')}</button>
        </div>
      `;
    } else if (firstTpl.isBeaconTower) {
      const lv = first.beaconLevel ?? 1;
      const maxCap = this.world.getMaxGarrisonCapacity(first);
      const soldiers = this.world.getBeaconGarrisonSoldiers(first);
      const hasSoldiers = soldiers.length > 0;
      const lit = (first.beaconLitTimer ?? 0) > 0;
      const igniteBtn = `
        <button class="cmd-btn unique-btn ${!hasSoldiers ? 'disabled' : ''} ${lit ? 'active' : ''}" id="cmd-ignite-beacon"
          title="${hasSoldiers ? t('igniteBeaconTip') : `${t('disabledReasonPrefix')} ${t('beaconNeedsSoldiers')}`}">
          <span class="cmd-icon">🔥</span>
          <span class="cmd-name">${t('igniteBeaconBtn')}</span>
          <span class="cmd-cost">${lit ? `${Math.ceil(first.beaconLitTimer!)}s` : `${soldiers.length}/${maxCap}`}</span>
        </button>
      `;
      const extinguishBtn = lit
        ? `
          <button class="cmd-btn tech-btn" id="cmd-extinguish-beacon" title="${t('extinguishBeaconTip')}">
            <span class="cmd-icon">💧</span>
            <span class="cmd-name">${t('extinguishBeaconBtn')}</span>
            <span class="cmd-cost">${Math.ceil(first.beaconLitTimer!)}s</span>
          </button>
        `
        : '';
      let tierUpBtn = '';
      if (lv < 3) {
        const upCost = lv === 1 ? World.UPGRADE_BEACON_LV2_COST : World.UPGRADE_BEACON_LV3_COST;
        const affordUp = this.world.canAfford(p.resources, upCost);
        const missingReason = !affordUp ? `\n${t('disabledReasonPrefix')} ${formatMissingResources(p.resources, upCost)}` : '';
        tierUpBtn = `
          <button class="cmd-btn tech-btn ${!affordUp ? 'disabled' : ''}" data-wall-upgrade="beacon"
            title="${lv === 1 ? t('upgradeBeaconLv2Tip') : t('upgradeBeaconLv3Tip')}\n${t('costLabel')}: ${formatLocalizedCost(upCost)}${missingReason}">
            <span class="cmd-icon">${renderEntityIcon('beacon_tower', p.civ, 'cmd-icon-img', '🔥')}</span>
            <span class="cmd-name">${lv === 1 ? t('upgradeBeaconLv2Btn') : t('upgradeBeaconLv3Btn')}</span>
            <span class="cmd-cost">${formatShortCost(upCost)}</span>
          </button>
        `;
      } else {
        tierUpBtn = `
          <button class="cmd-btn researched" disabled title="${t('beaconMaxLevel')}">
            <span class="cmd-icon researched-icon">${renderEntityIcon('beacon_tower', p.civ, 'cmd-icon-img', '🔥')}<span class="tech-done-badge" aria-hidden="true">✓</span></span>
            <span class="cmd-name">${t('beaconMaxLevel')}</span>
            <span class="cmd-cost researched-tag">Lv.3</span>
          </button>
        `;
      }
      upgradeBtnHtml = igniteBtn + extinguishBtn + tierUpBtn;
    } else if (first.templateId === 'house' && p.phase >= 2 && p.researchedTechs.has('tech_multistory_housing')) {
      const upCost = World.UPGRADE_HOUSE_COST;
      const canAffordUp = this.world.canAfford(p.resources, upCost);
      upgradeBtnHtml = `
        <button class="cmd-btn tech-btn ${!canAffordUp ? 'disabled' : ''}" id="cmd-upgrade-building"
          title="${t('upgradeToApartmentTip')}\n${t('costLabel')}: ${formatLocalizedCost(upCost)}">
          <span class="cmd-icon">${renderEntityIcon('apartment_house', p.civ, 'cmd-icon-img', '🏢')}</span>
          <span class="cmd-name">${t('upgradeToApartmentBtn')}</span>
          <span class="cmd-cost">${formatShortCost(upCost)}</span>
        </button>
      `;
    } else if (firstTpl.isApartment) {
      const curFloors = first.floors ?? 2;
      const maxFloors = firstTpl.maxFloors ?? 3;
      if (curFloors < maxFloors) {
        const upCost = World.UPGRADE_FLOOR3_COST;
        const lockedCity = p.phase < 3;
        const canAffordUp = this.world.canAfford(p.resources, upCost);
        upgradeBtnHtml = `
          <button class="cmd-btn tech-btn ${lockedCity || !canAffordUp ? 'disabled' : ''}" id="cmd-upgrade-building"
            title="${t('upgradeFloor3Tip')}\n${t('costLabel')}: ${formatLocalizedCost(upCost)}">
            <span class="cmd-icon">${renderEntityIcon('apartment_house', p.civ, 'cmd-icon-img', '🏢')}</span>
            <span class="cmd-name">${t('upgradeFloor3Btn')}</span>
            <span class="cmd-cost">${lockedCity ? 'Phase III' : formatShortCost(upCost)}</span>
          </button>
        `;
      } else {
        upgradeBtnHtml = `
          <button class="cmd-btn researched" disabled title="${t('apartmentMaxFloors')}">
            <span class="cmd-icon researched-icon">${renderEntityIcon('apartment_house', p.civ, 'cmd-icon-img', '🏢')}<span class="tech-done-badge" aria-hidden="true">✓</span></span>
            <span class="cmd-name">${t('apartmentMaxFloors')}</span>
            <span class="cmd-cost researched-tag">3F</span>
          </button>
        `;
      }
    }

    const tunnelHint = firstTpl.isTunnel
      ? first.linkedTunnelId
        ? `${t('tunnelLinked')} • ${t('tunnelXrayHint')}`
        : t('tunnelUnlinked')
      : firstTpl.isApartment
        ? `${first.floors ?? 2} / ${firstTpl.maxFloors ?? 3} 層`
        : firstTpl.isBeaconTower
          ? `Lv.${first.beaconLevel ?? 1} • 範圍 ${World.getBeaconStats(first.beaconLevel ?? 1).relayRange}m • 右鍵軍隊即可進駐`
          : '';
    const footerHint = tunnelHint || (firstTpl.trains ? t('rallyHint') : '');

    this.elCommandPanel.innerHTML = `
      <div class="cmd-grid">${trainBtns}${techBtns}${upgradeBtnHtml}${!trainBtns && !techBtns && !upgradeBtnHtml ? `<div class="empty-cmd">${tunnelHint || t('econDefStruct')}</div>` : ''}</div>
      <div class="cmd-footer-row">
        ${gateModeRowHtml || `<span class="rally-hint">${footerHint}</span>`}
        <div class="action-row">${ungarrisonBtn}${demolishBtn}</div>
      </div>
    `;
    wireDemolish();

    this.elCommandPanel.querySelectorAll<HTMLButtonElement>('[data-wall-upgrade]').forEach((btn) => {
      btn.addEventListener('click', (ev) => {
        ev.stopPropagation();
        const target = btn.dataset.wallUpgrade as 'gate' | 'wall' | 'beacon';
        if (target === 'gate' && first.templateId === 'stone_wall') {
          if (!this.world.findGateUpgradeNeighbors(first)) {
            this.pushToast(t('wallEdgeCannotGate'), 'warn');
            return;
          }
          if (!this.world.canAfford(p.resources, World.UPGRADE_WALL_TO_GATE_COST)) {
            this.pushToast(`${t('needPrefix')} ${formatLocalizedCost(World.UPGRADE_WALL_TO_GATE_COST)}`, 'warn');
            return;
          }
        } else if (target === 'wall' && first.templateId === 'stone_gate') {
          if (!this.world.canAfford(p.resources, World.CONVERT_GATE_TO_WALL_COST)) {
            this.pushToast(`${t('needPrefix')} ${formatLocalizedCost(World.CONVERT_GATE_TO_WALL_COST)}`, 'warn');
            return;
          }
        } else if (target === 'beacon') {
          const bCost =
            first.templateId === 'stone_wall'
              ? World.UPGRADE_WALL_TO_BEACON_COST
              : (first.beaconLevel ?? 1) === 1
                ? World.UPGRADE_BEACON_LV2_COST
                : World.UPGRADE_BEACON_LV3_COST;
          if (!this.world.canAfford(p.resources, bCost)) {
            this.pushToast(`${t('needPrefix')} ${formatLocalizedCost(bCost)}`, 'warn');
            return;
          }
        }
        this.world.enqueueCommand({
          type: 'upgrade_building',
          playerId: this.humanPlayerId,
          buildingId: first.id,
          target,
        });
        this.pushToast(t('toastUpgradeStarted'), 'info');
        this.lastCommandSig = '';
        this.renderSelectionAndCommands();
      });
    });

    this.elCommandPanel.querySelectorAll<HTMLButtonElement>('[data-gate-mode]').forEach((btn) => {
      btn.addEventListener('click', (ev) => {
        ev.stopPropagation();
        const mode = btn.dataset.gateMode as GateMode;
        this.world.enqueueCommand({
          type: 'set_gate_mode',
          playerId: this.humanPlayerId,
          buildingId: first.id,
          mode,
        });
        this.lastCommandSig = '';
        this.renderSelectionAndCommands();
      });
    });

    document.getElementById('cmd-ignite-beacon')?.addEventListener('click', (ev) => {
      ev.stopPropagation();
      if (this.world.getBeaconGarrisonSoldiers(first).length === 0) {
        this.pushToast(t('beaconNeedsSoldiers'), 'warn');
        return;
      }
      this.world.enqueueCommand({
        type: 'ignite_beacon',
        playerId: this.humanPlayerId,
        buildingId: first.id,
      });
      this.lastCommandSig = '';
      this.renderSelectionAndCommands();
    });

    document.getElementById('cmd-extinguish-beacon')?.addEventListener('click', (ev) => {
      ev.stopPropagation();
      this.world.enqueueCommand({
        type: 'extinguish_beacon',
        playerId: this.humanPlayerId,
        buildingId: first.id,
      });
      this.pushToast(t('beaconExtinguishedToast'), 'info');
      this.lastCommandSig = '';
      this.renderSelectionAndCommands();
    });

    document.getElementById('cmd-upgrade-building')?.addEventListener('click', () => {
      if (firstTpl.isApartment && p.phase < 3) {
        this.pushToast(t('requiresCityPhaseToast'), 'warn');
        return;
      }
      const neededCost = first.templateId === 'house' ? World.UPGRADE_HOUSE_COST : World.UPGRADE_FLOOR3_COST;
      if (!this.world.canAfford(p.resources, neededCost)) {
        this.pushToast(`${t('needPrefix')} ${formatLocalizedCost(neededCost)}`, 'warn');
        return;
      }
      this.world.enqueueCommand({
        type: 'upgrade_building',
        playerId: this.humanPlayerId,
        buildingId: first.id,
      });
      this.pushToast(t('toastUpgradeStarted'), 'info');
      this.lastCommandSig = '';
      this.renderSelectionAndCommands();
    });

    this.elCommandPanel.querySelectorAll<HTMLButtonElement>('[data-train-id]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const uId = btn.dataset.trainId!;
        const uTpl = TEMPLATES[uId];
        if ((uTpl.phaseRequired ?? 1) > p.phase) {
          this.pushToast(
            (uTpl.phaseRequired ?? 1) >= 3 ? t('requiresCityPhaseToast') : t('requiresTownToast'),
            'warn'
          );
          return;
        }
        if (uTpl.cost && !this.world.canAfford(p.resources, uTpl.cost)) {
          this.pushToast(`${t('disabledReasonPrefix')} ${formatMissingResources(p.resources, uTpl.cost)}`, 'warn');
          return;
        }
        if (p.popUsed + (uTpl.popCost ?? 1) > p.popCap) {
          this.pushToast(`${t('disabledReasonPrefix')} ${t('popCapFullReason')}`, 'warn');
          return;
        }
        this.world.enqueueCommand({
          type: 'train',
          playerId: this.humanPlayerId,
          buildingId: first.id,
          templateId: uId,
        });
        this.syncCommandPanelLiveStates(p, units, first);
      });
    });

    this.elCommandPanel.querySelectorAll<HTMLButtonElement>('[data-tech-id]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const tId = btn.dataset.techId!;
        const tech = TECHS[tId];
        if (p.researchingTechs.has(tId)) {
          this.pushToast(`${t('disabledReasonPrefix')} ${t('alreadyResearchingReason')}`, 'warn');
          return;
        }
        if (tech.phaseRequired > p.phase) {
          this.pushToast(tech.phaseRequired >= 3 ? t('requiresCityPhaseToast') : t('requiresTownToast'), 'warn');
          return;
        }
        if (!this.world.canAfford(p.resources, tech.cost)) {
          this.pushToast(`${t('disabledReasonPrefix')} ${formatMissingResources(p.resources, tech.cost)}`, 'warn');
          return;
        }
        this.world.enqueueCommand({
          type: 'research',
          playerId: this.humanPlayerId,
          buildingId: first.id,
          techId: tId,
        });
        this.lastCommandSig = '';
      });
    });

    document.getElementById('cmd-ungarrison')?.addEventListener('click', () => {
      this.world.enqueueCommand({
        type: 'ungarrison',
        playerId: this.humanPlayerId,
        buildingId: first.id,
      });
      this.lastCommandSig = '';
    });
    this.syncCommandPanelLiveStates(p, units, first);
  }

  /**
   * In-place class updates for build/train/tech/stance/terraform buttons so clicking
   * a build option NEVER loses its DOM node or scroll position during periodic resource ticks.
   */
  private syncCommandPanelLiveStates(p: PlayerState, units: Entity[], first: Entity): void {
    this.elCommandPanel.querySelectorAll<HTMLButtonElement>('[data-build-id]').forEach((btn) => {
      const bId = btn.dataset.buildId!;
      const bTpl = TEMPLATES[bId];
      if (!bTpl) return;
      const bText = getTemplateText(bId);
      const locked = (bTpl.phaseRequired ?? 1) > p.phase;
      const afford = !bTpl.cost || this.world.canAfford(p.resources, bTpl.cost);
      btn.classList.toggle('disabled', locked || !afford);
      btn.classList.toggle('active', this.input.placementTemplateId === bId);
      const reasons: string[] = [];
      if (locked) reasons.push((bTpl.phaseRequired ?? 1) >= 3 ? t('requiresCityPhaseToast') : t('requiresTownPhase'));
      if (!afford && bTpl.cost) reasons.push(formatMissingResources(p.resources, bTpl.cost));
      btn.title = `${bText.name}: ${bText.description}\n${t('costLabel')}: ${formatLocalizedCost(bTpl.cost)}${
        reasons.length > 0 ? `\n${t('disabledReasonPrefix')} ${reasons.join('；')}` : ''
      }`;
    });

    if (units.length > 0) {
      const curStance = units[0].stance;
      this.elCommandPanel.querySelectorAll<HTMLButtonElement>('[data-stance]').forEach((btn) => {
        btn.classList.toggle('active', btn.dataset.stance === curStance);
      });
      document.getElementById('cmd-dig')?.classList.toggle('active', this.input.terraformMode === 'dig');
      document.getElementById('cmd-raise')?.classList.toggle('active', this.input.terraformMode === 'raise');
      document.getElementById('cmd-level')?.classList.toggle('active', this.input.terraformMode === 'level');
      return;
    }

    this.elCommandPanel.querySelectorAll<HTMLButtonElement>('[data-train-id]').forEach((btn) => {
      const uId = btn.dataset.trainId!;
      const uTpl = TEMPLATES[uId];
      if (!uTpl) return;
      const uText = getTemplateText(uId);
      const locked = (uTpl.phaseRequired ?? 1) > p.phase;
      const afford = !uTpl.cost || this.world.canAfford(p.resources, uTpl.cost);
      const popFull = p.popUsed + (uTpl.popCost ?? 1) > p.popCap;
      btn.classList.toggle('disabled', locked || !afford || popFull);
      const reasons: string[] = [];
      if (locked) reasons.push((uTpl.phaseRequired ?? 1) >= 3 ? t('requiresCityPhaseToast') : t('requiresTownPhase'));
      if (!afford && uTpl.cost) reasons.push(formatMissingResources(p.resources, uTpl.cost));
      if (popFull) reasons.push(t('popCapFullReason'));
      btn.title = `${uText.name}: ${uText.description}\n${t('costLabel')}: ${formatLocalizedCost(uTpl.cost)} • ${t('popLabel')}: ${uTpl.popCost ?? 1}${
        reasons.length > 0 ? `\n${t('disabledReasonPrefix')} ${reasons.join('；')}` : ''
      }`;
    });

    this.elCommandPanel.querySelectorAll<HTMLButtonElement>('[data-tech-id]').forEach((btn) => {
      const tId = btn.dataset.techId!;
      const tech = TECHS[tId];
      if (!tech) return;
      const techText = getTechText(tId);
      const inProg = p.researchingTechs.has(tId);
      const locked = tech.phaseRequired > p.phase;
      const afford = this.world.canAfford(p.resources, tech.cost);
      btn.classList.toggle('disabled', locked || !afford || inProg);
      const reasons: string[] = [];
      if (inProg) reasons.push(t('alreadyResearchingReason'));
      if (locked) reasons.push(tech.phaseRequired >= 3 ? t('requiresCityPhaseToast') : t('requiresTownPhase'));
      if (!afford) reasons.push(formatMissingResources(p.resources, tech.cost));
      btn.title = `${techText.name}: ${techText.description}\n${t('costLabel')}: ${formatLocalizedCost(tech.cost)}${
        reasons.length > 0 ? `\n${t('disabledReasonPrefix')} ${reasons.join('；')}` : ''
      }`;
    });

    this.elCommandPanel.querySelectorAll<HTMLButtonElement>('[data-wall-upgrade]').forEach((btn) => {
      const target = btn.dataset.wallUpgrade as 'gate' | 'wall' | 'beacon';
      const reasons: string[] = [];
      let baseTip = '';
      let cost: ResourceBag | undefined;
      if (target === 'gate' && first.templateId === 'stone_wall') {
        baseTip = t('upgradeWallToGateTip');
        cost = World.UPGRADE_WALL_TO_GATE_COST;
        if (!this.world.findGateUpgradeNeighbors(first)) reasons.push(t('wallEdgeCannotGate'));
      } else if (target === 'wall' && first.templateId === 'stone_gate') {
        baseTip = t('convertGateToWallTip');
        cost = World.CONVERT_GATE_TO_WALL_COST;
      } else if (target === 'beacon') {
        baseTip =
          first.templateId === 'stone_wall'
            ? t('upgradeWallToBeaconTip')
            : (first.beaconLevel ?? 1) === 1
              ? t('upgradeBeaconLv2Tip')
              : t('upgradeBeaconLv3Tip');
        cost =
          first.templateId === 'stone_wall'
            ? World.UPGRADE_WALL_TO_BEACON_COST
            : (first.beaconLevel ?? 1) === 1
              ? World.UPGRADE_BEACON_LV2_COST
              : World.UPGRADE_BEACON_LV3_COST;
      }
      if (cost && !this.world.canAfford(p.resources, cost)) {
        reasons.push(formatMissingResources(p.resources, cost));
      }
      btn.classList.toggle('disabled', reasons.length > 0);
      btn.title = `${baseTip}${cost ? `\n${t('costLabel')}: ${formatLocalizedCost(cost)}` : ''}${
        reasons.length > 0 ? `\n${t('disabledReasonPrefix')} ${reasons.join('；')}` : ''
      }`;
    });

    const upgradeBtn = document.getElementById('cmd-upgrade-building');
    if (upgradeBtn && !first.upgradeTargetTemplateId) {
      const firstTpl = TEMPLATES[first.templateId];
      const lockedCity = Boolean(firstTpl?.isApartment) && p.phase < 3;
      const upCost = first.templateId === 'house' ? World.UPGRADE_HOUSE_COST : World.UPGRADE_FLOOR3_COST;
      const canAffordUp = this.world.canAfford(p.resources, upCost);
      upgradeBtn.classList.toggle('disabled', lockedCity || !canAffordUp);
      const reasons: string[] = [];
      if (lockedCity) reasons.push(t('requiresCityPhaseToast'));
      if (!canAffordUp) reasons.push(formatMissingResources(p.resources, upCost));
      upgradeBtn.title = `${first.templateId === 'house' ? t('upgradeToApartmentTip') : t('upgradeFloor3Tip')}\n${t('costLabel')}: ${formatLocalizedCost(upCost)}${
        reasons.length > 0 ? `\n${t('disabledReasonPrefix')} ${reasons.join('；')}` : ''
      }`;
    }
  }
}

function formatMissingResources(have: ResourceBag, need: ResourceBag): string {
  const parts: string[] = [];
  if (need.food > have.food) parts.push(`${getResourceName('food')} ${Math.ceil(need.food - have.food)}`);
  if (need.wood > have.wood) parts.push(`${getResourceName('wood')} ${Math.ceil(need.wood - have.wood)}`);
  if (need.stone > have.stone) parts.push(`${getResourceName('stone')} ${Math.ceil(need.stone - have.stone)}`);
  if (need.metal > have.metal) parts.push(`${getResourceName('metal')} ${Math.ceil(need.metal - have.metal)}`);
  return parts.length > 0 ? `${t('needPrefix')} ${parts.join('、')}` : '';
}

function renderEntityIcon(templateId: string, civId: CivId | undefined, cls: string, fallback: string): string {
  const src = getEntityPortrait(templateId, civId);
  if (!src) return fallback;
  return `<img class="${cls}" src="${src}" alt="${templateId}" draggable="false" />`;
}

function renderTechIcon(techId: string, cls: string, fallback: string): string {
  const src = TECH_PORTRAITS[techId];
  if (!src) return fallback;
  return `<img class="${cls}" src="${src}" alt="${techId}" draggable="false" />`;
}

function formatShortCost(cost?: ResourceBag): string {
  if (!cost) return '';
  const parts: string[] = [];
  if (cost.food > 0) parts.push(`<span class="cost-item"><img class="cost-icon-img" src="${UI_ICONS.food}" alt="F"/>${cost.food}</span>`);
  if (cost.wood > 0) parts.push(`<span class="cost-item"><img class="cost-icon-img" src="${UI_ICONS.wood}" alt="W"/>${cost.wood}</span>`);
  if (cost.stone > 0) parts.push(`<span class="cost-item"><img class="cost-icon-img" src="${UI_ICONS.stone}" alt="S"/>${cost.stone}</span>`);
  if (cost.metal > 0) parts.push(`<span class="cost-item"><img class="cost-icon-img" src="${UI_ICONS.metal}" alt="M"/>${cost.metal}</span>`);
  return parts.join(' ');
}
