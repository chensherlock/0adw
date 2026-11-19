import { getCivEmblem, getEntityPortrait, TECH_PORTRAITS, UI_ICONS } from '../config/assets';
import { CIVS } from '../config/civs';
import { resolveUnitTemplateId, TECHS, TEMPLATES } from '../config/entities';
import {
  formatLocalizedCost,
  getCivName,
  getLanguage,
  getOrderName,
  getResourceName,
  getStanceLabel,
  getTechText,
  getTemplateText,
  setLanguage,
  t,
} from '../config/i18n';
import { CivId, Difficulty, Entity, MapType, ResourceBag, UnitStance } from '../config/types';
import { InputController } from '../input/InputController';
import { World } from '../sim/World';

export interface HUDCallbacks {
  onStartMatch: (playerCiv: CivId, aiCiv: CivId, difficulty: Difficulty, seed: number, mapType: MapType) => void;
  onQuickRandomMap: () => void;
  onTogglePause: () => void;
  onCycleSpeed: () => void;
  onToggleEdgeScroll: () => void;
  onToggleReveal: () => void;
  onToggleMusic: () => void;
  onToggleSfx: () => void;
  onToggleLanguage: () => void;
  onJumpTo: (x: number, z: number) => void;
}

export class HUDManager {
  private readonly humanPlayerId = 1;
  private lastCommandSig = '';
  private lastWinnerId: number | null = null;

  // Cached DOM nodes
  private readonly elCivEmblem = document.getElementById('civ-emblem') as HTMLImageElement | null;
  private readonly elFood = document.getElementById('res-food')!;
  private readonly elWood = document.getElementById('res-wood')!;
  private readonly elStone = document.getElementById('res-stone')!;
  private readonly elMetal = document.getElementById('res-metal')!;
  private readonly elPop = document.getElementById('res-pop')!;
  private readonly elPhase = document.getElementById('res-phase')!;
  private readonly elClock = document.getElementById('match-clock')!;
  private readonly elIdleBtn = document.getElementById('btn-idle')!;
  private readonly elIdleLabel = document.getElementById('lbl-idle');
  private readonly elIdleCount = document.getElementById('idle-count')!;
  private readonly elModeBtn = document.getElementById('btn-order-mode')!;
  private readonly elPauseBtn = document.getElementById('btn-pause')!;
  private readonly elSpeedBtn = document.getElementById('btn-speed')!;
  private readonly elEdgeBtn = document.getElementById('btn-edge')!;
  private readonly elRevealBtn = document.getElementById('btn-reveal')!;
  private readonly elMusicBtn = document.getElementById('btn-music')!;
  private readonly elSfxBtn = document.getElementById('btn-sfx')!;
  private readonly elLangBtn = document.getElementById('btn-lang')!;
  private readonly elRandomMapBtn = document.getElementById('btn-random-map');
  private readonly elMenuBtn = document.getElementById('btn-menu')!;

  private readonly elSelectionPanel = document.getElementById('selection-panel')!;
  private readonly elCommandPanel = document.getElementById('command-panel')!;
  private readonly elToastContainer = document.getElementById('toast-container')!;
  private readonly elSetupModal = document.getElementById('setup-modal')!;
  private readonly elVictoryModal = document.getElementById('victory-modal')!;
  private readonly elVictoryBody = document.getElementById('victory-body')!;

  private world!: World;
  private input!: InputController;

  constructor(private readonly callbacks: HUDCallbacks) {
    setLanguage(getLanguage());
    this.wireStaticButtons();
    this.applyLanguage();
  }

  bind(world: World, input: InputController): void {
    this.world = world;
    this.input = input;
    this.lastCommandSig = '';
    this.lastWinnerId = null;
    this.elVictoryModal.classList.add('hidden');
    if (this.elCivEmblem) {
      this.elCivEmblem.src = getCivEmblem(world.config.playerCiv);
      this.elCivEmblem.alt = getCivName(world.config.playerCiv);
    }
    this.renderSelectionAndCommands();
  }

