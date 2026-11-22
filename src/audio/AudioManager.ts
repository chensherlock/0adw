import { AUDIO_ASSETS } from '../config/assets';
import { SimEvent } from '../config/types';

const MUSIC_STORAGE_KEY = 'web0ad_music_enabled';
const SFX_STORAGE_KEY = 'web0ad_sfx_enabled';

function readBoolPref(key: string, fallback: boolean): boolean {
  if (typeof window === 'undefined') return fallback;
  try {
    const raw = window.localStorage.getItem(key);
    if (raw === '0' || raw === 'false') return false;
    if (raw === '1' || raw === 'true') return true;
  } catch {
    // ignore storage errors
  }
  return fallback;
}

function writeBoolPref(key: string, val: boolean): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(key, val ? '1' : '0');
  } catch {
    // ignore
  }
}

export class AudioManager {
  private ctx: AudioContext | null = null;
  private _musicEnabled = readBoolPref(MUSIC_STORAGE_KEY, true);
  private _sfxEnabled = readBoolPref(SFX_STORAGE_KEY, true);
  private lastSfxTime = new Map<string, number>();
  private readonly bufferCache = new Map<string, AudioBuffer>();
  private readonly loadingUrls = new Set<string>();
  private preloaded = false;

  private musicEl: HTMLAudioElement | null = null;

  get musicEnabled(): boolean {
    return this._musicEnabled;
  }

  set musicEnabled(val: boolean) {
    this._musicEnabled = val;
    writeBoolPref(MUSIC_STORAGE_KEY, val);
    if (val) {
      if (!this.musicEl) {
        this.startAmbientMusic();
      } else {
        this.musicEl.play().catch(() => {});
      }
    } else if (this.musicEl) {
      this.musicEl.pause();
    }
  }

  get sfxEnabled(): boolean {
    return this._sfxEnabled;
  }

  set sfxEnabled(val: boolean) {
    this._sfxEnabled = val;
    writeBoolPref(SFX_STORAGE_KEY, val);
  }

  /** Convenience master flag (true if either music or SFX is active) */
  get enabled(): boolean {
    return this._musicEnabled || this._sfxEnabled;
  }

  set enabled(val: boolean) {
    this.musicEnabled = val;
    this.sfxEnabled = val;
  }

  unlock(): void {
    if (!this.ctx && typeof window !== 'undefined' && window.AudioContext) {
      this.ctx = new AudioContext();
    }
    if (this.ctx && this.ctx.state === 'suspended') {
      this.ctx.resume().catch(() => {});
    }
    if (!this.preloaded && typeof window !== 'undefined') {
      this.preloaded = true;
      this.preloadSfx();
      this.startAmbientMusic();
    } else if (this._musicEnabled && this.musicEl && this.musicEl.paused) {
      this.musicEl.play().catch(() => {});
    }
  }

  private startAmbientMusic(): void {
    if (typeof Audio === 'undefined' || this.musicEl) return;
    const el = new Audio(AUDIO_ASSETS.music);
    el.loop = true;
    el.volume = 0.16;
    this.musicEl = el;
    if (this._musicEnabled) {
      el.play().catch(() => {});
    }
  }

  private preloadSfx(): void {
    const urls = new Set<string>();
    for (const [k, v] of Object.entries(AUDIO_ASSETS)) {
      if (k === 'music') continue;
      if (Array.isArray(v)) {
        for (const u of v) urls.add(u);
      }
    }
    for (const url of urls) {
      this.loadBuffer(url);
    }
  }

