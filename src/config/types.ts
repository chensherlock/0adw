export type ResourceType = 'food' | 'wood' | 'stone' | 'metal';

export interface ResourceBag {
  food: number;
  wood: number;
  stone: number;
  metal: number;
}

export type CivId =
  | 'athenians'
  | 'britons'
  | 'carthaginians'
  | 'gauls'
  | 'han'
  | 'iberians'
  | 'kushites'
  | 'macedonians'
  | 'mauryas'
  | 'persians'
  | 'ptolemies'
  | 'romans'
  | 'seleucids'
  | 'spartans';
export type CheatAction =
  | 'resources'
  | 'fast_build'
  | 'all_techs'
  | 'reset_skill'
  | 'spawn_army'
  | 'heal_all'
  | 'instant_win';
export type Difficulty = 'easy' | 'medium' | 'hard';
export type GameMode = 'skirmish' | 'peaceful';
export type MapSize = 'small' | 'medium' | 'large' | 'huge';
export type DiplomaticStance = 'ally' | 'neutral' | 'enemy';
export type CivChoice = CivId | 'random';

export interface PlayerSlotConfig {
  playerId: number;
  civ: CivChoice;
  team: number; // 0 = no team (free-for-all), 1..4 = allied team
  isAI: boolean;
}
export type ResolvedMapType =
  | 'aegean_valley'
  | 'medit_highlands'
  | 'twin_peninsulas'
  | 'inland_oasis'
  | 'open_plains'
  | 'alpine_passes'
  | 'island'
  | 'mountain'
  | 'plateau'
  | 'hills'
  | 'mesa'
  | 'swamp'
  | 'rainforest'
  | 'forest'
  | 'volcano';
export type MapType = 'random' | ResolvedMapType;
export type EntityKind = 'unit' | 'building' | 'resource';
export type UnitStance = 'aggressive' | 'defensive' | 'stand_ground' | 'passive';
export type DamageType = 'hack' | 'pierce' | 'crush';
export type BuildingOrderMode = 'capture' | 'attack';
export type TerraformMode = 'dig' | 'raise' | 'level';
export type CityPhase = 1 | 2 | 3 | 4;
export type UnitRank = 1 | 2 | 3; // 1 = Basic, 2 = Advanced, 3 = Elite

export interface ArmorProfile {
  hack: number;
  pierce: number;
  crush: number;
}

export type ProjectileKind = 'arrow' | 'javelin' | 'fire_arrow' | 'bolt' | 'boulder' | 'flaming_boulder';

export interface AttackProfile {
  hack: number;
  pierce: number;
  crush: number;
  range: number; // world units (<= 2.5 = melee)
  minRange?: number;
  cooldown: number; // seconds
  isRanged: boolean;
  projectileSpeed?: number;
  projectileKind?: ProjectileKind;
  splashRadius?: number;
  capturePower?: number; // capture points per second against enemy buildings
}

export interface GatherProfile {
  food: number;
  wood: number;
  stone: number;
  metal: number;
  capacity: number;
  buildRate: number; // HP/sec built on foundations
}

export interface EntityTemplate {
  id: string;
  name: string;
  shortName: string;
  description: string;
  kind: EntityKind;
  civ?: CivId;
  allowedCivs?: CivId[];
  icon: string;
  maxHp: number;
  armor: ArmorProfile;
  visionRange: number; // world units
  radius: number; // collision radius in world units
  cost?: ResourceBag;
  trainTime?: number; // seconds
  buildTime?: number; // seconds
  popCost?: number;
  popBonus?: number;
  phaseRequired?: CityPhase;
  requiresTech?: string;

  // Unit specific
  speed?: number; // world units / sec
  attack?: AttackProfile;
  gather?: GatherProfile;
  canBuild?: string[]; // building template IDs
  isCitizenSoldier?: boolean;
  isWoman?: boolean;
  isTrader?: boolean;
  isCavalry?: boolean;
  isChampion?: boolean;
  isHealer?: boolean;
  healRate?: number;
  healRange?: number;
  isSiege?: boolean;
  isNaval?: boolean;
  isMerchantShip?: boolean;

