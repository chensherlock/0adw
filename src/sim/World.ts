import { ALL_CIV_IDS, CIVS } from '../config/civs';
import { resolveUnitTemplateId, TECHS, TEMPLATES } from '../config/entities';
import {
  ArmorProfile,
  BuildingOrderMode,
  CivChoice,
  CivId,
  Difficulty,
  DiplomaticStance,
  Entity,
  GameCommand,
  GameMode,
  MapSize,
  MapType,
  PlayerSlotConfig,
  PlayerState,
  Projectile,
  ResourceBag,
  ResourceType,
  SimEvent,
  TerraformMode,
  UnitOrder,
  UnitRank,
} from '../config/types';
import { FogGrid } from './map/FogGrid';
import { NavGrid } from './map/NavGrid';
import { SpatialHash } from './map/SpatialHash';
import { SOIL_UNITS_PER_TILE, TerrainMap, WATER_LEVEL } from './map/TerrainMap';
import { TerritoryGrid } from './map/TerritoryGrid';
import { SeededRNG } from './rng';

export const SIM_HZ = 20;
export const SIM_DT = 1 / SIM_HZ;

export const PLAYER_COLOR_PALETTE: ReadonlyArray<{ hex: number; css: string }> = [
  { hex: 0x2563eb, css: '#3b82f6' }, // 1: Royal Blue
  { hex: 0xdc2626, css: '#ef4444' }, // 2: Crimson Red
  { hex: 0x16a34a, css: '#22c55e' }, // 3: Emerald Green
  { hex: 0xd97706, css: '#f59e0b' }, // 4: Imperial Gold
  { hex: 0x9333ea, css: '#a855f7' }, // 5: Tyrian Purple
  { hex: 0x0891b2, css: '#06b6d4' }, // 6: Aegean Cyan
  { hex: 0xea580c, css: '#f97316' }, // 7: Terracotta Orange
  { hex: 0xdb2777, css: '#ec4899' }, // 8: Phoenician Rose
];

export interface MatchConfig {
  seed: number;
  playerCiv: CivId;
  aiCiv: CivId;
  difficulty: Difficulty;
  mapType?: MapType;
  mapSize?: MapSize;
  gameMode?: GameMode;
  aiVsAi?: boolean;
  numPlayers?: number;
  playerSlots?: PlayerSlotConfig[];
}

export interface SerializedWorldState {
  version: number;
  savedAt: number;
  config: MatchConfig;
  tickCount: number;
  time: number;
  nextEntityId: number;
  nextProjectileId: number;
  winnerId: number | null;
  rngState: number;
  terrain: ReturnType<TerrainMap['exportMutableState']>;
  fog: Record<number, number[]>;
  players: Array<Omit<PlayerState, 'researchedTechs' | 'researchingTechs'> & {
    researchedTechs: string[];
    researchingTechs: string[];
  }>;
  entities: Entity[];
  projectiles: Projectile[];
  savedTerraformJobs: Array<[number, { tileX: number; tileZ: number; destTileX: number; destTileZ: number; mode: TerraformMode }]>;
  camera?: { x: number; z: number; distance: number; yaw: number };
}

export class World {
  readonly config: MatchConfig;
  readonly rng: SeededRNG;
  readonly terrain: TerrainMap;
  readonly navGrid: NavGrid;
  readonly spatialHash: SpatialHash;
  readonly territory: TerritoryGrid;
  readonly fog: FogGrid;

  readonly players: Map<number, PlayerState> = new Map();
  readonly entities: Map<number, Entity> = new Map();
  readonly projectiles: Projectile[] = [];

  private pendingCommands: GameCommand[] = [];
  readonly events: SimEvent[] = [];

  private nextEntityId = 1;
  private nextProjectileId = 1;
  private territoryDirty = true;
  private lastTerrainVersion = 0;

  tickCount = 0;
  time = 0;
  winnerId: number | null = null;
  private lastAttackAlertTime: Map<number, number> = new Map();
  private idleTicks: Map<number, number> = new Map();
  private stuckTicks: Map<number, number> = new Map();
  private wildlifeState: Map<number, { hunterId: number; alertTimer: number; attackCooldown: number }> = new Map();
  /** Remembers unfinished dig/fill/level jobs so any other worker can later resume them seamlessly! */
  private savedTerraformJobs: Map<
    number,
    { tileX: number; tileZ: number; destTileX: number; destTileZ: number; mode: TerraformMode }
  > = new Map();
  private queryBuf: Entity[] = [];

  constructor(config: MatchConfig) {
    this.config = config;
    this.rng = new SeededRNG(config.seed);
    const numPlayers = Math.max(
      2,
      Math.min(8, config.playerSlots?.length ?? config.numPlayers ?? 2)
    );
    this.terrain = new TerrainMap(
      config.seed,
      config.mapType ?? 'random',
      config.mapSize ?? 'medium',
      numPlayers
    );
    this.navGrid = new NavGrid(this.terrain);
    this.spatialHash = new SpatialHash(this.terrain.worldSize, 6);
    this.territory = new TerritoryGrid(this.terrain);
    const playerIds = Array.from({ length: numPlayers }, (_, i) => i + 1);
    this.fog = new FogGrid(this.terrain, playerIds);

    this.initPlayers();
    this.populateMap();
    this.recomputePopulations();
    this.recomputeTerritory();
    this.rebuildSpatialHash();
    this.fog.update(this.entities.values(), this.getSharedAllyMap());
  }

  isPeaceful(): boolean {
    return this.config.gameMode === 'peaceful';
  }

  getDiplomacy(ownerA: number, ownerB: number): DiplomaticStance {
    if (ownerA === ownerB) return 'ally';
    const pA = this.players.get(ownerA);
    if (!pA) return 'enemy';
    return pA.diplomacy[ownerB] ?? (this.isPeaceful() ? 'neutral' : 'enemy');
  }

  /** Authentic 0 A.D. mutual alliance: both nations must declare Ally toward each other */
  areAllies(ownerA: number, ownerB: number): boolean {
    if (ownerA === ownerB) return true;
    if (ownerA === 0 || ownerB === 0) return false;
    return this.getDiplomacy(ownerA, ownerB) === 'ally' && this.getDiplomacy(ownerB, ownerA) === 'ally';
  }

  isAlliedOrOwn(ownerA: number, ownerB: number): boolean {
    return ownerA === ownerB || this.areAllies(ownerA, ownerB);
  }

  areHostile(ownerA: number, ownerB: number): boolean {
    if (ownerA === ownerB) return false;
    if (ownerA === 0 || ownerB === 0) return true; // Wild predators/wildlife can always be fought or hunted
    if (this.isPeaceful()) return false; // Peaceful mode: nations cannot attack each other!
    const sAB = this.getDiplomacy(ownerA, ownerB);
    const sBA = this.getDiplomacy(ownerB, ownerA);
    return sAB === 'enemy' || sBA === 'enemy';
  }

  getSharedAllyMap(): Map<number, number[]> {
    const map = new Map<number, number[]>();
    const ids = Array.from(this.players.keys());
    for (const a of ids) {
      const allies: number[] = [];
      for (const b of ids) {
        if (a !== b && this.areAllies(a, b)) allies.push(b);
      }
      if (allies.length > 0) map.set(a, allies);
    }
    return map;
  }

  private resolveCivChoice(choice: CivChoice): CivId {
    if (choice === 'random') {
      return this.rng.pick(ALL_CIV_IDS);
    }
    return CIVS[choice] ? choice : 'athenians';
  }

  private initPlayers(): void {
    const numPlayers = this.terrain.spawns.length;
    const slots: PlayerSlotConfig[] =
      this.config.playerSlots && this.config.playerSlots.length >= 2
        ? this.config.playerSlots.slice(0, numPlayers)
        : Array.from({ length: numPlayers }, (_, idx) => {
            const pid = idx + 1;
            if (pid === 1) {
              return { playerId: 1, civ: this.config.playerCiv, team: 0, isAI: Boolean(this.config.aiVsAi) };
            }
            if (pid === 2) {
              return { playerId: 2, civ: this.config.aiCiv, team: 0, isAI: true };
            }
            return {
              playerId: pid,
              civ: ALL_CIV_IDS[(idx * 3 + this.config.seed) % ALL_CIV_IDS.length],
              team: 0,
              isAI: true,
            };
          });

    // Resolve each player's civ & color
    const resolvedSlots = slots.map((slot, idx) => {
      const pid = idx + 1;
      const civId = this.resolveCivChoice(slot.civ);
      const civCfg = CIVS[civId];
      let color = PLAYER_COLOR_PALETTE[idx % PLAYER_COLOR_PALETTE.length].hex;
      let cssColor = PLAYER_COLOR_PALETTE[idx % PLAYER_COLOR_PALETTE.length].css;
      if (numPlayers === 2) {
        // Preserve authentic civ primary colors for classic 1v1
        if (pid === 1) {
          color = civCfg.primaryColor;
          cssColor = civCfg.cssColor;
        } else {
          const p1CivId = this.resolveCivChoice(slots[0].civ);
          const sameCiv = p1CivId === civId;
          color = sameCiv ? (civId === 'romans' ? 0x2b6cb0 : 0xc53030) : civCfg.primaryColor;
          cssColor = sameCiv ? (civId === 'romans' ? '#3b82f6' : '#ef4444') : civCfg.cssColor;
        }
      }
      return { pid, civId, civCfg, team: slot.team ?? 0, isAI: slot.isAI, color, cssColor };
    });

    for (const s of resolvedSlots) {
      const diplomacy: Record<number, DiplomaticStance> = {};
      for (const other of resolvedSlots) {
        if (other.pid === s.pid) continue;
        if (s.team > 0 && s.team === other.team) {
          diplomacy[other.pid] = 'ally';
        } else if (this.isPeaceful()) {
          diplomacy[other.pid] = 'neutral';
        } else {
          diplomacy[other.pid] = 'enemy';
        }
      }

      const label =
        s.pid === 1
          ? s.isAI
            ? `AI 1 (${s.civCfg.name})`
            : `You (${s.civCfg.name})`
          : `AI ${s.pid} (${s.civCfg.name})`;

      this.players.set(s.pid, {
        id: s.pid,
        name: label,
        civ: s.civId,
        isAI: s.isAI,
        team: s.team,
        diplomacy,
        color: s.color,
        cssColor: s.cssColor,
        resources: { food: 350, wood: 350, stone: 200, metal: 150 },
        popUsed: 0,
        popCap: 0,
        phase: 1,
        researchedTechs: new Set(),
        researchingTechs: new Set(),
        skillCooldown: 0,
        skillActiveTimer: 0,
        defeated: false,
        stats: {
          unitsTrained: 0,
          unitsLost: 0,
          enemiesKilled: 0,
          buildingsConstructed: 0,
          buildingsCaptured: 0,
          resourcesGathered: 0,
        },
      });
    }
  }

  private populateMap(): void {
    // 1. Place symmetrical starting bases & balanced starting resources around each random spawn
    for (const spawn of this.terrain.spawns) {
      const player = this.players.get(spawn.playerId)!;
      const civ = CIVS[player.civ];
      const toCenterX = this.terrain.width * 0.5 - spawn.tileX;
      const toCenterZ = this.terrain.height * 0.5 - spawn.tileZ;
      const toCenterLen = Math.max(1, Math.hypot(toCenterX, toCenterZ));
      const fwdX = toCenterX / toCenterLen;
      const fwdZ = toCenterZ / toCenterLen;
      const sideX = -fwdZ;
      const sideZ = fwdX;
      const baseAngle = Math.atan2(fwdZ, fwdX);

      const cc = this.spawnBuilding('civic_center', spawn.playerId, spawn.tileX, spawn.tileZ, false);
      if (cc) {
        cc.rallyX = cc.x + fwdX * 11;
        cc.rallyZ = cc.z + fwdZ * 11;
      }

      // Starting units: 2 Female Citizens, 2 Male Citizens, 4 Melee Citizen-Soldiers, 1 Cavalry Scout
      const ccPos = this.terrain.tileToWorldCenter(spawn.tileX, spawn.tileZ);
      for (let i = 0; i < 4; i++) {
        const angle = baseAngle - 0.75 + (i / 3) * 1.5;
        const ux = ccPos.x + Math.cos(angle) * 7.4;
        const uz = ccPos.z + Math.sin(angle) * 7.4;
        const citizenId = i < 2 ? civ.units.woman : 'male_citizen';
        this.spawnUnit(citizenId, spawn.playerId, ux, uz);
      }
      for (let i = 0; i < 4; i++) {
        const angle = baseAngle - 1.1 + (i / 3) * 2.2;
        const ux = ccPos.x + Math.cos(angle) * 9.8;
        const uz = ccPos.z + Math.sin(angle) * 9.8;
        this.spawnUnit(civ.units.infantryMelee, spawn.playerId, ux, uz);
      }
      this.spawnUnit(
        civ.units.cavalry,
        spawn.playerId,
        ccPos.x + fwdX * 12.2,
        ccPos.z + fwdZ * 12.2
      );

      // 1a. Guaranteed starting Stone Quarries (3) & Metal Mines (3) placed FIRST right near Civic Center!
      this.guaranteeStarterResource(
        spawn.tileX,
        spawn.tileZ,
        'stone_quarry',
        spawn.tileX + fwdX * 6.5 - sideX * 5.2,
        spawn.tileZ + fwdZ * 6.5 - sideZ * 5.2,
        6.2,
        13.5
      );
      this.guaranteeStarterResource(
        spawn.tileX,
        spawn.tileZ,
        'stone_quarry',
        spawn.tileX + fwdX * 8.4 - sideX * 3.8,
        spawn.tileZ + fwdZ * 8.4 - sideZ * 3.8,
        6.2,
        13.5
      );
      this.guaranteeStarterResource(
        spawn.tileX,
        spawn.tileZ,
        'stone_quarry',
        spawn.tileX + fwdX * 7.6 - sideX * 7.4,
        spawn.tileZ + fwdZ * 7.6 - sideZ * 7.4,
        6.5,
        14.0
      );
      this.guaranteeStarterResource(
        spawn.tileX,
        spawn.tileZ,
        'metal_mine',
        spawn.tileX - fwdX * 5.5 - sideX * 6.0,
        spawn.tileZ - fwdZ * 5.5 - sideZ * 6.0,
        6.2,
        13.5
      );
      this.guaranteeStarterResource(
        spawn.tileX,
        spawn.tileZ,
        'metal_mine',
        spawn.tileX - fwdX * 3.8 - sideX * 7.8,
        spawn.tileZ - fwdZ * 3.8 - sideZ * 7.8,
        6.2,
        13.5
      );
      this.guaranteeStarterResource(
        spawn.tileX,
        spawn.tileZ,
        'metal_mine',
        spawn.tileX - fwdX * 7.4 - sideX * 4.2,
        spawn.tileZ - fwdZ * 7.4 - sideZ * 4.2,
        6.5,
        14.0
      );

      // 1b. Guaranteed starting Food grove (4 Berry Bushes + 2 Wild Grapevines)
      const foodBaseX = spawn.tileX - fwdX * 3.8 + sideX * 6.5;
      const foodBaseZ = spawn.tileZ - fwdZ * 3.8 + sideZ * 6.5;
      for (let i = 0; i < 6; i++) {
        const ang = (i / 6) * Math.PI * 2;
        const tpl = i < 4 ? 'berry_bush' : 'grape_vine';
        this.guaranteeStarterResource(
          spawn.tileX,
          spawn.tileZ,
          tpl,
          foodBaseX + Math.cos(ang) * 2.1,
          foodBaseZ + Math.sin(ang) * 2.1,
          6.0,
          13.0
        );
      }

      // 1c. Nearby starter Deer herd (3 deer) slightly outward
      const deerBaseX = spawn.tileX + fwdX * 6.5 + sideX * 10.2;
      const deerBaseZ = spawn.tileZ + fwdZ * 6.5 + sideZ * 10.2;
      for (let i = 0; i < 3; i++) {
        const ang = i * 2.1;
        this.guaranteeStarterResource(
          spawn.tileX,
          spawn.tileZ,
          'deer_herd',
          deerBaseX + Math.cos(ang) * 1.8,
          deerBaseZ + Math.sin(ang) * 1.8,
          8.5,
          15.5
        );
      }

      // 1d. Guaranteed starting Mixed Timber Grove (20 trees)
      const forestBaseX = spawn.tileX - fwdX * 9 + sideX * 1.5;
      const forestBaseZ = spawn.tileZ - fwdZ * 9 + sideZ * 1.5;
      for (let i = 0; i < 20; i++) {
        const ang = this.rng.range(0, Math.PI * 2);
        const dist = this.rng.range(1.2, 6.8);
        const tx = forestBaseX + Math.cos(ang) * dist;
        const tz = forestBaseZ + Math.sin(ang) * dist;
        const r = this.rng.next();
        const treeId = r < 0.42 ? 'tree_cypress' : r < 0.76 ? 'tree_olive' : 'tree_oak';
        if (!this.trySpawnResource(treeId, tx, tz) && i < 12) {
          this.guaranteeStarterResource(spawn.tileX, spawn.tileZ, treeId, tx, tz, 7.5, 14.5);
        }
      }
    }

    const isClearOfSpawns = (tx: number, tz: number, minDist: number): boolean => {
      for (const s of this.terrain.spawns) {
        if (Math.hypot(tx - s.tileX, tz - s.tileZ) < minDist) return false;
      }
      return true;
    };

    const pickDryPair = (
      minSpawnDist: number,
      minH = 0.4,
      maxH = 7.6,
      maxTries = 60
    ): { x: number; z: number } | null => {
      for (let t = 0; t < maxTries; t++) {
        const x = this.rng.range(10, this.terrain.width - 10);
        const z = this.rng.range(10, this.terrain.height - 10);
        const mx = this.terrain.width - x;
        const mz = this.terrain.height - z;
        const rx = Math.round(x);
        const rz = Math.round(z);
        const mrx = Math.round(mx);
        const mrz = Math.round(mz);
        if (!this.terrain.isTileDryLand(rx, rz) || !this.terrain.isTileDryLand(mrx, mrz)) continue;
        if (!isClearOfSpawns(x, z, minSpawnDist) || !isClearOfSpawns(mx, mz, minSpawnDist)) continue;
        const h = this.terrain.getVertexHeight(rx, rz);
        if (h < minH || h > maxH) continue;
        return { x, z };
      }
      return null;
    };

    // 2. Strategic Contested Rich Deposits (Marble Quarries & Aegean Gold Veins)
    for (const f of this.terrain.fords) {
      // Place contested gold/marble overlooking river crossings
      const ang = this.rng.range(0, Math.PI * 2);
      const gx = f.tileX + Math.cos(ang) * (f.radius + 3.5);
      const gz = f.tileZ + Math.sin(ang) * (f.radius + 3.5);
      this.trySpawnResourceNear('gold_vein', gx, gz, 6);
      this.trySpawnResourceNear('marble_quarry', this.terrain.width - gx, this.terrain.height - gz, 6);
    }

    for (let i = 0; i < 4; i++) {
      const p = pickDryPair(20, 1.8, 9.2, 80) ?? pickDryPair(16, 0.5, 9.5, 80);
      if (p) {
        this.trySpawnResourceNear('marble_quarry', p.x, p.z, 5);
        this.trySpawnResourceNear('marble_quarry', this.terrain.width - p.x, this.terrain.height - p.z, 5);
      }
      const g = pickDryPair(20, 1.8, 9.2, 80) ?? pickDryPair(16, 0.5, 9.5, 80);
      if (g) {
        this.trySpawnResourceNear('gold_vein', g.x, g.z, 5);
        this.trySpawnResourceNear('gold_vein', this.terrain.width - g.x, this.terrain.height - g.z, 5);
      }
    }

    // 3. Abundant Expansion Limestone Quarries & Metal Mines (symmetrical pairs across hills & plains)
    for (let i = 0; i < 6; i++) {
      const sp = pickDryPair(15, 0.8, 9.0, 80) ?? pickDryPair(14, 0.4, 9.5, 80);
      if (sp) {
        this.trySpawnResourceNear('stone_quarry', sp.x, sp.z, 5);
        this.trySpawnResourceNear('stone_quarry', this.terrain.width - sp.x, this.terrain.height - sp.z, 5);
      }
      const mp = pickDryPair(15, 0.8, 9.0, 80) ?? pickDryPair(14, 0.4, 9.5, 80);
      if (mp) {
        this.trySpawnResourceNear('metal_mine', mp.x, mp.z, 5);
        this.trySpawnResourceNear('metal_mine', this.terrain.width - mp.x, this.terrain.height - mp.z, 5);
      }
    }

    // 4. Lakeside & Meadow Food Clusters (Wild Grapevines & Berry Bushes)
    for (const lake of this.terrain.lakes) {
      const count = 4;
      for (let i = 0; i < count; i++) {
        const ang = this.rng.range(0, Math.PI * 2);
        const fx = lake.x + Math.cos(ang) * (lake.rx + 2.8);
        const fz = lake.z + Math.sin(ang) * (lake.rz + 2.8);
        this.trySpawnResourceNear(i % 2 === 0 ? 'grape_vine' : 'berry_bush', fx, fz, 5);
      }
    }
    for (let i = 0; i < 4; i++) {
      const gp = pickDryPair(18, 0.9, 4.4);
      if (gp) {
        for (let k = 0; k < 3; k++) {
          const ang = (k / 3) * Math.PI * 2 + this.rng.range(0, 0.6);
          const ox = Math.cos(ang) * 1.9;
          const oz = Math.sin(ang) * 1.9;
          const tpl = i % 2 === 0 ? 'grape_vine' : 'berry_bush';
          this.trySpawnResourceNear(tpl, gp.x + ox, gp.z + oz, 4);
          this.trySpawnResourceNear(tpl, this.terrain.width - (gp.x + ox), this.terrain.height - (gp.z + oz), 4);
        }
      }
    }

    // 5. Huntable Mediterranean Wildlife (Deer Herds & Wild Boars)
    for (let i = 0; i < 5; i++) {
      const dp = pickDryPair(17, 0.9, 4.8);
      if (dp) {
        for (let k = 0; k < 3; k++) {
          const ang = k * 2.1 + this.rng.range(0, 0.5);
          const ox = Math.cos(ang) * 1.9;
          const oz = Math.sin(ang) * 1.9;
          this.trySpawnResourceNear('deer_herd', dp.x + ox, dp.z + oz, 4);
          this.trySpawnResourceNear('deer_herd', this.terrain.width - (dp.x + ox), this.terrain.height - (dp.z + oz), 4);
        }
      }
    }
    for (let i = 0; i < 3; i++) {
      const bp = pickDryPair(20, 1.3, 5.5);
      if (bp) {
        for (let k = 0; k < 2; k++) {
          const ox = k === 0 ? -1.2 : 1.2;
          const oz = k === 0 ? 0.8 : -0.8;
          this.trySpawnResourceNear('wild_boar', bp.x + ox, bp.z + oz, 4);
          this.trySpawnResourceNear('wild_boar', this.terrain.width - (bp.x + ox), this.terrain.height - (bp.z + oz), 4);
        }
      }
    }

    // 6. Biome-Aware Natural Forests (Palms on beaches, Oak/Olive/Cypress on plains, Aleppo Pines on foothills)
    const grovePairs = 12;
    for (let g = 0; g < grovePairs; g++) {
      const center = pickDryPair(16, 0.35, 7.2);
      if (!center) continue;
      const count = this.rng.int(9, 14);
      for (let i = 0; i < count; i++) {
        const ang = this.rng.range(0, Math.PI * 2);
        const dist = this.rng.range(0.6, 5.8);
        const ox = Math.cos(ang) * dist;
        const oz = Math.sin(ang) * dist;
        const tx = center.x + ox;
        const tz = center.z + oz;
        const h = this.terrain.getVertexHeight(Math.round(tx), Math.round(tz));
        const treeId = this.pickBiomeTree(h);
        this.trySpawnResource(treeId, tx, tz);
        this.trySpawnResource(treeId, this.terrain.width - tx, this.terrain.height - tz);
      }
    }

    // Extra coastal Date Palm clusters right along sandy shores
    for (let p = 0; p < 5; p++) {
      const shore = pickDryPair(16, 0.3, 1.45, 80);
      if (!shore) continue;
      for (let k = 0; k < 5; k++) {
        const ang = this.rng.range(0, Math.PI * 2);
        const d = this.rng.range(0.6, 3.6);
        const ox = Math.cos(ang) * d;
        const oz = Math.sin(ang) * d;
        this.trySpawnResource('tree_palm', shore.x + ox, shore.z + oz);
        this.trySpawnResource('tree_palm', this.terrain.width - (shore.x + ox), this.terrain.height - (shore.z + oz));
      }
    }

    // 7a. Shoreline Fish Shoals near riverbanks, lake edges & sea coasts (reachable by land workers with fishing rods & cast nets!)
    let shoreFishSpawned = 0;
    for (let tries = 0; tries < 600 && shoreFishSpawned < 12; tries++) {
      const tx = this.rng.int(5, this.terrain.width - 6);
      const tz = this.rng.int(5, this.terrain.height - 6);
      if (!this.terrain.isTileWaterNavigable(tx, tz)) continue;
      // Must be right beside walkable land (1..2 tiles from shore!)
      let nearShore = false;
      for (let dz = -2; dz <= 2 && !nearShore; dz++) {
        for (let dx = -2; dx <= 2; dx++) {
          if (Math.hypot(dx, dz) <= 2.3 && this.navGrid.isWalkable(tx + dx, tz + dz)) {
            nearShore = true;
            break;
          }
        }
      }
      if (!nearShore) continue;
      const pos = this.terrain.tileToWorldCenter(tx, tz);
      let tooClose = false;
      for (const e of this.entities.values()) {
        if (e.templateId === 'fish_shoal' && Math.hypot(e.x - pos.x, e.z - pos.z) < 11) {
          tooClose = true;
          break;
        }
      }
      if (tooClose) continue;
      const fish = this.createBaseEntity('fish_shoal', 0, pos.x, pos.z);
      fish.resourceRemaining = TEMPLATES.fish_shoal.resourceAmount ?? 700;
      this.entities.set(fish.id, fish);
      shoreFishSpawned++;
    }

    // 7b. Deep-Sea Fish Shoals in open coastal bays, lakes & deep water (for Fishing Boats!)
    let fishSpawned = 0;
    for (let tries = 0; tries < 450 && fishSpawned < 14; tries++) {
      const tx = this.rng.int(5, this.terrain.width - 6);
      const tz = this.rng.int(5, this.terrain.height - 6);
      if (!this.terrain.isTileWaterNavigable(tx, tz)) continue;
      // Prefer waters with surrounding navigable space (not cramped 1-tile puddles)
      if (
        !this.terrain.isTileWaterNavigable(tx + 1, tz) ||
        !this.terrain.isTileWaterNavigable(tx - 1, tz) ||
        !this.terrain.isTileWaterNavigable(tx, tz + 1) ||
        !this.terrain.isTileWaterNavigable(tx, tz - 1)
      ) {
        continue;
      }
      const pos = this.terrain.tileToWorldCenter(tx, tz);
      let tooClose = false;
      for (const e of this.entities.values()) {
        if (e.templateId === 'fish_shoal' && Math.hypot(e.x - pos.x, e.z - pos.z) < 12) {
          tooClose = true;
          break;
        }
      }
      if (tooClose) continue;
      const fish = this.createBaseEntity('fish_shoal', 0, pos.x, pos.z);
      fish.resourceRemaining = TEMPLATES.fish_shoal.resourceAmount ?? 700;
      this.entities.set(fish.id, fish);
      fishSpawned++;
    }

    // 8. Harvestable Ancient Ruin Stone Pillars (EVERY stone pillar on the map can be quarried for Stone!)
    // 8a. Ceremonial stone pillars flanking each nation's starting base (replacing non-clickable decorative pillars!)
    for (const sp of this.terrain.spawns) {
      const toCenterAng = Math.atan2(this.terrain.height * 0.5 - sp.tileZ, this.terrain.width * 0.5 - sp.tileX);
      for (const side of [-1, 1]) {
        const ang = toCenterAng + side * 0.52;
        const px = sp.tileX + Math.cos(ang) * 4.5;
        const pz = sp.tileZ + Math.sin(ang) * 4.5;
        this.trySpawnResource('ancient_ruin_pillar', px, pz);
      }
    }
    // 8b. Ancient river-ford boundary pillars
    for (const f of this.terrain.fords) {
      for (let k = 0; k < 2; k++) {
        const ang = k * Math.PI + 0.5;
        const px = f.tileX + Math.cos(ang) * (f.radius + 1.8);
        const pz = f.tileZ + Math.sin(ang) * (f.radius + 1.8);
        this.trySpawnResource('ancient_ruin_pillar', px, pz);
      }
    }
    // 8c. Field temple ruin pillar clusters
    let ruinSites = 0;
    for (let tries = 0; tries < 180 && ruinSites < 7; tries++) {
      const rx = this.rng.range(12, this.terrain.width - 12);
      const rz = this.rng.range(12, this.terrain.height - 12);
      if (!isClearOfSpawns(rx, rz, 12)) continue;
      const rtx = Math.round(rx);
      const rtz = Math.round(rz);
      if (!this.terrain.isTileDryLand(rtx, rtz) || this.terrain.getTileSlope(rtx, rtz) > 0.72) continue;

      const cols = this.rng.int(2, 3);
      let placedAny = false;
      for (let c = 0; c < cols; c++) {
        const ang = (c / cols) * Math.PI * 2 + 0.4;
        const px = rx + Math.cos(ang) * 1.45;
        const pz = rz + Math.sin(ang) * 1.45;
        const pillar = this.trySpawnResource('ancient_ruin_pillar', px, pz);
        if (pillar) placedAny = true;
      }
      if (placedAny) ruinSites++;
    }

    // 9. Biome-Distinct Bamboo Groves, Passive Wildlife & Predators (each terrain spawns authentic native fauna!)
    const mt = this.terrain.resolvedMapType;
    const bambooClusters =
      mt === 'rainforest' || mt === 'swamp'
        ? 12
        : mt === 'island' || mt === 'archipelago' || mt === 'forest'
          ? 7
          : 3;
    for (let b = 0; b < bambooClusters; b++) {
      const bp = pickDryPair(16, 0.4, 4.6, 50);
      if (!bp) continue;
      for (let k = 0; k < 6; k++) {
        const ang = this.rng.range(0, Math.PI * 2);
        const d = this.rng.range(0.6, 3.0);
        this.trySpawnResource('tree_bamboo', bp.x + Math.cos(ang) * d, bp.z + Math.sin(ang) * d);
        this.trySpawnResource(
          'tree_bamboo',
          this.terrain.width - (bp.x + Math.cos(ang) * d),
          this.terrain.height - (bp.z + Math.sin(ang) * d)
        );
      }
    }

    // Distinct Biome Wildlife Profiles across all 15 terrains!
    type BiomeWildlifeProfile = {
      passive: string[];
      predators: string[];
      passiveGroups: number;
      predatorGroups: number;
      primaryBird: 'wild_eagle' | 'wild_seagull' | 'mixed';
    };
    const biomeWildlife: Record<string, BiomeWildlifeProfile> = {
      inland_oasis: { passive: ['wild_gazelle'], predators: ['predator_lion'], passiveGroups: 5, predatorGroups: 4, primaryBird: 'wild_eagle' },
      mesa: { passive: ['wild_gazelle'], predators: ['predator_lion'], passiveGroups: 4, predatorGroups: 4, primaryBird: 'wild_eagle' },
      alpine_passes: { passive: ['deer_herd'], predators: ['predator_bear', 'predator_wolf'], passiveGroups: 4, predatorGroups: 4, primaryBird: 'wild_eagle' },
      mountain: { passive: ['deer_herd'], predators: ['predator_bear', 'predator_wolf'], passiveGroups: 4, predatorGroups: 5, primaryBird: 'wild_eagle' },
      hills: { passive: ['deer_herd', 'wild_gazelle'], predators: ['predator_wolf'], passiveGroups: 4, predatorGroups: 4, primaryBird: 'wild_eagle' },
      plateau: { passive: ['wild_gazelle', 'deer_herd'], predators: ['predator_lion', 'predator_wolf'], passiveGroups: 4, predatorGroups: 4, primaryBird: 'wild_eagle' },
      rainforest: { passive: ['wild_elephant', 'wild_boar'], predators: ['predator_lion', 'predator_bear'], passiveGroups: 5, predatorGroups: 4, primaryBird: 'wild_eagle' },
      swamp: { passive: ['wild_boar', 'wild_elephant'], predators: ['predator_bear'], passiveGroups: 5, predatorGroups: 4, primaryBird: 'mixed' },
      forest: { passive: ['deer_herd', 'wild_boar'], predators: ['predator_wolf', 'predator_bear'], passiveGroups: 5, predatorGroups: 5, primaryBird: 'wild_eagle' },
      island: { passive: ['wild_boar', 'wild_elephant'], predators: ['predator_lion'], passiveGroups: 4, predatorGroups: 3, primaryBird: 'wild_seagull' },
      twin_peninsulas: { passive: ['deer_herd', 'wild_boar'], predators: ['predator_wolf'], passiveGroups: 4, predatorGroups: 3, primaryBird: 'wild_seagull' },
      aegean_valley: { passive: ['deer_herd', 'wild_boar'], predators: ['predator_wolf', 'predator_lion'], passiveGroups: 4, predatorGroups: 4, primaryBird: 'mixed' },
      volcano: { passive: ['wild_gazelle'], predators: ['predator_lion', 'predator_wolf'], passiveGroups: 3, predatorGroups: 4, primaryBird: 'wild_eagle' },
      open_plains: { passive: ['wild_gazelle', 'deer_herd'], predators: ['predator_lion', 'predator_wolf'], passiveGroups: 5, predatorGroups: 4, primaryBird: 'wild_eagle' },
    };
    const bw = biomeWildlife[mt] ?? biomeWildlife.open_plains;

    for (let g = 0; g < bw.passiveGroups; g++) {
      const animalId = bw.passive[g % bw.passive.length];
      const gp = pickDryPair(18, 0.7, 6.2, 45);
      if (!gp) continue;
      const count = animalId === 'wild_elephant' ? 1 : 2;
      for (let k = 0; k < count; k++) {
        const ox = k === 0 ? -1.0 : 1.0;
        this.trySpawnResourceNear(animalId, gp.x + ox, gp.z, 4);
        this.trySpawnResourceNear(animalId, this.terrain.width - (gp.x + ox), this.terrain.height - gp.z, 4);
      }
    }

    // Aggressive Biome Predators (kept >= 22 tiles from all starting Civic Centers so bases start safe!)
    for (let pr = 0; pr < bw.predatorGroups; pr++) {
      const pp = pickDryPair(22, 0.8, 7.5, 55);
      if (!pp) continue;
      const predId = bw.predators[pr % bw.predators.length];
      this.trySpawnResourceNear(predId, pp.x, pp.z, 4);
      this.trySpawnResourceNear(predId, this.terrain.width - pp.x, this.terrain.height - pp.z, 4);
    }

    // 10. Soaring Wild Birds (biome-matched Eagles vs coastal Seagulls)
    const birdCount = bw.primaryBird === 'wild_seagull' || bw.primaryBird === 'mixed' ? 14 : 12;
    for (let bi = 0; bi < birdCount; bi++) {
      const bx = this.rng.range(24, this.terrain.worldSize - 24);
      const bz = this.rng.range(24, this.terrain.worldSize - 24);
      const bTile = this.terrain.worldToTile(bx, bz);
      const overWater = this.terrain.isTileWaterNavigable(bTile.tx, bTile.tz);
      const birdTpl =
        bw.primaryBird === 'wild_seagull'
          ? 'wild_seagull'
          : bw.primaryBird === 'wild_eagle'
            ? overWater && bi % 3 === 0
              ? 'wild_seagull'
              : 'wild_eagle'
            : overWater || bi % 2 === 0
              ? 'wild_seagull'
              : 'wild_eagle';
      const bird = this.createBaseEntity(birdTpl, 0, bx, bz);
      bird.guardX = bx;
      bird.guardZ = bz;
      bird.animTime = this.rng.range(0, Math.PI * 2);
      bird.facing = this.rng.range(0, Math.PI * 2);
      bird.animState = 'walk';
      this.entities.set(bird.id, bird);
    }

    // 11. Deep-Sea Monsters (Winged Sea Dragons & Giant Octopuses patrolling open navigable ocean!)
    const maxOceanMonsters =
      mt === 'island' || mt === 'archipelago' || mt === 'twin_peninsulas'
        ? 6
        : mt === 'aegean_valley' || mt === 'swamp'
          ? 4
          : 2;
    let monstersSpawned = 0;
    const isNearAnySpawnWorld = (wx: number, wz: number, minD: number): boolean => {
      for (const s of this.terrain.spawns) {
        const sw = this.terrain.tileToWorldCenter(s.tileX, s.tileZ);
        if (Math.hypot(wx - sw.x, wz - sw.z) < minD) return true;
      }
      return false;
    };
    const isNearInlandLake = (tx: number, tz: number): boolean => {
      for (const lake of this.terrain.lakes) {
        const dx = (tx - lake.x) / Math.max(1, lake.rx + 2);
        const dz = (tz - lake.z) / Math.max(1, lake.rz + 2);
        if (dx * dx + dz * dz <= 1.15) return true;
      }
      return false;
    };
    for (let tries = 0; tries < 560 && monstersSpawned < maxOceanMonsters; tries++) {
      const tx = this.rng.int(7, this.terrain.width - 8);
      const tz = this.rng.int(7, this.terrain.height - 8);
      if (!this.terrain.isTileWaterNavigable(tx, tz)) continue;
      if (isNearInlandLake(tx, tz)) continue;
      if (
        !this.terrain.isTileWaterNavigable(tx + 2, tz) ||
        !this.terrain.isTileWaterNavigable(tx - 2, tz) ||
        !this.terrain.isTileWaterNavigable(tx, tz + 2) ||
        !this.terrain.isTileWaterNavigable(tx, tz - 2)
      ) {
        continue;
      }
      const pos = this.terrain.tileToWorldCenter(tx, tz);
      if (isNearAnySpawnWorld(pos.x, pos.z, 26)) continue;
      let tooClose = false;
      for (const e of this.entities.values()) {
        if (TEMPLATES[e.templateId]?.isSeaMonster && Math.hypot(e.x - pos.x, e.z - pos.z) < 26) {
          tooClose = true;
          break;
        }
      }
      if (tooClose) continue;
      const oceanTplId = monstersSpawned % 2 === 0 ? 'sea_kraken' : 'sea_monster';
      const monster = this.createBaseEntity(oceanTplId, 0, pos.x, pos.z);
      monster.guardX = pos.x;
      monster.guardZ = pos.z;
      monster.facing = this.rng.range(0, Math.PI * 2);
      monster.resourceRemaining = TEMPLATES[oceanTplId].resourceAmount ?? 680;
      this.entities.set(monster.id, monster);
      monstersSpawned++;
    }

    // 11b. Inland Lake Monsters (Loch Ness Plesiosaurs lurking inside scenic lakes!)
    let lakesPopulated = 0;
    const maxLakeMonsters = 3;
    for (const lake of this.terrain.lakes) {
      if (lakesPopulated >= maxLakeMonsters) break;
      const cx = Math.round(lake.x);
      const cz = Math.round(lake.z);
      let foundTile: { tx: number; tz: number } | null = null;
      for (let r = 0; r <= Math.ceil(Math.max(lake.rx, lake.rz) * 0.65) && !foundTile; r++) {
        for (let oz = -r; oz <= r && !foundTile; oz++) {
          for (let ox = -r; ox <= r; ox++) {
            const tx = cx + ox;
            const tz = cz + oz;
            if (
              tx >= 6 &&
              tz >= 6 &&
              tx < this.terrain.width - 6 &&
              tz < this.terrain.height - 6 &&
              this.terrain.isTileWaterNavigable(tx, tz) &&
              this.terrain.isTileWaterNavigable(tx + 1, tz) &&
              this.terrain.isTileWaterNavigable(tx - 1, tz) &&
              this.terrain.isTileWaterNavigable(tx, tz + 1) &&
              this.terrain.isTileWaterNavigable(tx, tz - 1)
            ) {
              foundTile = { tx, tz };
              break;
            }
          }
        }
      }
      if (!foundTile) continue;
      const pos = this.terrain.tileToWorldCenter(foundTile.tx, foundTile.tz);
      if (isNearAnySpawnWorld(pos.x, pos.z, 18)) continue;
      let tooClose = false;
      for (const e of this.entities.values()) {
        if (TEMPLATES[e.templateId]?.isSeaMonster && Math.hypot(e.x - pos.x, e.z - pos.z) < 24) {
          tooClose = true;
          break;
        }
      }
      if (tooClose) continue;
      const nessie = this.createBaseEntity('lake_nessie', 0, pos.x, pos.z);
      nessie.guardX = pos.x;
      nessie.guardZ = pos.z;
      nessie.facing = this.rng.range(0, Math.PI * 2);
      nessie.resourceRemaining = TEMPLATES.lake_nessie.resourceAmount ?? 580;
      this.entities.set(nessie.id, nessie);
      lakesPopulated++;
    }
  }

