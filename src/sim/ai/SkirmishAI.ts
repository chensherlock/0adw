import { CIVS } from '../../config/civs';
import { TECHS, TEMPLATES } from '../../config/entities';
import { Difficulty, Entity, ResourceType } from '../../config/types';
import { World } from '../World';

interface DifficultyParams {
  thinkIntervalSec: number;
  targetWorkers: number;
  attackWaveBase: number;
  attackWaveStep: number;
  maxPopTarget: number;
}

const DIFFICULTY_TABLE: Record<Difficulty, DifficultyParams> = {
  easy: { thinkIntervalSec: 3.5, targetWorkers: 12, attackWaveBase: 5, attackWaveStep: 2, maxPopTarget: 32 },
  medium: { thinkIntervalSec: 2.0, targetWorkers: 18, attackWaveBase: 7, attackWaveStep: 3, maxPopTarget: 48 },
  hard: { thinkIntervalSec: 1.2, targetWorkers: 24, attackWaveBase: 9, attackWaveStep: 4, maxPopTarget: 65 },
};

export class SkirmishAI {
  readonly playerId: number;
  private readonly params: DifficultyParams;
  private nextThinkTime = 1.0;
  private waveCount = 0;
  private lastAttackTime = 0;

  constructor(playerId: number, difficulty: Difficulty) {
    this.playerId = playerId;
    this.params = DIFFICULTY_TABLE[difficulty];
  }

