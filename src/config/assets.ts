import { CivId } from './types';

export const ASSET_BASE = '/assets/0ad';

export const UI_ICONS = {
  food: `${ASSET_BASE}/ui/res_food.png`,
  wood: `${ASSET_BASE}/ui/res_wood.png`,
  stone: `${ASSET_BASE}/ui/res_stone.png`,
  metal: `${ASSET_BASE}/ui/res_metal.png`,
  population: `${ASSET_BASE}/ui/res_pop.png`,
  emblemAthenians: `${ASSET_BASE}/ui/emblem_athenians.png`,
  emblemRomans: `${ASSET_BASE}/ui/emblem_romans.png`,
} as const;

export const ENTITY_PORTRAITS: Record<string, string> = {
  // Gaia / Resources
  tree_cypress: `${ASSET_BASE}/ui/tree_cypress.png`,
  tree_olive: `${ASSET_BASE}/ui/tree_olive.png`,
  tree_pine: `${ASSET_BASE}/ui/tree_pine.png`,
  tree_palm: `${ASSET_BASE}/ui/tree_palm.png`,
  tree_oak: `${ASSET_BASE}/ui/tree_oak.png`,
  berry_bush: `${ASSET_BASE}/ui/berry_bush.png`,
  grape_vine: `${ASSET_BASE}/ui/grape_vine.png`,
  deer_herd: `${ASSET_BASE}/ui/deer_herd.png`,
  wild_boar: `${ASSET_BASE}/ui/wild_boar.png`,
  stone_quarry: `${ASSET_BASE}/ui/stone_quarry.png`,
  marble_quarry: `${ASSET_BASE}/ui/marble_quarry.png`,
  metal_mine: `${ASSET_BASE}/ui/metal_mine.png`,
  gold_vein: `${ASSET_BASE}/ui/gold_vein.png`,
  // Buildings
  civic_center: `${ASSET_BASE}/ui/civic_center.png`,
  house: `${ASSET_BASE}/ui/house.png`,
  storehouse: `${ASSET_BASE}/ui/storehouse.png`,
  farmstead: `${ASSET_BASE}/ui/farmstead.png`,
  field: `${ASSET_BASE}/ui/field.png`,
  barracks: `${ASSET_BASE}/ui/barracks.png`,
  defense_tower: `${ASSET_BASE}/ui/defense_tower.png`,
  outpost: `${ASSET_BASE}/ui/outpost.png`,
  fortress: `${ASSET_BASE}/ui/fortress.png`,
  temple: `${ASSET_BASE}/ui/temple.png`,
  blacksmith: `${ASSET_BASE}/ui/blacksmith.png`,
  market: `${ASSET_BASE}/ui/market.png`,
  stable: `${ASSET_BASE}/ui/stable.png`,
  workshop: `${ASSET_BASE}/ui/workshop.png`,
  wonder: `${ASSET_BASE}/ui/wonder.png`,
  // Units
  female_citizen: `${ASSET_BASE}/ui/female_citizen_athen.png`,
  healer: `${ASSET_BASE}/ui/healer_athen.png`,
  siege_ram: `${ASSET_BASE}/ui/siege_ram_athen.png`,
  athen_hoplite: `${ASSET_BASE}/ui/athen_hoplite.png`,
  athen_archer: `${ASSET_BASE}/ui/athen_archer.png`,
  athen_cavalry: `${ASSET_BASE}/ui/athen_cavalry.png`,
  athen_champion: `${ASSET_BASE}/ui/athen_champion.png`,
  rome_hastatus: `${ASSET_BASE}/ui/rome_hastatus.png`,
  rome_velite: `${ASSET_BASE}/ui/rome_velite.png`,
  rome_cavalry: `${ASSET_BASE}/ui/rome_cavalry.png`,
  rome_champion: `${ASSET_BASE}/ui/rome_champion.png`,
};