  private pickBiomeTree(elevation: number): string {
    const r = this.rng.next();
    const mt = this.terrain.resolvedMapType;
    if (mt === 'rainforest') {
      return r < 0.42 ? 'tree_bamboo' : r < 0.75 ? 'tree_palm' : 'tree_oak';
    }
    if (mt === 'swamp') {
      return r < 0.48 ? 'tree_bamboo' : r < 0.76 ? 'tree_oak' : 'tree_cypress';
    }
    if (mt === 'forest') {
      return r < 0.44 ? 'tree_oak' : r < 0.74 ? 'tree_pine' : r < 0.88 ? 'tree_bamboo' : 'tree_cypress';
    }
    if (mt === 'island' || mt === 'archipelago') {
      return r < 0.52 ? 'tree_palm' : r < 0.78 ? 'tree_bamboo' : 'tree_olive';
    }
    if (mt === 'alpine_passes' || mt === 'mountain') {
      return r < 0.78 ? 'tree_pine' : 'tree_cypress';
    }
    if (mt === 'inland_oasis' || mt === 'mesa') {
      return r < 0.68 ? 'tree_palm' : 'tree_olive';
    }
    if (elevation < 1.55) {
      return r < 0.5 ? 'tree_palm' : r < 0.75 ? 'tree_bamboo' : 'tree_cypress';
    }
    if (elevation > 4.2) {
      return r < 0.68 ? 'tree_pine' : 'tree_cypress';
    }
    if (r < 0.32) return 'tree_cypress';
    if (r < 0.6) return 'tree_olive';
    if (r < 0.84) return 'tree_oak';
    if (r < 0.94) return 'tree_pine';
    return 'tree_bamboo';
  }

  /**
   * Guarantees placing a starter resource near a base spawn, falling back to full 360-degree
   * concentric rings around the Civic Center if water or cliffs block the preferred sector.
   */
  private guaranteeStarterResource(
    spawnTileX: number,
    spawnTileZ: number,
    templateId: string,
    idealTileX: number,
    idealTileZ: number,
    minDistTiles: number,
    maxDistTiles: number
  ): Entity | null {
    const first = this.trySpawnResourceNear(templateId, idealTileX, idealTileZ, 4);
    if (first) return first;

    const baseAng = Math.atan2(idealTileZ - spawnTileZ, idealTileX - spawnTileX);
    for (let r = minDistTiles; r <= maxDistTiles; r += 1.0) {
      for (let step = 0; step < 24; step++) {
        const dir = step % 2 === 0 ? 1 : -1;
        const offset = Math.ceil(step / 2) * (Math.PI / 12) * dir;
        const ang = baseAng + offset;
        const found = this.trySpawnResource(templateId, spawnTileX + Math.cos(ang) * r, spawnTileZ + Math.sin(ang) * r);
        if (found) return found;
      }
    }
    return null;
  }

  private trySpawnResourceNear(templateId: string, tileXf: number, tileZf: number, maxRadius: number): Entity | null {
    const direct = this.trySpawnResource(templateId, tileXf, tileZf);
    if (direct) return direct;
    for (let r = 1; r <= maxRadius; r++) {
      for (let a = 0; a < 8; a++) {
        const ang = (a / 8) * Math.PI * 2;
        const found = this.trySpawnResource(templateId, tileXf + Math.cos(ang) * r, tileZf + Math.sin(ang) * r);
        if (found) return found;
      }
    }
    return null;
  }

  private trySpawnResource(templateId: string, tileXf: number, tileZf: number): Entity | null {
    const tx = Math.round(tileXf);
    const tz = Math.round(tileZf);
    if (!this.navGrid.isWalkable(tx, tz) || !this.terrain.isTileDryLand(tx, tz)) return null;
    const wx = tileXf * this.terrain.tileSize;
    const wz = tileZf * this.terrain.tileSize;
    const tpl = TEMPLATES[templateId];
    if (!tpl) return null;

    // Avoid overlapping existing entities (extra breathing room between trees so lumberjacks never jam)
    for (const e of this.entities.values()) {
      const eTpl = TEMPLATES[e.templateId];
      const gap = tpl.resourceType === 'wood' && eTpl.resourceType === 'wood' ? 0.72 : 0.4;
      const minDist = tpl.radius + eTpl.radius + gap;
      const dx = e.x - wx;
      const dz = e.z - wz;
      if (dx * dx + dz * dz < minDist * minDist) return null;
    }

    const entity = this.createBaseEntity(templateId, 0, wx, wz);
    entity.tileX = tx;
    entity.tileZ = tz;
    entity.facing = this.rng.range(0, Math.PI * 2);
    entity.resourceRemaining = tpl.resourceAmount ?? 200;
    this.entities.set(entity.id, entity);
    return entity;
  }

  private createBaseEntity(templateId: string, owner: number, x: number, z: number): Entity {
    const tpl = TEMPLATES[templateId];
    const maxHp = this.computeMaxHp(templateId, owner);
    const capMax = this.computeCaptureMax(templateId, owner);
    const capturePoints: Record<number, number> = {};
    if (owner > 0 && capMax > 0) {
      capturePoints[owner] = capMax;
    }

    return {
      id: this.nextEntityId++,
      templateId,
      owner,
      x,
      z,
      prevX: x,
      prevZ: z,
      vx: 0,
      vz: 0,
      facing: 0,
      hp: maxHp,
      maxHp,
      alive: true,
      stance: tpl.isWoman || tpl.isTrader ? 'passive' : 'aggressive',
      order: { type: 'idle' },
      queuedOrders: [],
      path: [],
      pathIndex: 0,
      repathTimer: 0,
      attackCooldown: 0,
      animState: 'idle',
      animTime: this.rng.range(0, 10),
      carryType: null,
      carryAmount: 0,
      xp: 0,
      rank: 1,
      garrisonedIn: null,
      guardX: x,
      guardZ: z,
      tileX: Math.floor(x / this.terrain.tileSize),
      tileZ: Math.floor(z / this.terrain.tileSize),
      isFoundation: false,
      buildProgress: 1,
      floors: tpl.isApartment ? 2 : 1,
      queue: [],
      rallyX: x + 6,
      rallyZ: z + 6,
      rallyTargetId: null,
      garrisonedIds: [],
      capturePoints,
      captureMax: capMax,
      inTerritory: true,
      decayTimer: 0,
      resourceRemaining: tpl.farmFoodTotal ?? tpl.resourceAmount ?? 0,
    };
  }

  computeMaxHp(templateId: string, owner: number): number {
    const tpl = TEMPLATES[templateId];
    let hp = tpl.maxHp;
    const player = owner > 0 ? this.players.get(owner) : undefined;
    if (player && tpl.kind === 'building') {
      const civ = CIVS[player.civ];
      let mult = 1 + civ.buildingHpBonusPct;
      if (player.researchedTechs.has('tech_architecture')) mult += 0.25;
      if (player.researchedTechs.has('phase_city')) mult += 0.15;
      if (player.researchedTechs.has('phase_empire')) mult += 0.2;
      if (player.researchedTechs.has('tech_rome_corvus')) mult += 0.3;
      if (player.researchedTechs.has('tech_ptol_nile')) mult += 0.2;
      if (player.researchedTechs.has('tech_kush_pyramids')) mult += 0.3;
      if (player.researchedTechs.has('tech_mace_siege')) mult += 0.2;
      if (player.researchedTechs.has('tech_sele_colony')) mult += 0.25;
      hp = Math.round(hp * mult);
    } else if (player && tpl.kind === 'unit' && tpl.isNaval) {
      let mult = player.civ === 'carthaginians' || player.civ === 'athenians' ? 1.15 : 1.0;
      if (player.researchedTechs.has('tech_naval_hull')) mult += 0.3;
      if (player.researchedTechs.has('tech_carth_colonization')) mult += 0.3;
      hp = Math.round(hp * mult);
    } else if (player && tpl.kind === 'unit' && !tpl.isWoman && !tpl.isSiege) {
      let mult = 1.0;
      if (player.researchedTechs.has('tech_athen_phalanx')) mult += 0.25;
      if (player.researchedTechs.has('tech_rome_marian')) mult += 0.2;
      if (player.researchedTechs.has('tech_spart_agoge')) mult += 0.25;
      if (player.researchedTechs.has('tech_ptol_pharos')) mult += 0.25;
      if (player.researchedTechs.has('tech_han_crossbow')) mult += 0.2;
      if (player.researchedTechs.has('tech_brit_warfare')) mult += 0.2;
      if (player.researchedTechs.has('tech_gaul_smithing')) mult += 0.2;
      if (player.researchedTechs.has('tech_kush_monumental')) mult += 0.25;
      if (player.researchedTechs.has('tech_mace_sarissa')) mult += 0.2;
      if (player.researchedTechs.has('tech_maur_elephants')) mult += 0.3;
      if (player.researchedTechs.has('phase_empire')) mult += 0.15;
      hp = Math.round(hp * mult);
    } else if (player && tpl.kind === 'unit' && tpl.isSiege) {
      let mult = 1.0;
      if (player.researchedTechs.has('tech_kush_monumental')) mult += 0.25;
      if (player.researchedTechs.has('tech_maur_elephants')) mult += 0.3;
      hp = Math.round(hp * mult);
    }
    return hp;
  }

  computeCaptureMax(templateId: string, owner: number): number {
    const tpl = TEMPLATES[templateId];
    let cap = tpl.capturePointsMax ?? 0;
    if (cap > 0 && owner > 0) {
      const player = this.players.get(owner);
      let mult = 1.0;
      if (player?.researchedTechs.has('tech_architecture')) mult += 0.25;
      if (player?.researchedTechs.has('tech_rome_corvus')) mult += 0.3;
      if (mult > 1.0) cap = Math.round(cap * mult);
    }
    return cap;
  }

  getUnitMaxHp(entity: Entity): number {
    const baseHp = this.computeMaxHp(entity.templateId, entity.owner);
    const rankMult = entity.rank === 1 ? 1.0 : entity.rank === 2 ? 1.15 : 1.35;
    return Math.round(baseHp * rankMult);
  }

  getEntityArmor(entity: Entity): ArmorProfile {
    const tpl = TEMPLATES[entity.templateId];
    const armor: ArmorProfile = { ...tpl.armor };
    const player = this.players.get(entity.owner);
    if (player && tpl.kind === 'unit') {
      const civ = CIVS[player.civ];
      if (!tpl.isWoman && !tpl.isCavalry) {
        armor.hack += civ.infantryArmorBonus.hack ?? 0;
        armor.pierce += civ.infantryArmorBonus.pierce ?? 0;
        armor.crush += civ.infantryArmorBonus.crush ?? 0;
      }
      if (player.researchedTechs.has('tech_bronze_shields')) {
        armor.hack += 2;
        armor.pierce += 2;
      }
      if (player.researchedTechs.has('tech_heavy_armor')) {
        armor.hack += 3;
        armor.pierce += 3;
      }
      if (player.researchedTechs.has('tech_athen_phalanx')) {
        armor.hack += 2;
      }
      if (
        player.researchedTechs.has('tech_spart_shieldwall') ||
        player.researchedTechs.has('tech_kush_monumental') ||
        player.researchedTechs.has('tech_maur_elephants')
      ) {
        armor.hack += 3;
        armor.pierce += 3;
      }
      if (player.researchedTechs.has('tech_gaul_smithing')) {
        armor.hack += 3;
        armor.pierce += 2;
      }
      if (player.researchedTechs.has('tech_iber_metallurgy') || player.researchedTechs.has('tech_sele_cataphract')) {
        armor.hack += 2;
        armor.pierce += 2;
      }
      if (player.skillActiveTimer > 0) {
        if (player.civ === 'athenians' || player.civ === 'kushites' || player.civ === 'mauryas') {
          armor.hack += 4;
          armor.pierce += 4;
        } else if (player.civ === 'romans') {
          armor.pierce += 5;
        } else if (player.civ === 'seleucids') {
          armor.hack += 3;
          armor.pierce += 3;
        }
      }
      if (entity.rank >= 2) {
        armor.hack += entity.rank - 1;
        armor.pierce += entity.rank - 1;
      }
    }
    return armor;
  }

  spawnUnit(templateId: string, owner: number, x: number, z: number): Entity | null {
    const tpl = TEMPLATES[templateId];
    if (!tpl || tpl.kind !== 'unit') return null;
    const clampedX = Math.max(4, Math.min(this.terrain.worldSize - 4, x));
    const clampedZ = Math.max(4, Math.min(this.terrain.worldSize - 4, z));
    const entity = this.createBaseEntity(templateId, owner, clampedX, clampedZ);
    this.entities.set(entity.id, entity);
    this.recomputePopulations();
    return entity;
  }

  spawnResource(templateId: string, x: number, z: number): Entity | null {
    const tpl = TEMPLATES[templateId];
    if (!tpl || tpl.kind !== 'resource') return null;
    const clampedX = Math.max(4, Math.min(this.terrain.worldSize - 4, x));
    const clampedZ = Math.max(4, Math.min(this.terrain.worldSize - 4, z));
    const entity = this.createBaseEntity(templateId, 0, clampedX, clampedZ);
    entity.guardX = clampedX;
    entity.guardZ = clampedZ;
    this.entities.set(entity.id, entity);
    return entity;
  }

  spawnBuilding(
    templateId: string,
    owner: number,
    tileX: number,
    tileZ: number,
    asFoundation: boolean,
    facing?: number
  ): Entity | null {
    const tpl = TEMPLATES[templateId];
    if (!tpl || tpl.kind !== 'building') return null;
    const size = tpl.footprintTiles ?? 2;
    const center = this.terrain.tileToWorldCenter(tileX, tileZ);
    const entity = this.createBaseEntity(templateId, owner, center.x, center.z);
    entity.tileX = tileX;
    entity.tileZ = tileZ;
    entity.isFoundation = asFoundation;
    entity.buildProgress = asFoundation ? 0.08 : 1.0;
    entity.hp = asFoundation ? Math.max(25, Math.round(entity.maxHp * 0.1)) : entity.maxHp;
    if (tpl.isDock) {
      const coastal = this.terrain.getCoastalDockInfo(tileX, tileZ);
      entity.facing = coastal.waterAngle;
      entity.rallyX = Math.max(4, Math.min(this.terrain.worldSize - 4, center.x + Math.sin(coastal.waterAngle) * 7.5));
      entity.rallyZ = Math.max(4, Math.min(this.terrain.worldSize - 4, center.z + Math.cos(coastal.waterAngle) * 7.5));
    } else {
      if (typeof facing === 'number') {
        entity.facing = facing;
      }
      entity.rallyX = center.x;
      entity.rallyZ = center.z + tpl.radius + 3.5;
    }

    if (!tpl.isFarmField && !tpl.isDock && !tpl.isGate && !tpl.isBridge) {
      this.navGrid.setFootprint(tileX, tileZ, size, true);
    }
    if (tpl.isGate) {
      entity.gateMode = 'auto';
      entity.gateOpenAmount = 0;
      if (!asFoundation) {
        this.syncGateNavTiles(entity, true);
      }
    }
    if (tpl.isBeaconTower) {
      entity.beaconLevel = 1;
      entity.beaconLitTimer = 0;
    }
    if (tpl.isBridge && !asFoundation) {
      this.terrain.setBridgeTile(tileX, tileZ, true);
    }

    this.entities.set(entity.id, entity);
    if (!asFoundation) {
      if (tpl.isTunnel) this.linkTunnelPortal(entity);
      this.territoryDirty = true;
      this.recomputePopulations();
    }
    return entity;
  }

  canPlaceBuilding(playerId: number, templateId: string, tileX: number, tileZ: number): { ok: boolean; reason?: string } {
    const player = this.players.get(playerId);
    const tpl = TEMPLATES[templateId];
    if (!player || !tpl || tpl.kind !== 'building') return { ok: false, reason: 'Invalid building' };
    if (tpl.civ && tpl.civ !== player.civ) {
      return { ok: false, reason: 'Unique to another civilization' };
    }
    if (CIVS[player.civ].blockedBuildings?.includes(templateId)) {
      return { ok: false, reason: 'This civilization cannot construct this structure' };
    }
    if ((tpl.phaseRequired ?? 1) > player.phase) {
      return { ok: false, reason: `Requires Phase ${tpl.phaseRequired}` };
    }
    if (tpl.requiresTech && !player.researchedTechs.has(tpl.requiresTech)) {
      return { ok: false, reason: `Requires ${TECHS[tpl.requiresTech]?.name ?? tpl.requiresTech}` };
    }
    if (tpl.cost && !this.canAfford(player.resources, tpl.cost)) {
      return { ok: false, reason: 'Not enough resources' };
    }

    const size = tpl.footprintTiles ?? 2;
    const center = this.terrain.tileToWorldCenter(tileX, tileZ);
    if (tpl.isDock) {
      const coastal = this.terrain.getCoastalDockInfo(tileX, tileZ);
      if (!coastal.ok) {
        return { ok: false, reason: 'Dock must be placed on a coastal shoreline' };
      }
    } else if (tpl.isBridge) {
      if (tileX < 4 || tileZ < 4 || tileX >= this.terrain.width - 4 || tileZ >= this.terrain.height - 4) {
        return { ok: false, reason: 'Bridge must be placed inside map bounds' };
      }
      const centerH = this.terrain.getHeightAt(center.x, center.z);
      const isWaterTile = !this.terrain.isTileDryLand(tileX, tileZ) || centerH <= WATER_LEVEL + 0.35;
      if (!isWaterTile) {
        return { ok: false, reason: 'Bridge must be placed on water adjacent to land or another bridge' };
      }
      // Must connect to nearby dry land or another bridge segment (completed or foundation)
      let anchored = false;
      for (let dz = -2; dz <= 2 && !anchored; dz++) {
        for (let dx = -2; dx <= 2; dx++) {
          if (dx === 0 && dz === 0) continue;
          const nx = tileX + dx;
          const nz = tileZ + dz;
          if (Math.hypot(dx, dz) <= 2.35 && (this.terrain.isTileDryLand(nx, nz) || this.terrain.isTileBridge(nx, nz))) {
            anchored = true;
            break;
          }
        }
      }
      if (!anchored) {
        for (const e of this.entities.values()) {
          if (e.alive && TEMPLATES[e.templateId].isBridge && Math.hypot(e.tileX - tileX, e.tileZ - tileZ) <= 2.35) {
            anchored = true;
            break;
          }
        }
      }
      if (!anchored) {
        return { ok: false, reason: 'Bridge must be placed on water adjacent to land or another bridge' };
      }
    } else if (tpl.isTunnel) {
      // Tunnel portals can be carved into dry flat ground OR steep mountain foothills!
      if (tileX < 4 || tileZ < 4 || tileX >= this.terrain.width - 4 || tileZ >= this.terrain.height - 4) {
        return { ok: false, reason: 'Blocked terrain or too steep' };
      }
      const h = this.terrain.getHeightAt(center.x, center.z);
      if (h <= WATER_LEVEL + 0.25 || this.terrain.getTileSlope(tileX, tileZ) > 2.3) {
        return { ok: false, reason: 'Blocked terrain or too steep' };
      }
      // Ensure at least one walkable entrance tile right next to the tunnel mouth
      const hasApproach = this.navGrid.findNearestWalkable(tileX, tileZ, 3, tileX, tileZ) !== null;
      if (!hasApproach) {
        return { ok: false, reason: 'Blocked terrain or too steep' };
      }
    } else if (tpl.isWall || tpl.isGate) {
      // Stone Walls & Gates can be built along ANY direction, up steep mountain ridges, AND right up to the outermost edge tile of the map!
      if (tileX < 0 || tileZ < 0 || tileX >= this.terrain.width || tileZ >= this.terrain.height) {
        return { ok: false, reason: 'Blocked terrain or too steep' };
      }
      const h = this.terrain.getHeightAt(center.x, center.z);
      if (h <= WATER_LEVEL + 0.05 || this.terrain.getTileSlope(tileX, tileZ) > 2.85) {
        return { ok: false, reason: 'Blocked terrain or too steep' };
      }
    } else if (!this.navGrid.canPlaceFootprint(tileX, tileZ, size)) {
      return { ok: false, reason: 'Blocked terrain or too steep' };
    }

    // Check overlap with existing resources or buildings (walls/gates/bridges snap tightly side-by-side)
    for (const e of this.entities.values()) {
      if (!e.alive) continue;
      const eTpl = TEMPLATES[e.templateId];
      if (eTpl.kind === 'unit') continue;
      if ((tpl.isWall && eTpl.isWall) || (tpl.isBridge && eTpl.isBridge)) {
        const minTileSpan = ((tpl.footprintTiles ?? 1) + (eTpl.footprintTiles ?? 1)) * 0.5;
        if (Math.abs(e.tileX - tileX) < minTileSpan && Math.abs(e.tileZ - tileZ) < minTileSpan) {
          return { ok: false, reason: 'Too close to another wall or bridge' };
        }
        continue;
      }
      const minD = tpl.radius + eTpl.radius - (tpl.isWall || eTpl.isWall || tpl.isBridge || eTpl.isBridge ? 0.45 : 0.15);
      const dx = e.x - center.x;
      const dz = e.z - center.z;
      if (dx * dx + dz * dz < minD * minD) {
        return { ok: false, reason: 'Too close to another structure or resource' };
      }
    }

    // Territory check (refresh territory immediately if live terraforming/leveling changed passable ground!)
    if (this.lastTerrainVersion !== this.terrain.version) {
      this.lastTerrainVersion = this.terrain.version;
      this.recomputeTerritory();
    }
    const terrOwner = this.territory.getOwnerAtTile(tileX, tileZ);
    if (tpl.mustBeInTerritory && terrOwner !== playerId) {
      return { ok: false, reason: 'Must be placed inside your territory' };
    }
    if (!tpl.mustBeInTerritory && terrOwner !== 0 && !this.isAlliedOrOwn(playerId, terrOwner)) {
      return { ok: false, reason: 'Cannot build inside enemy territory' };
    }

    // Civic Center minimum spacing from other Civic Centers
    if (tpl.isCivicCenter) {
      for (const e of this.entities.values()) {
        if (!e.alive || !TEMPLATES[e.templateId].isCivicCenter) continue;
        if (Math.hypot(e.x - center.x, e.z - center.z) < 42) {
          return { ok: false, reason: 'Too close to another Civic Center' };
        }
      }
    }

    return { ok: true };
  }

  canAfford(bag: ResourceBag, cost: ResourceBag): boolean {
    return (
      bag.food >= cost.food &&
      bag.wood >= cost.wood &&
      bag.stone >= cost.stone &&
      bag.metal >= cost.metal
    );
  }

  private spend(bag: ResourceBag, cost: ResourceBag): void {
    bag.food -= cost.food;
    bag.wood -= cost.wood;
    bag.stone -= cost.stone;
    bag.metal -= cost.metal;
  }

  private refund(bag: ResourceBag, cost: ResourceBag, ratio = 1.0): void {
    bag.food += Math.round(cost.food * ratio);
    bag.wood += Math.round(cost.wood * ratio);
    bag.stone += Math.round(cost.stone * ratio);
    bag.metal += Math.round(cost.metal * ratio);
  }

  enqueueCommand(cmd: GameCommand): void {
    this.pendingCommands.push(cmd);
  }

  drainEvents(): SimEvent[] {
    if (this.events.length === 0) return [];
    const copy = this.events.slice();
    this.events.length = 0;
    return copy;
  }

  step(): void {
    if (this.winnerId !== null) return;

    this.tickCount++;
    this.time = this.tickCount * SIM_DT;

    // Tick down civilization active skill timers & cooldowns
    for (const p of this.players.values()) {
      if (p.skillCooldown > 0) p.skillCooldown = Math.max(0, p.skillCooldown - SIM_DT);
      if (p.skillActiveTimer > 0) p.skillActiveTimer = Math.max(0, p.skillActiveTimer - SIM_DT);
    }

    // Snapshot previous positions for smooth render interpolation
    for (const e of this.entities.values()) {
      e.prevX = e.x;
      e.prevZ = e.z;
    }

    this.processCommands();
    this.rebuildSpatialHash();

    this.updateProduction();
    this.updateUnits();
    this.updateWildlife();
    this.updateBuildings();
    this.updateProjectiles();
    this.cleanupDead();

    if (this.lastTerrainVersion !== this.terrain.version) {
      this.lastTerrainVersion = this.terrain.version;
      this.territoryDirty = true;
    }

    if (this.territoryDirty) {
      this.recomputeTerritory();
    }

    // Update Fog of War every 4 ticks (5 Hz) including 0 A.D. Shared Allied Vision!
    if (this.tickCount % 4 === 0) {
      this.fog.update(this.entities.values(), this.getSharedAllyMap());
    }

    // Check victory every 10 ticks
    if (this.tickCount % 10 === 0) {
      this.checkVictory();
    }
  }