  update(world: World): void {
    if (world.winnerId !== null) return;
    if (world.time < this.nextThinkTime) return;
    this.nextThinkTime = world.time + this.params.thinkIntervalSec;

    const player = world.players.get(this.playerId);
    if (!player || player.defeated) return;

    const civ = CIVS[player.civ];
    const myUnits: Entity[] = [];
    const myBuildings: Entity[] = [];
    let cc: Entity | null = null;
    let barracks: Entity | null = null;
    let farmstead: Entity | null = null;
    let storehouse: Entity | null = null;
    let towerCount = 0;
    let fieldCount = 0;
    let fortressCount = 0;
    let pendingHouse = false;

    for (const e of world.entities.values()) {
      if (!e.alive || e.owner !== this.playerId) continue;
      const tpl = TEMPLATES[e.templateId];
      if (tpl.kind === 'unit') {
        myUnits.push(e);
      } else if (tpl.kind === 'building') {
        myBuildings.push(e);
        if (tpl.isCivicCenter && !e.isFoundation) cc = e;
        if (e.templateId === 'barracks' && !e.isFoundation) barracks = e;
        if (e.templateId === 'farmstead') farmstead = e;
        if (e.templateId === 'storehouse') storehouse = e;
        if (e.templateId === 'defense_tower') towerCount++;
        if (e.templateId === 'field') fieldCount++;
        if (e.templateId === 'fortress') fortressCount++;
        if (e.templateId === 'house' && e.isFoundation) pendingHouse = true;
      }
    }

    if (!cc) return;

    const women = myUnits.filter((u) => TEMPLATES[u.templateId].isWoman && u.garrisonedIn === null);
    const soldiers = myUnits.filter(
      (u) => !TEMPLATES[u.templateId].isWoman && u.garrisonedIn === null
    );
    const idleGatherers = myUnits.filter(
      (u) => u.order.type === 'idle' && u.garrisonedIn === null && TEMPLATES[u.templateId].gather
    );

    // 1. Defend base if enemies enter home radius
    const threat = world.findNearestEnemy(this.playerId, cc.x, cc.z, 34);
    if (threat) {
      const defenders = soldiers.filter((s) => s.order.type !== 'attack');
      if (defenders.length > 0) {
        world.enqueueCommand({
          type: 'attack',
          playerId: this.playerId,
          entityIds: defenders.map((d) => d.id),
          targetId: threat.id,
          mode: 'attack',
        });
      }
      // Garrison nearby threatened women
      if (Math.hypot(threat.x - cc.x, threat.z - cc.z) < 16 && women.length > 0) {
        world.enqueueCommand({
          type: 'garrison',
          playerId: this.playerId,
          entityIds: women.slice(0, 4).map((w) => w.id),
          buildingId: cc.id,
        });
      }
    } else if (cc.garrisonedIds.length > 0) {
      world.enqueueCommand({ type: 'ungarrison', playerId: this.playerId, buildingId: cc.id });
    }

    // 2. Finish any incomplete foundations first
    const foundation = myBuildings.find((b) => b.isFoundation);
    if (foundation) {
      const builders = idleGatherers.slice(0, 3);
      if (builders.length > 0) {
        world.enqueueCommand({
          type: 'repair',
          playerId: this.playerId,
          entityIds: builders.map((b) => b.id),
          targetId: foundation.id,
        });
      }
    }

    // 3. Build Houses proactively before hitting pop cap
    if (!pendingHouse && player.popCap - player.popUsed <= 3 && player.popCap < this.params.maxPopTarget) {
      this.tryBuildNear(world, cc, 'house', idleGatherers.length > 0 ? idleGatherers : myUnits.slice(0, 2));
    }

    // 4. Economic infrastructure: Barracks, Farmstead + Fields, Tower, Fortress
    if (!barracks && !myBuildings.some((b) => b.templateId === 'barracks') && player.resources.wood >= 160 && player.resources.stone >= 100) {
      this.tryBuildNear(world, cc, 'barracks', soldiers.slice(0, 2), 10, 16);
    }

    if (!farmstead && player.resources.wood >= 140 && world.time > 25) {
      this.tryBuildNear(world, cc, 'farmstead', women.slice(0, 1), 8, 14);
    }

    if (farmstead && !farmstead.isFoundation && fieldCount < 3 && player.resources.wood >= 120) {
      this.tryBuildNear(world, farmstead, 'field', women.slice(0, 2), 4, 9);
    }

    if (!storehouse && player.resources.wood >= 150 && world.time > 45) {
      this.tryBuildNear(world, cc, 'storehouse', soldiers.slice(0, 1), 10, 15);
    }

    if (towerCount < 2 && barracks && player.resources.stone >= 130 && player.resources.wood >= 100 && world.time > 55) {
      const dirX = cc.tileX < 64 ? 1 : -1;
      const dirZ = cc.tileZ < 64 ? 1 : -1;
      this.tryBuildNearPoint(world, cc.tileX + dirX * 11, cc.tileZ + dirZ * 11, 'defense_tower', soldiers.slice(0, 2));
    }

    if (player.phase >= 2 && fortressCount < 1 && player.resources.stone >= 450 && player.resources.wood >= 200 && player.resources.metal >= 150) {
      const dirX = cc.tileX < 64 ? 1 : -1;
      const dirZ = cc.tileZ < 64 ? 1 : -1;
      this.tryBuildNearPoint(world, cc.tileX + dirX * 13, cc.tileZ + dirZ * 13, 'fortress', soldiers.slice(0, 3));
    }

    // 5. Assign idle gatherers across balanced 0 A.D. resource ratios
    if (idleGatherers.length > 0) {
      const counts: Record<ResourceType, number> = { food: 0, wood: 0, stone: 0, metal: 0 };
      for (const u of myUnits) {
        if (u.order.type === 'gather') counts[u.order.resourceType]++;
      }

      for (const u of idleGatherers) {
        if (u.order.type !== 'idle') continue;
        const isWoman = Boolean(TEMPLATES[u.templateId].isWoman);
        const preferred = this.pickNeededResource(counts, isWoman, player.phase);
        const node =
          world.findNearestResource(u.x, u.z, preferred, this.playerId, 75) ??
          world.findNearestResource(u.x, u.z, 'wood', this.playerId, 85) ??
          world.findNearestResource(u.x, u.z, 'food', this.playerId, 85);
        if (node) {
          const rType = TEMPLATES[node.templateId].resourceType!;
          counts[rType]++;
          world.enqueueCommand({
            type: 'gather',
            playerId: this.playerId,
            entityIds: [u.id],
            targetId: node.id,
          });
        }
      }
    }

    // 6. Research Town Phase & Upgrades
    if (cc.queue.length === 0 && player.phase === 1 && world.canAfford(player.resources, TECHS.phase_town.cost)) {
      world.enqueueCommand({ type: 'research', playerId: this.playerId, buildingId: cc.id, techId: 'phase_town' });
    } else if (
      cc.queue.length === 0 &&
      !player.researchedTechs.has('tech_gather_tools') &&
      !player.researchingTechs.has('tech_gather_tools') &&
      world.time > 40 &&
      world.canAfford(player.resources, TECHS.tech_gather_tools.cost)
    ) {
      world.enqueueCommand({ type: 'research', playerId: this.playerId, buildingId: cc.id, techId: 'tech_gather_tools' });
    }

    if (barracks && barracks.queue.length === 0) {
      if (
        !player.researchedTechs.has('tech_iron_weapons') &&
        !player.researchingTechs.has('tech_iron_weapons') &&
        world.time > 80 &&
        world.canAfford(player.resources, TECHS.tech_iron_weapons.cost)
      ) {
        world.enqueueCommand({ type: 'research', playerId: this.playerId, buildingId: barracks.id, techId: 'tech_iron_weapons' });
      } else if (
        !player.researchedTechs.has('tech_bronze_shields') &&
        !player.researchingTechs.has('tech_bronze_shields') &&
        world.time > 110 &&
        world.canAfford(player.resources, TECHS.tech_bronze_shields.cost)
      ) {
        world.enqueueCommand({ type: 'research', playerId: this.playerId, buildingId: barracks.id, techId: 'tech_bronze_shields' });
      }
    }

    // 7. Train Citizens & Army
    const totalPop = player.popUsed;
    if (cc.queue.length < 2 && totalPop < Math.min(player.popCap, this.params.maxPopTarget)) {
      if (women.length < Math.min(10, Math.floor(this.params.targetWorkers * 0.45))) {
        world.enqueueCommand({ type: 'train', playerId: this.playerId, buildingId: cc.id, templateId: civ.units.woman });
      } else if (soldiers.length < this.params.targetWorkers) {
        const pick = world.rng.next() < 0.6 ? civ.units.infantryMelee : civ.units.infantryRanged;
        world.enqueueCommand({ type: 'train', playerId: this.playerId, buildingId: cc.id, templateId: pick });
      }
    }

    if (barracks && barracks.queue.length < 2 && totalPop < Math.min(player.popCap, this.params.maxPopTarget)) {
      const roll = world.rng.next();
      const unitId = roll < 0.48 ? civ.units.infantryMelee : roll < 0.82 ? civ.units.infantryRanged : civ.units.cavalry;
      world.enqueueCommand({ type: 'train', playerId: this.playerId, buildingId: barracks.id, templateId: unitId });
    }

    const fortress = myBuildings.find((b) => b.templateId === 'fortress' && !b.isFoundation);
    if (fortress && fortress.queue.length < 2 && totalPop < Math.min(player.popCap - 1, this.params.maxPopTarget)) {
      world.enqueueCommand({ type: 'train', playerId: this.playerId, buildingId: fortress.id, templateId: civ.units.champion });
    }

    // 8. Launch Military Attack Waves
    const waveSize = Math.min(20, this.params.attackWaveBase + this.waveCount * this.params.attackWaveStep);
    const availableFighters = soldiers.filter((s) => s.order.type !== 'attack' && s.order.type !== 'build');
    if (!threat && availableFighters.length >= waveSize && world.time - this.lastAttackTime > 32) {
      const enemyTarget = this.findEnemyTarget(world, cc.x, cc.z);
      if (enemyTarget) {
        this.waveCount++;
        this.lastAttackTime = world.time;
        const squad = availableFighters.slice(0, waveSize);
        const isBuilding = TEMPLATES[enemyTarget.templateId].kind === 'building';
        world.enqueueCommand({
          type: 'attack',
          playerId: this.playerId,
          entityIds: squad.map((s) => s.id),
          targetId: enemyTarget.id,
          mode: isBuilding && world.rng.next() < 0.55 ? 'capture' : 'attack',
        });
      }
    }
  }

