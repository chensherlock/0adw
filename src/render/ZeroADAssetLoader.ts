import * as THREE from 'three';
import { ColladaLoader } from 'three/examples/jsm/loaders/ColladaLoader.js';
import * as SkeletonUtils from 'three/examples/jsm/utils/SkeletonUtils.js';
import { ANIMATION_ASSETS, ASSET_BASE } from '../config/assets';
import { CivId, ResourceType } from '../config/types';

export type ZeroADMaterialMode = 'player' | 'alpha' | 'opaque';

export type ToolMode = 'combat' | 'axe' | 'pick' | 'hoe' | 'mallet' | 'basket' | 'knife';

export type UnitAnimKey =
  | 'idle'
  | 'walk'
  | 'attack'
  | 'gather_wood'
  | 'gather_mine'
  | 'gather_food'
  | 'gather_grain'
  | 'gather_meat'
  | 'slaughter'
  | 'build'
  | 'death';

export interface AnimClipSet {
  idle: string;
  walk?: string;
  attack?: string;
  gather_wood?: string;
  gather_mine?: string;
  gather_food?: string;
  gather_grain?: string;
  gather_meat?: string;
  slaughter?: string;
  build?: string;
  death?: string;
}

export interface ModelPartSpec {
  mesh: string;
  texture: string;
  normTex?: string;
  mode: ZeroADMaterialMode;
  roughness?: number;
  metalness?: number;
  emissive?: number;
  /** Optional subtle multiplicative color tint (e.g. for distinct botanical hybrid tree foliage) */
  tint?: number;
  doubleSide?: boolean;
  /** Attach inside parent's named prop bone (e.g. 'prop-head', 'prop-weapon_R', 'prop_rider') */
  attachPoint?: string;
  /** Optional nested parts attached to this part (e.g. cavalry rider's head/helmet/weapon) */
  children?: ModelPartSpec[];
  /** Mark this part's wrapper as the weapon swing pivot (used only before skeletal clips load) */
  isWeapon?: boolean;
  /** Combat gear hidden automatically while worker holds a gathering/building tool */
  isCombatGear?: boolean;
  /** Task-specific worker tool (shown only when UnitAnimator activates this ToolMode) */
  toolRole?: Exclude<ToolMode, 'combat'>;
  /** Skeletal animation clip set for this skinned mesh */
  animations?: AnimClipSet;
}

export interface EntityModelSpec {
  parts: ModelPartSpec[];
  /** Fit max(width, depth) to this world size (used for buildings & rocks) */
  targetFootprint?: number;
  /** Fit total height to this world size (used for units & trees) */
  targetHeight?: number;
  /** Optional extra Y rotation in radians to align forward direction (+Z) */
  rotateY?: number;
  /** Slight vertical sink into ground (e.g. -0.08 for buildings on gentle slopes) */
  sinkY?: number;
}

const MODELS = `${ASSET_BASE}/models`;
const TEX = `${ASSET_BASE}/textures`;

function m(name: string): string {
  return `${MODELS}/${name}`;
}
function t(name: string): string {
  return `${TEX}/${name}`;
}

const HOPLITE_ANIMS: AnimClipSet = {
  idle: ANIMATION_ASSETS.hopliteIdle,
  walk: ANIMATION_ASSETS.hopliteWalk,
  attack: ANIMATION_ASSETS.hopliteAttack,
  gather_wood: ANIMATION_ASSETS.gatherWood,
  gather_mine: ANIMATION_ASSETS.gatherMine,
  gather_food: ANIMATION_ASSETS.gatherFruitM,
  gather_grain: ANIMATION_ASSETS.farming,
  gather_meat: ANIMATION_ASSETS.gatherMeat,
  slaughter: ANIMATION_ASSETS.slaughter,
  build: ANIMATION_ASSETS.build,
};

const SWORDSMAN_ANIMS: AnimClipSet = {
  idle: ANIMATION_ASSETS.swordsmanIdle,
  walk: ANIMATION_ASSETS.swordsmanWalk,
  attack: ANIMATION_ASSETS.swordsmanAttack,
  gather_wood: ANIMATION_ASSETS.gatherWood,
  gather_mine: ANIMATION_ASSETS.gatherMine,
  gather_food: ANIMATION_ASSETS.gatherFruitM,
  gather_grain: ANIMATION_ASSETS.farming,
  gather_meat: ANIMATION_ASSETS.gatherMeat,
  slaughter: ANIMATION_ASSETS.slaughter,
  build: ANIMATION_ASSETS.build,
};

const ARCHER_ANIMS: AnimClipSet = {
  idle: ANIMATION_ASSETS.archerIdle,
  walk: ANIMATION_ASSETS.archerWalk,
  attack: ANIMATION_ASSETS.archerAttack,
  gather_wood: ANIMATION_ASSETS.gatherWood,
  gather_mine: ANIMATION_ASSETS.gatherMine,
  gather_food: ANIMATION_ASSETS.gatherFruitM,
  gather_grain: ANIMATION_ASSETS.farming,
  gather_meat: ANIMATION_ASSETS.gatherMeat,
  slaughter: ANIMATION_ASSETS.slaughter,
  build: ANIMATION_ASSETS.build,
};

const JAVELIN_ANIMS: AnimClipSet = {
  idle: ANIMATION_ASSETS.javelinIdle,
  walk: ANIMATION_ASSETS.javelinWalk,
  attack: ANIMATION_ASSETS.javelinAttack,
  gather_wood: ANIMATION_ASSETS.gatherWood,
  gather_mine: ANIMATION_ASSETS.gatherMine,
  gather_food: ANIMATION_ASSETS.gatherFruitM,
  gather_grain: ANIMATION_ASSETS.farming,
  gather_meat: ANIMATION_ASSETS.gatherMeat,
  slaughter: ANIMATION_ASSETS.slaughter,
  build: ANIMATION_ASSETS.build,
};

const FEMALE_ANIMS: AnimClipSet = {
  idle: ANIMATION_ASSETS.femaleIdle,
  walk: ANIMATION_ASSETS.femaleWalk,
  attack: ANIMATION_ASSETS.slaughter,
  gather_wood: ANIMATION_ASSETS.gatherWood,
  gather_mine: ANIMATION_ASSETS.gatherMine,
  gather_food: ANIMATION_ASSETS.gatherFruitF,
  gather_grain: ANIMATION_ASSETS.farming,
  gather_meat: ANIMATION_ASSETS.gatherMeat,
  slaughter: ANIMATION_ASSETS.slaughter,
  build: ANIMATION_ASSETS.build,
};

const HEALER_ANIMS: AnimClipSet = {
  idle: ANIMATION_ASSETS.femaleIdle,
  walk: ANIMATION_ASSETS.femaleWalk,
  gather_food: ANIMATION_ASSETS.gatherFruitF,
};

/** Authentic 0 A.D. task-specific worker tools attached to their official biped bones */
const WORKER_TOOLS: ModelPartSpec[] = [
  { mesh: m('tool_axe.dae'), texture: t('prop_weap.png'), mode: 'opaque', attachPoint: 'prop-weapon_L', toolRole: 'axe' },
  { mesh: m('tool_pick.dae'), texture: t('prop_weap.png'), mode: 'opaque', attachPoint: 'prop-weapon_R', toolRole: 'pick' },
  { mesh: m('tool_hoe.dae'), texture: t('prop_weap.png'), mode: 'opaque', attachPoint: 'prop-weapon_R', toolRole: 'hoe' },
  { mesh: m('prop_mallet.dae'), texture: t('prop_weap.png'), mode: 'opaque', attachPoint: 'prop-weapon_R', toolRole: 'mallet' },
  { mesh: m('dagger_01.dae'), texture: t('prop_weap.png'), mode: 'opaque', attachPoint: 'prop-weapon_R', toolRole: 'knife' },
  { mesh: m('berry_basket.dae'), texture: t('basket_rome_1.png'), mode: 'opaque', toolRole: 'basket' },
];

const HORSE_ANIMS: AnimClipSet = {
  idle: ANIMATION_ASSETS.horseIdle,
  walk: ANIMATION_ASSETS.horseGallop,
  attack: ANIMATION_ASSETS.horseAttack,
  gather_wood: ANIMATION_ASSETS.horseIdle,
  gather_mine: ANIMATION_ASSETS.horseIdle,
  gather_food: ANIMATION_ASSETS.horseIdle,
  build: ANIMATION_ASSETS.horseIdle,
};

const RIDER_ANIMS: AnimClipSet = {
  idle: ANIMATION_ASSETS.riderIdle,
  walk: ANIMATION_ASSETS.riderGallop,
  attack: ANIMATION_ASSETS.riderAttack,
  gather_wood: ANIMATION_ASSETS.riderAttack,
  gather_mine: ANIMATION_ASSETS.riderAttack,
  gather_food: ANIMATION_ASSETS.riderIdle,
  build: ANIMATION_ASSETS.riderAttack,
};