  private rebuildSpatialHash(): void {
    this.spatialHash.clear();
    for (const e of this.entities.values()) {
      if (e.alive && e.garrisonedIn === null && !TEMPLATES[e.templateId].isFlying) {
        this.spatialHash.insert(e);
      }
    }
  }

  private processCommands(): void {
    if (this.pendingCommands.length === 0) return;
    const cmds = this.pendingCommands;
    this.pendingCommands = [];

    for (const cmd of cmds) {
      // Any direct action command cancels a newly spawned worker's 10s idle wait countdown immediately
      if (
        'entityIds' in cmd &&
        cmd.type !== 'set_stance' &&
        cmd.type !== 'demolish' &&
        cmd.type !== 'delete'
      ) {
        for (const id of cmd.entityIds) {
          const ent = this.entities.get(id);
          if (ent && ent.owner === cmd.playerId) {
            if (ent.autoWorkDelay && ent.autoWorkDelay > 0) {
              ent.autoWorkDelay = 0;
            }
            // If reassigning a worker who is currently deep inside a tunnel excavation shaft, pop them safely back to the portal mouth!
            if (ent.order.type === 'build' && ent.order.inShaft) {
              const portal = this.entities.get(ent.order.targetId);
              if (portal) {
                const safe = this.navGrid.findNearestWalkable(portal.tileX, portal.tileZ, 4, portal.tileX, portal.tileZ, ent.owner);
                const pos = safe ? this.terrain.tileToWorldCenter(safe.tx, safe.tz) : { x: portal.x, z: portal.z };
                ent.x = pos.x;
                ent.z = pos.z;
                ent.prevX = pos.x;
                ent.prevZ = pos.z;
              }
            }
          }
        }
      }
      switch (cmd.type) {
        case 'move':
          this.handleMoveCommand(cmd);
          break;
        case 'attack':
          this.handleAttackCommand(cmd);
          break;
        case 'gather':
          this.handleGatherCommand(cmd);
          break;
        case 'build':
          this.handleBuildCommand(cmd);
          break;
        case 'build_tunnel':
          this.handleBuildTunnelCommand(cmd);
          break;
        case 'terraform':
          this.handleTerraformCommand(cmd);
          break;
        case 'cancel_terraform':
          this.handleCancelTerraformCommand(cmd);
          break;
        case 'demolish':
          this.handleDemolishCommand(cmd);
          break;
        case 'use_tunnel':
          this.handleUseTunnelCommand(cmd);
          break;
        case 'trade':
          this.handleTradeCommand(cmd);
          break;
        case 'upgrade_building':
          this.handleUpgradeBuildingCommand(cmd);
          break;
        case 'set_gate_mode':
          this.handleSetGateModeCommand(cmd);
          break;
        case 'ignite_beacon':
          this.handleIgniteBeaconCommand(cmd);
          break;
        case 'extinguish_beacon':
          this.handleExtinguishBeaconCommand(cmd);
          break;
        case 'repair':
          this.handleRepairCommand(cmd);
          break;
        case 'train':
          this.handleTrainCommand(cmd);
          break;
        case 'cancel_train':
          this.handleCancelTrainCommand(cmd);
          break;
        case 'research':
          this.handleResearchCommand(cmd);
          break;
        case 'set_rally':
          this.handleSetRallyCommand(cmd);
          break;
        case 'set_stance':
          this.handleSetStanceCommand(cmd);
          break;
        case 'garrison':
          this.handleGarrisonCommand(cmd);
          break;
        case 'ungarrison':
          this.handleUngarrisonCommand(cmd);
          break;
        case 'ungarrison_one':
          this.handleUngarrisonOneCommand(cmd);
          break;
        case 'set_diplomacy':
          this.handleSetDiplomacyCommand(cmd);
          break;
        case 'send_tribute':
          this.handleSendTributeCommand(cmd);
          break;
        case 'activate_skill':
          this.handleActivateSkillCommand(cmd);
          break;
        case 'cheat':
          this.handleCheatCommand(cmd);
          break;
        case 'delete':
          this.handleDeleteCommand(cmd);
          break;
      }
    }
  }

  private handleMoveCommand(cmd: Extract<GameCommand, { type: 'move' }>): void {
    const units = cmd.entityIds
      .map((id) => this.entities.get(id))
      .filter((e): e is Entity => !!e && e.alive && e.owner === cmd.playerId && TEMPLATES[e.templateId].kind === 'unit' && e.garrisonedIn === null);

    if (units.length === 0) return;

    // Spread multiple units into a clean formation grid around destination
    const cols = Math.ceil(Math.sqrt(units.length));
    const spacing = 1.65;
    const halfCols = (cols - 1) * 0.5;
    const rows = Math.ceil(units.length / cols);
    const halfRows = (rows - 1) * 0.5;

    units.forEach((u, idx) => {
      const uTpl = TEMPLATES[u.templateId];
      const isNaval = Boolean(uTpl.isNaval);
      const col = idx % cols;
      const row = Math.floor(idx / cols);
      let tx = Math.max(4, Math.min(this.terrain.worldSize - 4, cmd.x + (col - halfCols) * spacing));
      let tz = Math.max(4, Math.min(this.terrain.worldSize - 4, cmd.z + (row - halfRows) * spacing));
      // Snap unreachable mountain-peak / water clicks onto the nearest valid tile for land vs naval units
      const rawTile = this.terrain.worldToTile(tx, tz);
      const valid = isNaval
        ? this.navGrid.isWaterPassable(rawTile.tx, rawTile.tz)
        : this.navGrid.isWalkable(rawTile.tx, rawTile.tz);
      if (!valid) {
        const uTile = this.terrain.worldToTile(u.x, u.z);
        const clamped = isNaval
          ? this.navGrid.findNearestWater(rawTile.tx, rawTile.tz, 24, uTile.tx, uTile.tz)
          : this.navGrid.findNearestWalkable(rawTile.tx, rawTile.tz, 16, uTile.tx, uTile.tz);
        if (clamped) {
          const wPos = this.terrain.tileToWorldCenter(clamped.tx, clamped.tz);
          tx = wPos.x;
          tz = wPos.z;
        }
      }
      const order: UnitOrder = { type: 'move', x: tx, z: tz, attackMove: cmd.attackMove };

      if (cmd.queued && u.order.type !== 'idle') {
        u.queuedOrders.push(order);
      } else {
        u.order = order;
        u.queuedOrders.length = 0;
        u.guardX = tx;
        u.guardZ = tz;
        u.path = isNaval
          ? this.navGrid.findWaterPath(u.x, u.z, tx, tz)
          : this.navGrid.findPath(u.x, u.z, tx, tz, 4500, false, u.owner);
        u.pathIndex = 0;
        u.repathTimer = 1.2;
        this.stuckTicks.set(u.id, 0);
      }
    });
  }

  static readonly SHORE_FISH_REACH_METERS = 7.2;

  /** Finds the nearest walkable dry shoreline stand position within rod/cast-net reach of a water fish shoal (returns null for deep-sea fish!) */
  getShoreFishingStandPos(fish: Entity, fromX?: number, fromZ?: number): { x: number; z: number } | null {
    const fTile = this.terrain.worldToTile(fish.x, fish.z);
    const maxTileR = 3;
    const prefX = fromX ?? fish.x;
    const prefZ = fromZ ?? fish.z;
    let best: { x: number; z: number } | null = null;
    let bestScore = Infinity;

    for (let dz = -maxTileR; dz <= maxTileR; dz++) {
      for (let dx = -maxTileR; dx <= maxTileR; dx++) {
        const nx = fTile.tx + dx;
        const nz = fTile.tz + dz;
        if (!this.navGrid.isWalkable(nx, nz)) continue;
        const wc = this.terrain.tileToWorldCenter(nx, nz);
        const distToFish = Math.hypot(wc.x - fish.x, wc.z - fish.z);
        if (distToFish > World.SHORE_FISH_REACH_METERS) continue;
        // Prefer closest shoreline tile to the fish (and tie-break by closeness to the worker)
        const score = distToFish + Math.hypot(wc.x - prefX, wc.z - prefZ) * 0.12;
        if (score < bestScore) {
          bestScore = score;
          best = wc;
        }
      }
    }
    return best;
  }

  /** Returns true ONLY if a fish shoal is close enough to dry walkable land for rod / cast-net shore fishing */
  canLandWorkerFish(fish: Entity): boolean {
    if (!fish.alive || fish.resourceRemaining <= 0) return false;
    const tpl = TEMPLATES[fish.templateId];
    if (!tpl?.isAquatic) return false;
    if (tpl.isSeaMonster && fish.hp > 0) return false;
    return this.getShoreFishingStandPos(fish) !== null;
  }

  /** Finds the nearest shore-reachable fish shoal for land workers clicking the "Fish / Net" button */
  findNearestShoreFish(x: number, z: number, maxRange = 95): Entity | null {
    let best: Entity | null = null;
    let bestD = maxRange;
    for (const e of this.entities.values()) {
      if (!e.alive || e.templateId !== 'fish_shoal' || e.resourceRemaining <= 0) continue;
      const d = Math.hypot(e.x - x, e.z - z);
      if (d < bestD && this.canLandWorkerFish(e)) {
        bestD = d;
        best = e;
      }
    }
    return best;
  }

  private handleAttackCommand(cmd: Extract<GameCommand, { type: 'attack' }>): void {
    const target = this.entities.get(cmd.targetId);
    if (!target || !target.alive || target.owner === cmd.playerId) return;
    // Peaceful mode: armies cannot attack another civilization's units or buildings!
    if (!this.areHostile(cmd.playerId, target.owner)) return;
    const tTpl = TEMPLATES[target.templateId];
    // Allow attacking ANY live non-flying Gaia animal (docile prey, fierce predators, AND sea/lake monsters!), while ignoring trees/mines
    const isAttackableAnimal =
      !tTpl.isFlying &&
      (Boolean(tTpl.isPredator) ||
        Boolean(tTpl.isPassiveFauna) ||
        Boolean(tTpl.isSeaMonster) ||
        target.templateId === 'deer_herd' ||
        target.templateId === 'wild_boar' ||
        target.templateId === 'wild_gazelle' ||
        target.templateId === 'wild_elephant');
    if (target.owner === 0 && (!isAttackableAnimal || target.hp <= 0)) return;
    const mode: BuildingOrderMode = cmd.mode ?? (tTpl.kind === 'building' ? 'capture' : 'attack');

    for (const id of cmd.entityIds) {
      const u = this.entities.get(id);
      if (!u || !u.alive || u.owner !== cmd.playerId || u.garrisonedIn !== null) continue;
      const uTpl = TEMPLATES[u.templateId];
      if (uTpl.kind !== 'unit' || !uTpl.attack) continue;
      u.order = { type: 'attack', targetId: target.id, mode: uTpl.isNaval ? 'attack' : mode };
      u.queuedOrders.length = 0;
      u.path = uTpl.isNaval
        ? this.navGrid.findWaterPath(u.x, u.z, target.x, target.z)
        : this.navGrid.findPath(u.x, u.z, target.x, target.z, 4500, false, u.owner);
      u.pathIndex = 0;
      u.repathTimer = 0.6;
    }
  }

  private handleGatherCommand(cmd: Extract<GameCommand, { type: 'gather' }>): void {
    const target = this.entities.get(cmd.targetId);
    if (!target || !target.alive) return;
    const tTpl = TEMPLATES[target.templateId];
    const resType = tTpl.resourceType;
    if (!resType || target.resourceRemaining <= 0) return;
    if (tTpl.isFarmField && (target.owner !== cmd.playerId || target.isFoundation)) return;

    for (const id of cmd.entityIds) {
      const u = this.entities.get(id);
      if (!u || !u.alive || u.owner !== cmd.playerId || u.garrisonedIn !== null) continue;
      const uTpl = TEMPLATES[u.templateId];
      if (!uTpl.gather) continue;
      const uNaval = Boolean(uTpl.isNaval);
      const tAquatic = Boolean(tTpl.isAquatic);

      // Naval boats can only gather aquatic resources; land workers can ONLY fish aquatic fish shoals near the water's edge!
      let goalX = target.x;
      let goalZ = target.z;
      if (uNaval && !tAquatic) continue;
      if (!uNaval && tAquatic) {
        const stand = this.canLandWorkerFish(target) ? this.getShoreFishingStandPos(target, u.x, u.z) : null;
        if (!stand) continue; // Too far in deep sea — land rod/net fishing only reaches shoreline fish!
        goalX = stand.x;
        goalZ = stand.z;
      }

      // Drop carried resource if switching types
      if (u.carryType && u.carryType !== resType) {
        u.carryAmount = 0;
        u.carryType = null;
      }

      u.order = { type: 'gather', targetId: target.id, resourceType: resType, returning: false };
      u.queuedOrders.length = 0;
      u.path = uNaval
        ? this.navGrid.findWaterPath(u.x, u.z, goalX, goalZ)
        : this.navGrid.findPath(u.x, u.z, goalX, goalZ, 4500, false, u.owner);
      u.pathIndex = 0;
      u.repathTimer = 1.0;
    }
  }

  private handleBuildCommand(cmd: Extract<GameCommand, { type: 'build' }>): void {
    const check = this.canPlaceBuilding(cmd.playerId, cmd.templateId, cmd.tileX, cmd.tileZ);
    if (!check.ok) return;

    const player = this.players.get(cmd.playerId)!;
    const tpl = TEMPLATES[cmd.templateId];
    if (tpl.cost) {
      this.spend(player.resources, tpl.cost);
    }

    const foundation = this.spawnBuilding(cmd.templateId, cmd.playerId, cmd.tileX, cmd.tileZ, true, cmd.facing);
    if (!foundation) return;

    for (const id of cmd.entityIds) {
      const u = this.entities.get(id);
      if (!u || !u.alive || u.owner !== cmd.playerId || u.garrisonedIn !== null) continue;
      const uTpl = TEMPLATES[u.templateId];
      if (!uTpl.gather || !uTpl.canBuild?.includes(cmd.templateId)) continue;
      if ((tpl.isWall || tpl.isBridge) && u.order.type === 'build') {
        const curTarget = this.entities.get(u.order.targetId);
        if (
          curTarget &&
          curTarget.alive &&
          curTarget.isFoundation &&
          (TEMPLATES[curTarget.templateId].isWall || TEMPLATES[curTarget.templateId].isBridge)
        ) {
          u.queuedOrders.push({ type: 'build', targetId: foundation.id });
          continue;
        }
      }
      u.order = { type: 'build', targetId: foundation.id };
      u.queuedOrders.length = 0;
      const bPos = tpl.isBridge
        ? this.getTerraformApproachPos(u, cmd.tileX, cmd.tileZ, { x: foundation.x, z: foundation.z })
        : { x: foundation.x, z: foundation.z };
      u.path = this.navGrid.findPath(u.x, u.z, bPos.x, bPos.z);
      u.pathIndex = 0;
      u.repathTimer = 1.0;
    }
  }

  /**
   * Builds a dragged straight-line Mountain Tunnel from entrance (startTile) to exit (endTile).
   * Every tile of tunnel length requires 100 soil units to excavate (long, realistic boring project!).
   */
  private handleBuildTunnelCommand(cmd: Extract<GameCommand, { type: 'build_tunnel' }>): void {
    const lengthTiles = Math.round(Math.hypot(cmd.endTileX - cmd.startTileX, cmd.endTileZ - cmd.startTileZ));
    if (lengthTiles < 4) return;
    const checkStart = this.canPlaceBuilding(cmd.playerId, 'tunnel_portal', cmd.startTileX, cmd.startTileZ);
    const checkEnd = this.canPlaceBuilding(cmd.playerId, 'tunnel_portal', cmd.endTileX, cmd.endTileZ);
    if (!checkStart.ok || !checkEnd.ok) return;

    const player = this.players.get(cmd.playerId)!;
    const tpl = TEMPLATES.tunnel_portal;
    if (tpl.cost) {
      this.spend(player.resources, tpl.cost);
    }

    const startWorld = this.terrain.tileToWorldCenter(cmd.startTileX, cmd.startTileZ);
    const endWorld = this.terrain.tileToWorldCenter(cmd.endTileX, cmd.endTileZ);
    // Exact outward-facing doorway angles so both tunnel portals open straight along the tunnel centerline!
    const yawOut = Math.atan2(startWorld.x - endWorld.x, startWorld.z - endWorld.z);
    const yawBack = Math.atan2(endWorld.x - startWorld.x, endWorld.z - startWorld.z);
    const portalA = this.spawnBuilding('tunnel_portal', cmd.playerId, cmd.startTileX, cmd.startTileZ, true, yawOut);
    const portalB = this.spawnBuilding('tunnel_portal', cmd.playerId, cmd.endTileX, cmd.endTileZ, true, yawBack);
    if (!portalA || !portalB) return;

    const totalUnits = lengthTiles * SOIL_UNITS_PER_TILE;
    portalA.linkedTunnelId = portalB.id;
    portalB.linkedTunnelId = portalA.id;
    portalA.tunnelLengthTiles = lengthTiles;
    portalB.tunnelLengthTiles = lengthTiles;
    portalA.tunnelDugUnits = 0;
    portalB.tunnelDugUnits = 0;
    portalA.tunnelTotalUnits = totalUnits;
    portalB.tunnelTotalUnits = totalUnits;
    portalA.buildProgress = 0;
    portalB.buildProgress = 0;

    for (const id of cmd.entityIds) {
      const u = this.entities.get(id);
      if (!u || !u.alive || u.owner !== cmd.playerId || u.garrisonedIn !== null) continue;
      const uTpl = TEMPLATES[u.templateId];
      if (!uTpl.gather || !uTpl.canBuild?.includes('tunnel_portal')) continue;
      u.order = { type: 'build', targetId: portalA.id };
      u.queuedOrders.length = 0;
      const bPos = this.getTerraformApproachPos(u, cmd.startTileX, cmd.startTileZ, { x: portalA.x, z: portalA.z });
      u.path = this.navGrid.findPath(u.x, u.z, bPos.x, bPos.z);
      u.pathIndex = 0;
      u.repathTimer = 1.0;
    }
  }

  canTerraformTile(tileX: number, tileZ: number): boolean {
    if (tileX < 3 || tileZ < 3 || tileX > this.terrain.width - 4 || tileZ > this.terrain.height - 4) {
      return false;
    }
    const center = this.terrain.tileToWorldCenter(tileX, tileZ);
    for (const e of this.entities.values()) {
      if (!e.alive) continue;
      const tpl = TEMPLATES[e.templateId];
      if (tpl.kind !== 'building') continue;
      const minClearance = tpl.radius + 2.4;
      if (Math.hypot(e.x - center.x, e.z - center.z) < minClearance) {
        return false;
      }
    }
    return true;
  }

  /**
   * Finds a nearby valid earthwork partner tile ~3..5 tiles away so soil is always conserved:
   * - 'dump': nearest valid tile where excavated earth can be piled
   * - 'scoop': nearest valid dry/higher donor tile where earth can be scooped to push onto target
   */
  findEarthworkPartnerTile(tileX: number, tileZ: number, role: 'dump' | 'scoop'): { tx: number; tz: number } | null {
    let best: { tx: number; tz: number } | null = null;
    let bestScore = -Infinity;
    for (let r = 3; r <= 6; r++) {
      for (let a = 0; a < 12; a++) {
        const ang = (a / 12) * Math.PI * 2;
        const nx = Math.round(tileX + Math.cos(ang) * r);
        const nz = Math.round(tileZ + Math.sin(ang) * r);
        if (!this.canTerraformTile(nx, nz)) continue;
        const h = this.terrain.getVertexHeight(nx, nz);
        if (role === 'scoop' && h < WATER_LEVEL + 0.1) continue;
        // Prefer dry higher ground for scoop, and close unobstructed ground for dump
        const score = role === 'scoop' ? h * 2.0 - r * 0.55 : -r * 0.7 - Math.abs(h - 2.0) * 0.2;
        if (score > bestScore) {
          bestScore = score;
          best = { tx: nx, tz: nz };
        }
      }
      if (best) break;
    }
    return best;
  }

  /** Finds an active OR unfinished terraforming job near (tileX, tileZ) so any other worker can join or resume digging! */
  findActiveTerraformJobAt(
    playerId: number,
    tileX: number,
    tileZ: number
  ): { tileX: number; tileZ: number; destTileX: number; destTileZ: number; mode: TerraformMode } | null {
    for (const e of this.entities.values()) {
      if (!e.alive || e.owner !== playerId || e.order.type !== 'terraform') continue;
      const ord = e.order;
      if (
        (Math.abs(ord.tileX - tileX) <= 1 && Math.abs(ord.tileZ - tileZ) <= 1) ||
        (Math.abs(ord.destTileX - tileX) <= 1 && Math.abs(ord.destTileZ - tileZ) <= 1)
      ) {
        return {
          tileX: ord.tileX,
          tileZ: ord.tileZ,
          destTileX: ord.destTileX,
          destTileZ: ord.destTileZ,
          mode: ord.mode,
        };
      }
    }
    // Check 3x3 neighborhood for ANY unfinished excavation (<100 soil) or fill (>0 soil) so other workers can resume!
    for (let dz = -1; dz <= 1; dz++) {
      for (let dx = -1; dx <= 1; dx++) {
        const tx = tileX + dx;
        const tz = tileZ + dz;
        if (tx < 3 || tz < 3 || tx >= this.terrain.width - 3 || tz >= this.terrain.height - 3) continue;
        const idx = tz * this.terrain.width + tx;
        const dug = SOIL_UNITS_PER_TILE - this.terrain.getSoilUnits(tx, tz);
        const fill = this.terrain.getFillUnits(tx, tz);
        if (dug <= 0 && fill <= 0) {
          this.savedTerraformJobs.delete(idx);
          continue;
        }
        const saved = this.savedTerraformJobs.get(idx);
        if (saved) return saved;
        if (dug > 0) {
          const partner = this.findEarthworkPartnerTile(tx, tz, 'dump');
          if (partner) {
            return { tileX: tx, tileZ: tz, destTileX: partner.tx, destTileZ: partner.tz, mode: 'dig' };
          }
        }
        if (fill > 0) {
          const donor = this.findEarthworkPartnerTile(tx, tz, 'scoop');
          if (donor) {
            return { tileX: donor.tx, tileZ: donor.tz, destTileX: tx, destTileZ: tz, mode: 'raise' };
          }
        }
      }
    }
    return null;
  }

  private handleTerraformCommand(cmd: Extract<GameCommand, { type: 'terraform' }>): void {
    if (!this.canTerraformTile(cmd.tileX, cmd.tileZ)) return;

    // Conserve soil: every dig/push moves earth FROM (srcX, srcZ) TO (dstX, dstZ)!
    let srcX = cmd.tileX;
    let srcZ = cmd.tileZ;
    let dstX = cmd.destTileX;
    let dstZ = cmd.destTileZ;
    let mode = cmd.mode;

    if (mode === 'level') {
      // Level/grade uneven hillside directly in place so buildings can be built on it!
      dstX = srcX;
      dstZ = srcZ;
    } else if (mode === 'dig') {
      // If another friendly worker is already digging this tile, inherit their exact dump partner so everyone collaborates!
      if (dstX === undefined || dstZ === undefined) {
        const existing = this.findActiveTerraformJobAt(cmd.playerId, srcX, srcZ);
        if (existing && existing.tileX === srcX && existing.tileZ === srcZ && existing.mode === 'dig') {
          dstX = existing.destTileX;
          dstZ = existing.destTileZ;
        }
      }
      if (dstX === undefined || dstZ === undefined || !this.canTerraformTile(dstX, dstZ) || (dstX === srcX && dstZ === srcZ)) {
        const partner = this.findEarthworkPartnerTile(srcX, srcZ, 'dump');
        if (!partner) return;
        dstX = partner.tx;
        dstZ = partner.tz;
      }
    } else {
      // 'raise': push earth onto (cmd.tileX, cmd.tileZ) from an explicit donor or nearest higher bank
      dstX = cmd.tileX;
      dstZ = cmd.tileZ;
      if (cmd.destTileX !== undefined && cmd.destTileZ !== undefined && this.canTerraformTile(cmd.destTileX, cmd.destTileZ)) {
        srcX = cmd.destTileX;
        srcZ = cmd.destTileZ;
      } else {
        const existing = this.findActiveTerraformJobAt(cmd.playerId, dstX, dstZ);
        if (existing && existing.destTileX === dstX && existing.destTileZ === dstZ && existing.mode === 'raise') {
          srcX = existing.tileX;
          srcZ = existing.tileZ;
        } else {
          const donor = this.findEarthworkPartnerTile(dstX, dstZ, 'scoop');
          if (!donor) return;
          srcX = donor.tx;
          srcZ = donor.tz;
        }
      }
    }

    const epochTx = mode === 'raise' ? dstX! : srcX;
    const epochTz = mode === 'raise' ? dstZ! : srcZ;
    const startEpoch = this.terrain.getTerraformEpoch(epochTx, epochTz);
    const srcCenter = this.terrain.tileToWorldCenter(srcX, srcZ);
    // Remember this job so if workers leave midway, any other worker can click/right-click to resume it!
    const jobRecord = { tileX: srcX, tileZ: srcZ, destTileX: dstX!, destTileZ: dstZ!, mode };
    this.savedTerraformJobs.set(srcZ * this.terrain.width + srcX, jobRecord);
    if (mode === 'raise') {
      this.savedTerraformJobs.set(dstZ! * this.terrain.width + dstX!, jobRecord);
    }

    for (const id of cmd.entityIds) {
      const u = this.entities.get(id);
      if (!u || !u.alive || u.owner !== cmd.playerId || u.garrisonedIn !== null) continue;
      const uTpl = TEMPLATES[u.templateId];
      if (!uTpl.gather || uTpl.isNaval) continue;

      const order: UnitOrder = {
        type: 'terraform',
        tileX: srcX,
        tileZ: srcZ,
        destTileX: dstX!,
        destTileZ: dstZ!,
        mode,
        stage: 'scoop',
        progress: 0,
        startEpoch,
      };
      if (cmd.queued && u.order.type !== 'idle') {
        u.queuedOrders.push(order);
      } else {
        u.order = order;
        u.queuedOrders.length = 0;
        const approach = this.getTerraformApproachPos(u, srcX, srcZ, srcCenter);
        u.path = this.navGrid.findPath(u.x, u.z, approach.x, approach.z);
        u.pathIndex = 0;
        u.repathTimer = 1.0;
        this.stuckTicks.set(u.id, 0);
      }
    }
  }

  /**
   * Stops terraforming immediately for the given worker(s) and cancels their active excavation tile(s),
   * while PRESERVING the terrain at its exact final excavated elevation (never reverts!).
   */
  private handleCancelTerraformCommand(cmd: Extract<GameCommand, { type: 'cancel_terraform' }>): void {
    const cancelledTileKeys = new Set<number>();
    const w = this.terrain.width;

    for (const id of cmd.entityIds) {
      const u = this.entities.get(id);
      if (!u || !u.alive || u.owner !== cmd.playerId) continue;
      if (u.order.type === 'terraform') {
        const ord = u.order;
        cancelledTileKeys.add(ord.tileZ * w + ord.tileX);
        cancelledTileKeys.add(ord.destTileZ * w + ord.destTileX);
        this.terrain.cancelSoilWork(ord.tileX, ord.tileZ);
        this.terrain.cancelSoilWork(ord.destTileX, ord.destTileZ);
        this.savedTerraformJobs.delete(ord.tileZ * w + ord.tileX);
        this.savedTerraformJobs.delete(ord.destTileZ * w + ord.destTileX);
        u.order = { type: 'idle' };
        u.queuedOrders.length = 0;
        u.path = [];
        u.pathIndex = 0;
        u.carryType = null;
        u.carryAmount = 0;
      }
    }

    // Stop any other collaborating workers assigned to the same cancelled tile(s)
    if (cancelledTileKeys.size > 0) {
      for (const e of this.entities.values()) {
        if (!e.alive || e.owner !== cmd.playerId || e.order.type !== 'terraform') continue;
        const srcKey = e.order.tileZ * w + e.order.tileX;
        const dstKey = e.order.destTileZ * w + e.order.destTileX;
        if (cancelledTileKeys.has(srcKey) || cancelledTileKeys.has(dstKey)) {
          e.order = { type: 'idle' };
          e.path = [];
          e.pathIndex = 0;
          e.carryType = null;
          e.carryAmount = 0;
        }
      }
    }
  }

  /** Dismantle owned building(s) and salvage 60% of construction resources (75% for foundations) */
  private handleDemolishCommand(cmd: Extract<GameCommand, { type: 'demolish' }>): void {
    const player = this.players.get(cmd.playerId);
    if (!player) return;

    for (const id of cmd.entityIds) {
      const e = this.entities.get(id);
      if (!e || !e.alive || e.owner !== cmd.playerId) continue;
      const tpl = TEMPLATES[e.templateId];
      if (tpl.kind !== 'building') continue;

      const cost = tpl.cost ?? { food: 0, wood: 0, stone: 0, metal: 0 };
      const ratio = e.isFoundation ? 0.75 : 0.6 * Math.max(0.25, e.hp / Math.max(1, e.maxHp));
      const refund: ResourceBag = {
        food: Math.round(cost.food * ratio),
        wood: Math.round(cost.wood * ratio),
        stone: Math.round(cost.stone * ratio),
        metal: Math.round(cost.metal * ratio),
      };
      player.resources.food += refund.food;
      player.resources.wood += refund.wood;
      player.resources.stone += refund.stone;
      player.resources.metal += refund.metal;

      this.events.push({
        type: 'building_demolished',
        playerId: player.id,
        x: e.x,
        z: e.z,
        templateId: e.templateId,
        refund,
      });

      e.hp = 0;
      e.alive = false;
    }
  }

  /** Pairs two unlinked friendly Mountain Tunnel Portals into a bidirectional underground passage */
  private linkTunnelPortal(portal: Entity): void {
    if (!portal.alive || portal.isFoundation || portal.linkedTunnelId) return;
    for (const other of this.entities.values()) {
      if (
        other.id === portal.id ||
        !other.alive ||
        other.isFoundation ||
        other.owner !== portal.owner ||
        !TEMPLATES[other.templateId].isTunnel ||
        other.linkedTunnelId
      ) {
        continue;
      }
      portal.linkedTunnelId = other.id;
      other.linkedTunnelId = portal.id;
      return;
    }
  }

  private handleUseTunnelCommand(cmd: Extract<GameCommand, { type: 'use_tunnel' }>): void {
    const portal = this.entities.get(cmd.portalId);
    if (!portal || !portal.alive || portal.isFoundation || !this.isAlliedOrOwn(cmd.playerId, portal.owner) || !portal.linkedTunnelId) return;
    const exit = this.entities.get(portal.linkedTunnelId);
    if (!exit || !exit.alive || exit.isFoundation) return;

    for (const id of cmd.entityIds) {
      const u = this.entities.get(id);
      if (!u || !u.alive || u.owner !== cmd.playerId || u.garrisonedIn !== null) continue;
      const uTpl = TEMPLATES[u.templateId];
      if (uTpl.kind !== 'unit' || uTpl.isNaval) continue;
      u.order = { type: 'enter_tunnel', portalId: portal.id };
      u.queuedOrders.length = 0;
      const approach = this.getTerraformApproachPos(u, portal.tileX, portal.tileZ, { x: portal.x, z: portal.z });
      u.path = this.navGrid.findPath(u.x, u.z, approach.x, approach.z);
      u.pathIndex = 0;
      u.repathTimer = 1.0;
    }
  }

  /** Finds the farthest completed friendly OR allied partner Market to maximize Caravan gold revenue */
  findBestPartnerMarket(playerId: number, excludeMarketId: number): Entity | null {
    const exclude = this.entities.get(excludeMarketId);
    let best: Entity | null = null;
    let bestDist = -1;
    for (const e of this.entities.values()) {
      if (
        !e.alive ||
        !this.isAlliedOrOwn(playerId, e.owner) ||
        e.isFoundation ||
        e.id === excludeMarketId ||
        !TEMPLATES[e.templateId]?.isMarket
      ) {
        continue;
      }
      const d = (exclude ? Math.hypot(e.x - exclude.x, e.z - exclude.z) : 1) * (e.owner !== playerId ? 1.25 : 1.0);
      if (d > bestDist) {
        bestDist = d;
        best = e;
      }
    }
    return best;
  }

