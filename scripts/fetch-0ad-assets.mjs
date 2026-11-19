import fs from 'node:fs/promises';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const OUT_DIR = path.join(ROOT, 'public', 'assets', '0ad');
const MEDIA_BASE = 'https://gitea.wildfiregames.com/0ad/0ad/media/branch/main/binaries/data/mods/public';

/** @type {Array<{ src: string; dst: string; convertDds?: boolean; maxDim?: number }>} */
const MANIFEST = [
  // License / Attribution
  { src: 'art/LICENSE.txt', dst: 'LICENSE.txt' },

  // ==================== UI ICONS & PORTRAITS ====================
  { src: 'art/textures/ui/session/icons/resources/food.png', dst: 'ui/res_food.png' },
  { src: 'art/textures/ui/session/icons/resources/wood.png', dst: 'ui/res_wood.png' },
  { src: 'art/textures/ui/session/icons/resources/stone.png', dst: 'ui/res_stone.png' },
  { src: 'art/textures/ui/session/icons/resources/metal.png', dst: 'ui/res_metal.png' },
  { src: 'art/textures/ui/session/icons/resources/population.png', dst: 'ui/res_pop.png' },
  { src: 'art/textures/ui/session/portraits/emblems/emblem_athenians.png', dst: 'ui/emblem_athenians.png' },
  { src: 'art/textures/ui/session/portraits/emblems/emblem_romans.png', dst: 'ui/emblem_romans.png' },

  // Gaia portraits
  { src: 'art/textures/ui/session/portraits/gaia/flora_tree_cypress.png', dst: 'ui/tree_cypress.png' },
  { src: 'art/textures/ui/session/portraits/gaia/flora_tree_generic.png', dst: 'ui/tree_olive.png' },
  { src: 'art/textures/ui/session/portraits/gaia/flora_tree_aleppo_pine.png', dst: 'ui/tree_pine.png' },
  { src: 'art/textures/ui/session/portraits/gaia/flora_tree_cretan_date_palm.png', dst: 'ui/tree_palm.png' },
  { src: 'art/textures/ui/session/portraits/gaia/flora_tree_apple.png', dst: 'ui/tree_oak.png' },
  { src: 'art/textures/ui/session/portraits/gaia/flora_bush_berry.png', dst: 'ui/berry_bush.png' },
  { src: 'art/textures/ui/session/portraits/gaia/flora_bush_grapes.png', dst: 'ui/grape_vine.png' },
  { src: 'art/textures/ui/session/portraits/gaia/fauna_deer.png', dst: 'ui/deer_herd.png' },
  { src: 'art/textures/ui/session/portraits/gaia/fauna_boar.png', dst: 'ui/wild_boar.png' },
  { src: 'art/textures/ui/session/portraits/gaia/geology_stone.png', dst: 'ui/stone_quarry.png' },
  { src: 'art/textures/ui/session/portraits/gaia/geology_stone_2.png', dst: 'ui/marble_quarry.png' },
  { src: 'art/textures/ui/session/portraits/gaia/geology_metal.png', dst: 'ui/metal_mine.png' },
  { src: 'art/textures/ui/session/portraits/gaia/geology_metal_2.png', dst: 'ui/gold_vein.png' },

  // Structure portraits
  { src: 'art/textures/ui/session/portraits/structures/civic_centre.png', dst: 'ui/civic_center.png' },
  { src: 'art/textures/ui/session/portraits/structures/house.png', dst: 'ui/house.png' },
  { src: 'art/textures/ui/session/portraits/structures/storehouse.png', dst: 'ui/storehouse.png' },
  { src: 'art/textures/ui/session/portraits/structures/farmstead.png', dst: 'ui/farmstead.png' },
  { src: 'art/textures/ui/session/portraits/structures/field.png', dst: 'ui/field.png' },
  { src: 'art/textures/ui/session/portraits/structures/barracks.png', dst: 'ui/barracks.png' },
  { src: 'art/textures/ui/session/portraits/structures/defense_tower.png', dst: 'ui/defense_tower.png' },
  { src: 'art/textures/ui/session/portraits/structures/outpost.png', dst: 'ui/outpost.png' },
  { src: 'art/textures/ui/session/portraits/structures/fortress.png', dst: 'ui/fortress.png' },
  { src: 'art/textures/ui/session/portraits/structures/temple.png', dst: 'ui/temple.png' },
  { src: 'art/textures/ui/session/portraits/structures/blacksmith.png', dst: 'ui/blacksmith.png' },
  { src: 'art/textures/ui/session/portraits/structures/market.png', dst: 'ui/market.png' },
  { src: 'art/textures/ui/session/portraits/structures/stable_01.png', dst: 'ui/stable.png' },
  { src: 'art/textures/ui/session/portraits/structures/siege_workshop.png', dst: 'ui/workshop.png' },
  { src: 'art/textures/ui/session/portraits/structures/wonder.png', dst: 'ui/wonder.png' },

  // Unit portraits
  { src: 'art/textures/ui/session/portraits/units/hele/support_female_citizen.png', dst: 'ui/female_citizen_athen.png' },
  { src: 'art/textures/ui/session/portraits/units/rome/support_female_citizen.png', dst: 'ui/female_citizen_rome.png' },
  { src: 'art/textures/ui/session/portraits/units/hele/support_healer.png', dst: 'ui/healer_athen.png' },
  { src: 'art/textures/ui/session/portraits/units/rome/support_healer.png', dst: 'ui/healer_rome.png' },
  { src: 'art/textures/ui/session/portraits/units/athen/siege_ram.png', dst: 'ui/siege_ram_athen.png' },
  { src: 'art/textures/ui/session/portraits/units/rome/siege_ram.png', dst: 'ui/siege_ram_rome.png' },
  { src: 'art/textures/ui/session/portraits/units/athen/infantry_spearman.png', dst: 'ui/athen_hoplite.png' },
  { src: 'art/textures/ui/session/portraits/units/hele/infantry_archer.png', dst: 'ui/athen_archer.png' },
  { src: 'art/textures/ui/session/portraits/units/athen/cavalry_javelinist.png', dst: 'ui/athen_cavalry.png' },
  { src: 'art/textures/ui/session/portraits/units/athen/champion_infantry.png', dst: 'ui/athen_champion.png' },
  { src: 'art/textures/ui/session/portraits/units/rome/infantry_swordsman.png', dst: 'ui/rome_hastatus.png' },
  { src: 'art/textures/ui/session/portraits/units/rome/infantry_javelinist.png', dst: 'ui/rome_velite.png' },
  { src: 'art/textures/ui/session/portraits/units/rome/cavalry_spearman.png', dst: 'ui/rome_cavalry.png' },
  { src: 'art/textures/ui/session/portraits/units/rome/champion_infantry_centurion.png', dst: 'ui/rome_champion.png' },

  // Tech portraits
  { src: 'art/textures/ui/session/portraits/technologies/town_phase.png', dst: 'ui/phase_town.png' },
  { src: 'art/textures/ui/session/portraits/technologies/sickle_2.png', dst: 'ui/tech_gather_tools.png' },
  { src: 'art/textures/ui/session/portraits/technologies/sword_02.png', dst: 'ui/tech_iron_weapons.png' },
  { src: 'art/textures/ui/session/portraits/technologies/shields_generic_bronze.png', dst: 'ui/tech_bronze_shields.png' },
  { src: 'art/textures/ui/session/portraits/technologies/architecture.png', dst: 'ui/tech_architecture.png' },
  { src: 'art/textures/ui/session/portraits/technologies/asclepius_rod.png', dst: 'ui/tech_temple_healing.png' },
  { src: 'art/textures/ui/session/portraits/technologies/coinage.png', dst: 'ui/tech_coinage.png' },
  { src: 'art/textures/ui/session/portraits/technologies/cavalry_speed.png', dst: 'ui/tech_cavalry_speed.png' },
  { src: 'art/textures/ui/session/portraits/technologies/sword_03.png', dst: 'ui/tech_steel_weapons.png' },
  { src: 'art/textures/ui/session/portraits/technologies/armor_plates_iron.png', dst: 'ui/tech_heavy_armor.png' },
  { src: 'art/textures/ui/session/portraits/technologies/siege_ram.png', dst: 'ui/tech_siege_engineering.png' },

  // ==================== TERRAIN TEXTURES ====================
  { src: 'art/textures/terrain/types/medit_grass_wild_2.png', dst: 'terrain/grass.png', maxDim: 512 },
  { src: 'art/textures/terrain/types/medit_grass_wild_norm.png', dst: 'terrain/grass_norm.png', maxDim: 512 },
  { src: 'art/textures/terrain/types/medit_dirt_d.png', dst: 'terrain/dirt.png', maxDim: 512 },
  { src: 'art/textures/terrain/types/medit_cliff_greek.png', dst: 'terrain/cliff.png', maxDim: 512 },
  { src: 'art/textures/terrain/types/medit_cliff_greek_norm.png', dst: 'terrain/cliff_norm.png', maxDim: 512 },
  { src: 'art/textures/terrain/types/medit_farmland.png', dst: 'terrain/farmland.png', maxDim: 512 },

  // ==================== 3D MODELS (.dae) ====================
  // Athenian / Hellenic Buildings
  { src: 'art/meshes/structural/athen_cc_struct.dae', dst: 'models/athen_cc_struct.dae' },
  { src: 'art/meshes/structural/athen_cc_round_roof.dae', dst: 'models/athen_cc_round_roof.dae' },
  { src: 'art/meshes/structural/athen_cc_tiles_b.dae', dst: 'models/athen_cc_tiles_b.dae' },
  { src: 'art/meshes/structural/athen_cc_decor.dae', dst: 'models/athen_cc_decor.dae' },
  { src: 'art/meshes/structural/hele_house_a.dae', dst: 'models/hele_house_a.dae' },
  { src: 'art/meshes/props/hele_house_a_struct.dae', dst: 'models/hele_house_a_struct.dae' },
  { src: 'art/meshes/structural/hele_storehouse.dae', dst: 'models/hele_storehouse.dae' },
  { src: 'art/meshes/props/hele_storehouse_roof.dae', dst: 'models/hele_storehouse_roof.dae' },
  { src: 'art/meshes/structural/hele_farmstead.dae', dst: 'models/hele_farmstead.dae' },
  { src: 'art/meshes/structural/athen_barracks_struct.dae', dst: 'models/athen_barracks_struct.dae' },
  { src: 'art/meshes/props/athen_barracks_struct_b.dae', dst: 'models/athen_barracks_struct_b.dae' },
  { src: 'art/meshes/props/athen_barracks_tile_c.dae', dst: 'models/athen_barracks_tile_c.dae' },
  { src: 'art/meshes/structural/hele_scout_tower.dae', dst: 'models/hele_scout_tower.dae' },
  { src: 'art/meshes/props/palisade_rocks_outpost.dae', dst: 'models/palisade_rocks_outpost.dae' },
  { src: 'art/meshes/structural/hele_fortress_up.dae', dst: 'models/hele_fortress_up.dae' },
  { src: 'art/meshes/props/hele_fortress_up_tile_b.dae', dst: 'models/hele_fortress_up_tile_b.dae' },
  { src: 'art/meshes/props/hele_fortress_up_gate.dae', dst: 'models/hele_fortress_up_gate.dae' },
  { src: 'art/meshes/structural/athen_temple_struct.dae', dst: 'models/athen_temple_struct.dae' },
  { src: 'art/meshes/props/athen_temple_tile_c.dae', dst: 'models/athen_temple_tile_c.dae' },
  { src: 'art/meshes/props/athen_temple_decor.dae', dst: 'models/athen_temple_decor.dae' },
  { src: 'art/meshes/structural/hele_blacksmith_struct_b.dae', dst: 'models/hele_blacksmith_struct_b.dae' },
  { src: 'art/meshes/props/hele_blacksmith_struct.dae', dst: 'models/hele_blacksmith_struct.dae' },
  { src: 'art/meshes/props/hele_blacksmith_rooftiles.dae', dst: 'models/hele_blacksmith_rooftiles.dae' },
  { src: 'art/meshes/structural/hele_market_struct.dae', dst: 'models/hele_market_struct.dae' },
  { src: 'art/meshes/structural/hele_market_struct_b.dae', dst: 'models/hele_market_struct_b.dae' },
  { src: 'art/meshes/structural/hele_market_tile_c.dae', dst: 'models/hele_market_tile_c.dae' },
  { src: 'art/meshes/structural/hele_stable.dae', dst: 'models/hele_stable.dae' },
  { src: 'art/meshes/structural/hele_workshop.dae', dst: 'models/hele_workshop.dae' },
  { src: 'art/meshes/structural/athen_erechtheion_struct.dae', dst: 'models/athen_erechtheion_struct.dae' },
  { src: 'art/meshes/props/erechtheion_roof.dae', dst: 'models/erechtheion_roof.dae' },
  { src: 'art/meshes/props/erechtheion_tile_c.dae', dst: 'models/erechtheion_tile_c.dae' },

  // Roman Buildings
  { src: 'art/meshes/structural/roman_cc.dae', dst: 'models/roman_cc.dae' },
  { src: 'art/meshes/props/roman_cc_columns.dae', dst: 'models/roman_cc_columns.dae' },
  { src: 'art/meshes/props/roman_cc_transp.dae', dst: 'models/roman_cc_transp.dae' },
  { src: 'art/meshes/structural/roman_house_a.dae', dst: 'models/roman_house_a.dae' },
  { src: 'art/meshes/structural/rome_storehouse.dae', dst: 'models/rome_storehouse.dae' },
  { src: 'art/meshes/structural/rome_fc.dae', dst: 'models/rome_fc.dae' },
  { src: 'art/meshes/structural/rome_barracks.dae', dst: 'models/rome_barracks.dae' },
  { src: 'art/meshes/structural/rome_tower.dae', dst: 'models/rome_tower.dae' },
  { src: 'art/meshes/structural/rome_tower_wood.dae', dst: 'models/rome_tower_wood.dae' },
  { src: 'art/meshes/structural/rome_fortress.dae', dst: 'models/rome_fortress.dae' },
  { src: 'art/meshes/props/rome_fortress_transp.dae', dst: 'models/rome_fortress_transp.dae' },
  { src: 'art/meshes/structural/rome_hc1.dae', dst: 'models/rome_hc1.dae' },
  { src: 'art/meshes/structural/rome_blacksmith_struct_b.dae', dst: 'models/rome_blacksmith_struct_b.dae' },
  { src: 'art/meshes/structural/rome_market_struct1.dae', dst: 'models/rome_market_struct1.dae' },
  { src: 'art/meshes/structural/rome_market_struct2.dae', dst: 'models/rome_market_struct2.dae' },
  { src: 'art/meshes/structural/rome_stable.dae', dst: 'models/rome_stable.dae' },
  { src: 'art/meshes/structural/rome_workshop.dae', dst: 'models/rome_workshop.dae' },
  { src: 'art/meshes/structural/rome_sp_pantheon.dae', dst: 'models/rome_sp_pantheon.dae' },

  // Gaia / Resources
  { src: 'art/meshes/gaia/tree_cypress_med.dae', dst: 'models/tree_cypress_med.dae' },
  { src: 'art/meshes/gaia/tree_cypress_med_branches.dae', dst: 'models/tree_cypress_med_branches.dae' },
  { src: 'art/meshes/gaia/tree_olive_01.dae', dst: 'models/tree_olive_01.dae' },
  { src: 'art/meshes/gaia/tree_pine_aleppo_1.dae', dst: 'models/tree_pine_aleppo_1.dae' },
  { src: 'art/meshes/gaia/tree_cretan_date_palm_01.dae', dst: 'models/tree_cretan_date_palm_01.dae' },
  { src: 'art/meshes/gaia/oak_tree_a.dae', dst: 'models/oak_tree_a.dae' },
  { src: 'art/meshes/gaia/berry_bush_01.dae', dst: 'models/berry_bush_01.dae' },
  { src: 'art/meshes/gaia/grape_bush.dae', dst: 'models/grape_bush.dae' },
  { src: 'art/meshes/skeletal/deer_mesh.dae', dst: 'models/deer_mesh.dae' },
  { src: 'art/meshes/skeletal/animal_boar.dae', dst: 'models/animal_boar.dae' },
  { src: 'art/meshes/gaia/geo_medit_01.dae', dst: 'models/geo_medit_01.dae' },
  { src: 'art/meshes/gaia/geo_medit_02.dae', dst: 'models/geo_medit_02.dae' },
  { src: 'art/meshes/gaia/geo_stonemine_large.dae', dst: 'models/geo_stonemine_large.dae' },
  { src: 'art/meshes/gaia/geo_mineral_01.dae', dst: 'models/geo_mineral_01.dae' },
  { src: 'art/meshes/gaia/geo_mineral_02.dae', dst: 'models/geo_mineral_02.dae' },
  { src: 'art/meshes/gaia/stonemine_granite_a.dae', dst: 'models/stonemine_granite_a.dae' },
  { src: 'art/meshes/gaia/stonemine_round_a.dae', dst: 'models/stonemine_round_a.dae' },
  { src: 'art/meshes/props/waypoint_flag.dae', dst: 'models/waypoint_flag.dae' },

  // Unit Bodies & Props
  { src: 'art/meshes/skeletal/new/f_dress.dae', dst: 'models/f_dress.dae' },
  { src: 'art/meshes/skeletal/new/m_tunic_short.dae', dst: 'models/m_tunic_short.dae' },
  { src: 'art/meshes/skeletal/new/m_armor_tunic_short.dae', dst: 'models/m_armor_tunic_short.dae' },
  { src: 'art/meshes/skeletal/horse_tessalian.dae', dst: 'models/horse_tessalian.dae' },
  { src: 'art/meshes/props/new/dude_head.dae', dst: 'models/dude_head.dae' },
  { src: 'art/meshes/props/new/dudette_head_b.dae', dst: 'models/dudette_head_b.dae' },
  { src: 'art/meshes/props/helmet/hele_pilos_a1.dae', dst: 'models/hele_pilos_a1.dae' },
  { src: 'art/meshes/props/helmet/hele_phrygian_a.dae', dst: 'models/hele_phrygian_a.dae' },
  { src: 'art/meshes/props/helmet/rome_montefortino_a.dae', dst: 'models/rome_montefortino_a.dae' },
  { src: 'art/meshes/props/helmet/old/rome_wolfskin_a.dae', dst: 'models/rome_wolfskin_a.dae' },
  { src: 'art/meshes/props/helmet/rome_montefortino_a_2.dae', dst: 'models/rome_montefortino_a_2.dae' },
  { src: 'art/meshes/props/spear_hoplite.dae', dst: 'models/spear_hoplite.dae' },
  { src: 'art/meshes/props/weapons/gladius_03.dae', dst: 'models/gladius_03.dae' },
  { src: 'art/meshes/props/weapons/bow_greek.dae', dst: 'models/bow_greek.dae' },
  { src: 'art/meshes/props/weap_javelin_shaft_loaded_a.dae', dst: 'models/weap_javelin_shaft_loaded_a.dae' },
  { src: 'art/meshes/props/spear_lance_cavalry_reverse.dae', dst: 'models/spear_lance_cavalry_reverse.dae' },
  { src: 'art/meshes/props/shield/round_b_f.dae', dst: 'models/round_b_f.dae' },
  // Worker Tools, Healer, Siege Ram & Farming Wheat
  { src: 'art/meshes/props/tool_axe.dae', dst: 'models/tool_axe.dae' },
  { src: 'art/meshes/props/tool_pick.dae', dst: 'models/tool_pick.dae' },
  { src: 'art/meshes/props/tool_hoe.dae', dst: 'models/tool_hoe.dae' },
  { src: 'art/meshes/props/prop_mallet.dae', dst: 'models/prop_mallet.dae' },
  { src: 'art/meshes/props/berry_basket.dae', dst: 'models/berry_basket.dae' },
  { src: 'art/meshes/props/weapons/dagger_01.dae', dst: 'models/dagger_01.dae' },
  { src: 'art/meshes/skeletal/new/m_dress.dae', dst: 'models/m_dress.dae' },
  { src: 'art/meshes/props/m_staff.dae', dst: 'models/m_staff.dae' },
  { src: 'art/meshes/structural/spart_siege_ram.dae', dst: 'models/spart_siege_ram.dae' },
  { src: 'art/meshes/structural/rome_ram.dae', dst: 'models/rome_ram.dae' },
  { src: 'art/meshes/gaia/cross_large_short.dae', dst: 'models/wheat_crop.dae' },

  // ==================== MODEL TEXTURES (.png, .dds -> .png) ====================
  // Structural
  { src: 'art/textures/skins/structural/hele_struct.dds', dst: 'textures/hele_struct.png', convertDds: true, maxDim: 1024 },
  { src: 'art/textures/skins/structural/hele_struct_norm.png', dst: 'textures/hele_struct_norm.png', maxDim: 1024 },
  { src: 'art/textures/skins/structural/hele_struct_b.png', dst: 'textures/hele_struct_b.png', maxDim: 1024 },
  { src: 'art/textures/skins/structural/hele_struct_b_norm.png', dst: 'textures/hele_struct_b_norm.png', maxDim: 1024 },
  { src: 'art/textures/skins/props/hele_tile_b.dds', dst: 'textures/hele_tile_b.png', convertDds: true, maxDim: 512 },
  { src: 'art/textures/skins/props/hele_tile_c.dds', dst: 'textures/hele_tile_c.png', convertDds: true, maxDim: 512 },
  { src: 'art/textures/skins/props/hele_decor.png', dst: 'textures/hele_decor.png', maxDim: 512 },
  { src: 'art/textures/skins/props/hele_gate.png', dst: 'textures/hele_gate.png', maxDim: 512 },
  { src: 'art/textures/skins/structural/rooftiles_broken.png', dst: 'textures/rooftiles_broken.png', maxDim: 512 },
  { src: 'art/textures/skins/props/palisade_main.png', dst: 'textures/palisade_main.png', maxDim: 512 },
  { src: 'art/textures/skins/structural/rome_struct.png', dst: 'textures/rome_struct.png', maxDim: 1024 },
  { src: 'art/textures/skins/structural/rome_struct_norm.png', dst: 'textures/rome_struct_norm.png', maxDim: 1024 },
  { src: 'art/textures/skins/structural/rome_struct_2.png', dst: 'textures/rome_struct_2.png', maxDim: 1024 },
  { src: 'art/textures/skins/structural/rome_struct_2_norm.png', dst: 'textures/rome_struct_2_norm.png', maxDim: 1024 },
  { src: 'art/textures/skins/structural/rome_sp_pantheon.dds', dst: 'textures/rome_sp_pantheon.png', convertDds: true, maxDim: 1024 },
  { src: 'art/textures/skins/props/hele_wonder_rooftile.png', dst: 'textures/hele_wonder_rooftile.png', maxDim: 512 },
  { src: 'art/textures/skins/skeletal/hele/toga_healer_01.dds', dst: 'textures/toga_healer_01.png', convertDds: true, maxDim: 512 },
  { src: 'art/textures/skins/skeletal/rome/robes_healer_01.png', dst: 'textures/robes_healer_01.png', maxDim: 512 },
  { src: 'art/textures/skins/structural/spart_siege_ram.png', dst: 'textures/spart_siege_ram.png', maxDim: 512 },
  { src: 'art/textures/skins/structural/rome_ram.png', dst: 'textures/rome_ram.png', maxDim: 512 },

  // Gaia
  { src: 'art/textures/skins/gaia/tree_cypress_f.png', dst: 'textures/tree_cypress_f.png', maxDim: 512 },
  { src: 'art/textures/skins/gaia/tree_cypress.png', dst: 'textures/tree_cypress.png', maxDim: 512 },
  { src: 'art/textures/skins/gaia/tree_olive.png', dst: 'textures/tree_olive.png', maxDim: 512 },
  { src: 'art/textures/skins/gaia/aleppo_pine.dds', dst: 'textures/aleppo_pine.png', convertDds: true, maxDim: 512 },
  { src: 'art/textures/skins/gaia/tree_palm_senegal_a.dds', dst: 'textures/tree_palm_senegal_a.png', convertDds: true, maxDim: 512 },
  { src: 'art/textures/skins/gaia/oak_tree_a.png', dst: 'textures/oak_tree_a.png', maxDim: 512 },
  { src: 'art/textures/skins/gaia/berry_bush_01.png', dst: 'textures/berry_bush_01.png', maxDim: 512 },
  { src: 'art/textures/skins/gaia/grape_bushes.png', dst: 'textures/grape_bushes.png', maxDim: 512 },
  { src: 'art/textures/skins/skeletal/animal_deer_01.png', dst: 'textures/animal_deer_01.png', maxDim: 512 },
  { src: 'art/textures/skins/skeletal/animal_boar_01.png', dst: 'textures/animal_boar_01.png', maxDim: 512 },
  { src: 'art/textures/skins/gaia/stone_aegean_01.png', dst: 'textures/stone_aegean_01.png', maxDim: 512 },
  { src: 'art/textures/skins/gaia/stone_india_01_norm.png', dst: 'textures/stone_india_01_norm.png', maxDim: 512 },
  { src: 'art/textures/skins/gaia/stonequarry_mediterranean_greek_2.png', dst: 'textures/stonequarry_marble.png', maxDim: 512 },
  { src: 'art/textures/skins/gaia/metal_medit_a.dds', dst: 'textures/metal_medit_a.png', convertDds: true, maxDim: 512 },
  { src: 'art/textures/skins/gaia/slab_medit_metal.dds', dst: 'textures/slab_medit_metal.png', convertDds: true, maxDim: 512 },
  { src: 'art/textures/skins/gaia/decal_stone_medit_01.dds', dst: 'textures/decal_stone_medit_01.png', convertDds: true, maxDim: 512 },
  { src: 'art/textures/skins/gaia/decal_stone_medit_01_norm.png', dst: 'textures/decal_stone_medit_01_norm.png', maxDim: 512 },
  { src: 'art/textures/particles/sparkle_02.png', dst: 'textures/sparkle_02.png', maxDim: 256 },
  { src: 'art/textures/skins/props/banner_greek.png', dst: 'textures/banner_greek.png', maxDim: 256 },
  { src: 'art/textures/skins/props/banner_romans.png', dst: 'textures/banner_romans.png', maxDim: 256 },
  { src: 'art/textures/skins/gaia/metal_round_col_aegean.png', dst: 'textures/metal_gold_aegean.png', maxDim: 512 },
  { src: 'art/textures/skins/gaia/metal_round_col_norm.png', dst: 'textures/metal_gold_aegean_norm.png', maxDim: 512 },

  // Units & Props
  { src: 'art/textures/skins/skeletal/hele/dress_female_01.png', dst: 'textures/dress_female_01.png', maxDim: 512 },
  { src: 'art/textures/skins/skeletal/hele/tunic_02_01.png', dst: 'textures/hele_tunic_02_01.png', maxDim: 512 },
  { src: 'art/textures/skins/skeletal/hele/tunic_01_01.png', dst: 'textures/hele_tunic_01_01.png', maxDim: 512 },
  { src: 'art/textures/skins/skeletal/athen/tunic_01_01.dds', dst: 'textures/athen_tunic_01_01.png', convertDds: true, maxDim: 512 },
  { src: 'art/textures/skins/skeletal/athen/epilektos_01.png', dst: 'textures/athen_epilektos_01.png', maxDim: 512 },
  { src: 'art/textures/skins/skeletal/rome/cardiopylax_01_01.png', dst: 'textures/rome_cardiopylax_01_01.png', maxDim: 512 },
  { src: 'art/textures/skins/skeletal/rome/tunic_basic_01.png', dst: 'textures/rome_tunic_basic_01.png', maxDim: 512 },
  { src: 'art/textures/skins/skeletal/rome/subarmalis_01_01.png', dst: 'textures/rome_subarmalis_01_01.png', maxDim: 512 },
  { src: 'art/textures/skins/skeletal/ital/cuirass_01_01.png', dst: 'textures/rome_cuirass_01_01.png', maxDim: 512 },
  { src: 'art/textures/skins/skeletal/horse_brown.png', dst: 'textures/horse_brown.png', maxDim: 512 },
  { src: 'art/textures/skins/props/head/hele_a.dds', dst: 'textures/head_hele_a.png', convertDds: true, maxDim: 256 },
  { src: 'art/textures/skins/props/head/kart_fem_a_cin.dds', dst: 'textures/head_fem_a.png', convertDds: true, maxDim: 256 },
  { src: 'art/textures/skins/props/helmet/hele_pilos_01_bronze.png', dst: 'textures/hele_pilos_01_bronze.png', maxDim: 256 },
  { src: 'art/textures/skins/props/helmet/hele_phrygian_01_type_a_bronze.png', dst: 'textures/hele_phrygian_01_bronze.png', maxDim: 256 },
  { src: 'art/textures/skins/props/helmet/rome_montefortino_bronze.png', dst: 'textures/rome_montefortino_bronze.png', maxDim: 256 },
  { src: 'art/textures/skins/props/helmet/old/rome_wolfskin_a.png', dst: 'textures/rome_wolfskin_a.png', maxDim: 256 },
  { src: 'art/textures/skins/props/prop_weap.dds', dst: 'textures/prop_weap.png', convertDds: true, maxDim: 256 },
  { src: 'art/textures/skins/props/spart_sail_a.png', dst: 'textures/bow_wood.png', maxDim: 256 },
  { src: 'art/textures/skins/props/shield/rome_parma_a.dds', dst: 'textures/rome_parma_a.png', convertDds: true, maxDim: 256 },
  { src: 'art/textures/skins/props/basket_rome_1.dds', dst: 'textures/basket_rome_1.png', convertDds: true, maxDim: 256 },
  { src: 'art/textures/skins/gaia/decal_farmland.png', dst: 'textures/decal_farmland.png', maxDim: 512 },
  { src: 'art/textures/skins/gaia/decal_farmland_norm.png', dst: 'textures/decal_farmland_norm.png', maxDim: 512 },
  { src: 'art/textures/skins/gaia/farming_wheat_harvest_a.png', dst: 'textures/farming_wheat_harvest_a.png', maxDim: 512 },

  // ==================== AUDIO (.ogg) ====================
  { src: 'audio/interface/select/building/sel_universal_1.ogg', dst: 'audio/sel_universal.ogg' },
  { src: 'audio/interface/select/building/sel_civ_center.ogg', dst: 'audio/sel_civ_center.ogg' },
  { src: 'audio/interface/select/building/sel_barracks.ogg', dst: 'audio/sel_barracks.ogg' },
  { src: 'audio/interface/select/building/sel_temple.ogg', dst: 'audio/sel_temple.ogg' },
  { src: 'audio/interface/select/building/sel_forge.ogg', dst: 'audio/sel_forge.ogg' },
  { src: 'audio/interface/select/building/sel_market.ogg', dst: 'audio/sel_market.ogg' },
  { src: 'audio/interface/select/building/sel_stable.ogg', dst: 'audio/sel_stable.ogg' },
  { src: 'audio/interface/ui/rally_click_01.ogg', dst: 'audio/order_click_01.ogg' },
  { src: 'audio/interface/ui/rally_click_02.ogg', dst: 'audio/order_click_02.ogg' },
  { src: 'audio/interface/alarm/alarm_invalid_building_placement_01.ogg', dst: 'audio/error.ogg' },
  { src: 'audio/attack/weapon/sword_attack_01.ogg', dst: 'audio/sword_01.ogg' },
  { src: 'audio/attack/weapon/sword_attack_02.ogg', dst: 'audio/sword_02.ogg' },
  { src: 'audio/attack/weapon/spear_attack_01.ogg', dst: 'audio/spear_01.ogg' },
  { src: 'audio/attack/weapon/bow_attack_01.ogg', dst: 'audio/bow_01.ogg' },
  { src: 'audio/attack/weapon/bow_attack_02.ogg', dst: 'audio/bow_02.ogg' },
  { src: 'audio/attack/weapon/jav_attack_01.ogg', dst: 'audio/jav_01.ogg' },
  { src: 'audio/resource/lumbering/lumber_tree_01.ogg', dst: 'audio/wood_01.ogg' },
  { src: 'audio/resource/lumbering/lumber_tree_02.ogg', dst: 'audio/wood_02.ogg' },
  { src: 'audio/resource/mining/mine_stone_01.ogg', dst: 'audio/stone_01.ogg' },
  { src: 'audio/resource/mining/mine_metal_01.ogg', dst: 'audio/metal_01.ogg' },
  { src: 'audio/resource/foraging/leaves_01.ogg', dst: 'audio/forage_01.ogg' },
  { src: 'audio/interface/complete/building/complete_universal.ogg', dst: 'audio/build_complete.ogg' },
  { src: 'audio/interface/alarm/alarmcreatemiltaryfoot_1.ogg', dst: 'audio/train_infantry.ogg' },
  { src: 'audio/interface/alarm/alarmcreatefemale.ogg', dst: 'audio/train_female.ogg' },
  { src: 'audio/interface/alarm/alarmunitturn_1.ogg', dst: 'audio/capture.ogg' },
  { src: 'audio/interface/alarm/alarmresearchtech_1.ogg', dst: 'audio/tech_complete.ogg' },
  { src: 'audio/interface/alarm/alarmresearchphase_1.ogg', dst: 'audio/phase_up.ogg' },
  { src: 'audio/interface/alarm/alarmattackunit_1.ogg', dst: 'audio/under_attack.ogg' },
  { src: 'audio/interface/alarm/alarmvictory_1.ogg', dst: 'audio/victory.ogg' },
  { src: 'audio/interface/alarm/alarmdefeat_1.ogg', dst: 'audio/defeat.ogg' },
  { src: 'audio/music/Mediterranean_Waves.ogg', dst: 'audio/music_medit.ogg' },

  // ==================== SKELETAL ANIMATIONS (.dae) ====================
  // Hoplite (spear + shield)
  { src: 'art/animation/biped/infantry/hoplite/idle_relax_01.dae', dst: 'animations/hoplite_idle.dae' },
  { src: 'art/animation/biped/infantry/hoplite/walk_relax.dae', dst: 'animations/hoplite_walk.dae' },
  { src: 'art/animation/biped/infantry/hoplite/attack_melee_01.dae', dst: 'animations/hoplite_attack.dae' },
  // Swordsman (sword + shield)
  { src: 'art/animation/biped/infantry/swordsman/idle_relax_shield_01.dae', dst: 'animations/swordsman_idle.dae' },
  { src: 'art/animation/biped/infantry/swordsman/walk_relax_shield.dae', dst: 'animations/swordsman_walk.dae' },
  { src: 'art/animation/biped/infantry/swordsman/attack_melee_shield_01.dae', dst: 'animations/swordsman_attack.dae' },
  // Archer
  { src: 'art/animation/biped/infantry/archer/idle_relax_01.dae', dst: 'animations/archer_idle.dae' },
  { src: 'art/animation/biped/infantry/archer/walk_relax.dae', dst: 'animations/archer_walk.dae' },
  { src: 'art/animation/biped/infantry/archer/attack_ranged.dae', dst: 'animations/archer_attack.dae' },
  // Javelinist / Velite
  { src: 'art/animation/biped/infantry/javelinist/idle_ready.dae', dst: 'animations/javelin_idle.dae' },
  { src: 'art/animation/biped/infantry/javelinist/run_relax.dae', dst: 'animations/javelin_walk.dae' },
  { src: 'art/animation/biped/infantry/javelinist/attack_ranged.dae', dst: 'animations/javelin_attack.dae' },
  // Female citizen & Gathering / Building
  { src: 'art/animation/biped/citizen/idle_relax_f.dae', dst: 'animations/female_idle.dae' },
  { src: 'art/animation/biped/citizen/walk_relax_f.dae', dst: 'animations/female_walk.dae' },
  { src: 'art/animation/biped/gatherer/gather_fruit_f.dae', dst: 'animations/gather_fruit_f.dae' },
  { src: 'art/animation/biped/gatherer/gather_fruit_m.dae', dst: 'animations/gather_fruit_m.dae' },
  { src: 'art/animation/biped/gatherer/gather_wood.dae', dst: 'animations/gather_wood.dae' },
  { src: 'art/animation/biped/gatherer/gather_mine.dae', dst: 'animations/gather_mine.dae' },
  { src: 'art/animation/biped/gatherer/farming.dae', dst: 'animations/farming.dae' },
  { src: 'art/animation/biped/gatherer/slaughter.dae', dst: 'animations/slaughter.dae' },
  { src: 'art/animation/biped/gatherer/gather_meat.dae', dst: 'animations/gather_meat.dae' },
  { src: 'art/animation/biped/citizen/build.dae', dst: 'animations/build.dae' },
  // Cavalry (Horse + Rider)
  { src: 'art/animation/quadraped/horse_idle_01.dae', dst: 'animations/horse_idle.dae' },
  { src: 'art/animation/quadraped/horse_gallop.dae', dst: 'animations/horse_gallop.dae' },
  { src: 'art/animation/quadraped/horse_attack_01.dae', dst: 'animations/horse_attack.dae' },
  { src: 'art/animation/biped/rider/cavalry/generic/idle_shield_relax_01.dae', dst: 'animations/rider_idle.dae' },
  { src: 'art/animation/biped/rider/cavalry/generic/gallop_shield_relax.dae', dst: 'animations/rider_gallop.dae' },
  { src: 'art/animation/biped/rider/cavalry/spearman/attack_melee_01.dae', dst: 'animations/rider_attack.dae' },
  // Fauna & Waypoint flag animations
  { src: 'art/animation/quadraped/deer_idle_01.dae', dst: 'animations/deer_idle.dae' },
  { src: 'art/animation/quadraped/deer_run_01.dae', dst: 'animations/deer_run.dae' },
  { src: 'art/animation/quadraped/deer_death_01.dae', dst: 'animations/deer_death.dae' },
  { src: 'art/animation/quadraped/animal_boar_idle_01.dae', dst: 'animations/boar_idle.dae' },
  { src: 'art/animation/quadraped/animal_boar_run_01.dae', dst: 'animations/boar_run.dae' },
  { src: 'art/animation/quadraped/animal_boar_attack_01.dae', dst: 'animations/boar_attack.dae' },
  { src: 'art/animation/quadraped/animal_boar_death_01.dae', dst: 'animations/boar_death.dae' },
  { src: 'art/animation/mechanical/waypoint_flag_idle.dae', dst: 'animations/waypoint_flag_idle.dae' },
];