  private pickNeededResource(counts: Record<ResourceType, number>, isWoman: boolean, phase: 1 | 2): ResourceType {
    if (isWoman) {
      return counts.food <= counts.wood + 2 ? 'food' : 'wood';
    }
    const targets: Record<ResourceType, number> =
      phase === 1
        ? { food: 0.34, wood: 0.34, stone: 0.18, metal: 0.14 }
        : { food: 0.3, wood: 0.28, stone: 0.2, metal: 0.22 };
    const total = Math.max(1, counts.food + counts.wood + counts.stone + counts.metal);
    let best: ResourceType = 'wood';
    let worstDeficit = -999;
    for (const r of ['food', 'wood', 'stone', 'metal'] as ResourceType[]) {
      const deficit = targets[r] - counts[r] / total;
      if (deficit > worstDeficit) {
        worstDeficit = deficit;
        best = r;
      }
    }
    return best;
  }

  private tryBuildNear(
    world: World,
    anchor: Entity,
    templateId: string,
    builders: Entity[],
    minR = 6,
    maxR = 14
  ): boolean {
    if (builders.length === 0) return false;
    for (let attempt = 0; attempt < 18; attempt++) {
      const ang = world.rng.range(0, Math.PI * 2);
      const r = world.rng.range(minR, maxR);
      const tx = Math.round(anchor.tileX + Math.cos(ang) * r);
      const tz = Math.round(anchor.tileZ + Math.sin(ang) * r);
      if (world.canPlaceBuilding(this.playerId, templateId, tx, tz).ok) {
        world.enqueueCommand({
          type: 'build',
          playerId: this.playerId,
          entityIds: builders.map((b) => b.id),
          templateId,
          tileX: tx,
          tileZ: tz,
        });
        return true;
      }
    }
    return false;
  }