  /** Finds the two farthest completed friendly/allied Markets (at least one owned by playerId) for Caravan pairing */
  findFarthestMarketPair(playerId: number): [Entity, Entity] | null {
    const ownMarkets: Entity[] = [];
    const allMarkets: Entity[] = [];
    for (const e of this.entities.values()) {
      if (e.alive && !e.isFoundation && TEMPLATES[e.templateId]?.isMarket && this.isAlliedOrOwn(playerId, e.owner)) {
        allMarkets.push(e);
        if (e.owner === playerId) ownMarkets.push(e);
      }
    }
    if (ownMarkets.length === 0 || allMarkets.length < 2) return null;
    let bestPair: [Entity, Entity] | null = null;
    let bestD = -1;
    for (const mA of ownMarkets) {
      for (const mB of allMarkets) {
        if (mA.id === mB.id) continue;
        const d = Math.hypot(mA.x - mB.x, mA.z - mB.z) * (mB.owner !== playerId ? 1.25 : 1.0);
        if (d > bestD) {
          bestD = d;
          bestPair = [mA, mB];
        }
      }
    }
    return bestPair;
  }

  private handleTradeCommand(cmd: Extract<GameCommand, { type: 'trade' }>): void {
    const targetMarket = this.entities.get(cmd.targetMarketId);
    if (
      !targetMarket ||
      !targetMarket.alive ||
      targetMarket.isFoundation ||
      !this.isAlliedOrOwn(cmd.playerId, targetMarket.owner) ||
      !TEMPLATES[targetMarket.templateId]?.isMarket
    ) {
      return;
    }
    const homeMarket =
      (cmd.homeMarketId ? this.entities.get(cmd.homeMarketId) : null) ??
      this.findBestPartnerMarket(cmd.playerId, targetMarket.id);
    if (
      !homeMarket ||
      !homeMarket.alive ||
      homeMarket.isFoundation ||
      !this.isAlliedOrOwn(cmd.playerId, homeMarket.owner) ||
      homeMarket.id === targetMarket.id ||
      !TEMPLATES[homeMarket.templateId]?.isMarket
    ) {
      return;
    }

    for (const id of cmd.entityIds) {
      const u = this.entities.get(id);
      if (!u || !u.alive || u.owner !== cmd.playerId || u.garrisonedIn !== null) continue;
      if (!TEMPLATES[u.templateId]?.isTrader) continue;
      const distHome = Math.hypot(homeMarket.x - u.x, homeMarket.z - u.z);
      const distTarget = Math.hypot(targetMarket.x - u.x, targetMarket.z - u.z);
      const firstLeg: 'toTarget' | 'toHome' = distTarget >= distHome ? 'toTarget' : 'toHome';
      u.order = {
        type: 'trade',
        homeMarketId: homeMarket.id,
        targetMarketId: targetMarket.id,
        leg: firstLeg,
        cargoGold: 0,
      };
      u.queuedOrders.length = 0;
      u.path = [];
      u.pathIndex = 0;
      u.repathTimer = 0;
    }
  }

  static readonly UPGRADE_HOUSE_COST: ResourceBag = { food: 0, wood: 60, stone: 60, metal: 0 };
  static readonly UPGRADE_FLOOR3_COST: ResourceBag = { food: 0, wood: 90, stone: 100, metal: 0 };
  static readonly UPGRADE_HOUSE_TIME_SEC = 12;
  static readonly UPGRADE_FLOOR3_TIME_SEC = 16;

  static readonly UPGRADE_WALL_TO_GATE_COST: ResourceBag = { food: 0, wood: 40, stone: 40, metal: 0 };
  static readonly UPGRADE_WALL_TO_GATE_TIME_SEC = 10;
  static readonly CONVERT_GATE_TO_WALL_COST: ResourceBag = { food: 0, wood: 0, stone: 40, metal: 0 };
  static readonly CONVERT_GATE_TO_WALL_TIME_SEC = 8;

  static readonly UPGRADE_WALL_TO_BEACON_COST: ResourceBag = { food: 0, wood: 40, stone: 100, metal: 0 };
  static readonly UPGRADE_WALL_TO_BEACON_TIME_SEC = 10;
  static readonly UPGRADE_BEACON_LV2_COST: ResourceBag = { food: 0, wood: 60, stone: 140, metal: 20 };
  static readonly UPGRADE_BEACON_LV2_TIME_SEC = 12;
  static readonly UPGRADE_BEACON_LV3_COST: ResourceBag = { food: 0, wood: 90, stone: 200, metal: 50 };
  static readonly UPGRADE_BEACON_LV3_TIME_SEC = 16;

  static getBeaconStats(level: number): {
    relayRange: number;
    rallyRange: number;
    detectRange: number;
    attackRange: number;
    maxHp: number;
    maxGarrison: number;
  } {
    if (level >= 3) {
      return { relayRange: 90, rallyRange: 90, detectRange: 34, attackRange: 22, maxHp: 1650, maxGarrison: 12 };
    }
    if (level === 2) {
      return { relayRange: 58, rallyRange: 58, detectRange: 26, attackRange: 19, maxHp: 1250, maxGarrison: 8 };
    }
    return { relayRange: 34, rallyRange: 34, detectRange: 20, attackRange: 16, maxHp: 900, maxGarrison: 5 };
  }

  /** Dynamic garrison capacity (scales up with Beacon Tower level: Lv.1 = 5, Lv.2 = 8, Lv.3 = 12!) */
  getMaxGarrisonCapacity(building: Entity): number {
    const tpl = TEMPLATES[building.templateId];
    if (!tpl) return 0;
    if (tpl.isBeaconTower) {
      return World.getBeaconStats(building.beaconLevel ?? 1).maxGarrison;
    }
    return tpl.garrisonCapacity ?? 0;
  }

  /** Military units that count as soldiers for Great Wall Beacon Towers (garrisoning, lighting, auto-rally) */
  isMilitaryUnit(templateId: string): boolean {
    const tpl = TEMPLATES[templateId];
    if (!tpl || tpl.kind !== 'unit') return false;
    if (tpl.isWoman || templateId === 'male_citizen' || tpl.isTrader || tpl.isHealer || tpl.isNaval) return false;
    return Boolean(tpl.attack);
  }

  /** Returns all alive garrisoned military soldiers inside a Beacon Tower */
  getBeaconGarrisonSoldiers(beacon: Entity): Entity[] {
    const out: Entity[] = [];
    for (const uid of beacon.garrisonedIds) {
      const u = this.entities.get(uid);
      if (u && u.alive && this.isMilitaryUnit(u.templateId)) {
        out.push(u);
      }
    }
    return out;
  }

  /**
   * Finds the immediate previous & next aligned Stone Wall segments flanking an interior wall segment.
   * Returns `[prev, next]` ONLY if BOTH sides have a completed, non-upgrading Stone Wall (i.e. NOT an end segment!).
   */
  findGateUpgradeNeighbors(wall: Entity): [Entity, Entity] | null {
    if (
      !wall.alive ||
      wall.isFoundation ||
      wall.templateId !== 'stone_wall' ||
      wall.upgradeTargetTemplateId ||
      (wall.upgradeLinkedIds && wall.upgradeLinkedIds.length > 0)
    ) {
      return null;
    }

    const ax = Math.cos(wall.facing);
    const az = -Math.sin(wall.facing);
    let bestPrev: Entity | null = null;
    let bestPrevDist = Infinity;
    let bestNext: Entity | null = null;
    let bestNextDist = Infinity;

    for (const e of this.entities.values()) {
      if (
        e.id === wall.id ||
        !e.alive ||
        e.isFoundation ||
        e.owner !== wall.owner ||
        e.templateId !== 'stone_wall' ||
        e.upgradeTargetTemplateId ||
        (e.upgradeLinkedIds && e.upgradeLinkedIds.length > 0)
      ) {
        continue;
      }
      // Must share roughly the same wall orientation (aligned modulo 180 deg)
      const angleDot = Math.abs(Math.cos(e.facing - wall.facing));
      if (angleDot < 0.85) continue;

      const dx = e.x - wall.x;
      const dz = e.z - wall.z;
      const proj = dx * ax + dz * az;
      const perp = Math.abs(dx * -az + dz * ax);
      if (perp > 1.45) continue;

      const absProj = Math.abs(proj);
      if (absProj < 1.5 || absProj > 4.4) continue;

      if (proj < 0 && absProj < bestPrevDist) {
        bestPrevDist = absProj;
        bestPrev = e;
      } else if (proj > 0 && absProj < bestNextDist) {
        bestNextDist = absProj;
        bestNext = e;
      }
    }

    if (bestPrev && bestNext) {
      return [bestPrev, bestNext];
    }
    return null;
  }

  /** Registers or clears NavGrid gate mode tiles for a Stone Gate (supports 3-segment & standalone gates) */
  private syncGateNavTiles(gate: Entity, active: boolean): void {
    const mode = active ? (gate.gateMode ?? 'auto') : null;
    const tiles =
      gate.gateSpanTiles && gate.gateSpanTiles.length > 0
        ? gate.gateSpanTiles
        : [{ tx: gate.tileX, tz: gate.tileZ }];
    for (const t of tiles) {
      this.navGrid.setGateTile(t.tx, t.tz, gate.owner, mode);
    }
  }

  private handleSetGateModeCommand(cmd: Extract<GameCommand, { type: 'set_gate_mode' }>): void {
    const gate = this.entities.get(cmd.buildingId);
    if (!gate || !gate.alive || gate.owner !== cmd.playerId || gate.isFoundation) return;
    if (!TEMPLATES[gate.templateId]?.isGate) return;
    gate.gateMode = cmd.mode;
    this.syncGateNavTiles(gate, true);
    if (cmd.mode === 'open') {
      gate.gateOpenAmount = 1;
    } else if (cmd.mode === 'locked') {
      gate.gateOpenAmount = 0;
    }
  }

  private handleIgniteBeaconCommand(cmd: Extract<GameCommand, { type: 'ignite_beacon' }>): void {
    const beacon = this.entities.get(cmd.buildingId);
    if (!beacon || !beacon.alive || beacon.owner !== cmd.playerId || beacon.isFoundation) return;
    if (!TEMPLATES[beacon.templateId]?.isBeaconTower) return;
    if (this.getBeaconGarrisonSoldiers(beacon).length === 0) return;
    beacon.beaconSuppressTimer = 0;
    this.igniteBeacon(beacon, false);
  }

  private handleExtinguishBeaconCommand(cmd: Extract<GameCommand, { type: 'extinguish_beacon' }>): void {
    const beacon = this.entities.get(cmd.buildingId);
    if (!beacon || !beacon.alive || beacon.owner !== cmd.playerId || beacon.isFoundation) return;
    if (!TEMPLATES[beacon.templateId]?.isBeaconTower) return;
    beacon.beaconLitTimer = 0;
    beacon.beaconSuppressTimer = 10; // Prevent immediate auto-reignite for 10s after player manually extinguishes
  }

  /**
   * Lights a garrisoned Great Wall Beacon Tower:
   * - Chains ignition to all other garrisoned Beacon Towers within relayRange(level)
   * - Automatically rallies own armies within rallyRange(level) toward the lit Beacon Tower!
   */
  private igniteBeacon(beacon: Entity, autoDetected: boolean, visited?: Set<number>): void {
    const seen = visited ?? new Set<number>();
    if (seen.has(beacon.id)) return;
    seen.add(beacon.id);

    if (this.getBeaconGarrisonSoldiers(beacon).length === 0) return;
    const level = beacon.beaconLevel ?? 1;
    const stats = World.getBeaconStats(level);
    beacon.beaconLitTimer = 25;
    beacon.beaconRallyCooldown = 4.5;

    this.events.push({
      type: 'beacon_lit',
      playerId: beacon.owner,
      x: beacon.x,
      z: beacon.z,
      level,
      autoDetected,
    });

    // Rally all own military units within rallyRange toward this Beacon Tower!
    this.rallyArmiesToBeacon(beacon, stats.rallyRange);

    // Chain-ignite every other garrisoned friendly Beacon Tower within relayRange!
    for (const other of this.entities.values()) {
      if (
        other.id === beacon.id ||
        seen.has(other.id) ||
        !other.alive ||
        other.isFoundation ||
        other.owner !== beacon.owner ||
        !TEMPLATES[other.templateId]?.isBeaconTower
      ) {
        continue;
      }
      if (Math.hypot(other.x - beacon.x, other.z - beacon.z) <= stats.relayRange) {
        if (this.getBeaconGarrisonSoldiers(other).length > 0) {
          this.igniteBeacon(other, false, seen);
        }
      }
    }
  }

  private rallyArmiesToBeacon(beacon: Entity, range: number): void {
    for (const u of this.entities.values()) {
      if (!u.alive || u.owner !== beacon.owner || u.garrisonedIn !== null) continue;
      if (!this.isMilitaryUnit(u.templateId)) continue;
      const dist = Math.hypot(u.x - beacon.x, u.z - beacon.z);
      if (dist > range || dist < 4.5) continue;
      // Don't pull a soldier away if they are already actively fighting an enemy right next to them
      if (u.order.type === 'attack') {
        const tgt = this.entities.get(u.order.targetId);
        if (tgt && tgt.alive && Math.hypot(tgt.x - u.x, tgt.z - u.z) <= 8) continue;
      }
      u.order = { type: 'move', x: beacon.x, z: beacon.z, attackMove: true };
      u.queuedOrders.length = 0;
      u.guardX = beacon.x;
      u.guardZ = beacon.z;
      u.path = this.navGrid.findPath(u.x, u.z, beacon.x, beacon.z, 4500, false, u.owner);
      u.pathIndex = 0;
      u.repathTimer = 1.0;
    }
  }

  private handleUpgradeBuildingCommand(cmd: Extract<GameCommand, { type: 'upgrade_building' }>): void {
    const player = this.players.get(cmd.playerId);
    const b = this.entities.get(cmd.buildingId);
    if (!player || !b || !b.alive || b.owner !== cmd.playerId || b.isFoundation) return;
    if (b.upgradeTargetTemplateId) return; // Already upgrading!

    // 1. Stone Wall -> 3-Segment City Gate (timed! requires neighboring walls on both sides)
    if (b.templateId === 'stone_wall' && cmd.target === 'gate') {
      const neighbors = this.findGateUpgradeNeighbors(b);
      if (!neighbors) return;
      const cost = World.UPGRADE_WALL_TO_GATE_COST;
      if (!this.canAfford(player.resources, cost)) return;
      this.spend(player.resources, cost);
      const [prev, next] = neighbors;
      b.upgradeTargetTemplateId = 'stone_gate';
      b.upgradeLinkedIds = [prev.id, next.id];
      b.upgradeProgress = 0;
      b.upgradeTotalTime = player.fastBuildCheat ? 0.15 : World.UPGRADE_WALL_TO_GATE_TIME_SEC;
      prev.upgradeLinkedIds = [b.id];
      next.upgradeLinkedIds = [b.id];
      return;
    }

    // 2. Stone Wall -> Great Wall Beacon Tower Lv.1 (timed! works on ANY wall segment)
    if (b.templateId === 'stone_wall' && cmd.target === 'beacon') {
      if (b.upgradeLinkedIds && b.upgradeLinkedIds.length > 0) return;
      const cost = World.UPGRADE_WALL_TO_BEACON_COST;
      if (!this.canAfford(player.resources, cost)) return;
      this.spend(player.resources, cost);
      b.upgradeTargetTemplateId = 'beacon_tower';
      b.upgradeTargetFloors = 1;
      b.upgradeProgress = 0;
      b.upgradeTotalTime = player.fastBuildCheat ? 0.15 : World.UPGRADE_WALL_TO_BEACON_TIME_SEC;
      return;
    }

    // 3. Stone Gate -> Reverse convert back into 3 continuous Stone Wall segments (timed!)
    if (b.templateId === 'stone_gate' && cmd.target === 'wall') {
      const cost = World.CONVERT_GATE_TO_WALL_COST;
      if (!this.canAfford(player.resources, cost)) return;
      this.spend(player.resources, cost);
      b.upgradeTargetTemplateId = 'stone_wall';
      b.upgradeProgress = 0;
      b.upgradeTotalTime = player.fastBuildCheat ? 0.15 : World.CONVERT_GATE_TO_WALL_TIME_SEC;
      return;
    }

    // 4. Great Wall Beacon Tower Lv.1 -> Lv.2 -> Lv.3 (timed!)
    if (b.templateId === 'beacon_tower') {
      const curLv = b.beaconLevel ?? 1;
      if (curLv >= 3) return;
      const nextLv = (curLv + 1) as 2 | 3;
      const cost = nextLv === 2 ? World.UPGRADE_BEACON_LV2_COST : World.UPGRADE_BEACON_LV3_COST;
      const dur = nextLv === 2 ? World.UPGRADE_BEACON_LV2_TIME_SEC : World.UPGRADE_BEACON_LV3_TIME_SEC;
      if (!this.canAfford(player.resources, cost)) return;
      this.spend(player.resources, cost);
      b.upgradeTargetTemplateId = 'beacon_tower';
      b.upgradeTargetFloors = nextLv;
      b.upgradeProgress = 0;
      b.upgradeTotalTime = player.fastBuildCheat ? 0.15 : dur;
      return;
    }

    // 5. House -> 2-Story Apartment (timed construction! requires City Phase II + Multi-Story Housing tech)
    if (b.templateId === 'house') {
      if (player.phase < 2 || !player.researchedTechs.has('tech_multistory_housing')) return;
      const cost = World.UPGRADE_HOUSE_COST;
      if (!this.canAfford(player.resources, cost)) return;
      this.spend(player.resources, cost);
      b.upgradeTargetTemplateId = 'apartment_house';
      b.upgradeTargetFloors = 2;
      b.upgradeProgress = 0;
      b.upgradeTotalTime = player.fastBuildCheat ? 0.1 : World.UPGRADE_HOUSE_TIME_SEC;
      return;
    }

    // 6. Multi-Story Apartment 2F -> 3F (timed construction! MAX 3 stories, requires City Phase III!)
    const tpl = TEMPLATES[b.templateId];
    if (tpl?.isApartment) {
      const maxFloors = tpl.maxFloors ?? 3;
      const curFloors = b.floors ?? 2;
      if (curFloors >= maxFloors) return;
      if (player.phase < 3) return;
      const cost = World.UPGRADE_FLOOR3_COST;
      if (!this.canAfford(player.resources, cost)) return;
      this.spend(player.resources, cost);
      b.upgradeTargetTemplateId = b.templateId;
      b.upgradeTargetFloors = Math.min(maxFloors, curFloors + 1);
      b.upgradeProgress = 0;
      b.upgradeTotalTime = player.fastBuildCheat ? 0.1 : World.UPGRADE_FLOOR3_TIME_SEC;
    }
  }

  private completeBuildingUpgrade(b: Entity): void {
    const player = this.players.get(b.owner);
    const targetTplId = b.upgradeTargetTemplateId;
    const targetFloors = b.upgradeTargetFloors ?? 2;
    const linkedIds = b.upgradeLinkedIds ? [...b.upgradeLinkedIds] : [];
    b.upgradeTargetTemplateId = null;
    b.upgradeTargetFloors = undefined;
    b.upgradeProgress = undefined;
    b.upgradeTotalTime = undefined;
    b.upgradeLinkedIds = undefined;
    if (!player || !targetTplId) return;

    if (b.templateId === 'stone_wall' && targetTplId === 'stone_gate') {
      // Transform Prev + Mid + Next wall segments into one unified 3-segment Stone Gate!
      const spanTiles: Array<{ tx: number; tz: number }> = [{ tx: b.tileX, tz: b.tileZ }];
      this.navGrid.setFootprint(b.tileX, b.tileZ, TEMPLATES.stone_wall.footprintTiles ?? 1, false);
      for (const nid of linkedIds) {
        const nb = this.entities.get(nid);
        if (nb && nb.alive) {
          spanTiles.push({ tx: nb.tileX, tz: nb.tileZ });
          this.navGrid.setFootprint(nb.tileX, nb.tileZ, TEMPLATES.stone_wall.footprintTiles ?? 1, false);
          this.entities.delete(nid);
        }
      }
      b.templateId = 'stone_gate';
      b.gateMode = 'auto';
      b.gateOpenAmount = 0;
      b.gateSpanTiles = spanTiles;
      const newMax = this.computeMaxHp('stone_gate', player.id);
      b.maxHp = newMax;
      b.hp = newMax;
      this.syncGateNavTiles(b, true);
    } else if (b.templateId === 'stone_gate' && targetTplId === 'stone_wall') {
      // Reverse-convert Stone Gate back into 3 continuous Stone Wall segments!
      this.syncGateNavTiles(b, false);
      const ax = Math.cos(b.facing);
      const az = -Math.sin(b.facing);
      const savedSpan = b.gateSpanTiles && b.gateSpanTiles.length >= 3 ? b.gateSpanTiles : null;
      const centerTile = { tx: b.tileX, tz: b.tileZ };
      const flankTiles: Array<{ tx: number; tz: number }> = [];
      if (savedSpan) {
        for (const t of savedSpan) {
          if (t.tx !== centerTile.tx || t.tz !== centerTile.tz) flankTiles.push(t);
        }
      } else {
        const stepDist = 2.86;
        flankTiles.push(
          this.terrain.worldToTile(b.x - ax * stepDist, b.z - az * stepDist),
          this.terrain.worldToTile(b.x + ax * stepDist, b.z + az * stepDist)
        );
      }

      b.templateId = 'stone_wall';
      b.gateMode = undefined;
      b.gateOpenAmount = undefined;
      b.gateSpanTiles = undefined;
      const wallMax = this.computeMaxHp('stone_wall', player.id);
      b.maxHp = wallMax;
      b.hp = wallMax;
      this.navGrid.setFootprint(b.tileX, b.tileZ, TEMPLATES.stone_wall.footprintTiles ?? 1, true);

      for (const ft of flankTiles) {
        this.spawnBuilding('stone_wall', player.id, ft.tx, ft.tz, false, b.facing);
      }
    } else if (b.templateId === 'stone_wall' && targetTplId === 'beacon_tower') {
      b.templateId = 'beacon_tower';
      b.beaconLevel = 1;
      b.beaconLitTimer = 0;
      const stats = World.getBeaconStats(1);
      b.maxHp = stats.maxHp;
      b.hp = stats.maxHp;
      b.captureMax = this.computeCaptureMax('beacon_tower', player.id);
      b.capturePoints[player.id] = b.captureMax;
    } else if (b.templateId === 'beacon_tower' && targetTplId === 'beacon_tower') {
      const nextLv = Math.min(3, Math.max(1, targetFloors)) as 1 | 2 | 3;
      b.beaconLevel = nextLv;
      const stats = World.getBeaconStats(nextLv);
      const hpDelta = Math.max(0, stats.maxHp - b.maxHp);
      b.maxHp = stats.maxHp;
      b.hp = Math.min(b.maxHp, b.hp + hpDelta);
    } else if (b.templateId === 'house' && targetTplId === 'apartment_house') {
      b.templateId = 'apartment_house';
      b.floors = 2;
      const newMax = this.computeMaxHp('apartment_house', player.id);
      const hpDelta = Math.max(0, newMax - b.maxHp);
      b.maxHp = newMax;
      b.hp = Math.min(b.maxHp, b.hp + hpDelta);
      b.captureMax = this.computeCaptureMax('apartment_house', player.id);
      b.capturePoints[player.id] = b.captureMax;
    } else if (TEMPLATES[b.templateId]?.isApartment) {
      const maxFloors = TEMPLATES[b.templateId].maxFloors ?? 3;
      b.floors = Math.min(maxFloors, targetFloors);
      b.maxHp += 350;
      b.hp = Math.min(b.maxHp, b.hp + 350);
    }

    this.recomputePopulations();
    this.events.push({
      type: 'building_upgraded',
      playerId: player.id,
      x: b.x,
      z: b.z,
      templateId: b.templateId,
      floors: b.beaconLevel ?? b.floors ?? 2,
    });
  }

  private handleSetDiplomacyCommand(cmd: Extract<GameCommand, { type: 'set_diplomacy' }>): void {
    const pA = this.players.get(cmd.playerId);
    const pB = this.players.get(cmd.targetPlayerId);
    if (!pA || !pB || pA.id === pB.id) return;
    pA.diplomacy[pB.id] = cmd.stance;
    // In 0 A.D. skirmish diplomacy: if human offers Ally/Neutral to an AI (and not currently fighting or same team/peaceful),
    // AI reciprocates Ally/Neutral cleanly; declaring Enemy immediately turns AI hostile!
    if (pB.isAI) {
      if (cmd.stance === 'enemy') {
        pB.diplomacy[pA.id] = 'enemy';
      } else if (cmd.stance === 'ally') {
        // AI accepts alliance proposal unless human already attacked it recently or free-for-all enemy; allow clean 0 A.D. diplomacy!
        pB.diplomacy[pA.id] = 'ally';
      } else {
        pB.diplomacy[pA.id] = 'neutral';
      }
    }
    this.fog.update(this.entities.values(), this.getSharedAllyMap());
    this.events.push({
      type: 'diplomacy_changed',
      playerId: pA.id,
      targetPlayerId: pB.id,
      stance: cmd.stance,
    });
  }

  private handleSendTributeCommand(cmd: Extract<GameCommand, { type: 'send_tribute' }>): void {
    const fromP = this.players.get(cmd.playerId);
    const toP = this.players.get(cmd.targetPlayerId);
    if (!fromP || !toP || fromP.id === toP.id || toP.defeated) return;
    const amt = Math.max(0, Math.min(fromP.resources[cmd.resource], Math.floor(cmd.amount)));
    if (amt <= 0) return;
    fromP.resources[cmd.resource] -= amt;
    toP.resources[cmd.resource] += amt;
    this.events.push({
      type: 'tribute_sent',
      fromPlayerId: fromP.id,
      toPlayerId: toP.id,
      resource: cmd.resource,
      amount: amt,
    });
  }

  private getTerraformApproachPos(
    u: Entity,
    tileX: number,
    tileZ: number,
    center: { x: number; z: number }
  ): { x: number; z: number } {
    if (this.terrain.isTileStaticPassable(tileX, tileZ)) {
      return center;
    }
    const uTile = this.terrain.worldToTile(u.x, u.z);
    const bank = this.navGrid.findNearestWalkable(tileX, tileZ, 6, uTile.tx, uTile.tz);
    return bank ? this.terrain.tileToWorldCenter(bank.tx, bank.tz) : center;
  }

  private handleRepairCommand(cmd: Extract<GameCommand, { type: 'repair' }>): void {
    const target = this.entities.get(cmd.targetId);
    if (!target || !target.alive || target.owner !== cmd.playerId) return;
    if (TEMPLATES[target.templateId].kind !== 'building') return;
    if (!target.isFoundation && target.hp >= target.maxHp) return;

    for (const id of cmd.entityIds) {
      const u = this.entities.get(id);
      if (!u || !u.alive || u.owner !== cmd.playerId || u.garrisonedIn !== null) continue;
      const uTpl = TEMPLATES[u.templateId];
      if (!uTpl.canBuild || uTpl.canBuild.length === 0) continue;
      u.order = { type: 'build', targetId: target.id };
      u.queuedOrders.length = 0;
      u.path = this.navGrid.findPath(u.x, u.z, target.x, target.z);
      u.pathIndex = 0;
    }
  }

  private handleTrainCommand(cmd: Extract<GameCommand, { type: 'train' }>): void {
    const building = this.entities.get(cmd.buildingId);
    const player = this.players.get(cmd.playerId);
    if (!building || !building.alive || building.owner !== cmd.playerId || building.isFoundation || !player) return;
    if (building.queue.length >= 6) return;

    const bTpl = TEMPLATES[building.templateId];
    const civ = CIVS[player.civ];
    const resolvedId = resolveUnitTemplateId(civ.units, cmd.templateId);
    const allowed = bTpl.trains?.map((k) => resolveUnitTemplateId(civ.units, k)) ?? [];
    if (!allowed.includes(resolvedId)) return;

    const uTpl = TEMPLATES[resolvedId];
    if (!uTpl || !uTpl.cost) return;
    if (uTpl.civ && uTpl.civ !== player.civ) return;
    if (uTpl.allowedCivs && !uTpl.allowedCivs.includes(player.civ)) return;
    if ((uTpl.phaseRequired ?? 1) > player.phase) return;
    if (!this.canAfford(player.resources, uTpl.cost)) return;

    this.spend(player.resources, uTpl.cost);
    building.queue.push({
      kind: 'unit',
      id: resolvedId,
      progress: 0,
      totalTime: uTpl.trainTime ?? 8,
    });
  }

  private handleCancelTrainCommand(cmd: Extract<GameCommand, { type: 'cancel_train' }>): void {
    const building = this.entities.get(cmd.buildingId);
    const player = this.players.get(cmd.playerId);
    if (!building || !building.alive || building.owner !== cmd.playerId || !player) return;
    if (cmd.index < 0 || cmd.index >= building.queue.length) return;

    const [removed] = building.queue.splice(cmd.index, 1);
    if (removed.kind === 'unit') {
      const uTpl = TEMPLATES[removed.id];
      if (uTpl?.cost) this.refund(player.resources, uTpl.cost, 1.0);
    } else {
      const tech = TECHS[removed.id];
      if (tech) {
        this.refund(player.resources, tech.cost, 1.0);
        player.researchingTechs.delete(tech.id);
      }
    }
  }

  private handleResearchCommand(cmd: Extract<GameCommand, { type: 'research' }>): void {
    const building = this.entities.get(cmd.buildingId);
    const player = this.players.get(cmd.playerId);
    const tech = TECHS[cmd.techId];
    if (!building || !building.alive || building.owner !== cmd.playerId || building.isFoundation || !player || !tech) return;
    if (building.queue.length >= 6) return;

    const bTpl = TEMPLATES[building.templateId];
    if (!bTpl.researches?.includes(tech.id)) return;
    if (tech.civ && tech.civ !== player.civ) return;
    if (tech.phaseRequired > player.phase) return;
    if (player.researchedTechs.has(tech.id) || player.researchingTechs.has(tech.id)) return;
    if (!this.canAfford(player.resources, tech.cost)) return;

    this.spend(player.resources, tech.cost);
    player.researchingTechs.add(tech.id);
    building.queue.push({
      kind: 'tech',
      id: tech.id,
      progress: 0,
      totalTime: tech.researchTime,
    });
  }

  private handleSetRallyCommand(cmd: Extract<GameCommand, { type: 'set_rally' }>): void {
    const building = this.entities.get(cmd.buildingId);
    if (!building || !building.alive || building.owner !== cmd.playerId) return;
    building.rallyX = Math.max(4, Math.min(this.terrain.worldSize - 4, cmd.x));
    building.rallyZ = Math.max(4, Math.min(this.terrain.worldSize - 4, cmd.z));
    building.rallyTargetId = cmd.targetId ?? null;
  }

  private handleSetStanceCommand(cmd: Extract<GameCommand, { type: 'set_stance' }>): void {
    for (const id of cmd.entityIds) {
      const e = this.entities.get(id);
      if (e && e.alive && e.owner === cmd.playerId && TEMPLATES[e.templateId].kind === 'unit') {
        e.stance = cmd.stance;
        if (cmd.stance === 'defensive' || cmd.stance === 'stand_ground') {
          e.guardX = e.x;
          e.guardZ = e.z;
        }
        if (cmd.stance === 'passive' && e.order.type === 'attack') {
          e.order = { type: 'idle' };
          e.path = [];
        } else if (cmd.stance !== 'passive' && e.order.type === 'idle' && !TEMPLATES[e.templateId].isWoman) {
          this.tryAutoAcquireEnemy(e);
        }
      }
    }
  }

  private handleGarrisonCommand(cmd: Extract<GameCommand, { type: 'garrison' }>): void {
    const building = this.entities.get(cmd.buildingId);
    if (!building || !building.alive || building.owner !== cmd.playerId || building.isFoundation) return;
    if (this.getMaxGarrisonCapacity(building) <= 0) return;

    for (const id of cmd.entityIds) {
      const u = this.entities.get(id);
      if (!u || !u.alive || u.owner !== cmd.playerId || u.garrisonedIn !== null) continue;
      if (TEMPLATES[u.templateId].kind !== 'unit') continue;
      u.order = { type: 'garrison', targetId: building.id };
      u.queuedOrders.length = 0;
      u.path = this.navGrid.findPath(u.x, u.z, building.x, building.z, 4500, false, u.owner);
      u.pathIndex = 0;
    }
  }

  private handleUngarrisonCommand(cmd: Extract<GameCommand, { type: 'ungarrison' }>): void {
    const building = this.entities.get(cmd.buildingId);
    if (!building || !building.alive || building.owner !== cmd.playerId) return;
    this.ungarrisonAll(building);
  }

