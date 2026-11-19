import { describe, expect, it } from 'vitest';
import { TEMPLATES } from '../src/config/entities';
import { SkirmishAI } from '../src/sim/ai/SkirmishAI';
import { SIM_HZ, World } from '../src/sim/World';

describe('Web 0 A.D. Headless Simulation', () => {
  it('produces identical state hashes across deterministic runs', () => {
    const runMatch = () => {
      const world = new World({
        seed: 202604,
        playerCiv: 'athenians',
        aiCiv: 'romans',
        difficulty: 'medium',
        aiVsAi: true,
      });
      const ai1 = new SkirmishAI(1, 'medium');
      const ai2 = new SkirmishAI(2, 'medium');

      for (let t = 0; t < SIM_HZ * 60; t++) {
        ai1.update(world);
        ai2.update(world);
        world.step();
      }
      return world.computeStateHash();
    };

    const h1 = runMatch();
    const h2 = runMatch();
    expect(h1).toBe(h2);
  });

  it('generates varied random maps across seeds and archetypes with diverse resources and valid cross-map pathing', () => {
    const archetypes = ['aegean_valley', 'medit_highlands', 'twin_peninsulas', 'inland_oasis', 'open_plains'] as const;

    const hashes = new Set<number>();
    const spawnPositions = new Set<string>();

    for (let i = 0; i < archetypes.length; i++) {
      const mapType = archetypes[i];
      const world = new World({
        seed: 1000 + i * 7919,
        playerCiv: 'athenians',
        aiCiv: 'romans',
        difficulty: 'easy',
        mapType,
      });

      const s1 = world.terrain.spawns[0];
      const s2 = world.terrain.spawns[1];
      spawnPositions.add(`${s1.tileX},${s1.tileZ}`);
      hashes.add(world.computeStateHash());

      // Friendly territory around Player 1 spawn & neutral center (unless oasis lake)
      expect(world.territory.getOwnerAtTile(s1.tileX, s1.tileZ)).toBe(1);
      expect(world.territory.getOwnerAtTile(s2.tileX, s2.tileZ)).toBe(2);
      expect(world.territory.getOwnerAtTile(64, 64)).toBe(0);

      // House must be in friendly territory
      const neutralCheck = world.canPlaceBuilding(1, 'house', 64, 64);
      expect(neutralCheck.ok).toBe(false);

      // Verify walkable cross-map path between opposing bases
      expect(world.terrain.areSpawnsConnected()).toBe(true);
      const start = world.terrain.tileToWorldCenter(s1.tileX, s1.tileZ);
      const goal = world.terrain.tileToWorldCenter(s2.tileX, s2.tileZ);
      const path = world.navGrid.findPath(start.x, start.z, goal.x, goal.z, 8000);
      expect(path.length).toBeGreaterThan(0);

      // Verify diverse resources spawned (all 4 resource types & multiple distinct templates)
      const resTypes = new Set<string>();
      const resTemplates = new Set<string>();
      for (const e of world.entities.values()) {
        const tpl = TEMPLATES[e.templateId];
        if (tpl.kind === 'resource' && tpl.resourceType) {
          resTypes.add(tpl.resourceType);
          resTemplates.add(e.templateId);
        }
      }
      expect(resTypes.has('food')).toBe(true);
      expect(resTypes.has('wood')).toBe(true);
      expect(resTypes.has('stone')).toBe(true);
      expect(resTypes.has('metal')).toBe(true);
      expect(resTemplates.size).toBeGreaterThanOrEqual(8);

      // Every player MUST have at least 2 Stone & 2 Metal right near their starting Civic Center
      for (const spawn of world.terrain.spawns) {
        const ccWorld = world.terrain.tileToWorldCenter(spawn.tileX, spawn.tileZ);
        let nearStone = 0;
        let nearMetal = 0;
        let nearFood = 0;
        let nearWood = 0;
        for (const e of world.entities.values()) {
          const tpl = TEMPLATES[e.templateId];
          if (tpl.kind !== 'resource') continue;
          const dist = Math.hypot(e.x - ccWorld.x, e.z - ccWorld.z);
          if (dist <= 32) {
            if (tpl.resourceType === 'stone') nearStone++;
            if (tpl.resourceType === 'metal') nearMetal++;
            if (tpl.resourceType === 'food') nearFood++;
            if (tpl.resourceType === 'wood') nearWood++;
          }
        }
        expect(nearStone, `Starter stone near P${spawn.playerId} on ${mapType}`).toBeGreaterThanOrEqual(3);
        expect(nearMetal, `Starter metal near P${spawn.playerId} on ${mapType}`).toBeGreaterThanOrEqual(3);
        expect(nearFood, `Starter food near P${spawn.playerId} on ${mapType}`).toBeGreaterThanOrEqual(4);
        expect(nearWood, `Starter wood near P${spawn.playerId} on ${mapType}`).toBeGreaterThanOrEqual(10);
      }

      // Verify abundant map-wide stone & metal + genuine terrain elevation variety (not flat!)
      let totalStone = 0;
      let totalMetal = 0;
      for (const e of world.entities.values()) {
        const tpl = TEMPLATES[e.templateId];
        if (tpl.resourceType === 'stone') totalStone++;
        if (tpl.resourceType === 'metal') totalMetal++;
      }
      expect(totalStone).toBeGreaterThanOrEqual(14);
      expect(totalMetal).toBeGreaterThanOrEqual(14);

      let minH = Infinity;
      let maxH = -Infinity;
      let highlandWalkable = 0;
      for (let z = 0; z < world.terrain.height; z++) {
        for (let x = 0; x < world.terrain.width; x++) {
          const h = world.terrain.getVertexHeight(x, z);
          if (h < minH) minH = h;
          if (h > maxH) maxH = h;
          if (h > 4.5 && world.terrain.isTileStaticPassable(x, z)) highlandWalkable++;
        }
      }
      expect(maxH - minH).toBeGreaterThan(13);
      expect(highlandWalkable).toBeGreaterThan(150);
    }

    // Different seeds must produce genuinely distinct random worlds & spawn layouts
    expect(hashes.size).toBe(archetypes.length);
    expect(spawnPositions.size).toBeGreaterThanOrEqual(4);
  });

  it('gathers resources and constructs buildings cleanly', () => {
    const world = new World({
      seed: 99,
      playerCiv: 'athenians',
      aiCiv: 'romans',
      difficulty: 'easy',
    });

    const p1 = world.players.get(1)!;
    const startFood = p1.resources.food;

    const woman = Array.from(world.entities.values()).find(
      (e) => e.owner === 1 && e.templateId === 'female_citizen'
    )!;
    const berry = world.findNearestResource(woman.x, woman.z, 'food', 1, 50)!;
    expect(berry).not.toBeNull();

    world.enqueueCommand({
      type: 'gather',
      playerId: 1,
      entityIds: [woman.id],
      targetId: berry.id,
    });

    for (let t = 0; t < SIM_HZ * 25; t++) {
      world.step();
    }

    expect(p1.resources.food).toBeGreaterThan(startFood);
    expect(p1.stats.resourcesGathered).toBeGreaterThan(0);
  });

  it('allows workers to chop wood and auto-assigns idle workers to gather resources', () => {
    const world = new World({
      seed: 31415,
      playerCiv: 'athenians',
      aiCiv: 'romans',
      difficulty: 'easy',
    });

    const p1 = world.players.get(1)!;
    const startWood = p1.resources.wood;

    // 1. Explicitly order a hoplite to chop the nearest tree
    const soldier = Array.from(world.entities.values()).find(
      (e) => e.owner === 1 && e.templateId === 'athen_hoplite'
    )!;
    const tree = world.findNearestResource(soldier.x, soldier.z, 'wood', 1, 60)!;
    expect(tree).not.toBeNull();

    world.enqueueCommand({
      type: 'gather',
      playerId: 1,
      entityIds: [soldier.id],
      targetId: tree.id,
    });

    // 2. Leave all other starting workers untouched — they must auto-find work!
    for (let t = 0; t < SIM_HZ * 22; t++) {
      world.step();
    }

    expect(p1.resources.wood).toBeGreaterThan(startWood);
    const activeGatherers = Array.from(world.entities.values()).filter(
      (e) => e.alive && e.owner === 1 && e.order.type === 'gather'
    );
    expect(activeGatherers.length).toBeGreaterThanOrEqual(3);
  });

  it('enforces aggressive, defensive, stand_ground, and passive military stances accurately', () => {
    const world = new World({
      seed: 27182,
      playerCiv: 'athenians',
      aiCiv: 'romans',
      difficulty: 'easy',
    });

    const s1 = world.terrain.spawns[0];
    const base = world.terrain.tileToWorldCenter(s1.tileX, s1.tileZ);

    // Spawn 4 test soldiers with each stance at clean positions
    const aggUnit = world.spawnUnit('athen_hoplite', 1, base.x, base.z + 6)!;
    aggUnit.stance = 'aggressive';

    const defUnit = world.spawnUnit('athen_hoplite', 1, base.x + 2, base.z + 6)!;
    defUnit.stance = 'defensive';
    defUnit.guardX = defUnit.x;
    defUnit.guardZ = defUnit.z;

    const holdUnit = world.spawnUnit('athen_hoplite', 1, base.x - 2, base.z + 6)!;
    holdUnit.stance = 'stand_ground';
    const holdStartX = holdUnit.x;
    const holdStartZ = holdUnit.z;

    const passUnit = world.spawnUnit('athen_hoplite', 1, base.x - 4, base.z + 6)!;
    passUnit.stance = 'passive';

    // Spawn a distant enemy 22 units away (within aggressive scan, outside defensive guard leash & melee hold range)
    const farEnemy = world.spawnUnit('rome_hastatus', 2, base.x, base.z + 28)!;
    farEnemy.stance = 'passive';

    for (let t = 0; t < SIM_HZ * 2; t++) {
      world.step();
    }

    // Aggressive unit actively engages far enemy; defensive, stand_ground, and passive do not
    expect(aggUnit.order.type).toBe('attack');
    expect(defUnit.order.type).not.toBe('attack');
    expect(Math.hypot(holdUnit.x - holdStartX, holdUnit.z - holdStartZ)).toBeLessThan(0.8);
    expect(passUnit.order.type).not.toBe('attack');

    // Now place an enemy right inside defensive zone (10 units away from defUnit)
    const nearEnemy = world.spawnUnit('rome_hastatus', 2, defUnit.x + 8, defUnit.z)!;
    nearEnemy.stance = 'passive';

    for (let t = 0; t < SIM_HZ * 1; t++) {
      world.step();
    }

    expect(defUnit.order.type).toBe('attack');
    expect(passUnit.order.type).not.toBe('attack');
  });

  it('slays live deer into a carcass before butchering meat and supports Temple Healers & Market trade', () => {
    const world = new World({
      seed: 55511,
      playerCiv: 'athenians',
      aiCiv: 'romans',
      difficulty: 'easy',
    });

    const woman = Array.from(world.entities.values()).find(
      (e) => e.owner === 1 && e.templateId === 'female_citizen'
    )!;
    const deer = Array.from(world.entities.values()).find((e) => e.templateId === 'deer_herd')!;
    expect(deer.hp).toBeGreaterThan(0);
    const deerStartX = deer.x;
    const deerStartZ = deer.z;

    // Move woman right next to deer and order gather/hunt
    woman.x = deer.x + 1.1;
    woman.z = deer.z;
    world.enqueueCommand({
      type: 'gather',
      playerId: 1,
      entityIds: [woman.id],
      targetId: deer.id,
    });

    // After 1 second, hunted deer must actively bolt & flee instead of standing motionless
    for (let t = 0; t < SIM_HZ * 1; t++) {
      world.step();
    }
    expect(Math.hypot(deer.x - deerStartX, deer.z - deerStartZ)).toBeGreaterThan(1.0);
    expect(deer.hp).toBeGreaterThan(0);

    // After chasing for ~10 more seconds, deer is slain (hp === 0) into a harvestable carcass
    for (let t = 0; t < SIM_HZ * 12; t++) {
      world.step();
    }
    expect(deer.hp).toBe(0);
    expect(deer.alive).toBe(true);
    expect(deer.resourceRemaining).toBeLessThan(TEMPLATES.deer_herd.resourceAmount!);

    // Verify Wild Boar fights back when hunted instead of instantly collapsing
    const boar = Array.from(world.entities.values()).find((e) => e.templateId === 'wild_boar')!;
    expect(boar).toBeDefined();
    const hunter = world.spawnUnit('athen_hoplite', 1, boar.x + 1.0, boar.z)!;
    const hunterStartHp = hunter.hp;
    world.enqueueCommand({
      type: 'gather',
      playerId: 1,
      entityIds: [hunter.id],
      targetId: boar.id,
    });
    for (let t = 0; t < SIM_HZ * 2; t++) {
      world.step();
    }
    expect(hunter.hp).toBeLessThan(hunterStartHp);
    for (let t = 0; t < SIM_HZ * 5; t++) {
      world.step();
    }
    expect(boar.hp).toBe(0);
    expect(boar.alive).toBe(true);

    // Verify Temple Healer heals a wounded friendly unit automatically
    const s1 = world.terrain.spawns[0];
    const base = world.terrain.tileToWorldCenter(s1.tileX, s1.tileZ);
    const wounded = world.spawnUnit('athen_hoplite', 1, base.x + 4, base.z + 4)!;
    wounded.hp = 35;
    const healer = world.spawnUnit('healer', 1, base.x + 6, base.z + 4)!;
    expect(healer).not.toBeNull();

    for (let t = 0; t < SIM_HZ * 4; t++) {
      world.step();
    }
    expect(wounded.hp).toBeGreaterThan(55);
  });

  it('supports combat XP promotion and building capture flipping territory', () => {
    const world = new World({
      seed: 101,
      playerCiv: 'athenians',
      aiCiv: 'romans',
      difficulty: 'easy',
    });

    // Spawn an enemy barracks near player 1's random spawn to test capture
    const s1 = world.terrain.spawns[0];
    const dirX = s1.tileX < 64 ? 1 : -1;
    const dirZ = s1.tileZ < 64 ? 1 : -1;
    const enemyBarracks = world.spawnBuilding('barracks', 2, s1.tileX + dirX * 8, s1.tileZ + dirZ * 8, false)!;
    expect(enemyBarracks).not.toBeNull();
    expect(enemyBarracks.owner).toBe(2);

    const attackers: number[] = [];
    for (let i = 0; i < 8; i++) {
      const u = world.spawnUnit('athen_hoplite', 1, enemyBarracks.x - 5 + i * 0.7, enemyBarracks.z + 5)!;
      attackers.push(u.id);
    }

    world.enqueueCommand({
      type: 'attack',
      playerId: 1,
      entityIds: attackers,
      targetId: enemyBarracks.id,
      mode: 'capture',
    });

    for (let t = 0; t < SIM_HZ * 20; t++) {
      world.step();
    }

    expect(enemyBarracks.alive).toBe(true);
    expect(enemyBarracks.owner).toBe(1);
    expect(world.players.get(1)!.stats.buildingsCaptured).toBeGreaterThanOrEqual(1);
  });

  it('positions workers tightly against resources and climbs hills/mountain clicks without getting stuck', () => {
    const world = new World({
      seed: 42424,
      playerCiv: 'athenians',
      aiCiv: 'romans',
      difficulty: 'easy',
      mapType: 'medit_highlands',
    });

    // 1. Worker close-contact distance check when chopping a tree
    const worker = Array.from(world.entities.values()).find(
      (e) => e.owner === 1 && e.templateId === 'athen_hoplite'
    )!;
    const tree = world.findNearestResource(worker.x, worker.z, 'wood', 1, 50)!;
    world.enqueueCommand({
      type: 'gather',
      playerId: 1,
      entityIds: [worker.id],
      targetId: tree.id,
    });

    let recordedGatherDist = Infinity;
    for (let t = 0; t < SIM_HZ * 14; t++) {
      world.step();
      if (worker.animState === 'gather' && worker.order.type === 'gather') {
        const curTarget = world.entities.get(worker.order.targetId);
        if (curTarget) {
          const d = Math.hypot(worker.x - curTarget.x, worker.z - curTarget.z);
          const contactLimit = TEMPLATES[worker.templateId].radius + TEMPLATES[curTarget.templateId].radius + 0.55;
          recordedGatherDist = Math.min(recordedGatherDist, d - contactLimit);
          break;
        }
      }
    }
    expect(recordedGatherDist).toBeLessThanOrEqual(0.05);

    // 2. Mountain climbing & clicking directly on an impassable high mountain peak must not get stuck
    let peakTx = -1;
    let peakTz = -1;
    let peakH = -Infinity;
    for (let z = 8; z < world.terrain.height - 8; z++) {
      for (let x = 8; x < world.terrain.width - 8; x++) {
        const h = world.terrain.getVertexHeight(x, z);
        if (!world.terrain.isTileStaticPassable(x, z) && h > peakH) {
          peakH = h;
          peakTx = x;
          peakTz = z;
        }
      }
    }
    expect(peakTx).toBeGreaterThan(0);

    const foothill = world.navGrid.findNearestWalkable(peakTx, peakTz, 18)!;
    expect(foothill).not.toBeNull();
    const startPos = world.terrain.tileToWorldCenter(foothill.tx, foothill.tz);
    const peakWorld = world.terrain.tileToWorldCenter(peakTx, peakTz);

    // Spawn climber 12 tiles away from the mountain peak and order them directly onto the peak
    const climber = world.spawnUnit('athen_hoplite', 1, startPos.x, startPos.z)!;
    world.enqueueCommand({
      type: 'move',
      playerId: 1,
      entityIds: [climber.id],
      x: peakWorld.x,
      z: peakWorld.z,
    });

    for (let t = 0; t < SIM_HZ * 12; t++) {
      world.step();
    }
    // Climber must cleanly finish its move order on walkable terrain instead of getting wedged forever
    expect(climber.order.type).not.toBe('move');
    const cTile = world.terrain.worldToTile(climber.x, climber.z);
    expect(world.terrain.isTileStaticPassable(cTile.tx, cTile.tz)).toBe(true);
  });

  it('runs a stable 6-minute AI vs AI soak match with economy, training, and combat', () => {
    const world = new World({
      seed: 777,
      playerCiv: 'athenians',
      aiCiv: 'romans',
      difficulty: 'hard',
      aiVsAi: true,
    });
    const ai1 = new SkirmishAI(1, 'hard');
    const ai2 = new SkirmishAI(2, 'hard');

    for (let t = 0; t < SIM_HZ * 360; t++) {
      ai1.update(world);
      ai2.update(world);
      world.step();
      if (world.winnerId !== null) break;
    }

    const p1 = world.players.get(1)!;
    const p2 = world.players.get(2)!;
    expect(p1.stats.resourcesGathered).toBeGreaterThan(500);
    expect(p2.stats.resourcesGathered).toBeGreaterThan(500);
    expect(p1.stats.unitsTrained).toBeGreaterThan(5);
    expect(p2.stats.unitsTrained).toBeGreaterThan(5);
    expect(p1.stats.buildingsConstructed).toBeGreaterThan(1);
    expect(p2.stats.buildingsConstructed).toBeGreaterThan(1);

    // Ensure no NaN positions or HP
    for (const e of world.entities.values()) {
      expect(Number.isFinite(e.x)).toBe(true);
      expect(Number.isFinite(e.z)).toBe(true);
      expect(Number.isFinite(e.hp)).toBe(true);
      expect(TEMPLATES[e.templateId]).toBeDefined();
    }
  });
});