export function getZeroADModelSpec(templateId: string, civId: CivId): EntityModelSpec | null {
  const isRome = civId === 'romans';
  const isPersia = civId === 'persians';
  const isSparta = civId === 'spartans';
  const isCarth = civId === 'carthaginians';
  const isPtol = civId === 'ptolemies';

  switch (templateId) {
    // ======================== RESOURCES (GAIA) ========================
    case 'tree_cypress':
      return {
        targetHeight: 6.4,
        parts: [
          { mesh: m('tree_cypress_med.dae'), texture: t('tree_cypress_f.png'), mode: 'alpha', roughness: 0.9, doubleSide: true },
          { mesh: m('tree_cypress_med_branches.dae'), texture: t('tree_cypress.png'), mode: 'alpha', roughness: 0.9, doubleSide: true },
        ],
      };

    case 'tree_olive':
      return {
        targetHeight: 4.1,
        parts: [
          { mesh: m('tree_olive_01.dae'), texture: t('tree_olive.png'), mode: 'alpha', roughness: 0.9, doubleSide: true },
        ],
      };

    case 'tree_pine':
      return {
        targetHeight: 6.0,
        parts: [
          { mesh: m('tree_pine_aleppo_1.dae'), texture: t('aleppo_pine.png'), mode: 'alpha', roughness: 0.9, doubleSide: true },
        ],
      };

    case 'tree_palm':
      return {
        targetHeight: 5.8,
        parts: [
          { mesh: m('tree_cretan_date_palm_01.dae'), texture: t('tree_palm_senegal_a.png'), mode: 'alpha', roughness: 0.88, doubleSide: true },
        ],
      };

    case 'tree_oak':
      return {
        targetHeight: 5.4,
        parts: [
          { mesh: m('oak_tree_a.dae'), texture: t('oak_tree_a.png'), mode: 'alpha', roughness: 0.9, doubleSide: true },
        ],
      };

    case 'tree_bamboo':
      return {
        targetHeight: 6.4,
        parts: [
          {
            mesh: m('bamboo_1.dae'),
            texture: t('bamboo_1.png'),
            normTex: t('bamboo_1_norm.png'),
            mode: 'alpha',
            roughness: 0.84,
            doubleSide: true,
          },
          {
            mesh: m('bamboo_2.dae'),
            texture: t('bamboo_1.png'),
            normTex: t('bamboo_1_norm.png'),
            mode: 'alpha',
            roughness: 0.84,
            doubleSide: true,
          },
        ],
      };

    case 'tree_cedar':
      return {
        targetHeight: 7.0,
        parts: [
          { mesh: m('cedar_atlas_1.dae'), texture: t('cedar_atlas_1.png'), mode: 'alpha', roughness: 0.9, doubleSide: true },
        ],
      };

    case 'tree_willow':
      return {
        targetHeight: 5.8,
        parts: [
          { mesh: m('willow_a.dae'), texture: t('willow_green.png'), mode: 'alpha', roughness: 0.88, doubleSide: true },
        ],
      };

    case 'tree_apple':
      return {
        targetHeight: 4.5,
        parts: [
          { mesh: m('tree_apple_trunk_a.dae'), texture: t('trunk_deciduous_a.png'), mode: 'opaque', roughness: 0.94 },
          { mesh: m('tree_apple_top_a.dae'), texture: t('orchard_apple_a.png'), mode: 'alpha', roughness: 0.88, doubleSide: true },
        ],
      };

    case 'tree_orange':
      return {
        targetHeight: 4.3,
        parts: [
          { mesh: m('tree_apple_trunk_b.dae'), texture: t('trunk_deciduous_a.png'), mode: 'opaque', roughness: 0.94 },
          { mesh: m('tree_apple_top_b.dae'), texture: t('orchard_orange_a.png'), mode: 'alpha', roughness: 0.88, doubleSide: true },
        ],
      };

    case 'tree_fig':
      return {
        targetHeight: 4.6,
        parts: [
          { mesh: m('tree_fig_trunk_a.dae'), texture: t('trunk_baobab.png'), mode: 'opaque', roughness: 0.94 },
          { mesh: m('tree_fig_top_a.dae'), texture: t('tree_carob_a.png'), mode: 'alpha', roughness: 0.88, doubleSide: true },
        ],
      };

    case 'tree_date_palm':
      return {
        targetHeight: 6.2,
        parts: [
          { mesh: m('palm_date_new_fruit_1.dae'), texture: t('palm_date_new_3_fruiting.png'), mode: 'alpha', roughness: 0.9, doubleSide: true },
        ],
      };

    case 'tree_cherry':
      return {
        targetHeight: 4.8,
        parts: [
          { mesh: m('tree_apple_trunk_a.dae'), texture: t('trunk_deciduous_a.png'), mode: 'opaque', roughness: 0.92 },
          { mesh: m('tree_apple_top_a.dae'), texture: t('foliage_cherry.png'), mode: 'alpha', roughness: 0.84, doubleSide: true },
        ],
      };

    case 'tree_kapok':
      return {
        targetHeight: 6.2,
        parts: [
          { mesh: m('tree_apple_trunk_b.dae'), texture: t('trunk_deciduous_a.png'), mode: 'opaque', roughness: 0.92 },
          { mesh: m('tree_apple_top_b.dae'), texture: t('foliage_kapok.png'), mode: 'alpha', roughness: 0.85, doubleSide: true },
        ],
      };

    case 'tree_maple':
      return {
        targetHeight: 5.2,
        parts: [
          { mesh: m('tree_apple_trunk_a.dae'), texture: t('trunk_deciduous_a.png'), mode: 'opaque', roughness: 0.92 },
          { mesh: m('tree_apple_top_a.dae'), texture: t('foliage_maple.png'), mode: 'alpha', roughness: 0.86, doubleSide: true },
        ],
      };

    case 'tree_jacaranda':
      return {
        targetHeight: 5.8,
        parts: [
          { mesh: m('willow_a.dae'), texture: t('foliage_jacaranda.png'), mode: 'alpha', roughness: 0.85, doubleSide: true },
        ],
      };

    case 'tree_flamboyant':
      return {
        targetHeight: 5.5,
        parts: [
          { mesh: m('tree_fig_trunk_a.dae'), texture: t('trunk_baobab.png'), mode: 'opaque', roughness: 0.92 },
          { mesh: m('tree_fig_top_a.dae'), texture: t('foliage_flamboyant.png'), mode: 'alpha', roughness: 0.84, doubleSide: true },
        ],
      };

    case 'tree_golden_shower':
      return {
        targetHeight: 5.6,
        parts: [
          { mesh: m('willow_a.dae'), texture: t('foliage_golden_shower.png'), mode: 'alpha', roughness: 0.84, doubleSide: true },
        ],
      };

    case 'tree_trumpet':
      return {
        targetHeight: 4.9,
        parts: [
          { mesh: m('tree_apple_trunk_b.dae'), texture: t('trunk_deciduous_a.png'), mode: 'opaque', roughness: 0.92 },
          { mesh: m('tree_apple_top_b.dae'), texture: t('foliage_trumpet.png'), mode: 'alpha', roughness: 0.84, doubleSide: true },
        ],
      };

    case 'tree_ginkgo':
      return {
        targetHeight: 5.8,
        parts: [
          { mesh: m('tree_apple_trunk_a.dae'), texture: t('trunk_deciduous_a.png'), mode: 'opaque', roughness: 0.92 },
          { mesh: m('tree_apple_top_a.dae'), texture: t('foliage_ginkgo.png'), mode: 'alpha', roughness: 0.85, doubleSide: true },
        ],
      };

    case 'tree_birch':
      return {
        targetHeight: 5.9,
        parts: [
          { mesh: m('tree_apple_trunk_a.dae'), texture: t('trunk_birch_white.png'), mode: 'opaque', roughness: 0.88 },
          { mesh: m('tree_apple_top_a.dae'), texture: t('foliage_birch.png'), mode: 'alpha', roughness: 0.86, doubleSide: true },
        ],
      };

    case 'tree_blue_spruce':
      return {
        targetHeight: 6.8,
        parts: [
          { mesh: m('cedar_atlas_1.dae'), texture: t('foliage_blue_spruce.png'), mode: 'alpha', roughness: 0.88, doubleSide: true },
        ],
      };

    case 'tree_coconut':
      return {
        targetHeight: 6.4,
        parts: [
          { mesh: m('palm_date_new_fruit_1.dae'), texture: t('foliage_coconut_palm.png'), mode: 'alpha', roughness: 0.88, doubleSide: true },
        ],
      };

    case 'tree_hybrid_golden_citrus':
      return {
        targetHeight: 5.1,
        parts: [
          { mesh: m('tree_apple_trunk_b.dae'), texture: t('trunk_deciduous_a.png'), mode: 'opaque', roughness: 0.92 },
          { mesh: m('tree_apple_top_b.dae'), texture: t('orchard_orange_a.png'), tint: 0xffeb99, mode: 'alpha', roughness: 0.84, doubleSide: true },
        ],
      };

    case 'tree_hybrid_honey_fig':
      return {
        targetHeight: 5.4,
        parts: [
          { mesh: m('tree_fig_trunk_a.dae'), texture: t('trunk_baobab.png'), mode: 'opaque', roughness: 0.92 },
          { mesh: m('tree_fig_top_a.dae'), texture: t('tree_carob_a.png'), tint: 0xffe484, mode: 'alpha', roughness: 0.85, doubleSide: true },
        ],
      };

    case 'tree_hybrid_cedar_oak':
      return {
        targetHeight: 8.2,
        parts: [
          { mesh: m('cedar_atlas_1.dae'), texture: t('cedar_atlas_1.png'), tint: 0xc2f0c2, mode: 'alpha', roughness: 0.88, doubleSide: true },
        ],
      };

    case 'tree_hybrid_iron_bamboo':
      return {
        targetHeight: 7.4,
        parts: [
          { mesh: m('bamboo_1.dae'), texture: t('bamboo_1.png'), normTex: t('bamboo_1_norm.png'), tint: 0xa7f3d0, mode: 'alpha', roughness: 0.82, doubleSide: true },
          { mesh: m('bamboo_2.dae'), texture: t('bamboo_1.png'), normTex: t('bamboo_1_norm.png'), tint: 0x99f6e4, mode: 'alpha', roughness: 0.82, doubleSide: true },
        ],
      };

    case 'tree_hybrid_olive_citrus':
      return {
        targetHeight: 4.9,
        parts: [
          { mesh: m('tree_apple_trunk_a.dae'), texture: t('trunk_deciduous_a.png'), mode: 'opaque', roughness: 0.92 },
          { mesh: m('tree_apple_top_a.dae'), texture: t('orchard_apple_a.png'), tint: 0xd9f99d, mode: 'alpha', roughness: 0.85, doubleSide: true },
        ],
      };

    case 'tree_hybrid_royal_orchard':
      return {
        targetHeight: 6.2,
        parts: [
          { mesh: m('tree_apple_trunk_b.dae'), texture: t('trunk_deciduous_a.png'), mode: 'opaque', roughness: 0.9 },
          { mesh: m('tree_apple_top_b.dae'), texture: t('orchard_miracle_gold.png'), emissive: 0x1e1600, mode: 'alpha', roughness: 0.78, doubleSide: true },
        ],
      };

    case 'treasure_chest':
      return {
        targetHeight: 1.55,
        parts: [
          { mesh: m('treasure_pers_2.dae'), texture: t('pers_struct_treasure.png'), mode: 'opaque', roughness: 0.72 },
        ],
      };

    case 'treasure_amphora':
      return {
        targetHeight: 1.35,
        parts: [
          { mesh: m('amphorae_treasure.dae'), texture: t('hele_props_a.png'), mode: 'opaque', roughness: 0.78 },
        ],
      };

    case 'treasure_relic':
      return {
        targetHeight: 1.6,
        parts: [
          { mesh: m('treasure_pers_4.dae'), texture: t('pers_struct_treasure.png'), mode: 'opaque', roughness: 0.72 },
        ],
      };

    case 'berry_bush':
      return {
        targetHeight: 1.45,
        parts: [
          { mesh: m('berry_bush_01.dae'), texture: t('berry_bush_01.png'), mode: 'alpha', roughness: 0.88, doubleSide: true },
        ],
      };

    case 'grape_vine':
      return {
        targetHeight: 1.18,
        parts: [
          { mesh: m('grape_bush.dae'), texture: t('grape_bushes.png'), mode: 'alpha', roughness: 0.86, doubleSide: true },
        ],
      };

    case 'deer_herd':
      return {
        targetHeight: 1.4,
        parts: [
          {
            mesh: m('deer_mesh.dae'),
            texture: t('animal_deer_01.png'),
            mode: 'opaque',
            roughness: 0.85,
            animations: {
              idle: ANIMATION_ASSETS.deerIdle,
              walk: ANIMATION_ASSETS.deerRun,
              death: ANIMATION_ASSETS.deerDeath,
            },
          },
        ],
      };

    case 'wild_boar':
      return {
        targetHeight: 0.95,
        parts: [
          {
            mesh: m('animal_boar.dae'),
            texture: t('animal_boar_01.png'),
            mode: 'opaque',
            roughness: 0.88,
            animations: {
              idle: ANIMATION_ASSETS.boarIdle,
              walk: ANIMATION_ASSETS.boarRun,
              attack: ANIMATION_ASSETS.boarAttack,
              death: ANIMATION_ASSETS.boarDeath,
            },
          },
        ],
      };

    case 'wild_gazelle':
      return {
        targetHeight: 1.28,
        parts: [
          {
            mesh: m('deer_mesh.dae'),
            texture: t('animal_gazelle.png'),
            mode: 'opaque',
            roughness: 0.84,
            animations: {
              idle: ANIMATION_ASSETS.deerIdle,
              walk: ANIMATION_ASSETS.deerRun,
              death: ANIMATION_ASSETS.deerDeath,
            },
          },
        ],
      };

    case 'wild_elephant':
      return {
        targetHeight: 3.1,
        parts: [
          {
            mesh: m('elephant_asian_male.dae'),
            texture: t('animal_elephant_asian.png'),
            normTex: t('animal_elephant_asian_norm.png'),
            mode: 'opaque',
            roughness: 0.9,
            animations: {
              idle: ANIMATION_ASSETS.elephantIdle,
              walk: ANIMATION_ASSETS.elephantWalk,
              attack: ANIMATION_ASSETS.elephantWalk,
            },
          },
        ],
      };

    case 'predator_wolf':
      return {
        targetHeight: 1.02,
        parts: [
          {
            mesh: m('wolf.dae'),
            texture: t('animal_wolf_grey.png'),
            mode: 'opaque',
            roughness: 0.88,
            animations: {
              idle: ANIMATION_ASSETS.wolfIdle,
              walk: ANIMATION_ASSETS.wolfWalk,
              attack: ANIMATION_ASSETS.wolfAttack,
            },
          },
        ],
      };

    case 'predator_lion':
      return {
        targetHeight: 1.32,
        parts: [
          {
            mesh: m('animal_lion.dae'),
            texture: t('animal_lion.png'),
            mode: 'opaque',
            roughness: 0.86,
            animations: {
              idle: ANIMATION_ASSETS.lionIdle,
              walk: ANIMATION_ASSETS.lionWalk,
              attack: ANIMATION_ASSETS.lionWalk,
            },
          },
        ],
      };

    case 'predator_bear':
      return {
        targetHeight: 1.68,
        parts: [
          {
            mesh: m('bear.dae'),
            texture: t('animal_bear_brown.png'),
            mode: 'opaque',
            roughness: 0.9,
            animations: {
              idle: ANIMATION_ASSETS.bearIdle,
              walk: ANIMATION_ASSETS.bearWalk,
              attack: ANIMATION_ASSETS.bearAttack,
            },
          },
        ],
      };

    case 'predator_polar_bear':
      return {
        targetHeight: 1.78,
        parts: [
          {
            mesh: m('bear_polar.dae'),
            texture: t('animal_bear_white.png'),
            mode: 'opaque',
            roughness: 0.88,
            animations: {
              idle: ANIMATION_ASSETS.bearIdle,
              walk: ANIMATION_ASSETS.bearWalk,
              attack: ANIMATION_ASSETS.bearAttack,
            },
          },
        ],
      };

    case 'predator_tiger':
      return {
        targetHeight: 1.32,
        parts: [
          {
            mesh: m('tiger.dae'),
            texture: t('animal_tiger.png'),
            mode: 'opaque',
            roughness: 0.84,
            animations: {
              idle: ANIMATION_ASSETS.lionIdle,
              walk: ANIMATION_ASSETS.lionWalk,
              attack: ANIMATION_ASSETS.lionWalk,
            },
          },
        ],
      };

    case 'predator_hippo':
      return {
        targetHeight: 1.85,
        parts: [
          {
            mesh: m('fauna_hippopotamus.dae'),
            texture: t('fauna_hippopotamus_01.png'),
            mode: 'opaque',
            roughness: 0.78,
          },
        ],
      };

    case 'wild_sheep':
      return {
        targetHeight: 0.92,
        parts: [
          {
            mesh: m('sheep.dae'),
            texture: t('animal_sheep.png'),
            mode: 'opaque',
            roughness: 0.92,
          },
        ],
      };

    case 'wild_goat':
      return {
        targetHeight: 0.96,
        parts: [
          {
            mesh: m('goat.dae'),
            texture: t('animal_goat.png'),
            mode: 'opaque',
            roughness: 0.9,
          },
        ],
      };

    case 'wild_chicken':
      return {
        targetHeight: 0.56,
        parts: [
          {
            mesh: m('chicken.dae'),
            texture: t('animal_chicken.png'),
            mode: 'alpha',
            roughness: 0.85,
            doubleSide: true,
          },
        ],
      };

    case 'wild_camel':
      return {
        targetHeight: 2.05,
        parts: [
          {
            mesh: m('camel_1.dae'),
            texture: t('animal_camel_a.png'),
            mode: 'opaque',
            roughness: 0.88,
          },
        ],
      };

    case 'wild_aurochs':
      return {
        targetHeight: 1.65,
        parts: [
          {
            mesh: m('auroch_a.dae'),
            texture: t('animal_cattle_black.png'),
            mode: 'opaque',
            roughness: 0.88,
          },
        ],
      };

    case 'sea_walrus':
      return {
        targetHeight: 1.25,
        sinkY: -0.15,
        parts: [
          {
            mesh: m('walrus.dae'),
            texture: t('animal_walrus.png'),
            mode: 'opaque',
            roughness: 0.65,
          },
        ],
      };

    case 'sea_whale':
      return {
        targetFootprint: 5.8,
        sinkY: -0.35,
        parts: [
          {
            mesh: m('whale.dae'),
            texture: t('animal_whale.png'),
            mode: 'opaque',
            roughness: 0.55,
          },
        ],
      };

    case 'wild_eagle':
      return {
        targetHeight: 1.05,
        // Note: hawk_flight.dae rotates the Body bone 180 deg around Z on every frame,
        // which already orients hawk.dae head-first (+Z). Do NOT add rotateY: Math.PI here!
        parts: [
          {
            mesh: m('hawk.dae'),
            texture: t('animal_hawk.png'),
            mode: 'alpha',
            roughness: 0.85,
            doubleSide: true,
            animations: {
              idle: ANIMATION_ASSETS.hawkFlight,
              walk: ANIMATION_ASSETS.hawkFlight,
            },
          },
        ],
      };

    case 'wild_seagull':
      return {
        targetHeight: 0.78,
        rotateY: Math.PI,
        parts: [
          {
            mesh: m('seagull.dae'),
            texture: t('animal_seagull.png'),
            mode: 'opaque',
            roughness: 0.8,
            doubleSide: true,
            animations: {
              idle: ANIMATION_ASSETS.seagullFlight,
              walk: ANIMATION_ASSETS.seagullFlight,
            },
          },
        ],
      };

    case 'fishing_boat':
      return {
        targetFootprint: 3.55,
        sinkY: -0.05,
        parts: [
          {
            mesh: m('hele_fishing_boat.dae'),
            texture: t('hele_fishing_boat.png'),
            mode: 'player',
            roughness: 0.84,
            animations: {
              idle: ANIMATION_ASSETS.rowingBoatIdle,
              walk: ANIMATION_ASSETS.rowingBoatMove,
              gather_food: ANIMATION_ASSETS.rowingBoatIdle,
            },
            children: [
              {
                mesh: m('fish_bucket.dae'),
                texture: t('hele_fishing_boat.png'),
                mode: 'player',
                attachPoint: 'prop_fish_bucket',
              },
              {
                mesh: m('m_tunic_short.dae'),
                texture: t('hele_tunic_01_01.png'),
                mode: 'player',
                attachPoint: 'prop_fisherman',
                children: [
                  {
                    mesh: m('dude_head.dae'),
                    texture: t('head_hele_a.png'),
                    mode: 'opaque',
                    attachPoint: 'prop-head',
                  },
                ],
              },
            ],
          },
        ],
      };

    case 'warship_trireme': {
      if (isRome) {
        return {
          targetFootprint: 7.4,
          sinkY: -0.18,
          parts: [
            {
              mesh: m('rome_ship_trireme.dae'),
              texture: t('rome_trireme.png'),
              mode: 'player',
              roughness: 0.8,
              children: [
                {
                  mesh: m('rome_trireme_main_sail.dae'),
                  texture: t('rome_sail_1.png'),
                  mode: 'player',
                  doubleSide: true,
                  attachPoint: 'prop_main_sail',
                },
              ],
            },
          ],
        };
      }
      return {
        targetFootprint: 7.4,
        sinkY: -0.18,
        parts: [
          {
            mesh: m('hele_ship_trireme.dae'),
            texture: t('hele_trireme_big.png'),
            mode: 'player',
            roughness: 0.8,
            animations: {
              idle: ANIMATION_ASSETS.triremeIdle,
              walk: ANIMATION_ASSETS.triremeMove,
            },
            children: [
              {
                mesh: m('hele_trireme_mainsail.dae'),
                texture: t('hele_sail_eye_war.png'),
                mode: 'player',
                doubleSide: true,
                attachPoint: 'prop_sail',
              },
              {
                mesh: m('hele_trireme_foresail.dae'),
                texture: t('sail_blank_netting.png'),
                mode: 'player',
                doubleSide: true,
                attachPoint: 'prop_sail',
              },
            ],
          },
        ],
      };
    }

    case 'stone_quarry':
      return {
        targetFootprint: 4.5,
        sinkY: -0.06,
        parts: [
          {
            mesh: m('geo_stonemine_large.dae'),
            texture: t('stone_aegean_01.png'),
            normTex: t('stone_india_01_norm.png'),
            mode: 'opaque',
            roughness: 0.78,
            emissive: 0x1c1b19,
          },
        ],
      };

    case 'marble_quarry':
      return {
        targetFootprint: 4.6,
        sinkY: -0.06,
        parts: [
          {
            mesh: m('stonemine_granite_a.dae'),
            texture: t('stonequarry_marble.png'),
            normTex: t('stone_india_01_norm.png'),
            mode: 'opaque',
            roughness: 0.65,
            metalness: 0.06,
            emissive: 0x262624,
          },
        ],
      };

    case 'metal_mine':
      return {
        targetFootprint: 4.4,
        sinkY: -0.06,
        parts: [
          {
            mesh: m('geo_mineral_01.dae'),
            texture: t('slab_medit_metal.png'),
            normTex: t('stone_india_01_norm.png'),
            mode: 'opaque',
            roughness: 0.36,
            metalness: 0.58,
            emissive: 0x3b2a10,
          },
        ],
      };

    case 'gold_vein':
      return {
        targetFootprint: 4.6,
        sinkY: -0.06,
        parts: [
          {
            mesh: m('stonemine_round_a.dae'),
            texture: t('metal_gold_aegean.png'),
            normTex: t('metal_gold_aegean_norm.png'),
            mode: 'opaque',
            roughness: 0.3,
            metalness: 0.68,
            emissive: 0x4d340a,
          },
        ],
      };

    case 'rally_flag':
      return {
        targetHeight: 3.1,
        parts: [
          {
            mesh: m('waypoint_flag.dae'),
            texture: isRome ? t('banner_romans.png') : t('banner_greek.png'),
            mode: 'alpha',
            doubleSide: true,
            roughness: 0.72,
            animations: { idle: ANIMATION_ASSETS.waypointFlagIdle },
          },
        ],
      };

    // ======================== BUILDINGS ========================
    case 'civic_center':
      if (civId === 'han') {
        return {
          targetFootprint: 7.6,
          sinkY: -0.1,
          parts: [
            { mesh: m('han_fortress.dae'), texture: t('han_struct_02.png'), normTex: t('han_struct_02_norm.png'), mode: 'player' },
          ],
        };
      }
      if (civId === 'ptolemies') {
        return {
          targetFootprint: 7.5,
          sinkY: -0.1,
          parts: [{ mesh: m('ptol_civic_centre.dae'), texture: t('ptol_struct.png'), mode: 'player' }],
        };
      }
      if (civId === 'britons') {
        return {
          targetFootprint: 7.4,
          sinkY: -0.1,
          parts: [{ mesh: m('brit_civic_centre_struct1.dae'), texture: t('brit_struct_1.png'), mode: 'player' }],
        };
      }
      if (civId === 'gauls') {
        return {
          targetFootprint: 7.4,
          sinkY: -0.1,
          parts: [{ mesh: m('gaul_civic_centre_struct1.dae'), texture: t('gaul_struct_1.png'), mode: 'player' }],
        };
      }
      if (civId === 'persians') {
        return {
          targetFootprint: 7.6,
          sinkY: -0.1,
          parts: [{ mesh: m('pers_fortress.dae'), texture: t('pers_struct.png'), mode: 'player' }],
        };
      }
      if (civId === 'kushites') {
        return {
          targetFootprint: 7.5,
          sinkY: -0.1,
          parts: [{ mesh: m('kush_fortress.dae'), texture: t('kush_struct.png'), mode: 'player' }],
        };
      }
      if (civId === 'mauryas') {
        return {
          targetFootprint: 7.6,
          sinkY: -0.1,
          parts: [{ mesh: m('maur_fortress.dae'), texture: t('maur_struct.png'), mode: 'player' }],
        };
      }
      if (civId === 'carthaginians') {
        return {
          targetFootprint: 7.5,
          sinkY: -0.1,
          parts: [{ mesh: m('kart_fortress_b.dae'), texture: t('kart_struct.png'), mode: 'player' }],
        };
      }
      if (civId === 'iberians') {
        return {
          targetFootprint: 7.4,
          sinkY: -0.1,
          parts: [{ mesh: m('iber_fortress.dae'), texture: t('iber_struct.png'), mode: 'player' }],
        };
      }
      if (isRome) {
        return {
          targetFootprint: 7.4,
          sinkY: -0.1,
          parts: [
            { mesh: m('roman_cc.dae'), texture: t('rome_struct.png'), normTex: t('rome_struct_norm.png'), mode: 'player' },
            { mesh: m('roman_cc_columns.dae'), texture: t('rome_struct.png'), normTex: t('rome_struct_norm.png'), mode: 'opaque' },
            { mesh: m('roman_cc_transp.dae'), texture: t('rome_struct.png'), mode: 'alpha', doubleSide: true },
          ],
        };
      }
      if (isSparta) {
        return {
          targetFootprint: 7.4,
          sinkY: -0.1,
          parts: [
            { mesh: m('hele_fortress_up.dae'), texture: t('hele_struct_b.png'), normTex: t('hele_struct_b_norm.png'), mode: 'player' },
            { mesh: m('hele_fortress_up_tile_b.dae'), texture: t('hele_tile_b.png'), mode: 'player' },
            { mesh: m('hele_fortress_up_gate.dae'), texture: t('hele_gate.png'), mode: 'player' },
          ],
        };
      }
      return {
        targetFootprint: 7.4,
        sinkY: -0.1,
        parts: [
          { mesh: m('athen_cc_struct.dae'), texture: t('hele_struct.png'), normTex: t('hele_struct_norm.png'), mode: 'player' },
          { mesh: m('athen_cc_round_roof.dae'), texture: t('hele_struct.png'), mode: 'opaque' },
          { mesh: m('athen_cc_tiles_b.dae'), texture: t('hele_tile_b.png'), mode: 'player' },
          { mesh: m('athen_cc_decor.dae'), texture: t('hele_decor.png'), mode: 'player' },
        ],
      };

    case 'house':
      if (civId === 'han') {
        return { targetFootprint: 3.6, sinkY: -0.06, parts: [{ mesh: m('han_house_a.dae'), texture: t('han_struct_02.png'), normTex: t('han_struct_02_norm.png'), mode: 'player' }] };
      }
      if (civId === 'persians') {
        return { targetFootprint: 3.5, sinkY: -0.06, parts: [{ mesh: m('pers_house_a.dae'), texture: t('pers_struct.png'), mode: 'player' }] };
      }
      if (civId === 'ptolemies') {
        return { targetFootprint: 3.5, sinkY: -0.06, parts: [{ mesh: m('ptol_house_01.dae'), texture: t('ptol_struct.png'), mode: 'player' }] };
      }
      if (civId === 'kushites') {
        return { targetFootprint: 3.5, sinkY: -0.06, parts: [{ mesh: m('kush_house_1.dae'), texture: t('kush_struct.png'), mode: 'player' }] };
      }
      if (civId === 'mauryas') {
        return { targetFootprint: 3.6, sinkY: -0.06, parts: [{ mesh: m('maur_house_a.dae'), texture: t('maur_struct.png'), mode: 'player' }] };
      }
      if (civId === 'carthaginians') {
        return { targetFootprint: 3.5, sinkY: -0.06, parts: [{ mesh: m('kart_house_01.dae'), texture: t('kart_struct.png'), mode: 'player' }] };
      }
      if (civId === 'britons') {
        return { targetFootprint: 3.4, sinkY: -0.06, parts: [{ mesh: m('brit_house_01.dae'), texture: t('brit_struct_1.png'), mode: 'player' }] };
      }
      if (civId === 'gauls') {
        return { targetFootprint: 3.5, sinkY: -0.06, parts: [{ mesh: m('gaul_house_a.dae'), texture: t('celt_struct_1.png'), mode: 'player' }] };
      }
      if (civId === 'iberians') {
        return { targetFootprint: 3.5, sinkY: -0.06, parts: [{ mesh: m('iber_house_1.dae'), texture: t('iber_struct.png'), mode: 'player' }] };
      }
      if (isRome) {
        return {
          targetFootprint: 3.4,
          sinkY: -0.06,
          parts: [
            { mesh: m('roman_house_a.dae'), texture: t('rome_struct_2.png'), normTex: t('rome_struct_2_norm.png'), mode: 'player' },
          ],
        };
      }
      return {
        targetFootprint: 3.4,
        sinkY: -0.06,
        parts: [
          { mesh: m('hele_house_a.dae'), texture: t('hele_struct_b.png'), normTex: t('hele_struct_b_norm.png'), mode: 'opaque' },
          { mesh: m('hele_house_a_struct.dae'), texture: t('hele_struct.png'), normTex: t('hele_struct_norm.png'), mode: 'player' },
        ],
      };

    case 'storehouse':
      if (isRome) {
        return {
          targetFootprint: 3.4,
          sinkY: -0.06,
          parts: [
            { mesh: m('rome_storehouse.dae'), texture: t('rome_struct_2.png'), normTex: t('rome_struct_2_norm.png'), mode: 'player' },
          ],
        };
      }
      return {
        targetFootprint: 3.4,
        sinkY: -0.06,
        parts: [
          { mesh: m('hele_storehouse.dae'), texture: t('hele_struct_b.png'), normTex: t('hele_struct_b_norm.png'), mode: 'player' },
          { mesh: m('hele_storehouse_roof.dae'), texture: t('rooftiles_broken.png'), mode: 'alpha', doubleSide: true },
        ],
      };

    case 'farmstead':
      if (isRome) {
        return {
          targetFootprint: 3.4,
          sinkY: -0.06,
          parts: [
            { mesh: m('rome_fc.dae'), texture: t('rome_struct_2.png'), normTex: t('rome_struct_2_norm.png'), mode: 'player' },
          ],
        };
      }
      return {
        targetFootprint: 3.4,
        sinkY: -0.06,
        parts: [
          { mesh: m('hele_farmstead.dae'), texture: t('hele_struct_b.png'), normTex: t('hele_struct_b_norm.png'), mode: 'player' },
        ],
      };

    case 'pasture':
      if (civId === 'han') {
        return {
          targetFootprint: 5.5,
          sinkY: -0.08,
          parts: [
            { mesh: m('han_corral.dae'), texture: t('han_struct_02.png'), normTex: t('han_struct_02_norm.png'), mode: 'player' },
          ],
        };
      }
      if (isRome) {
        return {
          targetFootprint: 5.5,
          sinkY: -0.08,
          parts: [
            { mesh: m('rome_corral.dae'), texture: t('rome_struct_2.png'), normTex: t('rome_struct_2_norm.png'), mode: 'player' },
          ],
        };
      }
      return {
        targetFootprint: 5.5,
        sinkY: -0.08,
        parts: [
          { mesh: m('hele_corral.dae'), texture: t('hele_struct_b.png'), normTex: t('hele_struct_b_norm.png'), mode: 'player' },
        ],
      };

    case 'barracks':
      if (civId === 'han') {
        return { targetFootprint: 5.4, sinkY: -0.08, parts: [{ mesh: m('han_barracks.dae'), texture: t('han_struct_02.png'), normTex: t('han_struct_02_norm.png'), mode: 'player' }] };
      }
      if (civId === 'persians') {
        return { targetFootprint: 5.4, sinkY: -0.08, parts: [{ mesh: m('pers_barracks.dae'), texture: t('pers_struct.png'), mode: 'player' }] };
      }
      if (civId === 'ptolemies') {
        return { targetFootprint: 5.3, sinkY: -0.08, parts: [{ mesh: m('ptol_barracks.dae'), texture: t('ptol_struct.png'), mode: 'player' }] };
      }
      if (civId === 'kushites') {
        return { targetFootprint: 5.3, sinkY: -0.08, parts: [{ mesh: m('kush_barracks.dae'), texture: t('kush_struct.png'), mode: 'player' }] };
      }
      if (civId === 'mauryas') {
        return { targetFootprint: 5.4, sinkY: -0.08, parts: [{ mesh: m('maur_barracks_a_struct.dae'), texture: t('maur_struct.png'), mode: 'player' }] };
      }
      if (civId === 'carthaginians') {
        return { targetFootprint: 5.3, sinkY: -0.08, parts: [{ mesh: m('kart_barracks.dae'), texture: t('kart_struct.png'), mode: 'player' }] };
      }
      if (civId === 'britons' || civId === 'gauls') {
        return { targetFootprint: 5.2, sinkY: -0.08, parts: [{ mesh: m('brit_barracks_struct.dae'), texture: t('brit_struct.png'), mode: 'player' }] };
      }
      if (civId === 'iberians') {
        return { targetFootprint: 5.2, sinkY: -0.08, parts: [{ mesh: m('iber_barracks_b.dae'), texture: t('iber_struct.png'), mode: 'player' }] };
      }
      if (isRome) {
        return {
          targetFootprint: 5.2,
          sinkY: -0.08,
          parts: [
            { mesh: m('rome_barracks.dae'), texture: t('rome_struct_2.png'), normTex: t('rome_struct_2_norm.png'), mode: 'player' },
          ],
        };
      }
      return {
        targetFootprint: 5.2,
        sinkY: -0.08,
        parts: [
          { mesh: m('athen_barracks_struct.dae'), texture: t('hele_struct.png'), normTex: t('hele_struct_norm.png'), mode: 'player' },
          { mesh: m('athen_barracks_struct_b.dae'), texture: t('hele_struct_b.png'), normTex: t('hele_struct_b_norm.png'), mode: 'player' },
          { mesh: m('athen_barracks_tile_c.dae'), texture: t('hele_tile_c.png'), mode: 'player' },
        ],
      };

    case 'defense_tower':
      if (civId === 'han') {
        return {
          targetHeight: 6.8,
          sinkY: -0.08,
          parts: [
            { mesh: m('han_defense_tower.dae'), texture: t('han_struct_02.png'), normTex: t('han_struct_02_norm.png'), mode: 'player' },
          ],
        };
      }
      if (isRome) {
        return {
          targetHeight: 6.4,
          sinkY: -0.08,
          parts: [
            { mesh: m('rome_tower.dae'), texture: t('rome_struct_2.png'), normTex: t('rome_struct_2_norm.png'), mode: 'player' },
            { mesh: m('rome_tower_wood.dae'), texture: t('palisade_main.png'), mode: 'opaque' },
          ],
        };
      }
      return {
        targetHeight: 6.4,
        sinkY: -0.08,
        parts: [
          { mesh: m('athen_wall_tower.dae'), texture: t('hele_struct_b.png'), normTex: t('hele_struct_b_norm.png'), mode: 'player' },
        ],
      };

    case 'outpost':
      return {
        targetHeight: 4.7,
        sinkY: -0.06,
        parts: [
          { mesh: m('palisade_rocks_outpost.dae'), texture: t('palisade_main.png'), mode: 'opaque' },
        ],
      };

    case 'fortress':
      if (civId === 'han') {
        return { targetFootprint: 7.3, sinkY: -0.1, parts: [{ mesh: m('han_fortress.dae'), texture: t('han_struct_02.png'), normTex: t('han_struct_02_norm.png'), mode: 'player' }] };
      }
      if (civId === 'persians') {
        return { targetFootprint: 7.3, sinkY: -0.1, parts: [{ mesh: m('pers_fortress.dae'), texture: t('pers_struct.png'), mode: 'player' }] };
      }
      if (civId === 'ptolemies') {
        return { targetFootprint: 7.2, sinkY: -0.1, parts: [{ mesh: m('ptol_fortress.dae'), texture: t('ptol_struct.png'), mode: 'player' }] };
      }
      if (civId === 'kushites') {
        return { targetFootprint: 7.2, sinkY: -0.1, parts: [{ mesh: m('kush_fortress.dae'), texture: t('kush_struct.png'), mode: 'player' }] };
      }
      if (civId === 'mauryas') {
        return { targetFootprint: 7.3, sinkY: -0.1, parts: [{ mesh: m('maur_fortress.dae'), texture: t('maur_struct.png'), mode: 'player' }] };
      }
      if (civId === 'carthaginians') {
        return { targetFootprint: 7.3, sinkY: -0.1, parts: [{ mesh: m('kart_fortress_b.dae'), texture: t('kart_struct.png'), mode: 'player' }] };
      }
      if (civId === 'britons') {
        return { targetFootprint: 7.2, sinkY: -0.1, parts: [{ mesh: m('brit_fortress_struct1.dae'), texture: t('celt_struct_1.png'), mode: 'player' }] };
      }
      if (civId === 'gauls') {
        return { targetFootprint: 7.2, sinkY: -0.1, parts: [{ mesh: m('gaul_fortress_struct1.dae'), texture: t('celt_struct_1.png'), mode: 'player' }] };
      }
      if (civId === 'iberians') {
        return { targetFootprint: 7.2, sinkY: -0.1, parts: [{ mesh: m('iber_fortress.dae'), texture: t('iber_struct.png'), mode: 'player' }] };
      }
      if (isRome) {
        return {
          targetFootprint: 7.2,
          sinkY: -0.1,
          parts: [
            { mesh: m('rome_fortress.dae'), texture: t('rome_struct_2.png'), normTex: t('rome_struct_2_norm.png'), mode: 'player' },
            { mesh: m('rome_fortress_transp.dae'), texture: t('rome_struct_2.png'), mode: 'alpha', doubleSide: true },
          ],
        };
      }
      return {
        targetFootprint: 7.2,
        sinkY: -0.1,
        parts: [
          { mesh: m('hele_fortress_up.dae'), texture: t('hele_struct_b.png'), normTex: t('hele_struct_b_norm.png'), mode: 'player' },
          { mesh: m('hele_fortress_up_tile_b.dae'), texture: t('hele_tile_b.png'), mode: 'player' },
          { mesh: m('hele_fortress_up_gate.dae'), texture: t('hele_gate.png'), mode: 'player' },
        ],
      };

    case 'temple':
      if (civId === 'han') {
        return { targetFootprint: 5.6, sinkY: -0.08, parts: [{ mesh: m('han_temple.dae'), texture: t('han_struct_02.png'), normTex: t('han_struct_02_norm.png'), mode: 'player' }] };
      }
      if (civId === 'persians') {
        return { targetFootprint: 5.5, sinkY: -0.08, parts: [{ mesh: m('pers_temple_1.dae'), texture: t('pers_struct.png'), mode: 'player' }] };
      }
      if (civId === 'ptolemies') {
        return { targetFootprint: 5.6, sinkY: -0.08, parts: [{ mesh: m('ptol_temple.dae'), texture: t('ptol_struct.png'), mode: 'player' }] };
      }
      if (civId === 'kushites') {
        return { targetFootprint: 5.6, sinkY: -0.08, parts: [{ mesh: m('kush_temple.dae'), texture: t('kush_struct_02.png'), mode: 'player' }] };
      }
      if (civId === 'mauryas') {
        return { targetFootprint: 5.6, sinkY: -0.08, parts: [{ mesh: m('maur_temple_struct.dae'), texture: t('maur_struct.png'), mode: 'player' }] };
      }
      if (civId === 'carthaginians') {
        return { targetFootprint: 5.5, sinkY: -0.08, parts: [{ mesh: m('kart_hc.dae'), texture: t('kart_struct_1.png'), mode: 'player' }] };
      }
      if (civId === 'britons' || civId === 'gauls') {
        return { targetFootprint: 5.4, sinkY: -0.08, parts: [{ mesh: m('celt_temple.dae'), texture: t('brit_struct_1.png'), mode: 'player' }] };
      }
      if (civId === 'iberians') {
        return { targetFootprint: 5.4, sinkY: -0.08, parts: [{ mesh: m('iber_temple.dae'), texture: t('iber_struct.png'), mode: 'player' }] };
      }
      if (isRome) {
        return {
          targetFootprint: 5.4,
          sinkY: -0.08,
          parts: [
            { mesh: m('rome_hc1.dae'), texture: t('rome_struct.png'), normTex: t('rome_struct_norm.png'), mode: 'player' },
          ],
        };
      }
      return {
        targetFootprint: 5.4,
        sinkY: -0.08,
        parts: [
          { mesh: m('athen_temple_struct.dae'), texture: t('hele_struct.png'), normTex: t('hele_struct_norm.png'), mode: 'player' },
          { mesh: m('athen_temple_tile_c.dae'), texture: t('hele_tile_c.png'), mode: 'player' },
          { mesh: m('athen_temple_decor.dae'), texture: t('hele_decor.png'), mode: 'player' },
        ],
      };

    case 'blacksmith':
      if (isRome) {
        return {
          targetFootprint: 4.5,
          sinkY: -0.06,
          parts: [
            { mesh: m('rome_blacksmith_struct_b.dae'), texture: t('rome_struct_2.png'), normTex: t('rome_struct_2_norm.png'), mode: 'player' },
          ],
        };
      }
      return {
        targetFootprint: 4.5,
        sinkY: -0.06,
        parts: [
          { mesh: m('hele_blacksmith_struct_b.dae'), texture: t('hele_struct_b.png'), normTex: t('hele_struct_b_norm.png'), mode: 'player' },
          { mesh: m('hele_blacksmith_struct.dae'), texture: t('hele_struct.png'), normTex: t('hele_struct_norm.png'), mode: 'player' },
          { mesh: m('hele_blacksmith_rooftiles.dae'), texture: t('rooftiles_broken.png'), mode: 'alpha', doubleSide: true },
        ],
      };

    case 'apartment_house':
      return {
        targetFootprint: 4.5,
        sinkY: -0.08,
        parts: [
          {
            mesh: m('kart_house_02.dae'),
            texture: t('kart_struct.png'),
            normTex: t('kart_struct_norm.png'),
            mode: 'player',
            roughness: 0.82,
          },
          {
            mesh: m('kart_house_b_1.dae'),
            texture: t('kart_struct.png'),
            mode: 'player',
            roughness: 0.84,
          },
        ],
      };

    case 'dock':
      if (isRome) {
        return {
          targetFootprint: 7.4,
          rotateY: -Math.PI / 2,
          sinkY: -0.06,
          parts: [
            { mesh: m('rome_dock.dae'), texture: t('rome_struct_2.png'), normTex: t('rome_struct_2_norm.png'), mode: 'player', roughness: 0.78 },
            { mesh: m('rome_dock_1.dae'), texture: t('wood_c.png'), mode: 'player', roughness: 0.86 },
          ],
        };
      }
      return {
        targetFootprint: 7.4,
        sinkY: -0.06,
        parts: [
          { mesh: m('athen_dock_struct.dae'), texture: t('hele_struct.png'), normTex: t('hele_struct_norm.png'), mode: 'player', roughness: 0.78 },
          { mesh: m('athen_dock_struct_b.dae'), texture: t('hele_struct_b.png'), normTex: t('hele_struct_b_norm.png'), mode: 'opaque', roughness: 0.82 },
          { mesh: m('athen_dock_tiles.dae'), texture: t('hele_tile_c.png'), normTex: t('hele_tile_c_norm.png'), mode: 'player', roughness: 0.76 },
          { mesh: m('athen_dock_props.dae'), texture: t('hele_props_a.png'), normTex: t('hele_props_a_norm.png'), mode: 'player', roughness: 0.82 },
          { mesh: m('athen_dock_decor.dae'), texture: t('hele_decor.png'), mode: 'player', roughness: 0.74 },
        ],
      };

    case 'market':
      if (isRome) {
        return {
          targetFootprint: 5.2,
          sinkY: -0.06,
          parts: [
            { mesh: m('rome_market_struct1.dae'), texture: t('rome_struct.png'), normTex: t('rome_struct_norm.png'), mode: 'player' },
            { mesh: m('rome_market_struct2.dae'), texture: t('rome_struct_2.png'), normTex: t('rome_struct_2_norm.png'), mode: 'player' },
          ],
        };
      }
      return {
        targetFootprint: 5.2,
        sinkY: -0.06,
        parts: [
          { mesh: m('hele_market_struct.dae'), texture: t('hele_struct.png'), normTex: t('hele_struct_norm.png'), mode: 'player' },
          { mesh: m('hele_market_struct_b.dae'), texture: t('hele_struct_b.png'), normTex: t('hele_struct_b_norm.png'), mode: 'opaque' },
          { mesh: m('hele_market_tile_c.dae'), texture: t('hele_tile_c.png'), mode: 'player' },
        ],
      };

    case 'stable':
      if (isRome) {
        return {
          targetFootprint: 5.2,
          sinkY: -0.06,
          parts: [
            { mesh: m('rome_stable.dae'), texture: t('rome_struct_2.png'), normTex: t('rome_struct_2_norm.png'), mode: 'player' },
          ],
        };
      }
      return {
        targetFootprint: 5.2,
        sinkY: -0.06,
        parts: [
          { mesh: m('hele_stable.dae'), texture: t('hele_struct_b.png'), normTex: t('hele_struct_b_norm.png'), mode: 'player' },
        ],
      };

    case 'workshop':
      if (isRome) {
        return {
          targetFootprint: 5.4,
          sinkY: -0.08,
          parts: [
            { mesh: m('rome_workshop.dae'), texture: t('rome_struct_2.png'), normTex: t('rome_struct_2_norm.png'), mode: 'player' },
          ],
        };
      }
      return {
        targetFootprint: 5.4,
        sinkY: -0.08,
        parts: [
          { mesh: m('hele_workshop.dae'), texture: t('hele_struct_b.png'), normTex: t('hele_struct_b_norm.png'), mode: 'player' },
        ],
      };

    case 'wonder':
      if (isRome) {
        return {
          targetFootprint: 8.6,
          sinkY: -0.1,
          parts: [
            { mesh: m('rome_sp_pantheon.dae'), texture: t('rome_sp_pantheon.png'), mode: 'opaque' },
          ],
        };
      }
      return {
        targetFootprint: 8.6,
        sinkY: -0.1,
        parts: [
          { mesh: m('athen_erechtheion_struct.dae'), texture: t('hele_struct.png'), normTex: t('hele_struct_norm.png'), mode: 'player' },
          { mesh: m('erechtheion_roof.dae'), texture: t('hele_wonder_rooftile.png'), mode: 'player' },
          { mesh: m('erechtheion_tile_c.dae'), texture: t('hele_tile_c.png'), mode: 'player' },
        ],
      };

    case 'gymnasium':
      return {
        targetFootprint: 5.8,
        sinkY: -0.08,
        parts: [
          { mesh: m('athen_barracks_struct_b.dae'), texture: t('hele_struct_b.png'), normTex: t('hele_struct_b_norm.png'), mode: 'player' },
          { mesh: m('hele_market_struct_b.dae'), texture: t('hele_struct.png'), normTex: t('hele_struct_norm.png'), mode: 'player' },
          { mesh: m('hele_market_tile_c.dae'), texture: t('hele_tile_c.png'), mode: 'player' },
        ],
      };

    case 'carth_embassy':
      return {
        targetFootprint: 6.0,
        sinkY: -0.08,
        parts: [
          { mesh: m('rome_market_struct1.dae'), texture: t('rome_struct.png'), normTex: t('rome_struct_norm.png'), mode: 'player' },
          { mesh: m('rome_market_struct2.dae'), texture: t('rome_struct_2.png'), normTex: t('rome_struct_2_norm.png'), mode: 'player' },
        ],
      };

    case 'ptol_library':
      return {
        targetFootprint: 6.2,
        sinkY: -0.08,
        parts: [
          { mesh: m('athen_erechtheion_struct.dae'), texture: t('hele_struct.png'), normTex: t('hele_struct_norm.png'), mode: 'player' },
          { mesh: m('erechtheion_roof.dae'), texture: t('hele_wonder_rooftile.png'), mode: 'player' },
          { mesh: m('athen_cc_decor.dae'), texture: t('hele_decor.png'), mode: 'player' },
        ],
      };

    case 'army_camp':
      return {
        targetFootprint: 5.8,
        sinkY: -0.08,
        parts: [
          { mesh: m('rome_fortress.dae'), texture: t('rome_struct_2.png'), normTex: t('rome_struct_2_norm.png'), mode: 'player' },
          { mesh: m('rome_tower_wood.dae'), texture: t('palisade_main.png'), mode: 'opaque' },
        ],
      };

    case 'syssition':
      return {
        targetFootprint: 5.6,
        sinkY: -0.08,
        parts: [
          { mesh: m('athen_barracks_struct.dae'), texture: t('hele_struct_b.png'), normTex: t('hele_struct_b_norm.png'), mode: 'player' },
          { mesh: m('athen_barracks_struct_b.dae'), texture: t('hele_struct.png'), normTex: t('hele_struct_norm.png'), mode: 'player' },
          { mesh: m('hele_fortress_up_gate.dae'), texture: t('hele_gate.png'), mode: 'player' },
        ],
      };

    case 'apadana':
      return {
        targetFootprint: 6.6,
        sinkY: -0.09,
        parts: [
          { mesh: m('athen_erechtheion_struct.dae'), texture: t('rome_struct.png'), normTex: t('rome_struct_norm.png'), mode: 'player' },
          { mesh: m('erechtheion_roof.dae'), texture: t('metal_gold_aegean.png'), normTex: t('metal_gold_aegean_norm.png'), mode: 'player', roughness: 0.42, metalness: 0.35 },
          { mesh: m('athen_cc_decor.dae'), texture: t('hele_decor.png'), mode: 'player' },
        ],
      };

    // ======================== UNITS ========================
    case 'doctor':
    case 'healer': {
      const healerTex =
        civId === 'han'
          ? t('han_tunic_01.png')
          : civId === 'persians'
            ? t('pers_tunic_01.png')
            : civId === 'ptolemies'
              ? t('ptol_tunic_01.png')
              : civId === 'kushites'
                ? t('kush_dress_01.png')
                : civId === 'mauryas'
                  ? t('maur_tunic_01.png')
                  : civId === 'britons' || civId === 'gauls'
                    ? t('celt_tunic_01.png')
                    : civId === 'iberians'
                      ? t('iber_tunic_01.png')
                      : civId === 'carthaginians'
                        ? t('cart_tunic_01.png')
                        : isRome
                          ? t('robes_healer_01.png')
                          : t('toga_healer_01.png');
      return {
        targetHeight: 1.82,
        parts: [
          {
            mesh: m('m_dress.dae'),
            texture: healerTex,
            mode: 'player',
            animations: HEALER_ANIMS,
            children: [
              { mesh: m('dude_head.dae'), texture: t('head_hele_a.png'), mode: 'opaque', attachPoint: 'prop-head' },
              { mesh: m('m_staff.dae'), texture: t('palisade_main.png'), mode: 'opaque', attachPoint: 'prop-weapon_R' },
            ],
          },
        ],
      };
    }

    case 'siege_ram':
      return {
        targetFootprint: 3.1,
        sinkY: -0.04,
        parts: [
          {
            mesh: isRome ? m('rome_ram.dae') : m('spart_siege_ram.dae'),
            texture: isRome ? t('rome_ram.png') : t('spart_siege_ram.png'),
            mode: 'opaque',
          },
        ],
      };
    case 'female_citizen': {
      const workerDressTex =
        civId === 'han'
          ? t('han_dress_01.png')
          : civId === 'britons' || civId === 'gauls'
            ? t('celt_dress_01.png')
            : civId === 'persians'
              ? t('pers_dress_01.png')
              : civId === 'kushites'
                ? t('kush_dress_01.png')
                : civId === 'ptolemies'
                  ? t('ptol_dress_01.png')
                  : civId === 'mauryas'
                    ? t('maur_tunic_01.png')
                    : civId === 'iberians'
                      ? t('iber_tunic_01.png')
                      : civId === 'carthaginians'
                        ? t('cart_tunic_01.png')
                        : t('dress_female_01.png');
      return {
        targetHeight: 1.72,
        parts: [
          {
            mesh: m('f_dress.dae'),
            texture: workerDressTex,
            mode: 'player',
            animations: FEMALE_ANIMS,
            children: [
              { mesh: m('dudette_head_b.dae'), texture: t('head_fem_a.png'), mode: 'opaque', attachPoint: 'prop-head' },
              ...WORKER_TOOLS,
            ],
          },
        ],
      };
    }

    case 'scout': {
      const scoutTunicTex =
        civId === 'han'
          ? t('han_tunic_01.png')
          : civId === 'britons' || civId === 'gauls'
            ? t('celt_tunic_01.png')
            : civId === 'persians'
              ? t('pers_tunic_01.png')
              : civId === 'romans'
                ? t('rome_tunic_basic_01.png')
                : t('hele_tunic_01_01.png');
      return {
        targetHeight: 1.78,
        parts: [
          {
            mesh: m('m_tunic_short.dae'),
            texture: scoutTunicTex,
            mode: 'player',
            animations: HOPLITE_ANIMS,
            children: [
              { mesh: m('dude_head.dae'), texture: t('head_hele_a.png'), mode: 'opaque', attachPoint: 'prop-head' },
              { mesh: m('m_staff.dae'), texture: t('palisade_main.png'), mode: 'opaque', attachPoint: 'prop-weapon_R' },
            ],
          },
        ],
      };
    }

    case 'male_citizen': {
      const maleTunicTex =
        civId === 'han'
          ? t('han_tunic_01.png')
          : civId === 'britons' || civId === 'gauls'
            ? t('celt_tunic_01.png')
            : civId === 'persians'
              ? t('pers_tunic_01.png')
              : civId === 'ptolemies'
                ? t('ptol_tunic_01.png')
                : civId === 'mauryas'
                  ? t('maur_tunic_01.png')
                  : civId === 'iberians'
                    ? t('iber_tunic_01.png')
                    : civId === 'carthaginians'
                      ? t('cart_tunic_01.png')
                      : civId === 'romans'
                        ? t('rome_tunic_basic_01.png')
                        : civId === 'athenians'
                          ? t('athen_tunic_01_01.png')
                          : t('hele_tunic_01_01.png');
      return {
        targetHeight: 1.82,
        parts: [
          {
            mesh: m('m_tunic_short.dae'),
            texture: maleTunicTex,
            mode: 'player',
            animations: HOPLITE_ANIMS,
            children: [
              { mesh: m('dude_head.dae'), texture: t('head_hele_a.png'), mode: 'opaque', attachPoint: 'prop-head' },
              ...WORKER_TOOLS,
            ],
          },
        ],
      };
    }

    case 'athen_hoplite':
      return {
        targetHeight: 1.85,
        parts: [
          {
            mesh: m('m_tunic_short.dae'),
            texture: t('hele_tunic_02_01.png'),
            mode: 'player',
            animations: HOPLITE_ANIMS,
            children: [
              { mesh: m('dude_head.dae'), texture: t('head_hele_a.png'), mode: 'opaque', attachPoint: 'prop-head' },
              { mesh: m('hele_pilos_a1.dae'), texture: t('hele_pilos_01_bronze.png'), mode: 'opaque', roughness: 0.4, metalness: 0.6, attachPoint: 'prop-helmet' },
              { mesh: m('aspis_athen.dae'), texture: t('aspis_athen_b.png'), mode: 'player', doubleSide: true, attachPoint: 'prop-shield_arm', isCombatGear: true },
              { mesh: m('spear_hoplite.dae'), texture: t('prop_weap.png'), mode: 'opaque', attachPoint: 'prop-weapon_R', isWeapon: true, isCombatGear: true },
              ...WORKER_TOOLS,
            ],
          },
        ],
      };

    case 'athen_archer':
      return {
        targetHeight: 1.8,
        parts: [
          {
            mesh: m('m_tunic_short.dae'),
            texture: t('hele_tunic_01_01.png'),
            mode: 'player',
            animations: ARCHER_ANIMS,
            children: [
              { mesh: m('dude_head.dae'), texture: t('head_hele_a.png'), mode: 'opaque', attachPoint: 'prop-head' },
              { mesh: m('bow_greek.dae'), texture: t('bow_wood.png'), mode: 'player', attachPoint: 'prop-weapon_bow', isWeapon: true, isCombatGear: true },
              ...WORKER_TOOLS,
            ],
          },
        ],
      };

    case 'athen_champion':
      return {
        targetHeight: 2.05,
        parts: [
          {
            mesh: m('m_armor_tunic_short.dae'),
            texture: t('athen_epilektos_01.png'),
            mode: 'player',
            roughness: 0.55,
            metalness: 0.35,
            animations: HOPLITE_ANIMS,
            children: [
              { mesh: m('dude_head.dae'), texture: t('head_hele_a.png'), mode: 'opaque', attachPoint: 'prop-head' },
              { mesh: m('hele_phrygian_a.dae'), texture: t('hele_phrygian_01_bronze.png'), mode: 'opaque', roughness: 0.38, metalness: 0.65, attachPoint: 'prop-helmet' },
              { mesh: m('aspis_athen.dae'), texture: t('aspis_athen_c.png'), mode: 'player', doubleSide: true, attachPoint: 'prop-shield_arm' },
              { mesh: m('spear_hoplite.dae'), texture: t('prop_weap.png'), mode: 'opaque', attachPoint: 'prop-weapon_R', isWeapon: true },
            ],
          },
        ],
      };

    case 'athen_cavalry':
      return {
        targetHeight: 2.35,
        parts: [
          {
            mesh: m('horse_tessalian.dae'),
            texture: t('horse_brown.png'),
            mode: 'opaque',
            animations: HORSE_ANIMS,
            children: [
              {
                mesh: m('m_tunic_short.dae'),
                texture: t('athen_tunic_01_01.png'),
                mode: 'player',
                attachPoint: 'prop_rider',
                animations: RIDER_ANIMS,
                children: [
                  { mesh: m('dude_head.dae'), texture: t('head_hele_a.png'), mode: 'opaque', attachPoint: 'prop-head' },
                  { mesh: m('hele_pilos_a1.dae'), texture: t('hele_pilos_01_bronze.png'), mode: 'opaque', roughness: 0.4, metalness: 0.6, attachPoint: 'prop-helmet' },
                  { mesh: m('spear_lance_cavalry_reverse.dae'), texture: t('prop_weap.png'), mode: 'opaque', attachPoint: 'prop-weapon_R', isWeapon: true },
                ],
              },
            ],
          },
        ],
      };

    case 'rome_hastatus':
      return {
        targetHeight: 1.85,
        parts: [
          {
            mesh: m('m_tunic_short.dae'),
            texture: t('rome_cardiopylax_01_01.png'),
            mode: 'player',
            animations: SWORDSMAN_ANIMS,
            children: [
              { mesh: m('dude_head.dae'), texture: t('head_hele_a.png'), mode: 'opaque', attachPoint: 'prop-head' },
              { mesh: m('rome_montefortino_a.dae'), texture: t('rome_montefortino_bronze.png'), mode: 'alpha', roughness: 0.4, metalness: 0.6, attachPoint: 'prop-helmet' },
              { mesh: m('scutum_rome.dae'), texture: t('scutum_rome_01.png'), mode: 'player', doubleSide: true, attachPoint: 'prop-shield', isCombatGear: true },
              { mesh: m('gladius_03.dae'), texture: t('prop_weap.png'), mode: 'opaque', attachPoint: 'prop-weapon_R', isWeapon: true, isCombatGear: true },
              ...WORKER_TOOLS,
            ],
          },
        ],
      };

    case 'rome_velite':
      return {
        targetHeight: 1.82,
        parts: [
          {
            mesh: m('m_tunic_short.dae'),
            texture: t('rome_tunic_basic_01.png'),
            mode: 'player',
            animations: JAVELIN_ANIMS,
            children: [
              { mesh: m('dude_head.dae'), texture: t('head_hele_a.png'), mode: 'opaque', attachPoint: 'prop-head' },
              { mesh: m('rome_wolfskin_a.dae'), texture: t('rome_wolfskin_a.png'), mode: 'player', attachPoint: 'prop-helmet' },
              { mesh: m('round_b_f.dae'), texture: t('rome_parma_a.png'), mode: 'player', doubleSide: true, attachPoint: 'prop-shield', isCombatGear: true },
              { mesh: m('weap_javelin_shaft_loaded_a.dae'), texture: t('prop_weap.png'), mode: 'opaque', attachPoint: 'prop-weapon_R', isWeapon: true, isCombatGear: true },
              ...WORKER_TOOLS,
            ],
          },
        ],
      };

    case 'rome_cavalry':
      return {
        targetHeight: 2.35,
        parts: [
          {
            mesh: m('horse_tessalian.dae'),
            texture: t('horse_brown.png'),
            mode: 'opaque',
            animations: HORSE_ANIMS,
            children: [
              {
                mesh: m('m_tunic_short.dae'),
                texture: t('rome_subarmalis_01_01.png'),
                mode: 'player',
                attachPoint: 'prop_rider',
                animations: RIDER_ANIMS,
                children: [
                  { mesh: m('dude_head.dae'), texture: t('head_hele_a.png'), mode: 'opaque', attachPoint: 'prop-head' },
                  { mesh: m('rome_montefortino_a.dae'), texture: t('rome_montefortino_bronze.png'), mode: 'alpha', roughness: 0.4, metalness: 0.6, attachPoint: 'prop-helmet' },
                  { mesh: m('round_b_f.dae'), texture: t('rome_parma_a.png'), mode: 'player', doubleSide: true, attachPoint: 'prop-shield_arm' },
                  { mesh: m('spear_lance_cavalry_reverse.dae'), texture: t('prop_weap.png'), mode: 'opaque', attachPoint: 'prop-weapon_R', isWeapon: true },
                ],
              },
            ],
          },
        ],
      };

    case 'rome_champion':
      return {
        targetHeight: 2.05,
        parts: [
          {
            mesh: m('m_armor_tunic_short.dae'),
            texture: t('rome_cuirass_01_01.png'),
            mode: 'player',
            roughness: 0.5,
            metalness: 0.4,
            animations: SWORDSMAN_ANIMS,
            children: [
              { mesh: m('dude_head.dae'), texture: t('head_hele_a.png'), mode: 'opaque', attachPoint: 'prop-head' },
              { mesh: m('rome_montefortino_a_2.dae'), texture: t('rome_montefortino_bronze.png'), mode: 'alpha', roughness: 0.35, metalness: 0.65, attachPoint: 'prop-helmet' },
              { mesh: m('scutum_rome.dae'), texture: t('scutum_rome_01.png'), mode: 'player', doubleSide: true, attachPoint: 'prop-shield' },
              { mesh: m('gladius_03.dae'), texture: t('prop_weap.png'), mode: 'opaque', attachPoint: 'prop-weapon_R', isWeapon: true },
            ],
          },
        ],
      };

    case 'athen_marine':
      return {
        targetHeight: 1.92,
        parts: [
          {
            mesh: m('m_armor_tunic_short.dae'),
            texture: t('athen_epilektos_01.png'),
            mode: 'player',
            roughness: 0.55,
            metalness: 0.3,
            animations: SWORDSMAN_ANIMS,
            children: [
              { mesh: m('dude_head.dae'), texture: t('head_hele_a.png'), mode: 'opaque', attachPoint: 'prop-head' },
              { mesh: m('hele_phrygian_a.dae'), texture: t('hele_phrygian_01_bronze.png'), mode: 'opaque', roughness: 0.38, metalness: 0.65, attachPoint: 'prop-helmet' },
              { mesh: m('aspis_athen.dae'), texture: t('aspis_athen_b.png'), mode: 'player', doubleSide: true, attachPoint: 'prop-shield_arm', isCombatGear: true },
              { mesh: m('gladius_03.dae'), texture: t('prop_weap.png'), mode: 'opaque', attachPoint: 'prop-weapon_R', isWeapon: true, isCombatGear: true },
              ...WORKER_TOOLS,
            ],
          },
        ],
      };

    case 'rome_praetorian':
      return {
        targetHeight: 2.02,
        parts: [
          {
            mesh: m('m_armor_tunic_short.dae'),
            texture: t('rome_cuirass_01_01.png'),
            mode: 'player',
            roughness: 0.48,
            metalness: 0.45,
            animations: SWORDSMAN_ANIMS,
            children: [
              { mesh: m('dude_head.dae'), texture: t('head_hele_a.png'), mode: 'opaque', attachPoint: 'prop-head' },
              { mesh: m('rome_montefortino_a_2.dae'), texture: t('rome_montefortino_bronze.png'), mode: 'alpha', roughness: 0.35, metalness: 0.65, attachPoint: 'prop-helmet' },
              { mesh: m('scutum_rome.dae'), texture: t('scutum_rome_01.png'), mode: 'player', doubleSide: true, attachPoint: 'prop-shield' },
              { mesh: m('gladius_03.dae'), texture: t('prop_weap.png'), mode: 'opaque', attachPoint: 'prop-weapon_R', isWeapon: true },
            ],
          },
        ],
      };

    case 'spart_perioikos':
      return {
        targetHeight: 1.88,
        parts: [
          {
            mesh: m('m_tunic_short.dae'),
            texture: t('hele_tunic_02_01.png'),
            mode: 'player',
            animations: HOPLITE_ANIMS,
            children: [
              { mesh: m('dude_head.dae'), texture: t('head_hele_a.png'), mode: 'opaque', attachPoint: 'prop-head' },
              { mesh: m('hele_pilos_a1.dae'), texture: t('hele_pilos_01_bronze.png'), mode: 'opaque', roughness: 0.38, metalness: 0.65, attachPoint: 'prop-helmet' },
              { mesh: m('aspis_athen.dae'), texture: t('aspis_athen_c.png'), mode: 'player', doubleSide: true, attachPoint: 'prop-shield_arm', isCombatGear: true },
              { mesh: m('spear_hoplite.dae'), texture: t('prop_weap.png'), mode: 'opaque', attachPoint: 'prop-weapon_R', isWeapon: true, isCombatGear: true },
              ...WORKER_TOOLS,
            ],
          },
        ],
      };

    case 'spart_skirmisher':
      return {
        targetHeight: 1.78,
        parts: [
          {
            mesh: m('m_tunic_short.dae'),
            texture: t('hele_tunic_01_01.png'),
            mode: 'player',
            animations: JAVELIN_ANIMS,
            children: [
              { mesh: m('dude_head.dae'), texture: t('head_hele_a.png'), mode: 'opaque', attachPoint: 'prop-head' },
              { mesh: m('round_b_f.dae'), texture: t('rome_parma_a.png'), mode: 'player', doubleSide: true, attachPoint: 'prop-shield', isCombatGear: true },
              { mesh: m('weap_javelin_shaft_loaded_a.dae'), texture: t('prop_weap.png'), mode: 'opaque', attachPoint: 'prop-weapon_R', isWeapon: true, isCombatGear: true },
              ...WORKER_TOOLS,
            ],
          },
        ],
      };

    case 'spart_cavalry':
      return {
        targetHeight: 2.38,
        parts: [
          {
            mesh: m('horse_tessalian.dae'),
            texture: t('horse_brown.png'),
            mode: 'opaque',
            animations: HORSE_ANIMS,
            children: [
              {
                mesh: m('m_armor_tunic_short.dae'),
                texture: t('athen_epilektos_01.png'),
                mode: 'player',
                attachPoint: 'prop_rider',
                animations: RIDER_ANIMS,
                children: [
                  { mesh: m('dude_head.dae'), texture: t('head_hele_a.png'), mode: 'opaque', attachPoint: 'prop-head' },
                  { mesh: m('hele_phrygian_a.dae'), texture: t('hele_phrygian_01_bronze.png'), mode: 'opaque', roughness: 0.38, metalness: 0.65, attachPoint: 'prop-helmet' },
                  { mesh: m('spear_lance_cavalry_reverse.dae'), texture: t('prop_weap.png'), mode: 'opaque', attachPoint: 'prop-weapon_R', isWeapon: true },
                ],
              },
            ],
          },
        ],
      };

    case 'spart_spartiate':
      return {
        targetHeight: 2.08,
        parts: [
          {
            mesh: m('m_armor_tunic_short.dae'),
            texture: t('athen_epilektos_01.png'),
            mode: 'player',
            roughness: 0.45,
            metalness: 0.5,
            animations: HOPLITE_ANIMS,
            children: [
              { mesh: m('dude_head.dae'), texture: t('head_hele_a.png'), mode: 'opaque', attachPoint: 'prop-head' },
              { mesh: m('hele_phrygian_a.dae'), texture: t('hele_phrygian_01_bronze.png'), mode: 'opaque', roughness: 0.35, metalness: 0.72, attachPoint: 'prop-helmet' },
              { mesh: m('aspis_athen.dae'), texture: t('aspis_athen_c.png'), mode: 'player', doubleSide: true, attachPoint: 'prop-shield_arm' },
              { mesh: m('spear_hoplite.dae'), texture: t('prop_weap.png'), mode: 'opaque', attachPoint: 'prop-weapon_R', isWeapon: true },
            ],
          },
        ],
      };

    case 'spart_hero_guard':
      return {
        targetHeight: 2.04,
        parts: [
          {
            mesh: m('m_armor_tunic_short.dae'),
            texture: t('rome_cuirass_01_01.png'),
            mode: 'player',
            roughness: 0.45,
            metalness: 0.5,
            animations: SWORDSMAN_ANIMS,
            children: [
              { mesh: m('dude_head.dae'), texture: t('head_hele_a.png'), mode: 'opaque', attachPoint: 'prop-head' },
              { mesh: m('rome_wolfskin_a.dae'), texture: t('rome_wolfskin_a.png'), mode: 'player', attachPoint: 'prop-helmet' },
              { mesh: m('aspis_athen.dae'), texture: t('aspis_athen_c.png'), mode: 'player', doubleSide: true, attachPoint: 'prop-shield_arm' },
              { mesh: m('gladius_03.dae'), texture: t('prop_weap.png'), mode: 'opaque', attachPoint: 'prop-weapon_R', isWeapon: true },
            ],
          },
        ],
      };

    case 'pers_spearman':
      return {
        targetHeight: 1.85,
        parts: [
          {
            mesh: m('m_tunic_short.dae'),
            texture: t('athen_tunic_01_01.png'),
            mode: 'player',
            animations: HOPLITE_ANIMS,
            children: [
              { mesh: m('dude_head.dae'), texture: t('head_hele_a.png'), mode: 'opaque', attachPoint: 'prop-head' },
              { mesh: m('hele_phrygian_a.dae'), texture: t('hele_tunic_01_01.png'), mode: 'player', attachPoint: 'prop-helmet' },
              { mesh: m('round_b_f.dae'), texture: t('rome_parma_a.png'), mode: 'player', doubleSide: true, attachPoint: 'prop-shield_arm', isCombatGear: true },
              { mesh: m('spear_hoplite.dae'), texture: t('prop_weap.png'), mode: 'opaque', attachPoint: 'prop-weapon_R', isWeapon: true, isCombatGear: true },
              ...WORKER_TOOLS,
            ],
          },
        ],
      };

    case 'pers_archer':
      return {
        targetHeight: 1.82,
        parts: [
          {
            mesh: m('m_tunic_short.dae'),
            texture: t('athen_tunic_01_01.png'),
            mode: 'player',
            animations: ARCHER_ANIMS,
            children: [
              { mesh: m('dude_head.dae'), texture: t('head_hele_a.png'), mode: 'opaque', attachPoint: 'prop-head' },
              { mesh: m('hele_phrygian_a.dae'), texture: t('hele_tunic_02_01.png'), mode: 'player', attachPoint: 'prop-helmet' },
              { mesh: m('bow_greek.dae'), texture: t('bow_wood.png'), mode: 'player', attachPoint: 'prop-weapon_bow', isWeapon: true, isCombatGear: true },
              ...WORKER_TOOLS,
            ],
          },
        ],
      };

    case 'pers_cavalry':
      return {
        targetHeight: 2.38,
        parts: [
          {
            mesh: m('horse_tessalian.dae'),
            texture: t('horse_brown.png'),
            mode: 'opaque',
            animations: HORSE_ANIMS,
            children: [
              {
                mesh: m('m_tunic_short.dae'),
                texture: t('athen_tunic_01_01.png'),
                mode: 'player',
                attachPoint: 'prop_rider',
                animations: RIDER_ANIMS,
                children: [
                  { mesh: m('dude_head.dae'), texture: t('head_hele_a.png'), mode: 'opaque', attachPoint: 'prop-head' },
                  { mesh: m('hele_phrygian_a.dae'), texture: t('hele_phrygian_01_bronze.png'), mode: 'opaque', roughness: 0.4, metalness: 0.55, attachPoint: 'prop-helmet' },
                  { mesh: m('spear_lance_cavalry_reverse.dae'), texture: t('prop_weap.png'), mode: 'opaque', attachPoint: 'prop-weapon_R', isWeapon: true },
                ],
              },
            ],
          },
        ],
      };

    case 'pers_immortal':
      return {
        targetHeight: 2.04,
        parts: [
          {
            mesh: m('m_armor_tunic_short.dae'),
            texture: t('athen_epilektos_01.png'),
            mode: 'player',
            roughness: 0.48,
            metalness: 0.45,
            animations: HOPLITE_ANIMS,
            children: [
              { mesh: m('dude_head.dae'), texture: t('head_hele_a.png'), mode: 'opaque', attachPoint: 'prop-head' },
              { mesh: m('hele_phrygian_a.dae'), texture: t('metal_gold_aegean.png'), mode: 'opaque', roughness: 0.32, metalness: 0.72, attachPoint: 'prop-helmet' },
              { mesh: m('round_b_f.dae'), texture: t('aspis_athen_b.png'), mode: 'player', doubleSide: true, attachPoint: 'prop-shield_arm' },
              { mesh: m('spear_hoplite.dae'), texture: t('prop_weap.png'), mode: 'opaque', attachPoint: 'prop-weapon_R', isWeapon: true },
            ],
          },
        ],
      };

    case 'pers_cataphract':
      return {
        targetHeight: 2.48,
        parts: [
          {
            mesh: m('horse_tessalian.dae'),
            texture: t('horse_brown.png'),
            mode: 'opaque',
            animations: HORSE_ANIMS,
            children: [
              {
                mesh: m('m_armor_tunic_short.dae'),
                texture: t('rome_cuirass_01_01.png'),
                mode: 'player',
                roughness: 0.38,
                metalness: 0.65,
                attachPoint: 'prop_rider',
                animations: RIDER_ANIMS,
                children: [
                  { mesh: m('dude_head.dae'), texture: t('head_hele_a.png'), mode: 'opaque', attachPoint: 'prop-head' },
                  { mesh: m('rome_montefortino_a_2.dae'), texture: t('metal_gold_aegean.png'), mode: 'alpha', roughness: 0.32, metalness: 0.75, attachPoint: 'prop-helmet' },
                  { mesh: m('round_b_f.dae'), texture: t('aspis_athen_c.png'), mode: 'player', doubleSide: true, attachPoint: 'prop-shield_arm' },
                  { mesh: m('spear_lance_cavalry_reverse.dae'), texture: t('prop_weap.png'), mode: 'opaque', attachPoint: 'prop-weapon_R', isWeapon: true },
                ],
              },
            ],
          },
        ],
      };

    case 'carth_spearman':
      return {
        targetHeight: 1.86,
        parts: [
          {
            mesh: m('m_tunic_short.dae'),
            texture: t('hele_tunic_01_01.png'),
            mode: 'player',
            animations: HOPLITE_ANIMS,
            children: [
              { mesh: m('dude_head.dae'), texture: t('head_hele_a.png'), mode: 'opaque', attachPoint: 'prop-head' },
              { mesh: m('hele_pilos_a1.dae'), texture: t('hele_pilos_01_bronze.png'), mode: 'opaque', roughness: 0.4, metalness: 0.6, attachPoint: 'prop-helmet' },
              { mesh: m('round_b_f.dae'), texture: t('aspis_athen_b.png'), mode: 'player', doubleSide: true, attachPoint: 'prop-shield_arm', isCombatGear: true },
              { mesh: m('spear_hoplite.dae'), texture: t('prop_weap.png'), mode: 'opaque', attachPoint: 'prop-weapon_R', isWeapon: true, isCombatGear: true },
              ...WORKER_TOOLS,
            ],
          },
        ],
      };

    case 'carth_slinger':
      return {
        targetHeight: 1.8,
        parts: [
          {
            mesh: m('m_tunic_short.dae'),
            texture: t('rome_tunic_basic_01.png'),
            mode: 'player',
            animations: JAVELIN_ANIMS,
            children: [
              { mesh: m('dude_head.dae'), texture: t('head_hele_a.png'), mode: 'opaque', attachPoint: 'prop-head' },
              { mesh: m('round_b_f.dae'), texture: t('rome_parma_a.png'), mode: 'player', doubleSide: true, attachPoint: 'prop-shield', isCombatGear: true },
              { mesh: m('weap_javelin_shaft_loaded_a.dae'), texture: t('prop_weap.png'), mode: 'opaque', attachPoint: 'prop-weapon_R', isWeapon: true, isCombatGear: true },
              ...WORKER_TOOLS,
            ],
          },
        ],
      };

    case 'carth_cavalry':
      return {
        targetHeight: 2.34,
        parts: [
          {
            mesh: m('horse_tessalian.dae'),
            texture: t('horse_brown.png'),
            mode: 'opaque',
            animations: HORSE_ANIMS,
            children: [
              {
                mesh: m('m_tunic_short.dae'),
                texture: t('rome_tunic_basic_01.png'),
                mode: 'player',
                attachPoint: 'prop_rider',
                animations: RIDER_ANIMS,
                children: [
                  { mesh: m('dude_head.dae'), texture: t('head_hele_a.png'), mode: 'opaque', attachPoint: 'prop-head' },
                  { mesh: m('round_b_f.dae'), texture: t('rome_parma_a.png'), mode: 'player', doubleSide: true, attachPoint: 'prop-shield_arm' },
                  { mesh: m('spear_lance_cavalry_reverse.dae'), texture: t('prop_weap.png'), mode: 'opaque', attachPoint: 'prop-weapon_R', isWeapon: true },
                ],
              },
            ],
          },
        ],
      };

    case 'carth_sacred_band':
      return {
        targetHeight: 2.05,
        parts: [
          {
            mesh: m('m_armor_tunic_short.dae'),
            texture: t('athen_epilektos_01.png'),
            mode: 'player',
            roughness: 0.45,
            metalness: 0.48,
            animations: HOPLITE_ANIMS,
            children: [
              { mesh: m('dude_head.dae'), texture: t('head_hele_a.png'), mode: 'opaque', attachPoint: 'prop-head' },
              { mesh: m('hele_phrygian_a.dae'), texture: t('hele_phrygian_01_bronze.png'), mode: 'opaque', roughness: 0.35, metalness: 0.7, attachPoint: 'prop-helmet' },
              { mesh: m('aspis_athen.dae'), texture: t('aspis_athen_c.png'), mode: 'player', doubleSide: true, attachPoint: 'prop-shield_arm' },
              { mesh: m('spear_hoplite.dae'), texture: t('prop_weap.png'), mode: 'opaque', attachPoint: 'prop-weapon_R', isWeapon: true },
            ],
          },
        ],
      };

    case 'carth_mercenary':
      return {
        targetHeight: 1.92,
        parts: [
          {
            mesh: m('m_tunic_short.dae'),
            texture: t('rome_cardiopylax_01_01.png'),
            mode: 'player',
            animations: SWORDSMAN_ANIMS,
            children: [
              { mesh: m('dude_head.dae'), texture: t('head_hele_a.png'), mode: 'opaque', attachPoint: 'prop-head' },
              { mesh: m('rome_montefortino_a.dae'), texture: t('rome_montefortino_bronze.png'), mode: 'alpha', roughness: 0.4, metalness: 0.6, attachPoint: 'prop-helmet' },
              { mesh: m('round_b_f.dae'), texture: t('rome_parma_a.png'), mode: 'player', doubleSide: true, attachPoint: 'prop-shield' },
              { mesh: m('gladius_03.dae'), texture: t('prop_weap.png'), mode: 'opaque', attachPoint: 'prop-weapon_R', isWeapon: true },
            ],
          },
        ],
      };

    case 'ptol_pikeman':
      return {
        targetHeight: 1.88,
        parts: [
          {
            mesh: m('m_tunic_short.dae'),
            texture: t('athen_tunic_01_01.png'),
            mode: 'player',
            animations: HOPLITE_ANIMS,
            children: [
              { mesh: m('dude_head.dae'), texture: t('head_hele_a.png'), mode: 'opaque', attachPoint: 'prop-head' },
              { mesh: m('hele_phrygian_a.dae'), texture: t('hele_phrygian_01_bronze.png'), mode: 'opaque', roughness: 0.4, metalness: 0.6, attachPoint: 'prop-helmet' },
              { mesh: m('round_b_f.dae'), texture: t('aspis_athen_b.png'), mode: 'player', doubleSide: true, attachPoint: 'prop-shield_arm', isCombatGear: true },
              { mesh: m('spear_hoplite.dae'), texture: t('prop_weap.png'), mode: 'opaque', attachPoint: 'prop-weapon_R', isWeapon: true, isCombatGear: true },
              ...WORKER_TOOLS,
            ],
          },
        ],
      };

    case 'ptol_archer':
      return {
        targetHeight: 1.82,
        parts: [
          {
            mesh: m('m_tunic_short.dae'),
            texture: t('hele_tunic_01_01.png'),
            mode: 'player',
            animations: ARCHER_ANIMS,
            children: [
              { mesh: m('dude_head.dae'), texture: t('head_hele_a.png'), mode: 'opaque', attachPoint: 'prop-head' },
              { mesh: m('bow_greek.dae'), texture: t('bow_wood.png'), mode: 'player', attachPoint: 'prop-weapon_bow', isWeapon: true, isCombatGear: true },
              ...WORKER_TOOLS,
            ],
          },
        ],
      };

    case 'ptol_cavalry':
      return {
        targetHeight: 2.38,
        parts: [
          {
            mesh: m('horse_tessalian.dae'),
            texture: t('horse_brown.png'),
            mode: 'opaque',
            animations: HORSE_ANIMS,
            children: [
              {
                mesh: m('m_armor_tunic_short.dae'),
                texture: t('athen_tunic_01_01.png'),
                mode: 'player',
                attachPoint: 'prop_rider',
                animations: RIDER_ANIMS,
                children: [
                  { mesh: m('dude_head.dae'), texture: t('head_hele_a.png'), mode: 'opaque', attachPoint: 'prop-head' },
                  { mesh: m('hele_phrygian_a.dae'), texture: t('metal_gold_aegean.png'), mode: 'opaque', roughness: 0.35, metalness: 0.7, attachPoint: 'prop-helmet' },
                  { mesh: m('spear_lance_cavalry_reverse.dae'), texture: t('prop_weap.png'), mode: 'opaque', attachPoint: 'prop-weapon_R', isWeapon: true },
                ],
              },
            ],
          },
        ],
      };

    case 'ptol_royal_guard':
      return {
        targetHeight: 2.06,
        parts: [
          {
            mesh: m('m_armor_tunic_short.dae'),
            texture: t('athen_epilektos_01.png'),
            mode: 'player',
            roughness: 0.44,
            metalness: 0.5,
            animations: HOPLITE_ANIMS,
            children: [
              { mesh: m('dude_head.dae'), texture: t('head_hele_a.png'), mode: 'opaque', attachPoint: 'prop-head' },
              { mesh: m('hele_phrygian_a.dae'), texture: t('metal_gold_aegean.png'), mode: 'opaque', roughness: 0.32, metalness: 0.75, attachPoint: 'prop-helmet' },
              { mesh: m('aspis_athen.dae'), texture: t('aspis_athen_c.png'), mode: 'player', doubleSide: true, attachPoint: 'prop-shield_arm' },
              { mesh: m('spear_hoplite.dae'), texture: t('prop_weap.png'), mode: 'opaque', attachPoint: 'prop-weapon_R', isWeapon: true },
            ],
          },
        ],
      };

    case 'ptol_klerouch':
      return {
        targetHeight: 1.96,
        parts: [
          {
            mesh: m('m_armor_tunic_short.dae'),
            texture: t('rome_cuirass_01_01.png'),
            mode: 'player',
            roughness: 0.5,
            metalness: 0.4,
            animations: SWORDSMAN_ANIMS,
            children: [
              { mesh: m('dude_head.dae'), texture: t('head_hele_a.png'), mode: 'opaque', attachPoint: 'prop-head' },
              { mesh: m('hele_pilos_a1.dae'), texture: t('hele_pilos_01_bronze.png'), mode: 'opaque', roughness: 0.38, metalness: 0.65, attachPoint: 'prop-helmet' },
              { mesh: m('aspis_athen.dae'), texture: t('aspis_athen_b.png'), mode: 'player', doubleSide: true, attachPoint: 'prop-shield_arm' },
              { mesh: m('gladius_03.dae'), texture: t('prop_weap.png'), mode: 'opaque', attachPoint: 'prop-weapon_R', isWeapon: true },
            ],
          },
        ],
      };

    // --- HAN, CELTIC, IBERIAN, KUSHITE, HELLENISTIC & MAURYAN UNITS ---
    case 'han_spearman':
    case 'brit_spearman':
    case 'gaul_spearman':
    case 'kush_spearman':
    case 'mace_pikeman':
    case 'maur_spearman':
    case 'sele_pikeman': {
      const spearTex =
        templateId === 'han_spearman'
          ? t('han_tunic_01.png')
          : templateId === 'brit_spearman' || templateId === 'gaul_spearman'
            ? t('celt_tunic_01.png')
            : templateId === 'kush_spearman'
              ? t('kush_dress_01.png')
              : templateId === 'maur_spearman'
                ? t('maur_tunic_01.png')
                : templateId === 'mace_pikeman'
                  ? t('rome_cardiopylax_01_01.png')
                  : t('hele_tunic_02_01.png');
      return {
        targetHeight: 1.86,
        parts: [
          {
            mesh: m('m_armor_tunic_short.dae'),
            texture: spearTex,
            mode: 'player',
            animations: HOPLITE_ANIMS,
            children: [
              { mesh: m('dude_head.dae'), texture: t('head_hele_a.png'), mode: 'opaque', attachPoint: 'prop-head' },
              { mesh: m('hele_pilos_a1.dae'), texture: t('rome_montefortino_bronze.png'), mode: 'opaque', roughness: 0.38, metalness: 0.62, attachPoint: 'prop-helmet' },
              { mesh: m('round_b_f.dae'), texture: t('rome_parma_a.png'), mode: 'player', doubleSide: true, attachPoint: 'prop-shield_arm', isCombatGear: true },
              { mesh: m('spear_hoplite.dae'), texture: t('prop_weap.png'), mode: 'opaque', attachPoint: 'prop-weapon_R', isWeapon: true, isCombatGear: true },
              ...WORKER_TOOLS,
            ],
          },
        ],
      };
    }

    case 'iber_swordsman':
      return {
        targetHeight: 1.85,
        parts: [
          {
            mesh: m('m_tunic_short.dae'),
            texture: t('iber_tunic_01.png'),
            mode: 'player',
            animations: SWORDSMAN_ANIMS,
            children: [
              { mesh: m('dude_head.dae'), texture: t('head_hele_a.png'), mode: 'opaque', attachPoint: 'prop-head' },
              { mesh: m('round_b_f.dae'), texture: t('rome_parma_a.png'), mode: 'player', doubleSide: true, attachPoint: 'prop-shield_arm', isCombatGear: true },
              { mesh: m('gladius_03.dae'), texture: t('prop_weap.png'), mode: 'opaque', attachPoint: 'prop-weapon_R', isWeapon: true, isCombatGear: true },
              ...WORKER_TOOLS,
            ],
          },
        ],
      };

    case 'han_crossbow':
    case 'han_guard':
    case 'kush_archer':
    case 'mace_archer':
    case 'maur_archer':
    case 'sele_archer': {
      const archTex =
        templateId === 'han_crossbow' || templateId === 'han_guard'
          ? t('han_tunic_01.png')
          : templateId === 'kush_archer'
            ? t('kush_dress_01.png')
            : templateId === 'maur_archer'
              ? t('maur_tunic_01.png')
              : t('hele_tunic_01_01.png');
      return {
        targetHeight: templateId === 'han_guard' ? 1.92 : 1.82,
        parts: [
          {
            mesh: templateId === 'han_guard' ? m('m_armor_tunic_short.dae') : m('m_tunic_short.dae'),
            texture: archTex,
            mode: 'player',
            animations: ARCHER_ANIMS,
            children: [
              { mesh: m('dude_head.dae'), texture: t('head_hele_a.png'), mode: 'opaque', attachPoint: 'prop-head' },
              { mesh: m('hele_pilos_a1.dae'), texture: t('hele_pilos_01_bronze.png'), mode: 'opaque', roughness: 0.42, metalness: 0.58, attachPoint: 'prop-helmet' },
              { mesh: m('bow_greek.dae'), texture: t('bow_wood.png'), mode: 'player', attachPoint: 'prop-weapon_bow', isWeapon: true, isCombatGear: true },
              ...(templateId === 'han_guard' ? [] : WORKER_TOOLS),
            ],
          },
        ],
      };
    }

    case 'brit_slinger':
    case 'gaul_slinger':
    case 'iber_slinger':
      return {
        targetHeight: 1.8,
        parts: [
          {
            mesh: m('m_tunic_short.dae'),
            texture: templateId === 'iber_slinger' ? t('iber_tunic_01.png') : t('celt_tunic_01.png'),
            mode: 'player',
            animations: JAVELIN_ANIMS,
            children: [
              { mesh: m('dude_head.dae'), texture: t('head_hele_a.png'), mode: 'opaque', attachPoint: 'prop-head' },
              { mesh: m('round_b_f.dae'), texture: t('rome_parma_a.png'), mode: 'player', doubleSide: true, attachPoint: 'prop-shield', isCombatGear: true },
              { mesh: m('weap_javelin_shaft_loaded_a.dae'), texture: t('prop_weap.png'), mode: 'opaque', attachPoint: 'prop-weapon_R', isWeapon: true, isCombatGear: true },
              ...WORKER_TOOLS,
            ],
          },
        ],
      };

    case 'han_cavalry':
    case 'brit_cavalry':
    case 'gaul_cavalry':
    case 'gaul_champion':
    case 'iber_cavalry':
    case 'iber_fire_cav':
    case 'kush_cavalry':
    case 'mace_cavalry':
    case 'mace_companion':
    case 'maur_cavalry':
    case 'sele_cavalry':
      return {
        targetHeight: templateId === 'mace_companion' || templateId === 'gaul_champion' ? 2.48 : 2.38,
        parts: [
          {
            mesh: m('horse_tessalian.dae'),
            texture: t('horse_brown.png'),
            mode: 'opaque',
            animations: HORSE_ANIMS,
            children: [
              {
                mesh: m('m_armor_tunic_short.dae'),
                texture: t('rome_subarmalis_01_01.png'),
                mode: 'player',
                attachPoint: 'prop_rider',
                animations: RIDER_ANIMS,
                children: [
                  { mesh: m('dude_head.dae'), texture: t('head_hele_a.png'), mode: 'opaque', attachPoint: 'prop-head' },
                  { mesh: m('hele_pilos_a1.dae'), texture: t('rome_montefortino_bronze.png'), mode: 'opaque', roughness: 0.36, metalness: 0.65, attachPoint: 'prop-helmet' },
                  { mesh: m('spear_lance_cavalry_reverse.dae'), texture: t('prop_weap.png'), mode: 'opaque', attachPoint: 'prop-weapon_R', isWeapon: true },
                ],
              },
            ],
          },
        ],
      };

    case 'han_champion':
    case 'brit_champion':
    case 'gaul_fanatic':
    case 'iber_champion':
    case 'kush_champion':
    case 'mace_champion':
    case 'sele_champion':
      return {
        targetHeight: 2.04,
        parts: [
          {
            mesh: templateId === 'gaul_fanatic' ? m('m_tunic_short.dae') : m('m_armor_tunic_short.dae'),
            texture: templateId === 'mace_champion' || templateId === 'sele_champion' ? t('athen_epilektos_01.png') : t('rome_cuirass_01_01.png'),
            mode: 'player',
            roughness: 0.42,
            metalness: 0.52,
            animations: templateId === 'mace_champion' || templateId === 'sele_champion' ? HOPLITE_ANIMS : SWORDSMAN_ANIMS,
            children: [
              { mesh: m('dude_head.dae'), texture: t('head_hele_a.png'), mode: 'opaque', attachPoint: 'prop-head' },
              { mesh: m('rome_montefortino_a_2.dae'), texture: t('metal_gold_aegean.png'), mode: 'alpha', roughness: 0.32, metalness: 0.72, attachPoint: 'prop-helmet' },
              {
                mesh: templateId === 'mace_champion' || templateId === 'sele_champion' ? m('spear_hoplite.dae') : m('gladius_03.dae'),
                texture: t('prop_weap.png'),
                mode: 'opaque',
                attachPoint: 'prop-weapon_R',
                isWeapon: true,
              },
            ],
          },
        ],
      };

    // --- SPECIALIZED CULTURAL WARFARE & ARTILLERY (Official 0 A.D. 3D Models!) ---
    case 'war_dog':
      return {
        targetHeight: 0.96,
        parts: [
          {
            mesh: m('mastiff.dae'),
            texture: t('mastiff_b_01.png'),
            mode: 'player',
            roughness: 0.86,
            animations: {
              idle: ANIMATION_ASSETS.mastiffIdle,
              walk: ANIMATION_ASSETS.mastiffRun,
              attack: ANIMATION_ASSETS.mastiffAttack,
            },
          },
        ],
      };

    case 'camel_rider':
      return {
        targetHeight: 2.52,
        parts: [
          {
            mesh: m('camel.dae'),
            texture: t('animal_camel_b_belt.png'),
            mode: 'opaque',
            roughness: 0.88,
            animations: {
              idle: ANIMATION_ASSETS.camelIdle,
              walk: ANIMATION_ASSETS.camelRun,
              attack: ANIMATION_ASSETS.camelIdle,
            },
            children: [
              {
                mesh: m('m_tunic_short.dae'),
                texture: t('hele_tunic_01_01.png'),
                mode: 'player',
                attachPoint: 'prop_rider',
                animations: RIDER_ANIMS,
                children: [
                  { mesh: m('dude_head.dae'), texture: t('head_hele_a.png'), mode: 'opaque', attachPoint: 'prop-head' },
                  { mesh: m('hele_phrygian_a.dae'), texture: t('hele_pilos_01_bronze.png'), mode: 'opaque', attachPoint: 'prop-helmet' },
                  { mesh: m('bow_greek.dae'), texture: t('bow_wood.png'), mode: 'player', attachPoint: 'prop-weapon_bow', isWeapon: true },
                ],
              },
            ],
          },
        ],
      };

    case 'gastraphetes_crossbow':
    case 'fire_archer':
      return {
        targetHeight: 1.88,
        parts: [
          {
            mesh: templateId === 'gastraphetes_crossbow' ? m('m_armor_tunic_short.dae') : m('m_tunic_short.dae'),
            texture: templateId === 'fire_archer' ? t('rome_subarmalis_01_01.png') : t('athen_epilektos_01.png'),
            mode: 'player',
            animations: ARCHER_ANIMS,
            children: [
              { mesh: m('dude_head.dae'), texture: t('head_hele_a.png'), mode: 'opaque', attachPoint: 'prop-head' },
              { mesh: m('hele_pilos_a1.dae'), texture: t('rome_montefortino_bronze.png'), mode: 'opaque', roughness: 0.38, metalness: 0.62, attachPoint: 'prop-helmet' },
              { mesh: m('bow_greek.dae'), texture: t('bow_wood.png'), mode: 'player', attachPoint: 'prop-weapon_bow', isWeapon: true },
            ],
          },
        ],
      };

    case 'kush_elephant':
    case 'maur_elephant':
    case 'sele_elephant':
    case 'pers_elephant':
    case 'ptol_elephant':
    case 'carth_elephant':
      return {
        targetHeight: 3.35,
        parts: [
          {
            mesh: m('elephant_asian_male.dae'),
            texture: t('animal_elephant_asian.png'),
            normTex: t('animal_elephant_asian_norm.png'),
            mode: 'opaque',
            roughness: 0.88,
            animations: {
              idle: ANIMATION_ASSETS.elephantIdle,
              walk: ANIMATION_ASSETS.elephantWalk,
              attack: ANIMATION_ASSETS.elephantWalk,
            },
          },
        ],
      };

    case 'siege_lithobolos':
      return {
        targetFootprint: 3.5,
        sinkY: -0.05,
        parts: [
          {
            mesh: m('lithobolos_01.dae'),
            texture: t('siege_artillery_01.png'),
            normTex: t('siege_artillery_01_norm.png'),
            mode: 'opaque',
            roughness: 0.85,
            animations: {
              idle: ANIMATION_ASSETS.lithobolosIdle,
              walk: ANIMATION_ASSETS.lithobolosIdle,
              attack: ANIMATION_ASSETS.lithobolosAttack,
            },
          },
        ],
      };

    case 'siege_catapult':
      return {
        targetFootprint: 3.8,
        sinkY: -0.05,
        parts: [
          {
            mesh: m('siege_onager.dae'),
            texture: t('rome_siege_onager.png'),
            mode: 'player',
            roughness: 0.86,
            animations: {
              idle: ANIMATION_ASSETS.onagerIdle,
              walk: ANIMATION_ASSETS.onagerIdle,
              attack: ANIMATION_ASSETS.onagerAttack,
            },
          },
        ],
      };

    case 'siege_ballista':
      return {
        targetFootprint: 3.1,
        sinkY: -0.05,
        parts: [
          {
            mesh: m('oxybeles_01.dae'),
            texture: t('siege_artillery_01.png'),
            normTex: t('siege_artillery_01_norm.png'),
            mode: 'opaque',
            roughness: 0.84,
            animations: {
              idle: ANIMATION_ASSETS.oxybelesIdle,
              walk: ANIMATION_ASSETS.oxybelesIdle,
              attack: ANIMATION_ASSETS.oxybelesAttack,
            },
          },
        ],
      };

    // --- OFFICIAL 0 A.D. 3D WAR CHARIOTS (Celtic, Persian Scythed & Han Imperial!) ---
    case 'brit_chariot':
      return {
        targetFootprint: 4.4,
        sinkY: -0.04,
        parts: [
          {
            mesh: m('celt_char_a.dae'),
            texture: t('celt_chariot_a.png'),
            mode: 'player',
            roughness: 0.84,
            animations: {
              idle: ANIMATION_ASSETS.chariotIdle,
              walk: ANIMATION_ASSETS.chariotMove,
              attack: ANIMATION_ASSETS.chariotIdle,
            },
            children: [
              { mesh: m('horse_tessalian.dae'), texture: t('horse_brown.png'), mode: 'opaque', attachPoint: 'prop_horse2', animations: HORSE_ANIMS },
              { mesh: m('horse_tessalian.dae'), texture: t('horse_brown.png'), mode: 'opaque', attachPoint: 'prop_horse3', animations: HORSE_ANIMS },
              {
                mesh: m('m_tunic_short.dae'),
                texture: t('celt_tunic_01.png'),
                mode: 'player',
                attachPoint: 'prop_driver1',
                children: [{ mesh: m('dude_head.dae'), texture: t('head_hele_a.png'), mode: 'opaque', attachPoint: 'prop-head' }],
              },
              {
                mesh: m('m_armor_tunic_short.dae'),
                texture: t('celt_tunic_01.png'),
                mode: 'player',
                attachPoint: 'prop_rider1',
                animations: JAVELIN_ANIMS,
                children: [
                  { mesh: m('dude_head.dae'), texture: t('head_hele_a.png'), mode: 'opaque', attachPoint: 'prop-head' },
                  { mesh: m('weap_javelin_shaft_loaded_a.dae'), texture: t('prop_weap.png'), mode: 'opaque', attachPoint: 'prop-weapon_R', isWeapon: true },
                ],
              },
            ],
          },
        ],
      };

    case 'pers_chariot':
      return {
        targetFootprint: 4.8,
        sinkY: -0.04,
        parts: [
          {
            mesh: m('pers_chariot_a.dae'),
            texture: t('pers_chariot_a.png'),
            mode: 'player',
            roughness: 0.82,
            animations: {
              idle: ANIMATION_ASSETS.chariotIdle,
              walk: ANIMATION_ASSETS.chariotMove,
              attack: ANIMATION_ASSETS.chariotIdle,
            },
            children: [
              { mesh: m('horse_tessalian.dae'), texture: t('horse_brown.png'), mode: 'opaque', attachPoint: 'prop_horse1', animations: HORSE_ANIMS },
              { mesh: m('horse_tessalian.dae'), texture: t('horse_brown.png'), mode: 'opaque', attachPoint: 'prop_horse2', animations: HORSE_ANIMS },
              { mesh: m('horse_tessalian.dae'), texture: t('horse_brown.png'), mode: 'opaque', attachPoint: 'prop_horse3', animations: HORSE_ANIMS },
              { mesh: m('horse_tessalian.dae'), texture: t('horse_brown.png'), mode: 'opaque', attachPoint: 'prop_horse4', animations: HORSE_ANIMS },
              {
                mesh: m('m_tunic_short.dae'),
                texture: t('pers_tunic_01.png'),
                mode: 'player',
                attachPoint: 'prop_driver1',
                children: [{ mesh: m('dude_head.dae'), texture: t('head_hele_a.png'), mode: 'opaque', attachPoint: 'prop-head' }],
              },
              {
                mesh: m('m_armor_tunic_short.dae'),
                texture: t('pers_tunic_01.png'),
                mode: 'player',
                attachPoint: 'prop_rider1',
                animations: ARCHER_ANIMS,
                children: [
                  { mesh: m('dude_head.dae'), texture: t('head_hele_a.png'), mode: 'opaque', attachPoint: 'prop-head' },
                  { mesh: m('bow_greek.dae'), texture: t('bow_wood.png'), mode: 'player', attachPoint: 'prop-weapon_bow', isWeapon: true },
                ],
              },
            ],
          },
        ],
      };

    case 'han_chariot':
      return {
        targetFootprint: 4.8,
        sinkY: -0.04,
        parts: [
          {
            mesh: m('han_chariot.dae'),
            texture: t('chariot_01.png'),
            normTex: t('chariot_01_norm.png'),
            mode: 'player',
            roughness: 0.82,
            animations: {
              idle: ANIMATION_ASSETS.chariotIdle,
              walk: ANIMATION_ASSETS.chariotMove,
              attack: ANIMATION_ASSETS.chariotIdle,
            },
            children: [
              { mesh: m('horse_tessalian.dae'), texture: t('horse_brown.png'), mode: 'opaque', attachPoint: 'prop_horse1', animations: HORSE_ANIMS },
              { mesh: m('horse_tessalian.dae'), texture: t('horse_brown.png'), mode: 'opaque', attachPoint: 'prop_horse2', animations: HORSE_ANIMS },
              { mesh: m('horse_tessalian.dae'), texture: t('horse_brown.png'), mode: 'opaque', attachPoint: 'prop_horse3', animations: HORSE_ANIMS },
              { mesh: m('horse_tessalian.dae'), texture: t('horse_brown.png'), mode: 'opaque', attachPoint: 'prop_horse4', animations: HORSE_ANIMS },
              {
                mesh: m('m_tunic_short.dae'),
                texture: t('han_tunic_01.png'),
                mode: 'player',
                attachPoint: 'prop_driver1',
                children: [{ mesh: m('dude_head.dae'), texture: t('head_hele_a.png'), mode: 'opaque', attachPoint: 'prop-head' }],
              },
              {
                mesh: m('m_armor_tunic_short.dae'),
                texture: t('han_tunic_01.png'),
                mode: 'player',
                attachPoint: 'prop_rider1',
                animations: ARCHER_ANIMS,
                children: [
                  { mesh: m('dude_head.dae'), texture: t('head_hele_a.png'), mode: 'opaque', attachPoint: 'prop-head' },
                  { mesh: m('bow_greek.dae'), texture: t('bow_wood.png'), mode: 'player', attachPoint: 'prop-weapon_bow', isWeapon: true },
                ],
              },
            ],
          },
        ],
      };

    default:
      return null;
  }
}