  private handleUngarrisonOneCommand(cmd: Extract<GameCommand, { type: 'ungarrison_one' }>): void {
    const building = this.entities.get(cmd.buildingId);
    if (!building || !building.alive || building.owner !== cmd.playerId) return;
    const idx = building.garrisonedIds.indexOf(cmd.unitId);
    if (idx === -1) return;
    building.garrisonedIds.splice(idx, 1);
    const u = this.entities.get(cmd.unitId);
    if (!u || !u.alive) return;
    u.garrisonedIn = null;
    const bTpl = TEMPLATES[building.templateId];
    const angle = (idx % 8) * (Math.PI * 0.25);
    const dist = bTpl.radius + 1.65;
    const rawX = Math.max(4, Math.min(this.terrain.worldSize - 4, building.x + Math.cos(angle) * dist));
    const rawZ = Math.max(4, Math.min(this.terrain.worldSize - 4, building.z + Math.sin(angle) * dist));
    const rt = this.terrain.worldToTile(rawX, rawZ);
    const safe = this.navGrid.isWalkableFor(rt.tx, rt.tz, u.owner)
      ? { x: rawX, z: rawZ }
      : (() => {
          const tile = this.navGrid.findNearestWalkable(rt.tx, rt.tz, 6, rt.tx, rt.tz, u.owner);
          return tile ? this.terrain.tileToWorldCenter(tile.tx, tile.tz) : { x: rawX, z: rawZ };
        })();
    u.x = safe.x;
    u.z = safe.z;
    u.prevX = u.x;
    u.prevZ = u.z;
    u.order = { type: 'idle' };
    u.path = [];
  }

  private handleActivateSkillCommand(cmd: Extract<GameCommand, { type: 'activate_skill' }>): void {
    const player = this.players.get(cmd.playerId);
    if (!player || player.defeated || player.skillCooldown > 0) return;
    const civ = CIVS[player.civ];
    player.skillCooldown = civ.skill.cooldownSec;
    player.skillActiveTimer = civ.skill.durationSec;

    // Immediate activation effects per civilization
    if (player.civ === 'athenians') {
      // Athena's Aegis: heal all friendly units +25 HP immediately
      for (const e of this.entities.values()) {
        if (e.alive && e.owner === player.id && TEMPLATES[e.templateId].kind === 'unit') {
          e.hp = Math.min(e.maxHp, e.hp + 25);
        }
      }
    } else if (player.civ === 'spartans') {
      // Thermopylae Stand: +35 HP battle surge to all Spartan units
      for (const e of this.entities.values()) {
        if (e.alive && e.owner === player.id && TEMPLATES[e.templateId].kind === 'unit') {
          e.hp = Math.min(e.maxHp, e.hp + 35);
        }
      }
    } else if (player.civ === 'persians') {
      // Royal Road Levy: instant +150 Food & +150 Wood from imperial satrapies
      player.resources.food += 150;
      player.resources.wood += 150;
      player.stats.resourcesGathered += 300;
    } else if (player.civ === 'carthaginians') {
      // Punic Trade Fleet: instant +180 Wood & +120 Metal
      player.resources.wood += 180;
      player.resources.metal += 120;
      player.stats.resourcesGathered += 300;
    } else if (player.civ === 'ptolemies') {
      // Nile Harvest Surge: instant +220 Food & heal all friendly units +30 HP
      player.resources.food += 220;
      player.stats.resourcesGathered += 220;
      for (const e of this.entities.values()) {
        if (e.alive && e.owner === player.id && TEMPLATES[e.templateId].kind === 'unit') {
          e.hp = Math.min(e.maxHp, e.hp + 30);
        }
      }
    } else if (player.civ === 'han') {
      // Imperial Minister Edict: instant +160 Food, +160 Wood, +100 Metal
      player.resources.food += 160;
      player.resources.wood += 160;
      player.resources.metal += 100;
      player.stats.resourcesGathered += 420;
    } else if (player.civ === 'kushites') {
      // Blessing of Amun: heal all Kushite units +35 HP
      for (const e of this.entities.values()) {
        if (e.alive && e.owner === player.id && TEMPLATES[e.templateId].kind === 'unit') {
          e.hp = Math.min(e.maxHp, e.hp + 35);
        }
      }
    } else if (player.civ === 'mauryas') {
      // War Elephant Stampede: heal all Mauryan units +40 HP
      for (const e of this.entities.values()) {
        if (e.alive && e.owner === player.id && TEMPLATES[e.templateId].kind === 'unit') {
          e.hp = Math.min(e.maxHp, e.hp + 40);
        }
      }
    } else if (player.civ === 'seleucids') {
      // Diadochi Imperial Decree: instant +140 Food & +140 Metal
      player.resources.food += 140;
      player.resources.metal += 140;
      player.stats.resourcesGathered += 280;
    }

    this.events.push({
      type: 'skill_activated',
      playerId: player.id,
      skillId: civ.skill.id,
    });
  }

  private handleCheatCommand(cmd: Extract<GameCommand, { type: 'cheat' }>): void {
    const player = this.players.get(cmd.playerId);
    if (!player) return;

    switch (cmd.action) {
      case 'resources': {
        player.resources.food += 5000;
        player.resources.wood += 5000;
        player.resources.stone += 5000;
        player.resources.metal += 5000;
        break;
      }
      case 'fast_build': {
        player.fastBuildCheat = !player.fastBuildCheat;
        break;
      }
      case 'all_techs': {
        player.phase = 4;
        for (const tech of Object.values(TECHS)) {
          if (tech.civ && tech.civ !== player.civ) continue;
          if (!player.researchedTechs.has(tech.id)) {
            this.completeTechResearch(tech.id, player);
          }
        }
        this.territoryDirty = true;
        this.recomputePopulations();
        break;
      }
      case 'reset_skill': {
        player.skillCooldown = 0;
        break;
      }
      case 'heal_all': {
        for (const e of this.entities.values()) {
          if (e.alive && e.owner === player.id) {
            e.hp = e.maxHp;
            if (e.captureMax > 0) {
              e.capturePoints = { [player.id]: e.captureMax };
            }
          }
        }
        break;
      }
      case 'spawn_army': {
        const civ = CIVS[player.civ];
        let hubX = this.terrain.worldSize * 0.25;
        let hubZ = this.terrain.worldSize * 0.25;
        for (const e of this.entities.values()) {
          if (e.alive && e.owner === player.id && TEMPLATES[e.templateId].isCivicCenter) {
            hubX = e.x;
            hubZ = e.z;
            break;
          }
        }
        const siegeUnit = civ.blockedBuildings?.includes('workshop') ? civ.units.special : 'siege_ram';
        const roster = [
          civ.units.champion,
          civ.units.champion,
          civ.units.champion,
          civ.units.special,
          civ.units.special,
          civ.units.cavalry,
          siegeUnit,
        ];
        roster.forEach((tplId, idx) => {
          const ang = (idx / roster.length) * Math.PI * 2;
          const sx = hubX + Math.cos(ang) * 7.2;
          const sz = hubZ + Math.sin(ang) * 7.2;
          const t = this.terrain.worldToTile(sx, sz);
          const safe = this.navGrid.findNearestWalkable(t.tx, t.tz, 8);
          const pos = safe ? this.terrain.tileToWorldCenter(safe.tx, safe.tz) : { x: sx, z: sz };
          this.spawnUnit(tplId, player.id, pos.x, pos.z);
        });
        break;
      }
      case 'instant_win': {
        for (const p of this.players.values()) {
          if (p.id !== player.id) p.defeated = true;
        }
        this.winnerId = player.id;
        this.events.push({ type: 'match_over', winnerId: player.id });
        break;
      }
    }
  }

  private handleDeleteCommand(cmd: Extract<GameCommand, { type: 'delete' }>): void {
    for (const id of cmd.entityIds) {
      const e = this.entities.get(id);
      if (!e || !e.alive || e.owner !== cmd.playerId) continue;
      if (e.isFoundation) {
        const player = this.players.get(cmd.playerId);
        const cost = TEMPLATES[e.templateId].cost;
        if (player && cost) this.refund(player.resources, cost, 0.75);
      }
      e.hp = 0;
      e.alive = false;
    }
  }

  private ungarrisonAll(building: Entity): void {
    const bTpl = TEMPLATES[building.templateId];
    const ids = building.garrisonedIds.splice(0);
    ids.forEach((uid, i) => {
      const u = this.entities.get(uid);
      if (!u || !u.alive) return;
      u.garrisonedIn = null;
      const angle = (i / Math.max(1, ids.length)) * Math.PI * 2;
      const dist = bTpl.radius + 1.6;
      const rawX = Math.max(4, Math.min(this.terrain.worldSize - 4, building.x + Math.cos(angle) * dist));
      const rawZ = Math.max(4, Math.min(this.terrain.worldSize - 4, building.z + Math.sin(angle) * dist));
      const rt = this.terrain.worldToTile(rawX, rawZ);
      const safe = this.navGrid.isWalkableFor(rt.tx, rt.tz, u.owner)
        ? { x: rawX, z: rawZ }
        : (() => {
            const tile = this.navGrid.findNearestWalkable(rt.tx, rt.tz, 6, rt.tx, rt.tz, u.owner);
            return tile ? this.terrain.tileToWorldCenter(tile.tx, tile.tz) : { x: rawX, z: rawZ };
          })();
      u.x = safe.x;
      u.z = safe.z;
      u.prevX = u.x;
      u.prevZ = u.z;
      u.order = { type: 'idle' };
      u.path = [];
    });
  }

  private updateProduction(): void {
    for (const e of this.entities.values()) {
      if (!e.alive || e.isFoundation || e.queue.length === 0) continue;
      const player = this.players.get(e.owner);
      if (!player) continue;

      const item = e.queue[0];
      if (item.kind === 'unit') {
        const uTpl = TEMPLATES[item.id];
        const popNeed = uTpl.popCost ?? 1;
        // Pause at 99% if pop-capped
        if (item.progress >= item.totalTime - SIM_DT && player.popUsed + popNeed > player.popCap) {
          item.progress = item.totalTime - SIM_DT;
          continue;
        }
      }

      let trainMult = 1.0;
      if (item.kind === 'unit') {
        const civCfg = CIVS[player.civ];
        if (civCfg.trainSpeedBonusPct) {
          trainMult += civCfg.trainSpeedBonusPct;
        }
        if (player.civ === 'carthaginians' && item.id === 'carth_mercenary') {
          trainMult += 0.15;
        }
        if (
          player.researchedTechs.has('tech_pers_immortals') ||
          player.researchedTechs.has('tech_carth_mercenaries') ||
          player.researchedTechs.has('tech_brit_warfare') ||
          player.researchedTechs.has('tech_gaul_charge') ||
          player.researchedTechs.has('tech_sele_colony')
        ) {
          trainMult *= 1.25;
        }
        if (player.skillActiveTimer > 0 && player.civ === 'han') {
          trainMult *= 1.35;
        }
      }
      if (player.fastBuildCheat) {
        trainMult *= 25;
      }
      item.progress += SIM_DT * trainMult;
      if (item.progress >= item.totalTime) {
        e.queue.shift();
        if (item.kind === 'unit') {
          this.completeUnitTraining(e, item.id, player);
        } else {
          this.completeTechResearch(item.id, player);
        }
      }
    }
  }

  private completeUnitTraining(building: Entity, unitTemplateId: string, player: PlayerState): void {
    const bTpl = TEMPLATES[building.templateId];
    const uTpl = TEMPLATES[unitTemplateId];
    const dirX = building.rallyX - building.x;
    const dirZ = building.rallyZ - building.z;
    const len = Math.hypot(dirX, dirZ) || 1;
    let sx = building.x + (dirX / len) * (bTpl.radius + 1.3);
    let sz = building.z + (dirZ / len) * (bTpl.radius + 1.3);

    if (uTpl?.isNaval) {
      const sTile = this.terrain.worldToTile(sx, sz);
      const waterTile = this.navGrid.findNearestWater(sTile.tx, sTile.tz, 14, building.tileX, building.tileZ);
      if (waterTile) {
        const wp = this.terrain.tileToWorldCenter(waterTile.tx, waterTile.tz);
        sx = wp.x;
        sz = wp.z;
      }
    }

    const unit = this.spawnUnit(unitTemplateId, building.owner, sx, sz);
    if (!unit) return;
    player.stats.unitsTrained++;

    this.events.push({
      type: 'unit_trained',
      playerId: building.owner,
      x: unit.x,
      z: unit.z,
      templateId: unitTemplateId,
    });

    // Execute rally point
    if (building.rallyTargetId) {
      const target = this.entities.get(building.rallyTargetId);
      if (target && target.alive && TEMPLATES[target.templateId].resourceType && TEMPLATES[unit.templateId].gather) {
        this.enqueueCommand({ type: 'gather', playerId: building.owner, entityIds: [unit.id], targetId: target.id });
        return;
      }
    }
    // Newly built Trade Caravans automatically start shuttling between this Market & the farthest friendly Market!
    if (uTpl?.isTrader) {
      const partner = this.findBestPartnerMarket(building.owner, building.id);
      if (partner) {
        this.enqueueCommand({
          type: 'trade',
          playerId: building.owner,
          entityIds: [unit.id],
          targetMarketId: partner.id,
          homeMarketId: building.id,
        });
        return;
      }
    }
    // Newly built Fishing Boats automatically sail to the nearest Fish Shoal!
    if (uTpl?.isNaval && uTpl.gather) {
      const fish = this.findNearestResource(unit.x, unit.z, 'food', building.owner, 90, true);
      if (fish) {
        this.enqueueCommand({ type: 'gather', playerId: building.owner, entityIds: [unit.id], targetId: fish.id });
        return;
      }
    }
    // Newly trained human workers from Civic Center wait 10s (with overhead countdown) before auto-working!
    if (TEMPLATES[building.templateId]?.isCivicCenter && !player.isAI && uTpl?.gather && !uTpl.isNaval) {
      unit.autoWorkDelay = 10;
      const rx = Math.max(4, Math.min(this.terrain.worldSize - 4, building.rallyX));
      const rz = Math.max(4, Math.min(this.terrain.worldSize - 4, building.rallyZ));
      if (Math.hypot(rx - unit.x, rz - unit.z) > 1.2) {
        unit.order = { type: 'move', x: rx, z: rz };
        unit.guardX = rx;
        unit.guardZ = rz;
        unit.path = this.navGrid.findPath(unit.x, unit.z, rx, rz);
        unit.pathIndex = 0;
        unit.repathTimer = 1.0;
      }
      return;
    }
    this.enqueueCommand({ type: 'move', playerId: building.owner, entityIds: [unit.id], x: building.rallyX, z: building.rallyZ });
  }

  private completeTechResearch(techId: string, player: PlayerState): void {
    const tech = TECHS[techId];
    if (!tech) return;
    player.researchingTechs.delete(techId);
    player.researchedTechs.add(techId);

    if (tech.grantsPhase && player.phase < tech.grantsPhase) {
      player.phase = tech.grantsPhase;
      this.territoryDirty = true;
      this.recomputePopulations();
    } else if (tech.popCapBonus || tech.territoryBonusTiles) {
      this.territoryDirty = true;
      this.recomputePopulations();
    }

    if (tech.buildingHpBonusPct) {
      for (const e of this.entities.values()) {
        if (!e.alive || e.owner !== player.id || TEMPLATES[e.templateId].kind !== 'building') continue;
        const oldMax = e.maxHp;
        const newMax = this.computeMaxHp(e.templateId, player.id);
        e.maxHp = newMax;
        if (!e.isFoundation) {
          e.hp += Math.max(0, newMax - oldMax);
        }
        const oldCap = e.captureMax;
        const newCap = this.computeCaptureMax(e.templateId, player.id);
        e.captureMax = newCap;
        if (e.capturePoints[player.id] !== undefined) {
          e.capturePoints[player.id] += Math.max(0, newCap - oldCap);
        }
      }
    }

    if (tech.unitHpBonusPct || tech.shipHpBonusPct) {
      for (const e of this.entities.values()) {
        if (!e.alive || e.owner !== player.id) continue;
        const eTpl = TEMPLATES[e.templateId];
        if (eTpl.kind !== 'unit' || eTpl.isWoman || eTpl.isSiege) continue;
        if (tech.shipHpBonusPct && !tech.unitHpBonusPct && !eTpl.isNaval) continue;
        const oldMax = e.maxHp;
        const newMax = this.getUnitMaxHp(e);
        e.maxHp = newMax;
        e.hp += Math.max(0, newMax - oldMax);
      }
    }

    this.events.push({ type: 'tech_complete', playerId: player.id, techId });
  }

  private updateUnits(): void {
    for (const u of this.entities.values()) {
      if (!u.alive || u.garrisonedIn !== null) continue;
      const tpl = TEMPLATES[u.templateId];
      if (tpl.kind !== 'unit') continue;

      u.animTime += SIM_DT;
      if (u.attackCooldown > 0) u.attackCooldown = Math.max(0, u.attackCooldown - SIM_DT);
      if (u.repathTimer > 0) u.repathTimer = Math.max(0, u.repathTimer - SIM_DT);
      if (u.tunnelCooldown && u.tunnelCooldown > 0) {
        u.tunnelCooldown = Math.max(0, u.tunnelCooldown - SIM_DT);
      }
      let autoWorkJustExpired = false;
      if (u.autoWorkDelay && u.autoWorkDelay > 0) {
        u.autoWorkDelay = Math.max(0, u.autoWorkDelay - SIM_DT);
        if (u.autoWorkDelay === 0) {
          autoWorkJustExpired = true;
        }
      }
      u.vx = 0;
      u.vz = 0;

      // Merchant Ship passive maritime trade income every 10 seconds
      if (tpl.isMerchantShip && this.tickCount % (SIM_HZ * 10) === (u.id % (SIM_HZ * 10))) {
        const ownerP = this.players.get(u.owner);
        if (ownerP) {
          let mult = ownerP.civ === 'carthaginians' ? 1.25 : 1.0;
          if (ownerP.researchedTechs.has('tech_coinage')) mult += 0.5;
          if (ownerP.researchedTechs.has('tech_carth_colonization') || ownerP.researchedTechs.has('tech_han_silkroad')) {
            mult += 0.5;
          }
          const food = Math.round(12 * mult);
          const wood = Math.round(12 * mult);
          const metal = Math.round(12 * mult);
          ownerP.resources.food += food;
          ownerP.resources.wood += wood;
          ownerP.resources.metal += metal;
          ownerP.stats.resourcesGathered += food + wood + metal;
        }
      }

      switch (u.order.type) {
        case 'idle': {
          u.animState = 'idle';
          const idleCount = (this.idleTicks.get(u.id) ?? 0) + 1;
          this.idleTicks.set(u.id, idleCount);

          // 1. Temple Healer automatically seeks and heals nearby wounded friendly units
          if (tpl.isHealer) {
            this.updateHealerBehavior(u);
            break;
          }

          // 2. Military stance auto-acquisition (aggressive / defensive / stand_ground)
          if (!tpl.isWoman && this.tryAutoAcquireEnemy(u)) {
            this.idleTicks.set(u.id, 0);
            break;
          }

          // 2. Defensive stance returns to guard post if pulled away
          if (!tpl.isWoman && u.stance === 'defensive' && Math.hypot(u.x - u.guardX, u.z - u.guardZ) > 3.5) {
            u.order = { type: 'move', x: u.guardX, z: u.guardZ, attackMove: true };
            u.path = this.navGrid.findPath(u.x, u.z, u.guardX, u.guardZ);
            u.pathIndex = 0;
            this.idleTicks.set(u.id, 0);
            break;
          }

          // 3. Auto-work for idle human workers (citizens anywhere, citizen-soldiers near home base) & idle Trade Caravans
          const player = this.players.get(u.owner);
          if (tpl.isTrader && idleCount >= 20 && idleCount % 20 === 0) {
            const pair = this.findFarthestMarketPair(u.owner);
            if (pair) {
              u.order = {
                type: 'trade',
                homeMarketId: pair[0].id,
                targetMarketId: pair[1].id,
                leg: 'toTarget',
                cargoGold: 0,
              };
              u.path = [];
              this.idleTicks.set(u.id, 0);
              break;
            }
          }
          const isCitizenWorker = Boolean(tpl.isWoman || u.templateId === 'male_citizen');
          const idleThreshold = isCitizenWorker ? 4 : 36;
          const pollStride = isCitizenWorker ? 4 : 15;
          const waitingForCountdown = Boolean(u.autoWorkDelay && u.autoWorkDelay > 0);
          if (
            !waitingForCountdown &&
            player &&
            !player.isAI &&
            tpl.gather &&
            (autoWorkJustExpired || (idleCount >= idleThreshold && idleCount % pollStride === 0))
          ) {
            if (this.tryAutoWorkForIdleUnit(u, false)) {
              this.idleTicks.set(u.id, 0);
            }
          }
          break;
        }

        case 'move':
          this.idleTicks.set(u.id, 0);
          this.updateMoveOrder(u, u.order);
          break;

        case 'gather':
          this.idleTicks.set(u.id, 0);
          this.updateGatherOrder(u, u.order);
          break;

        case 'build':
          this.idleTicks.set(u.id, 0);
          this.updateBuildOrder(u, u.order);
          break;

        case 'terraform':
          this.idleTicks.set(u.id, 0);
          this.updateTerraformOrder(u, u.order);
          break;

        case 'enter_tunnel':
          this.idleTicks.set(u.id, 0);
          this.updateEnterTunnelOrder(u, u.order);
          break;

        case 'trade':
          this.idleTicks.set(u.id, 0);
          this.updateTradeOrder(u, u.order);
          break;

        case 'attack':
          this.idleTicks.set(u.id, 0);
          this.updateAttackOrder(u, u.order);
          break;

        case 'garrison':
          this.idleTicks.set(u.id, 0);
          this.updateGarrisonOrder(u, u.order);
          break;
      }

      this.applyLocalAvoidance(u);
    }
  }

  private advanceQueuedOrder(u: Entity): void {
    if (u.queuedOrders.length > 0) {
      const next = u.queuedOrders.shift()!;
      u.order = next;
      if (next.type === 'move') {
        u.path = this.navGrid.findPath(u.x, u.z, next.x, next.z);
        u.pathIndex = 0;
      } else if (next.type === 'terraform') {
        const c = this.terrain.tileToWorldCenter(next.tileX, next.tileZ);
        const approach = this.getTerraformApproachPos(u, next.tileX, next.tileZ, c);
        u.path = this.navGrid.findPath(u.x, u.z, approach.x, approach.z);
        u.pathIndex = 0;
      }
    } else {
      u.order = { type: 'idle' };
      u.path = [];
      u.pathIndex = 0;
    }
  }

  /**
   * Flat ground & bridges grant full 1.0x speed; walking uphill slows down proportionally to climb grade,
   * while steep downhill slows slightly for footing.
   */
  getTerrainSlopeSpeedMultiplier(x: number, z: number, dirX: number, dirZ: number): number {
    const curTile = this.terrain.worldToTile(x, z);
    if (this.terrain.isTileBridge(curTile.tx, curTile.tz)) return 1.0;
    const sampleDist = 1.4;
    const h0 = this.terrain.getHeightAt(x, z);
    const h1 = this.terrain.getHeightAt(x + dirX * sampleDist, z + dirZ * sampleDist);
    const grade = (h1 - h0) / sampleDist;
    if (grade > 0.06) {
      return Math.max(0.42, 1.0 - (grade - 0.06) * 0.92);
    }
    if (grade < -0.22) {
      return Math.max(0.84, 1.0 - (Math.abs(grade) - 0.22) * 0.24);
    }
    return 1.0;
  }

  /** Estimates overland walking time from (x0,z0) to (x1,z1), factoring in climb slowdowns & impassable mountain/water detours */
  estimateOverlandTravelTime(x0: number, z0: number, x1: number, z1: number, baseSpeed: number): number {
    const totalDist = Math.hypot(x1 - x0, z1 - z0);
    if (totalDist < 0.5) return 0;
    const samples = Math.min(20, Math.max(6, Math.ceil(totalDist / 3.5)));
    const stepLen = totalDist / samples;
    const dirX = (x1 - x0) / totalDist;
    const dirZ = (z1 - z0) / totalDist;
    let time = 0;
    for (let i = 0; i < samples; i++) {
      const f = (i + 0.5) / samples;
      const sx = x0 + (x1 - x0) * f;
      const sz = z0 + (z1 - z0) * f;
      const st = this.terrain.worldToTile(sx, sz);
      const passable = this.terrain.isTileStaticPassable(st.tx, st.tz);
      if (!passable) {
        time += (stepLen * 1.95) / (baseSpeed * 0.62);
      } else {
        const mult = this.getTerrainSlopeSpeedMultiplier(sx, sz, dirX, dirZ);
        time += stepLen / (baseSpeed * mult);
      }
    }
    return time;
  }

  /** Checks if routing through an operational linked friendly tunnel (treated as flat road!) is faster than overland */
  findFasterTunnelRoute(
    u: Entity,
    goalX: number,
    goalZ: number,
    baseSpeed: number
  ): { enterPortalId: number; exitPortalId: number; savedSec: number } | null {
    const distGoal = Math.hypot(goalX - u.x, goalZ - u.z);
    if (distGoal < 10) return null;

    const overlandTime = this.estimateOverlandTravelTime(u.x, u.z, goalX, goalZ, baseSpeed);
    let best: { enterPortalId: number; exitPortalId: number; savedSec: number } | null = null;
    let bestTime = overlandTime * 0.9;

    for (const portalA of this.entities.values()) {
      if (
        !portalA.alive ||
        !this.isAlliedOrOwn(u.owner, portalA.owner) ||
        portalA.isFoundation ||
        !portalA.linkedTunnelId ||
        !TEMPLATES[portalA.templateId]?.isTunnel
      ) {
        continue;
      }
      const portalB = this.entities.get(portalA.linkedTunnelId);
      if (!portalB || !portalB.alive || portalB.isFoundation) continue;

      const distAfter = Math.hypot(goalX - portalB.x, goalZ - portalB.z);
      if (distAfter >= distGoal - 2.0) continue;

      const toEntranceTime = this.estimateOverlandTravelTime(u.x, u.z, portalA.x, portalA.z, baseSpeed);
      const tunnelFlatDist = Math.hypot(portalB.x - portalA.x, portalB.z - portalA.z);
      const tunnelFlatTime = tunnelFlatDist / (baseSpeed * 1.05);
      const fromExitTime = this.estimateOverlandTravelTime(portalB.x, portalB.z, goalX, goalZ, baseSpeed);
      const totalTunnelTime = toEntranceTime + tunnelFlatTime + fromExitTime;

      if (totalTunnelTime < bestTime) {
        bestTime = totalTunnelTime;
        best = {
          enterPortalId: portalA.id,
          exitPortalId: portalB.id,
          savedSec: overlandTime - totalTunnelTime,
        };
      }
    }
    return best;
  }

  private followPath(u: Entity, goalX: number, goalZ: number, stopDist: number): boolean {
    const dxGoal = goalX - u.x;
    const dzGoal = goalZ - u.z;
    const distGoal = Math.hypot(dxGoal, dzGoal);
    if (distGoal <= stopDist) {
      u.path = [];
      u.pathIndex = 0;
      this.stuckTicks.set(u.id, 0);
      return true;
    }

    const uTpl = TEMPLATES[u.templateId];
    const isNaval = Boolean(uTpl.isNaval);
    const tilePassable = (tx: number, tz: number) =>
      isNaval
        ? this.terrain.isTileWaterNavigable(tx, tz)
        : this.terrain.isTileStaticPassable(tx, tz) && !this.navGrid.isGateBlockedFor(tx, tz, u.owner);
    const findUnitPath = (sx: number, sz: number, gx: number, gz: number) =>
      isNaval ? this.navGrid.findWaterPath(sx, sz, gx, gz) : this.navGrid.findPath(sx, sz, gx, gz, 1800, false, u.owner);

    let speed = uTpl.speed ?? 5.5;
    const ownerPlayer = this.players.get(u.owner);
    if (uTpl.isCavalry) {
      if (ownerPlayer?.civ === 'britons') speed *= 1.1;
      if (ownerPlayer?.researchedTechs.has('tech_cavalry_speed')) speed *= 1.18;
      if (ownerPlayer?.researchedTechs.has('tech_brit_chariots') || ownerPlayer?.researchedTechs.has('tech_sele_cataphract')) {
        speed *= 1.2;
      }
      if (ownerPlayer?.researchedTechs.has('tech_iber_guerrilla')) speed *= 1.22;
    }
    if (isNaval) {
      if (ownerPlayer?.civ === 'athenians') speed *= 1.12;
      if (ownerPlayer?.researchedTechs.has('tech_naval_ram')) speed *= 1.18;
      if (ownerPlayer?.researchedTechs.has('tech_ptol_pharos')) speed *= 1.25;
    }
    if (ownerPlayer && ownerPlayer.skillActiveTimer > 0) {
      if ((ownerPlayer.civ === 'spartans' || ownerPlayer.civ === 'gauls') && !isNaval) {
        speed *= 1.25;
      } else if (ownerPlayer.civ === 'britons' && !isNaval) {
        speed *= 1.35;
      } else if (ownerPlayer.civ === 'iberians' && !isNaval) {
        speed *= 1.28;
      } else if (ownerPlayer.civ === 'macedonians' && uTpl.isCavalry) {
        speed *= 1.25;
      } else if (ownerPlayer.civ === 'persians' && (uTpl.isCavalry || uTpl.attack?.isRanged)) {
        speed *= 1.3;
      } else if (ownerPlayer.civ === 'carthaginians' && (isNaval || uTpl.isCavalry)) {
        speed *= 1.3;
      }
    }

    // Automatic smart Tunnel routing: if traversing a flat friendly tunnel is faster than climbing/detouring overland, take the tunnel!
    if (
      !isNaval &&
      u.order.type !== 'enter_tunnel' &&
      (u.tunnelCooldown ?? 0) <= 0 &&
      distGoal > 12 &&
      (u.path.length === 0 || this.tickCount % 20 === (u.id % 20))
    ) {
      const shortcut = this.findFasterTunnelRoute(u, goalX, goalZ, speed);
      if (shortcut) {
        u.queuedOrders.unshift(u.order);
        u.order = { type: 'enter_tunnel', portalId: shortcut.enterPortalId };
        u.path = [];
        u.pathIndex = 0;
        u.repathTimer = 0;
        return false;
      }
    }

    // 1. Escape recovery: if a unit ever lands on an impassable tile, smoothly step back onto valid ground/water
    const curTile = this.terrain.worldToTile(u.x, u.z);
    if (!tilePassable(curTile.tx, curTile.tz)) {
      const safe = isNaval
        ? this.navGrid.findNearestWater(curTile.tx, curTile.tz, 12)
        : this.navGrid.findNearestWalkable(curTile.tx, curTile.tz, 8);
      if (safe) {
        const safeWorld = this.terrain.tileToWorldCenter(safe.tx, safe.tz);
        const edx = safeWorld.x - u.x;
        const edz = safeWorld.z - u.z;
        const edist = Math.hypot(edx, edz) || 1;
        const estep = Math.min(speed * SIM_DT, edist);
        u.x += (edx / edist) * estep;
        u.z += (edz / edist) * estep;
        u.vx = (edx / edist) * speed;
        u.vz = (edz / edist) * speed;
        u.facing = Math.atan2(edx, edz);
        u.animState = 'walk';
        return false;
      }
    }

    if (u.path.length === 0 && u.repathTimer <= 0) {
      u.path = findUnitPath(u.x, u.z, goalX, goalZ);
      u.pathIndex = 0;
      u.repathTimer = 1.0;
    }

    const wp = u.path[u.pathIndex] ?? { x: goalX, z: goalZ };
    const dx = wp.x - u.x;
    const dz = wp.z - u.z;
    const dist = Math.hypot(dx, dz);

    if (dist < 0.85 && u.pathIndex < u.path.length) {
      u.pathIndex++;
    }

    const activeWp = u.path[u.pathIndex] ?? { x: goalX, z: goalZ };
    const adx = activeWp.x - u.x;
    const adz = activeWp.z - u.z;
    const adist = Math.hypot(adx, adz) || 1;

    const dirX = adx / adist;
    const dirZ = adz / adist;
    const effectiveSpeed = isNaval ? speed : speed * this.getTerrainSlopeSpeedMultiplier(u.x, u.z, dirX, dirZ);
    const step = Math.min(effectiveSpeed * SIM_DT, adist);
    const oldX = u.x;
    const oldZ = u.z;
    const nx = Math.max(4, Math.min(this.terrain.worldSize - 4, u.x + dirX * step));
    const nz = Math.max(4, Math.min(this.terrain.worldSize - 4, u.z + dirZ * step));

    // 2. Step along desired vector, or smoothly slide along X / Z contours
    const nTile = this.terrain.worldToTile(nx, nz);
    let moved = false;
    if (tilePassable(nTile.tx, nTile.tz)) {
      u.x = nx;
      u.z = nz;
      moved = true;
    } else {
      const slideX = Math.max(4, Math.min(this.terrain.worldSize - 4, u.x + dirX * step));
      const slideZ = Math.max(4, Math.min(this.terrain.worldSize - 4, u.z + dirZ * step));
      const txOnly = this.terrain.worldToTile(slideX, u.z);
      const tzOnly = this.terrain.worldToTile(u.x, slideZ);
      const canX = Math.abs(dirX) > 0.12 && tilePassable(txOnly.tx, txOnly.tz);
      const canZ = Math.abs(dirZ) > 0.12 && tilePassable(tzOnly.tx, tzOnly.tz);
      if (canX && (!canZ || Math.abs(dirX) >= Math.abs(dirZ))) {
        u.x = slideX;
        moved = true;
      } else if (canZ) {
        u.z = slideZ;
        moved = true;
      }
    }

    const movedDist = Math.hypot(u.x - oldX, u.z - oldZ);
    if (!moved || movedDist < 0.025) {
      const st = (this.stuckTicks.get(u.id) ?? 0) + 1;
      this.stuckTicks.set(u.id, st);
      if (st === 6 || st === 18) {
        u.path = findUnitPath(u.x, u.z, goalX, goalZ);
        u.pathIndex = 0;
        u.repathTimer = 0.6;
      } else if (st >= 30) {
        // Unreachable cliff/obstacle directly blocking move destination: arrive cleanly at closest foothold.
        // NEVER fake arrival for gather/build/attack orders (prevents workers swinging at empty air!).
        this.stuckTicks.set(u.id, 0);
        if (u.order.type === 'move') {
          u.path = [];
          u.pathIndex = 0;
          return true;
        }
        if (u.order.type === 'gather' && !u.order.returning && distGoal > stopDist + 0.5) {
          // Blocked from reaching this exact resource (e.g. crowded forest interior): switch to another reachable resource!
          const curTargetId = u.order.targetId;
          let alt: Entity | null = null;
          let bestD = 32;
          for (const e of this.entities.values()) {
            if (!e.alive || e.id === curTargetId || e.resourceRemaining <= 0) continue;
            const eTpl = TEMPLATES[e.templateId];
            if (eTpl.resourceType !== u.order.resourceType || Boolean(eTpl.isAquatic) !== isNaval) continue;
            if (eTpl.kind === 'building' && e.owner !== u.owner) continue;
            const d = Math.hypot(e.x - u.x, e.z - u.z);
            if (d < bestD) {
              bestD = d;
              alt = e;
            }
          }
          if (alt) {
            u.order.targetId = alt.id;
            u.path = findUnitPath(u.x, u.z, alt.x, alt.z);
            u.pathIndex = 0;
            u.repathTimer = 0.8;
            u.animState = 'walk';
            return false;
          }
        }
        u.path = findUnitPath(u.x, u.z, goalX, goalZ);
        u.pathIndex = 0;
        u.repathTimer = 0.8;
      }
    } else {
      this.stuckTicks.set(u.id, 0);
    }

    u.vx = (u.x - oldX) / SIM_DT;
    u.vz = (u.z - oldZ) / SIM_DT;
    u.facing = Math.atan2(adx, adz);
    u.animState = 'walk';
    return false;
  }