async function resolveVariantXml(relPath, depth = 0) {
  if (depth > 3) return {};
  const res = await fetch(`${MEDIA_BASE}/${relPath}`);
  if (!res.ok) return {};
  const xml = await res.text();
  const parentMatch = xml.match(/<variant\s+[^>]*file="([^"]+)"/);
  const base = parentMatch ? await resolveVariantXml(`art/variants/${parentMatch[1]}`, depth + 1) : {};
  const meshMatch = xml.match(/<mesh>([^<]+)<\/mesh>/);
  const texMatch = xml.match(/<texture\s+file="([^"]+)"\s+name="baseTex"/);
  return {
    mesh: meshMatch ? meshMatch[1] : base.mesh,
    tex: texMatch ? texMatch[1] : base.tex,
  };
}

async function resolveShieldVariants() {
  const shieldSpecs = [
    { variant: 'art/variants/shields/athen_aspis_basic_01.xml', meshOut: 'models/aspis_athen.dae', texOut: 'textures/aspis_athen_b.png' },
    { variant: 'art/variants/shields/athen_aspis_alpha_01.xml', meshOut: null, texOut: 'textures/aspis_athen_c.png' },
    { variant: 'art/variants/shields/scutum_rome_01.xml', meshOut: 'models/scutum_rome.dae', texOut: 'textures/scutum_rome_01.png' },
  ];
  const extra = [];
  for (const s of shieldSpecs) {
    try {
      const info = await resolveVariantXml(s.variant);
      if (info.mesh && s.meshOut) {
        extra.push({ src: `art/meshes/${info.mesh}`, dst: s.meshOut });
      }
      if (info.tex && s.texOut) {
        const isDds = info.tex.toLowerCase().endsWith('.dds');
        extra.push({ src: `art/textures/skins/${info.tex}`, dst: s.texOut, convertDds: isDds, maxDim: 256 });
      }
    } catch (e) {
      console.warn(`Shield variant lookup failed for ${s.variant}:`, e.message);
    }
  }
  return extra;
}