export const TECH_PORTRAITS: Record<string, string> = {
  phase_town: `${ASSET_BASE}/ui/phase_town.png`,
  tech_gather_tools: `${ASSET_BASE}/ui/tech_gather_tools.png`,
  tech_iron_weapons: `${ASSET_BASE}/ui/tech_iron_weapons.png`,
  tech_bronze_shields: `${ASSET_BASE}/ui/tech_bronze_shields.png`,
  tech_architecture: `${ASSET_BASE}/ui/tech_architecture.png`,
  tech_temple_healing: `${ASSET_BASE}/ui/tech_temple_healing.png`,
  tech_coinage: `${ASSET_BASE}/ui/tech_coinage.png`,
  tech_cavalry_speed: `${ASSET_BASE}/ui/tech_cavalry_speed.png`,
  tech_steel_weapons: `${ASSET_BASE}/ui/tech_steel_weapons.png`,
  tech_heavy_armor: `${ASSET_BASE}/ui/tech_heavy_armor.png`,
  tech_siege_engineering: `${ASSET_BASE}/ui/tech_siege_engineering.png`,
};

export function getEntityPortrait(templateId: string, civId?: CivId): string | undefined {
  if (civId === 'romans') {
    if (templateId === 'female_citizen') return `${ASSET_BASE}/ui/female_citizen_rome.png`;
    if (templateId === 'healer') return `${ASSET_BASE}/ui/healer_rome.png`;
    if (templateId === 'siege_ram') return `${ASSET_BASE}/ui/siege_ram_rome.png`;
  }
  return ENTITY_PORTRAITS[templateId];
}

export function getCivEmblem(civId: CivId): string {
  return civId === 'romans' ? UI_ICONS.emblemRomans : UI_ICONS.emblemAthenians;
}

export const TERRAIN_TEXTURES = {
  grass: `${ASSET_BASE}/terrain/grass.png`,
  grassNorm: `${ASSET_BASE}/terrain/grass_norm.png`,
  dirt: `${ASSET_BASE}/terrain/dirt.png`,
  cliff: `${ASSET_BASE}/terrain/cliff.png`,
  cliffNorm: `${ASSET_BASE}/terrain/cliff_norm.png`,
  farmland: `${ASSET_BASE}/terrain/farmland.png`,
} as const;

export const FIELD_TEXTURES = {
  decalFarmland: `${ASSET_BASE}/textures/decal_farmland.png`,
  decalFarmlandNorm: `${ASSET_BASE}/textures/decal_farmland_norm.png`,
  wheatCrop: `${ASSET_BASE}/textures/farming_wheat_harvest_a.png`,
} as const;

export const EFFECT_TEXTURES = {
  decalStone: `${ASSET_BASE}/textures/decal_stone_medit_01.png`,
  decalStoneNorm: `${ASSET_BASE}/textures/decal_stone_medit_01_norm.png`,
  sparkle: `${ASSET_BASE}/textures/sparkle_02.png`,
} as const;

export const RALLY_FLAG_ASSETS = {
  mesh: `${ASSET_BASE}/models/waypoint_flag.dae`,
  bannerAthen: `${ASSET_BASE}/textures/banner_greek.png`,
  bannerRome: `${ASSET_BASE}/textures/banner_romans.png`,
  idleAnim: `${ASSET_BASE}/animations/waypoint_flag_idle.dae`,
} as const;

export const AUDIO_ASSETS = {
  select: [`${ASSET_BASE}/audio/sel_universal.ogg`],
  selectCivicCenter: [`${ASSET_BASE}/audio/sel_civ_center.ogg`],
  selectBarracks: [`${ASSET_BASE}/audio/sel_barracks.ogg`],
  selectTemple: [`${ASSET_BASE}/audio/sel_temple.ogg`],
  selectBlacksmith: [`${ASSET_BASE}/audio/sel_forge.ogg`],
  selectMarket: [`${ASSET_BASE}/audio/sel_market.ogg`],
  selectStable: [`${ASSET_BASE}/audio/sel_stable.ogg`],
  order: [`${ASSET_BASE}/audio/order_click_01.ogg`, `${ASSET_BASE}/audio/order_click_02.ogg`],
  error: [`${ASSET_BASE}/audio/error.ogg`],
  sword: [`${ASSET_BASE}/audio/sword_01.ogg`, `${ASSET_BASE}/audio/sword_02.ogg`, `${ASSET_BASE}/audio/spear_01.ogg`],
  bow: [`${ASSET_BASE}/audio/bow_01.ogg`, `${ASSET_BASE}/audio/bow_02.ogg`, `${ASSET_BASE}/audio/jav_01.ogg`],
  wood: [`${ASSET_BASE}/audio/wood_01.ogg`, `${ASSET_BASE}/audio/wood_02.ogg`],
  stone: [`${ASSET_BASE}/audio/stone_01.ogg`],
  metal: [`${ASSET_BASE}/audio/metal_01.ogg`],
  food: [`${ASSET_BASE}/audio/forage_01.ogg`],
  buildComplete: [`${ASSET_BASE}/audio/build_complete.ogg`],
  trainInfantry: [`${ASSET_BASE}/audio/train_infantry.ogg`],
  trainFemale: [`${ASSET_BASE}/audio/train_female.ogg`],
  capture: [`${ASSET_BASE}/audio/capture.ogg`],
  techComplete: [`${ASSET_BASE}/audio/tech_complete.ogg`],
  phaseUp: [`${ASSET_BASE}/audio/phase_up.ogg`],
  underAttack: [`${ASSET_BASE}/audio/under_attack.ogg`],
  victory: [`${ASSET_BASE}/audio/victory.ogg`],
  defeat: [`${ASSET_BASE}/audio/defeat.ogg`],
  music: `${ASSET_BASE}/audio/music_medit.ogg`,
} as const;