  private applyLocalAvoidance(u: Entity): void {
    const uTpl = TEMPLATES[u.templateId];
    const uRad = uTpl.radius;
    const isNaval = Boolean(uTpl.isNaval);
    const activeTargetId =
      u.order.type === 'gather' || u.order.type === 'build' ? u.order.targetId : null;
    const isWorkingAtTarget = u.animState === 'gather' || u.animState === 'build';
    const nearby = this.spatialHash.queryRadius(u.x, u.z, uRad + 3.2, this.queryBuf);
    let pushX = 0;
    let pushZ = 0;

    for (let i = 0; i < nearby.length; i++) {
      const other = nearby[i];
      if (other.id === u.id || !other.alive || other.garrisonedIn !== null) continue;
      const oTpl = TEMPLATES[other.templateId];
      if (oTpl.isFarmField) continue;
      // Land units march smoothly across completed Stone Bridges!
      if (oTpl.isBridge && !other.isFoundation) continue;
      // Friendly & Allied units pass freely through City Gates!
      if (oTpl.isGate && this.isAlliedOrOwn(u.owner, other.owner) && !other.isFoundation) continue;

      const isOwnTarget = activeTargetId !== null && other.id === activeTargetId;
      // Don't shove a worker back away from the very tree/mine/building they are actively swinging at
      if (isOwnTarget && isWorkingAtTarget) continue;

      const minDist = isOwnTarget
        ? uRad + oTpl.radius - 0.04
        : uRad + oTpl.radius + (oTpl.kind === 'unit' ? 0.08 : 0.12);
      let dx = u.x - other.x;
      let dz = u.z - other.z;
      const d2 = dx * dx + dz * dz;
      if (d2 >= minDist * minDist) continue;

      let dist = Math.sqrt(d2);
      if (dist < 0.001) {
        dx = ((u.id * 17) % 11) - 5;
        dz = ((u.id * 31) % 11) - 5;
        dist = Math.hypot(dx, dz) || 1;
      }

      const overlap = minDist - dist;
      const weight = isOwnTarget ? 0.25 : oTpl.kind === 'unit' ? 0.35 : 0.9;
      pushX += (dx / dist) * overlap * weight;
      pushZ += (dz / dist) * overlap * weight;
    }

    if (pushX !== 0 || pushZ !== 0) {
      const maxPush = 0.35;
      const pLen = Math.hypot(pushX, pushZ);
      if (pLen > maxPush) {
        pushX = (pushX / pLen) * maxPush;
        pushZ = (pushZ / pLen) * maxPush;
      }
      const nx = Math.max(4, Math.min(this.terrain.worldSize - 4, u.x + pushX));
      const nz = Math.max(4, Math.min(this.terrain.worldSize - 4, u.z + pushZ));
      const t = this.terrain.worldToTile(nx, nz);
      const ok = isNaval
        ? this.terrain.isTileWaterNavigable(t.tx, t.tz)
        : this.terrain.isTileStaticPassable(t.tx, t.tz);
      if (ok) {
        u.x = nx;
        u.z = nz;
      }
    }
  }

  private updateMoveOrder(u: Entity, order: Extract<UnitOrder, { type: 'move' }>): void {
    if (order.attackMove && u.stance !== 'passive') {
      if (this.tryAutoAcquireEnemy(u)) return;
    }
    const arrived = this.followPath(u, order.x, order.z, 0.85);
    if (arrived) {
      u.guardX = u.x;
      u.guardZ = u.z;
      this.advanceQueuedOrder(u);
    }
  }

  private updateGatherOrder(u: Entity, order: Extract<UnitOrder, { type: 'gather' }>): void {
    const uTpl = TEMPLATES[u.templateId];
    const gather = uTpl.gather;
    if (!gather) {
      u.order = { type: 'idle' };
      return;
    }
    const isNaval = Boolean(uTpl.isNaval);

    const player = this.players.get(u.owner);
    if (!player) return;

    // Returning to drop-off building (Dock for Fishing Boats)
    if (order.returning) {
      let dropOff = order.dropOffId ? this.entities.get(order.dropOffId) : undefined;
      if (!dropOff || !dropOff.alive || dropOff.owner !== u.owner || dropOff.isFoundation) {
        dropOff = this.findNearestDropOff(u.owner, u.x, u.z, order.resourceType, isNaval) ?? undefined;
        order.dropOffId = dropOff?.id;
      }
      if (!dropOff) {
        u.order = { type: 'idle' };
        return;
      }

      const dTpl = TEMPLATES[dropOff.templateId];
      const dropStop = isNaval ? dTpl.radius + uTpl.radius + 2.4 : dTpl.radius + uTpl.radius + 0.55;
      const arrived = this.followPath(u, dropOff.x, dropOff.z, dropStop);
      if (arrived) {
        if (u.carryType && u.carryAmount > 0) {
          const amount = Math.round(u.carryAmount);
          player.resources[u.carryType] += amount;
          player.stats.resourcesGathered += amount;
          u.carryAmount = 0;
        }
        order.returning = false;
        const target = this.entities.get(order.targetId);
        if (target && target.alive && target.resourceRemaining > 0) {
          const tAquatic = Boolean(TEMPLATES[target.templateId]?.isAquatic);
          const stand = !isNaval && tAquatic ? this.getShoreFishingStandPos(target, u.x, u.z) : null;
          const gx = stand ? stand.x : target.x;
          const gz = stand ? stand.z : target.z;
          u.path = isNaval
            ? this.navGrid.findWaterPath(u.x, u.z, gx, gz)
            : this.navGrid.findPath(u.x, u.z, gx, gz, 4500, false, u.owner);
          u.pathIndex = 0;
        }
      }
      return;
    }

    // Moving to & harvesting resource
    let target = this.entities.get(order.targetId);
    if (!target || !target.alive || target.resourceRemaining <= 0) {
      const replacement = this.findNearestResource(u.x, u.z, order.resourceType, u.owner, isNaval ? 95 : 48, isNaval);
      if (replacement) {
        order.targetId = replacement.id;
        target = replacement;
        u.path = isNaval
          ? this.navGrid.findWaterPath(u.x, u.z, target.x, target.z)
          : this.navGrid.findPath(u.x, u.z, target.x, target.z);
        u.pathIndex = 0;
      } else {
        if (u.carryAmount > 0) {
          order.returning = true;
        } else if (!isNaval && !this.tryAutoWorkForIdleUnit(u, true)) {
          u.order = { type: 'idle' };
        } else if (isNaval) {
          u.order = { type: 'idle' };
        }
        return;
      }
    }

    let tTpl = TEMPLATES[target.templateId];
    const isShoreFishing = !isNaval && Boolean(tTpl.isAquatic);
    const isPrey =
      target.templateId === 'deer_herd' ||
      target.templateId === 'wild_boar' ||
      Boolean(tTpl.isPassiveFauna) ||
      Boolean(tTpl.isPredator);
    const isHuntingLivePrey = isPrey && target.hp > 0;
    let stopDist: number;
    let moveGoalX = target.x;
    let moveGoalZ = target.z;
    if (isShoreFishing) {
      const stand = this.getShoreFishingStandPos(target, u.x, u.z);
      if (!stand) {
        u.order = { type: 'idle' };
        u.animState = 'idle';
        return;
      }
      moveGoalX = stand.x;
      moveGoalZ = stand.z;
      stopDist = 1.25;
    } else if (tTpl.isFarmField) {
      stopDist = tTpl.radius * 0.72;
    } else if (tTpl.isAquatic) {
      stopDist = tTpl.radius + uTpl.radius + 0.9;
    } else if (isHuntingLivePrey && uTpl.attack?.isRanged) {
      // Ranged hunters can loose arrows/javelins at hunting range, then walk right up to butcher the carcass
      stopDist = Math.min(8.5, Math.max(tTpl.radius + uTpl.radius + 0.35, uTpl.attack.range * 0.65));
    } else if (order.resourceType === 'wood') {
      stopDist = tTpl.radius + uTpl.radius + 0.34;
    } else if (order.resourceType === 'stone' || order.resourceType === 'metal') {
      stopDist = tTpl.radius + uTpl.radius + 0.42;
    } else {
      stopDist = tTpl.radius + uTpl.radius + 0.28;
    }

    // Repath frequently when chasing moving live wildlife
    if (isHuntingLivePrey && u.repathTimer <= 0) {
      u.path = this.navGrid.findPath(u.x, u.z, moveGoalX, moveGoalZ, 4500, false, u.owner);
      u.pathIndex = 0;
      u.repathTimer = 0.45;
    }

    let arrived = this.followPath(u, moveGoalX, moveGoalZ, stopDist);

    // If walking into a dense forest to chop wood and another alive tree is right within arm's reach, chop it cleanly
    if (!arrived && order.resourceType === 'wood' && Math.hypot(target.x - u.x, target.z - u.z) < 6.5) {
      const nearTree = this.findNearestResource(u.x, u.z, 'wood', u.owner, uTpl.radius + 1.35);
      if (nearTree && nearTree.id !== target.id) {
        order.targetId = nearTree.id;
        target = nearTree;
        tTpl = TEMPLATES[target.templateId];
        stopDist = tTpl.radius + uTpl.radius + 0.34;
        arrived = Math.hypot(target.x - u.x, target.z - u.z) <= stopDist;
      }
    }
    if (!arrived) return;

    // Strict physical proximity & validity guard: NEVER harvest empty air!
    const actualDist = Math.hypot(target.x - u.x, target.z - u.z);
    const maxValidDist = isShoreFishing ? World.SHORE_FISH_REACH_METERS + 1.25 : stopDist + 0.55;
    if (!target.alive || target.resourceRemaining <= 0 || actualDist > maxValidDist) {
      u.animState = 'idle';
      return;
    }

    u.facing = Math.atan2(target.x - u.x, target.z - u.z);

    // Two-phase Hunting for live wildlife (deer & boar): prey flees or fights back before collapsing!
    if (isPrey && target.hp > 0) {
      u.animState = 'attack';
      const huntDps = uTpl.isWoman ? 26 : 36;
      target.hp = Math.max(0, target.hp - huntDps * SIM_DT);
      const existing = this.wildlifeState.get(target.id);
      this.wildlifeState.set(target.id, {
        hunterId: u.id,
        alertTimer: 4.5,
        attackCooldown: existing?.attackCooldown ?? 0.55,
      });
      if (this.tickCount % 18 === (u.id % 18)) {
        this.events.push({ type: 'attack_swing', x: target.x, z: target.z, isRanged: Boolean(uTpl.attack?.isRanged) });
      }
      return;
    }

    u.animState = 'gather';

    // Authentic 0 A.D. gather rate: civ bonus + tech bonus + citizen-soldier rank adjustment
    const civ = CIVS[player.civ];
    let rate = gather[order.resourceType];
    rate *= civ.gatherMultiplier[order.resourceType] ?? 1.0;
    if (player.researchedTechs.has('tech_gather_tools')) rate *= 1.25;
    if (player.researchedTechs.has('tech_coinage')) rate *= 1.1;
    if (
      player.researchedTechs.has('tech_pers_satrapy') ||
      player.researchedTechs.has('tech_han_silkroad') ||
      player.researchedTechs.has('tech_iber_metallurgy') ||
      player.researchedTechs.has('tech_kush_pyramids') ||
      player.researchedTechs.has('tech_maur_edicts')
    ) {
      rate *= 1.25;
    }
    if (player.researchedTechs.has('tech_ptol_nile')) rate *= isNaval ? 1.3 : 1.25;
    if (isNaval) {
      if (player.researchedTechs.has('tech_naval_hull')) rate *= 1.25;
      if (player.researchedTechs.has('tech_carth_colonization')) rate *= 1.2;
      if (player.skillActiveTimer > 0 && player.civ === 'carthaginians') rate *= 1.25;
    }
    if (player.skillActiveTimer > 0 && player.civ === 'athenians') rate *= 1.25;
    if (player.skillActiveTimer > 0 && player.civ === 'ptolemies') rate *= 1.35;
    if (uTpl.isCitizenSoldier) {
      rate *= u.rank === 1 ? 1.0 : u.rank === 2 ? 0.9 : 0.8;
    }

    const delta = Math.min(rate * SIM_DT, target.resourceRemaining, gather.capacity - u.carryAmount);
    u.carryType = order.resourceType;
    u.carryAmount += delta;
    target.resourceRemaining -= delta;

    if (this.tickCount % 16 === (u.id % 16)) {
      this.events.push({ type: 'gather_tick', x: target.x, z: target.z, resourceType: order.resourceType });
    }

    if (target.resourceRemaining <= 0.01) {
      target.resourceRemaining = 0;
      if (!tTpl.isFarmField) {
        target.alive = false;
      } else {
        // Renewable Mediterranean grain field slowly replants automatically
        target.resourceRemaining = tTpl.farmFoodTotal ?? 1600;
      }
    }

    if (u.carryAmount >= gather.capacity - 0.01) {
      order.returning = true;
      const drop = this.findNearestDropOff(u.owner, u.x, u.z, order.resourceType, isNaval);
      if (drop) {
        order.dropOffId = drop.id;
        u.path = isNaval
          ? this.navGrid.findWaterPath(u.x, u.z, drop.x, drop.z)
          : this.navGrid.findPath(u.x, u.z, drop.x, drop.z);
        u.pathIndex = 0;
      }
    }
  }

  private updateBuildOrder(u: Entity, order: Extract<UnitOrder, { type: 'build' }>): void {
    const target = this.entities.get(order.targetId);
    const uTpl = TEMPLATES[u.templateId];
    if (!target || !target.alive || target.owner !== u.owner || !uTpl.gather || !uTpl.canBuild || uTpl.canBuild.length === 0) {
      u.order = { type: 'idle' };
      return;
    }

    const tTpl = TEMPLATES[target.templateId];
    const isTunnelFoundation = Boolean(tTpl.isTunnel && target.isFoundation && target.linkedTunnelId);
    const partnerPortal = isTunnelFoundation && target.linkedTunnelId ? this.entities.get(target.linkedTunnelId) : null;
    const buildReach = tTpl.isBridge ? 3.8 : tTpl.radius + uTpl.radius + 0.38;

    if (isTunnelFoundation && partnerPortal && partnerPortal.alive) {
      if (!order.inShaft) {
        const distToPortal = Math.hypot(target.x - u.x, target.z - u.z);
        if (distToPortal > buildReach + 1.0) {
          const approach = this.getTerraformApproachPos(u, target.tileX, target.tileZ, { x: target.x, z: target.z });
          const arrived = this.followPath(u, approach.x, approach.z, 1.8);
          if (!arrived) return;
        }
        order.inShaft = true;
        u.path = [];
        u.pathIndex = 0;
      }
      // Position digging worker underground right at the active excavation face so Tunnel X-Ray shows them digging!
      const dx = partnerPortal.x - target.x;
      const dz = partnerPortal.z - target.z;
      const len = Math.max(0.1, Math.hypot(dx, dz));
      const frac = Math.max(0.04, Math.min(0.96, target.buildProgress));
      const lateral = ((u.id % 3) - 1) * 0.42;
      const perpX = -dz / len;
      const perpZ = dx / len;
      const targetX = target.x + dx * frac + perpX * lateral;
      const targetZ = target.z + dz * frac + perpZ * lateral;
      u.x += (targetX - u.x) * Math.min(1, SIM_DT * 8);
      u.z += (targetZ - u.z) * Math.min(1, SIM_DT * 8);
      u.facing = Math.atan2(dx, dz);
      u.animState = 'gather';
    } else {
      const distToTarget = Math.hypot(target.x - u.x, target.z - u.z);
      if (distToTarget > buildReach) {
        const goal = tTpl.isBridge
          ? this.getTerraformApproachPos(u, target.tileX, target.tileZ, { x: target.x, z: target.z })
          : { x: target.x, z: target.z };
        const arrived = this.followPath(u, goal.x, goal.z, tTpl.isBridge ? 1.4 : buildReach);
        if (!arrived) return;
      }
      u.facing = Math.atan2(target.x - u.x, target.z - u.z);
      u.animState = 'build';
    }

    if (target.isFoundation) {
      const buildTime = tTpl.buildTime ?? 18;
      const builderOwner = this.players.get(u.owner);
      const buildBonus =
        (builderOwner?.researchedTechs.has('tech_rome_corvus') ? 1.4 : 1.0) * (builderOwner?.fastBuildCheat ? 25 : 1.0);
      const speedRatio = (uTpl.gather.buildRate / 20) * buildBonus;

      if (tTpl.isTunnel && target.tunnelTotalUnits && target.tunnelTotalUnits > 0) {
        // Tunnel excavation: 100 soil units per tile; normal worker digs ~1 unit per 0.35s (~35s/tile solo)
        const unitsDug = SIM_DT * (1 / 0.35) * speedRatio;
        target.tunnelDugUnits = Math.min(target.tunnelTotalUnits, (target.tunnelDugUnits ?? 0) + unitsDug);
        target.buildProgress = target.tunnelDugUnits / target.tunnelTotalUnits;
        target.hp = Math.min(target.maxHp, Math.max(25, Math.round(target.maxHp * Math.max(0.1, target.buildProgress))));
        if (target.linkedTunnelId) {
          const partner = this.entities.get(target.linkedTunnelId);
          if (partner && partner.alive) {
            partner.tunnelDugUnits = target.tunnelDugUnits;
            partner.buildProgress = target.buildProgress;
            partner.hp = target.hp;
          }
        }
      } else {
        const progressDelta = (SIM_DT / buildTime) * speedRatio;
        target.buildProgress = Math.min(1, target.buildProgress + progressDelta);
        target.hp = Math.min(target.maxHp, target.hp + target.maxHp * progressDelta);
      }

      if (target.buildProgress >= 1) {
        target.isFoundation = false;
        target.hp = target.maxHp;
        target.capturePoints = { [target.owner]: target.captureMax };
        if (tTpl.isGate) {
          target.gateMode = target.gateMode ?? 'auto';
          target.gateOpenAmount = 0;
          this.syncGateNavTiles(target, true);
        }
        if (tTpl.isBridge) {
          this.terrain.setBridgeTile(target.tileX, target.tileZ, true);
        }
        if (tTpl.isTunnel) {
          let exitPortal = target;
          if (target.linkedTunnelId) {
            const partner = this.entities.get(target.linkedTunnelId);
            if (partner && partner.alive && partner.isFoundation) {
              partner.isFoundation = false;
              partner.buildProgress = 1;
              partner.hp = partner.maxHp;
              partner.capturePoints = { [partner.owner]: partner.captureMax };
              exitPortal = partner;
            }
          } else {
            this.linkTunnelPortal(target);
          }
          // Pop all underground tunnel diggers out safely onto walkable ground at the completed tunnel exit!
          for (const digger of this.entities.values()) {
            if (
              digger.alive &&
              digger.order.type === 'build' &&
              digger.order.inShaft &&
              (digger.order.targetId === target.id || digger.order.targetId === target.linkedTunnelId)
            ) {
              const safe = this.navGrid.findNearestWalkable(exitPortal.tileX, exitPortal.tileZ, 4, exitPortal.tileX, exitPortal.tileZ, digger.owner);
              const out = safe ? this.terrain.tileToWorldCenter(safe.tx, safe.tz) : { x: exitPortal.x, z: exitPortal.z };
              digger.x = out.x;
              digger.z = out.z;
              digger.prevX = out.x;
              digger.prevZ = out.z;
              digger.order.inShaft = false;
            }
          }
        }
        this.territoryDirty = true;
        this.recomputePopulations();
        const player = this.players.get(target.owner);
        if (player) player.stats.buildingsConstructed++;

        this.events.push({
          type: 'building_complete',
          playerId: target.owner,
          x: target.x,
          z: target.z,
          templateId: target.templateId,
        });

        // Auto-farm if they just built a Wheat Field!
        if (tTpl.isFarmField) {
          u.order = { type: 'gather', targetId: target.id, resourceType: 'food', returning: false };
          return;
        }
        // Advance queued build orders (e.g. continuous dragged wall segments)
        if (u.queuedOrders.length > 0) {
          this.advanceQueuedOrder(u);
          return;
        }
        // Or help another nearby foundation
        const nearbyFoundation = this.findNearestFoundation(u.owner, u.x, u.z, 22);
        if (nearbyFoundation) {
          u.order = { type: 'build', targetId: nearbyFoundation.id };
          return;
        }
        // If they just built a Storehouse or Farmstead, start gathering the closest matching resource!
        if (tTpl.dropOffTypes && tTpl.dropOffTypes.length > 0) {
          let bestRes: Entity | null = null;
          let bestD2 = 28 * 28;
          for (const rt of tTpl.dropOffTypes) {
            const cand = this.findNearestResource(target.x, target.z, rt, u.owner, 28);
            if (cand) {
              const d2 = (cand.x - target.x) * (cand.x - target.x) + (cand.z - target.z) * (cand.z - target.z);
              if (d2 < bestD2) {
                bestD2 = d2;
                bestRes = cand;
              }
            }
          }
          if (bestRes) {
            const rt = TEMPLATES[bestRes.templateId].resourceType!;
            u.order = { type: 'gather', targetId: bestRes.id, resourceType: rt, returning: false };
            u.path = this.navGrid.findPath(u.x, u.z, bestRes.x, bestRes.z);
            u.pathIndex = 0;
            return;
          }
        }
        if (!this.tryAutoWorkForIdleUnit(u, true)) {
          u.order = { type: 'idle' };
        }
      }
    } else if (target.hp < target.maxHp) {
      target.hp = Math.min(target.maxHp, target.hp + uTpl.gather.buildRate * 0.8 * SIM_DT);
      if (target.hp >= target.maxHp) {
        if (!this.tryAutoWorkForIdleUnit(u, true)) {
          u.order = { type: 'idle' };
        }
      }
    } else {
      u.order = { type: 'idle' };
    }
  }

  private updateTerraformOrder(u: Entity, order: Extract<UnitOrder, { type: 'terraform' }>): void {
    const epochTx = order.mode === 'raise' ? order.destTileX : order.tileX;
    const epochTz = order.mode === 'raise' ? order.destTileZ : order.tileZ;
    const jobAlreadyCompleted = this.terrain.getTerraformEpoch(epochTx, epochTz) > order.startEpoch;

    // Multi-worker cooperation: once this tile's 100-unit layer finishes, ALL collaborating workers stop instead of digging deeper!
    if (jobAlreadyCompleted && (order.stage === 'scoop' || u.carryAmount <= 0)) {
      u.carryType = null;
      u.carryAmount = 0;
      this.advanceQueuedOrder(u);
      return;
    }

    const activeTx = order.stage === 'scoop' ? order.tileX : order.destTileX;
    const activeTz = order.stage === 'scoop' ? order.tileZ : order.destTileZ;
    if (!this.canTerraformTile(activeTx, activeTz)) {
      this.advanceQueuedOrder(u);
      return;
    }

    const center = this.terrain.tileToWorldCenter(activeTx, activeTz);
    const targetPassable = this.terrain.isTileStaticPassable(activeTx, activeTz);
    const distToCenter = Math.hypot(center.x - u.x, center.z - u.z);
    const workReach = targetPassable ? 3.8 : 5.6;

    if (distToCenter > workReach) {
      const approach = this.getTerraformApproachPos(u, activeTx, activeTz, center);
      const arrived = this.followPath(u, approach.x, approach.z, targetPassable ? 3.6 : 1.4);
      if (!arrived) return;
    }

    u.facing = Math.atan2(center.x - u.x, center.z - u.z);
    u.animState = 'gather';

    const player = this.players.get(u.owner);
    const fast = Boolean(player?.fastBuildCheat);
    const speedMult = fast ? 25 : 1;
    // 100 units of soil per tile; each normal worker digs 1 unit per ~0.45s swing and hauls it to the dump tile!
    const duration = order.mode === 'level' ? 0.42 : order.stage === 'scoop' ? 0.45 : 0.3;
    order.progress += (SIM_DT * speedMult) / duration;

    if (order.progress >= 1.0) {
      order.progress = 0;
      const unitsPerTrip = fast ? 10 : 1;

      if (order.mode === 'level') {
        if (this.terrain.getTerraformEpoch(order.tileX, order.tileZ) > order.startEpoch) {
          this.advanceQueuedOrder(u);
          return;
        }
        const res = this.terrain.levelSoilUnit(order.tileX, order.tileZ, unitsPerTrip);
        if (res.leveled) {
          this.events.push({ type: 'gather_tick', x: center.x, z: center.z, resourceType: 'stone' });
          this.advanceQueuedOrder(u);
        }
        return;
      }

      if (order.stage === 'scoop') {
        if (this.terrain.getTerraformEpoch(epochTx, epochTz) > order.startEpoch) {
          this.advanceQueuedOrder(u);
          return;
        }
        const res = this.terrain.digSoilUnit(order.tileX, order.tileZ, unitsPerTrip);
        if (res.subsided) {
          this.events.push({ type: 'gather_tick', x: center.x, z: center.z, resourceType: 'stone' });
          this.nudgeUnitsOutOfWater(center.x, center.z);
        }
        u.carryType = 'stone';
        u.carryAmount = unitsPerTrip;
        order.stage = 'dump';

        const dumpCenter = this.terrain.tileToWorldCenter(order.destTileX, order.destTileZ);
        const dumpApproach = this.getTerraformApproachPos(u, order.destTileX, order.destTileZ, dumpCenter);
        u.path = this.navGrid.findPath(u.x, u.z, dumpApproach.x, dumpApproach.z);
        u.pathIndex = 0;
        u.repathTimer = 1.0;
      } else {
        const hauled = Math.max(1, Math.round(u.carryAmount || unitsPerTrip));
        const res = this.terrain.depositSoilUnit(order.destTileX, order.destTileZ, hauled);
        u.carryType = null;
        u.carryAmount = 0;

        if (res.raised) {
          this.events.push({ type: 'gather_tick', x: center.x, z: center.z, resourceType: 'stone' });
          this.nudgeUnitsOutOfWater(center.x, center.z);
        }

        // Stop cleanly once this 1-layer (100-unit) terraform epoch completes — assisting workers NEVER dig a second layer!
        const finishedLayer = this.terrain.getTerraformEpoch(epochTx, epochTz) > order.startEpoch;

        if (finishedLayer) {
          this.advanceQueuedOrder(u);
        } else {
          order.stage = 'scoop';
          const srcCenter = this.terrain.tileToWorldCenter(order.tileX, order.tileZ);
          const srcApproach = this.getTerraformApproachPos(u, order.tileX, order.tileZ, srcCenter);
          u.path = this.navGrid.findPath(u.x, u.z, srcApproach.x, srcApproach.z);
          u.pathIndex = 0;
          u.repathTimer = 1.0;
        }
      }
    }
  }

  private nudgeUnitsOutOfWater(cx: number, cz: number): void {
    for (const e of this.entities.values()) {
      if (!e.alive || e.garrisonedIn !== null) continue;
      const eTpl = TEMPLATES[e.templateId];
      if (eTpl.kind !== 'unit' || eTpl.isNaval) continue;
      if (Math.hypot(e.x - cx, e.z - cz) > 6.5) continue;
      const et = this.terrain.worldToTile(e.x, e.z);
      if (!this.terrain.isTileStaticPassable(et.tx, et.tz)) {
        const safe = this.navGrid.findNearestWalkable(et.tx, et.tz, 6, et.tx, et.tz);
        if (safe) {
          const safePos = this.terrain.tileToWorldCenter(safe.tx, safe.tz);
          e.x = safePos.x;
          e.z = safePos.z;
        }
      }
    }
  }