  // Building specific
  footprintTiles?: number; // square tile width (e.g. 2, 3, 4, 5)
  territoryRadius?: number; // in tiles
  territoryWeight?: number;
  mustBeInTerritory?: boolean;
  canBuildNeutral?: boolean;
  dropOffTypes?: ResourceType[];
  trains?: string[];
  researches?: string[];
  garrisonCapacity?: number;
  garrisonArrowBonus?: number; // extra arrows per garrisoned unit
  capturePointsMax?: number;
  isCivicCenter?: boolean;
  isFortress?: boolean;
  isFarmField?: boolean;
  isMarket?: boolean;
  isWonder?: boolean;
  isDock?: boolean;
  isWall?: boolean;
  isGate?: boolean;
  isBridge?: boolean;
  isTunnel?: boolean;
  isApartment?: boolean;
  maxFloors?: number;
  isUniqueBuilding?: boolean;
  farmFoodTotal?: number;
  passiveTributePer10Sec?: Partial<ResourceBag>;

  // Resource specific
  resourceType?: ResourceType;
  resourceAmount?: number;
  maxGatherers?: number;
  isAquatic?: boolean;
  isRuinPillar?: boolean;
  isPredator?: boolean;
  isPassiveFauna?: boolean;
  isFlying?: boolean;
  flightAltitude?: number;
  isSeaMonster?: boolean;
}

export interface TechTemplate {
  id: string;
  name: string;
  description: string;
  icon: string;
  civ?: CivId;
  cost: ResourceBag;
  researchTime: number;
  phaseRequired: CityPhase;
  grantsPhase?: CityPhase;
  popCapBonus?: number;
  territoryBonusTiles?: number;
  attackBonusPct?: number;
  armorBonus?: Partial<ArmorProfile>;
  gatherBonusPct?: number;
  buildingHpBonusPct?: number;
  unitHpBonusPct?: number;
  buildSpeedBonusPct?: number;
  trainSpeedBonusPct?: number;
  cavalrySpeedBonusPct?: number;
  healBonusPct?: number;
  tradeIncomeBonusPct?: number;
  siegeDamageBonusPct?: number;
  shipHpBonusPct?: number;
  shipAttackBonusPct?: number;
  shipSpeedBonusPct?: number;
  fishingBonusPct?: number;
  tributePer10Sec?: Partial<ResourceBag>;
}

export interface CivSkillConfig {
  id: string;
  name: string;
  description: string;
  icon: string;
  cooldownSec: number;
  durationSec: number;
}

export interface CivConfig {
  id: CivId;
  name: string;
  subtitle: string;
  primaryColor: number;
  secondaryColor: number;
  cssColor: string;
  roofColor: number;
  stoneColor: number;
  bonusText: string;
  uniqueBuilding: string;
  uniqueTechs: string[];
  skill: CivSkillConfig;
  gatherMultiplier: Partial<Record<ResourceType, number>>;
  infantryArmorBonus: Partial<ArmorProfile>;
  infantryAttackBonusPct: number;
  buildingHpBonusPct: number;
  popCapBonusPct?: number;
  trainSpeedBonusPct?: number;
  blockedBuildings?: string[];
  units: {
    woman: string;
    infantryMelee: string;
    infantryRanged: string;
    cavalry: string;
    champion: string;
    special: string;
  };
}