interface MixerTrackTarget {
  mixer: THREE.AnimationMixer;
  clips: AnimClipSet;
  actions: Map<string, THREE.AnimationAction>;
  activeUrl: string | null;
  activeAction: THREE.AnimationAction | null;
  phaseSeed: number;
}

/**
 * Drives genuine 0 A.D. COLLADA skeletal animations via THREE.AnimationMixer
 * with smooth cross-fades, per-unit phase jitter, and speed-matched stride rates.
 */
export class UnitAnimator {
  private readonly targets: MixerTrackTarget[] = [];
  private readonly combatGear: THREE.Object3D[] = [];
  private readonly tools = new Map<Exclude<ToolMode, 'combat'>, THREE.Object3D[]>();
  private activeTool: ToolMode = 'combat';
  private hasPlayedAny = false;

  addTarget(root: THREE.Object3D, clips: AnimClipSet): void {
    this.targets.push({
      mixer: new THREE.AnimationMixer(root),
      clips,
      actions: new Map(),
      activeUrl: null,
      activeAction: null,
      phaseSeed: Math.random() * 2.5,
    });
  }

  registerCombatGear(obj: THREE.Object3D): void {
    this.combatGear.push(obj);
  }

  registerTool(role: Exclude<ToolMode, 'combat'>, obj: THREE.Object3D): void {
    obj.visible = false;
    const list = this.tools.get(role) ?? [];
    list.push(obj);
    this.tools.set(role, list);
  }

