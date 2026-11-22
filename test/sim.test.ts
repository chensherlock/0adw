import { describe, expect, it } from 'vitest';
import { ALL_CIV_IDS, CIVS } from '../src/config/civs';
import { TECHS, TEMPLATES } from '../src/config/entities';
import { extractTerritoryContours } from '../src/render/TerritoryBorderBuilder';
import { SkirmishAI } from '../src/sim/ai/SkirmishAI';
import { ALL_MAP_TYPES, SOIL_UNITS_PER_TILE, WATER_LEVEL } from '../src/sim/map/TerrainMap';
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
    const archetypes = [
      'aegean_valley',
      'medit_highlands',
      'twin_peninsulas',
      'inland_oasis',
      'open_plains',
      'alpine_passes',
    ] as const;

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
  }, 15000);

  it('extracts smooth closed territory border contours around both Civic Centers', () => {
    const world = new World({
      seed: 424242,
      playerCiv: 'athenians',
      aiCiv: 'romans',
      difficulty: 'medium',
      mapType: 'open_plains',
    });

    const loops = extractTerritoryContours(world.territory, world.terrain);
    const p1Loops = loops.filter((l) => l.owner === 1);
    const p2Loops = loops.filter((l) => l.owner === 2);

    expect(p1Loops.length).toBeGreaterThanOrEqual(1);
    expect(p2Loops.length).toBeGreaterThanOrEqual(1);

    for (const loop of loops) {
      expect(loop.perimeter).toBeGreaterThan(20);
      expect(loop.points.length).toBeGreaterThan(20);
      for (const p of loop.points) {
        expect(Number.isFinite(p.x)).toBe(true);
        expect(Number.isFinite(p.z)).toBe(true);
        expect(p.x).toBeGreaterThanOrEqual(0);
        expect(p.x).toBeLessThanOrEqual(world.terrain.worldSize);
        expect(p.z).toBeGreaterThanOrEqual(0);
        expect(p.z).toBeLessThanOrEqual(world.terrain.worldSize);
      }
    }
  });

  it('gives all 14 official 0 A.D. civilizations distinct unique buildings, units, techs, skills, and authentic restrictions', () => {
    const uniqueBuildings = new Set<string>();
    const uniqueSkills = new Set<string>();
    const meleeUnits = new Set<string>();

    for (const civId of ALL_CIV_IDS) {
      const civ = CIVS[civId];
      uniqueBuildings.add(civ.uniqueBuilding);
      uniqueSkills.add(civ.skill.id);
      meleeUnits.add(civ.units.infantryMelee);

      const world = new World({
        seed: 8888,
        playerCiv: civId,
        aiCiv: civId === 'romans' ? 'athenians' : 'romans',
        difficulty: 'easy',
        mapType: 'open_plains',
      });

      const p1 = world.players.get(1)!;
      p1.resources = { food: 1000, wood: 1000, stone: 1000, metal: 1000 };
      p1.phase = 2;

      // Starting melee soldiers match civ roster
      const myMelee = Array.from(world.entities.values()).filter(
        (e) => e.alive && e.owner === 1 && e.templateId === civ.units.infantryMelee
      );
      expect(myMelee.length).toBeGreaterThanOrEqual(4);

      // Cannot build another civilization's unique building
      const foreignCiv = ALL_CIV_IDS.find((c) => c !== civId)!;
      const foreignBld = CIVS[foreignCiv].uniqueBuilding;
      const s1 = world.terrain.spawns[0];
      const foreignCheck = world.canPlaceBuilding(1, foreignBld, s1.tileX + 6, s1.tileZ);
      expect(foreignCheck.ok).toBe(false);

      // Authentic vanilla 0 A.D. civ constraints & bonuses
      if (civId === 'spartans') {
        expect(world.canPlaceBuilding(1, 'stone_wall', s1.tileX + 6, s1.tileZ).ok).toBe(false);
        expect(world.canPlaceBuilding(1, 'stone_gate', s1.tileX + 6, s1.tileZ).ok).toBe(false);
      } else if (civId === 'kushites') {
        expect(world.canPlaceBuilding(1, 'workshop', s1.tileX + 6, s1.tileZ).ok).toBe(false);
      } else if (civId === 'persians') {
        // Persians receive +20% pop cap bonus (base CC 15 -> 18)
        expect(p1.popCap).toBeGreaterThanOrEqual(18);
      }

      // Unique building template belongs to this civ and can train its special unit & research its techs
      const ubTpl = TEMPLATES[civ.uniqueBuilding];
      expect(ubTpl.civ).toBe(civId);
      expect(ubTpl.trains).toContain(civ.units.special);
      for (const tid of civ.uniqueTechs) {
        expect(TECHS[tid].civ).toBe(civId);
        expect(ubTpl.researches).toContain(tid);
      }

      // Active civilization skill triggers cleanly, applies effects, and starts cooldown
      const foodBefore = p1.resources.food;
      const armorBefore = world.getEntityArmor(myMelee[0]).pierce;
      world.enqueueCommand({ type: 'activate_skill', playerId: 1 });
      world.step();

      expect(p1.skillActiveTimer).toBeGreaterThan(0);
      expect(p1.skillCooldown).toBeGreaterThan(0);
      if (civId === 'persians') {
        expect(p1.resources.food).toBe(foodBefore + 150);
      } else if (civId === 'han') {
        expect(p1.resources.food).toBe(foodBefore + 160);
      } else if (civId === 'athenians' || civId === 'kushites' || civId === 'mauryas') {
        expect(world.getEntityArmor(myMelee[0]).pierce).toBe(armorBefore + 4);
      } else if (civId === 'romans') {
        expect(world.getEntityArmor(myMelee[0]).pierce).toBe(armorBefore + 5);
      }
    }

    expect(uniqueBuildings.size).toBe(14);
    expect(uniqueSkills.size).toBe(14);
    expect(meleeUnits.size).toBe(14);
  });

  it('supports cheat commands (resources, fast build, all techs, skill reset, heal, spawn army, instant win)', () => {
    const world = new World({
      seed: 77777,
      playerCiv: 'han',
      aiCiv: 'mauryas',
      difficulty: 'easy',
      mapType: 'open_plains',
    });

    const p1 = world.players.get(1)!;
    const food0 = p1.resources.food;

    // +5000 All Resources
    world.enqueueCommand({ type: 'cheat', playerId: 1, action: 'resources' });
    world.step();
    expect(p1.resources.food).toBe(food0 + 5000);
    expect(p1.resources.metal).toBeGreaterThanOrEqual(5000);

    // Phase IV + All Techs
    world.enqueueCommand({ type: 'cheat', playerId: 1, action: 'all_techs' });
    world.step();
    expect(p1.phase).toBe(4);
    expect(p1.researchedTechs.has('tech_han_crossbow')).toBe(true);
    expect(p1.researchedTechs.has('tech_steel_weapons')).toBe(true);
    expect(p1.researchedTechs.has('tech_maur_elephants')).toBe(false);

    // Skill cooldown reset
    world.enqueueCommand({ type: 'activate_skill', playerId: 1 });
    world.step();
    expect(p1.skillCooldown).toBeGreaterThan(0);
    world.enqueueCommand({ type: 'cheat', playerId: 1, action: 'reset_skill' });
    world.step();
    expect(p1.skillCooldown).toBe(0);

    // Toggle Fast Build & Train
    world.enqueueCommand({ type: 'cheat', playerId: 1, action: 'fast_build' });
    world.step();
    expect(p1.fastBuildCheat).toBe(true);

    // Spawn Army + Full Heal
    const unitsBefore = Array.from(world.entities.values()).filter((e) => e.owner === 1 && TEMPLATES[e.templateId].kind === 'unit').length;
    world.enqueueCommand({ type: 'cheat', playerId: 1, action: 'spawn_army' });
    world.step();
    const unitsAfter = Array.from(world.entities.values()).filter((e) => e.owner === 1 && TEMPLATES[e.templateId].kind === 'unit');
    expect(unitsAfter.length).toBeGreaterThanOrEqual(unitsBefore + 6);

    unitsAfter[0].hp = 5;
    world.enqueueCommand({ type: 'cheat', playerId: 1, action: 'heal_all' });
    world.step();
    expect(unitsAfter[0].hp).toBe(unitsAfter[0].maxHp);

    // Instant Victory
    world.enqueueCommand({ type: 'cheat', playerId: 1, action: 'instant_win' });
    world.step();
    expect(world.winnerId).toBe(1);
  });

  it('builds continuous stone walls and passable friendly city gates', () => {
    const world = new World({
      seed: 31415,
      playerCiv: 'romans',
      aiCiv: 'han',
      difficulty: 'easy',
      mapType: 'open_plains',
    });

    const p1 = world.players.get(1)!;
    p1.resources = { food: 1000, wood: 1000, stone: 1000, metal: 1000 };
    const s1 = world.terrain.spawns[0];
    const builders = Array.from(world.entities.values())
      .filter((e) => e.alive && e.owner === 1 && TEMPLATES[e.templateId].canBuild?.includes('stone_wall'))
      .map((e) => e.id);
    expect(builders.length).toBeGreaterThanOrEqual(4);

    // Find a clear horizontal 5-tile line inside P1 territory for 3 walls + 1 gate
    let lineStart: { tx: number; tz: number } | null = null;
    for (let dz = -10; dz <= 10 && !lineStart; dz += 2) {
      for (let dx = -10; dx <= 6 && !lineStart; dx += 2) {
        const tx = s1.tileX + dx;
        const tz = s1.tileZ + dz;
        if (
          world.canPlaceBuilding(1, 'stone_wall', tx, tz).ok &&
          world.canPlaceBuilding(1, 'stone_wall', tx + 1, tz).ok &&
          world.canPlaceBuilding(1, 'stone_wall', tx + 2, tz).ok &&
          world.canPlaceBuilding(1, 'stone_gate', tx + 4, tz).ok
        ) {
          lineStart = { tx, tz };
        }
      }
    }
    expect(lineStart).not.toBeNull();

    // Queue 3 adjacent walls + 1 gate
    for (let i = 0; i < 3; i++) {
      world.enqueueCommand({
        type: 'build',
        playerId: 1,
        entityIds: builders,
        templateId: 'stone_wall',
        tileX: lineStart!.tx + i,
        tileZ: lineStart!.tz,
        facing: 0,
      });
    }
    world.enqueueCommand({
      type: 'build',
      playerId: 1,
      entityIds: builders,
      templateId: 'stone_gate',
      tileX: lineStart!.tx + 4,
      tileZ: lineStart!.tz,
      facing: 0,
    });

    for (let t = 0; t < SIM_HZ * 25; t++) {
      world.step();
    }

    const walls = Array.from(world.entities.values()).filter((e) => e.alive && e.templateId === 'stone_wall');
    const gates = Array.from(world.entities.values()).filter((e) => e.alive && e.templateId === 'stone_gate');
    expect(walls.length).toBe(3);
    expect(gates.length).toBe(1);
    // Stone walls block navGrid walkability; City Gate remains walkable for friendly units
    expect(world.navGrid.isWalkable(lineStart!.tx, lineStart!.tz)).toBe(false);
    expect(world.navGrid.isWalkable(lineStart!.tx + 4, lineStart!.tz)).toBe(true);
  });

  it('spawns sea fish shoals, builds coastal docks, trains ships into navigable water, and fishes cleanly', () => {
    const world = new World({
      seed: 123456,
      playerCiv: 'carthaginians',
      aiCiv: 'ptolemies',
      difficulty: 'easy',
      mapType: 'twin_peninsulas',
    });

    const p1 = world.players.get(1)!;
    p1.resources = { food: 1000, wood: 1000, stone: 1000, metal: 1000 };

    // Verify fish shoals spawned in navigable sea water
    const fishShoals = Array.from(world.entities.values()).filter((e) => e.alive && e.templateId === 'fish_shoal');
    expect(fishShoals.length).toBeGreaterThanOrEqual(4);
    for (const f of fishShoals) {
      const { tx, tz } = world.terrain.worldToTile(f.x, f.z);
      expect(world.terrain.isTileWaterNavigable(tx, tz)).toBe(true);
    }

    // Inland Civic Center spawn tile must reject Dock placement
    const s1 = world.terrain.spawns[0];
    expect(world.canPlaceBuilding(1, 'dock', s1.tileX, s1.tileZ).ok).toBe(false);

    // Find a valid coastal shoreline tile and build a Dock
    let dockTile: { tx: number; tz: number } | null = null;
    for (let tz = 6; tz < world.terrain.height - 6 && !dockTile; tz += 2) {
      for (let tx = 6; tx < world.terrain.width - 6; tx += 2) {
        if (world.canPlaceBuilding(1, 'dock', tx, tz).ok) {
          dockTile = { tx, tz };
          break;
        }
      }
    }
    expect(dockTile).not.toBeNull();

    const dock = world.spawnBuilding('dock', 1, dockTile!.tx, dockTile!.tz, false)!;
    expect(dock).not.toBeNull();

    // Train a Fishing Boat and a Trireme Warship from the Dock
    world.enqueueCommand({ type: 'train', playerId: 1, buildingId: dock.id, templateId: 'fishing_boat' });
    world.enqueueCommand({ type: 'train', playerId: 1, buildingId: dock.id, templateId: 'warship_trireme' });

    const foodStart = p1.resources.food;
    for (let t = 0; t < SIM_HZ * 50; t++) {
      world.step();
    }

    const ships = Array.from(world.entities.values()).filter(
      (e) => e.alive && e.owner === 1 && TEMPLATES[e.templateId].isNaval
    );
    expect(ships.some((s) => s.templateId === 'fishing_boat')).toBe(true);
    expect(ships.some((s) => s.templateId === 'warship_trireme')).toBe(true);

    // Every spawned ship must float on navigable water
    for (const ship of ships) {
      const { tx, tz } = world.terrain.worldToTile(ship.x, ship.z);
      expect(world.terrain.isTileWaterNavigable(tx, tz)).toBe(true);
    }

    // Fishing boat should have sailed out and begun fishing or delivered food
    const boat = ships.find((s) => s.templateId === 'fishing_boat')!;
    const gatheredOrCarrying =
      p1.resources.food > foodStart - 60 || boat.carryAmount > 0 || boat.order.type === 'gather';
    expect(gatheredOrCarrying).toBe(true);
  });

  it('auto-assigns idle workers to the player’s most scarce resource', () => {
    const world = new World({
      seed: 6161,
      playerCiv: 'athenians',
      aiCiv: 'romans',
      difficulty: 'easy',
      mapType: 'open_plains',
    });

    const p1 = world.players.get(1)!;
    // Make Stone dramatically the scarcest resource while Food, Wood, Metal are plentiful
    p1.resources = { food: 1600, wood: 1600, stone: 0, metal: 1600 };

    const worker = Array.from(world.entities.values()).find(
      (e) => e.alive && e.owner === 1 && e.templateId === 'female_citizen'
    )!;
    expect(worker).toBeDefined();
    worker.order = { type: 'idle' };

    for (let t = 0; t < SIM_HZ * 5; t++) {
      world.step();
    }

    const updatedOrder = world.entities.get(worker.id)!.order;
    expect(updatedOrder.type).toBe('gather');
    if (updatedOrder.type === 'gather') {
      expect(updatedOrder.resourceType).toBe('stone');
    }
  });

  it('enforces 100 soil units per tile (1 unit/trip, subsides only after 100 units) and allows building after leveling uneven slopes', () => {
    const world = new World({
      seed: 7171,
      playerCiv: 'romans',
      aiCiv: 'gauls',
      difficulty: 'easy',
      mapType: 'open_plains',
    });

    const p1 = world.players.get(1)!;
    const s1 = world.terrain.spawns[0];
    const dirX = s1.tileX < 64 ? 1 : -1;
    const srcTx = s1.tileX + dirX * 9;
    const srcTz = s1.tileZ;
    const dstTx = srcTx + dirX * 4;
    const dstTz = srcTz;
    expect(world.terrain.getSoilUnits(srcTx, srcTz)).toBe(SOIL_UNITS_PER_TILE);

    const srcCenter = world.terrain.tileToWorldCenter(srcTx, srcTz);
    const dstCenter = world.terrain.tileToWorldCenter(dstTx, dstTz);
    const startSrcY = world.terrain.getHeightAt(srcCenter.x, srcCenter.z);
    const startDstY = world.terrain.getHeightAt(dstCenter.x, dstCenter.z);

    // Normal worker digs 0.01m (1 unit) per scoop: height MUST change immediately on every scoop!
    const worker = world.spawnUnit('female_citizen', 1, srcCenter.x - 1.2, srcCenter.z)!;
    world.enqueueCommand({
      type: 'terraform',
      playerId: 1,
      entityIds: [worker.id],
      tileX: srcTx,
      tileZ: srcTz,
      destTileX: dstTx,
      destTileZ: dstTz,
      mode: 'dig',
    });

    for (let t = 0; t < SIM_HZ * 2; t++) {
      world.step();
    }
    expect(world.terrain.getSoilUnits(srcTx, srcTz)).toBeLessThan(SOIL_UNITS_PER_TILE);
    expect(world.terrain.getSoilUnits(srcTx, srcTz)).toBeGreaterThan(80);
    // Ground elevation immediately dropped by ~0.01m per scoop (no waiting for 100 units!)
    expect(world.terrain.getHeightAt(srcCenter.x, srcCenter.z)).toBeLessThan(startSrcY - 0.005);

    // After finishing all 100 units (accelerated via fastBuildCheat for quick test), source subsides AND dump rises!
    p1.fastBuildCheat = true;
    for (let t = 0; t < SIM_HZ * 18; t++) {
      world.step();
    }
    expect(world.terrain.getHeightAt(srcCenter.x, srcCenter.z)).toBeLessThan(startSrcY - 0.6);
    expect(world.terrain.getHeightAt(dstCenter.x, dstCenter.z)).toBeGreaterThan(startDstY + 0.6);

    // Uneven steep ground becomes buildable once flattened!
    // Pick a resource-free tile inside territory, make it steeply uneven, verify blocked, then flatten & verify buildable!
    let steepTx = s1.tileX + dirX * 6;
    let steepTz = s1.tileZ + 6;
    for (let ox = 5; ox <= 11; ox++) {
      const cx = s1.tileX + dirX * ox;
      const cz = s1.tileZ + 5;
      if (world.canPlaceBuilding(1, 'house', cx, cz).ok) {
        steepTx = cx;
        steepTz = cz;
        break;
      }
    }
    const vw = world.terrain.width + 1;
    world.terrain.heights[steepTz * vw + steepTx] += 2.8;
    world.terrain.heights[steepTz * vw + (steepTx + 1)] -= 1.4;
    world.terrain.version++;
    expect(world.terrain.getTileSlope(steepTx, steepTz)).toBeGreaterThan(1.2);
    expect(world.canPlaceBuilding(1, 'house', steepTx, steepTz).ok).toBe(false);

    // Flatten the uneven terrain -> House can now be built right on top!
    world.terrain.flattenTerrace(steepTx, steepTz);
    expect(world.terrain.getTileSlope(steepTx, steepTz)).toBeLessThan(0.5);
    expect(world.canPlaceBuilding(1, 'house', steepTx, steepTz).ok).toBe(true);
  });

  it('supports dragged long hidden tunnels (100 soil units/tile), suspension bridges, peaceful mode, all 15 terrains, bamboo & predators', () => {
    // 1. Peaceful Mode: armies cannot attack each other!
    const peacefulWorld = new World({
      seed: 9091,
      playerCiv: 'athenians',
      aiCiv: 'romans',
      difficulty: 'medium',
      mapType: 'hills',
      gameMode: 'peaceful',
    });
    expect(peacefulWorld.isPeaceful()).toBe(true);
    expect(peacefulWorld.areHostile(1, 2)).toBe(false);
    const s1p = peacefulWorld.terrain.spawns[0];
    const pc = peacefulWorld.terrain.tileToWorldCenter(s1p.tileX + 5, s1p.tileZ);
    const p1Soldier = peacefulWorld.spawnUnit('athen_hoplite', 1, pc.x, pc.z)!;
    const p2Soldier = peacefulWorld.spawnUnit('rome_hastatus', 2, pc.x + 1.4, pc.z)!;
    const hp1 = p1Soldier.hp;
    const hp2 = p2Soldier.hp;
    peacefulWorld.enqueueCommand({ type: 'attack', playerId: 1, entityIds: [p1Soldier.id], targetId: p2Soldier.id });
    peacefulWorld.enqueueCommand({ type: 'attack', playerId: 2, entityIds: [p2Soldier.id], targetId: p1Soldier.id });
    for (let t = 0; t < SIM_HZ * 5; t++) peacefulWorld.step();
    expect(p1Soldier.hp).toBe(hp1);
    expect(p2Soldier.hp).toBe(hp2);

    // 2. Dragged straight-line hidden tunnel (100 units per tile) & Suspension Bridge!
    const p1 = peacefulWorld.players.get(1)!;
    p1.resources = { food: 3000, wood: 3000, stone: 3000, metal: 3000 };
    const dirX = s1p.tileX < 64 ? 1 : -1;
    const startTx = s1p.tileX + dirX * 7;
    const endTx = s1p.tileX + dirX * 15;
    const tz = s1p.tileZ;
    const digger = peacefulWorld.spawnUnit('female_citizen', 1, pc.x + 4, pc.z)!;
    peacefulWorld.enqueueCommand({
      type: 'build_tunnel',
      playerId: 1,
      entityIds: [digger.id],
      startTileX: startTx,
      startTileZ: tz,
      endTileX: endTx,
      endTileZ: tz,
    });
    peacefulWorld.step();
    const portals = Array.from(peacefulWorld.entities.values()).filter(
      (e) => e.alive && e.owner === 1 && e.templateId === 'tunnel_portal'
    );
    expect(portals.length).toBe(2);
    expect(portals[0].tunnelLengthTiles).toBe(8);
    expect(portals[0].tunnelTotalUnits).toBe(800);
    expect(portals[0].linkedTunnelId).toBe(portals[1].id);
    // After 2 seconds of solo digging, tunnel must STILL be under excavation (long project!)
    for (let t = 0; t < SIM_HZ * 2; t++) peacefulWorld.step();
    expect(portals[0].isFoundation).toBe(true);
    expect(portals[0].buildProgress).toBeGreaterThan(0);
    expect(portals[0].buildProgress).toBeLessThan(0.5);

    // Complete tunnel with fastBuildCheat -> both portals open!
    p1.fastBuildCheat = true;
    for (let t = 0; t < SIM_HZ * 20; t++) peacefulWorld.step();
    expect(portals[0].isFoundation).toBe(false);
    expect(portals[1].isFoundation).toBe(false);

    // 3. All 16 terrain archetypes generate cleanly + Rainforest spawns bamboo, elephants & predators!
    expect(ALL_MAP_TYPES.length).toBe(16);
    for (const mapType of ['island', 'mountain', 'plateau', 'hills', 'mesa', 'swamp', 'rainforest', 'forest', 'volcano'] as const) {
      const w = new World({ seed: 3030, playerCiv: 'han', aiCiv: 'persians', difficulty: 'easy', mapType });
      expect(w.terrain.resolvedMapType).toBe(mapType);
      expect(w.terrain.areSpawnsConnected()).toBe(true);
      if (mapType === 'rainforest') {
        const all = Array.from(w.entities.values());
        expect(all.some((e) => e.templateId === 'tree_bamboo')).toBe(true);
        expect(all.some((e) => e.templateId === 'wild_elephant' || e.templateId === 'wild_gazelle')).toBe(true);
        expect(all.some((e) => TEMPLATES[e.templateId].isPredator)).toBe(true);
      }
    }
  });

  it('supports dismantling ancient ruin pillars for Stone, 4 city tiers, bridges, tunnels, and demolishing buildings for salvage', () => {
    const world = new World({
      seed: 8282,
      playerCiv: 'athenians',
      aiCiv: 'romans',
      difficulty: 'easy',
      mapType: 'aegean_valley',
    });

    const p1 = world.players.get(1)!;
    p1.resources = { food: 4000, wood: 4000, stone: 4000, metal: 4000 };

    // 1. Ancient ruin stone pillars spawned & harvestable for Stone
    const pillar = Array.from(world.entities.values()).find((e) => e.alive && e.templateId === 'ancient_ruin_pillar')!;
    expect(pillar).toBeDefined();
    const stoneBefore = p1.resources.stone;
    const salvager = world.spawnUnit('female_citizen', 1, pillar.x + 1.1, pillar.z)!;
    world.enqueueCommand({ type: 'gather', playerId: 1, entityIds: [salvager.id], targetId: pillar.id });
    for (let t = 0; t < SIM_HZ * 5; t++) world.step();
    expect(pillar.resourceRemaining).toBeLessThan(TEMPLATES.ancient_ruin_pillar.resourceAmount!);

    // 2. Advance through all 4 City Tiers (I -> II -> III -> IV) expanding popCap & territory
    const cc = Array.from(world.entities.values()).find((e) => e.alive && e.owner === 1 && TEMPLATES[e.templateId].isCivicCenter)!;
    const basePopCap = p1.popCap;
    p1.fastBuildCheat = true;
    for (const phaseTech of ['phase_town', 'phase_city', 'phase_empire']) {
      world.enqueueCommand({ type: 'research', playerId: 1, buildingId: cc.id, techId: phaseTech });
      for (let t = 0; t < SIM_HZ * 3; t++) world.step();
    }
    expect(p1.phase).toBe(4);
    expect(p1.popCap).toBeGreaterThanOrEqual(basePopCap + 35);

    // 3. Stone Bridge over water makes water tile land-passable!
    let bridgeTile: { tx: number; tz: number } | null = null;
    for (let tz = 8; tz < world.terrain.height - 8 && !bridgeTile; tz++) {
      for (let tx = 8; tx < world.terrain.width - 8; tx++) {
        if (world.canPlaceBuilding(1, 'stone_bridge', tx, tz).ok) {
          bridgeTile = { tx, tz };
          break;
        }
      }
    }
    expect(bridgeTile).not.toBeNull();
    const bridge = world.spawnBuilding('stone_bridge', 1, bridgeTile!.tx, bridgeTile!.tz, false)!;
    expect(bridge).not.toBeNull();
    expect(world.terrain.isTileBridge(bridgeTile!.tx, bridgeTile!.tz)).toBe(true);
    expect(world.terrain.isTileStaticPassable(bridgeTile!.tx, bridgeTile!.tz)).toBe(true);

    // 4. Two Mountain Tunnel Portals link automatically and transit units across the map!
    const s1 = world.terrain.spawns[0];
    const dirX = s1.tileX < 64 ? 1 : -1;
    const tA = world.spawnBuilding('tunnel_portal', 1, s1.tileX + dirX * 7, s1.tileZ, false)!;
    const tB = world.spawnBuilding('tunnel_portal', 1, s1.tileX + dirX * 15, s1.tileZ, false)!;
    expect(tA.linkedTunnelId).toBe(tB.id);
    expect(tB.linkedTunnelId).toBe(tA.id);

    const runner = world.spawnUnit('athen_hoplite', 1, tA.x, tA.z + 2.2)!;
    world.enqueueCommand({ type: 'use_tunnel', playerId: 1, entityIds: [runner.id], portalId: tA.id });
    for (let t = 0; t < SIM_HZ * 3; t++) world.step();
    expect(Math.hypot(runner.x - tB.x, runner.z - tB.z)).toBeLessThan(8.5);

    // 5. Demolish & Salvage returns ~60% of building materials and frees bridge/tunnel
    const woodBeforeDemolish = p1.resources.wood;
    const stoneBeforeDemolish = p1.resources.stone;
    world.enqueueCommand({ type: 'demolish', playerId: 1, entityIds: [tA.id, bridge.id] });
    world.step();
    expect(tA.alive).toBe(false);
    expect(tB.linkedTunnelId).toBeNull();
    expect(world.terrain.isTileBridge(bridgeTile!.tx, bridgeTile!.tz)).toBe(false);
    expect(p1.resources.wood).toBeGreaterThan(woodBeforeDemolish);
    expect(p1.resources.stone).toBeGreaterThan(stoneBeforeDemolish);
    expect(stoneBefore).toBeGreaterThan(0);
  });

  it('tracks live soil excavation progress, spawns soaring birds, and spawns patrolling deep-sea monsters', () => {
    const world = new World({
      seed: 9191,
      playerCiv: 'athenians',
      aiCiv: 'carthaginians',
      difficulty: 'easy',
      mapType: 'island',
    });

    // 1. Live soil digging & filling progress tracking (for 3D progress markers + HUD progress bars)
    const s1 = world.terrain.spawns[0];
    const digTx = s1.tileX + 4;
    const digTz = s1.tileZ;
    const prevVer = world.terrain.soilProgressVersion;
    world.terrain.digSoilUnit(digTx, digTz, 15);
    expect(world.terrain.soilProgressVersion).toBeGreaterThan(prevVer);
    const activeAfterDig = world.terrain.getActiveSoilTiles();
    expect(activeAfterDig.some((t) => t.tx === digTx && t.tz === digTz && t.dugUnits === 15)).toBe(true);

    const fillTx = s1.tileX + 6;
    const fillTz = s1.tileZ;
    world.terrain.depositSoilUnit(fillTx, fillTz, 22);
    const activeAfterFill = world.terrain.getActiveSoilTiles();
    expect(activeAfterFill.some((t) => t.tx === fillTx && t.tz === fillTz && t.fillUnits === 22)).toBe(true);

    // 2. Soaring wild birds (Eagles & Seagulls) spawn and glide across the sky cleanly
    const birds = Array.from(world.entities.values()).filter((e) => e.alive && TEMPLATES[e.templateId].isFlying);
    expect(birds.length).toBeGreaterThanOrEqual(8);
    const bird0 = birds[0];
    const bx0 = bird0.x;
    const bz0 = bird0.z;
    for (let t = 0; t < SIM_HZ * 2; t++) world.step();
    expect(Math.hypot(bird0.x - bx0, bird0.z - bz0)).toBeGreaterThan(1.0);

    // 3. Deep-sea monsters spawn in ocean waters, patrol, and can be engaged/slain by warships
    const monsters = Array.from(world.entities.values()).filter((e) => e.alive && TEMPLATES[e.templateId].isSeaMonster);
    expect(monsters.length).toBeGreaterThanOrEqual(1);
    const kraken = monsters[0];
    const ship = world.spawnUnit('warship_trireme', 1, kraken.x + 4.5, kraken.z)!;
    expect(ship).not.toBeNull();
    const krakenHpBefore = kraken.hp;
    world.enqueueCommand({ type: 'attack', playerId: 1, entityIds: [ship.id], targetId: kraken.id });
    for (let t = 0; t < SIM_HZ * 4; t++) world.step();
    expect(kraken.hp).toBeLessThan(krakenHpBefore);
  });

  it('supports cooperative multi-worker digging (faster, not deeper), worker-only military construction, detailed attack alerts, and specialized cultural units', () => {
    const world = new World({
      seed: 4444,
      playerCiv: 'britons',
      aiCiv: 'persians',
      difficulty: 'easy',
      mapType: 'open_plains',
    });

    // 1. Suspension bridge is completely removed
    expect(TEMPLATES['suspension_bridge']).toBeUndefined();

    // 2. Military buildings are built by Workers ONLY (not Soldiers!)
    expect(TEMPLATES.female_citizen.canBuild).toContain('barracks');
    expect(TEMPLATES.female_citizen.canBuild).toContain('defense_tower');
    expect(TEMPLATES.female_citizen.canBuild).toContain('fortress');
    expect(TEMPLATES.female_citizen.canBuild).toContain('workshop');
    expect(TEMPLATES.brit_spearman.canBuild?.length ?? 0).toBe(0);
    expect(TEMPLATES.athen_hoplite.canBuild?.length ?? 0).toBe(0);

    // 3. Multi-worker cooperative digging accelerates 1 layer (100 units) and ALL workers stop after 1 layer (never digging deeper!)
    const p1 = world.players.get(1)!;
    p1.fastBuildCheat = true;
    const s1 = world.terrain.spawns[0];
    const digTx = s1.tileX + 5;
    const digTz = s1.tileZ;
    const dumpTx = s1.tileX + 7;
    const dumpTz = s1.tileZ;
    const digPos = world.terrain.tileToWorldCenter(digTx, digTz);
    const heightBefore = world.terrain.getHeightAt(digPos.x, digPos.z);
    const epochBefore = world.terrain.getTerraformEpoch(digTx, digTz);

    const w1 = world.spawnUnit('female_citizen', 1, digPos.x - 1, digPos.z)!;
    const w2 = world.spawnUnit('female_citizen', 1, digPos.x + 1, digPos.z)!;
    const w3 = world.spawnUnit('female_citizen', 1, digPos.x, digPos.z + 1)!;
    world.enqueueCommand({
      type: 'terraform',
      playerId: 1,
      entityIds: [w1.id, w2.id, w3.id],
      tileX: digTx,
      tileZ: digTz,
      destTileX: dumpTx,
      destTileZ: dumpTz,
      mode: 'dig',
    });
    for (let t = 0; t < SIM_HZ * 20; t++) world.step();

    // Exactly ONE subsidence layer happened (epoch + 1), NOT 2 or 3 deeper layers!
    expect(world.terrain.getTerraformEpoch(digTx, digTz)).toBe(epochBefore + 1);
    expect(world.terrain.getHeightAt(digPos.x, digPos.z)).toBeLessThan(heightBefore - 0.5);
    expect(world.terrain.getHeightAt(digPos.x, digPos.z)).toBeGreaterThan(heightBefore - 1.6);
    expect(w1.order.type).not.toBe('terraform');
    expect(w2.order.type).not.toBe('terraform');
    expect(w3.order.type).not.toBe('terraform');

    // 4. Detailed under_attack notifications for BOTH wild beast attacks and enemy attacks!
    world.drainEvents();
    const wildBeast = Array.from(world.entities.values()).find(
      (e) => e.alive && e.owner === 0 && TEMPLATES[e.templateId].isPredator && !TEMPLATES[e.templateId].isSeaMonster
    )!;
    expect(wildBeast).toBeDefined();
    const victim = world.spawnUnit('female_citizen', 1, wildBeast.x + 1.0, wildBeast.z)!;
    victim.stance = 'stand_ground';
    for (let t = 0; t < SIM_HZ * 3; t++) world.step();
    const wildEvents = world.drainEvents().filter((ev) => ev.type === 'under_attack' && ev.playerId === 1);
    expect(
      wildEvents.some(
        (ev) =>
          ev.type === 'under_attack' &&
          ev.isWildlife === true &&
          ev.attackerTemplateId === wildBeast.templateId &&
          ev.victimTemplateId === 'female_citizen'
      )
    ).toBe(true);

    // 5. Specialized cultural warfare & artillery units (War Dogs, Camels, Chariots, War Elephants, Crossbows, Fire Arrows, Lithobolos, Catapult, Ballista)
    expect(TEMPLATES.war_dog.allowedCivs).toContain('britons');
    expect(TEMPLATES.camel_rider.allowedCivs).toContain('persians');
    expect(TEMPLATES.pers_elephant.allowedCivs).toContain('persians');
    expect(TEMPLATES.pers_chariot.allowedCivs).toContain('persians');
    expect(TEMPLATES.han_chariot.allowedCivs).toContain('han');
    expect(TEMPLATES.fire_archer.attack?.projectileKind).toBe('fire_arrow');
    expect(TEMPLATES.siege_lithobolos.attack?.projectileKind).toBe('boulder');
    expect(TEMPLATES.siege_catapult.attack?.projectileKind).toBe('flaming_boulder');
    expect(TEMPLATES.siege_catapult.attack?.splashRadius).toBeGreaterThan(2.5);
    expect(TEMPLATES.siege_ballista.attack?.projectileKind).toBe('bolt');
  });

  it('supports selectable map sizes (small/medium/large/huge) and resuming unfinished digging with other workers', () => {
    // 1. All 4 selectable map sizes generate valid connected maps with proper dimensions
    for (const [size, expectedTiles] of [
      ['small', 96],
      ['medium', 128],
      ['large', 160],
      ['huge', 192],
    ] as const) {
      const w = new World({
        seed: 7373,
        playerCiv: 'han',
        aiCiv: 'ptolemies',
        difficulty: 'easy',
        mapType: 'open_plains',
        mapSize: size,
      });
      expect(w.terrain.width).toBe(expectedTiles);
      expect(w.terrain.height).toBe(expectedTiles);
      expect(w.terrain.worldSize).toBe(expectedTiles * 2);
      expect(w.terrain.areSpawnsConnected()).toBe(true);
    }

    // 2. If Worker A leaves digging unfinished, Worker B can detect & resume the exact same unfinished tile!
    const w2 = new World({
      seed: 8080,
      playerCiv: 'han',
      aiCiv: 'romans',
      difficulty: 'easy',
      mapType: 'open_plains',
      mapSize: 'small',
    });
    const s1 = w2.terrain.spawns[0];
    const digTx = s1.tileX + 5;
    const digTz = s1.tileZ;
    const dumpTx = s1.tileX + 7;
    const dumpTz = s1.tileZ;
    const digPos = w2.terrain.tileToWorldCenter(digTx, digTz);

    const wA = w2.spawnUnit('female_citizen', 1, digPos.x, digPos.z)!;
    w2.enqueueCommand({
      type: 'terraform',
      playerId: 1,
      entityIds: [wA.id],
      tileX: digTx,
      tileZ: digTz,
      destTileX: dumpTx,
      destTileZ: dumpTz,
      mode: 'dig',
    });
    for (let t = 0; t < SIM_HZ * 2; t++) w2.step();
    const dugAfterA = 100 - w2.terrain.getSoilUnits(digTx, digTz);
    expect(dugAfterA).toBeGreaterThan(0);
    expect(dugAfterA).toBeLessThan(100);

    // Pull Worker A completely off the job
    w2.enqueueCommand({ type: 'move', playerId: 1, entityIds: [wA.id], x: digPos.x - 10, z: digPos.z });
    w2.step();
    expect(wA.order.type).toBe('move');

    // Another worker (wB) detects the unfinished job right near (digTx, digTz) and resumes it!
    const unfinishedJob = w2.findActiveTerraformJobAt(1, digTx, digTz);
    expect(unfinishedJob).not.toBeNull();
    expect(unfinishedJob!.tileX).toBe(digTx);
    expect(unfinishedJob!.tileZ).toBe(digTz);
    expect(unfinishedJob!.destTileX).toBe(dumpTx);

    const wB = w2.spawnUnit('female_citizen', 1, digPos.x, digPos.z + 1)!;
    w2.enqueueCommand({
      type: 'terraform',
      playerId: 1,
      entityIds: [wB.id],
      tileX: unfinishedJob!.tileX,
      tileZ: unfinishedJob!.tileZ,
      destTileX: unfinishedJob!.destTileX,
      destTileZ: unfinishedJob!.destTileZ,
      mode: unfinishedJob!.mode,
    });
    for (let t = 0; t < SIM_HZ * 3; t++) w2.step();
    expect(100 - w2.terrain.getSoilUnits(digTx, digTz)).toBeGreaterThan(dugAfterA);
  });

  it('spawns sea dragons, giant octopuses in oceans, Loch Ness monsters in lakes, and supports diagonal stone bridges', () => {
    // 1. Ocean maps spawn both Giant Octopus (sea_kraken) & Sea Dragon (sea_monster)
    const islandWorld = new World({
      seed: 6161,
      playerCiv: 'athenians',
      aiCiv: 'carthaginians',
      difficulty: 'easy',
      mapType: 'island',
      mapSize: 'medium',
    });
    const oceanIds = Array.from(islandWorld.entities.values())
      .filter((e) => e.alive && TEMPLATES[e.templateId]?.isSeaMonster)
      .map((e) => e.templateId);
    expect(oceanIds).toContain('sea_kraken');
    expect(oceanIds).toContain('sea_monster');

    // 2. Inland lake maps spawn Loch Ness lake monsters (lake_nessie) inside lakes!
    const valleyWorld = new World({
      seed: 2026,
      playerCiv: 'britons',
      aiCiv: 'gauls',
      difficulty: 'easy',
      mapType: 'aegean_valley',
      mapSize: 'medium',
    });
    expect(valleyWorld.terrain.lakes.length).toBeGreaterThan(0);
    const lakeMonsters = Array.from(valleyWorld.entities.values()).filter(
      (e) => e.alive && e.templateId === 'lake_nessie'
    );
    expect(lakeMonsters.length).toBeGreaterThan(0);

    // 3. Diagonal stone bridges allow land units to path diagonally straight across water!
    const bx = 48;
    const bz = 48;
    // Carve a 5x5 water canal and build a 3-tile diagonal stone bridge spanning NW -> SE
    for (let tz = bz - 1; tz <= bz + 3; tz++) {
      for (let tx = bx - 1; tx <= bx + 3; tx++) {
        valleyWorld.terrain.setBridgeTile(tx, tz, false);
      }
    }
    for (let vz = bz; vz <= bz + 3; vz++) {
      for (let vx = bx; vx <= bx + 3; vx++) {
        valleyWorld.terrain.heights[vz * (valleyWorld.terrain.width + 1) + vx] = -2.2;
      }
    }
    // Place completed diagonal bridge tiles (bx, bz) -> (bx+1, bz+1) -> (bx+2, bz+2) (setBridgeTile recomputes passability!)
    valleyWorld.terrain.setBridgeTile(bx, bz, true);
    valleyWorld.terrain.setBridgeTile(bx + 1, bz + 1, true);
    valleyWorld.terrain.setBridgeTile(bx + 2, bz + 2, true);
    const startW = valleyWorld.terrain.tileToWorldCenter(bx, bz);
    const goalW = valleyWorld.terrain.tileToWorldCenter(bx + 2, bz + 2);
    const diagPath = valleyWorld.navGrid.findPath(startW.x, startW.z, goalW.x, goalW.z);
    expect(diagPath.length).toBeGreaterThan(0);
    const endPt = diagPath[diagPath.length - 1];
    expect(Math.hypot(endPt.x - goalW.x, endPt.z - goalW.z)).toBeLessThan(1.5);
  });

  it('slows uphill walking, auto-routes through faster flat tunnels, supports male citizens, 3-story apartments & market trade caravans', () => {
    const world = new World({
      seed: 9191,
      playerCiv: 'athenians',
      aiCiv: 'romans',
      difficulty: 'easy',
      mapType: 'open_plains',
      mapSize: 'small',
    });
    const p1 = world.players.get(1)!;
    p1.resources = { food: 4000, wood: 4000, stone: 4000, metal: 4000 };

    // 1. Male Citizens exist from start AND are trainable at Civic Center!
    const maleCitizens = Array.from(world.entities.values()).filter(
      (e) => e.owner === 1 && e.templateId === 'male_citizen'
    );
    expect(maleCitizens.length).toBeGreaterThanOrEqual(2);
    expect(TEMPLATES.civic_center.trains).toContain('male_citizen');

    // 2. Flat ground walking is faster than uphill climbing, and units automatically take a flat tunnel when faster!
    const s1 = world.terrain.spawns[0];
    // Raise a steep ridge right between x = 44 and x = 56 along z = 48
    for (let vz = 43; vz <= 53; vz++) {
      for (let vx = 44; vx <= 56; vx++) {
        const ridge = Math.max(0, 1 - Math.abs(vx - 50) / 6.0);
        world.terrain.heights[vz * (world.terrain.width + 1) + vx] = 1.6 + ridge * 7.5;
      }
    }
    const flatPos = world.terrain.tileToWorldCenter(40, 48);
    const slopePos = world.terrain.tileToWorldCenter(46, 48);
    const flatMult = world.getTerrainSlopeSpeedMultiplier(flatPos.x, flatPos.z, 1, 0);
    const uphillMult = world.getTerrainSlopeSpeedMultiplier(slopePos.x, slopePos.z, 1, 0);
    expect(flatMult).toBeGreaterThan(uphillMult + 0.15);

    // Place linked operational tunnel portals on opposite sides of the steep ridge
    const portalA = world.spawnBuilding('tunnel_portal', 1, 42, 48, false)!;
    const portalB = world.spawnBuilding('tunnel_portal', 1, 58, 48, false)!;
    portalA.linkedTunnelId = portalB.id;
    portalB.linkedTunnelId = portalA.id;

    const walker = world.spawnUnit('male_citizen', 1, flatPos.x, flatPos.z)!;
    const farSide = world.terrain.tileToWorldCenter(62, 48);
    const shortcut = world.findFasterTunnelRoute(walker, farSide.x, farSide.z, TEMPLATES.male_citizen.speed ?? 6);
    expect(shortcut).not.toBeNull();
    expect(shortcut!.enterPortalId).toBe(portalA.id);

    // Issue a normal move order across the ridge -> walker automatically routes through the tunnel & reaches farSide!
    world.enqueueCommand({ type: 'move', playerId: 1, entityIds: [walker.id], x: farSide.x, z: farSide.z });
    let usedTunnel = false;
    for (let t = 0; t < SIM_HZ * 18; t++) {
      world.step();
      if (walker.order.type === 'enter_tunnel') usedTunnel = true;
    }
    expect(usedTunnel).toBe(true);
    expect(Math.hypot(walker.x - farSide.x, walker.z - farSide.z)).toBeLessThan(4.0);

    // 3. Multi-story Apartments: NOT buildable initially -> requires City Phase II + House tech -> max 3 floors!
    let openTile: { tx: number; tz: number } | null = null;
    for (let dz = -8; dz <= 8 && !openTile; dz++) {
      for (let dx = -8; dx <= 8 && !openTile; dx++) {
        if (Math.hypot(dx, dz) < 5) continue;
        if (world.canPlaceBuilding(1, 'house', s1.tileX + dx, s1.tileZ + dz).ok) {
          openTile = { tx: s1.tileX + dx, tz: s1.tileZ + dz };
        }
      }
    }
    expect(openTile).not.toBeNull();
    const houseTileX = openTile!.tx;
    const houseTileZ = openTile!.tz;
    expect(world.canPlaceBuilding(1, 'apartment_house', houseTileX, houseTileZ).ok).toBe(false);
    // Still blocked in Phase 2 until tech_multistory_housing is researched inside a House!
    p1.phase = 2;
    expect(world.canPlaceBuilding(1, 'apartment_house', houseTileX, houseTileZ).ok).toBe(false);

    expect(TEMPLATES.house.researches).toContain('tech_multistory_housing');
    p1.researchedTechs.add('tech_multistory_housing');
    // Immediately becomes buildable on the exact same open tile once Phase II + House upgrade are complete!
    expect(world.canPlaceBuilding(1, 'apartment_house', houseTileX, houseTileZ).ok).toBe(true);

    const house = world.spawnBuilding('house', 1, houseTileX, houseTileZ, false)!;

    // Upgrade House -> 2F Apartment -> 3F Apartment (timed construction! capped strictly at 3 floors!)
    const popBefore = p1.popCap;
    world.enqueueCommand({ type: 'upgrade_building', playerId: 1, buildingId: house.id });
    world.step();
    // Must NOT complete instantaneously — takes real upgrade time!
    expect(house.templateId).toBe('house');
    expect(house.upgradeTargetTemplateId).toBe('apartment_house');
    expect(house.upgradeProgress).toBeGreaterThan(0);
    expect(house.upgradeProgress).toBeLessThan(1);

    for (let t = 0; t < SIM_HZ * 13; t++) world.step();
    expect(house.templateId).toBe('apartment_house');
    expect(house.floors).toBe(2);
    expect(p1.popCap).toBeGreaterThan(popBefore);

    // Phase 3 required for 3rd floor
    world.enqueueCommand({ type: 'upgrade_building', playerId: 1, buildingId: house.id });
    world.step();
    expect(house.upgradeTargetTemplateId ?? null).toBeNull();
    expect(house.floors).toBe(2); // blocked in phase 2

    p1.phase = 3;
    const pop2F = p1.popCap;
    world.enqueueCommand({ type: 'upgrade_building', playerId: 1, buildingId: house.id });
    world.step();
    expect(house.floors).toBe(2); // still upgrading!
    expect(house.upgradeTargetFloors).toBe(3);
    for (let t = 0; t < SIM_HZ * 17; t++) world.step();
    expect(house.floors).toBe(3);
    expect(p1.popCap).toBeGreaterThan(pop2F);

    // Cannot exceed 3 floors!
    world.enqueueCommand({ type: 'upgrade_building', playerId: 1, buildingId: house.id });
    world.step();
    expect(house.upgradeTargetTemplateId ?? null).toBeNull();
    expect(house.floors).toBe(3);

    // 4. Market trains Trade Caravans that shuttle between 2 Markets to earn Gold Coins (metal)!
    expect(TEMPLATES.market.trains).toContain('trader');
    const mktA = world.spawnBuilding('market', 1, s1.tileX - 5, s1.tileZ, false)!;
    const mktB = world.spawnBuilding('market', 1, s1.tileX + 10, s1.tileZ + 2, false)!;
    const metalBefore = p1.resources.metal;
    const caravan = world.spawnUnit('trader', 1, mktA.x, mktA.z + 3)!;
    world.enqueueCommand({
      type: 'trade',
      playerId: 1,
      entityIds: [caravan.id],
      targetMarketId: mktB.id,
      homeMarketId: mktA.id,
    });
    for (let t = 0; t < SIM_HZ * 20; t++) {
      world.step();
    }
    expect(caravan.order.type).toBe('trade');
    expect(p1.resources.metal).toBeGreaterThan(metalBefore);
  });

  it('supports up to 8 nations, 0 A.D. alliances (shared vision/tribute/trade), biome wildlife, distinct citizen stats, mountain walls, territory over water/mountains & save/load', () => {
    // 1. Distinct Female vs Male Citizen attributes
    const fem = TEMPLATES.female_citizen;
    const mal = TEMPLATES.male_citizen;
    expect(fem.speed!).toBeGreaterThan(mal.speed!);
    expect(fem.gather!.food).toBeGreaterThan(mal.gather!.food);
    expect(mal.maxHp).toBeGreaterThan(fem.maxHp);
    expect(mal.gather!.wood).toBeGreaterThan(fem.gather!.wood);
    expect(mal.gather!.stone).toBeGreaterThan(fem.gather!.stone);
    expect(mal.gather!.buildRate).toBeGreaterThan(fem.gather!.buildRate);

    // 2. Up to 8 Nations with Teams/Alliances & Random Civs
    const w8 = new World({
      seed: 8848,
      playerCiv: 'athenians',
      aiCiv: 'romans',
      difficulty: 'easy',
      mapType: 'open_plains',
      mapSize: 'large',
      numPlayers: 8,
      playerSlots: [
        { playerId: 1, civ: 'random', team: 1, isAI: false },
        { playerId: 2, civ: 'random', team: 1, isAI: true },
        { playerId: 3, civ: 'spartans', team: 2, isAI: true },
        { playerId: 4, civ: 'persians', team: 2, isAI: true },
        { playerId: 5, civ: 'han', team: 0, isAI: true },
        { playerId: 6, civ: 'britons', team: 0, isAI: true },
        { playerId: 7, civ: 'carthaginians', team: 0, isAI: true },
        { playerId: 8, civ: 'mauryas', team: 0, isAI: true },
      ],
    });
    expect(w8.players.size).toBe(8);
    expect(w8.terrain.spawns.length).toBe(8);
    expect(w8.terrain.areSpawnsConnected()).toBe(true);

    // Team 1 mutual alliance: non-hostile + shared live vision!
    expect(w8.areAllies(1, 2)).toBe(true);
    expect(w8.areHostile(1, 2)).toBe(false);
    expect(w8.areHostile(1, 3)).toBe(true);
    const p2Spawn = w8.terrain.tileToWorldCenter(w8.terrain.spawns[1].tileX, w8.terrain.spawns[1].tileZ);
    expect(w8.fog.isVisibleTo(1, p2Spawn.x, p2Spawn.z)).toBe(true);

    // Tribute transfers resources from P1 to allied P2
    const p1FoodBefore = w8.players.get(1)!.resources.food;
    const p2FoodBefore = w8.players.get(2)!.resources.food;
    w8.enqueueCommand({ type: 'send_tribute', playerId: 1, targetPlayerId: 2, resource: 'food', amount: 100 });
    w8.step();
    expect(w8.players.get(1)!.resources.food).toBe(p1FoodBefore - 100);
    expect(w8.players.get(2)!.resources.food).toBe(p2FoodBefore + 100);

    // Dynamic Diplomacy toggle: P1 can ally P5 mid-game!
    expect(w8.areAllies(1, 5)).toBe(false);
    w8.enqueueCommand({ type: 'set_diplomacy', playerId: 1, targetPlayerId: 5, stance: 'ally' });
    w8.step();
    expect(w8.areAllies(1, 5)).toBe(true);

    // 3. Biome-distinct wildlife (Desert Oasis has Gazelles & Lions; Mountain has Bears & Wolves)
    const desertW = new World({ seed: 1122, playerCiv: 'ptolemies', aiCiv: 'kushites', difficulty: 'easy', mapType: 'inland_oasis', mapSize: 'small' });
    const mountainW = new World({ seed: 1122, playerCiv: 'gauls', aiCiv: 'britons', difficulty: 'easy', mapType: 'mountain', mapSize: 'small' });
    const desertSpecies = new Set(Array.from(desertW.entities.values()).filter((e) => e.owner === 0).map((e) => e.templateId));
    const mountainSpecies = new Set(Array.from(mountainW.entities.values()).filter((e) => e.owner === 0).map((e) => e.templateId));
    expect(desertSpecies.has('wild_gazelle') || desertSpecies.has('predator_lion')).toBe(true);
    expect(mountainSpecies.has('predator_bear') || mountainSpecies.has('predator_wolf')).toBe(true);
    expect(desertSpecies.has('predator_bear')).toBe(false);

    // 4. Harvestable Stone Pillars exist right near base and yield Stone!
    const pillar = Array.from(desertW.entities.values()).find((e) => e.templateId === 'ancient_ruin_pillar');
    expect(pillar).toBeDefined();
    expect(TEMPLATES.ancient_ruin_pillar.resourceType).toBe('stone');

    // 5. Territory includes water AND mountains, AND Stone Walls can be built on steep mountain slopes!
    const s1 = desertW.terrain.spawns[0];
    // Carve a water pond & raise a mountain peak right inside P1's territory radius
    const waterTx = s1.tileX + 8;
    const waterTz = s1.tileZ;
    const mtnTx = s1.tileX - 8;
    const mtnTz = s1.tileZ;
    const vw = desertW.terrain.width + 1;
    for (let dz = 0; dz <= 1; dz++) {
      for (let dx = 0; dx <= 1; dx++) {
        desertW.terrain.heights[(waterTz + dz) * vw + (waterTx + dx)] = -2.0;
      }
    }
    desertW.terrain.heights[mtnTz * vw + mtnTx] = 7.5;
    desertW.terrain.heights[mtnTz * vw + (mtnTx + 1)] = 9.0;
    desertW.terrain.heights[(mtnTz + 1) * vw + mtnTx] = 7.5;
    desertW.terrain.heights[(mtnTz + 1) * vw + (mtnTx + 1)] = 9.2;
    desertW.terrain.version++;
    desertW.step(); // triggers territory recompute
    expect(desertW.territory.getOwnerAtTile(waterTx, waterTz)).toBe(1);
    expect(desertW.territory.getOwnerAtTile(mtnTx, mtnTz)).toBe(1);
    expect(desertW.canPlaceBuilding(1, 'stone_wall', mtnTx, mtnTz).ok).toBe(true);

    // 6. Full Save & Load Serialization Round-Trip
    w8.players.get(1)!.resources.metal = 7777;
    const snapshot = w8.serializeState({ x: 80, z: 90, distance: 40, yaw: 0 });
    const json = JSON.stringify(snapshot);
    const restored = World.deserializeState(JSON.parse(json));
    expect(restored.players.size).toBe(8);
    expect(restored.players.get(1)!.resources.metal).toBe(7777);
    expect(restored.areAllies(1, 2)).toBe(true);
    expect(restored.areAllies(1, 5)).toBe(true);
    expect(restored.entities.size).toBe(w8.entities.size);
    expect(restored.computeStateHash()).toBe(w8.computeStateHash());
  });

  it('waits 10s with countdown before newly trained Civic Center workers auto-work and never gathers empty air', () => {
    const world = new World({
      seed: 4455,
      playerCiv: 'athenians',
      aiCiv: 'romans',
      difficulty: 'easy',
      mapType: 'open_plains',
      mapSize: 'small',
    });

    const p1 = world.players.get(1)!;
    p1.resources = { food: 1000, wood: 1000, stone: 1000, metal: 1000 };
    const cc = Array.from(world.entities.values()).find(
      (e) => e.alive && e.owner === 1 && e.templateId === 'civic_center'
    )!;
    expect(cc).toBeDefined();

    const existingIds = new Set(world.entities.keys());
    world.enqueueCommand({ type: 'train', playerId: 1, buildingId: cc.id, templateId: 'female_citizen' });
    world.enqueueCommand({ type: 'train', playerId: 1, buildingId: cc.id, templateId: 'male_citizen' });

    // Wait for first worker (female_citizen) to spawn from Civic Center
    let firstWorkerId: number | null = null;
    for (let t = 0; t < SIM_HZ * 15 && firstWorkerId === null; t++) {
      world.step();
      for (const e of world.entities.values()) {
        if (!existingIds.has(e.id) && e.owner === 1 && e.templateId === 'female_citizen') {
          existingIds.add(e.id);
          firstWorkerId = e.id;
          // Newly trained Civic Center worker starts a 10s countdown and does NOT auto-gather yet!
          expect(e.autoWorkDelay).toBeGreaterThan(9.5);
          expect(Math.ceil(e.autoWorkDelay!)).toBe(10);
          expect(e.order.type).not.toBe('gather');
        }
      }
    }
    expect(firstWorkerId).not.toBeNull();
    const firstWorker = world.entities.get(firstWorkerId!)!;

    // During the first 9 seconds, countdown ticks down and worker must STILL wait (never auto-gather early)
    for (let t = 0; t < SIM_HZ * 9; t++) {
      world.step();
    }
    expect(firstWorker.autoWorkDelay).toBeGreaterThan(0.5);
    expect(firstWorker.autoWorkDelay).toBeLessThan(1.5);
    expect(firstWorker.order.type).not.toBe('gather');

    // After the remaining ~1.2 seconds (total > 10s), countdown hits 0 and worker immediately auto-gathers!
    for (let t = 0; t < Math.ceil(SIM_HZ * 1.5); t++) {
      world.step();
    }
    expect(firstWorker.autoWorkDelay ?? 0).toBe(0);
    expect(firstWorker.order.type).toBe('gather');

    // Find the second newly trained worker (male_citizen) and verify manual player command cancels countdown immediately!
    let secondWorkerId: number | null = null;
    for (let t = 0; t < SIM_HZ * 10 && secondWorkerId === null; t++) {
      for (const e of world.entities.values()) {
        if (!existingIds.has(e.id) && e.owner === 1 && e.templateId === 'male_citizen') {
          existingIds.add(e.id);
          secondWorkerId = e.id;
        }
      }
      if (secondWorkerId === null) world.step();
    }
    expect(secondWorkerId).not.toBeNull();
    const secondWorker = world.entities.get(secondWorkerId!)!;
    if ((secondWorker.autoWorkDelay ?? 0) > 0) {
      world.enqueueCommand({ type: 'move', playerId: 1, entityIds: [secondWorker.id], x: cc.x + 6, z: cc.z + 6 });
      world.step();
      expect(secondWorker.autoWorkDelay ?? 0).toBe(0);
    }

    // Worker ordered to gather a far-away tree must NEVER enter animState === 'gather' while far away or if tree is depleted!
    const worker = firstWorker;
    const farTree = Array.from(world.entities.values()).find(
      (e) => e.alive && e.owner === 0 && TEMPLATES[e.templateId].resourceType === 'wood' && Math.hypot(e.x - worker.x, e.z - worker.z) > 12
    )!;
    expect(farTree).toBeDefined();

    // Force a gather order on a far-away tree — on EVERY tick, if worker is playing 'gather',
    // its actual target MUST exist, be alive, have remaining resources, and be physically adjacent!
    worker.order = { type: 'gather', targetId: farTree.id, resourceType: 'wood', returning: false };
    worker.path = [];
    for (let t = 0; t < 40; t++) {
      world.step();
      if (worker.animState === 'gather') {
        expect(worker.order.type).toBe('gather');
        if (worker.order.type === 'gather') {
          const curTarget = world.entities.get(worker.order.targetId);
          expect(curTarget).toBeDefined();
          expect(curTarget!.alive).toBe(true);
          expect(curTarget!.resourceRemaining).toBeGreaterThan(0);
          const distToActual = Math.hypot(curTarget!.x - worker.x, curTarget!.z - worker.z);
          expect(distToActual).toBeLessThanOrEqual(
            TEMPLATES[worker.templateId].radius + TEMPLATES[curTarget!.templateId].radius + 1.0
          );
        }
      }
    }

    // Also if resource is depleted (0 remaining), worker must NOT harvest empty air
    farTree.resourceRemaining = 0;
    worker.x = farTree.x + 1.0;
    worker.z = farTree.z;
    worker.order = { type: 'gather', targetId: farTree.id, resourceType: 'wood', returning: false };
    world.step();
    expect(worker.animState).not.toBe('gather');
  });

  it('supports 0.01m incremental dig + cancel without revert, underground tunnel diggers/travelers, 3-seg wall<->gate timed upgrades + 3 gate modes, and 3-level Great Wall Beacon Towers', () => {
    const world = new World({
      seed: 9191,
      playerCiv: 'han',
      aiCiv: 'romans',
      difficulty: 'easy',
      mapType: 'open_plains',
      mapSize: 'small',
    });

    const p1 = world.players.get(1)!;
    p1.resources = { food: 5000, wood: 5000, stone: 5000, metal: 5000 };
    const s1 = world.terrain.spawns[0];
    const dirX = s1.tileX < 48 ? 1 : -1;

    // 1. Incremental 0.01m digging + Cancel Digging stops worker & keeps terrain height (NEVER reverts!)
    const digTx = s1.tileX + dirX * 9;
    const digTz = s1.tileZ;
    const dumpTx = digTx + dirX * 3;
    const dumpTz = digTz;
    const digCenter = world.terrain.tileToWorldCenter(digTx, digTz);
    const initialH = world.terrain.getHeightAt(digCenter.x, digCenter.z);
    const digger = world.spawnUnit('female_citizen', 1, digCenter.x - 1.0, digCenter.z)!;
    world.enqueueCommand({
      type: 'terraform',
      playerId: 1,
      entityIds: [digger.id],
      tileX: digTx,
      tileZ: digTz,
      destTileX: dumpTx,
      destTileZ: dumpTz,
      mode: 'dig',
    });
    for (let t = 0; t < SIM_HZ * 3; t++) world.step();
    const afterPartialDigH = world.terrain.getHeightAt(digCenter.x, digCenter.z);
    expect(afterPartialDigH).toBeLessThan(initialH - 0.005);

    world.enqueueCommand({ type: 'cancel_terraform', playerId: 1, entityIds: [digger.id] });
    world.step();
    expect(digger.order.type).toBe('idle');
    // Terrain height MUST stay at exact excavated depth — NEVER revert!
    expect(world.terrain.getHeightAt(digCenter.x, digCenter.z)).toBeCloseTo(afterPartialDigH, 4);

    // 2. Tunnel length scales excavation time + underground digger enters shaft (inShaft = true)
    const tunWorker = world.spawnUnit('male_citizen', 1, digCenter.x, digCenter.z + 8)!;
    const tStartTx = s1.tileX + dirX * 7;
    const tEndTxShort = tStartTx + dirX * 6;
    const tEndTxLong = tStartTx + dirX * 14;
    const tTz = s1.tileZ + 5;
    world.enqueueCommand({
      type: 'build_tunnel',
      playerId: 1,
      entityIds: [tunWorker.id],
      startTileX: tStartTx,
      startTileZ: tTz,
      endTileX: tEndTxShort,
      endTileZ: tTz,
    });
    world.step();
    const shortPortal = Array.from(world.entities.values()).find((e) => e.alive && e.templateId === 'tunnel_portal' && e.tileX === tStartTx)!;
    expect(shortPortal).toBeDefined();
    expect(shortPortal.tunnelTotalUnits).toBe(600);

    // Move worker near portal so they enter the underground shaft
    tunWorker.x = shortPortal.x;
    tunWorker.z = shortPortal.z;
    for (let t = 0; t < SIM_HZ * 2; t++) world.step();
    expect(tunWorker.order.type).toBe('build');
    if (tunWorker.order.type === 'build') {
      expect(tunWorker.order.inShaft).toBe(true);
    }

    // Build a longer tunnel on the nearest valid row and confirm tunnelTotalUnits scales proportionally with length!
    let longTz = tTz + 4;
    for (let dz = -10; dz <= 12; dz++) {
      const candZ = tTz + dz;
      if (candZ === tTz) continue;
      if (
        world.canPlaceBuilding(1, 'tunnel_portal', tStartTx, candZ).ok &&
        world.canPlaceBuilding(1, 'tunnel_portal', tEndTxLong, candZ).ok
      ) {
        longTz = candZ;
        break;
      }
    }
    const tunWorker2 = world.spawnUnit('male_citizen', 1, digCenter.x, digCenter.z + 14)!;
    world.enqueueCommand({
      type: 'build_tunnel',
      playerId: 1,
      entityIds: [tunWorker2.id],
      startTileX: tStartTx,
      startTileZ: longTz,
      endTileX: tEndTxLong,
      endTileZ: longTz,
    });
    world.step();
    const longPortal = Array.from(world.entities.values()).find((e) => e.alive && e.templateId === 'tunnel_portal' && e.tileZ === longTz)!;
    expect(longPortal).toBeDefined();
    expect(longPortal.tunnelTotalUnits).toBe(1400);
    expect(longPortal.tunnelTotalUnits!).toBeGreaterThan(shortPortal.tunnelTotalUnits! * 2);

    // 3. Continuous 5-segment Stone Wall -> End segment CANNOT upgrade to gate; Middle segment upgrades (Prev+Mid+Next -> Gate);
    //    3 Gate Modes ('auto' own nation only, 'open' everyone, 'locked' nobody); Reverse Gate -> 3 Walls!
    const wallBaseTx = s1.tileX + dirX * 5;
    const wallTz = s1.tileZ - 7;
    const wallSegs = [];
    for (let i = 0; i < 5; i++) {
      const w = world.spawnBuilding('stone_wall', 1, wallBaseTx + i * dirX, wallTz, false, 0)!;
      wallSegs.push(w);
    }
    // End segment (index 0) must NOT be eligible for gate upgrade
    expect(world.findGateUpgradeNeighbors(wallSegs[0])).toBeNull();
    // Interior segment (index 2) MUST be eligible (flanked by index 1 and index 3)
    const neighbors = world.findGateUpgradeNeighbors(wallSegs[2]);
    expect(neighbors).not.toBeNull();

    // Start timed upgrade to Gate -> must NOT complete instantaneously!
    world.enqueueCommand({ type: 'upgrade_building', playerId: 1, buildingId: wallSegs[2].id, target: 'gate' });
    world.step();
    expect(wallSegs[2].templateId).toBe('stone_wall');
    expect(wallSegs[2].upgradeTargetTemplateId).toBe('stone_gate');

    // Step 11 seconds -> finishes upgrading Prev + Mid + Next into 1 unified Stone Gate!
    for (let t = 0; t < SIM_HZ * 11; t++) world.step();
    expect(wallSegs[2].templateId).toBe('stone_gate');
    expect(world.entities.has(wallSegs[1].id)).toBe(false);
    expect(world.entities.has(wallSegs[3].id)).toBe(false);
    expect(wallSegs[2].gateMode).toBe('auto');

    // Gate Modes:
    // - 'auto': ONLY own nation (1) can pass; enemy (2) is BLOCKED!
    expect(world.navGrid.isWalkableFor(wallSegs[2].tileX, wallSegs[2].tileZ, 1)).toBe(true);
    expect(world.navGrid.isWalkableFor(wallSegs[2].tileX, wallSegs[2].tileZ, 2)).toBe(false);

    // - 'open': EVERYONE (1 and 2) can pass!
    world.enqueueCommand({ type: 'set_gate_mode', playerId: 1, buildingId: wallSegs[2].id, mode: 'open' });
    world.step();
    expect(world.navGrid.isWalkableFor(wallSegs[2].tileX, wallSegs[2].tileZ, 1)).toBe(true);
    expect(world.navGrid.isWalkableFor(wallSegs[2].tileX, wallSegs[2].tileZ, 2)).toBe(true);

    // - 'locked': NOBODY (not even own nation 1!) can pass!
    world.enqueueCommand({ type: 'set_gate_mode', playerId: 1, buildingId: wallSegs[2].id, mode: 'locked' });
    world.step();
    expect(world.navGrid.isWalkableFor(wallSegs[2].tileX, wallSegs[2].tileZ, 1)).toBe(false);
    expect(world.navGrid.isWalkableFor(wallSegs[2].tileX, wallSegs[2].tileZ, 2)).toBe(false);

    // Reverse conversion: Gate -> 3 continuous Stone Wall segments (timed!)
    world.enqueueCommand({ type: 'upgrade_building', playerId: 1, buildingId: wallSegs[2].id, target: 'wall' });
    world.step();
    expect(wallSegs[2].templateId).toBe('stone_gate');
    expect(wallSegs[2].upgradeTargetTemplateId).toBe('stone_wall');
    for (let t = 0; t < SIM_HZ * 9; t++) world.step();
    expect(wallSegs[2].templateId).toBe('stone_wall');
    const wallCountNow = Array.from(world.entities.values()).filter((e) => e.alive && e.owner === 1 && e.templateId === 'stone_wall').length;
    expect(wallCountNow).toBe(5);

    // 4. Great Wall Beacon Towers: ANY wall segment (even end segment!) -> Beacon Lv.1 -> Lv.2 -> Lv.3!
    world.enqueueCommand({ type: 'upgrade_building', playerId: 1, buildingId: wallSegs[0].id, target: 'beacon' });
    world.enqueueCommand({ type: 'upgrade_building', playerId: 1, buildingId: wallSegs[4].id, target: 'beacon' });
    for (let t = 0; t < SIM_HZ * 11; t++) world.step();
    const beaconA = wallSegs[0];
    const beaconB = wallSegs[4];
    expect(beaconA.templateId).toBe('beacon_tower');
    expect(beaconA.beaconLevel).toBe(1);
    expect(beaconB.templateId).toBe('beacon_tower');

    // Upgrade Beacon A to Lv.2 & Lv.3 -> verify BOTH range AND max garrison capacity scale up (5 -> 8 -> 12)!
    expect(world.getMaxGarrisonCapacity(beaconA)).toBe(5);
    p1.fastBuildCheat = true;
    world.enqueueCommand({ type: 'upgrade_building', playerId: 1, buildingId: beaconA.id, target: 'beacon' });
    for (let t = 0; t < 10; t++) world.step();
    expect(beaconA.beaconLevel).toBe(2);
    expect(world.getMaxGarrisonCapacity(beaconA)).toBe(8);
    expect(World.getBeaconStats(2).relayRange).toBeGreaterThan(World.getBeaconStats(1).relayRange);
    world.enqueueCommand({ type: 'upgrade_building', playerId: 1, buildingId: beaconA.id, target: 'beacon' });
    for (let t = 0; t < 10; t++) world.step();
    expect(beaconA.beaconLevel).toBe(3);
    expect(world.getMaxGarrisonCapacity(beaconA)).toBe(12);
    expect(World.getBeaconStats(3).relayRange).toBeGreaterThan(World.getBeaconStats(2).relayRange);
    p1.fastBuildCheat = false;

    // Unstaffed Beacon Tower (0 garrisoned soldiers) is USELESS: cannot ignite manually or on enemy approach!
    world.enqueueCommand({ type: 'ignite_beacon', playerId: 1, buildingId: beaconA.id });
    world.step();
    expect(beaconA.beaconLitTimer ?? 0).toBe(0);

    // Garrison 7 ranged crossbowmen into Lv.3 Beacon A (allowed because Lv.3 holds up to 12!) & 1 spearman into Lv.1 Beacon B!
    const garrisonUnits = [];
    for (let i = 0; i < 7; i++) {
      const xbow = world.spawnUnit('han_crossbow', 1, beaconA.x + 0.5, beaconA.z + 0.5)!;
      garrisonUnits.push(xbow);
      world.enqueueCommand({ type: 'garrison', playerId: 1, entityIds: [xbow.id], buildingId: beaconA.id });
    }
    const guardB = world.spawnUnit('han_spearman', 1, beaconB.x + 0.5, beaconB.z + 0.5)!;
    world.enqueueCommand({ type: 'garrison', playerId: 1, entityIds: [guardB.id], buildingId: beaconB.id });
    for (let t = 0; t < SIM_HZ * 2; t++) world.step();
    expect(beaconA.garrisonedIds.length).toBe(7);
    expect(beaconB.garrisonedIds.length).toBe(1);

    // Individual ungarrison: click 1 specific soldier -> ONLY that soldier exits while the other 6 remain garrisoned!
    const ejectedId = beaconA.garrisonedIds[0];
    world.enqueueCommand({ type: 'ungarrison_one', playerId: 1, buildingId: beaconA.id, unitId: ejectedId });
    world.step();
    expect(beaconA.garrisonedIds.length).toBe(6);
    expect(world.entities.get(ejectedId)!.garrisonedIn).toBeNull();

    // Spawn an own-nation army 25m away (within Lv.3 rally range) + an approaching hostile enemy!
    const armyUnit = world.spawnUnit('han_spearman', 1, beaconA.x, beaconA.z + 25)!;
    const armyStartDist = Math.hypot(armyUnit.x - beaconA.x, armyUnit.z - beaconA.z);
    const enemyRaider = world.spawnUnit('rome_hastatus', 2, beaconA.x, beaconA.z - 12)!;
    const enemyHpBefore = enemyRaider.hp;

    // Immediately on enemy detection (1 tick): auto-ignites Beacon A, chains to Beacon B, and rallies armyUnit!
    world.step();
    expect(beaconA.beaconLitTimer ?? 0).toBeGreaterThan(0);
    expect(beaconB.beaconLitTimer ?? 0).toBeGreaterThan(0);
    expect(armyUnit.order.type).toBe('move');

    // Step 3 more seconds: army marches toward Beacon A AND garrisoned crossbowmen actively shoot the enemy!
    for (let t = 0; t < SIM_HZ * 3; t++) world.step();
    expect(Math.hypot(armyUnit.x - beaconA.x, armyUnit.z - beaconA.z)).toBeLessThan(armyStartDist - 5);
    expect(enemyRaider.hp).toBeLessThan(enemyHpBefore);

    // Manual Extinguish puts out Beacon B fire cleanly and keeps it extinguished!
    world.enqueueCommand({ type: 'extinguish_beacon', playerId: 1, buildingId: beaconB.id });
    world.step();
    expect(beaconB.beaconLitTimer ?? 0).toBe(0);

    // More garrisoned units = harder to destroy (6 garrisoned defenders reduce damage far more than 1 defender!)
    const hpABefore = beaconA.hp;
    const hpBBefore = beaconB.hp;
    const ramA = world.spawnUnit('rome_hastatus', 2, beaconA.x + 1.5, beaconA.z)!;
    const ramB = world.spawnUnit('rome_hastatus', 2, beaconB.x + 1.5, beaconB.z)!;
    world.enqueueCommand({ type: 'attack', playerId: 2, entityIds: [ramA.id], targetId: beaconA.id, mode: 'attack' });
    world.enqueueCommand({ type: 'attack', playerId: 2, entityIds: [ramB.id], targetId: beaconB.id, mode: 'attack' });
    for (let t = 0; t < SIM_HZ * 2; t++) world.step();
    const dmgToFullBeacon = hpABefore - beaconA.hp;
    const dmgToSingleBeacon = hpBBefore - beaconB.hp;
    expect(dmgToFullBeacon).toBeLessThan(dmgToSingleBeacon);

    // When Beacon Tower is destroyed, ALL remaining garrisoned soldiers pop out alive!
    const garrisonedIdsBefore = [...beaconA.garrisonedIds];
    beaconA.hp = 0;
    beaconA.alive = false;
    world.step();
    for (const uid of garrisonedIdsBefore) {
      const survivor = world.entities.get(uid);
      expect(survivor).toBeDefined();
      expect(survivor!.alive).toBe(true);
      expect(survivor!.garrisonedIn).toBeNull();
    }

    // 5. Outermost edge tile (tx = 0) allows building Stone Walls when dry & in territory!
    const edgeTx = 0;
    const edgeTz = Math.floor(world.terrain.height / 2);
    const vw = world.terrain.width + 1;
    world.terrain.heights[edgeTz * vw + edgeTx] = 2.0;
    world.terrain.heights[edgeTz * vw + edgeTx + 1] = 2.0;
    world.terrain.heights[(edgeTz + 1) * vw + edgeTx] = 2.0;
    world.terrain.heights[(edgeTz + 1) * vw + edgeTx + 1] = 2.0;
    world.spawnBuilding('civic_center', 1, 4, edgeTz, false);
    world.step();
    expect(world.canPlaceBuilding(1, 'stone_wall', edgeTx, edgeTz).ok).toBe(true);

    // 6. Archipelago multi-island terrain generates islands + deep navigable sea + connected spawns,
    //    AND Civic Centers on highland/plateau terrain are NOT sunken into a basin!
    const archW = new World({
      seed: 5511,
      playerCiv: 'athenians',
      aiCiv: 'carthaginians',
      difficulty: 'easy',
      mapType: 'archipelago',
      mapSize: 'small',
    });
    expect(archW.terrain.resolvedMapType).toBe('archipelago');
    expect(archW.terrain.areSpawnsConnected()).toBe(true);
    let waterTiles = 0;
    let landTiles = 0;
    for (let z = 4; z < archW.terrain.height - 4; z += 2) {
      for (let x = 4; x < archW.terrain.width - 4; x += 2) {
        if (archW.terrain.isTileWaterNavigable(x, z)) waterTiles++;
        else if (archW.terrain.isTileDryLand(x, z)) landTiles++;
      }
    }
    expect(waterTiles).toBeGreaterThan(200);
    expect(landTiles).toBeGreaterThan(200);

    const platW = new World({
      seed: 6622,
      playerCiv: 'han',
      aiCiv: 'romans',
      difficulty: 'easy',
      mapType: 'plateau',
      mapSize: 'small',
    });
    const ps1 = platW.terrain.spawns[0];
    const ccCenter = platW.terrain.tileToWorldCenter(ps1.tileX, ps1.tileZ);
    const ccY = platW.terrain.getHeightAt(ccCenter.x, ccCenter.z);
    let ringAvg = 0;
    for (let a = 0; a < 8; a++) {
      const ang = (a / 8) * Math.PI * 2;
      ringAvg += platW.terrain.getHeightAt(ccCenter.x + Math.cos(ang) * 22, ccCenter.z + Math.sin(ang) * 22);
    }
    ringAvg /= 8;
    // Civic Center sits flush/elevated — NEVER sunken into a deep basin (> 0.6m below surrounding terrain)!
    expect(ccY).toBeGreaterThanOrEqual(ringAvg - 0.6);
  });

  it('supports shore-only rod/net fishing, bidirectional sea monster vs human combat, and predator counterattack vs docile flee at distinct speeds', () => {
    const world = new World({
      seed: 7788,
      playerCiv: 'athenians',
      aiCiv: 'romans',
      difficulty: 'easy',
      mapType: 'island',
      mapSize: 'small',
    });

    // 1. Shore Fishing: shoreline fish IS catchable by land workers; deep-sea fish is REJECTED!
    const shoreFish = Array.from(world.entities.values()).find(
      (e) => e.alive && e.templateId === 'fish_shoal' && world.canLandWorkerFish(e)
    );
    expect(shoreFish).toBeDefined();

    // Find a deep-sea water tile far (> 10 tiles) from all dry land and place a deep-sea fish shoal
    let deepWaterTile: { tx: number; tz: number } | null = null;
    for (let tz = 6; tz < world.terrain.height - 6 && !deepWaterTile; tz += 2) {
      for (let tx = 6; tx < world.terrain.width - 6; tx += 2) {
        if (!world.terrain.isTileWaterNavigable(tx, tz)) continue;
        let allWater = true;
        for (let dz = -5; dz <= 5 && allWater; dz++) {
          for (let dx = -5; dx <= 5; dx++) {
            if (world.navGrid.isWalkable(tx + dx, tz + dz)) {
              allWater = false;
              break;
            }
          }
        }
        if (allWater) {
          deepWaterTile = { tx, tz };
          break;
        }
      }
    }
    expect(deepWaterTile).not.toBeNull();
    const deepPos = world.terrain.tileToWorldCenter(deepWaterTile!.tx, deepWaterTile!.tz);
    const deepFish = world.spawnResource('fish_shoal', deepPos.x, deepPos.z)!;
    expect(world.canLandWorkerFish(deepFish)).toBe(false);

    const stand = world.getShoreFishingStandPos(shoreFish!)!;
    const fisher = world.spawnUnit('female_citizen', 1, stand.x, stand.z)!;

    // Ordering land worker to fish deep-sea shoal must be rejected!
    world.enqueueCommand({ type: 'gather', playerId: 1, entityIds: [fisher.id], targetId: deepFish.id });
    world.step();
    expect(fisher.order.type).not.toBe('gather');

    // Ordering land worker to fish shoreline shoal succeeds and harvests Food!
    const fishRemainBefore = shoreFish!.resourceRemaining;
    world.enqueueCommand({ type: 'gather', playerId: 1, entityIds: [fisher.id], targetId: shoreFish!.id });
    for (let t = 0; t < SIM_HZ * 3; t++) world.step();
    expect(shoreFish!.resourceRemaining).toBeLessThan(fishRemainBefore);

    // 2. Sea/Lake Monster attacks people near shore AND people can attack the Sea Monster!
    const monster = world.spawnResource('sea_monster', shoreFish!.x, shoreFish!.z)!;
    const coastalArcher = world.spawnUnit('athen_archer', 1, stand.x, stand.z)!;
    const archerHpBefore = coastalArcher.hp;
    const monsterHpBefore = monster.hp;

    world.enqueueCommand({ type: 'attack', playerId: 1, entityIds: [coastalArcher.id], targetId: monster.id, mode: 'attack' });
    for (let t = 0; t < SIM_HZ * 5; t++) world.step();
    // Human archer damaged the Sea Monster AND Sea Monster attacked the coastal human!
    expect(monster.hp).toBeLessThan(monsterHpBefore);
    expect(coastalArcher.hp).toBeLessThan(archerHpBefore);

    // 3. Wildlife reactions + distinct species movement speeds!
    expect(TEMPLATES.wild_gazelle.speed!).toBeGreaterThan(TEMPLATES.deer_herd.speed!);
    expect(TEMPLATES.predator_wolf.speed!).toBeGreaterThan(TEMPLATES.predator_bear.speed!);
    expect(TEMPLATES.sea_monster.speed!).toBeGreaterThan(TEMPLATES.sea_kraken.speed!);

    // Clear an open dry patch near spawn for clean wildlife reaction test
    const s1 = world.terrain.spawns[0];
    const baseC = world.terrain.tileToWorldCenter(s1.tileX, s1.tileZ);
    const soldier1 = world.spawnUnit('athen_archer', 1, baseC.x - 4, baseC.z + 4)!;
    const gazelle = world.spawnResource('wild_gazelle', baseC.x + 2, baseC.z + 4)!;
    const gazStartDist = Math.hypot(gazelle.x - soldier1.x, gazelle.z - soldier1.z);

    // Attack docile gazelle -> must FLEE AWAY (distance increases!)
    world.enqueueCommand({ type: 'attack', playerId: 1, entityIds: [soldier1.id], targetId: gazelle.id, mode: 'attack' });
    for (let t = 0; t < SIM_HZ * 2; t++) world.step();
    const gazEndDist = Math.hypot(gazelle.x - soldier1.x, gazelle.z - soldier1.z);
    expect(gazEndDist).toBeGreaterThan(gazStartDist + 1.0);

    // Attack fierce predator (wolf) -> must COUNTERATTACK and damage the attacker!
    const soldier2 = world.spawnUnit('athen_archer', 1, baseC.x - 4, baseC.z - 5)!;
    const wolf = world.spawnResource('predator_wolf', baseC.x + 1, baseC.z - 5)!;
    const s2HpBefore = soldier2.hp;
    world.enqueueCommand({ type: 'attack', playerId: 1, entityIds: [soldier2.id], targetId: wolf.id, mode: 'attack' });
    for (let t = 0; t < SIM_HZ * 4; t++) world.step();
    expect(soldier2.hp).toBeLessThan(s2HpBefore);
  });
});
