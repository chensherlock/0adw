import { CIVS } from '../config/civs';
import { resolveUnitTemplateId, TECHS, TEMPLATES } from '../config/entities';
import {
  ArmorProfile,
  BuildingOrderMode,
  CivId,
  Difficulty,
  Entity,
  GameCommand,
  MapType,
  PlayerState,
  Projectile,
  ResourceBag,
  ResourceType,
  SimEvent,
  UnitOrder,
  UnitRank,
} from '../config/types';
import { FogGrid } from './map/FogGrid';
import { NavGrid } from './map/NavGrid';
import { SpatialHash } from './map/SpatialHash';
import { TerrainMap } from './map/TerrainMap';
import { TerritoryGrid } from './map/TerritoryGrid';
import { SeededRNG } from './rng';

export const SIM_HZ = 20;
export const SIM_DT = 1 / SIM_HZ;

export interface MatchConfig {
  seed: number;
  playerCiv: CivId;
  aiCiv: CivId;
  difficulty: Difficulty;
  mapType?: MapType;
  aiVsAi?: boolean;
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

  tickCount = 0;
  time = 0;
  winnerId: number | null = null;
  private lastAttackAlertTime: Map<number, number> = new Map();
  private idleTicks: Map<number, number> = new Map();
  private stuckTicks: Map<number, number> = new Map();
  private wildlifeState: Map<number, { hunterId: number; alertTimer: number; attackCooldown: number }> = new Map();
  private queryBuf: Entity[] = [];

  constructor(config: MatchConfig) {
    this.config = config;
    this.rng = new SeededRNG(config.seed);
    this.terrain = new TerrainMap(config.seed, config.mapType ?? 'random');
    this.navGrid = new NavGrid(this.terrain);
    this.spatialHash = new SpatialHash(this.terrain.worldSize, 6);
    this.territory = new TerritoryGrid(this.terrain);
    this.fog = new FogGrid(this.terrain, [1, 2]);

    this.initPlayers();
    this.populateMap();
    this.recomputePopulations();
    this.territory.recompute(this.entities.values());
    this.territoryDirty = false;
    this.rebuildSpatialHash();
    this.fog.update(this.entities.values());
  }