  setToolMode(mode: ToolMode): void {
    if (this.activeTool === mode) return;
    this.activeTool = mode;
    const showCombat = mode === 'combat';
    for (const obj of this.combatGear) obj.visible = showCombat;
    for (const [role, list] of this.tools.entries()) {
      const show = role === mode;
      for (const obj of list) obj.visible = show;
    }
  }

  isPlayingSkeletal(): boolean {
    return this.hasPlayedAny;
  }

  update(
    dt: number,
    animState: 'idle' | 'walk' | 'attack' | 'gather' | 'build' | 'death',
    gatherResType: ResourceType | null,
    speedRatio = 1,
    gatherTargetTemplate?: string | null
  ): void {
    const isFarmingField = animState === 'gather' && gatherTargetTemplate === 'field';
    const isPreyTarget =
      gatherTargetTemplate === 'deer_herd' ||
      gatherTargetTemplate === 'wild_boar' ||
      gatherTargetTemplate === 'wild_gazelle' ||
      gatherTargetTemplate === 'wild_elephant' ||
      gatherTargetTemplate === 'predator_wolf' ||
      gatherTargetTemplate === 'predator_lion' ||
      gatherTargetTemplate === 'predator_bear' ||
      gatherTargetTemplate === 'sea_monster' ||
      gatherTargetTemplate === 'sea_kraken' ||
      gatherTargetTemplate === 'lake_nessie';

    // Equip the appropriate 0 A.D. tool for the active task:
    // - Hunting live prey: female citizen draws hunting dagger; soldiers use combat weapon
    // - Butchering slain prey: ALL workers draw butcher dagger + gather_meat animation
    let toolMode: ToolMode = 'combat';
    if (animState === 'build') {
      toolMode = 'mallet';
    } else if (animState === 'attack' && isPreyTarget) {
      toolMode = this.combatGear.length === 0 ? 'knife' : 'combat';
    } else if (animState === 'gather') {
      if (gatherResType === 'wood') toolMode = 'axe';
      else if (gatherResType === 'stone' || gatherResType === 'metal') toolMode = 'pick';
      else if (isFarmingField) toolMode = 'hoe';
      else if (isPreyTarget) toolMode = 'knife';
      else toolMode = 'basket';
    }
    this.setToolMode(toolMode);

    const key: UnitAnimKey =
      animState === 'death'
        ? 'death'
        : animState === 'attack' && isPreyTarget && this.combatGear.length === 0
          ? 'slaughter'
          : animState === 'gather'
            ? gatherResType === 'wood'
              ? 'gather_wood'
              : gatherResType === 'stone' || gatherResType === 'metal'
                ? 'gather_mine'
                : isFarmingField
                  ? 'gather_grain'
                  : isPreyTarget
                    ? 'gather_meat'
                    : 'gather_food'
            : animState;

    const isOneShot = animState === 'death';

    for (const target of this.targets) {
      // When dead and no dedicated death clip exists, pause the skeletal rig so the dead animal lies still instead of looping idle!
      if (animState === 'death' && !target.clips.death) {
        if (target.activeAction) {
          target.activeAction.paused = true;
        }
        continue;
      }
      const desiredUrl = target.clips[key] ?? target.clips.idle;
      const clip = zeroADAssets.getAnimationClipSync(desiredUrl);
      if (!clip) {
        zeroADAssets.loadAnimationClip(desiredUrl).catch(() => {});
        continue;
      }

      this.hasPlayedAny = true;

      if (target.activeUrl !== desiredUrl) {
        let nextAction = target.actions.get(desiredUrl);
        if (!nextAction) {
          nextAction = target.mixer.clipAction(clip);
          target.actions.set(desiredUrl, nextAction);
        }
        nextAction.paused = false;
        if (isOneShot) {
          nextAction.setLoop(THREE.LoopOnce, 1);
          nextAction.clampWhenFinished = true;
        } else {
          nextAction.setLoop(THREE.LoopRepeat, Infinity);
          nextAction.clampWhenFinished = false;
        }
        nextAction.reset();
        nextAction.enabled = true;
        if (!target.activeAction) {
          // Stagger starting phase on looping clips so squads don't breathe/march in lockstep
          nextAction.time = isOneShot ? 0 : target.phaseSeed % Math.max(0.1, clip.duration);
          nextAction.play();
        } else {
          nextAction.play();
          target.activeAction.crossFadeTo(nextAction, isOneShot ? 0.12 : 0.2, false);
        }
        target.activeUrl = desiredUrl;
        target.activeAction = nextAction;
      }

      if (target.activeAction) {
        if (animState === 'walk') {
          target.activeAction.timeScale = THREE.MathUtils.clamp(speedRatio, 0.65, 1.55);
        } else if (animState === 'attack') {
          target.activeAction.timeScale = 1.15;
        } else {
          target.activeAction.timeScale = 1.0;
        }
      }

      target.mixer.update(dt);
    }
  }
}