export type GameCommand =
  | { type: 'move'; playerId: number; entityIds: number[]; x: number; z: number; queued?: boolean; attackMove?: boolean }
  | { type: 'attack'; playerId: number; entityIds: number[]; targetId: number; mode?: BuildingOrderMode }
  | { type: 'gather'; playerId: number; entityIds: number[]; targetId: number }
  | { type: 'build'; playerId: number; entityIds: number[]; templateId: string; tileX: number; tileZ: number; facing?: number }
  | { type: 'build_tunnel'; playerId: number; entityIds: number[]; startTileX: number; startTileZ: number; endTileX: number; endTileZ: number }
  | { type: 'terraform'; playerId: number; entityIds: number[]; tileX: number; tileZ: number; destTileX?: number; destTileZ?: number; mode: TerraformMode; queued?: boolean }
  | { type: 'demolish'; playerId: number; entityIds: number[] }
  | { type: 'use_tunnel'; playerId: number; entityIds: number[]; portalId: number }
  | { type: 'trade'; playerId: number; entityIds: number[]; targetMarketId: number; homeMarketId?: number }
  | { type: 'upgrade_building'; playerId: number; buildingId: number }
  | { type: 'repair'; playerId: number; entityIds: number[]; targetId: number }
  | { type: 'train'; playerId: number; buildingId: number; templateId: string }
  | { type: 'cancel_train'; playerId: number; buildingId: number; index: number }
  | { type: 'research'; playerId: number; buildingId: number; techId: string }
  | { type: 'set_rally'; playerId: number; buildingId: number; x: number; z: number; targetId?: number }
  | { type: 'set_stance'; playerId: number; entityIds: number[]; stance: UnitStance }
  | { type: 'garrison'; playerId: number; entityIds: number[]; buildingId: number }
  | { type: 'ungarrison'; playerId: number; buildingId: number }
  | { type: 'set_diplomacy'; playerId: number; targetPlayerId: number; stance: DiplomaticStance }
  | { type: 'send_tribute'; playerId: number; targetPlayerId: number; resource: ResourceType; amount: number }
  | { type: 'activate_skill'; playerId: number }
  | { type: 'cheat'; playerId: number; action: CheatAction }
  | { type: 'delete'; playerId: number; entityIds: number[] };

export type SimEvent =
  | { type: 'attack_swing'; x: number; z: number; isRanged: boolean }
  | { type: 'projectile_hit'; x: number; z: number }
  | { type: 'gather_tick'; x: number; z: number; resourceType: ResourceType }
  | { type: 'building_complete'; playerId: number; x: number; z: number; templateId: string }
  | { type: 'building_upgraded'; playerId: number; x: number; z: number; templateId: string; floors: number }
  | { type: 'trade_payout'; playerId: number; x: number; z: number; amount: number }
  | { type: 'building_demolished'; playerId: number; x: number; z: number; templateId: string; refund: ResourceBag }
  | { type: 'building_captured'; newOwner: number; oldOwner: number; x: number; z: number; templateId: string }
  | { type: 'unit_trained'; playerId: number; x: number; z: number; templateId: string }
  | { type: 'unit_promoted'; playerId: number; entityId: number; rank: UnitRank; x: number; z: number }
  | { type: 'tech_complete'; playerId: number; techId: string }
  | { type: 'diplomacy_changed'; playerId: number; targetPlayerId: number; stance: DiplomaticStance }
  | { type: 'tribute_sent'; fromPlayerId: number; toPlayerId: number; resource: ResourceType; amount: number }
  | { type: 'skill_activated'; playerId: number; skillId: string }
  | {
      type: 'under_attack';
      playerId: number;
      x: number;
      z: number;
      attackerTemplateId?: string;
      victimTemplateId?: string;
      isWildlife?: boolean;
    }
  | { type: 'entity_died'; entityId: number; x: number; z: number; kind: EntityKind }
  | { type: 'match_over'; winnerId: number };