  private updateEnterTunnelOrder(u: Entity, order: Extract<UnitOrder, { type: 'enter_tunnel' }>): void {
    const portal = this.entities.get(order.portalId);
    const exitId = order.exitPortalId ?? portal?.linkedTunnelId ?? null;
    const exit = exitId ? this.entities.get(exitId) : null;
    if (!exit || !exit.alive || exit.isFoundation) {
      this.advanceQueuedOrder(u);
      return;
    }

    const uTpl = TEMPLATES[u.templateId];
    const flatSpeed = (uTpl.speed ?? 5.5) * 1.05;

    // Phase 2: Unit is travelling inside the flat underground tunnel at full flat-road speed!
    if (order.transitRemaining !== undefined && order.transitRemaining > 0) {
      order.transitRemaining = Math.max(0, order.transitRemaining - SIM_DT);
      const dx = exit.x - u.x;
      const dz = exit.z - u.z;
      const remDist = Math.hypot(dx, dz);
      if (remDist > 0.1) {
        const moveStep = Math.min(remDist, flatSpeed * SIM_DT);
        u.x += (dx / remDist) * moveStep;
        u.z += (dz / remDist) * moveStep;
        u.facing = Math.atan2(dx, dz);
      }
      u.animState = 'walk';
      if (order.transitRemaining > 0) return;

      // Emerge straight OUT THROUGH the exit portal's outward-facing archway door (+Z rotated by exit.facing)!
      const pTpl = TEMPLATES[exit.templateId];
      const doorDist = pTpl.radius + 1.15;
      const doorX = Math.max(4, Math.min(this.terrain.worldSize - 4, exit.x + Math.sin(exit.facing) * doorDist));
      const doorZ = Math.max(4, Math.min(this.terrain.worldSize - 4, exit.z + Math.cos(exit.facing) * doorDist));
      const doorTile = this.terrain.worldToTile(doorX, doorZ);
      let outPos: { x: number; z: number };
      if (this.navGrid.isWalkableFor(doorTile.tx, doorTile.tz, u.owner)) {
        outPos = { x: doorX, z: doorZ };
      } else {
        const exitTile = this.navGrid.findNearestWalkable(doorTile.tx, doorTile.tz, 4, doorTile.tx, doorTile.tz, u.owner);
        outPos = exitTile ? this.terrain.tileToWorldCenter(exitTile.tx, exitTile.tz) : { x: doorX, z: doorZ };
      }
      // Step smoothly out from the archway threshold (so the player sees them walk straight through the exit door!)
      const threshX = exit.x + Math.sin(exit.facing) * 0.9;
      const threshZ = exit.z + Math.cos(exit.facing) * 0.9;
      u.x = outPos.x;
      u.z = outPos.z;
      u.prevX = threshX;
      u.prevZ = threshZ;
      u.facing = exit.facing;
      u.guardX = outPos.x;
      u.guardZ = outPos.z;
      u.path = [];
      u.pathIndex = 0;
      u.tunnelCooldown = 2.5;
      this.advanceQueuedOrder(u);
      return;
    }

    // Phase 1: Walk straight up to the entrance portal's front doorway (+Z)
    if (!portal || !portal.alive || portal.isFoundation || !portal.linkedTunnelId) {
      this.advanceQueuedOrder(u);
      return;
    }
    const pTpl = TEMPLATES[portal.templateId];
    const frontX = Math.max(4, Math.min(this.terrain.worldSize - 4, portal.x + Math.sin(portal.facing) * (pTpl.radius + 0.9)));
    const frontZ = Math.max(4, Math.min(this.terrain.worldSize - 4, portal.z + Math.cos(portal.facing) * (pTpl.radius + 0.9)));
    const dist = Math.hypot(frontX - u.x, frontZ - u.z);
    if (dist > 1.85) {
      const arrived = this.followPath(u, frontX, frontZ, 1.55);
      if (!arrived) return;
    }

    // Enter underground flat passage!
    const tunnelDist = Math.hypot(exit.x - portal.x, exit.z - portal.z);
    const totalDur = Math.max(0.25, tunnelDist / flatSpeed);
    order.exitPortalId = exit.id;
    order.transitTotal = totalDur;
    order.transitRemaining = totalDur;
    u.x = portal.x;
    u.z = portal.z;
    u.prevX = portal.x;
    u.prevZ = portal.z;
    u.path = [];
    u.pathIndex = 0;
  }

  private updateTradeOrder(u: Entity, order: Extract<UnitOrder, { type: 'trade' }>): void {
    const home = this.entities.get(order.homeMarketId);
    const target = this.entities.get(order.targetMarketId);
    if (
      !home ||
      !home.alive ||
      home.isFoundation ||
      !this.isAlliedOrOwn(u.owner, home.owner) ||
      !target ||
      !target.alive ||
      target.isFoundation ||
      !this.isAlliedOrOwn(u.owner, target.owner) ||
      home.id === target.id
    ) {
      // Attempt automatic re-pairing if another pair of friendly/allied Markets exists
      const pair = this.findFarthestMarketPair(u.owner);
      if (pair) {
        order.homeMarketId = pair[0].id;
        order.targetMarketId = pair[1].id;
        order.leg = 'toTarget';
        u.path = [];
        return;
      }
      u.order = { type: 'idle' };
      return;
    }

    const dest = order.leg === 'toTarget' ? target : home;
    const destTpl = TEMPLATES[dest.templateId];
    const uTpl = TEMPLATES[u.templateId];
    const arrived = this.followPath(u, dest.x, dest.z, destTpl.radius + uTpl.radius + 1.15);
    if (!arrived) return;

    // Delivered cargo between two Markets -> earn Gold Coins (Metal) proportional to route distance, trade techs & 0 A.D. allied bonus!
    const player = this.players.get(u.owner);
    if (player) {
      const routeDist = Math.hypot(target.x - home.x, target.z - home.z);
      let tradeMult = home.owner !== target.owner ? 1.25 : 1.0; // Authentic 0 A.D. +25% foreign allied market trade bonus!
      if (player.researchedTechs.has('tech_coinage')) tradeMult += 0.5;
      if (player.researchedTechs.has('tech_pers_satrapy')) tradeMult += 0.4;
      if (player.researchedTechs.has('tech_carth_colonization') || player.researchedTechs.has('tech_han_silkroad')) {
        tradeMult += 0.5;
      }
      const goldEarned = Math.max(12, Math.round(routeDist * 0.48 * tradeMult));
      player.resources.metal += goldEarned;
      player.stats.resourcesGathered += goldEarned;
      u.carryType = 'metal';
      u.carryAmount = goldEarned;
      order.cargoGold = goldEarned;
      this.events.push({
        type: 'trade_payout',
        playerId: u.owner,
        x: dest.x,
        z: dest.z,
        amount: goldEarned,
      });
    }

    // Reverse leg and shuttle continuously back to the other Market!
    order.leg = order.leg === 'toTarget' ? 'toHome' : 'toTarget';
    u.path = [];
    u.pathIndex = 0;
    u.repathTimer = 0;
  }

  private updateGarrisonOrder(u: Entity, order: Extract<UnitOrder, { type: 'garrison' }>): void {
    const building = this.entities.get(order.targetId);
    if (!building || !building.alive || building.owner !== u.owner || building.isFoundation) {
      u.order = { type: 'idle' };
      return;
    }
    const bTpl = TEMPLATES[building.templateId];
    const cap = this.getMaxGarrisonCapacity(building);
    if (building.garrisonedIds.length >= cap) {
      u.order = { type: 'idle' };
      return;
    }

    const arrived = this.followPath(u, building.x, building.z, bTpl.radius + 1.5);
    if (arrived) {
      u.garrisonedIn = building.id;
      u.order = { type: 'idle' };
      u.path = [];
      building.garrisonedIds.push(u.id);
    }
  }

  private updateAttackOrder(u: Entity, order: Extract<UnitOrder, { type: 'attack' }>): void {
    const target = this.entities.get(order.targetId);
    const uTpl = TEMPLATES[u.templateId];
    const atk = uTpl.attack;

    if (
      !target ||
      !target.alive ||
      target.hp <= 0 ||
      target.owner === u.owner ||
      !this.areHostile(u.owner, target.owner) ||
      target.garrisonedIn !== null ||
      !atk
    ) {
      this.advanceQueuedOrder(u);
      return;
    }

    // Defensive stance leash: return to guard post if chased too far from anchor
    if (u.stance === 'defensive' && Math.hypot(u.x - u.guardX, u.z - u.guardZ) > 20) {
      u.order = { type: 'move', x: u.guardX, z: u.guardZ, attackMove: true };
      u.path = this.navGrid.findPath(u.x, u.z, u.guardX, u.guardZ);
      u.pathIndex = 0;
      return;
    }

    const tTpl = TEMPLATES[target.templateId];
    const isCapturing = tTpl.kind === 'building' && !target.isFoundation && order.mode === 'capture' && (atk.capturePower ?? 0) > 0;
    // Land melee soldiers can strike sea/lake monsters lunging near the water's edge or bridges!
    const shoreMonsterReachBonus = !uTpl.isNaval && !atk.isRanged && Boolean(tTpl.isSeaMonster) ? 3.8 : 0;
    const effectiveRange = isCapturing
      ? Math.min(3.0, Math.max(atk.range, 2.2)) + tTpl.radius + uTpl.radius
      : atk.range + tTpl.radius + uTpl.radius + shoreMonsterReachBonus;

    const dist = Math.hypot(target.x - u.x, target.z - u.z);
    if (dist > effectiveRange) {
      // Land units cannot swim out to deep-sea monsters far offshore — disengage cleanly if monster retreats far into sea
      if (!uTpl.isNaval && tTpl.isSeaMonster && dist > Math.max(effectiveRange + 12, 22)) {
        this.advanceQueuedOrder(u);
        return;
      }
      if (u.stance === 'stand_ground') {
        // Target moved out of reach: drop it and immediately scan for another enemy in weapon range
        u.order = { type: 'idle' };
        u.animState = 'idle';
        this.tryAutoAcquireEnemy(u);
        return;
      }
      if (u.repathTimer <= 0) {
        const expLimit = !uTpl.isNaval && tTpl.isSeaMonster ? 600 : 4500;
        u.path = uTpl.isNaval
          ? this.navGrid.findWaterPath(u.x, u.z, target.x, target.z)
          : this.navGrid.findPath(u.x, u.z, target.x, target.z, expLimit, false, u.owner);
        u.pathIndex = 0;
        u.repathTimer = !uTpl.isNaval && tTpl.isSeaMonster ? 1.2 : 0.65;
      }
      this.followPath(u, target.x, target.z, effectiveRange * 0.92);
      return;
    }

    u.facing = Math.atan2(target.x - u.x, target.z - u.z);
    u.animState = 'attack';
    u.path = [];

    if (isCapturing) {
      this.applyCaptureTick(u, target);
      return;
    }

    if (u.attackCooldown <= 0) {
      this.performAttack(u, target);
      u.attackCooldown = atk.cooldown;
    }
  }

  private performAttack(attacker: Entity, target: Entity): void {
    const aTpl = TEMPLATES[attacker.templateId];
    const atk = aTpl.attack;
    if (!atk) return;

    const player = this.players.get(attacker.owner);
    let dmgMult = 1.0;
    if (player && aTpl.kind === 'unit') {
      const civ = CIVS[player.civ];
      if (!aTpl.isWoman && !aTpl.isCavalry && !aTpl.isSiege && !aTpl.isNaval) dmgMult += civ.infantryAttackBonusPct;
      if (player.researchedTechs.has('tech_iron_weapons')) dmgMult += 0.2;
      if (player.researchedTechs.has('tech_steel_weapons')) dmgMult += 0.25;
      if (player.researchedTechs.has('phase_empire')) dmgMult += 0.15;
      if (player.researchedTechs.has('tech_rome_marian')) dmgMult += 0.15;
      if (player.researchedTechs.has('tech_spart_agoge')) dmgMult += 0.18;
      if (player.researchedTechs.has('tech_pers_immortals')) dmgMult += 0.2;
      if (player.researchedTechs.has('tech_carth_mercenaries')) dmgMult += 0.2;
      if (player.researchedTechs.has('tech_han_crossbow')) dmgMult += 0.25;
      if (player.researchedTechs.has('tech_brit_chariots')) dmgMult += 0.25;
      if (player.researchedTechs.has('tech_gaul_charge')) dmgMult += 0.28;
      if (player.researchedTechs.has('tech_iber_guerrilla')) dmgMult += 0.25;
      if (player.researchedTechs.has('tech_mace_sarissa')) dmgMult += 0.25;
      if (player.researchedTechs.has('tech_sele_cataphract')) dmgMult += 0.25;
      if (aTpl.isSiege) {
        if (player.civ === 'macedonians' || player.civ === 'persians') dmgMult += 0.12;
        if (player.researchedTechs.has('tech_siege_engineering')) dmgMult += 0.35;
        if (player.researchedTechs.has('tech_mace_siege')) dmgMult += 0.4;
        if (player.researchedTechs.has('tech_maur_elephants')) dmgMult += 0.3;
      }
      if (aTpl.isNaval) {
        if (player.civ === 'athenians') dmgMult += 0.15;
        if (player.researchedTechs.has('tech_naval_ram')) dmgMult += 0.3;
        if (player.researchedTechs.has('tech_ptol_pharos')) dmgMult += 0.25;
      }
      if (player.skillActiveTimer > 0) {
        if (player.civ === 'romans' || player.civ === 'britons' || player.civ === 'seleucids') dmgMult += 0.3;
        else if (player.civ === 'macedonians') dmgMult += 0.35;
        else if (player.civ === 'mauryas') dmgMult += 0.4;
        else if (player.civ === 'kushites') dmgMult += 0.25;
        else if ((player.civ === 'spartans' || player.civ === 'gauls') && !atk.isRanged) dmgMult += 0.4;
        else if (player.civ === 'han' && atk.isRanged) dmgMult += 0.3;
        else if (player.civ === 'iberians' && atk.isRanged) dmgMult += 0.35;
      }
      if (this.playerHasCompletedWonder(player.id)) dmgMult += 0.15;
      if (attacker.rank === 2) dmgMult *= 1.15;
      if (attacker.rank === 3) dmgMult *= 1.35;
    }

    const damage = {
      hack: atk.hack * dmgMult,
      pierce: atk.pierce * dmgMult,
      crush: atk.crush * dmgMult,
    };

    this.events.push({
      type: 'attack_swing',
      x: attacker.x,
      z: attacker.z,
      isRanged: atk.isRanged,
    });

    if (atk.isRanged) {
      const aY = this.terrain.getHeightAt(attacker.x, attacker.z) + (aTpl.kind === 'building' ? 5.5 : 1.5);
      const tY = this.terrain.getHeightAt(target.x, target.z) + 1.1;
      const dist = Math.hypot(target.x - attacker.x, target.z - attacker.z);
      const speed = atk.projectileSpeed ?? 26;
      const duration = Math.max(0.15, dist / speed);
      const elevDiff = aY - tY;
      const elevationBonus = Math.max(0.85, Math.min(1.25, 1 + elevDiff * 0.04));

      const projKind = atk.projectileKind ?? (attacker.templateId === 'rome_velite' ? 'javelin' : 'arrow');
      const arcMult = projKind === 'flaming_boulder' || projKind === 'boulder' ? 0.28 : 0.14;
      this.projectiles.push({
        id: this.nextProjectileId++,
        owner: attacker.owner,
        sourceId: attacker.id,
        targetId: target.id,
        startX: attacker.x,
        startY: aY,
        startZ: attacker.z,
        x: attacker.x,
        y: aY,
        z: attacker.z,
        targetX: target.x,
        targetY: tY,
        targetZ: target.z,
        progress: 0,
        duration,
        arcHeight: Math.min(11.5, 1.4 + dist * arcMult),
        damage,
        elevationBonus,
        splashRadius: atk.splashRadius,
        kind: projKind,
      });
    } else {
      // Bonus vs cavalry for spear hoplites
      if (attacker.templateId === 'athen_hoplite' && TEMPLATES[target.templateId].isCavalry) {
        damage.hack *= 1.6;
      }
      this.applyDamage(attacker, target, damage, 1.0);
    }
  }

  private applyDamage(
    attacker: Entity | null,
    target: Entity,
    raw: { hack: number; pierce: number; crush: number },
    multiplier: number
  ): void {
    if (!target.alive) return;
    if (attacker && !this.areHostile(attacker.owner, target.owner)) return;
    const armor = this.getEntityArmor(target);
    // Authentic 0 A.D. exponential armor mitigation: 0.9^armor
    const hackDmg = raw.hack * Math.pow(0.9, armor.hack);
    const pierceDmg = raw.pierce * Math.pow(0.9, armor.pierce);
    const crushDmg = raw.crush * Math.pow(0.9, armor.crush);
    // Beacon Towers grow progressively harder to destroy with more garrisoned defenders (scales up to -65% at full garrison)!
    const targetTplPre = TEMPLATES[target.templateId];
    let fortMit = 1.0;
    if (targetTplPre?.isBeaconTower && target.garrisonedIds.length > 0) {
      const maxCap = Math.max(5, this.getMaxGarrisonCapacity(target));
      const fillRatio = Math.min(1, target.garrisonedIds.length / maxCap);
      // Still strictly scales with garrison count even before cap (e.g. 1 defender = -12%, 5 defenders >= -55%, full = -65%)
      fortMit = Math.max(0.35, 1 - Math.min(0.65, Math.max(target.garrisonedIds.length * 0.11, fillRatio * 0.65)));
    } else if (targetTplPre?.isGate && target.gateMode === 'locked') {
      fortMit = 0.8;
    }
    const total = Math.max(1, (hackDmg + pierceDmg + crushDmg) * multiplier * fortMit);

    target.hp -= total;
    if (target.owner > 0) {
      this.notifyUnderAttack(
        target.owner,
        target.x,
        target.z,
        attacker?.templateId,
        target.templateId,
        attacker?.owner === 0
      );
    }

    // Wildlife reaction when attacked by ANY player unit/projectile:
    // - Predators, Boars, Wild Elephants & Sea/Lake Monsters immediately fight back!
    // - Docile animals (Deer, Gazelles) immediately bolt & flee!
    if (
      attacker &&
      attacker.alive &&
      target.owner === 0 &&
      target.hp > 0 &&
      !targetTplPre.isFlying &&
      (targetTplPre.isPredator || targetTplPre.isPassiveFauna || targetTplPre.isSeaMonster)
    ) {
      const existing = this.wildlifeState.get(target.id);
      this.wildlifeState.set(target.id, {
        hunterId: attacker.id,
        alertTimer: 6.5,
        attackCooldown: existing?.attackCooldown ?? 0.35,
      });
    }

    // Retaliation & squad mutual defense when attacked (works against BOTH enemy players AND attacking beasts/sea monsters!)
    if (
      attacker &&
      attacker.alive &&
      attacker.owner !== target.owner &&
      (attacker.owner !== 0 || Boolean(TEMPLATES[attacker.templateId]?.isPredator))
    ) {
      if (
        TEMPLATES[target.templateId].kind === 'unit' &&
        (target.order.type === 'idle' || target.order.type === 'gather') &&
        target.stance !== 'passive' &&
        !TEMPLATES[target.templateId].isWoman &&
        Boolean(TEMPLATES[target.templateId].attack)
      ) {
        target.order = { type: 'attack', targetId: attacker.id, mode: 'attack' };
      }
      if (target.owner > 0) {
        this.alertNearbyDefenders(target.owner, target.x, target.z, attacker);
      }
    }

    if (target.hp <= 0) {
      target.hp = 0;
      const targetTpl = TEMPLATES[target.templateId];
      // Slain Gaia fauna/predators remain as harvestable meat carcasses instead of vanishing!
      if (target.owner === 0 && (targetTpl.isPredator || targetTpl.isPassiveFauna)) {
        target.alive = true;
      } else {
        target.alive = false;
      }
      if (attacker && attacker.alive && TEMPLATES[attacker.templateId].kind === 'unit') {
        this.awardXp(attacker, TEMPLATES[target.templateId].kind === 'building' ? 45 : 35);
      }
      const killerPlayer = attacker ? this.players.get(attacker.owner) : undefined;
      if (killerPlayer) killerPlayer.stats.enemiesKilled++;
      const victimPlayer = this.players.get(target.owner);
      if (victimPlayer && TEMPLATES[target.templateId].kind === 'unit') {
        victimPlayer.stats.unitsLost++;
      }
    } else if (attacker && attacker.alive && TEMPLATES[attacker.templateId].kind === 'unit') {
      this.awardXp(attacker, 4);
    }
  }

  private awardXp(unit: Entity, amount: number): void {
    const tpl = TEMPLATES[unit.templateId];
    if (!tpl.isCitizenSoldier) return;
    unit.xp += amount;
    const nextRank: UnitRank = unit.xp >= 240 ? 3 : unit.xp >= 95 ? 2 : 1;
    if (nextRank > unit.rank) {
      unit.rank = nextRank;
      const oldMax = unit.maxHp;
      const newMax = this.getUnitMaxHp(unit);
      unit.maxHp = newMax;
      unit.hp += Math.max(0, newMax - oldMax);
      this.events.push({
        type: 'unit_promoted',
        playerId: unit.owner,
        entityId: unit.id,
        rank: nextRank,
        x: unit.x,
        z: unit.z,
      });
    }
  }

  private applyCaptureTick(attacker: Entity, building: Entity): void {
    const atk = TEMPLATES[attacker.templateId].attack;
    if (!atk?.capturePower || building.captureMax <= 0) return;

    const rankMult = attacker.rank === 1 ? 1.0 : attacker.rank === 2 ? 1.15 : 1.3;
    const atkPlayer = this.players.get(attacker.owner);
    const skillCapMult = atkPlayer && atkPlayer.skillActiveTimer > 0 && atkPlayer.civ === 'romans' ? 1.4 : 1.0;
    const power = atk.capturePower * rankMult * skillCapMult * SIM_DT;
    const defOwner = building.owner;
    const curDef = building.capturePoints[defOwner] ?? building.captureMax;
    const curAtk = building.capturePoints[attacker.owner] ?? 0;

    // Garrisoned defenders resist capture
    const garrisonResistance = 1 + building.garrisonedIds.length * 0.25;
    const effectivePower = power / garrisonResistance;

    const newDef = Math.max(0, curDef - effectivePower);
    const transferred = curDef - newDef;
    building.capturePoints[defOwner] = newDef;
    building.capturePoints[attacker.owner] = Math.min(building.captureMax, curAtk + transferred);

    this.notifyUnderAttack(defOwner, building.x, building.z, attacker.templateId, building.templateId, false);

    if (building.capturePoints[attacker.owner] >= building.captureMax - 0.5 || newDef <= 0.5) {
      const oldOwner = building.owner;
      this.ungarrisonAll(building);
      building.owner = attacker.owner;
      building.queue.length = 0;
      building.capturePoints = { [attacker.owner]: building.captureMax * 0.65 };
      this.territoryDirty = true;
      this.recomputePopulations();

      const newOwnerPlayer = this.players.get(attacker.owner);
      if (newOwnerPlayer) newOwnerPlayer.stats.buildingsCaptured++;

      this.events.push({
        type: 'building_captured',
        newOwner: attacker.owner,
        oldOwner,
        x: building.x,
        z: building.z,
        templateId: building.templateId,
      });
    }
  }

  private updateBuildings(): void {
    for (const b of this.entities.values()) {
      if (!b.alive || b.isFoundation) continue;
      const tpl = TEMPLATES[b.templateId];
      if (tpl.kind !== 'building') continue;

      if (b.attackCooldown > 0) b.attackCooldown = Math.max(0, b.attackCooldown - SIM_DT);

      // Advance timed building upgrades (e.g., House -> 2F Apartment, Apartment 2F -> 3F)
      if (b.upgradeTargetTemplateId && b.upgradeTotalTime && b.upgradeTotalTime > 0) {
        const ownerP = this.players.get(b.owner);
        const speedMult = ownerP?.fastBuildCheat ? 30 : 1;
        b.upgradeProgress = Math.min(1, (b.upgradeProgress ?? 0) + (SIM_DT * speedMult) / b.upgradeTotalTime);
        if (b.upgradeProgress >= 1) {
          this.completeBuildingUpgrade(b);
        }
      }

      // Heal garrisoned units slowly (boosted by Sacred Medicine)
      if (b.garrisonedIds.length > 0) {
        const healMult = this.players.get(b.owner)?.researchedTechs.has('tech_temple_healing') ? 1.5 : 1.0;
        for (const uid of b.garrisonedIds) {
          const u = this.entities.get(uid);
          if (u && u.alive && u.hp < u.maxHp) {
            u.hp = Math.min(u.maxHp, u.hp + 2.5 * healMult * SIM_DT);
          }
        }
      }

      // Market passive trade caravan revenue trickle every 6 seconds
      if (tpl.isMarket && this.tickCount % (SIM_HZ * 6) === (b.id % (SIM_HZ * 6))) {
        const ownerP = this.players.get(b.owner);
        if (ownerP) {
          let mult = ownerP.researchedTechs.has('tech_coinage') ? 1.5 : 1.0;
          if (ownerP.researchedTechs.has('tech_pers_satrapy')) mult += 0.4;
          if (ownerP.researchedTechs.has('tech_carth_colonization') || ownerP.researchedTechs.has('tech_han_silkroad')) {
            mult += 0.5;
          }
          if (ownerP.civ === 'carthaginians') mult += 0.2;
          ownerP.resources.food += Math.round(4 * mult);
          ownerP.resources.wood += Math.round(4 * mult);
          ownerP.resources.stone += Math.round(3 * mult);
          ownerP.resources.metal += Math.round(4 * mult);
        }
      }

      // Passive imperial/league tribute every 10 seconds (Persian Apadana & Athenian Delian League)
      if (this.tickCount % (SIM_HZ * 10) === (b.id % (SIM_HZ * 10))) {
        const ownerP = this.players.get(b.owner);
        if (ownerP) {
          if (tpl.passiveTributePer10Sec) {
            ownerP.resources.food += tpl.passiveTributePer10Sec.food ?? 0;
            ownerP.resources.wood += tpl.passiveTributePer10Sec.wood ?? 0;
            ownerP.resources.stone += tpl.passiveTributePer10Sec.stone ?? 0;
            ownerP.resources.metal += tpl.passiveTributePer10Sec.metal ?? 0;
          }
          if (
            ownerP.researchedTechs.has('tech_athen_delian') &&
            (b.templateId === 'civic_center' || b.templateId === 'gymnasium')
          ) {
            ownerP.resources.food += 15;
            ownerP.resources.metal += 15;
          }
        }
      }

      // Passive capture loyalty regeneration when uncontested or garrisoned
      if (b.captureMax > 0) {
        const curOwnerPts = b.capturePoints[b.owner] ?? b.captureMax;
        if (curOwnerPts < b.captureMax) {
          const regen = (6 + b.garrisonedIds.length * 4) * SIM_DT;
          b.capturePoints[b.owner] = Math.min(b.captureMax, curOwnerPts + regen);
        }
      }

      // Authentic 0 A.D. Territory Decay for buildings cut off from friendly territory
      if (tpl.mustBeInTerritory && !b.inTerritory) {
        b.decayTimer += SIM_DT;
        if (b.decayTimer >= 1.0) {
          b.decayTimer -= 1.0;
          b.hp -= Math.max(8, b.maxHp * 0.015);
          if (b.hp <= 0) {
            b.hp = 0;
            b.alive = false;
          }
        }
      } else {
        b.decayTimer = 0;
      }

      // Stone Gate smooth open/close door animation based on GateMode ('auto' = own nation only, 'open' = always, 'locked' = shut)
      if (tpl.isGate) {
        const mode = b.gateMode ?? 'auto';
        let wantOpen = mode === 'open';
        if (mode === 'auto') {
          const nearby = this.spatialHash.queryRadius(b.x, b.z, 4.9, this.queryBuf);
          for (let j = 0; j < nearby.length; j++) {
            const u = nearby[j];
            if (u.alive && u.owner === b.owner && u.garrisonedIn === null && TEMPLATES[u.templateId].kind === 'unit' && !TEMPLATES[u.templateId].isNaval) {
              wantOpen = true;
              break;
            }
          }
        }
        const curOpen = b.gateOpenAmount ?? (wantOpen ? 1 : 0);
        const step = SIM_DT * 3.4;
        b.gateOpenAmount = wantOpen ? Math.min(1, curOpen + step) : Math.max(0, curOpen - step);
      }

      // Great Wall Beacon Tower (3 levels): MUST have garrisoned soldiers to operate!
      // Auto-ignites on enemy approach, chains fire to beacons in range, rallies armies, & garrisoned ranged soldiers fire at enemies!
      if (tpl.isBeaconTower) {
        if (b.beaconLitTimer && b.beaconLitTimer > 0) {
          b.beaconLitTimer = Math.max(0, b.beaconLitTimer - SIM_DT);
        }
        if (b.beaconSuppressTimer && b.beaconSuppressTimer > 0) {
          b.beaconSuppressTimer = Math.max(0, b.beaconSuppressTimer - SIM_DT);
        }
        if (b.beaconRallyCooldown && b.beaconRallyCooldown > 0) {
          b.beaconRallyCooldown = Math.max(0, b.beaconRallyCooldown - SIM_DT);
        }
        const soldiers = this.getBeaconGarrisonSoldiers(b);
        if (soldiers.length === 0) {
          // Unstaffed Beacon Tower is completely ineffective!
          b.beaconLitTimer = 0;
        } else {
          const stats = World.getBeaconStats(b.beaconLevel ?? 1);
          // 1. Auto-detect approaching enemies -> auto-ignite & chain-signal (unless manually extinguished recently)!
          const intruder = this.findNearestEnemy(b.owner, b.x, b.z, stats.detectRange);
          if (intruder && !(b.beaconSuppressTimer && b.beaconSuppressTimer > 0)) {
            if ((b.beaconLitTimer ?? 0) <= 0) {
              this.igniteBeacon(b, true);
            } else {
              b.beaconLitTimer = Math.max(b.beaconLitTimer ?? 0, 15);
              if ((b.beaconRallyCooldown ?? 0) <= 0) {
                this.rallyArmiesToBeacon(b, stats.rallyRange);
                b.beaconRallyCooldown = 4.5;
              }
            }
          }

          // 2. Garrisoned soldiers armed with bows / crossbows / javelins / slings actively fire at hostile enemies!
          const targetEnemy = this.findNearestEnemy(b.owner, b.x, b.z, stats.attackRange);
          for (const shooter of soldiers) {
            const sTpl = TEMPLATES[shooter.templateId];
            const sAtk = sTpl?.attack;
            if (!sAtk || !sAtk.isRanged) continue;
            if (shooter.attackCooldown > 0) {
              shooter.attackCooldown = Math.max(0, shooter.attackCooldown - SIM_DT);
            }
            if (targetEnemy && shooter.attackCooldown <= 0) {
              // Temporarily fire from the top parapet of the Beacon Tower
              shooter.x = b.x;
              shooter.z = b.z;
              this.performAttack(shooter, targetEnemy);
              shooter.attackCooldown = sAtk.cooldown;
            }
          }
        }
      }

      // Defensive arrow fire (Towers, Fortresses, and garrisoned Civic Centers)
      if (tpl.attack && b.attackCooldown <= 0) {
        const baseArrows = tpl.isCivicCenter ? 0 : 1;
        const totalArrows = baseArrows + b.garrisonedIds.length * (tpl.garrisonArrowBonus ?? 1);
        if (totalArrows > 0) {
          const enemy = this.findNearestEnemy(b.owner, b.x, b.z, tpl.attack.range);
          if (enemy) {
            const volley = Math.min(4, totalArrows);
            for (let v = 0; v < volley; v++) {
              this.performAttack(b, enemy);
            }
            b.attackCooldown = tpl.attack.cooldown;
          }
        }
      }
    }
  }

  private updateProjectiles(): void {
    for (let i = this.projectiles.length - 1; i >= 0; i--) {
      const p = this.projectiles[i];
      p.progress += SIM_DT / p.duration;

      const target = this.entities.get(p.targetId);
      if (target && target.alive) {
        p.targetX = target.x;
        p.targetZ = target.z;
        p.targetY = this.terrain.getHeightAt(target.x, target.z) + 1.1;
      }

      const t = Math.min(1, p.progress);
      p.x = p.startX + (p.targetX - p.startX) * t;
      p.z = p.startZ + (p.targetZ - p.startZ) * t;
      const baseY = p.startY + (p.targetY - p.startY) * t;
      p.y = baseY + Math.sin(t * Math.PI) * p.arcHeight;

      if (p.progress >= 1) {
        const attacker = this.entities.get(p.sourceId) ?? null;
        if (target && target.alive) {
          this.applyDamage(attacker, target, p.damage, p.elevationBonus);
          this.events.push({ type: 'projectile_hit', x: p.targetX, z: p.targetZ });
        }
        // Area splash damage for Lithobolos Stone Throwers & Onager Catapults!
        if (p.splashRadius && p.splashRadius > 0) {
          const nearby = this.spatialHash.queryRadius(p.targetX, p.targetZ, p.splashRadius, this.queryBuf);
          const splashDmg = { hack: p.damage.hack * 0.55, pierce: p.damage.pierce * 0.55, crush: p.damage.crush * 0.55 };
          for (let j = 0; j < nearby.length; j++) {
            const c = nearby[j];
            if (!c.alive || c.id === p.targetId || c.owner === p.owner || c.garrisonedIn !== null) continue;
            if (!this.areHostile(p.owner, c.owner)) continue;
            if (c.owner === 0 && !TEMPLATES[c.templateId].isPredator) continue;
            if (Math.hypot(c.x - p.targetX, c.z - p.targetZ) <= p.splashRadius) {
              this.applyDamage(attacker, c, splashDmg, p.elevationBonus);
            }
          }
        }
        this.projectiles.splice(i, 1);
      }
    }
  }