export const ANIMATION_ASSETS = {
  hopliteIdle: `${ASSET_BASE}/animations/hoplite_idle.dae`,
  hopliteWalk: `${ASSET_BASE}/animations/hoplite_walk.dae`,
  hopliteAttack: `${ASSET_BASE}/animations/hoplite_attack.dae`,
  swordsmanIdle: `${ASSET_BASE}/animations/swordsman_idle.dae`,
  swordsmanWalk: `${ASSET_BASE}/animations/swordsman_walk.dae`,
  swordsmanAttack: `${ASSET_BASE}/animations/swordsman_attack.dae`,
  archerIdle: `${ASSET_BASE}/animations/archer_idle.dae`,
  archerWalk: `${ASSET_BASE}/animations/archer_walk.dae`,
  archerAttack: `${ASSET_BASE}/animations/archer_attack.dae`,
  javelinIdle: `${ASSET_BASE}/animations/javelin_idle.dae`,
  javelinWalk: `${ASSET_BASE}/animations/javelin_walk.dae`,
  javelinAttack: `${ASSET_BASE}/animations/javelin_attack.dae`,
  femaleIdle: `${ASSET_BASE}/animations/female_idle.dae`,
  femaleWalk: `${ASSET_BASE}/animations/female_walk.dae`,
  gatherFruitF: `${ASSET_BASE}/animations/gather_fruit_f.dae`,
  gatherFruitM: `${ASSET_BASE}/animations/gather_fruit_m.dae`,
  gatherWood: `${ASSET_BASE}/animations/gather_wood.dae`,
  gatherMine: `${ASSET_BASE}/animations/gather_mine.dae`,
  farming: `${ASSET_BASE}/animations/farming.dae`,
  slaughter: `${ASSET_BASE}/animations/slaughter.dae`,
  gatherMeat: `${ASSET_BASE}/animations/gather_meat.dae`,
  build: `${ASSET_BASE}/animations/build.dae`,
  horseIdle: `${ASSET_BASE}/animations/horse_idle.dae`,
  horseGallop: `${ASSET_BASE}/animations/horse_gallop.dae`,
  horseAttack: `${ASSET_BASE}/animations/horse_attack.dae`,
  riderIdle: `${ASSET_BASE}/animations/rider_idle.dae`,
  riderGallop: `${ASSET_BASE}/animations/rider_gallop.dae`,
  riderAttack: `${ASSET_BASE}/animations/rider_attack.dae`,
  deerIdle: `${ASSET_BASE}/animations/deer_idle.dae`,
  deerRun: `${ASSET_BASE}/animations/deer_run.dae`,
  deerDeath: `${ASSET_BASE}/animations/deer_death.dae`,
  boarIdle: `${ASSET_BASE}/animations/boar_idle.dae`,
  boarRun: `${ASSET_BASE}/animations/boar_run.dae`,
  boarAttack: `${ASSET_BASE}/animations/boar_attack.dae`,
  boarDeath: `${ASSET_BASE}/animations/boar_death.dae`,
  waypointFlagIdle: `${ASSET_BASE}/animations/waypoint_flag_idle.dae`,
} as const;