const SKIP_ROOT_ARMS = new Set([
  'Biped',
  'Horse_Armature',
  'Deer01',
  'Boar_Armature',
  'Wolf',
  'Horse',
  'Ursidae_Armature',
  'Elephantidae_Asian_Quadraped',
  'BlenderHawk',
  'RowingBoat',
  'Armature',
  'Camelus',
  'Lithobolos_Armature',
  'Oxybeles_Armature',
  'onager',
  'Chariot',
]);

class ZeroADAssetCache {
  private readonly colladaLoader = new ColladaLoader();
  private readonly textureLoader = new THREE.TextureLoader();
  private readonly daeCache = new Map<string, Promise<THREE.Object3D>>();
  private readonly resolvedDae = new Map<string, THREE.Object3D>();
  private readonly animPromiseCache = new Map<string, Promise<THREE.AnimationClip | null>>();
  private readonly resolvedAnims = new Map<string, THREE.AnimationClip>();
  private readonly texCache = new Map<string, THREE.Texture>();
  private readonly matCache = new Map<string, THREE.MeshStandardMaterial>();

  loadTexture(url: string, isSRGB = true): THREE.Texture {
    const key = `${url}_${isSRGB ? 's' : 'l'}`;
    let tex = this.texCache.get(key);
    if (!tex) {
      tex = this.textureLoader.load(url);
      tex.colorSpace = isSRGB ? THREE.SRGBColorSpace : THREE.NoColorSpace;
      tex.wrapS = THREE.RepeatWrapping;
      tex.wrapT = THREE.RepeatWrapping;
      tex.anisotropy = 4;
      this.texCache.set(key, tex);
    }
    return tex;
  }

