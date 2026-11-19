import { describe, expect, it } from 'vitest';
import { AudioManager } from '../src/audio/AudioManager';
import {
  ANIMATION_ASSETS,
  ASSET_BASE,
  AUDIO_ASSETS,
  EFFECT_TEXTURES,
  ENTITY_PORTRAITS,
  getCivEmblem,
  getEntityPortrait,
  RALLY_FLAG_ASSETS,
  TECH_PORTRAITS,
  TERRAIN_TEXTURES,
  UI_ICONS,
} from '../src/config/assets';
import { TECHS, TEMPLATES } from '../src/config/entities';
import { getLanguage, getTechText, getTemplateText, setLanguage, t, toggleLanguage } from '../src/config/i18n';
import { getZeroADModelSpec, ModelPartSpec } from '../src/render/ZeroADAssetLoader';

function collectPartFiles(parts: ModelPartSpec[], out: Set<string>): void {
  for (const p of parts) {
    out.add(p.mesh);
    out.add(p.texture);
    if (p.normTex) out.add(p.normTex);
    if (p.children) collectPartFiles(p.children, out);
  }
}

describe('0 A.D. Asset Catalog & Model Specs', () => {
  it('maps UI icons, civ emblems, entity portraits, and tech portraits under /assets/0ad/', () => {
    for (const p of Object.values(UI_ICONS)) {
      expect(p.startsWith(`${ASSET_BASE}/ui/`)).toBe(true);
    }
    expect(getCivEmblem('athenians')).toBe(UI_ICONS.emblemAthenians);
    expect(getCivEmblem('romans')).toBe(UI_ICONS.emblemRomans);

    for (const id of Object.keys(TEMPLATES)) {
      const athenP = getEntityPortrait(id, 'athenians');
      const romeP = getEntityPortrait(id, 'romans');
      expect(athenP, `No portrait mapped for ${id}`).toBeTruthy();
      expect(romeP, `No portrait mapped for ${id}`).toBeTruthy();
    }
    for (const p of Object.values(ENTITY_PORTRAITS)) {
      expect(p.startsWith(`${ASSET_BASE}/ui/`)).toBe(true);
    }
    for (const id of Object.keys(TECHS)) {
      expect(TECH_PORTRAITS[id], `No portrait mapped for tech ${id}`).toBeTruthy();
    }
  });

  it('maps Mediterranean terrain textures and audio assets', () => {
    for (const p of Object.values(TERRAIN_TEXTURES)) {
      expect(p.startsWith(`${ASSET_BASE}/terrain/`)).toBe(true);
    }
    for (const val of Object.values(AUDIO_ASSETS)) {
      const list: readonly string[] = typeof val === 'string' ? [val] : val;
      expect(list.length).toBeGreaterThan(0);
      for (const u of list) {
        expect(u.startsWith(`${ASSET_BASE}/audio/`)).toBe(true);
      }
    }
  });

  it('maps distinct 3D 0 A.D. COLLADA specs for every Athenian and Roman entity', () => {
    const files = new Set<string>();
    for (const civ of ['athenians', 'romans'] as const) {
      for (const id of Object.keys(TEMPLATES)) {
        if (id === 'field') continue;
        const spec = getZeroADModelSpec(id, civ);
        expect(spec, `No 0 A.D. 3D spec for ${id} (${civ})`).not.toBeNull();
        collectPartFiles(spec!.parts, files);
      }
    }
    expect(files.size).toBeGreaterThan(50);
    for (const f of files) {
      expect(f.startsWith(`${ASSET_BASE}/`)).toBe(true);
    }

    // Verify all skeletal animation clips are mapped under /assets/0ad/animations/
    const animUrls = Object.values(ANIMATION_ASSETS);
    expect(animUrls.length).toBeGreaterThanOrEqual(28);
    for (const a of animUrls) {
      expect(a.startsWith(`${ASSET_BASE}/animations/`)).toBe(true);
    }

    // Verify workers carry task-specific 0 A.D. tools (axe, pick, hoe, mallet, basket, knife)
    for (const id of ['female_citizen', 'athen_hoplite'] as const) {
      const workerSpec = getZeroADModelSpec(id, 'athenians')!;
      const toolRoles = new Set((workerSpec.parts[0].children ?? []).map((c) => c.toolRole).filter(Boolean));
      expect(toolRoles.has('axe')).toBe(true);
      expect(toolRoles.has('pick')).toBe(true);
      expect(toolRoles.has('hoe')).toBe(true);
      expect(toolRoles.has('mallet')).toBe(true);
      expect(toolRoles.has('basket')).toBe(true);
      expect(toolRoles.has('knife')).toBe(true);
    }

    // Verify slain prey, flee & counter-attack animations are wired
    const deerAnims = getZeroADModelSpec('deer_herd', 'athenians')!.parts[0].animations;
    expect(deerAnims?.walk).toBeTruthy();
    expect(deerAnims?.death).toBeTruthy();
    const boarAnims = getZeroADModelSpec('wild_boar', 'athenians')!.parts[0].animations;
    expect(boarAnims?.walk).toBeTruthy();
    expect(boarAnims?.attack).toBeTruthy();
    expect(boarAnims?.death).toBeTruthy();

    // Verify authentic 0 A.D. rally point flags & geology decals/sparkles
    for (const civ of ['athenians', 'romans'] as const) {
      const flagSpec = getZeroADModelSpec('rally_flag', civ);
      expect(flagSpec).not.toBeNull();
      expect(flagSpec!.parts[0].animations?.idle).toBe(ANIMATION_ASSETS.waypointFlagIdle);
    }
    for (const p of Object.values(EFFECT_TEXTURES)) {
      expect(p.startsWith(`${ASSET_BASE}/textures/`)).toBe(true);
    }
    expect(RALLY_FLAG_ASSETS.mesh.startsWith(`${ASSET_BASE}/models/`)).toBe(true);
  });

  it('supports independent music/SFX audio toggles and complete zh-TW / en language switching', () => {
    const audio = new AudioManager();
    expect(audio.musicEnabled).toBe(true);
    expect(audio.sfxEnabled).toBe(true);

    audio.musicEnabled = false;
    expect(audio.musicEnabled).toBe(false);
    expect(audio.sfxEnabled).toBe(true);

    audio.sfxEnabled = false;
    expect(audio.sfxEnabled).toBe(false);
    expect(audio.enabled).toBe(false);

    audio.musicEnabled = true;
    expect(audio.musicEnabled).toBe(true);
    expect(audio.sfxEnabled).toBe(false);
    expect(audio.enabled).toBe(true);

    setLanguage('en');
    expect(getLanguage()).toBe('en');
    expect(t('resFood')).toBe('Food');
    expect(getTemplateText('civic_center').name).toBe('Civic Center');

    const next = toggleLanguage();
    expect(next).toBe('zh-TW');
    expect(t('resFood')).toBe('食物');
    for (const id of Object.keys(TEMPLATES)) {
      const zh = getTemplateText(id);
      expect(zh.name, `Missing zh-TW name for ${id}`).not.toBe(TEMPLATES[id].name);
      expect(zh.shortName.length).toBeGreaterThan(0);
    }
    for (const id of Object.keys(TECHS)) {
      const zh = getTechText(id);
      expect(zh.name, `Missing zh-TW tech name for ${id}`).not.toBe(TECHS[id].name);
    }
  });
});