  private wireStaticButtons(): void {
    this.elIdleBtn.addEventListener('click', () => this.input?.selectIdleWorker());
    this.elModeBtn.addEventListener('click', () => {
      if (!this.input) return;
      this.input.buildingOrderMode = this.input.buildingOrderMode === 'capture' ? 'attack' : 'capture';
      this.updateModeButton();
    });
    this.elPauseBtn.addEventListener('click', () => this.callbacks.onTogglePause());
    this.elSpeedBtn.addEventListener('click', () => this.callbacks.onCycleSpeed());
    this.elEdgeBtn.addEventListener('click', () => this.callbacks.onToggleEdgeScroll());
    this.elRevealBtn.addEventListener('click', () => this.callbacks.onToggleReveal());
    this.elMusicBtn.addEventListener('click', () => this.callbacks.onToggleMusic());
    this.elSfxBtn.addEventListener('click', () => this.callbacks.onToggleSfx());
    this.elLangBtn.addEventListener('click', () => this.callbacks.onToggleLanguage());
    this.elRandomMapBtn?.addEventListener('click', () => this.callbacks.onQuickRandomMap());
    this.elMenuBtn.addEventListener('click', () => this.elSetupModal.classList.remove('hidden'));

    const btnCloseModal = document.getElementById('btn-close-setup')!;
    btnCloseModal.addEventListener('click', () => this.elSetupModal.classList.add('hidden'));

    const btnLaunch = document.getElementById('btn-launch-match')!;
    btnLaunch.addEventListener('click', () => {
      const pCiv = (document.getElementById('setup-player-civ') as HTMLSelectElement).value as CivId;
      const aiCiv = (document.getElementById('setup-ai-civ') as HTMLSelectElement).value as CivId;
      const diff = (document.getElementById('setup-difficulty') as HTMLSelectElement).value as Difficulty;
      const mapType = ((document.getElementById('setup-map-type') as HTMLSelectElement | null)?.value ?? 'random') as MapType;
      const seedRaw = (document.getElementById('setup-seed') as HTMLInputElement).value.trim();
      const seed = seedRaw ? parseInt(seedRaw, 10) || Date.now() : Math.floor(Math.random() * 900000) + 100000;
      this.elSetupModal.classList.add('hidden');
      this.callbacks.onStartMatch(pCiv, aiCiv, diff, seed, mapType);
    });

    const btnPlayAgain = document.getElementById('btn-play-again')!;
    btnPlayAgain.addEventListener('click', () => {
      this.elVictoryModal.classList.add('hidden');
      this.elSetupModal.classList.remove('hidden');
    });
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

    // Top bar resources & labels
    setText('lbl-food', t('resFood'));
    setText('lbl-wood', t('resWood'));
    setText('lbl-stone', t('resStone'));
    setText('lbl-metal', t('resMetal'));
    setTitle('pill-food', t('resFoodTip'));
    setTitle('pill-wood', t('resWoodTip'));
    setTitle('pill-stone', t('resStoneTip'));
    setTitle('pill-metal', t('resMetalTip'));
    setTitle('pill-pop', t('resPopTip'));

    if (this.elIdleLabel) this.elIdleLabel.textContent = t('idleBtn');
    this.elIdleBtn.title = t('idleTip');
    this.elSpeedBtn.title = t('speedTip');
    this.elEdgeBtn.textContent = t('edgeBtn');
    this.elEdgeBtn.title = t('edgeTip');
    this.elRevealBtn.textContent = t('mapBtn');
    this.elRevealBtn.title = t('mapTip');
    this.elMusicBtn.title = t('musicTip');
    this.elSfxBtn.title = t('sfxTip');
    this.elLangBtn.textContent = t('langBtn');
    this.elLangBtn.title = t('langTip');
    if (this.elRandomMapBtn) {
      this.elRandomMapBtn.textContent = t('randomMapBtn');
      this.elRandomMapBtn.title = t('randomMapTip');
    }
    this.elMenuBtn.textContent = t('newMatchBtn');
    this.elMenuBtn.title = t('newMatchTip');

    // Setup modal labels & options
    setText('setup-title', t('setupTitle'));
    setText('lbl-setup-player-civ', t('labelPlayerCiv'));
    setText('lbl-setup-ai-civ', t('labelAiCiv'));
    setText('lbl-setup-difficulty', t('labelDifficulty'));
    setText('lbl-setup-map-type', t('labelMapType'));
    setText('lbl-setup-seed', t('labelSeed'));
    const seedInput = document.getElementById('setup-seed') as HTMLInputElement | null;
    if (seedInput) seedInput.placeholder = t('seedPlaceholder');

    const setSelectOpts = (id: string, map: Record<string, string>) => {
      const sel = document.getElementById(id) as HTMLSelectElement | null;
      if (!sel) return;
      for (const opt of Array.from(sel.options)) {
        if (map[opt.value]) opt.textContent = map[opt.value];
      }
    };
    setSelectOpts('setup-player-civ', {
      athenians: t('optAthenPlayer'),
      romans: t('optRomePlayer'),
    });
    setSelectOpts('setup-ai-civ', {
      romans: t('optRomeAi'),
      athenians: t('optAthenAi'),
    });
    setSelectOpts('setup-difficulty', {
      easy: t('optDiffEasy'),
      medium: t('optDiffMedium'),
      hard: t('optDiffHard'),
    });
    setSelectOpts('setup-map-type', {
      random: t('optMapRandom'),
      aegean_valley: t('optMapAegean'),
      medit_highlands: t('optMapHighlands'),
      twin_peninsulas: t('optMapPeninsulas'),
      inland_oasis: t('optMapOasis'),
      open_plains: t('optMapPlains'),
    });

    const guide = document.getElementById('setup-controls-guide');
    if (guide) guide.innerHTML = t('controlsGuideHtml');
    setText('btn-launch-match', t('launchMatchBtn'));
    setText('btn-play-again', t('playAgainBtn'));

    // Force refresh of dynamic HUD sections
    this.lastCommandSig = '';
    if (this.world && this.input) {
      if (this.elCivEmblem) this.elCivEmblem.alt = getCivName(this.world.config.playerCiv);
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
    this.elPauseBtn.textContent = paused ? t('resumeBtn') : t('pauseBtn');
    this.elSpeedBtn.textContent = `${speed}×`;
    this.elEdgeBtn.classList.toggle('active', edgeScroll);
    this.elRevealBtn.classList.toggle('active', revealAll);
    this.elMusicBtn.textContent = musicEnabled ? t('musicOn') : t('musicOff');
    this.elMusicBtn.classList.toggle('active', musicEnabled);
    this.elSfxBtn.textContent = sfxEnabled ? t('sfxOn') : t('sfxOff');
    this.elSfxBtn.classList.toggle('active', sfxEnabled);
    this.updateModeButton();
  }

  private updateModeButton(): void {
    if (!this.input) return;
    const isCap = this.input.buildingOrderMode === 'capture';
    this.elModeBtn.textContent = isCap ? t('captureBtn') : t('destroyBtn');
    this.elModeBtn.title = t('modeTip');
    this.elModeBtn.classList.toggle('active', isCap);
  }

  pushToast(message: string, tone: 'info' | 'warn' | 'good' = 'info', jumpPos?: { x: number; z: number }): void {
    const el = document.createElement('div');
    el.className = `toast toast-${tone}`;
    el.textContent = message;
    if (jumpPos) {
      el.style.cursor = 'pointer';
      el.title = t('toastClickJump');
      el.addEventListener('click', () => this.callbacks.onJumpTo(jumpPos.x, jumpPos.z));
    }
    this.elToastContainer.appendChild(el);
    while (this.elToastContainer.children.length > 5) {
      this.elToastContainer.removeChild(this.elToastContainer.firstChild!);
    }
    setTimeout(() => {
      el.classList.add('fade-out');
      setTimeout(() => el.remove(), 350);
    }, 4200);
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
    this.elPop.textContent = `${p.popUsed} / ${p.popCap}`;
    this.elPop.classList.toggle('pop-warn', p.popUsed >= p.popCap);
    this.elPhase.textContent = p.phase === 1 ? t('phase1') : t('phase2');

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
      this.elSelectionPanel.innerHTML = `
        <div class="empty-selection">
          <div class="empty-title">${t('emptyTitle')}</div>
          <div class="empty-hints">${t('emptyHintsHtml')}</div>
        </div>
      `;
      const emptySig = `empty_${getLanguage()}`;
      if (this.lastCommandSig !== emptySig) {
        this.lastCommandSig = emptySig;
        this.elCommandPanel.innerHTML = `<div class="empty-cmd">${t('emptyCmd')}</div>`;
      }
      return;
    }

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

    const isPrey = e.templateId === 'deer_herd' || e.templateId === 'wild_boar';
    const isSlainPrey = isPrey && e.hp <= 0;
    const displayName = isSlainPrey ? `${tplText.name}${t('carcassSuffix')}` : tplText.name;

    let extraHtml = '';
    if (tpl.kind === 'resource') {
      const resLabel = tpl.resourceType ? getResourceName(tpl.resourceType) : '';
      extraHtml = isSlainPrey
        ? `<div class="sel-meta">${t('slainMeta')} <b>${Math.ceil(e.resourceRemaining)}</b></div>`
        : `<div class="sel-meta">${t('remainingPrefix')} ${resLabel}: <b>${Math.ceil(e.resourceRemaining)}</b></div>`;
    } else if (tpl.kind === 'building') {
      const capPts = e.capturePoints[e.owner] ?? e.captureMax;
      const capPct = e.captureMax > 0 ? Math.round((capPts / e.captureMax) * 100) : 100;
      const statusText = e.isFoundation
        ? `${t('constructing')}: ${Math.round(e.buildProgress * 100)}%`
        : !e.inTerritory && tpl.mustBeInTerritory
          ? t('decaying')
          : `${t('loyalty')}: ${capPct}%`;
      extraHtml = `
        <div class="sel-meta">${statusText}${tpl.isFarmField ? ` • ${t('resFood')}: ${Math.ceil(e.resourceRemaining)}` : ''}</div>
        <div class="sel-stats">🛡️ ${t('hack')} ${armor.hack} • ${t('pierce')} ${armor.pierce} • ${t('crush')} ${armor.crush}${
          tpl.garrisonCapacity ? ` • 🏰 ${t('garrison')} ${e.garrisonedIds.length}/${tpl.garrisonCapacity}` : ''
        }</div>
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
      extraHtml = `
        <div class="sel-meta">${tpl.isCitizenSoldier ? `${t('rank')}: <b>${rankLabel}</b> (${Math.floor(e.xp)} XP)` : tplText.shortName}${carryText}</div>
        <div class="sel-stats">
          ⚔️ ${tpl.attack ? `${tpl.attack.hack || tpl.attack.pierce || tpl.attack.crush} ${t('dmg')}` : '—'} •
          🛡️ ${t('hack')}:${armor.hack} ${t('pierce')}:${armor.pierce} ${t('crush')}:${armor.crush} •
          ${t('orderLabel')}: <b>${getOrderName(e.order.type)}</b>
        </div>
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

    // Wire queue cancel buttons
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
      const foreignSig = `enemy_${selected[0].owner === 0 ? 'res' : 'foe'}_${getLanguage()}`;
      if (this.lastCommandSig !== foreignSig) {
        this.lastCommandSig = foreignSig;
        this.elCommandPanel.innerHTML = `<div class="empty-cmd">${selected[0].owner === 0 ? t('inspectResource') : t('inspectEnemy')}</div>`;
      }
      return;
    }

    const units = owned.filter((e) => TEMPLATES[e.templateId].kind === 'unit');
    const first = owned[0];
    const firstTpl = TEMPLATES[first.templateId];

    // Signature to avoid re-rendering DOM buttons unnecessarily every 100ms while still updating affordability & language
    const sig = JSON.stringify({
      lang: getLanguage(),
      ids: owned.slice(0, 4).map((e) => e.templateId),
      isF: first.isFoundation,
      garr: first.garrisonedIds.length,
      phase: p.phase,
      techs: Array.from(p.researchedTechs),
      rTechs: Array.from(p.researchingTechs),
      stance: units[0]?.stance,
      place: this.input.placementTemplateId,
      rBucket: [
        Math.floor(p.resources.food / 25),
        Math.floor(p.resources.wood / 25),
        Math.floor(p.resources.stone / 25),
        Math.floor(p.resources.metal / 25),
      ],
    });
    if (sig === this.lastCommandSig) return;
    this.lastCommandSig = sig;

    // 1. Units selected -> Build menu + Stances + Actions
    if (units.length > 0) {
      const buildSet = new Set<string>();
      for (const u of units) {
        TEMPLATES[u.templateId].canBuild?.forEach((b) => buildSet.add(b));
      }
      const buildButtons = Array.from(buildSet)
        .map((bId) => {
          const bTpl = TEMPLATES[bId];
          const bText = getTemplateText(bId);
          const locked = (bTpl.phaseRequired ?? 1) > p.phase;
          const afford = !bTpl.cost || this.world.canAfford(p.resources, bTpl.cost);
          const active = this.input.placementTemplateId === bId;
          return `
            <button class="cmd-btn ${locked || !afford ? 'disabled' : ''} ${active ? 'active' : ''}"
              data-build-id="${bId}"
              title="${bText.name}: ${bText.description}\n${t('costLabel')}: ${formatLocalizedCost(bTpl.cost)}${locked ? `\n${t('requiresTownPhase')}` : ''}">
              <span class="cmd-icon">${renderEntityIcon(bId, p.civ, 'cmd-icon-img', bTpl.icon)}</span>
              <span class="cmd-name">${bText.shortName}</span>
              <span class="cmd-cost">${formatShortCost(bTpl.cost)}</span>
            </button>
          `;
        })
        .join('');

      const curStance = units[0].stance;
      const stances: UnitStance[] = ['aggressive', 'defensive', 'stand_ground', 'passive'];

      this.elCommandPanel.innerHTML = `
        <div class="cmd-grid">${buildButtons || `<div class="empty-cmd">${t('noBuildChamp')}</div>`}</div>
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
            <button class="mini-btn" id="cmd-attack-move" title="${t('attackMoveTip')}">${t('attackMoveBtn')}</button>
            <button class="mini-btn" id="cmd-garrison" title="${t('garrisonTip')}">${t('garrisonBtn')}</button>
          </div>
        </div>
      `;

      this.elCommandPanel.querySelectorAll<HTMLButtonElement>('[data-build-id]').forEach((btn) => {
        btn.addEventListener('click', () => {
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
          this.lastCommandSig = '';
          this.renderSelectionAndCommands();
        });
      });

      this.elCommandPanel.querySelectorAll<HTMLButtonElement>('[data-stance]').forEach((btn) => {
        btn.addEventListener('click', () => {
          const st = btn.dataset.stance as UnitStance;
          this.world.enqueueCommand({
            type: 'set_stance',
            playerId: this.humanPlayerId,
            entityIds: units.map((u) => u.id),
            stance: st,
          });
          this.lastCommandSig = '';
        });
      });

      document.getElementById('cmd-attack-move')?.addEventListener('click', () => {
        this.input.attackMoveMode = true;
        this.pushToast(t('toastAttackMove'), 'info');
      });
      document.getElementById('cmd-garrison')?.addEventListener('click', () => {
        this.input.garrisonTargetMode = true;
        this.pushToast(t('toastGarrison'), 'info');
      });
      return;
    }

    // 2. Building selected -> Train units + Research Techs + Ungarrison
    if (first.isFoundation) {
      this.elCommandPanel.innerHTML = `<div class="empty-cmd">${t('underConstruction')} (${Math.round(first.buildProgress * 100)}%). ${t('sendCitizens')}</div>`;
      return;
    }

    const trainBtns = (firstTpl.trains ?? [])
      .map((uKey) => {
        const uId = resolveUnitTemplateId(civ.units, uKey);
        const uTpl = TEMPLATES[uId];
        const uText = getTemplateText(uId);
        const locked = (uTpl.phaseRequired ?? 1) > p.phase;
        const afford = !uTpl.cost || this.world.canAfford(p.resources, uTpl.cost);
        return `
          <button class="cmd-btn ${locked || !afford ? 'disabled' : ''}" data-train-id="${uId}"
            title="${uText.name}: ${uText.description}\n${t('costLabel')}: ${formatLocalizedCost(uTpl.cost)} • ${t('popLabel')}: ${uTpl.popCost ?? 1}">
            <span class="cmd-icon">${renderEntityIcon(uId, p.civ, 'cmd-icon-img', uTpl.icon)}</span>
            <span class="cmd-name">${uText.shortName}</span>
            <span class="cmd-cost">${formatShortCost(uTpl.cost)}</span>
          </button>
        `;
      })
      .join('');

    const techBtns = (firstTpl.researches ?? [])
      .map((tId) => {
        const tech = TECHS[tId];
        const techText = getTechText(tId);
        const done = p.researchedTechs.has(tId);
        const inProg = p.researchingTechs.has(tId);
        const locked = tech.phaseRequired > p.phase;
        const afford = this.world.canAfford(p.resources, tech.cost);
        if (done) {
          return `
            <button class="cmd-btn researched" disabled title="${techText.name} (${t('done')})">
              <span class="cmd-icon">✅</span>
              <span class="cmd-name">${techText.name}</span>
              <span class="cmd-cost">${t('done')}</span>
            </button>
          `;
        }
        return `
          <button class="cmd-btn tech-btn ${locked || !afford || inProg ? 'disabled' : ''}" data-tech-id="${tId}"
            title="${techText.name}: ${techText.description}\n${t('costLabel')}: ${formatLocalizedCost(tech.cost)}">
            <span class="cmd-icon">${renderTechIcon(tId, 'cmd-icon-img', tech.icon)}</span>
            <span class="cmd-name">${techText.name}</span>
            <span class="cmd-cost">${inProg ? t('working') : formatShortCost(tech.cost)}</span>
          </button>
        `;
      })
      .join('');

    const ungarrisonBtn =
      first.garrisonedIds.length > 0
        ? `<button class="mini-btn active" id="cmd-ungarrison">${t('ungarrisonAll')} (${first.garrisonedIds.length})</button>`
        : '';

    this.elCommandPanel.innerHTML = `
      <div class="cmd-grid">${trainBtns}${techBtns || (!trainBtns ? `<div class="empty-cmd">${t('econDefStruct')}</div>` : '')}</div>
      <div class="cmd-footer-row">
        <span class="rally-hint">${firstTpl.trains ? t('rallyHint') : ''}</span>
        <div class="action-row">${ungarrisonBtn}</div>
      </div>
    `;

    this.elCommandPanel.querySelectorAll<HTMLButtonElement>('[data-train-id]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const uId = btn.dataset.trainId!;
        const uTpl = TEMPLATES[uId];
        if (uTpl.cost && !this.world.canAfford(p.resources, uTpl.cost)) {
          this.pushToast(`${t('needPrefix')} ${formatLocalizedCost(uTpl.cost)}`, 'warn');
          return;
        }
        this.world.enqueueCommand({
          type: 'train',
          playerId: this.humanPlayerId,
          buildingId: first.id,
          templateId: uId,
        });
        this.lastCommandSig = '';
      });
    });

    this.elCommandPanel.querySelectorAll<HTMLButtonElement>('[data-tech-id]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const tId = btn.dataset.techId!;
        const tech = TECHS[tId];
        if (!this.world.canAfford(p.resources, tech.cost)) {
          this.pushToast(`${t('needPrefix')} ${formatLocalizedCost(tech.cost)}`, 'warn');
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
  }
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
