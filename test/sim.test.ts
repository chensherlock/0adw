import { describe, expect, it } from 'vitest';
import { getEntityPortrait } from '../src/config/assets';
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
  }, 25000);

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
    let world!: World;
    for (let s = 9191; s < 9210; s++) {
      const candidate = new World({
        seed: s,
        playerCiv: 'athenians',
        aiCiv: 'carthaginians',
        difficulty: 'easy',
        mapType: 'island',
      });
      world = candidate;
      const hasMonster = Array.from(candidate.entities.values()).some(
        (e) => e.alive && TEMPLATES[e.templateId].isSeaMonster
      );
      if (hasMonster) break;
    }

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

  it('spawns rare sea plesiosaurs & krakens in oceans, rare Loch Ness plesiosaurs in lakes, and supports diagonal stone bridges', () => {
    // 1. Ocean maps spawn rare Sea Plesiosaurs (sea_monster) & occasional Kraken (sea_kraken) across seeds (rare: <= 2 per map!)
    const seenOcean = new Set<string>();
    let zeroMonsterMaps = 0;
    for (let s = 6160; s < 6172; s++) {
      const w = new World({
        seed: s,
        playerCiv: 'athenians',
        aiCiv: 'carthaginians',
        difficulty: 'easy',
        mapType: 'island',
        mapSize: 'small',
      });
      const monsters = Array.from(w.entities.values()).filter((e) => e.alive && TEMPLATES[e.templateId]?.isSeaMonster);
      expect(monsters.length).toBeLessThanOrEqual(2);
      if (monsters.length === 0) zeroMonsterMaps++;
      for (const m of monsters) seenOcean.add(m.templateId);
    }
    expect(seenOcean.has('sea_monster')).toBe(true);
    expect(seenOcean.has('sea_kraken')).toBe(true);
    expect(zeroMonsterMaps).toBeGreaterThan(0);

    // 2. Inland lake maps rarely spawn Loch Ness Plesiosaurs (lake_nessie, <= 1 per map!)
    let lakeMonsterSeen = 0;
    let valleyWorld!: World;
    for (let s = 2020; s < 2032; s++) {
      const w = new World({
        seed: s,
        playerCiv: 'britons',
        aiCiv: 'gauls',
        difficulty: 'easy',
        mapType: 'aegean_valley',
        mapSize: 'small',
      });
      if (s === 2026) valleyWorld = w;
      const lm = Array.from(w.entities.values()).filter((e) => e.alive && e.templateId === 'lake_nessie');
      expect(lm.length).toBeLessThanOrEqual(1);
      lakeMonsterSeen += lm.length;
    }
    expect(valleyWorld.terrain.lakes.length).toBeGreaterThan(0);
    expect(lakeMonsterSeen).toBeGreaterThan(0);
    expect(lakeMonsterSeen).toBeLessThan(12); // Truly uncommon, NOT guaranteed on every single map!

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
    let reachedFarSide = false;
    for (let t = 0; t < SIM_HZ * 18; t++) {
      world.step();
      if (walker.order.type === 'enter_tunnel') usedTunnel = true;
      if (usedTunnel && Math.hypot(walker.x - farSide.x, walker.z - farSide.z) < 4.0) {
        reachedFarSide = true;
        break;
      }
    }
    expect(usedTunnel).toBe(true);
    expect(reachedFarSide).toBe(true);

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

    // Spawn an own-nation army 25m away (within Lv.3 rally range) + an approaching hostile enemy ONLY within Lv.3 Beacon A's detect/attack range (outside Lv.1 Beacon B's 20m detect range)!
    const armyUnit = world.spawnUnit('han_spearman', 1, beaconA.x, beaconA.z + 25)!;
    const armyStartDist = Math.hypot(armyUnit.x - beaconA.x, armyUnit.z - beaconA.z);
    const enemyRaider = world.spawnUnit('rome_hastatus', 2, beaconA.x - dirX * 20, beaconA.z)!;
    const enemyHpBefore = enemyRaider.hp;

    // Staged Beacon Ignition: on enemy detection, Beacon A begins 'igniting' (3s) -> 'burning' (3s) -> 'smoking' (rallies army + triggers Beacon B!)
    world.step();
    expect(beaconA.beaconState).toBe('igniting');
    expect(beaconB.beaconState ?? 'idle').toBe('idle');

    // After 6.2s: Beacon A reaches 'smoking', rallies armyUnit, & Beacon B spots A's rising smoke and starts 'igniting'!
    for (let t = 0; t < SIM_HZ * 6.2; t++) world.step();
    expect(beaconA.beaconState).toBe('smoking');
    expect(beaconA.beaconLitTimer ?? 0).toBeGreaterThan(0);
    expect(beaconB.beaconState).toBe('igniting');
    expect(armyUnit.order.type).toBe('move');

    // Step 3 more seconds: army marches toward Beacon A AND garrisoned crossbowmen actively shoot the enemy!
    for (let t = 0; t < SIM_HZ * 3; t++) world.step();
    expect(Math.hypot(armyUnit.x - beaconA.x, armyUnit.z - beaconA.z)).toBeLessThan(armyStartDist - 5);
    expect(enemyRaider.hp).toBeLessThan(enemyHpBefore);

    // Manual Extinguish puts out Beacon B cleanly (resets to 'idle' & 0 lit timer)!
    world.enqueueCommand({ type: 'extinguish_beacon', playerId: 1, buildingId: beaconB.id });
    world.step();
    expect(beaconB.beaconState).toBe('idle');
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

    // 6. Archipelago multi-island terrain generates DISCONNECTED, non-circular islands + deep navigable sea,
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
    expect(archW.terrain.areSpawnsConnected()).toBe(false);
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

  it('supports changeable Civic Center rally point, Scout auto-explore & flee, Doctor healing, staged A->B->C Beacon smoke relay, and unified Stone Gate portrait', () => {
    const world = new World({
      seed: 4242,
      playerCiv: 'athenians',
      aiCiv: 'romans',
      difficulty: 'medium',
      mapType: 'open_plains',
      mapSize: 'medium',
    });
    const p1 = world.players.get(1)!;
    p1.resources = { food: 3000, wood: 3000, stone: 3000, metal: 3000 };

    const cc = Array.from(world.entities.values()).find((e) => e.owner === 1 && e.templateId === 'civic_center')!;
    expect(cc).toBeDefined();

    // 1. Changeable Civic Center Rally Point: set a new rally point & verify newly trained unit walks directly there!
    const newRallyX = Math.min(world.terrain.worldSize - 10, cc.x + 18);
    const newRallyZ = Math.min(world.terrain.worldSize - 10, cc.z + 10);
    world.enqueueCommand({ type: 'set_rally', playerId: 1, buildingId: cc.id, x: newRallyX, z: newRallyZ });
    world.step();
    expect(cc.rallyX).toBeCloseTo(newRallyX, 1);
    expect(cc.rallyZ).toBeCloseTo(newRallyZ, 1);

    const beforeIds = new Set(world.entities.keys());
    world.enqueueCommand({ type: 'train', playerId: 1, buildingId: cc.id, templateId: 'athen_hoplite' });
    for (let t = 0; t < SIM_HZ * 14; t++) world.step();
    const trainedHoplite = Array.from(world.entities.values()).find(
      (e) => e.owner === 1 && e.templateId === 'athen_hoplite' && !beforeIds.has(e.id)
    )!;
    expect(trainedHoplite).toBeDefined();
    expect(Math.hypot(trainedHoplite.x - newRallyX, trainedHoplite.z - newRallyZ)).toBeLessThan(4.5);

    // 2. Scout ("探子"): zero attack, cannot build, actively explores unexplored fog tiles, & flees from enemies!
    expect(TEMPLATES.scout.attack).toBeUndefined();
    expect(TEMPLATES.scout.canBuild).toBeUndefined();
    expect(TEMPLATES.civic_center.trains).toContain('scout');
    expect(TEMPLATES.civic_center.trains).toContain('doctor');

    const countExplored = () => {
      const g = world.fog.getGrid(1);
      let n = 0;
      for (let i = 0; i < g.length; i++) if (g[i] >= 1) n++;
      return n;
    };
    const exploredBefore = countExplored();
    const scout = world.spawnUnit('scout', 1, cc.x + 4, cc.z + 4)!;
    world.enqueueCommand({ type: 'explore', playerId: 1, entityIds: [scout.id] });
    for (let t = 0; t < SIM_HZ * 8; t++) world.step();
    expect(countExplored()).toBeGreaterThan(exploredBefore + 20);

    // Enemy appears near Scout -> Scout flees away immediately (distance increases, never fights back!)
    const enemyNearScout = world.spawnUnit('rome_hastatus', 2, scout.x + 5, scout.z)!;
    const enemyHpInitial = enemyNearScout.hp;
    const fleeStartDist = Math.hypot(scout.x - enemyNearScout.x, scout.z - enemyNearScout.z);
    for (let t = 0; t < SIM_HZ * 2; t++) world.step();
    const fleeEndDist = Math.hypot(scout.x - enemyNearScout.x, scout.z - enemyNearScout.z);
    expect(fleeEndDist).toBeGreaterThan(fleeStartDist + 2.5);
    expect(enemyNearScout.hp).toBe(enemyHpInitial);

    // 3. Doctor ("醫生"): heals wounded friendly unit automatically & via direct 'heal' command!
    const doctor = world.spawnUnit('doctor', 1, cc.x - 6, cc.z + 6)!;
    const patient = world.spawnUnit('athen_hoplite', 1, cc.x - 4, cc.z + 6)!;
    patient.hp = 35;
    const hpBeforeHeal = patient.hp;
    world.enqueueCommand({ type: 'heal', playerId: 1, entityIds: [doctor.id], targetId: patient.id });
    for (let t = 0; t < SIM_HZ * 3; t++) world.step();
    expect(patient.hp).toBeGreaterThan(hpBeforeHeal + 20);

    // 4. Staged Beacon Tower Domino Chain (A -> B -> C):
    //    Place 3 Lv.1 Beacon Towers spaced 36m apart (Lv.1 relayRange = 46m, so A reaches B [36m] but NOT C [72m], and B reaches C [36m]!)
    const centerTile = world.terrain.worldToTile(world.terrain.worldSize * 0.5, world.terrain.worldSize * 0.5);
    const bA = world.spawnBuilding('beacon_tower', 1, centerTile.tx - 12, centerTile.tz, false)!;
    const bB = world.spawnBuilding('beacon_tower', 1, centerTile.tx, centerTile.tz, false)!;
    const bC = world.spawnBuilding('beacon_tower', 1, centerTile.tx + 12, centerTile.tz, false)!;
    expect(bA && bB && bC).toBeTruthy();

    // Garrison 1 soldier in each Beacon Tower so all 3 are staffed
    for (const b of [bA, bB, bC]) {
      const g = world.spawnUnit('athen_hoplite', 1, b.x + 0.5, b.z + 0.5)!;
      world.enqueueCommand({ type: 'garrison', playerId: 1, entityIds: [g.id], buildingId: b.id });
    }
    for (let t = 0; t < SIM_HZ * 2; t++) world.step();
    expect(bA.beaconState).toBe('idle');
    expect(bB.beaconState).toBe('idle');
    expect(bC.beaconState).toBe('idle');

    // Trigger Beacon A (simulate enemy spotted or manual ignition) -> A starts 'igniting'; B & C stay 'idle'!
    world.enqueueCommand({ type: 'ignite_beacon', playerId: 1, buildingId: bA.id });
    world.step();
    expect(bA.beaconState).toBe('igniting');
    expect(bB.beaconState).toBe('idle');
    expect(bC.beaconState).toBe('idle');

    // After 3.2s: A has caught fire ('burning', building smoke), B & C STILL wait ('idle') because smoke hasn't risen yet!
    for (let t = 0; t < SIM_HZ * 3.2; t++) world.step();
    expect(bA.beaconState).toBe('burning');
    expect(bB.beaconState).toBe('idle');
    expect(bC.beaconState).toBe('idle');

    // After another 3.2s (total 6.4s): A reaches 'smoking' -> B spots A's rising smoke & starts 'igniting'; C is STILL 'idle'!
    for (let t = 0; t < SIM_HZ * 3.2; t++) world.step();
    expect(bA.beaconState).toBe('smoking');
    expect(bB.beaconState).toBe('igniting');
    expect(bC.beaconState).toBe('idle');

    // After another 3.2s: B is 'burning'; C is STILL 'idle'!
    for (let t = 0; t < SIM_HZ * 3.2; t++) world.step();
    expect(bB.beaconState).toBe('burning');
    expect(bC.beaconState).toBe('idle');

    // After another 3.2s: B reaches 'smoking' -> C NOW spots B's rising smoke & starts 'igniting'!
    for (let t = 0; t < SIM_HZ * 3.2; t++) world.step();
    expect(bB.beaconState).toBe('smoking');
    expect(bC.beaconState).toBe('igniting');

    // After another 6.4s: C completes 'igniting' -> 'burning' -> 'smoking'!
    for (let t = 0; t < SIM_HZ * 6.4; t++) world.step();
    expect(bC.beaconState).toBe('smoking');

    // 5. Stone Gate Portrait: every civilization uses the authentic stone_gate.png thumbnail (no Yin-Yang or mismatched 2D icon)
    for (const civId of ALL_CIV_IDS) {
      expect(getEntityPortrait('stone_gate', civId)).toBe('/assets/0ad/ui/stone_gate.png');
    }
    expect(getEntityPortrait('scout', 'athenians')).toBe('/assets/0ad/ui/scout.png');
    expect(getEntityPortrait('doctor', 'athenians')).toBe('/assets/0ad/ui/healer.png');
  });

  it('auto-extinguishes lit Beacons after 30s without enemies (no ping-pong), auto-assigns idle workers to unfinished distant walls, and garrisons all land soldier types into wall-flanked Beacons', () => {
    const world = new World({
      seed: 5151,
      playerCiv: 'athenians',
      aiCiv: 'romans',
      difficulty: 'medium',
      mapType: 'open_plains',
      mapSize: 'medium',
    });
    const cc = Array.from(world.entities.values()).find((e) => e.owner === 1 && e.templateId === 'civic_center')!;
    const midTile = world.terrain.worldToTile(world.terrain.worldSize * 0.5, world.terrain.worldSize * 0.5);

    // 1. Wall-flanked Beacon Tower garrisoning for diverse military units (infantry, archer, cavalry, champion)!
    // Place Beacons near Player 1's base (far away from Player 2's starting units so no enemy interferes!)
    const baseTx = Math.max(12, Math.min(world.terrain.width - 24, cc.tileX + 6));
    const baseTz = Math.max(12, Math.min(world.terrain.height - 12, cc.tileZ + 6));
    world.spawnBuilding('stone_wall', 1, baseTx - 1, baseTz, false, 0);
    const beaconA = world.spawnBuilding('beacon_tower', 1, baseTx, baseTz, false, 0)!;
    world.spawnBuilding('stone_wall', 1, baseTx + 1, baseTz, false, 0);
    const beaconB = world.spawnBuilding('beacon_tower', 1, baseTx + 10, baseTz, false, 0)!;

    const garrisonSquad = [
      world.spawnUnit('athen_hoplite', 1, beaconA.x - 4, beaconA.z + 5)!,
      world.spawnUnit('athen_archer', 1, beaconA.x - 2, beaconA.z + 6)!,
      world.spawnUnit('athen_cavalry', 1, beaconA.x + 2, beaconA.z + 6)!,
      world.spawnUnit('athen_champion', 1, beaconA.x + 4, beaconA.z + 5)!,
    ];
    world.enqueueCommand({
      type: 'garrison',
      playerId: 1,
      entityIds: garrisonSquad.map((u) => u.id),
      buildingId: beaconA.id,
    });
    const guardB = world.spawnUnit('athen_hoplite', 1, beaconB.x, beaconB.z + 4)!;
    world.enqueueCommand({ type: 'garrison', playerId: 1, entityIds: [guardB.id], buildingId: beaconB.id });
    for (let t = 0; t < SIM_HZ * 5; t++) world.step();
    expect(beaconA.garrisonedIds.length).toBe(4);
    expect(beaconB.garrisonedIds.length).toBe(1);
    expect(beaconA.beaconState).toBe('idle');
    expect(beaconB.beaconState).toBe('idle');

    // 2. Beacon 30s no-enemy auto-extinguish: ignite A -> A smokes -> B chains -> after 30s without enemies, A begins 'extinguishing' -> 'idle' (NO ping-pong re-ignition from B!), then B extinguishes too!
    world.enqueueCommand({ type: 'ignite_beacon', playerId: 1, buildingId: beaconA.id });
    // 6.2s: A reaches 'smoking', B begins 'igniting'
    for (let t = 0; t < SIM_HZ * 6.2; t++) world.step();
    expect(beaconA.beaconState).toBe('smoking');
    expect(beaconB.beaconState).toBe('igniting');

    // +30.5s with NO enemies nearby: A's 30s expires -> enters 'extinguishing' while B is still 'smoking'!
    for (let t = 0; t < SIM_HZ * 30.5; t++) world.step();
    expect(beaconA.beaconState).toBe('extinguishing');
    expect(beaconB.beaconState).toBe('smoking');

    // +5s: A finishes extinguishing -> 'idle' and does NOT re-ignite from B's lingering smoke!
    for (let t = 0; t < SIM_HZ * 5; t++) world.step();
    expect(beaconA.beaconState).toBe('idle');

    // +10s: B also finishes its 30s + 4s extinguish -> BOTH beacons cleanly 'idle'!
    for (let t = 0; t < SIM_HZ * 10; t++) world.step();
    expect(beaconA.beaconState).toBe('idle');
    expect(beaconB.beaconState).toBe('idle');

    // 3. Idle Male Citizen far (>34m) from Civic Center automatically helps construct a nearby unfinished Stone Wall foundation!
    const wallTx = Math.max(8, Math.min(world.terrain.width - 8, cc.tileX + 16));
    const wallTz = cc.tileZ;
    const wallFoundation = world.spawnBuilding('stone_wall', 1, wallTx, wallTz, true, 0)!;
    expect(wallFoundation.isFoundation).toBe(true);
    expect(Math.hypot(wallFoundation.x - cc.x, wallFoundation.z - cc.z)).toBeGreaterThan(30);

    const idleMale = world.spawnUnit('male_citizen', 1, wallFoundation.x - 6, wallFoundation.z + 4)!;
    idleMale.autoWorkDelay = 0;
    for (let t = 0; t < SIM_HZ * 10; t++) world.step();
    expect(wallFoundation.isFoundation).toBe(false);
  });

  it('supports AI Proxy autopilot & cancel, disconnected non-circular archipelago islands, diverse timber & harvestable fruit trees, and random claimable wilderness treasures', () => {
    // 1. AI Proxy mode: Player 1 (human) hands over control to SkirmishAI(1), then cancels back to manual!
    const proxyWorld = new World({
      seed: 8080,
      playerCiv: 'athenians',
      aiCiv: 'romans',
      difficulty: 'medium',
      mapType: 'open_plains',
      mapSize: 'small',
    });
    const p1 = proxyWorld.players.get(1)!;
    expect(p1.isAI).toBe(false);
    const proxyAI = new SkirmishAI(1, 'medium');
    const initGathered = p1.stats.resourcesGathered;
    const initTrained = p1.stats.unitsTrained;
    // Enable AI Proxy for 60s
    for (let t = 0; t < SIM_HZ * 60; t++) {
      proxyAI.update(proxyWorld);
      proxyWorld.step();
    }
    expect(p1.stats.resourcesGathered).toBeGreaterThan(initGathered + 100);
    expect(p1.stats.unitsTrained).toBeGreaterThan(initTrained);
    // Cancel AI Proxy -> manual commands still work cleanly
    const cc = Array.from(proxyWorld.entities.values()).find((e) => e.owner === 1 && e.templateId === 'civic_center')!;
    const manualUnit = proxyWorld.spawnUnit('scout', 1, cc.x + 5, cc.z + 5)!;
    proxyWorld.enqueueCommand({ type: 'move', playerId: 1, entityIds: [manualUnit.id], x: cc.x + 15, z: cc.z + 5 });
    for (let t = 0; t < SIM_HZ * 2; t++) proxyWorld.step();
    expect(manualUnit.x).toBeGreaterThan(cc.x + 8);

    // 2. Non-circular, strictly disconnected Archipelago islands!
    const archWorld = new World({
      seed: 7373,
      playerCiv: 'athenians',
      aiCiv: 'carthaginians',
      difficulty: 'easy',
      mapType: 'archipelago',
      mapSize: 'medium',
    });
    expect(archWorld.terrain.areSpawnsConnected()).toBe(false);
    // Count distinct disconnected dry-land connected components (islands) -> must be >= 4 separate islands!
    const tw = archWorld.terrain.width;
    const th = archWorld.terrain.height;
    const vis = new Uint8Array(tw * th);
    let islandCount = 0;
    let nonCircularIslands = 0;
    const q = new Int32Array(tw * th);
    for (let z = 2; z < th - 2; z++) {
      for (let x = 2; x < tw - 2; x++) {
        const start = z * tw + x;
        if (vis[start] || !archWorld.terrain.isTileDryLand(x, z)) continue;
        let head = 0;
        let tail = 0;
        q[tail++] = start;
        vis[start] = 1;
        const xs: number[] = [];
        const zs: number[] = [];
        while (head < tail) {
          const cur = q[head++];
          const cx = cur % tw;
          const cz = (cur - cx) / tw;
          xs.push(cx);
          zs.push(cz);
          for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
            const nx = cx + dx;
            const nz = cz + dz;
            if (nx < 1 || nz < 1 || nx >= tw - 1 || nz >= th - 1) continue;
            const ni = nz * tw + nx;
            if (!vis[ni] && archWorld.terrain.isTileDryLand(nx, nz)) {
              vis[ni] = 1;
              q[tail++] = ni;
            }
          }
        }
        if (xs.length >= 40) {
          islandCount++;
          // Check island non-circularity: ratio of max vs min boundary radius from centroid
          const meanX = xs.reduce((a, b) => a + b, 0) / xs.length;
          const meanZ = zs.reduce((a, b) => a + b, 0) / zs.length;
          let maxR = 0;
          let minEdgeR = Infinity;
          for (let i = 0; i < xs.length; i++) {
            const cx = xs[i];
            const cz = zs[i];
            const isCoast =
              !archWorld.terrain.isTileDryLand(cx + 1, cz) ||
              !archWorld.terrain.isTileDryLand(cx - 1, cz) ||
              !archWorld.terrain.isTileDryLand(cx, cz + 1) ||
              !archWorld.terrain.isTileDryLand(cx, cz - 1);
            if (isCoast) {
              const r = Math.hypot(cx - meanX, cz - meanZ);
              if (r > maxR) maxR = r;
              if (r < minEdgeR) minEdgeR = r;
            }
          }
          if (minEdgeR > 0 && maxR / minEdgeR > 1.32) {
            nonCircularIslands++;
          }
        }
      }
    }
    expect(islandCount).toBeGreaterThanOrEqual(4);
    expect(nonCircularIslands).toBeGreaterThanOrEqual(2);

    // 3. Expanded Tree Species & Fruit Trees harvested as Food!
    expect(TEMPLATES.tree_apple.resourceType).toBe('food');
    expect(TEMPLATES.tree_orange.resourceType).toBe('food');
    expect(TEMPLATES.tree_fig.resourceType).toBe('food');
    expect(TEMPLATES.tree_date_palm.resourceType).toBe('food');
    expect(TEMPLATES.tree_cedar.resourceType).toBe('wood');
    expect(TEMPLATES.tree_willow.resourceType).toBe('wood');

    const fruitTreesOnMap = Array.from(proxyWorld.entities.values()).filter(
      (e) => e.alive && TEMPLATES[e.templateId]?.isFruitTree
    );
    expect(fruitTreesOnMap.length).toBeGreaterThan(0);

    // Worker harvests an Apple Tree -> delivers Food to Player 1!
    const appleTree = proxyWorld.spawnResource('tree_apple', cc.x + 6, cc.z - 6)!;
    const harvester = proxyWorld.spawnUnit('female_citizen', 1, appleTree.x - 1.2, appleTree.z)!;
    const foodBefore = p1.resources.food;
    proxyWorld.enqueueCommand({ type: 'gather', playerId: 1, entityIds: [harvester.id], targetId: appleTree.id });
    for (let t = 0; t < SIM_HZ * 10; t++) proxyWorld.step();
    expect(p1.resources.food).toBeGreaterThan(foodBefore);

    // 4. Random Wilderness Treasures spawn across the map & are claimed by ANY land unit (including Scouts!)
    const treasuresOnMap = Array.from(proxyWorld.entities.values()).filter(
      (e) => e.alive && TEMPLATES[e.templateId]?.isTreasure
    );
    expect(treasuresOnMap.length).toBeGreaterThanOrEqual(3);

    const testTreasure = proxyWorld.spawnResource('treasure_chest', cc.x - 8, cc.z - 8)!;
    const explorerScout = proxyWorld.spawnUnit('scout', 1, testTreasure.x - 4, testTreasure.z)!;
    const metalBefore = p1.resources.metal;
    const stoneBefore = p1.resources.stone;
    proxyWorld.drainEvents();
    proxyWorld.enqueueCommand({
      type: 'move',
      playerId: 1,
      entityIds: [explorerScout.id],
      x: testTreasure.x,
      z: testTreasure.z,
    });
    let sawClaimEvent = false;
    for (let t = 0; t < SIM_HZ * 4; t++) {
      proxyWorld.step();
      for (const ev of proxyWorld.drainEvents()) {
        if (ev.type === 'treasure_claimed' && ev.playerId === 1) sawClaimEvent = true;
      }
    }
    expect(testTreasure.alive).toBe(false);
    expect(sawClaimEvent).toBe(true);
    expect(p1.resources.metal).toBeGreaterThanOrEqual(metalBefore + 200);
    expect(p1.resources.stone).toBeGreaterThanOrEqual(stoneBefore + 100);
  });

  it('supports branch-propagated tree planting (timber & fruit saplings that grow and are harvestable small or mature) and warship troop boarding/disembarking', () => {
    const world = new World({
      seed: 90210,
      playerCiv: 'athenians',
      aiCiv: 'romans',
      difficulty: 'easy',
      mapType: 'open_plains',
      mapSize: 'small',
      gameMode: 'peaceful',
    });
    const p1 = world.players.get(1)!;
    const cc = Array.from(world.entities.values()).find((e) => e.owner === 1 && TEMPLATES[e.templateId].isCivicCenter)!;

    // Helper to find a clear dry planting spot near (cx, cz)
    const findPlantSpot = (cx: number, cz: number): { x: number; z: number } => {
      for (let r = 4; r <= 24; r += 2) {
        for (let a = 0; a < 16; a++) {
          const ang = (a / 16) * Math.PI * 2;
          const x = cx + Math.cos(ang) * r;
          const z = cz + Math.sin(ang) * r;
          if (world.canPlantTreeAt(x, z)) return { x, z };
        }
      }
      throw new Error('Could not find clear dry spot to plant tree');
    };

    // 1. Timber tree branch cutting -> grows small sapling into mature oak, harvestable while small!
    const oakSpot = findPlantSpot(cc.x + 8, cc.z);
    const parentOak = world.spawnResource('tree_oak', oakSpot.x, oakSpot.z)!;
    const targetOakSpot = findPlantSpot(parentOak.x + 5, parentOak.z + 2);
    const planter1 = world.spawnUnit('male_citizen', 1, parentOak.x - 1.5, parentOak.z)!;
    world.drainEvents();
    world.enqueueCommand({
      type: 'plant_tree',
      playerId: 1,
      entityIds: [planter1.id],
      sourceTreeId: parentOak.id,
      x: targetOakSpot.x,
      z: targetOakSpot.z,
    });

    let oakSaplingId = -1;
    for (let t = 0; t < SIM_HZ * 12 && oakSaplingId === -1; t++) {
      world.step();
      for (const ev of world.drainEvents()) {
        if (ev.type === 'tree_planted' && ev.templateId === 'tree_oak') {
          oakSaplingId = ev.entityId;
        }
      }
    }
    expect(oakSaplingId).toBeGreaterThan(0);
    expect(parentOak.alive).toBe(true); // Parent tree stays intact after cutting!
    const oakSapling = world.entities.get(oakSaplingId)!;
    expect(oakSapling.treeGrowth).toBeDefined();
    expect(oakSapling.treeGrowth!).toBeLessThan(0.5);
    expect(oakSapling.resourceRemaining).toBeGreaterThan(0);
    expect(World.isSapling(oakSapling)).toBe(true);

    // Growing small saplings CANNOT be harvested until they mature (neither manual gather nor idle auto-work targets them)!
    const saplingResBefore = oakSapling.resourceRemaining;
    const lumberjack = world.spawnUnit('male_citizen', 1, oakSapling.x - 1.2, oakSapling.z)!;
    world.enqueueCommand({ type: 'gather', playerId: 1, entityIds: [lumberjack.id], targetId: oakSapling.id });
    world.step();
    expect(lumberjack.order.type).toBe('idle');
    for (let t = 0; t < SIM_HZ * 3; t++) world.step();
    expect(lumberjack.order.type === 'gather' && lumberjack.order.targetId === oakSapling.id).toBe(false);
    expect(oakSapling.resourceRemaining).toBeGreaterThanOrEqual(saplingResBefore);

    // 2. Fruit tree branch cutting (Mediterranean Orange Tree) -> plants fruit sapling that grows and yields Food!
    const orangeParentSpot = findPlantSpot(cc.x - 8, cc.z);
    const parentOrange = world.spawnResource('tree_orange', orangeParentSpot.x, orangeParentSpot.z)!;
    const targetOrangeSpot = findPlantSpot(parentOrange.x - 5, parentOrange.z - 2);
    const planter2 = world.spawnUnit('female_citizen', 1, parentOrange.x + 1.5, parentOrange.z)!;
    world.drainEvents();
    world.enqueueCommand({
      type: 'plant_tree',
      playerId: 1,
      entityIds: [planter2.id],
      sourceTreeId: parentOrange.id,
      x: targetOrangeSpot.x,
      z: targetOrangeSpot.z,
    });

    let orangeSaplingId = -1;
    for (let t = 0; t < SIM_HZ * 12 && orangeSaplingId === -1; t++) {
      world.step();
      for (const ev of world.drainEvents()) {
        if (ev.type === 'tree_planted' && ev.templateId === 'tree_orange') {
          orangeSaplingId = ev.entityId;
        }
      }
    }
    expect(orangeSaplingId).toBeGreaterThan(0);
    const orangeSapling = world.entities.get(orangeSaplingId)!;
    expect(TEMPLATES[orangeSapling.templateId].isFruitTree).toBe(true);
    expect(TEMPLATES[orangeSapling.templateId].resourceType).toBe('food');
    const initialGrowth = orangeSapling.treeGrowth!;
    const initialFoodRes = orangeSapling.resourceRemaining;

    // Advance 90 seconds so BOTH the oak sapling and orange sapling grow into full-sized mature trees!
    for (let t = 0; t < SIM_HZ * 90; t++) world.step();
    expect(oakSapling.treeGrowth!).toBeCloseTo(1, 2);
    expect(World.isSapling(oakSapling)).toBe(false);
    expect(orangeSapling.treeGrowth!).toBeCloseTo(1, 2);
    expect(orangeSapling.treeGrowth!).toBeGreaterThan(initialGrowth);
    expect(orangeSapling.resourceRemaining).toBeGreaterThan(initialFoodRes);

    // Once mature, BOTH the oak tree (Wood) and propagated Orange Tree (Food) CAN be harvested!
    const woodBeforeMature = p1.resources.wood;
    const matureLumberjack = world.spawnUnit('male_citizen', 1, oakSapling.x - 1.2, oakSapling.z)!;
    world.enqueueCommand({ type: 'gather', playerId: 1, entityIds: [matureLumberjack.id], targetId: oakSapling.id });
    for (let t = 0; t < SIM_HZ * 12; t++) world.step();
    expect(p1.resources.wood).toBeGreaterThan(woodBeforeMature);

    const foodBefore = p1.resources.food;
    const fruitPicker = world.spawnUnit('female_citizen', 1, orangeSapling.x - 1.2, orangeSapling.z)!;
    world.enqueueCommand({ type: 'gather', playerId: 1, entityIds: [fruitPicker.id], targetId: orangeSapling.id });
    for (let t = 0; t < SIM_HZ * 12; t++) world.step();
    expect(p1.resources.food).toBeGreaterThan(foodBefore);

    // 2b. 3x3 Average-Height Terrain Leveling at exact 0.01m per worker cycle!
    const lvlTx = Math.max(8, Math.min(world.terrain.width - 10, cc.tileX + 6));
    const lvlTz = Math.max(8, Math.min(world.terrain.height - 10, cc.tileZ + 6));
    const vw = world.terrain.width + 1;
    // Sculpt a clear uneven 3x3 slope around (lvlTx, lvlTz): heights from 2.0m to 2.6m (max diff <= 0.30m)
    for (let vz = lvlTz - 1; vz <= lvlTz + 2; vz++) {
      for (let vx = lvlTx - 1; vx <= lvlTx + 2; vx++) {
        world.terrain.heights[vz * vw + vx] = 2.0 + (vx - (lvlTx - 1)) * 0.2;
      }
    }
    world.terrain.version++;
    const expectedAvgH = world.terrain.computeLevelAverageHeight(lvlTx, lvlTz);
    expect(expectedAvgH).toBeCloseTo(2.3, 3);

    // Single step moves vertices strictly by 0.01m toward expectedAvgH (never snapping prematurely!)
    const hBeforeLeft = world.terrain.getVertexHeight(lvlTx - 1, lvlTz);
    const hBeforeRight = world.terrain.getVertexHeight(lvlTx + 2, lvlTz);
    const step1 = world.terrain.levelSoilUnit(lvlTx, lvlTz, 1);
    expect(step1.leveled).toBe(false);
    expect(world.terrain.getVertexHeight(lvlTx - 1, lvlTz)).toBeCloseTo(hBeforeLeft + 0.01, 4);
    expect(world.terrain.getVertexHeight(lvlTx + 2, lvlTz)).toBeCloseTo(hBeforeRight - 0.01, 4);

    // Dispatch a live worker to finish leveling the remaining ~0.29m at 0.01m per 0.45s cycle (~13s)
    const lvlPos = world.terrain.tileToWorldCenter(lvlTx, lvlTz);
    const grader = world.spawnUnit('male_citizen', 1, lvlPos.x, lvlPos.z)!;
    world.enqueueCommand({
      type: 'terraform',
      playerId: 1,
      entityIds: [grader.id],
      tileX: lvlTx,
      tileZ: lvlTz,
      mode: 'level',
    });
    for (let t = 0; t < SIM_HZ * 20; t++) world.step();
    // Every single vertex of the selected tile + surrounding 1-tile ring is now completely flat at expectedAvgH!
    for (let vz = lvlTz - 1; vz <= lvlTz + 2; vz++) {
      for (let vx = lvlTx - 1; vx <= lvlTx + 2; vx++) {
        expect(world.terrain.getVertexHeight(vx, vz)).toBeCloseTo(expectedAvgH, 3);
      }
    }

    // 3. Warship Boarding, Maritime Transport & Shoreline Disembarking (Archipelago map!)
    expect(TEMPLATES.warship_trireme.garrisonCapacity).toBeGreaterThanOrEqual(8);
    const seaWorld = new World({
      seed: 4242,
      playerCiv: 'athenians',
      aiCiv: 'romans',
      difficulty: 'easy',
      mapType: 'archipelago',
      mapSize: 'small',
      gameMode: 'peaceful',
    });

    // Find a coastal water tile right next to dry walkable land!
    let coastalWater: { x: number; z: number } | null = null;
    let nearbyShore: { x: number; z: number } | null = null;
    for (let tz = 6; tz < seaWorld.terrain.height - 6 && !coastalWater; tz++) {
      for (let tx = 6; tx < seaWorld.terrain.width - 6 && !coastalWater; tx++) {
        if (!seaWorld.navGrid.isWaterPassable(tx, tz)) continue;
        for (const [dx, dz] of [
          [2, 0],
          [-2, 0],
          [0, 2],
          [0, -2],
        ]) {
          const sx = tx + dx;
          const sz = tz + dz;
          if (seaWorld.terrain.isTileDryLand(sx, sz) && seaWorld.navGrid.isWalkable(sx, sz)) {
            coastalWater = seaWorld.terrain.tileToWorldCenter(tx, tz);
            nearbyShore = seaWorld.terrain.tileToWorldCenter(sx, sz);
            break;
          }
        }
      }
    }
    expect(coastalWater).not.toBeNull();
    expect(nearbyShore).not.toBeNull();

    const ship = seaWorld.spawnUnit('warship_trireme', 1, coastalWater!.x, coastalWater!.z)!;
    const citizen = seaWorld.spawnUnit('male_citizen', 1, nearbyShore!.x, nearbyShore!.z)!;
    const hoplite = seaWorld.spawnUnit('athen_hoplite', 1, nearbyShore!.x, nearbyShore!.z)!;

    // Board both land units onto the Warship!
    seaWorld.enqueueCommand({
      type: 'garrison',
      playerId: 1,
      entityIds: [citizen.id, hoplite.id],
      buildingId: ship.id,
    });
    for (let t = 0; t < SIM_HZ * 8; t++) seaWorld.step();
    expect(ship.garrisonedIds).toContain(citizen.id);
    expect(ship.garrisonedIds).toContain(hoplite.id);
    expect(citizen.garrisonedIn).toBe(ship.id);
    expect(hoplite.garrisonedIn).toBe(ship.id);

    // Find an open-water destination away from the starting spot and sail the Warship there
    let sailTarget: { x: number; z: number } | null = null;
    for (let tz = 8; tz < seaWorld.terrain.height - 8; tz += 2) {
      for (let tx = 8; tx < seaWorld.terrain.width - 8; tx += 2) {
        if (!seaWorld.navGrid.isWaterPassable(tx, tz)) continue;
        const pos = seaWorld.terrain.tileToWorldCenter(tx, tz);
        const d = Math.hypot(pos.x - ship.x, pos.z - ship.z);
        if (d > 14 && d < 32) {
          sailTarget = pos;
          break;
        }
      }
      if (sailTarget) break;
    }
    expect(sailTarget).not.toBeNull();
    const shipStartX = ship.x;
    const shipStartZ = ship.z;
    seaWorld.enqueueCommand({
      type: 'move',
      playerId: 1,
      entityIds: [ship.id],
      x: sailTarget!.x,
      z: sailTarget!.z,
      attackMove: false,
    });
    for (let t = 0; t < SIM_HZ * 6; t++) seaWorld.step();
    expect(Math.hypot(ship.x - shipStartX, ship.z - shipStartZ)).toBeGreaterThan(4);
    // Passengers sail along with the Warship!
    expect(Math.hypot(citizen.x - ship.x, citizen.z - ship.z)).toBeLessThan(0.5);
    expect(Math.hypot(hoplite.x - ship.x, hoplite.z - ship.z)).toBeLessThan(0.5);

    // Sail back to the shoreline and disembark one by one, then all!
    seaWorld.enqueueCommand({
      type: 'move',
      playerId: 1,
      entityIds: [ship.id],
      x: coastalWater!.x,
      z: coastalWater!.z,
      attackMove: false,
    });
    for (let t = 0; t < SIM_HZ * 10; t++) seaWorld.step();
    expect(seaWorld.findShipDisembarkPoint(ship)).not.toBeNull();

    // Disembark citizen individually
    seaWorld.enqueueCommand({
      type: 'ungarrison_one',
      playerId: 1,
      buildingId: ship.id,
      unitId: citizen.id,
    });
    seaWorld.step();
    expect(citizen.garrisonedIn).toBeNull();
    const citTile = seaWorld.terrain.worldToTile(citizen.x, citizen.z);
    expect(seaWorld.terrain.isTileDryLand(citTile.tx, citTile.tz)).toBe(true);
    expect(ship.garrisonedIds).toEqual([hoplite.id]);

    // Disembark remaining hoplite via ungarrison all
    seaWorld.enqueueCommand({
      type: 'ungarrison',
      playerId: 1,
      buildingId: ship.id,
    });
    seaWorld.step();
    expect(hoplite.garrisonedIn).toBeNull();
    const hopTile = seaWorld.terrain.worldToTile(hoplite.x, hoplite.z);
    expect(seaWorld.terrain.isTileDryLand(hopTile.tx, hopTile.tz)).toBe(true);
    expect(ship.garrisonedIds.length).toBe(0);
  });

  it('supports equal 1/3 rod/net/spear shoreline fishing, protected non-harvestable trees, and 2-species tree hybridization', () => {
    const world = new World({
      seed: 314159,
      playerCiv: 'athenians',
      aiCiv: 'romans',
      difficulty: 'easy',
      mapType: 'island',
      mapSize: 'small',
      gameMode: 'peaceful',
    });
    const p1 = world.players.get(1)!;
    const cc = Array.from(world.entities.values()).find((e) => e.owner === 1 && TEMPLATES[e.templateId].isCivicCenter)!;

    // 1. Equal 1/3 probability for Fishing Rod / Cast Net / Fishing Spear
    const counts = { rod: 0, net: 0, spear: 0 };
    const N = 3000;
    for (let i = 0; i < N; i++) {
      counts[world.rollShoreFishingMethod()]++;
    }
    expect(counts.rod / N).toBeGreaterThan(0.30);
    expect(counts.rod / N).toBeLessThan(0.37);
    expect(counts.net / N).toBeGreaterThan(0.30);
    expect(counts.net / N).toBeLessThan(0.37);
    expect(counts.spear / N).toBeGreaterThan(0.30);
    expect(counts.spear / N).toBeLessThan(0.37);

    // Live shoreline fishing assigns one of the 3 methods on the gather order
    const shoreFish = world.findNearestShoreFish(cc.x, cc.z, 200);
    expect(shoreFish).not.toBeNull();
    const fisher = world.spawnUnit('female_citizen', 1, cc.x + 2, cc.z)!;
    world.enqueueCommand({ type: 'gather', playerId: 1, entityIds: [fisher.id], targetId: shoreFish!.id });
    world.step();
    expect(fisher.order.type).toBe('gather');
    if (fisher.order.type === 'gather') {
      expect(['rod', 'net', 'spear']).toContain(fisher.order.fishingMethod);
    }

    // Helper to find clear dry spot near (cx, cz)
    const findSpot = (cx: number, cz: number): { x: number; z: number } => {
      for (let r = 3; r <= 24; r += 2) {
        for (let a = 0; a < 16; a++) {
          const ang = (a / 16) * Math.PI * 2;
          const x = cx + Math.cos(ang) * r;
          const z = cz + Math.sin(ang) * r;
          if (world.canPlantTreeAt(x, z)) return { x, z };
        }
      }
      throw new Error('No dry spot found');
    };

    // 2. Protected Trees: toggle_protect_tree halts active harvesters and blocks future harvesting until unprotected!
    const protSpot = findSpot(cc.x + 7, cc.z + 2);
    const oak = world.spawnResource('tree_oak', protSpot.x, protSpot.z)!;
    const chopper = world.spawnUnit('male_citizen', 1, oak.x - 1.2, oak.z)!;
    world.enqueueCommand({ type: 'gather', playerId: 1, entityIds: [chopper.id], targetId: oak.id });
    world.step();
    expect(chopper.order.type).toBe('gather');
    expect(chopper.order.type === 'gather' && chopper.order.targetId).toBe(oak.id);

    // Protect the tree -> immediately stops chopper & rejects manual gather!
    world.enqueueCommand({ type: 'toggle_protect_tree', playerId: 1, entityId: oak.id });
    world.step();
    expect(World.isProtectedTree(oak)).toBe(true);
    expect(chopper.order.type === 'gather' && chopper.order.targetId === oak.id).toBe(false);

    const chopper2 = world.spawnUnit('male_citizen', 1, oak.x + 1.2, oak.z)!;
    world.enqueueCommand({ type: 'gather', playerId: 1, entityIds: [chopper2.id], targetId: oak.id });
    world.step();
    expect(chopper2.order.type).toBe('idle');

    // Unprotect the tree -> harvesting is allowed again!
    world.enqueueCommand({ type: 'toggle_protect_tree', playerId: 1, entityId: oak.id });
    world.step();
    expect(World.isProtectedTree(oak)).toBe(false);
    world.enqueueCommand({ type: 'gather', playerId: 1, entityIds: [chopper2.id], targetId: oak.id });
    world.step();
    expect(chopper2.order.type).toBe('gather');
    expect(chopper2.order.type === 'gather' && chopper2.order.targetId).toBe(oak.id);

    // 3. Tree Hybridization: crossbreeding 2 DIFFERENT tree species creates a brand-new hybrid tree species!
    expect(World.resolveHybridTreeTemplate('tree_oak', 'tree_oak')).toBeNull();
    expect(World.resolveHybridTreeTemplate('tree_orange', 'tree_apple')).toBe('tree_hybrid_golden_citrus');
    expect(World.resolveHybridTreeTemplate('tree_apple', 'tree_orange')).toBe('tree_hybrid_golden_citrus');
    expect(World.resolveHybridTreeTemplate('tree_fig', 'tree_date_palm')).toBe('tree_hybrid_honey_fig');
    expect(World.resolveHybridTreeTemplate('tree_oak', 'tree_cedar')).toBe('tree_hybrid_cedar_oak');
    expect(World.resolveHybridTreeTemplate('tree_bamboo', 'tree_pine')).toBe('tree_hybrid_iron_bamboo');
    expect(World.resolveHybridTreeTemplate('tree_olive', 'tree_orange')).toBe('tree_hybrid_olive_citrus');
    expect(World.resolveHybridTreeTemplate('tree_hybrid_golden_citrus', 'tree_cedar')).toBe('tree_hybrid_royal_orchard');

    // Live worker crossbreeds a Protected Orange Tree + Apple Tree -> spawns new Golden Citrus-Apple Hybrid sapling!
    const spotA = findSpot(cc.x - 6, cc.z + 4);
    const orangeParent = world.spawnResource('tree_orange', spotA.x, spotA.z)!;
    world.enqueueCommand({ type: 'toggle_protect_tree', playerId: 1, entityId: orangeParent.id });
    world.step();
    expect(World.isProtectedTree(orangeParent)).toBe(true); // Protected mother tree can still be hybridized!

    const spotB = findSpot(orangeParent.x + 3.5, orangeParent.z);
    const appleParent = world.spawnResource('tree_apple', spotB.x, spotB.z)!;
    const spotHybrid = findSpot(orangeParent.x, orangeParent.z + 4);
    const botanist = world.spawnUnit('female_citizen', 1, orangeParent.x - 1.2, orangeParent.z)!;
    world.drainEvents();
    world.enqueueCommand({
      type: 'hybridize_tree',
      playerId: 1,
      entityIds: [botanist.id],
      treeAId: orangeParent.id,
      treeBId: appleParent.id,
      x: spotHybrid.x,
      z: spotHybrid.z,
    });

    let hybridId = -1;
    for (let t = 0; t < SIM_HZ * 15 && hybridId === -1; t++) {
      world.step();
      for (const ev of world.drainEvents()) {
        if (ev.type === 'tree_hybridized' && ev.templateId === 'tree_hybrid_golden_citrus') {
          hybridId = ev.entityId;
        }
      }
    }
    expect(hybridId).toBeGreaterThan(0);
    expect(orangeParent.alive).toBe(true);
    expect(appleParent.alive).toBe(true);
    const hybridTree = world.entities.get(hybridId)!;
    expect(hybridTree.templateId).toBe('tree_hybrid_golden_citrus');
    expect(TEMPLATES[hybridTree.templateId].isHybridTree).toBe(true);
    expect(World.isSapling(hybridTree)).toBe(true);

    // Grow hybrid sapling to maturity (90s) -> harvest abundant Food!
    for (let t = 0; t < SIM_HZ * 90; t++) world.step();
    expect(hybridTree.treeGrowth!).toBeCloseTo(1, 2);
    expect(World.isSapling(hybridTree)).toBe(false);
    const foodBefore = p1.resources.food;
    const harvester = world.spawnUnit('female_citizen', 1, hybridTree.x - 1.2, hybridTree.z)!;
    world.enqueueCommand({ type: 'gather', playerId: 1, entityIds: [harvester.id], targetId: hybridTree.id });
    for (let t = 0; t < SIM_HZ * 12; t++) world.step();
    expect(p1.resources.food).toBeGreaterThan(foodBefore);
  });

  it('spawns wild miracle orchard trees, adds 11 ornamental/tropical tree species, enforces fruit ripening & regrowth, and caps stone bridge length', () => {
    const world = new World({
      seed: 202611,
      playerCiv: 'athenians',
      aiCiv: 'romans',
      difficulty: 'easy',
      mapType: 'archipelago',
      mapSize: 'small',
      gameMode: 'peaceful',
    });
    const p1 = world.players.get(1)!;
    const cc = Array.from(world.entities.values()).find((e) => e.owner === 1 && TEMPLATES[e.templateId].isCivicCenter)!;

    // 1. Rare wild Imperial Miracle Orchard Trees spawn naturally on maps
    const wildMiracles = Array.from(world.entities.values()).filter(
      (e) => e.alive && e.templateId === 'tree_hybrid_royal_orchard'
    );
    expect(wildMiracles.length).toBeGreaterThanOrEqual(1);

    // 2. All 11 new tree species are defined, recognized as trees, and Coconut Palm is a Food-bearing Fruit Tree!
    const elevenNewTrees = [
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
    ];
    for (const id of elevenNewTrees) {
      expect(TEMPLATES[id], `Missing template ${id}`).toBeDefined();
      expect(World.isTreeTemplate(id)).toBe(true);
    }
    expect(TEMPLATES.tree_coconut.isFruitTree).toBe(true);
    expect(TEMPLATES.tree_coconut.resourceType).toBe('food');

    // 3. Fruit Tree fruiting & regrowth lifecycle:
    // Mature Coconut Palm starts unripe (fruitProgress = 0) -> cannot harvest yet -> ripens -> harvestable for Food -> regrows!
    const coco = world.spawnResource('tree_coconut', cc.x + 6, cc.z)!;
    coco.fruitProgress = 0;
    coco.resourceRemaining = 0;
    expect(World.isFruitNotRipe(coco)).toBe(true);

    const picker = world.spawnUnit('female_citizen', 1, coco.x - 1.2, coco.z)!;
    world.enqueueCommand({ type: 'gather', playerId: 1, entityIds: [picker.id], targetId: coco.id });
    world.step();
    expect(picker.order.type).toBe('idle'); // Cannot harvest before fruit grows!

    // Advance 26s -> fruit ripens to 1.0 and replenishes full Food crop!
    for (let t = 0; t < SIM_HZ * 26; t++) world.step();
    expect(coco.fruitProgress).toBeCloseTo(1, 2);
    expect(World.isFruitNotRipe(coco)).toBe(false);
    expect(coco.resourceRemaining).toBe(TEMPLATES.tree_coconut.resourceAmount);

    // Pick the final remaining fruit -> delivers Food, keeps tree ALIVE, resets fruitProgress to 0 to regrow!
    coco.resourceRemaining = 4;
    const foodBefore = p1.resources.food;
    const picker2 = world.spawnUnit('female_citizen', 1, coco.x - 1.2, coco.z)!;
    world.enqueueCommand({ type: 'gather', playerId: 1, entityIds: [picker2.id], targetId: coco.id });
    for (let t = 0; t < SIM_HZ * 10; t++) world.step();
    expect(p1.resources.food).toBeGreaterThan(foodBefore);
    expect(coco.alive).toBe(true);
    expect(coco.fruitProgress!).toBeLessThan(1);

    // After another 26s, the Coconut Palm regrows a brand-new ripe crop of coconuts!
    for (let t = 0; t < SIM_HZ * 26; t++) world.step();
    expect(coco.fruitProgress).toBeCloseTo(1, 2);
    expect(coco.resourceRemaining).toBe(TEMPLATES.tree_coconut.resourceAmount);

    // 4. Stone Bridge maximum length limit (World.MAX_BRIDGE_LENGTH_TILES = 12):
    // Find a clear water ray of at least 14 consecutive water tiles extending from a shoreline!
    p1.resources.wood += 5000;
    p1.resources.stone += 5000;
    let bridgeStart: { tx: number; tz: number; dx: number; dz: number } | null = null;
    for (let tz = 10; tz < world.terrain.height - 18 && !bridgeStart; tz++) {
      for (let tx = 10; tx < world.terrain.width - 18 && !bridgeStart; tx++) {
        if (!world.terrain.isTileDryLand(tx, tz)) continue;
        for (const [dx, dz] of [
          [1, 0],
          [-1, 0],
          [0, 1],
          [0, -1],
        ]) {
          let allWater = true;
          for (let step = 1; step <= World.MAX_BRIDGE_LENGTH_TILES + 2; step++) {
            const nx = tx + dx * step;
            const nz = tz + dz * step;
            if (nx < 5 || nz < 5 || nx >= world.terrain.width - 5 || nz >= world.terrain.height - 5) {
              allWater = false;
              break;
            }
            if (world.terrain.isTileDryLand(nx, nz) || world.territory.getOwnerAtTile(nx, nz) === 2) {
              allWater = false;
              break;
            }
            if (step === 1 && !world.canPlaceBuilding(1, 'stone_bridge', nx, nz).ok) {
              allWater = false;
              break;
            }
            // Skip rays blocked by an aquatic fish shoal
            const wc = world.terrain.tileToWorldCenter(nx, nz);
            for (const ent of world.entities.values()) {
              if (!ent.alive || TEMPLATES[ent.templateId].kind === 'unit') continue;
              if (Math.hypot(ent.x - wc.x, ent.z - wc.z) < TEMPLATES[ent.templateId].radius + 2.0) {
                allWater = false;
                break;
              }
            }
            if (!allWater) break;
          }
          if (allWater) {
            bridgeStart = { tx, tz, dx, dz };
            break;
          }
        }
      }
    }
    expect(bridgeStart).not.toBeNull();
    const { tx: sx, tz: sz, dx, dz } = bridgeStart!;
    for (let step = 1; step <= World.MAX_BRIDGE_LENGTH_TILES; step++) {
      const bx = sx + dx * step;
      const bz = sz + dz * step;
      const check = world.canPlaceBuilding(1, 'stone_bridge', bx, bz);
      expect(check.ok, `Bridge segment ${step} failed: ${check.reason}`).toBe(true);
      world.spawnBuilding('stone_bridge', 1, bx, bz, false);
    }
    // The 13th contiguous bridge segment MUST be rejected due to maximum length!
    const tooLong = world.canPlaceBuilding(
      1,
      'stone_bridge',
      sx + dx * (World.MAX_BRIDGE_LENGTH_TILES + 1),
      sz + dz * (World.MAX_BRIDGE_LENGTH_TILES + 1)
    );
    expect(tooLong.ok).toBe(false);
    expect(tooLong.reason?.toLowerCase()).toContain('maximum length');
  });

  it('guarantees every distinct tree pair hybridizes cleanly and all 6 hybrid tree species grow to full maturity', () => {
    const allTrees = Object.keys(TEMPLATES).filter((id) => World.isTreeTemplate(id));
    expect(allTrees.length).toBe(29);

    // 1. Exhaustive 29x29 botanical hybridization matrix:
    //    - Same species -> null
    //    - Any 2 distinct species -> valid hybrid strictly different from BOTH parents & strictly symmetric!
    const producedHybrids = new Set<string>();
    for (const a of allTrees) {
      expect(World.resolveHybridTreeTemplate(a, a)).toBeNull();
      for (const b of allTrees) {
        if (a === b) continue;
        const res = World.resolveHybridTreeTemplate(a, b);
        const rev = World.resolveHybridTreeTemplate(b, a);
        expect(res, `Failed pair ${a} x ${b}`).not.toBeNull();
        expect(res, `Asymmetric pair ${a} x ${b}`).toBe(rev);
        expect(res, `Result matched parent A for ${a} x ${b}`).not.toBe(a);
        expect(res, `Result matched parent B for ${a} x ${b}`).not.toBe(b);
        expect(TEMPLATES[res!]?.isHybridTree, `Result ${res} not marked hybrid`).toBe(true);
        producedHybrids.add(res!);
      }
    }
    const allSixHybrids = [
      'tree_hybrid_golden_citrus',
      'tree_hybrid_honey_fig',
      'tree_hybrid_cedar_oak',
      'tree_hybrid_iron_bamboo',
      'tree_hybrid_olive_citrus',
      'tree_hybrid_royal_orchard',
    ];
    for (const h of allSixHybrids) {
      expect(producedHybrids.has(h), `Hybrid ${h} unreachable`).toBe(true);
    }

    // 2. Live worker breeding, planting & full growth of ALL 6 hybrid species (including from unripe fruit saplings!)
    const world = new World({
      seed: 424242,
      playerCiv: 'athenians',
      aiCiv: 'romans',
      difficulty: 'easy',
      mapType: 'open_plains',
      mapSize: 'small',
      gameMode: 'peaceful',
    });
    const cc = Array.from(world.entities.values()).find((e) => e.owner === 1 && TEMPLATES[e.templateId].isCivicCenter)!;

    const pairs: Array<[string, string, string]> = [
      ['tree_orange', 'tree_apple', 'tree_hybrid_golden_citrus'],
      ['tree_fig', 'tree_date_palm', 'tree_hybrid_honey_fig'],
      ['tree_oak', 'tree_maple', 'tree_hybrid_cedar_oak'],
      ['tree_bamboo', 'tree_cherry', 'tree_hybrid_iron_bamboo'],
      ['tree_olive', 'tree_coconut', 'tree_hybrid_olive_citrus'],
      ['tree_hybrid_golden_citrus', 'tree_cedar', 'tree_hybrid_royal_orchard'],
    ];

    const spawnedHybridIds: Array<{ id: number; expected: string }> = [];
    for (let i = 0; i < pairs.length; i++) {
      const [tplA, tplB, expected] = pairs[i];
      const baseX = cc.x + (i % 3) * 12 - 12;
      const baseZ = cc.z + Math.floor(i / 3) * 14 + 10;
      const sA = world.findNearestPlantableSpot(baseX, baseZ, 16)!;
      expect(sA).not.toBeNull();
      const parentA = world.spawnResource(tplA, sA.x, sA.z)!;
      // Simulate a newly planted fruit sapling with resourceRemaining === 0 to prove it can still be bred!
      if (TEMPLATES[tplA].isFruitTree) {
        parentA.treeGrowth = 0.35;
        parentA.fruitProgress = 0;
        parentA.resourceRemaining = 0;
      }

      const sB = world.findNearestPlantableSpot(sA.x + 3.2, sA.z, 10)!;
      expect(sB).not.toBeNull();
      const parentB = world.spawnResource(tplB, sB.x, sB.z)!;

      // Intentionally click right on top of parentA to prove findNearestPlantableSpot auto-nudges instead of failing!
      const botSpot = world.findNearestPlantableSpot(sA.x - 1.5, sA.z, 8) ?? sA;
      const botanist = world.spawnUnit('female_citizen', 1, botSpot.x, botSpot.z)!;
      world.drainEvents();
      world.enqueueCommand({
        type: 'hybridize_tree',
        playerId: 1,
        entityIds: [botanist.id],
        treeAId: parentA.id,
        treeBId: parentB.id,
        x: sA.x,
        z: sA.z,
      });

      let newId = -1;
      for (let t = 0; t < SIM_HZ * 30 && newId === -1; t++) {
        world.step();
        for (const ev of world.drainEvents()) {
          if (ev.type === 'tree_hybridized' && ev.templateId === expected) {
            newId = ev.entityId;
          }
        }
      }
      expect(newId, `Hybrid ${expected} failed to spawn from ${tplA} x ${tplB}`).toBeGreaterThan(0);
      spawnedHybridIds.push({ id: newId, expected });
    }

    // Grow ALL 6 hybrid saplings for 92s -> every single one matures to treeGrowth === 1 and ripens full yield!
    for (let t = 0; t < SIM_HZ * 92; t++) world.step();
    for (const { id, expected } of spawnedHybridIds) {
      const h = world.entities.get(id)!;
      expect(h && h.alive, `Hybrid ${expected} did not stay alive`).toBe(true);
      expect(h.treeGrowth, `Hybrid ${expected} did not reach maturity`).toBeCloseTo(1, 2);
      expect(World.isSapling(h)).toBe(false);
      if (TEMPLATES[expected].isFruitTree) {
        expect(h.fruitProgress, `Fruit hybrid ${expected} did not ripen`).toBeCloseTo(1, 2);
        expect(World.isFruitNotRipe(h)).toBe(false);
      }
      expect(h.resourceRemaining, `Hybrid ${expected} missing ripe/mature resource yield`).toBeGreaterThan(
        (TEMPLATES[expected].resourceAmount ?? 500) * 0.5
      );
    }
  });

  it('generates domain-warped, non-circular island and archipelago terrains with genuine elevation relief across seeds', () => {
    const analyzeTerrain = (mapType: 'island' | 'archipelago', seed: number) => {
      const w = new World({
        seed,
        playerCiv: 'athenians',
        aiCiv: 'romans',
        difficulty: 'easy',
        mapType,
        mapSize: 'small',
        gameMode: 'peaceful',
      });
      const tm = w.terrain;
      let landCount = 0;
      let maxLandH = -Infinity;
      let minLandH = Infinity;
      let sumH = 0;
      let sumH2 = 0;
      const landMask: number[] = [];
      for (let z = 0; z < tm.height; z++) {
        for (let x = 0; x < tm.width; x++) {
          const h = tm.getVertexHeight(x, z);
          const isLand = h > WATER_LEVEL ? 1 : 0;
          landMask.push(isLand);
          if (isLand) {
            landCount++;
            if (h > maxLandH) maxLandH = h;
            if (h < minLandH) minLandH = h;
            sumH += h;
            sumH2 += h * h;
          }
        }
      }
      const meanH = sumH / Math.max(1, landCount);
      const stdH = Math.sqrt(Math.max(0, sumH2 / Math.max(1, landCount) - meanH * meanH));
      return { tm, landCount, minLandH, maxLandH, stdH, landMask };
    };

    // 1. Sea Island across 3 seeds: connected spawns, varied coastlines, and genuine elevation relief (beaches -> highlands/peaks)
    const islA = analyzeTerrain('island', 101);
    const islB = analyzeTerrain('island', 404);
    const islC = analyzeTerrain('island', 909);
    for (const r of [islA, islB, islC]) {
      expect(r.tm.areSpawnsConnected()).toBe(true);
      expect(r.minLandH).toBeLessThan(1.2);
      expect(r.maxLandH).toBeGreaterThan(5.5);
      expect(r.stdH).toBeGreaterThan(0.9);
    }
    // Coastlines must vary substantially across different seeds (Jaccard distance > 20%, not the same fixed circle!)
    let islDiffAB = 0;
    let islUnionAB = 0;
    for (let i = 0; i < islA.landMask.length; i++) {
      if (islA.landMask[i] !== islB.landMask[i]) islDiffAB++;
      if (islA.landMask[i] || islB.landMask[i]) islUnionAB++;
    }
    expect(islDiffAB / Math.max(1, islUnionAB)).toBeGreaterThan(0.2);

    // 2. Archipelago across 3 seeds: strictly disconnected spawns, varied shapes, and genuine elevation highs & lows!
    const archA = analyzeTerrain('archipelago', 5511);
    const archB = analyzeTerrain('archipelago', 8080);
    const archC = analyzeTerrain('archipelago', 202611);
    for (const r of [archA, archB, archC]) {
      expect(r.tm.areSpawnsConnected()).toBe(false);
      expect(r.minLandH).toBeLessThan(1.0);
      expect(r.maxLandH).toBeGreaterThan(5.0);
      expect(r.stdH).toBeGreaterThan(0.8);
    }
    let archDiffAB = 0;
    let archUnionAB = 0;
    for (let i = 0; i < archA.landMask.length; i++) {
      if (archA.landMask[i] !== archB.landMask[i]) archDiffAB++;
      if (archA.landMask[i] || archB.landMask[i]) archUnionAB++;
    }
    expect(archDiffAB / Math.max(1, archUnionAB)).toBeGreaterThan(0.45);
  });

  it('prevents crowded workers from jittering in place around trees, mines, and drop-off buildings', () => {
    const world = new World({
      seed: 91919,
      playerCiv: 'han',
      aiCiv: 'romans',
      difficulty: 'easy',
      mapType: 'open_plains',
      mapSize: 'small',
      gameMode: 'peaceful',
    });
    const p1 = world.players.get(1)!;
    const cc = Array.from(world.entities.values()).find((e) => e.owner === 1 && TEMPLATES[e.templateId].isCivicCenter)!;
    const treeSpot = world.findNearestPlantableSpot(cc.x + 8, cc.z, 12)!;
    const targetTree = world.spawnResource('tree_oak', treeSpot.x, treeSpot.z)!;
    // Place an obstacle rock directly between workers and the tree to stress-test tangential obstacle bypass
    const rockSpot = world.findNearestPlantableSpot((cc.x + treeSpot.x) * 0.5, cc.z, 6);
    if (rockSpot) world.spawnResource('stone_quarry', rockSpot.x, rockSpot.z);

    // Send 6 workers simultaneously from the same crowded spot to chop & deliver Wood back to Civic Center!
    const workers = [];
    for (let i = 0; i < 6; i++) {
      const w = world.spawnUnit('female_citizen', 1, cc.x + 3.2 + (i % 2) * 0.4, cc.z + (i - 2.5) * 0.35)!;
      workers.push(w);
    }
    const woodBefore = p1.resources.wood;
    world.enqueueCommand({
      type: 'gather',
      playerId: 1,
      entityIds: workers.map((w) => w.id),
      targetId: targetTree.id,
    });

    for (let t = 0; t < SIM_HZ * 22; t++) {
      world.step();
    }
    // Every crowded worker should smoothly bypass obstacles, gather, and deposit substantial Wood without jittering deadlocked!
    expect(p1.resources.wood).toBeGreaterThan(woodBefore + 40);
  });

  it('enforces ruin pillar manual-only stone gathering, bow < crossbow < cannon ranges, 3-tile bridge cap, new wildlife, and pasture capture & breeding', () => {
    // 1. Stone Bridge cap === 3 tiles
    expect(World.MAX_BRIDGE_LENGTH_TILES).toBe(3);

    // 2. Range hierarchy: ALL Bows < ALL Crossbows < Siege Cannon
    const bowIds = [
      'athen_archer',
      'ptol_archer',
      'fire_archer',
      'pers_archer',
      'mace_archer',
      'sele_archer',
      'kush_archer',
      'maur_archer',
      'maur_champion',
    ];
    const crossbowIds = ['gastraphetes_crossbow', 'han_guard', 'han_crossbow'];
    const maxBowRange = Math.max(...bowIds.map((id) => TEMPLATES[id].attack!.range));
    const minCrossbowRange = Math.min(...crossbowIds.map((id) => TEMPLATES[id].attack!.range));
    const maxCrossbowRange = Math.max(...crossbowIds.map((id) => TEMPLATES[id].attack!.range));
    const cannonRange = TEMPLATES.siege_cannon.attack!.range;
    expect(maxBowRange).toBeLessThan(minCrossbowRange);
    expect(cannonRange).toBeGreaterThan(maxCrossbowRange);
    expect(TEMPLATES.workshop.trains).toContain('siege_cannon');
    expect(TEMPLATES.siege_cannon.attack!.projectileKind).toBe('cannonball');
    expect(TEMPLATES.siege_cannon.attack!.splashRadius).toBeGreaterThan(2);

    // 3. All 10 new fauna templates exist with valid definitions
    const newFaunaIds = [
      'wild_sheep',
      'wild_goat',
      'wild_chicken',
      'wild_camel',
      'wild_aurochs',
      'sea_walrus',
      'sea_whale',
      'predator_tiger',
      'predator_polar_bear',
      'predator_hippo',
    ];
    for (const fid of newFaunaIds) {
      expect(TEMPLATES[fid], `Missing template ${fid}`).toBeDefined();
    }

    const world = new World({
      seed: 42424,
      playerCiv: 'han',
      aiCiv: 'romans',
      difficulty: 'easy',
      mapType: 'open_plains',
      mapSize: 'small',
      gameMode: 'skirmish',
    });
    const p1 = world.players.get(1)!;
    const cc = Array.from(world.entities.values()).find((e) => e.owner === 1 && TEMPLATES[e.templateId].isCivicCenter)!;

    // 4. Ancient Ruin Pillar: NEVER auto-picked by findNearestResource, ONLY harvested via explicit gather command
    for (const e of world.entities.values()) {
      if (e.alive && TEMPLATES[e.templateId].resourceType === 'stone') e.alive = false;
    }
    const pillarSpot = world.findNearestPlantableSpot(cc.x + 6, cc.z, 12)!;
    const pillar = world.spawnResource('ancient_ruin_pillar', pillarSpot.x, pillarSpot.z)!;
    expect(world.findNearestResource(pillar.x, pillar.z, 'stone', 1, 50, false)).toBeNull();

    const miner = world.spawnUnit('female_citizen', 1, pillar.x - 1.4, pillar.z)!;
    const remBefore = pillar.resourceRemaining;
    world.enqueueCommand({
      type: 'gather',
      playerId: 1,
      entityIds: [miner.id],
      targetId: pillar.id,
    });
    for (let t = 0; t < SIM_HZ * 5; t++) world.step();
    expect(pillar.resourceRemaining).toBeLessThan(remBefore);

    // 5. Cannon fires splash cannonball damage from beyond crossbow range
    const cannon = world.spawnUnit('siege_cannon', 1, cc.x + 8, cc.z + 8)!;
    const enemyA = world.spawnUnit('rome_hastatus', 2, cannon.x + 22, cannon.z)!;
    const enemyB = world.spawnUnit('rome_hastatus', 2, cannon.x + 22.8, cannon.z + 0.6)!;
    const hpBeforeA = enemyA.hp;
    const hpBeforeB = enemyB.hp;
    world.enqueueCommand({
      type: 'attack',
      playerId: 1,
      entityIds: [cannon.id],
      targetId: enemyA.id,
    });
    for (let t = 0; t < SIM_HZ * 4; t++) world.step();
    expect(enemyA.hp).toBeLessThan(hpBeforeA);
    expect(enemyB.hp).toBeLessThan(hpBeforeB);

    // 6. Livestock Pasture: capture live wild sheep -> herd into Pasture -> auto-ignored by idle hunters -> breeds baby -> baby grows to adult!
    let pastureTile: { tx: number; tz: number } | null = null;
    for (let dz = -10; dz <= 10 && !pastureTile; dz++) {
      for (let dx = -10; dx <= 10 && !pastureTile; dx++) {
        const tx = cc.tileX + dx;
        const tz = cc.tileZ + dz;
        if (world.canPlaceBuilding(1, 'pasture', tx, tz).ok) {
          pastureTile = { tx, tz };
        }
      }
    }
    expect(pastureTile).not.toBeNull();
    const pasture = world.spawnBuilding('pasture', 1, pastureTile!.tx, pastureTile!.tz, false)!;
    expect(pasture).not.toBeNull();

    const sheepSpot = world.findNearestPlantableSpot(pasture.x + 6, pasture.z, 12)!;
    const sheep = world.spawnResource('wild_sheep', sheepSpot.x, sheepSpot.z)!;
    const herder = world.spawnUnit('female_citizen', 1, sheep.x - 1.5, sheep.z)!;
    expect(World.isDomesticableAnimal(sheep)).toBe(true);

    world.drainEvents();
    world.enqueueCommand({
      type: 'capture_animal',
      playerId: 1,
      entityIds: [herder.id],
      animalId: sheep.id,
      pastureId: pasture.id,
    });

    let captured = false;
    for (let t = 0; t < SIM_HZ * 25 && !captured; t++) {
      world.step();
      for (const ev of world.drainEvents()) {
        if (ev.type === 'animal_captured' && ev.animalId === sheep.id && ev.pastureId === pasture.id) {
          captured = true;
        }
      }
    }
    expect(captured).toBe(true);
    expect(sheep.pastureId).toBe(pasture.id);
    expect(world.getPastureAnimalCount(pasture.id)).toBe(1);
    // Housed livestock must never be auto-slaughtered by findNearestResource
    const autoFood = world.findNearestResource(sheep.x, sheep.z, 'food', 1, 2.5, false);
    expect(autoFood?.id).not.toBe(sheep.id);

    // Wait for automatic breeding inside the Pasture (~35s) -> baby animal is born with animalGrowth < 1!
    let babyId = -1;
    for (let t = 0; t < SIM_HZ * 40 && babyId === -1; t++) {
      world.step();
      for (const ev of world.drainEvents()) {
        if (ev.type === 'animal_born' && ev.pastureId === pasture.id) {
          babyId = ev.entityId;
        }
      }
    }
    expect(babyId).toBeGreaterThan(0);
    const baby = world.entities.get(babyId)!;
    expect(baby && baby.alive).toBe(true);
    expect(baby.templateId).toBe('wild_sheep');
    expect(baby.pastureId).toBe(pasture.id);
    expect(baby.animalGrowth).toBeLessThan(1);
    expect(world.getPastureAnimalCount(pasture.id)).toBeGreaterThanOrEqual(2);

    // Wait ~46s for baby to mature into full-grown adult!
    for (let t = 0; t < SIM_HZ * 46; t++) world.step();
    expect(baby.animalGrowth).toBeCloseTo(1, 2);
  });
});
