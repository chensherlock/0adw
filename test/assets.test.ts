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
  RUIN_TEXTURES,
  TECH_PORTRAITS,
  TERRAIN_TEXTURES,
  UI_ICONS,
} from '../src/config/assets';
import { ALL_CIV_IDS } from '../src/config/civs';
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
    expect(ALL_CIV_IDS.length).toBe(14);
    for (const civ of ALL_CIV_IDS) {
      const emblem = getCivEmblem(civ);
      expect(emblem, `No official emblem for ${civ}`).toBeTruthy();
      expect(emblem.startsWith(`${ASSET_BASE}/ui/emblem_`)).toBe(true);
    }

    // Verify authentic official 0 A.D. portraits for EVERY template across all 14 official civs
    for (const id of Object.keys(TEMPLATES)) {
      for (const civ of ALL_CIV_IDS) {
        const portrait = getEntityPortrait(id, civ);
        expect(portrait, `No portrait mapped for ${id} (${civ})`).toBeTruthy();
      }
    }
    expect(getEntityPortrait('dock', 'athenians')).toBe(`${ASSET_BASE}/ui/dock_shipyard.png`);
    expect(getEntityPortrait('dock', 'carthaginians')).toBe(`${ASSET_BASE}/ui/dock_cart.png`);
    expect(getEntityPortrait('dock', 'romans')).toBe(`${ASSET_BASE}/ui/dock.png`);
    expect(getEntityPortrait('stone_wall', 'athenians')).toBe(`${ASSET_BASE}/ui/stone_wall.png`);
    expect(getEntityPortrait('stone_gate', 'athenians')).toBe(`${ASSET_BASE}/ui/stone_gate.png`);
    expect(getEntityPortrait('gymnasium', 'athenians')).toBe(`${ASSET_BASE}/ui/gymnasium.png`);
    expect(getEntityPortrait('kush_pyramid', 'kushites')).toBe(`${ASSET_BASE}/ui/kush_pyramid.png`);
    expect(getEntityPortrait('maur_elephant', 'mauryas')).toBe(`${ASSET_BASE}/ui/maur_elephant.png`);
    expect(getEntityPortrait('brit_chariot', 'britons')).toBe(`${ASSET_BASE}/ui/brit_chariot.png`);
    expect(getEntityPortrait('han_ministry', 'han')).toBe(`${ASSET_BASE}/ui/han_ministry.png`);
    expect(getEntityPortrait('warship_trireme', 'han')).toBe(`${ASSET_BASE}/ui/han_warship.png`);

    for (const p of Object.values(ENTITY_PORTRAITS)) {
      expect(p.startsWith(`${ASSET_BASE}/ui/`)).toBe(true);
    }
    for (const id of Object.keys(TECHS)) {
      expect(TECH_PORTRAITS[id], `No portrait mapped for tech ${id}`).toBeTruthy();
    }
  });

  it('maps Mediterranean terrain textures, ruin stone textures, water normal maps, and audio assets', () => {
    expect(TERRAIN_TEXTURES.waterNormalSea).toBe(`${ASSET_BASE}/terrain/water_normal_sea.png`);
    expect(TERRAIN_TEXTURES.waterNormalRipple).toBe(`${ASSET_BASE}/terrain/water_normal_ripple.png`);
    for (const p of Object.values(TERRAIN_TEXTURES)) {
      expect(p.startsWith(`${ASSET_BASE}/terrain/`)).toBe(true);
    }
    for (const p of Object.values(RUIN_TEXTURES)) {
      expect(p.startsWith(`${ASSET_BASE}/textures/`)).toBe(true);
    }
    for (const val of Object.values(AUDIO_ASSETS)) {
      const list: readonly string[] = typeof val === 'string' ? [val] : val;
      expect(list.length).toBeGreaterThan(0);
      for (const u of list) {
        expect(u.startsWith(`${ASSET_BASE}/audio/`)).toBe(true);
      }
    }
  });

  it('maps distinct 3D 0 A.D. COLLADA specs for every civilization entity', () => {
    const files = new Set<string>();
    const custom3D = new Set([
      'field',
      'dock',
      'stone_wall',
      'stone_gate',
      'stone_bridge',
      'tunnel_portal',
      'apartment_house',
      'trader',
      'ancient_ruin_pillar',
      'sea_monster',
      'sea_kraken',
      'lake_nessie',
      'beacon_tower',
      'merchant_ship',
      'warship_trireme',
      'fish_shoal',
      'han_ministry',
      'brit_kennel',
      'gaul_tavern',
      'iber_monument',
      'kush_pyramid',
      'mace_arsenal',
      'maur_pillar',
      'sele_colony',
      'maur_champion',
    ]);
    for (const civ of ALL_CIV_IDS) {
      for (const id of Object.keys(TEMPLATES)) {
        if (custom3D.has(id)) continue;
        const spec = getZeroADModelSpec(id, civ);
        expect(spec, `No 0 A.D. 3D spec for ${id} (${civ})`).not.toBeNull();
        collectPartFiles(spec!.parts, files);
      }
    }
    // Eagle's hawk_flight.dae already rotates Body 180° around Z to face +Z; seagull_flight_01.dae needs rotateY = PI
    expect(getZeroADModelSpec('wild_eagle', 'athenians')?.rotateY).toBeUndefined();
    expect(getZeroADModelSpec('wild_seagull', 'athenians')?.rotateY).toBe(Math.PI);
    // Chariots use official 0 A.D. 3D DAE specs
    expect(getZeroADModelSpec('brit_chariot', 'britons')?.parts[0].mesh).toContain('celt_char_a.dae');
    expect(getZeroADModelSpec('pers_chariot', 'persians')?.parts[0].mesh).toContain('pers_chariot_a.dae');
    expect(getZeroADModelSpec('han_chariot', 'han')?.parts[0].mesh).toContain('han_chariot.dae');
    // Different civs have distinct official 0 A.D. building & worker portraits and 3D models
    expect(getEntityPortrait('female_citizen', 'han')).not.toBe(getEntityPortrait('female_citizen', 'britons'));
    expect(getEntityPortrait('civic_center', 'han')).not.toBe(getEntityPortrait('civic_center', 'britons'));
    expect(getZeroADModelSpec('house', 'han')?.parts[0].mesh).not.toBe(getZeroADModelSpec('house', 'persians')?.parts[0].mesh);
    expect(getZeroADModelSpec('female_citizen', 'han')?.parts[0].texture).not.toBe(getZeroADModelSpec('female_citizen', 'persians')?.parts[0].texture);
    // Gymnasium must not reuse temple geometry
    const gymSpec = getZeroADModelSpec('gymnasium', 'athenians')!;
    expect(gymSpec.parts.some((p) => p.mesh.includes('temple'))).toBe(false);
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