  getMaterial(part: ModelPartSpec, teamColor: number): THREE.MeshStandardMaterial {
    const rough = part.roughness ?? 0.82;
    const metal = part.metalness ?? 0.08;
    const emis = part.emissive ?? 0;
    const tint = part.tint ?? 0;
    const ds = part.doubleSide || part.mode === 'alpha' ? 1 : 0;
    const tc = part.mode === 'player' ? teamColor : 0;
    const key = `${part.texture}|${part.normTex ?? ''}|${part.mode}|${tc}|${rough}|${metal}|${emis}|${tint}|${ds}`;
    let mat = this.matCache.get(key);
    if (mat) return mat;

    const map = this.loadTexture(part.texture, true);
    const normalMap = part.normTex ? this.loadTexture(part.normTex, false) : undefined;

    mat = new THREE.MeshStandardMaterial({
      map,
      normalMap,
      color: tint ? new THREE.Color(tint) : undefined,
      roughness: rough,
      metalness: metal,
      emissive: emis ? new THREE.Color(emis) : undefined,
      side: ds ? THREE.DoubleSide : THREE.FrontSide,
      alphaTest: part.mode === 'alpha' ? 0.42 : 0,
      transparent: false,
    });

    if (part.mode === 'player') {
      const playerCol = new THREE.Color(teamColor);
      mat.onBeforeCompile = (shader) => {
        shader.uniforms.uPlayerColor = { value: playerCol };
        shader.fragmentShader = shader.fragmentShader
          .replace(
            '#include <common>',
            `#include <common>
            uniform vec3 uPlayerColor;`
          )
          .replace(
            '#include <map_fragment>',
            `#ifdef USE_MAP
              vec4 sampledDiffuseColor = texture2D( map, vMapUv );
              sampledDiffuseColor.rgb *= mix( uPlayerColor, vec3( 1.0 ), sampledDiffuseColor.a );
              sampledDiffuseColor.a = 1.0;
              diffuseColor *= sampledDiffuseColor;
            #endif`
          );
      };
      mat.customProgramCacheKey = () => '0ad-player-color-v1';
    }

    this.matCache.set(key, mat);
    return mat;
  }