  private tryBuildNearPoint(
    world: World,
    centerTx: number,
    centerTz: number,
    templateId: string,
    builders: Entity[]
  ): boolean {
    if (builders.length === 0) return false;
    for (let r = 0; r <= 7; r += 2) {
      for (let attempt = 0; attempt < 8; attempt++) {
        const ang = (attempt / 8) * Math.PI * 2;
        const tx = Math.round(centerTx + Math.cos(ang) * r);
        const tz = Math.round(centerTz + Math.sin(ang) * r);
        if (world.canPlaceBuilding(this.playerId, templateId, tx, tz).ok) {
          world.enqueueCommand({
            type: 'build',
            playerId: this.playerId,
            entityIds: builders.map((b) => b.id),
            templateId,
            tileX: tx,
            tileZ: tz,
          });
          return true;
        }
      }
    }
    return false;
  }

  private findEnemyTarget(world: World, fromX: number, fromZ: number): Entity | null {
    let best: Entity | null = null;
    let bestScore = Infinity;
    for (const e of world.entities.values()) {
      if (!e.alive || e.owner === 0 || e.owner === this.playerId || e.garrisonedIn !== null) continue;
      const tpl = TEMPLATES[e.templateId];
      const d = Math.hypot(e.x - fromX, e.z - fromZ);
      let bias = 0;
      if (tpl.isCivicCenter) bias = -15;
      else if (tpl.kind === 'building') bias = -5;
      const score = d + bias;
      if (score < bestScore) {
        bestScore = score;
        best = e;
      }
    }
    return best;
  }
}