  private loadBuffer(url: string): void {
    if (!this.ctx || this.bufferCache.has(url) || this.loadingUrls.has(url)) return;
    this.loadingUrls.add(url);
    fetch(url)
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.arrayBuffer();
      })
      .then((ab) => this.ctx!.decodeAudioData(ab))
      .then((buf) => {
        this.bufferCache.set(url, buf);
      })
      .catch(() => {})
      .finally(() => {
        this.loadingUrls.delete(url);
      });
  }

  private canPlay(key: string, minGapMs: number): boolean {
    if (!this._sfxEnabled || !this.ctx || this.ctx.state !== 'running') return false;
    const now = performance.now();
    const last = this.lastSfxTime.get(key) ?? 0;
    if (now - last < minGapMs) return false;
    this.lastSfxTime.set(key, now);
    return true;
  }

  /** Plays a random loaded 0 A.D. .ogg clip from the list; returns false if not yet decoded */
  private playClip(urls: readonly string[], volume = 0.35, rateJitter = 0.06): boolean {
    if (!this.ctx || !this._sfxEnabled || urls.length === 0) return false;
    const ready = urls.filter((u) => this.bufferCache.has(u));
    if (ready.length === 0) {
      urls.forEach((u) => this.loadBuffer(u));
      return false;
    }
    const pick = ready[Math.floor(Math.random() * ready.length)];
    const buf = this.bufferCache.get(pick)!;
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    if (rateJitter > 0) {
      src.playbackRate.value = 1 + (Math.random() * 2 - 1) * rateJitter;
    }
    const gain = this.ctx.createGain();
    gain.gain.value = volume;
    src.connect(gain);
    gain.connect(this.ctx.destination);
    src.start();
    return true;
  }

  private tone(
    freq: number,
    duration: number,
    type: OscillatorType = 'triangle',
    gainPeak = 0.08,
    endFreq?: number,
    delay = 0
  ): void {
    if (!this.ctx) return;
    const now = this.ctx.currentTime + delay;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, now);
    if (endFreq !== undefined) {
      osc.frequency.exponentialRampToValueAtTime(Math.max(20, endFreq), now + duration);
    }
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.linearRampToValueAtTime(gainPeak, now + 0.015);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);
    osc.connect(gain);
    gain.connect(this.ctx.destination);
    osc.start(now);
    osc.stop(now + duration + 0.02);
  }

  playSelect(templateId?: string): void {
    if (!this.canPlay('select', 70)) return;
    const clips =
      templateId === 'civic_center'
        ? AUDIO_ASSETS.selectCivicCenter
        : templateId === 'barracks'
          ? AUDIO_ASSETS.selectBarracks
          : templateId === 'temple' || templateId === 'wonder'
            ? AUDIO_ASSETS.selectTemple
            : templateId === 'blacksmith' || templateId === 'workshop'
              ? AUDIO_ASSETS.selectBlacksmith
              : templateId === 'market'
                ? AUDIO_ASSETS.selectMarket
                : templateId === 'stable'
                  ? AUDIO_ASSETS.selectStable
                  : AUDIO_ASSETS.select;
    if (!this.playClip(clips, 0.28, 0.03)) {
      this.tone(520, 0.09, 'triangle', 0.06, 660);
    }
  }

  playOrder(): void {
    if (!this.canPlay('order', 80)) return;
    if (!this.playClip(AUDIO_ASSETS.order, 0.3, 0.05)) {
      this.tone(240, 0.11, 'sine', 0.07, 175);
    }
  }

  playError(): void {
    if (!this.canPlay('error', 150)) return;
    if (!this.playClip(AUDIO_ASSETS.error, 0.32, 0)) {
      this.tone(180, 0.15, 'sawtooth', 0.05, 130);
    }
  }

  playSimEvent(ev: SimEvent, humanPlayerId: number): void {
    switch (ev.type) {
      case 'attack_swing':
        if (ev.isRanged) {
          if (this.canPlay('bow', 160) && !this.playClip(AUDIO_ASSETS.bow, 0.22, 0.08)) {
            this.tone(620, 0.09, 'triangle', 0.035, 290);
          }
        } else {
          if (this.canPlay('sword', 180) && !this.playClip(AUDIO_ASSETS.sword, 0.22, 0.08)) {
            this.tone(920, 0.07, 'sawtooth', 0.025, 340);
          }
        }
        break;
      case 'gather_tick':
        if (this.canPlay('gather', 420)) {
          const clips =
            ev.resourceType === 'wood'
              ? AUDIO_ASSETS.wood
              : ev.resourceType === 'stone'
                ? AUDIO_ASSETS.stone
                : ev.resourceType === 'metal'
                  ? AUDIO_ASSETS.metal
                  : AUDIO_ASSETS.food;
          if (!this.playClip(clips, 0.16, 0.1)) {
            const f = ev.resourceType === 'wood' ? 160 : ev.resourceType === 'food' ? 320 : 520;
            this.tone(f, 0.06, 'triangle', 0.02, f * 0.7);
          }
        }
        break;
      case 'building_complete':
        if (ev.playerId === humanPlayerId && this.canPlay('build_done', 300)) {
          if (!this.playClip(AUDIO_ASSETS.buildComplete, 0.38, 0)) {
            this.tone(330, 0.18, 'triangle', 0.07, undefined, 0);
            this.tone(440, 0.2, 'triangle', 0.07, undefined, 0.09);
            this.tone(554, 0.28, 'triangle', 0.08, undefined, 0.18);
          }
        }
        break;
      case 'unit_trained':
        if (ev.playerId === humanPlayerId && this.canPlay('train_done', 300)) {
          const clips = ev.templateId === 'female_citizen' ? AUDIO_ASSETS.trainFemale : AUDIO_ASSETS.trainInfantry;
          if (!this.playClip(clips, 0.34, 0)) {
            this.tone(440, 0.14, 'triangle', 0.055, 523);
          }
        }
        break;
      case 'building_captured':
        if (this.canPlay('capture', 400)) {
          if (!this.playClip(AUDIO_ASSETS.capture, 0.4, 0)) {
            this.tone(293, 0.22, 'sawtooth', 0.06, undefined, 0);
            this.tone(440, 0.35, 'sawtooth', 0.065, undefined, 0.14);
          }
        }
        break;
      case 'tech_complete':
        if (ev.playerId === humanPlayerId && this.canPlay('tech', 400)) {
          const clips = ev.techId === 'phase_town' ? AUDIO_ASSETS.phaseUp : AUDIO_ASSETS.techComplete;
          if (!this.playClip(clips, 0.42, 0)) {
            this.tone(392, 0.22, 'triangle', 0.08, undefined, 0);
            this.tone(494, 0.22, 'triangle', 0.08, undefined, 0.12);
            this.tone(587, 0.4, 'triangle', 0.09, undefined, 0.24);
          }
        }
        break;
      case 'skill_activated':
        if (ev.playerId === humanPlayerId && this.canPlay('skill', 400)) {
          if (!this.playClip(AUDIO_ASSETS.phaseUp, 0.44, 0)) {
            this.tone(440, 0.2, 'triangle', 0.08, undefined, 0);
            this.tone(554, 0.22, 'triangle', 0.085, undefined, 0.1);
            this.tone(659, 0.38, 'triangle', 0.09, undefined, 0.2);
          }
        }
        break;
      case 'under_attack':
        if (ev.playerId === humanPlayerId && this.canPlay('horn', 5000)) {
          if (!this.playClip(AUDIO_ASSETS.underAttack, 0.42, 0)) {
            this.tone(196, 0.45, 'sawtooth', 0.065, 190, 0);
            this.tone(294, 0.55, 'sawtooth', 0.07, 290, 0.2);
          }
        }
        break;
      case 'unit_promoted':
        if (ev.playerId === humanPlayerId && this.canPlay('promo', 350)) {
          this.tone(587, 0.14, 'triangle', 0.06, 880);
        }
        break;
      case 'match_over':
        if (this.canPlay('match_over', 1000)) {
          const clips = ev.winnerId === humanPlayerId ? AUDIO_ASSETS.victory : AUDIO_ASSETS.defeat;
          this.playClip(clips, 0.48, 0);
        }
        break;
    }
  }
}