async function fetchBuffer(url, retries = 3) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const buf = Buffer.from(await res.arrayBuffer());
      if (buf.length < 220 && buf.subarray(0, 40).toString('utf8').startsWith('version https://git-lfs.github.com')) {
        throw new Error('Received Git LFS pointer instead of media binary');
      }
      return buf;
    } catch (err) {
      if (attempt === retries) throw err;
      await new Promise((r) => setTimeout(r, 400 * attempt));
    }
  }
}

function convertAndOptimizeImage(inPath, outPath, maxDim) {
  const py = `
import sys
from PIL import Image
in_p, out_p, max_dim = sys.argv[1], sys.argv[2], int(sys.argv[3])
im = Image.open(in_p)
if im.mode not in ("RGBA", "RGB"):
    im = im.convert("RGBA")
if max_dim > 0 and max(im.size) > max_dim:
    im.thumbnail((max_dim, max_dim), Image.Resampling.LANCZOS)
im.save(out_p, "PNG", optimize=True)
`;
  execFileSync('python', ['-c', py, inPath, outPath, String(maxDim || 0)], { stdio: 'pipe' });
}

async function existsNonEmpty(p) {
  try {
    const st = await fs.stat(p);
    return st.size > 0;
  } catch {
    return false;
  }
}

async function main() {
  const force = process.argv.includes('--force');
  const shieldItems = await resolveShieldVariants();
  const items = [...MANIFEST, ...shieldItems];

  console.log(`Fetching ${items.length} assets from 0 A.D. Gitea (https://gitea.wildfiregames.com/0ad/0ad)...`);

  let downloaded = 0;
  let skipped = 0;
  const failed = [];
  const concurrency = 6;
  let cursor = 0;

  async function worker() {
    while (cursor < items.length) {
      const idx = cursor++;
      const item = items[idx];
      const finalPath = path.join(OUT_DIR, item.dst);
      await fs.mkdir(path.dirname(finalPath), { recursive: true });

      if (!force && (await existsNonEmpty(finalPath))) {
        skipped++;
        continue;
      }

      const url = `${MEDIA_BASE}/${item.src}`;
      try {
        const buf = await fetchBuffer(url);
        if (item.convertDds || item.maxDim) {
          const tmpExt = item.convertDds ? '.tmp.dds' : '.tmp.png';
          const tmpPath = finalPath + tmpExt;
          await fs.writeFile(tmpPath, buf);
          try {
            convertAndOptimizeImage(tmpPath, finalPath, item.maxDim || 0);
          } finally {
            await fs.unlink(tmpPath).catch(() => {});
          }
        } else {
          await fs.writeFile(finalPath, buf);
        }
        downloaded++;
        process.stdout.write(`  [${downloaded + skipped}/${items.length}] OK ${item.dst}\n`);
      } catch (err) {
        failed.push({ item, error: err.message });
        process.stderr.write(`  FAIL ${item.src} -> ${err.message}\n`);
      }
    }
  }

  await Promise.all(Array.from({ length: concurrency }, worker));

  console.log(`\nDone! Downloaded: ${downloaded}, Skipped: ${skipped}, Failed: ${failed.length}`);
  if (failed.length > 0) {
    console.error('Failed assets:', failed);
    process.exitCode = 1;
  }
}

main();
