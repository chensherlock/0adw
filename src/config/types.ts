export type ResourceType = 'food' | 'wood' | 'stone' | 'metal';

export interface ResourceBag {
  food: number;
  wood: number;
  stone: number;
  metal: number;
}

export type CivId = 'athenians' | 'romans';
export type Difficulty = 'easy' | 'medium' | 'hard';
export type ResolvedMapType = 'aegean_valley' | 'medit_highlands' | 'twin_peninsulas' | 'inland_oasis' | 'open_plains';
export type MapType = 'random' | ResolvedMapType;
export type EntityKind = 'unit' | 'building' | 'resource';
export type UnitStance = 'aggressive' | 'defensive' | 'stand_ground' | 'passive';
export type DamageType = 'hack' | 'pierce' | 'crush';
export type BuildingOrderMode = 'capture' | 'attack';
export type UnitRank = 1 | 2 | 3; // 1 = Basic, 2 = Advanced, 3 = Elite

export interface ArmorProfile {
  hack: number;
  pierce: number;
  crush: number;
}

export interface AttackProfile {
  hack: number;
  pierce: number;
  crush: number;
  range: number; // world units (<= 2.5 = melee)
  minRange?: number;
  cooldown: number; // seconds
  isRanged: boolean;
  projectileSpeed?: number;
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
  phaseRequired?: 1 | 2;

  // Unit specific
  speed?: number; // world units / sec
  attack?: AttackProfile;
  gather?: GatherProfile;
  canBuild?: string[]; // building template IDs
  isCitizenSoldier?: boolean;
  isWoman?: boolean;
  isCavalry?: boolean;
  isChampion?: boolean;
  isHealer?: boolean;
  healRate?: number;
  healRange?: number;
  isSiege?: boolean;

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
  farmFoodTotal?: number;

  // Resource specific
  resourceType?: ResourceType;
  resourceAmount?: number;
  maxGatherers?: number;
}

export interface TechTemplate {
  id: string;
  name: string;
  description: string;
  icon: string;
  cost: ResourceBag;
  researchTime: number;
  phaseRequired: 1 | 2;
  grantsPhase?: 2;
  attackBonusPct?: number;
  armorBonus?: Partial<ArmorProfile>;
  gatherBonusPct?: number;
  buildingHpBonusPct?: number;
  cavalrySpeedBonusPct?: number;
  healBonusPct?: number;
  tradeIncomeBonusPct?: number;
  siegeDamageBonusPct?: number;
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
  gatherMultiplier: Partial<Record<ResourceType, number>>;
  infantryArmorBonus: Partial<ArmorProfile>;
  infantryAttackBonusPct: number;
  buildingHpBonusPct: number;
  units: {
    woman: string;
    infantryMelee: string;
    infantryRanged: string;
    cavalry: string;
    champion: string;
  };
}

export type GameCommand =
  | { type: 'move'; playerId: number; entityIds: number[]; x: number; z: number; queued?: boolean; attackMove?: boolean }
  | { type: 'attack'; playerId: number; entityIds: number[]; targetId: number; mode?: BuildingOrderMode }
  | { type: 'gather'; playerId: number; entityIds: number[]; targetId: number }
  | { type: 'build'; playerId: number; entityIds: number[]; templateId: string; tileX: number; tileZ: number }
  | { type: 'repair'; playerId: number; entityIds: number[]; targetId: number }
  | { type: 'train'; playerId: number; buildingId: number; templateId: string }
  | { type: 'cancel_train'; playerId: number; buildingId: number; index: number }
  | { type: 'research'; playerId: number; buildingId: number; techId: string }
  | { type: 'set_rally'; playerId: number; buildingId: number; x: number; z: number; targetId?: number }
  | { type: 'set_stance'; playerId: number; entityIds: number[]; stance: UnitStance }
  | { type: 'garrison'; playerId: number; entityIds: number[]; buildingId: number }
  | { type: 'ungarrison'; playerId: number; buildingId: number }
  | { type: 'delete'; playerId: number; entityIds: number[] };

export type SimEvent =
  | { type: 'attack_swing'; x: number; z: number; isRanged: boolean }
  | { type: 'projectile_hit'; x: number; z: number }
  | { type: 'gather_tick'; x: number; z: number; resourceType: ResourceType }
  | { type: 'building_complete'; playerId: number; x: number; z: number; templateId: string }
  | { type: 'building_captured'; newOwner: number; oldOwner: number; x: number; z: number; templateId: string }
  | { type: 'unit_trained'; playerId: number; x: number; z: number; templateId: string }
  | { type: 'unit_promoted'; playerId: number; entityId: number; rank: UnitRank; x: number; z: number }
  | { type: 'tech_complete'; playerId: number; techId: string }
  | { type: 'under_attack'; playerId: number; x: number; z: number }
  | { type: 'entity_died'; entityId: number; x: number; z: number; kind: EntityKind }
  | { type: 'match_over'; winnerId: number };

export interface PlayerState {
  id: number; // 1 = human, 2 = AI
  name: string;
  civ: CivId;
  isAI: boolean;
  color: number;
  cssColor: string;
  resources: ResourceBag;
  popUsed: number;
  popCap: number;
  phase: 1 | 2;
  researchedTechs: Set<string>;
  researchingTechs: Set<string>;
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

  // Building fields
  tileX: number;
  tileZ: number;
  isFoundation: boolean;
  buildProgress: number; // 0..1
  queue: ProductionItem[];
  rallyX: number;
  rallyZ: number;
  rallyTargetId: number | null;
  garrisonedIds: number[];
  capturePoints: Record<number, number>; // playerId -> points
  captureMax: number;
  inTerritory: boolean;
  decayTimer: number;

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
  kind: 'arrow' | 'javelin';
}