  loadDae(url: string): Promise<THREE.Object3D> {
    let p = this.daeCache.get(url);
    if (!p) {
      p = new Promise<THREE.Object3D>((resolve, reject) => {
        this.colladaLoader.load(
          url,
          (collada) => {
            const root = collada.scene;
            // 0 A.D.'s Pyrogenesis engine ignores COLLADA <unit meter="..."/> so props exported
            // from Blender (1), 3ds Max (0.0254), and Maya (0.01) align 1:1 with parent meshes.
            root.scale.set(1, 1, 1);
            // Strip any embedded lights/cameras exported by Blender
            const toRemove: THREE.Object3D[] = [];
            root.traverse((obj) => {
              if ((obj as THREE.Light).isLight || (obj as THREE.Camera).isCamera) {
                toRemove.push(obj);
              }
            });
            for (const r of toRemove) r.parent?.remove(r);
            this.resolvedDae.set(url, root);
            resolve(root);
          },
          undefined,
          (err) => reject(err)
        );
      });
      this.daeCache.set(url, p);
    }
    return p;
  }

  getAnimationClipSync(url: string): THREE.AnimationClip | null {
    return this.resolvedAnims.get(url) ?? null;
  }

  /**
   * Loads a 0 A.D. COLLADA animation .dae and retargets ColladaLoader's UUID-based
   * KeyframeTracks onto bone names so they drive any SkeletonUtils-cloned unit mesh.
   */
  loadAnimationClip(url: string): Promise<THREE.AnimationClip | null> {
    let p = this.animPromiseCache.get(url);
    if (!p) {
      p = new Promise<THREE.AnimationClip | null>((resolve) => {
        this.colladaLoader.load(
          url,
          (collada) => {
            const rawClips = collada.scene.animations ?? [];
            if (rawClips.length === 0) {
              resolve(null);
              return;
            }
            const uuidToName = new Map<string, string>();
            collada.scene.traverse((obj) => {
              if (obj.name) uuidToName.set(obj.uuid, obj.name);
            });

            const raw = rawClips[0];
            const retargetedTracks: THREE.KeyframeTrack[] = [];
            for (const track of raw.tracks) {
              const dotIdx = track.name.indexOf('.');
              if (dotIdx <= 0) continue;
              const uuid = track.name.slice(0, dotIdx);
              const prop = track.name.slice(dotIdx + 1);
              if (prop === 'scale') continue; // avoid export scale drift

              const boneName = uuidToName.get(uuid);
              if (!boneName) continue;
              if (SKIP_ROOT_ARMS.has(boneName)) continue;
              if (boneName.startsWith('prop-') || boneName.startsWith('prop_')) continue;

              const cloned = track.clone();
              cloned.name = `${boneName}.${prop}`;
              retargetedTracks.push(cloned);
            }

            if (retargetedTracks.length === 0) {
              resolve(null);
              return;
            }

            const clip = new THREE.AnimationClip(url, raw.duration, retargetedTracks);
            this.resolvedAnims.set(url, clip);
            resolve(clip);
          },
          undefined,
          () => resolve(null)
        );
      });
      this.animPromiseCache.set(url, p);
    }
    return p;
  }