export interface PlayerState {
  id: number; // 1 = human, 2..8 = AI nations
  name: string;
  civ: CivId;
  isAI: boolean;
  team: number; // 0 = no team, 1..4 = allied team
  diplomacy: Record<number, DiplomaticStance>; // stance toward every other playerId
  color: number;
  cssColor: string;
  resources: ResourceBag;
  popUsed: number;
  popCap: number;
  phase: CityPhase;
  researchedTechs: Set<string>;
  researchingTechs: Set<string>;
  skillCooldown: number;
  skillActiveTimer: number;
  fastBuildCheat?: boolean;
  defeated: boolean;
  stats: {
    unitsTrained: number;
    unitsLost: number;
    enemiesKilled: number;
    buildingsConstructed: number;
    buildingsCaptured: number;
    resourcesGathered: number;
  };
}

export interface ProductionItem {
  kind: 'unit' | 'tech';
  id: string;
  progress: number;
  totalTime: number;
}

export type UnitOrder =
  | { type: 'idle' }
  | { type: 'move'; x: number; z: number; attackMove?: boolean }
  | { type: 'gather'; targetId: number; resourceType: ResourceType; returning: boolean; dropOffId?: number }
  | { type: 'build'; targetId: number }
  | {
      type: 'terraform';
      tileX: number;
      tileZ: number;
      destTileX: number;
      destTileZ: number;
      mode: TerraformMode;
      stage: 'scoop' | 'dump';
      progress: number;
      startEpoch: number;
    }
  | { type: 'enter_tunnel'; portalId: number; transitRemaining?: number; exitPortalId?: number }
  | { type: 'trade'; homeMarketId: number; targetMarketId: number; leg: 'toTarget' | 'toHome'; cargoGold: number }
  | { type: 'attack'; targetId: number; mode: BuildingOrderMode }
  | { type: 'garrison'; targetId: number };

export interface Entity {
  id: number;
  templateId: string;
  owner: number; // 0 = Gaia (nature/resources), 1 = player, 2 = AI
  x: number;
  z: number;
  prevX: number;
  prevZ: number;
  vx: number;
  vz: number;
  facing: number; // radians
  hp: number;
  maxHp: number;
  alive: boolean;

  // Unit fields
  stance: UnitStance;
  order: UnitOrder;
  queuedOrders: UnitOrder[];
  path: Array<{ x: number; z: number }>;
  pathIndex: number;
  repathTimer: number;
  attackCooldown: number;
  animState: 'idle' | 'walk' | 'attack' | 'gather' | 'build';
  animTime: number;
  carryType: ResourceType | null;
  carryAmount: number;
  xp: number;
  rank: UnitRank;
  garrisonedIn: number | null; // building entity ID
  guardX: number;
  guardZ: number;
  tunnelCooldown?: number;

  // Building fields
  tileX: number;
  tileZ: number;
  isFoundation: boolean;
  buildProgress: number; // 0..1
  floors?: number; // Multi-story apartment floor count (1..3)
  upgradeTargetTemplateId?: string | null;
  upgradeTargetFloors?: number;
  upgradeProgress?: number; // 0..1 timed building upgrade
  upgradeTotalTime?: number; // seconds required to complete building upgrade
  queue: ProductionItem[];
  rallyX: number;
  rallyZ: number;
  rallyTargetId: number | null;
  garrisonedIds: number[];
  capturePoints: Record<number, number>; // playerId -> points
  captureMax: number;
  inTerritory: boolean;
  decayTimer: number;
  linkedTunnelId?: number | null;
  tunnelLengthTiles?: number;
  tunnelDugUnits?: number;
  tunnelTotalUnits?: number;

  // Resource fields
  resourceRemaining: number;
}

export interface Projectile {
  id: number;
  owner: number;
  sourceId: number;
  targetId: number;
  startX: number;
  startY: number;
  startZ: number;
  x: number;
  y: number;
  z: number;
  targetX: number;
  targetY: number;
  targetZ: number;
  progress: number;
  duration: number;
  arcHeight: number;
  damage: { hack: number; pierce: number; crush: number };
  elevationBonus: number;
  splashRadius?: number;
  kind: ProjectileKind;
}