  private initPlayers(): void {
    const p1Civ = CIVS[this.config.playerCiv];
    const p2Civ = CIVS[this.config.aiCiv];
    const p1Color = p1Civ.id === p2Civ.id ? 0x2b6cb0 : p1Civ.primaryColor;
    const p1Css = p1Civ.id === p2Civ.id ? '#3b82f6' : p1Civ.cssColor;
    const p2Color = p1Civ.id === p2Civ.id ? 0xc53030 : p2Civ.primaryColor;
    const p2Css = p1Civ.id === p2Civ.id ? '#ef4444' : p2Civ.cssColor;

    this.players.set(1, {
      id: 1,
      name: this.config.aiVsAi ? `AI 1 (${p1Civ.name})` : `You (${p1Civ.name})`,
      civ: this.config.playerCiv,
      isAI: Boolean(this.config.aiVsAi),
      color: p1Color,
      cssColor: p1Css,
      resources: { food: 350, wood: 350, stone: 200, metal: 150 },
      popUsed: 0,
      popCap: 0,
      phase: 1,
      researchedTechs: new Set(),
      researchingTechs: new Set(),
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

    this.players.set(2, {
      id: 2,
      name: `Petra AI (${p2Civ.name})`,
      civ: this.config.aiCiv,
      isAI: true,
      color: p2Color,
      cssColor: p2Css,
      resources: { food: 350, wood: 350, stone: 200, metal: 150 },
      popUsed: 0,
      popCap: 0,
      phase: 1,
      researchedTechs: new Set(),
      researchingTechs: new Set(),
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

  private populateMap(): void {
    // 1. Place symmetrical starting bases & balanced starting resources around each random spawn
    for (const spawn of this.terrain.spawns) {
      const player = this.players.get(spawn.playerId)!;
      const civ = CIVS[player.civ];
      const toCenterX = 64 - spawn.tileX;
      const toCenterZ = 64 - spawn.tileZ;
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

      // Starting units: 4 Female Citizens, 4 Melee Citizen-Soldiers, 1 Cavalry Scout
      const ccPos = this.terrain.tileToWorldCenter(spawn.tileX, spawn.tileZ);
      for (let i = 0; i < 4; i++) {
        const angle = baseAngle - 0.75 + (i / 3) * 1.5;
        const ux = ccPos.x + Math.cos(angle) * 7.4;
        const uz = ccPos.z + Math.sin(angle) * 7.4;
        this.spawnUnit(civ.units.woman, spawn.playerId, ux, uz);
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
  }

  private pickBiomeTree(elevation: number): string {
    const r = this.rng.next();
    if (elevation < 1.55) {
      return r < 0.62 ? 'tree_palm' : 'tree_cypress';
    }
    if (elevation > 4.2) {
      return r < 0.68 ? 'tree_pine' : 'tree_cypress';
    }
    if (r < 0.36) return 'tree_cypress';
    if (r < 0.68) return 'tree_olive';
    if (r < 0.9) return 'tree_oak';
    return 'tree_pine';
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
      stance: tpl.isWoman ? 'passive' : 'aggressive',
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
    if (tpl.kind === 'building' && owner > 0) {
      const player = this.players.get(owner);
      if (player) {
        const civ = CIVS[player.civ];
        let mult = 1 + civ.buildingHpBonusPct;
        if (player.researchedTechs.has('tech_architecture')) mult += 0.25;
        hp = Math.round(hp * mult);
      }
    }
    return hp;
  }

  computeCaptureMax(templateId: string, owner: number): number {
    const tpl = TEMPLATES[templateId];
    let cap = tpl.capturePointsMax ?? 0;
    if (cap > 0 && owner > 0) {
      const player = this.players.get(owner);
      if (player && player.researchedTechs.has('tech_architecture')) {
        cap = Math.round(cap * 1.25);
      }
    }
    return cap;
  }

  getUnitMaxHp(entity: Entity): number {
    const tpl = TEMPLATES[entity.templateId];
    const rankMult = entity.rank === 1 ? 1.0 : entity.rank === 2 ? 1.15 : 1.35;
    return Math.round(tpl.maxHp * rankMult);
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

  spawnBuilding(
    templateId: string,
    owner: number,
    tileX: number,
    tileZ: number,
    asFoundation: boolean
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
    entity.rallyX = center.x;
    entity.rallyZ = center.z + tpl.radius + 3.5;

    if (!tpl.isFarmField) {
      this.navGrid.setFootprint(tileX, tileZ, size, true);
    }

    this.entities.set(entity.id, entity);
    if (!asFoundation) {
      this.territoryDirty = true;
      this.recomputePopulations();
    }
    return entity;
  }

  canPlaceBuilding(playerId: number, templateId: string, tileX: number, tileZ: number): { ok: boolean; reason?: string } {
    const player = this.players.get(playerId);
    const tpl = TEMPLATES[templateId];
    if (!player || !tpl || tpl.kind !== 'building') return { ok: false, reason: 'Invalid building' };
    if ((tpl.phaseRequired ?? 1) > player.phase) {
      return { ok: false, reason: `Requires Phase ${tpl.phaseRequired} (Town Phase)` };
    }
    if (tpl.cost && !this.canAfford(player.resources, tpl.cost)) {
      return { ok: false, reason: 'Not enough resources' };
    }

    const size = tpl.footprintTiles ?? 2;
    if (!this.navGrid.canPlaceFootprint(tileX, tileZ, size)) {
      return { ok: false, reason: 'Blocked terrain or too steep' };
    }

    // Check overlap with existing resources or fields
    const center = this.terrain.tileToWorldCenter(tileX, tileZ);
    for (const e of this.entities.values()) {
      if (!e.alive) continue;
      const eTpl = TEMPLATES[e.templateId];
      if (eTpl.kind === 'unit') continue;
      const minD = tpl.radius + eTpl.radius - 0.15;
      const dx = e.x - center.x;
      const dz = e.z - center.z;
      if (dx * dx + dz * dz < minD * minD) {
        return { ok: false, reason: 'Too close to another structure or resource' };
      }
    }

    // Territory check
    const terrOwner = this.territory.getOwnerAtTile(tileX, tileZ);
    if (tpl.mustBeInTerritory && terrOwner !== playerId) {
      return { ok: false, reason: 'Must be placed inside your territory' };
    }
    if (!tpl.mustBeInTerritory && terrOwner !== 0 && terrOwner !== playerId) {
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

    if (this.territoryDirty) {
      this.territory.recompute(this.entities.values());
      this.territoryDirty = false;
      this.updateBuildingTerritoryFlags();
    }

    // Update Fog of War every 4 ticks (5 Hz)
    if (this.tickCount % 4 === 0) {
      this.fog.update(this.entities.values());
    }

    // Check victory every 10 ticks
    if (this.tickCount % 10 === 0) {
      this.checkVictory();
    }
  }

  private rebuildSpatialHash(): void {
    this.spatialHash.clear();
    for (const e of this.entities.values()) {
      if (e.alive && e.garrisonedIn === null) {
        this.spatialHash.insert(e);
      }
    }
  }

  private processCommands(): void {
    if (this.pendingCommands.length === 0) return;
    const cmds = this.pendingCommands;
    this.pendingCommands = [];

    for (const cmd of cmds) {
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
      const col = idx % cols;
      const row = Math.floor(idx / cols);
      let tx = Math.max(4, Math.min(this.terrain.worldSize - 4, cmd.x + (col - halfCols) * spacing));
      let tz = Math.max(4, Math.min(this.terrain.worldSize - 4, cmd.z + (row - halfRows) * spacing));
      // Snap unreachable mountain-peak / water clicks onto the nearest walkable foothill/shoreline tile
      const rawTile = this.terrain.worldToTile(tx, tz);
      if (!this.navGrid.isWalkable(rawTile.tx, rawTile.tz)) {
        const uTile = this.terrain.worldToTile(u.x, u.z);
        const clamped = this.navGrid.findNearestWalkable(rawTile.tx, rawTile.tz, 16, uTile.tx, uTile.tz);
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
        u.path = this.navGrid.findPath(u.x, u.z, tx, tz);
        u.pathIndex = 0;
        u.repathTimer = 1.2;
        this.stuckTicks.set(u.id, 0);
      }
    });
  }

  private handleAttackCommand(cmd: Extract<GameCommand, { type: 'attack' }>): void {
    const target = this.entities.get(cmd.targetId);
    if (!target || !target.alive || target.owner === cmd.playerId || target.owner === 0) return;
    const tTpl = TEMPLATES[target.templateId];
    const mode: BuildingOrderMode = cmd.mode ?? (tTpl.kind === 'building' ? 'capture' : 'attack');

    for (const id of cmd.entityIds) {
      const u = this.entities.get(id);
      if (!u || !u.alive || u.owner !== cmd.playerId || u.garrisonedIn !== null) continue;
      if (TEMPLATES[u.templateId].kind !== 'unit') continue;
      u.order = { type: 'attack', targetId: target.id, mode };
      u.queuedOrders.length = 0;
      u.path = this.navGrid.findPath(u.x, u.z, target.x, target.z);
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

      // Drop carried resource if switching types
      if (u.carryType && u.carryType !== resType) {
        u.carryAmount = 0;
        u.carryType = null;
      }

      u.order = { type: 'gather', targetId: target.id, resourceType: resType, returning: false };
      u.queuedOrders.length = 0;
      u.path = this.navGrid.findPath(u.x, u.z, target.x, target.z);
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

    const foundation = this.spawnBuilding(cmd.templateId, cmd.playerId, cmd.tileX, cmd.tileZ, true);
    if (!foundation) return;

    for (const id of cmd.entityIds) {
      const u = this.entities.get(id);
      if (!u || !u.alive || u.owner !== cmd.playerId || u.garrisonedIn !== null) continue;
      const uTpl = TEMPLATES[u.templateId];
      if (!uTpl.gather || !uTpl.canBuild?.includes(cmd.templateId)) continue;
      u.order = { type: 'build', targetId: foundation.id };
      u.queuedOrders.length = 0;
      u.path = this.navGrid.findPath(u.x, u.z, foundation.x, foundation.z);
      u.pathIndex = 0;
      u.repathTimer = 1.0;
    }
  }

  private handleRepairCommand(cmd: Extract<GameCommand, { type: 'repair' }>): void {
    const target = this.entities.get(cmd.targetId);
    if (!target || !target.alive || target.owner !== cmd.playerId) return;
    if (TEMPLATES[target.templateId].kind !== 'building') return;
    if (!target.isFoundation && target.hp >= target.maxHp) return;

    for (const id of cmd.entityIds) {
      const u = this.entities.get(id);
      if (!u || !u.alive || u.owner !== cmd.playerId || u.garrisonedIn !== null) continue;
      if (!TEMPLATES[u.templateId].gather) continue;
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
    const bTpl = TEMPLATES[building.templateId];
    if (!bTpl.garrisonCapacity || bTpl.garrisonCapacity <= 0) return;

    for (const id of cmd.entityIds) {
      const u = this.entities.get(id);
      if (!u || !u.alive || u.owner !== cmd.playerId || u.garrisonedIn !== null) continue;
      if (TEMPLATES[u.templateId].kind !== 'unit') continue;
      u.order = { type: 'garrison', targetId: building.id };
      u.queuedOrders.length = 0;
      u.path = this.navGrid.findPath(u.x, u.z, building.x, building.z);
      u.pathIndex = 0;
    }
  }

  private handleUngarrisonCommand(cmd: Extract<GameCommand, { type: 'ungarrison' }>): void {
    const building = this.entities.get(cmd.buildingId);
    if (!building || !building.alive || building.owner !== cmd.playerId) return;
    this.ungarrisonAll(building);
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
      const dist = bTpl.radius + 1.4;
      u.x = Math.max(4, Math.min(this.terrain.worldSize - 4, building.x + Math.cos(angle) * dist));
      u.z = Math.max(4, Math.min(this.terrain.worldSize - 4, building.z + Math.sin(angle) * dist));
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

      item.progress += SIM_DT;
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
    const dirX = building.rallyX - building.x;
    const dirZ = building.rallyZ - building.z;
    const len = Math.hypot(dirX, dirZ) || 1;
    const sx = building.x + (dirX / len) * (bTpl.radius + 1.3);
    const sz = building.z + (dirZ / len) * (bTpl.radius + 1.3);

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
    this.enqueueCommand({ type: 'move', playerId: building.owner, entityIds: [unit.id], x: building.rallyX, z: building.rallyZ });
  }

  private completeTechResearch(techId: string, player: PlayerState): void {
    const tech = TECHS[techId];
    if (!tech) return;
    player.researchingTechs.delete(techId);
    player.researchedTechs.add(techId);

    if (tech.grantsPhase && player.phase < tech.grantsPhase) {
      player.phase = tech.grantsPhase;
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
      u.vx = 0;
      u.vz = 0;

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

          // 3. Auto-work for idle human workers (female citizens anywhere, citizen-soldiers near home base)
          const player = this.players.get(u.owner);
          if (player && !player.isAI && tpl.gather && idleCount >= (tpl.isWoman ? 35 : 55) && idleCount % 20 === 0) {
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
      }
    } else {
      u.order = { type: 'idle' };
      u.path = [];
      u.pathIndex = 0;
    }
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
    let speed = uTpl.speed ?? 5.5;
    if (uTpl.isCavalry && this.players.get(u.owner)?.researchedTechs.has('tech_cavalry_speed')) {
      speed *= 1.18;
    }

    // 1. Escape recovery: if a unit ever lands on an impassable cliff/water tile, smoothly step back onto walkable ground
    const curTile = this.terrain.worldToTile(u.x, u.z);
    if (!this.terrain.isTileStaticPassable(curTile.tx, curTile.tz)) {
      const safe = this.navGrid.findNearestWalkable(curTile.tx, curTile.tz, 8);
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
      u.path = this.navGrid.findPath(u.x, u.z, goalX, goalZ);
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
    const step = Math.min(speed * SIM_DT, adist);

    const dirX = adx / adist;
    const dirZ = adz / adist;
    const oldX = u.x;
    const oldZ = u.z;
    const nx = Math.max(4, Math.min(this.terrain.worldSize - 4, u.x + dirX * step));
    const nz = Math.max(4, Math.min(this.terrain.worldSize - 4, u.z + dirZ * step));

    // 2. Step along desired vector, or smoothly slide along X / Z hillside contours if clipping a slope edge
    const nTile = this.terrain.worldToTile(nx, nz);
    let moved = false;
    if (this.terrain.isTileStaticPassable(nTile.tx, nTile.tz)) {
      u.x = nx;
      u.z = nz;
      moved = true;
    } else {
      const slideX = Math.max(4, Math.min(this.terrain.worldSize - 4, u.x + dirX * step));
      const slideZ = Math.max(4, Math.min(this.terrain.worldSize - 4, u.z + dirZ * step));
      const txOnly = this.terrain.worldToTile(slideX, u.z);
      const tzOnly = this.terrain.worldToTile(u.x, slideZ);
      const canX = Math.abs(dirX) > 0.12 && this.terrain.isTileStaticPassable(txOnly.tx, txOnly.tz);
      const canZ = Math.abs(dirZ) > 0.12 && this.terrain.isTileStaticPassable(tzOnly.tx, tzOnly.tz);
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
        u.path = this.navGrid.findPath(u.x, u.z, goalX, goalZ);
        u.pathIndex = 0;
        u.repathTimer = 0.6;
      } else if (st >= 30) {
        // Unreachable cliff/obstacle directly blocking move destination: arrive cleanly at closest foothold
        this.stuckTicks.set(u.id, 0);
        if (u.order.type === 'move' || distGoal <= stopDist + 2.5) {
          u.path = [];
          u.pathIndex = 0;
          return true;
        }
        u.path = this.navGrid.findPath(u.x, u.z, goalX, goalZ);
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
    const uRad = TEMPLATES[u.templateId].radius;
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
      if (this.terrain.isTileStaticPassable(t.tx, t.tz)) {
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

    const player = this.players.get(u.owner);
    if (!player) return;

    // Returning to drop-off building
    if (order.returning) {
      let dropOff = order.dropOffId ? this.entities.get(order.dropOffId) : undefined;
      if (!dropOff || !dropOff.alive || dropOff.owner !== u.owner || dropOff.isFoundation) {
        dropOff = this.findNearestDropOff(u.owner, u.x, u.z, order.resourceType) ?? undefined;
        order.dropOffId = dropOff?.id;
      }
      if (!dropOff) {
        u.order = { type: 'idle' };
        return;
      }

      const dTpl = TEMPLATES[dropOff.templateId];
      const arrived = this.followPath(u, dropOff.x, dropOff.z, dTpl.radius + uTpl.radius + 0.55);
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
          u.path = this.navGrid.findPath(u.x, u.z, target.x, target.z);
          u.pathIndex = 0;
        }
      }
      return;
    }

    // Moving to & harvesting resource
    let target = this.entities.get(order.targetId);
    if (!target || !target.alive || target.resourceRemaining <= 0) {
      const replacement = this.findNearestResource(u.x, u.z, order.resourceType, u.owner, 48);
      if (replacement) {
        order.targetId = replacement.id;
        target = replacement;
        u.path = this.navGrid.findPath(u.x, u.z, target.x, target.z);
        u.pathIndex = 0;
      } else {
        if (u.carryAmount > 0) {
          order.returning = true;
        } else if (!this.tryAutoWorkForIdleUnit(u, true)) {
          u.order = { type: 'idle' };
        }
        return;
      }
    }

    let tTpl = TEMPLATES[target.templateId];
    const isPrey = target.templateId === 'deer_herd' || target.templateId === 'wild_boar';
    const isHuntingLivePrey = isPrey && target.hp > 0;
    let stopDist: number;
    if (tTpl.isFarmField) {
      stopDist = tTpl.radius * 0.72;
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
      u.path = this.navGrid.findPath(u.x, u.z, target.x, target.z);
      u.pathIndex = 0;
      u.repathTimer = 0.45;
    }

    let arrived = this.followPath(u, target.x, target.z, stopDist);

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
      const drop = this.findNearestDropOff(u.owner, u.x, u.z, order.resourceType);
      if (drop) {
        order.dropOffId = drop.id;
        u.path = this.navGrid.findPath(u.x, u.z, drop.x, drop.z);
        u.pathIndex = 0;
      }
    }
  }

  private updateBuildOrder(u: Entity, order: Extract<UnitOrder, { type: 'build' }>): void {
    const target = this.entities.get(order.targetId);
    const uTpl = TEMPLATES[u.templateId];
    if (!target || !target.alive || target.owner !== u.owner || !uTpl.gather) {
      u.order = { type: 'idle' };
      return;
    }

    const tTpl = TEMPLATES[target.templateId];
    const arrived = this.followPath(u, target.x, target.z, tTpl.radius + uTpl.radius + 0.38);
    if (!arrived) return;

    u.facing = Math.atan2(target.x - u.x, target.z - u.z);
    u.animState = 'build';

    if (target.isFoundation) {
      const buildTime = tTpl.buildTime ?? 18;
      const speedRatio = uTpl.gather.buildRate / 20;
      const progressDelta = (SIM_DT / buildTime) * speedRatio;
      target.buildProgress = Math.min(1, target.buildProgress + progressDelta);
      target.hp = Math.min(target.maxHp, target.hp + target.maxHp * progressDelta);

      if (target.buildProgress >= 1) {
        target.isFoundation = false;
        target.hp = target.maxHp;
        target.capturePoints = { [target.owner]: target.captureMax };
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

  private updateGarrisonOrder(u: Entity, order: Extract<UnitOrder, { type: 'garrison' }>): void {
    const building = this.entities.get(order.targetId);
    if (!building || !building.alive || building.owner !== u.owner || building.isFoundation) {
      u.order = { type: 'idle' };
      return;
    }
    const bTpl = TEMPLATES[building.templateId];
    const cap = bTpl.garrisonCapacity ?? 0;
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

    if (!target || !target.alive || target.owner === u.owner || target.garrisonedIn !== null || !atk) {
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
    const effectiveRange = isCapturing
      ? Math.min(3.0, Math.max(atk.range, 2.2)) + tTpl.radius + uTpl.radius
      : atk.range + tTpl.radius + uTpl.radius;

    const dist = Math.hypot(target.x - u.x, target.z - u.z);
    if (dist > effectiveRange) {
      if (u.stance === 'stand_ground') {
        // Target moved out of reach: drop it and immediately scan for another enemy in weapon range
        u.order = { type: 'idle' };
        u.animState = 'idle';
        this.tryAutoAcquireEnemy(u);
        return;
      }
      if (u.repathTimer <= 0) {
        u.path = this.navGrid.findPath(u.x, u.z, target.x, target.z);
        u.pathIndex = 0;
        u.repathTimer = 0.65;
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
      if (!aTpl.isWoman && !aTpl.isCavalry && !aTpl.isSiege) dmgMult += civ.infantryAttackBonusPct;
      if (player.researchedTechs.has('tech_iron_weapons')) dmgMult += 0.2;
      if (player.researchedTechs.has('tech_steel_weapons')) dmgMult += 0.25;
      if (aTpl.isSiege && player.researchedTechs.has('tech_siege_engineering')) dmgMult += 0.35;
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
        arcHeight: Math.min(6.5, 1.2 + dist * 0.14),
        damage,
        elevationBonus,
        kind: attacker.templateId === 'rome_velite' ? 'javelin' : 'arrow',
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
    const armor = this.getEntityArmor(target);
    // Authentic 0 A.D. exponential armor mitigation: 0.9^armor
    const hackDmg = raw.hack * Math.pow(0.9, armor.hack);
    const pierceDmg = raw.pierce * Math.pow(0.9, armor.pierce);
    const crushDmg = raw.crush * Math.pow(0.9, armor.crush);
    const total = Math.max(1, (hackDmg + pierceDmg + crushDmg) * multiplier);

    target.hp -= total;
    this.notifyUnderAttack(target.owner, target.x, target.z);

    // Retaliation & squad mutual defense when attacked
    if (attacker && attacker.alive && attacker.owner !== target.owner && attacker.owner !== 0) {
      if (
        TEMPLATES[target.templateId].kind === 'unit' &&
        (target.order.type === 'idle' || target.order.type === 'gather') &&
        target.stance !== 'passive' &&
        !TEMPLATES[target.templateId].isWoman
      ) {
        target.order = { type: 'attack', targetId: attacker.id, mode: 'attack' };
      }
      this.alertNearbyDefenders(target.owner, target.x, target.z, attacker);
    }

    if (target.hp <= 0) {
      target.hp = 0;
      target.alive = false;
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
    const power = atk.capturePower * rankMult * SIM_DT;
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

    this.notifyUnderAttack(defOwner, building.x, building.z);

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
          const mult = ownerP.researchedTechs.has('tech_coinage') ? 1.5 : 1.0;
          ownerP.resources.food += Math.round(4 * mult);
          ownerP.resources.wood += Math.round(4 * mult);
          ownerP.resources.stone += Math.round(3 * mult);
          ownerP.resources.metal += Math.round(4 * mult);
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
        if (target && target.alive) {
          const attacker = this.entities.get(p.sourceId) ?? null;
          this.applyDamage(attacker, target, p.damage, p.elevationBonus);
          this.events.push({ type: 'projectile_hit', x: p.targetX, z: p.targetZ });
        }
        this.projectiles.splice(i, 1);
      }
    }
  }

  /** Lifelike wildlife AI: Deer bolt & flee when hunted; Wild Boars turn & fight back before collapsing */
  private updateWildlife(): void {
    const steerOffsets = [0, 0.55, -0.55, 1.15, -1.15, 1.75, -1.75];

    for (const e of this.entities.values()) {
      if (!e.alive || e.owner !== 0) continue;
      const isDeer = e.templateId === 'deer_herd';
      const isBoar = e.templateId === 'wild_boar';
      if (!isDeer && !isBoar) continue;

      // Slain carcass remains motionless on the ground while workers butcher it
      if (e.hp <= 0) {
        e.vx = 0;
        e.vz = 0;
        e.animState = 'idle';
        this.wildlifeState.delete(e.id);
        continue;
      }

      const st = this.wildlifeState.get(e.id);
      if (!st || st.alertTimer <= 0) {
        e.vx = 0;
        e.vz = 0;
        e.animState = 'idle';
        if (st) this.wildlifeState.delete(e.id);
        continue;
      }

      st.alertTimer = Math.max(0, st.alertTimer - SIM_DT);
      st.attackCooldown = Math.max(0, st.attackCooldown - SIM_DT);

      const hunter = this.entities.get(st.hunterId);
      if (!hunter || !hunter.alive || hunter.garrisonedIn !== null) {
        e.vx = 0;
        e.vz = 0;
        e.animState = 'idle';
        this.wildlifeState.delete(e.id);
        continue;
      }

      const dx = hunter.x - e.x;
      const dz = hunter.z - e.z;
      const dist = Math.hypot(dx, dz) || 0.001;

      if (isDeer) {
        // Skittish deer bolts AWAY from hunter at 3.9 u/s (catchable by citizens at ~5.5 u/s)
        const baseAngle = Math.atan2(-dx, -dz);
        const fleeSpeed = 3.9;
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
        // Wild Boar stands its ground and fights back with tusk strikes!
        e.facing = Math.atan2(dx, dz);
        const hTpl = TEMPLATES[hunter.templateId];
        const bTpl = TEMPLATES[e.templateId];
        const strikeRange = bTpl.radius + hTpl.radius + 0.55;
        if (dist <= strikeRange) {
          e.vx = 0;
          e.vz = 0;
          e.animState = 'attack';
          if (st.attackCooldown <= 0) {
            this.applyDamage(null, hunter, { hack: 5, pierce: 0, crush: 0 }, 1.0);
            this.events.push({ type: 'attack_swing', x: hunter.x, z: hunter.z, isRanged: false });
            st.attackCooldown = 1.25;
          }
        } else if (dist < 14) {
          const baseAngle = Math.atan2(dx, dz);
          const chargeSpeed = 3.6;
          const step = Math.min(chargeSpeed * SIM_DT, dist - strikeRange * 0.85);
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
        if (!tpl.isFarmField) {
          this.navGrid.setFootprint(e.tileX, e.tileZ, tpl.footprintTiles ?? 2, false);
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
        p.popCap += tpl.popBonus;
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

    const enemy = this.findNearestEnemy(u.owner, u.x, u.z, scanRadius);
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

    // 2. Balance gathering priority by current active worker counts & resource stockpiles
    const counts: Record<ResourceType, number> = { food: 0, wood: 0, stone: 0, metal: 0 };
    for (const e of this.entities.values()) {
      if (e.alive && e.owner === u.owner && e.order.type === 'gather') {
        counts[e.order.resourceType]++;
      }
    }

    const orderPriority: ResourceType[] = tpl.isWoman
      ? ['food', 'wood', 'stone', 'metal']
      : ['wood', 'stone', 'metal', 'food'];

    // Sort resource types by scarcity score (fewer active gatherers + lower stockpile = higher priority)
    orderPriority.sort((a, b) => {
      const wantA = a === 'food' ? 4 : a === 'wood' ? 4 : 2;
      const wantB = b === 'food' ? 4 : b === 'wood' ? 4 : 2;
      const scoreA = counts[a] / wantA + player.resources[a] / 1200;
      const scoreB = counts[b] / wantB + player.resources[b] / 1200;
      return scoreA - scoreB;
    });

    for (const resType of orderPriority) {
      const target = this.findNearestResource(u.x, u.z, resType, u.owner, 52);
      if (target) {
        u.order = { type: 'gather', targetId: target.id, resourceType: resType, returning: false };
        u.path = this.navGrid.findPath(u.x, u.z, target.x, target.z);
        u.pathIndex = 0;
        return true;
      }
    }
    return false;
  }

  findNearestEnemy(ownerId: number, x: number, z: number, radius: number): Entity | null {
    const candidates = this.spatialHash.queryRadius(x, z, radius, this.queryBuf);
    let best: Entity | null = null;
    let bestScore = Infinity;

    for (let i = 0; i < candidates.length; i++) {
      const c = candidates[i];
      if (!c.alive || c.owner === 0 || c.owner === ownerId || c.garrisonedIn !== null) continue;
      const d = Math.hypot(c.x - x, c.z - z);
      // Prioritize units slightly over buildings
      const score = d + (TEMPLATES[c.templateId].kind === 'building' ? 6 : 0);
      if (score < bestScore) {
        bestScore = score;
        best = c;
      }
    }
    return best;
  }

  findNearestDropOff(ownerId: number, x: number, z: number, resourceType: ResourceType): Entity | null {
    let best: Entity | null = null;
    let bestD2 = Infinity;
    for (const e of this.entities.values()) {
      if (!e.alive || e.owner !== ownerId || e.isFoundation) continue;
      const tpl = TEMPLATES[e.templateId];
      if (!tpl.dropOffTypes?.includes(resourceType)) continue;
      const d2 = (e.x - x) * (e.x - x) + (e.z - z) * (e.z - z);
      if (d2 < bestD2) {
        bestD2 = d2;
        best = e;
      }
    }
    return best;
  }

  findNearestResource(x: number, z: number, resourceType: ResourceType, ownerId: number, maxRadius = 60): Entity | null {
    let best: Entity | null = null;
    let bestD2 = maxRadius * maxRadius;
    for (const e of this.entities.values()) {
      if (!e.alive || e.resourceRemaining <= 0) continue;
      const tpl = TEMPLATES[e.templateId];
      if (tpl.resourceType !== resourceType) continue;
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
    const healMult = player?.researchedTechs.has('tech_temple_healing') ? 1.5 : 1.0;

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

  private notifyUnderAttack(playerId: number, x: number, z: number): void {
    const last = this.lastAttackAlertTime.get(playerId) ?? -999;
    if (this.time - last >= 10) {
      this.lastAttackAlertTime.set(playerId, this.time);
      this.events.push({ type: 'under_attack', playerId, x, z });
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
    }
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