  private collectMeshUrls(parts: ModelPartSpec[], out: Set<string>): void {
    for (const p of parts) {
      out.add(p.mesh);
      if (p.children) this.collectMeshUrls(p.children, out);
    }
  }

  private collectAnimUrls(parts: ModelPartSpec[], out: Set<string>): void {
    for (const p of parts) {
      if (p.animations) {
        for (const u of Object.values(p.animations)) {
          if (u) out.add(u);
        }
      }
      if (p.children) this.collectAnimUrls(p.children, out);
    }
  }

  isSpecReady(spec: EntityModelSpec): boolean {
    const urls = new Set<string>();
    this.collectMeshUrls(spec.parts, urls);
    for (const u of urls) {
      if (!this.resolvedDae.has(u)) return false;
    }
    return true;
  }

  async ensureSpecLoaded(spec: EntityModelSpec): Promise<void> {
    const urls = new Set<string>();
    this.collectMeshUrls(spec.parts, urls);
    const animUrls = new Set<string>();
    this.collectAnimUrls(spec.parts, animUrls);
    // Start loading animation clips in parallel (non-blocking for mesh swap)
    for (const a of animUrls) this.loadAnimationClip(a).catch(() => {});
    await Promise.all(Array.from(urls).map((u) => this.loadDae(u)));
  }

  private findAttachNode(root: THREE.Object3D, name: string): THREE.Object3D | null {
    const exact = root.getObjectByName(name);
    if (exact) return exact;
    const alt = name.includes('-') ? name.replace('-', '_') : name.replace('_', '-');
    return root.getObjectByName(alt) ?? null;
  }

  private instantiatePart(
    part: ModelPartSpec,
    teamColor: number,
    isAttachedInsideZUp: boolean,
    state: { weaponPivot?: THREE.Object3D; animator?: UnitAnimator }
  ): THREE.Object3D {
    const proto = this.resolvedDae.get(part.mesh);
    if (!proto) return new THREE.Group();

    const cloned = SkeletonUtils.clone(proto);
    // Avoid double -PI/2 Z_UP -> Y_UP rotation when attaching inside a Z_UP parent bone
    if (isAttachedInsideZUp) {
      cloned.rotation.set(0, 0, 0);
    }

    const mat = this.getMaterial(part, teamColor);
    cloned.traverse((obj) => {
      if ((obj as THREE.Mesh).isMesh) {
        const mesh = obj as THREE.Mesh;
        mesh.material = mat;
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        mesh.frustumCulled = false;
      }
    });

    if (part.animations) {
      if (!state.animator) state.animator = new UnitAnimator();
      state.animator.addTarget(cloned, part.animations);
    }

    if (part.toolRole) {
      cloned.userData.isWorkTool = true;
      if (part.toolRole === 'basket') {
        // Place foraging basket neatly on the ground in front of the worker's feet
        cloned.position.set(0, -0.55, 0);
      }
      if (!state.animator) state.animator = new UnitAnimator();
      state.animator.registerTool(part.toolRole, cloned);
    }

    if (part.children) {
      for (const childSpec of part.children) {
        const targetNode = childSpec.attachPoint ? this.findAttachNode(cloned, childSpec.attachPoint) : null;
        // Parent is already Z_UP (-PI/2 X rotated at root), so all nested children stay in parent's Z_UP space
        const childObj = this.instantiatePart(childSpec, teamColor, true, state);
        let attachedRoot: THREE.Object3D = childObj;
        if (targetNode) {
          if (childSpec.isWeapon) {
            const pivot = new THREE.Group();
            pivot.add(childObj);
            targetNode.add(pivot);
            state.weaponPivot = pivot;
            attachedRoot = pivot;
          } else {
            targetNode.add(childObj);
          }
        } else {
          cloned.add(childObj);
        }
        if (childSpec.isCombatGear) {
          if (!state.animator) state.animator = new UnitAnimator();
          state.animator.registerCombatGear(attachedRoot);
        }
      }
    }

    return cloned;
  }

  buildSync(
    spec: EntityModelSpec,
    teamColor: number
  ): { container: THREE.Group; weaponPivot?: THREE.Object3D; animator?: UnitAnimator } {
    const wrapper = new THREE.Group();
    const inner = new THREE.Group();
    wrapper.add(inner);

    const state: { weaponPivot?: THREE.Object3D; animator?: UnitAnimator } = {};
    for (const part of spec.parts) {
      const obj = this.instantiatePart(part, teamColor, false, state);
      inner.add(obj);
    }

    if (spec.rotateY) {
      inner.rotation.y = spec.rotateY;
    }

    // Normalize scale & center cleanly on ground plane y=0 (ignoring hidden work tools!)
    wrapper.updateMatrixWorld(true);
    const box = new THREE.Box3();
    const meshBox = new THREE.Box3();
    inner.traverse((obj) => {
      if (!(obj as THREE.Mesh).isMesh) return;
      // Skip hidden work-tool meshes so centering & height match the worker's actual silhouette
      let cur: THREE.Object3D | null = obj;
      while (cur && cur !== inner) {
        if (cur.userData?.isWorkTool) return;
        cur = cur.parent;
      }
      meshBox.setFromObject(obj);
      box.union(meshBox);
    });
    if (box.isEmpty()) {
      box.setFromObject(inner);
    }
    if (!box.isEmpty()) {
      const size = new THREE.Vector3();
      const center = new THREE.Vector3();
      box.getSize(size);
      box.getCenter(center);

      let scale = 1;
      if (spec.targetHeight && size.y > 0.001) {
        scale = spec.targetHeight / size.y;
      } else if (spec.targetFootprint) {
        const horiz = Math.max(size.x, size.z);
        if (horiz > 0.001) {
          scale = spec.targetFootprint / horiz;
        }
      }

      inner.scale.setScalar(scale);
      // Official 0 A.D. building DAEs place their architectural ground floor at y = 0 and extend
      // deep underground foundation walls into y < 0 (e.g. -5..-15) for slope anchoring.
      // Lifting by -box.min.y would float Civic Centers & Fortresses meters above the ground!
      const hasUndergroundFoundation =
        Boolean(spec.targetFootprint) && box.min.y < -0.2 && box.max.y > size.y * 0.35;
      const baseY = hasUndergroundFoundation ? 0 : -box.min.y * scale;
      inner.position.set(
        -center.x * scale,
        baseY + (spec.sinkY ?? 0),
        -center.z * scale
      );
    }

    return { container: wrapper, weaponPivot: state.weaponPivot, animator: state.animator };
  }
}

export const zeroADAssets = new ZeroADAssetCache();

/** Kick off parallel background preloading of 0 A.D. models and skeletal animations */
export function preloadZeroADModels(civs: CivId[]): void {
  // Preload all skeletal animation clips & wheat crop mesh right away!
  for (const animUrl of Object.values(ANIMATION_ASSETS)) {
    zeroADAssets.loadAnimationClip(animUrl).catch(() => {});
  }
  zeroADAssets.loadDae(m('wheat_crop.dae')).catch(() => {});

  const templates = [
    'civic_center',
    'house',
    'apartment_house',
    'storehouse',
    'farmstead',
    'pasture',
    'barracks',
    'defense_tower',
    'outpost',
    'fortress',
    'temple',
    'blacksmith',
    'market',
    'stable',
    'workshop',
    'wonder',
    'dock',
    'gymnasium',
    'army_camp',
    'syssition',
    'apadana',
    'carth_embassy',
    'ptol_library',
    'tree_cypress',
    'tree_olive',
    'tree_pine',
    'tree_palm',
    'tree_oak',
    'tree_cedar',
    'tree_willow',
    'tree_apple',
    'tree_orange',
    'tree_fig',
    'tree_date_palm',
    'tree_cherry',
    'tree_kapok',
    'tree_maple',
    'tree_jacaranda',
    'tree_flamboyant',
    'tree_golden_shower',
    'tree_trumpet',
    'tree_ginkgo',
    'tree_birch',
    'tree_blue_spruce',
    'tree_coconut',
    'tree_hybrid_golden_citrus',
    'tree_hybrid_honey_fig',
    'tree_hybrid_cedar_oak',
    'tree_hybrid_iron_bamboo',
    'tree_hybrid_olive_citrus',
    'tree_hybrid_royal_orchard',
    'treasure_chest',
    'treasure_amphora',
    'treasure_relic',
    'berry_bush',
    'grape_vine',
    'deer_herd',
    'wild_boar',
    'stone_quarry',
    'marble_quarry',
    'metal_mine',
    'gold_vein',
    'rally_flag',
    'female_citizen',
    'male_citizen',
    'scout',
    'doctor',
    'healer',
    'siege_ram',
    'athen_hoplite',
    'athen_archer',
    'athen_cavalry',
    'athen_champion',
    'athen_marine',
    'rome_hastatus',
    'rome_velite',
    'rome_cavalry',
    'rome_champion',
    'rome_praetorian',
    'spart_perioikos',
    'spart_skirmisher',
    'spart_cavalry',
    'spart_spartiate',
    'spart_hero_guard',
    'pers_spearman',
    'pers_archer',
    'pers_cavalry',
    'pers_immortal',
    'pers_cataphract',
    'carth_spearman',
    'carth_slinger',
    'carth_cavalry',
    'carth_sacred_band',
    'carth_mercenary',
    'ptol_pikeman',
    'ptol_archer',
    'ptol_cavalry',
    'ptol_royal_guard',
    'ptol_klerouch',
    'han_spearman',
    'han_crossbow',
    'han_cavalry',
    'han_champion',
    'han_guard',
    'brit_spearman',
    'brit_slinger',
    'brit_cavalry',
    'brit_champion',
    'gaul_spearman',
    'gaul_slinger',
    'gaul_cavalry',
    'gaul_champion',
    'gaul_fanatic',
    'iber_swordsman',
    'iber_slinger',
    'iber_cavalry',
    'iber_champion',
    'iber_fire_cav',
    'kush_spearman',
    'kush_archer',
    'kush_cavalry',
    'kush_champion',
    'mace_pikeman',
    'mace_archer',
    'mace_cavalry',
    'mace_champion',
    'mace_companion',
    'maur_spearman',
    'maur_archer',
    'maur_cavalry',
    'sele_pikeman',
    'sele_archer',
    'sele_cavalry',
    'sele_champion',
    'tree_bamboo',
    'wild_gazelle',
    'wild_sheep',
    'wild_goat',
    'wild_chicken',
    'wild_camel',
    'wild_aurochs',
    'wild_elephant',
    'sea_walrus',
    'sea_whale',
    'predator_wolf',
    'predator_lion',
    'predator_tiger',
    'predator_bear',
    'predator_polar_bear',
    'predator_hippo',
    'wild_eagle',
    'wild_seagull',
    'fishing_boat',
    'warship_trireme',
    'war_dog',
    'camel_rider',
    'gastraphetes_crossbow',
    'fire_archer',
    'pers_elephant',
    'ptol_elephant',
    'carth_elephant',
    'siege_lithobolos',
    'siege_catapult',
    'siege_ballista',
    'brit_chariot',
    'pers_chariot',
    'han_chariot',
  ];
  for (const civ of civs) {
    for (const tpl of templates) {
      const spec = getZeroADModelSpec(tpl, civ);
      if (spec) {
        zeroADAssets.ensureSpecLoaded(spec).catch(() => {});
      }
    }
  }
}