  /** Lifelike wildlife AI: Birds soar across the sky; Sea Monsters patrol deep water; Deer/Gazelles bolt; Predators stalk & attack! */
  private updateWildlife(): void {
    const steerOffsets = [0, 0.55, -0.55, 1.15, -1.15, 1.75, -1.75];

    for (const e of this.entities.values()) {
      if (!e.alive || e.owner !== 0) continue;
      const tpl = TEMPLATES[e.templateId];

      // Soaring ambient wild birds (Eagles & Seagulls) gliding smoothly in wide figure-8 / circular sky arcs
      if (tpl.isFlying) {
        const angularSpeed = e.templateId === 'wild_seagull' ? 0.24 : 0.17;
        const rx = 20 + (e.id % 5) * 4.5;
        const rz = 16 + ((e.id * 3) % 5) * 4.0;
        const tPrev = e.animTime;
        const tNext = tPrev + angularSpeed * SIM_DT;
        e.animTime = tNext;
        const nx = Math.max(
          10,
          Math.min(this.terrain.worldSize - 10, e.guardX + Math.cos(tNext) * rx)
        );
        const nz = Math.max(
          10,
          Math.min(this.terrain.worldSize - 10, e.guardZ + Math.sin(tNext * (e.id % 2 === 0 ? 1 : 2)) * rz)
        );
        const dvx = (nx - e.x) / SIM_DT;
        const dvz = (nz - e.z) / SIM_DT;
        e.vx = dvx;
        e.vz = dvz;
        e.x = nx;
        e.z = nz;
        if (Math.hypot(dvx, dvz) > 0.05) {
          e.facing = Math.atan2(dvx, dvz);
        }
        e.animState = 'walk';
        continue;
      }

      const isFleeingPrey = e.templateId === 'deer_herd' || e.templateId === 'wild_gazelle';
      const isRetaliator = e.templateId === 'wild_boar' || e.templateId === 'wild_elephant';
      const isPredator = Boolean(tpl.isPredator);
      const isSeaMonster = Boolean(tpl.isSeaMonster);
      if (!isFleeingPrey && !isRetaliator && !isPredator) continue;

      // Slain carcass remains motionless on the ground/water while workers or fishing boats harvest it
      if (e.hp <= 0) {
        e.vx = 0;
        e.vz = 0;
        e.animState = 'idle';
        this.wildlifeState.delete(e.id);
        continue;
      }

      let st = this.wildlifeState.get(e.id);

      // Aggressive predators proactively spot & stalk nearby targets:
      // - Sea/Lake Monsters attack BOTH ships AND people near shores / bridges!
      // - Land predators stalk nearby land units!
      if (isPredator && (!st || st.alertTimer <= 0)) {
        if (this.tickCount % 5 === (e.id % 5)) {
          const aggroRad = isSeaMonster ? 15.5 : 9.5;
          const leashRad = isSeaMonster ? 28 : 18;
          const nearby = this.spatialHash.queryRadius(e.x, e.z, aggroRad, this.queryBuf);
          let prey: Entity | null = null;
          let bestD = aggroRad;
          for (let i = 0; i < nearby.length; i++) {
            const c = nearby[i];
            if (!c.alive || c.owner === 0 || c.garrisonedIn !== null) continue;
            const cTpl = TEMPLATES[c.templateId];
            if (cTpl.kind !== 'unit') continue;
            if (!isSeaMonster && cTpl.isNaval) continue;
            const d = Math.hypot(c.x - e.x, c.z - e.z);
            if (d < bestD && Math.hypot(c.x - e.guardX, c.z - e.guardZ) < leashRad) {
              bestD = d;
              prey = c;
            }
          }
          if (prey) {
            st = { hunterId: prey.id, alertTimer: 6.5, attackCooldown: 0 };
            this.wildlifeState.set(e.id, st);
          }
        }
      }

      if (!st || st.alertTimer <= 0) {
        if (isSeaMonster) {
          // Calm Sea Dragons, Giant Octopuses & Loch Ness Monsters patrol smoothly within their aquatic territory!
          const patrolAng = this.time * (e.templateId === 'lake_nessie' ? 0.24 : 0.28) + e.id * 1.7;
          const patrolRad = e.templateId === 'lake_nessie' ? 4.2 : 7.5;
          const targetPx = e.guardX + Math.cos(patrolAng) * patrolRad;
          const targetPz = e.guardZ + Math.sin(patrolAng) * patrolRad;
          const pdx = targetPx - e.x;
          const pdz = targetPz - e.z;
          const pDist = Math.hypot(pdx, pdz);
          if (pDist > 0.35) {
            const step = Math.min(1.65 * SIM_DT, pDist);
            const nx = e.x + (pdx / pDist) * step;
            const nz = e.z + (pdz / pDist) * step;
            const nt = this.terrain.worldToTile(nx, nz);
            if (this.terrain.isTileWaterNavigable(nt.tx, nt.tz)) {
              e.vx = (nx - e.x) / SIM_DT;
              e.vz = (nz - e.z) / SIM_DT;
              e.x = nx;
              e.z = nz;
              e.facing = Math.atan2(pdx, pdz);
              e.animState = 'walk';
            } else {
              e.vx = 0;
              e.vz = 0;
              e.animState = 'idle';
            }
          }
        } else {
          e.vx = 0;
          e.vz = 0;
          e.animState = 'idle';
        }
        if (st) this.wildlifeState.delete(e.id);
        continue;
      }

      st.alertTimer = Math.max(0, st.alertTimer - SIM_DT);
      st.attackCooldown = Math.max(0, st.attackCooldown - SIM_DT);

      const hunter = this.entities.get(st.hunterId);
      const maxLeash = isSeaMonster ? 28 : 20;
      if (
        !hunter ||
        !hunter.alive ||
        hunter.garrisonedIn !== null ||
        (isPredator && Math.hypot(e.x - e.guardX, e.z - e.guardZ) > maxLeash)
      ) {
        e.vx = 0;
        e.vz = 0;
        e.animState = 'idle';
        this.wildlifeState.delete(e.id);
        continue;
      }

      const dx = hunter.x - e.x;
      const dz = hunter.z - e.z;
      const dist = Math.hypot(dx, dz) || 0.001;

      if (isFleeingPrey) {
        // Docile animals (Gazelles & Deer) bolt AWAY from attacker at their distinct species speeds!
        const baseAngle = Math.atan2(-dx, -dz);
        const fleeSpeed = tpl.speed ?? (e.templateId === 'wild_gazelle' ? 6.4 : 5.0);
        const step = fleeSpeed * SIM_DT;
        let moved = false;
        for (const off of steerOffsets) {
          const ang = baseAngle + off;
          const nx = Math.max(6, Math.min(this.terrain.worldSize - 6, e.x + Math.sin(ang) * step));
          const nz = Math.max(6, Math.min(this.terrain.worldSize - 6, e.z + Math.cos(ang) * step));
          const nt = this.terrain.worldToTile(nx, nz);
          if (this.navGrid.isWalkable(nt.tx, nt.tz)) {
            e.vx = (nx - e.x) / SIM_DT;
            e.vz = (nz - e.z) / SIM_DT;
            e.x = nx;
            e.z = nz;
            e.facing = ang;
            e.animState = 'walk';
            moved = true;
            break;
          }
        }
        if (!moved) {
          e.vx = 0;
          e.vz = 0;
          e.animState = 'idle';
        }
      } else {
        // Predators, Boars, Wild Elephants & Sea/Lake Monsters charge & fight back at their distinct species speeds!
        e.facing = Math.atan2(dx, dz);
        const hTpl = TEMPLATES[hunter.templateId];
        // Sea/Lake Monsters can lunge/lash at ships OR nearby people on shore/bridges!
        const monsterExtraReach = isSeaMonster ? (hTpl.isNaval ? 1.45 : 4.25) : 0.58;
        const strikeRange = tpl.radius + hTpl.radius + monsterExtraReach;
        const biteDamage = isSeaMonster
          ? e.templateId === 'sea_monster'
            ? 24
            : e.templateId === 'sea_kraken'
              ? 22
              : 18
          : e.templateId === 'wild_elephant'
            ? 14
            : e.templateId === 'predator_bear'
              ? 12
              : e.templateId === 'predator_lion'
                ? 11
                : e.templateId === 'predator_wolf'
                  ? 7
                  : 5;
        const chaseSpeed = tpl.speed ?? 4.0;

        if (dist <= strikeRange) {
          e.vx = 0;
          e.vz = 0;
          e.animState = 'attack';
          if (st.attackCooldown <= 0) {
            this.applyDamage(
              e,
              hunter,
              { hack: biteDamage, pierce: 0, crush: isSeaMonster ? 14 : 0 },
              1.0
            );
            this.events.push({ type: 'attack_swing', x: hunter.x, z: hunter.z, isRanged: false });
            st.attackCooldown = isSeaMonster ? 1.55 : 1.25;
            st.alertTimer = Math.max(st.alertTimer, 4.0);
          }
        } else if (dist < (isSeaMonster ? 20 : 15)) {
          const baseAngle = Math.atan2(dx, dz);
          const step = Math.min(chaseSpeed * SIM_DT, dist - strikeRange * 0.85);
          let moved = false;
          for (const off of steerOffsets) {
            const ang = baseAngle + off;
            const nx = Math.max(6, Math.min(this.terrain.worldSize - 6, e.x + Math.sin(ang) * step));
            const nz = Math.max(6, Math.min(this.terrain.worldSize - 6, e.z + Math.cos(ang) * step));
            const nt = this.terrain.worldToTile(nx, nz);
            const passable = isSeaMonster
              ? this.terrain.isTileWaterNavigable(nt.tx, nt.tz)
              : this.navGrid.isWalkable(nt.tx, nt.tz);
            if (passable) {
              e.vx = (nx - e.x) / SIM_DT;
              e.vz = (nz - e.z) / SIM_DT;
              e.x = nx;
              e.z = nz;
              e.facing = ang;
              e.animState = 'walk';
              moved = true;
              break;
            }
          }
          if (!moved) {
            e.vx = 0;
            e.vz = 0;
            e.animState = 'idle';
          }
        } else {
          e.vx = 0;
          e.vz = 0;
          e.animState = 'idle';
        }
      }
    }
  }

  private cleanupDead(): void {
    let anyBuildingDied = false;
    let anyUnitDied = false;

    for (const [id, e] of this.entities.entries()) {
      if (e.alive) continue;
      const tpl = TEMPLATES[e.templateId];
      if (tpl.kind === 'building') {
        anyBuildingDied = true;
        this.ungarrisonAll(e);
        if (tpl.isGate) {
          this.syncGateNavTiles(e, false);
        }
        if (e.upgradeLinkedIds && e.upgradeLinkedIds.length > 0) {
          for (const lid of e.upgradeLinkedIds) {
            const nb = this.entities.get(lid);
            if (nb) {
              nb.upgradeLinkedIds = undefined;
              if (nb.upgradeTargetTemplateId === 'stone_gate') {
                nb.upgradeTargetTemplateId = null;
                nb.upgradeProgress = undefined;
                nb.upgradeTotalTime = undefined;
              }
            }
          }
        }
        if (!tpl.isFarmField && !tpl.isDock && !tpl.isGate && !tpl.isBridge) {
          this.navGrid.setFootprint(e.tileX, e.tileZ, tpl.footprintTiles ?? 2, false);
        }
        if (tpl.isBridge) {
          this.terrain.setBridgeTile(e.tileX, e.tileZ, false);
        }
        if (tpl.isTunnel && e.linkedTunnelId) {
          const partner = this.entities.get(e.linkedTunnelId);
          if (partner && partner.linkedTunnelId === e.id) {
            partner.linkedTunnelId = null;
          }
        }
        // Refund any queued tech flags
        const p = this.players.get(e.owner);
        if (p) {
          for (const item of e.queue) {
            if (item.kind === 'tech') p.researchingTechs.delete(item.id);
          }
        }
      } else if (tpl.kind === 'unit') {
        anyUnitDied = true;
      }

      this.events.push({ type: 'entity_died', entityId: id, x: e.x, z: e.z, kind: tpl.kind });
      this.idleTicks.delete(id);
      this.stuckTicks.delete(id);
      this.wildlifeState.delete(id);
      this.entities.delete(id);
    }

    if (anyBuildingDied) {
      this.territoryDirty = true;
      this.recomputePopulations();
    } else if (anyUnitDied) {
      this.recomputePopulations();
    }
  }

  private recomputeTerritory(): void {
    const phaseMap = new Map<number, number>();
    for (const p of this.players.values()) {
      phaseMap.set(p.id, p.phase);
    }
    this.territory.recompute(this.entities.values(), phaseMap);
    this.territoryDirty = false;
    this.updateBuildingTerritoryFlags();
  }

  private updateBuildingTerritoryFlags(): void {
    for (const e of this.entities.values()) {
      if (!e.alive || TEMPLATES[e.templateId].kind !== 'building') continue;
      e.inTerritory = this.territory.getOwnerAtTile(e.tileX, e.tileZ) === e.owner;
    }
  }

  recomputePopulations(): void {
    for (const p of this.players.values()) {
      p.popUsed = 0;
      p.popCap = 0;
    }
    for (const e of this.entities.values()) {
      if (!e.alive || e.owner === 0) continue;
      const p = this.players.get(e.owner);
      if (!p) continue;
      const tpl = TEMPLATES[e.templateId];
      if (tpl.kind === 'unit') {
        p.popUsed += tpl.popCost ?? 1;
      } else if (tpl.kind === 'building' && !e.isFoundation && tpl.popBonus) {
        if (tpl.isApartment) {
          const fl = Math.min(tpl.maxFloors ?? 3, Math.max(1, e.floors ?? 2));
          p.popCap += fl >= 3 ? 20 : fl === 2 ? 12 : 6;
        } else {
          p.popCap += tpl.popBonus;
        }
      }
    }
    for (const p of this.players.values()) {
      // City tier population bonuses (Town +5, City +15, Empire Metropolis +35)
      if (p.phase >= 2) p.popCap += 5;
      if (p.phase >= 3) p.popCap += 10;
      if (p.phase >= 4) p.popCap += 20;
      const bonus = CIVS[p.civ].popCapBonusPct ?? 0;
      if (bonus > 0) {
        p.popCap = Math.round(p.popCap * (1 + bonus));
      }
    }
  }

  private tryAutoAcquireEnemy(u: Entity, scanOverride?: number): boolean {
    if (u.stance === 'passive') return false;
    const tpl = TEMPLATES[u.templateId];
    if (!tpl.attack) return false;

    if (u.stance === 'stand_ground') {
      const reach = tpl.attack.range + tpl.radius + 3.8;
      const candidates = this.spatialHash.queryRadius(u.x, u.z, reach, this.queryBuf);
      let best: Entity | null = null;
      let bestD = Infinity;
      for (let i = 0; i < candidates.length; i++) {
        const c = candidates[i];
        if (!c.alive || c.owner === 0 || c.owner === u.owner || c.garrisonedIn !== null) continue;
        const cTpl = TEMPLATES[c.templateId];
        const d = Math.hypot(c.x - u.x, c.z - u.z);
        const maxReach = tpl.attack.range + cTpl.radius + tpl.radius + 0.35;
        if (d <= maxReach && d < bestD) {
          bestD = d;
          best = c;
        }
      }
      if (!best) return false;
      u.order = { type: 'attack', targetId: best.id, mode: 'attack' };
      return true;
    }

    const scanRadius =
      scanOverride ??
      (u.stance === 'aggressive'
        ? Math.max(tpl.visionRange + 4, tpl.attack.range + 10, 28)
        : Math.max(tpl.attack.range + 6, 18));

    const canHitSea = Boolean(tpl.isNaval || tpl.attack?.isRanged);
    const enemy = this.findNearestEnemy(u.owner, u.x, u.z, scanRadius, canHitSea);
    if (!enemy) return false;

    // Defensive units only engage enemies within defensive range of their guard anchor
    if (u.stance === 'defensive' && Math.hypot(enemy.x - u.guardX, enemy.z - u.guardZ) > 20) {
      return false;
    }

    u.order = { type: 'attack', targetId: enemy.id, mode: 'attack' };
    return true;
  }

  private alertNearbyDefenders(ownerId: number, x: number, z: number, attacker: Entity): void {
    const allies = this.spatialHash.queryRadius(x, z, 28, this.queryBuf);
    for (let i = 0; i < allies.length; i++) {
      const ally = allies[i];
      if (!ally.alive || ally.owner !== ownerId || ally.garrisonedIn !== null) continue;
      if (ally.order.type !== 'idle') continue;
      const aTpl = TEMPLATES[ally.templateId];
      if (aTpl.kind !== 'unit' || aTpl.isWoman || !aTpl.attack) continue;
      if (ally.stance === 'passive') continue;

      if (ally.stance === 'stand_ground') {
        const atkRad = TEMPLATES[attacker.templateId].radius;
        if (Math.hypot(attacker.x - ally.x, attacker.z - ally.z) <= aTpl.attack.range + atkRad + aTpl.radius + 0.35) {
          ally.order = { type: 'attack', targetId: attacker.id, mode: 'attack' };
        }
        continue;
      }

      if (ally.stance === 'defensive') {
        if (Math.hypot(attacker.x - ally.guardX, attacker.z - ally.guardZ) <= 20) {
          ally.order = { type: 'attack', targetId: attacker.id, mode: 'attack' };
        }
        continue;
      }

      // Aggressive allies rush to help within 28 units
      ally.order = { type: 'attack', targetId: attacker.id, mode: 'attack' };
    }
  }

  /**
   * Automatically assigns an idle worker to help construct nearby foundations or gather
   * needed resources (balanced across Food, Wood, Stone, Metal) without disturbing
   * soldiers stationed away from base on defensive/stand-ground guard duty.
   */
  private tryAutoWorkForIdleUnit(u: Entity, fromCompletedTask: boolean): boolean {
    const tpl = TEMPLATES[u.templateId];
    if (!tpl.gather) return false;
    const player = this.players.get(u.owner);
    if (!player) return false;

    // Fishing Boats auto-sail to the nearest Fish Shoal
    if (tpl.isNaval) {
      const fish = this.findNearestResource(u.x, u.z, 'food', u.owner, 95, true);
      if (fish) {
        u.order = { type: 'gather', targetId: fish.id, resourceType: 'food', returning: false };
        u.path = this.navGrid.findWaterPath(u.x, u.z, fish.x, fish.z);
        u.pathIndex = 0;
        return true;
      }
      return false;
    }

    // Respect guarding military units when triggered from passive idle (not post-build chaining)
    if (!fromCompletedTask && !tpl.isWoman) {
      if (u.stance === 'defensive' || u.stance === 'stand_ground') return false;
      // Only auto-task citizen-soldiers when idling near a friendly economic hub with no enemies nearby
      const nearHub =
        this.findNearestDropOff(u.owner, u.x, u.z, 'wood') ??
        this.findNearestDropOff(u.owner, u.x, u.z, 'food');
      if (!nearHub || Math.hypot(nearHub.x - u.x, nearHub.z - u.z) > 26) return false;
      if (this.findNearestEnemy(u.owner, u.x, u.z, 30)) return false;
    }

    // 1. Help build any nearby friendly foundation this unit is allowed to construct
    const foundation = this.findNearestFoundation(u.owner, u.x, u.z, 26);
    if (foundation && tpl.canBuild?.includes(foundation.templateId)) {
      u.order = { type: 'build', targetId: foundation.id };
      u.path = this.navGrid.findPath(u.x, u.z, foundation.x, foundation.z);
      u.pathIndex = 0;
      return true;
    }

    // 2. Automatically seek whichever resource the player is currently most short on!
    const counts: Record<ResourceType, number> = { food: 0, wood: 0, stone: 0, metal: 0 };
    for (const e of this.entities.values()) {
      if (e.alive && e.owner === u.owner && e.order.type === 'gather') {
        counts[e.order.resourceType]++;
      }
    }

    const orderPriority: ResourceType[] = tpl.isWoman
      ? ['food', 'wood', 'stone', 'metal']
      : ['wood', 'stone', 'metal', 'food'];

    // Prioritize the lowest current stockpile first, accounting for workers already assigned so they spread smartly
    orderPriority.sort((a, b) => {
      const scoreA = player.resources[a] + counts[a] * 135;
      const scoreB = player.resources[b] + counts[b] * 135;
      return scoreA - scoreB;
    });

    for (const resType of orderPriority) {
      const target = this.findNearestResource(u.x, u.z, resType, u.owner, 96);
      if (target) {
        u.order = { type: 'gather', targetId: target.id, resourceType: resType, returning: false };
        u.path = this.navGrid.findPath(u.x, u.z, target.x, target.z);
        u.pathIndex = 0;
        return true;
      }
    }
    return false;
  }

  findNearestEnemy(ownerId: number, x: number, z: number, radius: number, canHitSea = true): Entity | null {
    const candidates = this.spatialHash.queryRadius(x, z, radius, this.queryBuf);
    let best: Entity | null = null;
    let bestScore = Infinity;

    for (let i = 0; i < candidates.length; i++) {
      const c = candidates[i];
      if (!c.alive || c.owner === ownerId || c.garrisonedIn !== null) continue;
      const cTpl = TEMPLATES[c.templateId];
      if (cTpl.isFlying) continue;
      if (!canHitSea && cTpl.isSeaMonster) continue;
      if (c.owner === 0) {
        // Soldiers & warships automatically defend against close-range live wild predators & sea monsters!
        if (!cTpl.isPredator || c.hp <= 0) continue;
        const dPred = Math.hypot(c.x - x, c.z - z);
        if (dPred > Math.min(radius, cTpl.isSeaMonster ? 14 : 9.5)) continue;
        if (dPred < bestScore) {
          bestScore = dPred;
          best = c;
        }
        continue;
      }
      if (!this.areHostile(ownerId, c.owner)) continue;
      const d = Math.hypot(c.x - x, c.z - z);
      // Prioritize units slightly over buildings
      const score = d + (cTpl.kind === 'building' ? 6 : 0);
      if (score < bestScore) {
        bestScore = score;
        best = c;
      }
    }
    return best;
  }

  findNearestDropOff(
    ownerId: number,
    x: number,
    z: number,
    resourceType: ResourceType,
    dockOnly = false
  ): Entity | null {
    let best: Entity | null = null;
    let bestD2 = Infinity;
    for (const e of this.entities.values()) {
      if (!e.alive || e.owner !== ownerId || e.isFoundation) continue;
      const tpl = TEMPLATES[e.templateId];
      if (dockOnly && !tpl.isDock) continue;
      if (!tpl.dropOffTypes?.includes(resourceType)) continue;
      const d2 = (e.x - x) * (e.x - x) + (e.z - z) * (e.z - z);
      if (d2 < bestD2) {
        bestD2 = d2;
        best = e;
      }
    }
    return best;
  }

  findNearestResource(
    x: number,
    z: number,
    resourceType: ResourceType,
    ownerId: number,
    maxRadius = 60,
    aquatic = false
  ): Entity | null {
    let best: Entity | null = null;
    let bestD2 = maxRadius * maxRadius;
    for (const e of this.entities.values()) {
      if (!e.alive || e.resourceRemaining <= 0) continue;
      const tpl = TEMPLATES[e.templateId];
      if (tpl.resourceType !== resourceType) continue;
      if (Boolean(tpl.isAquatic) !== aquatic) continue;
      if (tpl.isFarmField && (e.owner !== ownerId || e.isFoundation)) continue;
      const d2 = (e.x - x) * (e.x - x) + (e.z - z) * (e.z - z);
      if (d2 < bestD2) {
        bestD2 = d2;
        best = e;
      }
    }
    return best;
  }

  private playerHasCompletedWonder(ownerId: number): boolean {
    for (const e of this.entities.values()) {
      if (e.alive && e.owner === ownerId && !e.isFoundation && TEMPLATES[e.templateId].isWonder) {
        return true;
      }
    }
    return false;
  }

  private updateHealerBehavior(healer: Entity): void {
    const hTpl = TEMPLATES[healer.templateId];
    const healRange = hTpl.healRange ?? 11;
    const baseRate = hTpl.healRate ?? 9;
    const player = this.players.get(healer.owner);
    const healMult =
      player && (player.researchedTechs.has('tech_temple_healing') || player.researchedTechs.has('tech_maur_edicts'))
        ? 1.5
        : 1.0;

    let wounded: Entity | null = null;
    let bestScore = Infinity;
    const nearby = this.spatialHash.queryRadius(healer.x, healer.z, 18, this.queryBuf);
    for (let i = 0; i < nearby.length; i++) {
      const c = nearby[i];
      if (!c.alive || c.owner !== healer.owner || c.id === healer.id || c.garrisonedIn !== null) continue;
      if (TEMPLATES[c.templateId].kind !== 'unit' || c.hp >= c.maxHp - 0.5) continue;
      const d = Math.hypot(c.x - healer.x, c.z - healer.z);
      if (d < bestScore) {
        bestScore = d;
        wounded = c;
      }
    }
    if (!wounded) {
      healer.animState = 'idle';
      return;
    }

    if (bestScore > healRange) {
      this.followPath(healer, wounded.x, wounded.z, healRange * 0.85);
      return;
    }

    healer.facing = Math.atan2(wounded.x - healer.x, wounded.z - healer.z);
    healer.animState = 'gather';
    wounded.hp = Math.min(wounded.maxHp, wounded.hp + baseRate * healMult * SIM_DT);
  }

  private findNearestFoundation(ownerId: number, x: number, z: number, maxRadius: number): Entity | null {
    let best: Entity | null = null;
    let bestD2 = maxRadius * maxRadius;
    for (const e of this.entities.values()) {
      if (!e.alive || e.owner !== ownerId || !e.isFoundation) continue;
      const d2 = (e.x - x) * (e.x - x) + (e.z - z) * (e.z - z);
      if (d2 < bestD2) {
        bestD2 = d2;
        best = e;
      }
    }
    return best;
  }

  private notifyUnderAttack(
    playerId: number,
    x: number,
    z: number,
    attackerTemplateId?: string,
    victimTemplateId?: string,
    isWildlife = false
  ): void {
    if (playerId <= 0) return;
    const bucketKey = playerId * 2 + (isWildlife ? 1 : 0);
    const last = this.lastAttackAlertTime.get(bucketKey) ?? -999;
    if (this.time - last >= 5) {
      this.lastAttackAlertTime.set(bucketKey, this.time);
      this.events.push({
        type: 'under_attack',
        playerId,
        x,
        z,
        attackerTemplateId,
        victimTemplateId,
        isWildlife,
      });
    }
  }

  private checkVictory(): void {
    for (const p of this.players.values()) {
      if (p.defeated) continue;
      let hasKeyStructure = false;
      let hasAnyUnit = false;
      for (const e of this.entities.values()) {
        if (!e.alive || e.owner !== p.id) continue;
        const tpl = TEMPLATES[e.templateId];
        if (tpl.isCivicCenter || tpl.isFortress) hasKeyStructure = true;
        if (tpl.kind === 'unit') hasAnyUnit = true;
      }
      if (!hasKeyStructure && !hasAnyUnit) {
        p.defeated = true;
      } else if (!hasKeyStructure) {
        // Conquest condition in 0 A.D. MVP: losing all Civic Centers & Fortresses with no buildings left
        let hasAnyBuilding = false;
        for (const e of this.entities.values()) {
          if (e.alive && e.owner === p.id && TEMPLATES[e.templateId].kind === 'building') {
            hasAnyBuilding = true;
            break;
          }
        }
        if (!hasAnyBuilding) p.defeated = true;
      }
    }

    const alivePlayers = Array.from(this.players.values()).filter((p) => !p.defeated);
    if (alivePlayers.length === 1) {
      this.winnerId = alivePlayers[0].id;
      this.events.push({ type: 'match_over', winnerId: this.winnerId });
    } else if (alivePlayers.length > 1 && !this.isPeaceful()) {
      // 0 A.D. Allied Team Victory: match is won when every surviving player is mutually allied with all other survivors!
      let anyHostileRemaining = false;
      for (let i = 0; i < alivePlayers.length && !anyHostileRemaining; i++) {
        for (let j = i + 1; j < alivePlayers.length; j++) {
          if (!this.areAllies(alivePlayers[i].id, alivePlayers[j].id)) {
            anyHostileRemaining = true;
            break;
          }
        }
      }
      if (!anyHostileRemaining) {
        const humanAlive = alivePlayers.find((p) => !p.isAI);
        this.winnerId = humanAlive ? humanAlive.id : alivePlayers[0].id;
        this.events.push({ type: 'match_over', winnerId: this.winnerId });
      }
    }
  }

  /** Serializes the full World simulation state into a clean JSON-safe snapshot for Save/Load */
  serializeState(camera?: { x: number; z: number; distance: number; yaw: number }): SerializedWorldState {
    const players = Array.from(this.players.values()).map((p) => ({
      ...p,
      resources: { ...p.resources },
      diplomacy: { ...p.diplomacy },
      stats: { ...p.stats },
      researchedTechs: Array.from(p.researchedTechs),
      researchingTechs: Array.from(p.researchingTechs),
    }));
    const entities = Array.from(this.entities.values()).map((e) => ({
      ...e,
      order: { ...e.order },
      queuedOrders: e.queuedOrders.map((o) => ({ ...o })),
      path: e.path.map((pt) => ({ ...pt })),
      queue: e.queue.map((q) => ({ ...q })),
      garrisonedIds: [...e.garrisonedIds],
      capturePoints: { ...e.capturePoints },
    }));
    return {
      version: 1,
      savedAt: Date.now(),
      config: {
        ...this.config,
        playerSlots: this.config.playerSlots?.map((s) => ({ ...s })),
      },
      tickCount: this.tickCount,
      time: this.time,
      nextEntityId: this.nextEntityId,
      nextProjectileId: this.nextProjectileId,
      winnerId: this.winnerId,
      rngState: this.rng.getState(),
      terrain: this.terrain.exportMutableState(),
      fog: this.fog.exportState(),
      players,
      entities,
      projectiles: this.projectiles.map((p) => ({ ...p, damage: { ...p.damage } })),
      savedTerraformJobs: Array.from(this.savedTerraformJobs.entries()),
      camera,
    };
  }

  /** Restores a full live World simulation from a SerializedWorldState snapshot */
  static deserializeState(data: SerializedWorldState): World {
    const world = new World(data.config);
    world.rng.setState(data.rngState);
    world.tickCount = data.tickCount;
    world.time = data.time;
    world.nextEntityId = data.nextEntityId;
    world.nextProjectileId = data.nextProjectileId;
    world.winnerId = data.winnerId;

    world.terrain.importMutableState(data.terrain);

    world.players.clear();
    for (const p of data.players) {
      world.players.set(p.id, {
        ...p,
        resources: { ...p.resources },
        diplomacy: { ...p.diplomacy },
        stats: { ...p.stats },
        researchedTechs: new Set(p.researchedTechs),
        researchingTechs: new Set(p.researchingTechs),
      });
    }

    world.entities.clear();
    for (const e of data.entities) {
      const cloned: Entity = {
        ...e,
        order: { ...e.order },
        queuedOrders: e.queuedOrders.map((o) => ({ ...o })),
        path: e.path.map((pt) => ({ ...pt })),
        queue: e.queue.map((q) => ({ ...q })),
        garrisonedIds: [...e.garrisonedIds],
        capturePoints: { ...e.capturePoints },
        gateSpanTiles: e.gateSpanTiles ? e.gateSpanTiles.map((t) => ({ ...t })) : undefined,
        upgradeLinkedIds: e.upgradeLinkedIds ? [...e.upgradeLinkedIds] : undefined,
      };
      world.entities.set(cloned.id, cloned);
    }

    // Re-sync NavGrid footprints & gate access modes after restoring entities
    world.navGrid.reset();
    for (const e of world.entities.values()) {
      if (!e.alive) continue;
      const tpl = TEMPLATES[e.templateId];
      if (tpl.kind === 'building') {
        if (tpl.isGate && !e.isFoundation) {
          world.syncGateNavTiles(e, true);
        } else if (!tpl.isFarmField && !tpl.isDock && !tpl.isGate && !tpl.isBridge) {
          world.navGrid.setFootprint(e.tileX, e.tileZ, tpl.footprintTiles ?? 2, true);
        }
      }
    }

    world.projectiles.length = 0;
    for (const pr of data.projectiles) {
      world.projectiles.push({ ...pr, damage: { ...pr.damage } });
    }

    world.savedTerraformJobs.clear();
    for (const [k, v] of data.savedTerraformJobs ?? []) {
      world.savedTerraformJobs.set(k, { ...v });
    }

    world.fog.importState(data.fog);
    world.recomputePopulations();
    world.recomputeTerritory();
    world.rebuildSpatialHash();
    world.events.length = 0;
    return world;
  }

  /** Deterministic hash for testing simulation reproducibility */
  computeStateHash(): number {
    let h = 2166136261 >>> 0;
    const mix = (n: number) => {
      h ^= Math.round(n * 100) | 0;
      h = Math.imul(h, 16777619) >>> 0;
    };
    mix(this.tickCount);
    for (const p of this.players.values()) {
      mix(p.id);
      mix(p.resources.food);
      mix(p.resources.wood);
      mix(p.resources.stone);
      mix(p.resources.metal);
      mix(p.phase);
    }
    for (const e of this.entities.values()) {
      mix(e.id);
      mix(e.owner);
      mix(e.x);
      mix(e.z);
      mix(e.hp);
      mix(e.resourceRemaining);
    }
    return h >>> 0;
  }
}
