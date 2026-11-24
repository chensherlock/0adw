# Web 0 A.D. — Empires Ascendant (Browser 3D RTS)

A browser-playable 3D historical Real-Time Strategy (RTS) game inspired by **0 A.D.: Empires Ascendant**, built with **TypeScript**, **Three.js**, **Vite**, and **Vitest**, using authentic official 0 A.D. 3D models, animations, textures, terrain maps, portraits, and audio.

---

## Core Features

### 14 Official 0 A.D. Civilizations & Asymmetric Warfare
- Play as any of **14 official 0 A.D. civilizations** (or **Random**): **Athenians, Britons, Carthaginians, Gauls, Han, Iberians, Kushites, Macedonians, Mauryas, Persians, Ptolemies, Romans, Seleucids, and Spartans**.
- Every civilization features distinct **3D architecture, unit models, portraits, unique buildings, unique technologies, active civilization skills**, and cultural warfare rosters including **War Elephants, War Dogs, Camel Riders, Crossbowmen, War Chariots, Fire Archers, Lithobolos, Catapults, Ballistas, and Battering Rams**.

### Multi-Nation Skirmish, Diplomacy & Save/Load
- **Up to 8 Nations** in Skirmish or Peaceful mode with **0 A.D. Diplomacy & Alliances** (allied teams, shared allied vision, resource tribute, allied Market trade, and allied Tunnel passage).
- **16 Terrain Archetypes** (`aegean_valley`, `medit_highlands`, `twin_peninsulas`, `inland_oasis`, `open_plains`, `alpine_passes`, `island`, `archipelago`, `mountain`, `plateau`, `hills`, `mesa`, `swamp`, `rainforest`, `forest`, `volcano`) and **4 Map Sizes** (`small`, `medium`, `large`, `huge`), with geological underground cross-section skirts at map boundaries.
- **Persistent Setup & Save/Load**: Skirmish settings are saved automatically (with a one-click Reset button), and full match state—including terrain edits, Fog of War, diplomacy, entities, and camera—can be saved and loaded.

### Economy, Citizens, Trade & Specialist Units
- **Female & Male Citizens** with distinct stats, armor, self-defense, and gathering strengths (newly trained Civic Center workers pause for a 10-second overhead countdown before auto-assigning to work, canceled immediately by any manual order).
- **Changeable Rally Points**: Select a Civic Center or any production building and **Right-Click** anywhere on the map/resource—or click the **🚩 Set Rally Point** button—to update the 3D rally flag and route newly trained units.
- **4 City Phases & Urban Growth**: Advance through **Village → Town → City → Empire**, research **Multi-Story Housing** to upgrade Houses into **Multi-Story Apartments** (up to 3 stories via timed upgrades), dismantle **Ancient Ruin Pillars** for Stone, and train **Market Trade Caravans** to shuttle goods between Markets for Gold.
- **Shoreline Fishing & Naval Gameplay**: Land workers can fish with animated **3D fishing rods & cast nets** strictly from shoreline fish shoals near the water's edge, while **Docks** train **Fishing Boats** (for deep-sea shoals), **Merchant Ships**, and **Trireme Warships**.
- **Scout (`探子`)**: Unarmed, fast, wide-vision (`25m`) pathfinder trainable at Civic Centers & Barracks; cannot build or attack, **automatically explores unexplored Fog-of-War land**, and **flees immediately** upon spotting enemies or predators.
- **Doctor (`醫生`) & Temple Healer**: Trainable at Civic Centers (Phase I) & Temples; automatically seeks and heals wounded friendly or allied units (or heals directly via right-click) with 3D emerald healing beams and particles.

### Great Wall Fortifications & Staged Beacon Towers (`烽火台`)
- **Continuous Free-Angle Stone Walls**: Build seamlessly across flat land, steep mountain ridges, and map edges with slope-sheared geometry and corner bastions.
- **Timed 3-Segment Stone Gates**: Upgrade any interior wall segment (merging prev + center + next) into a **Stone Gate**, or revert a Gate back into 3 wall segments. Toggle between **Auto** (own nation only), **Open**, and **Locked** modes.
- **3-Level Great Wall Beacon Towers**: Upgrade any wall segment to a **Beacon Tower** (Lv.1 → Lv.2 → Lv.3, scaling relay/rally range and garrison capacity `5 / 8 / 12`). Requires garrisoned soldiers to function, offers clickable individual garrison exit, scales damage reduction with garrison count, and lets garrisoned ranged soldiers fire at enemies.
- **Staged Ignition & Domino Smoke Relay (`A → B → C`)**: Upon spotting an enemy or manual ignition, a Beacon Tower transitions realistically through **Kindling (`3s`) → Burning & Smoke Buildup (`3s`) → Rising Wolf-Smoke (`30s`)**, rallying nearby armies; neighboring garrisoned Beacon Towers begin their own ignition only after seeing a neighbor's rising smoke column, chaining across the map.
- **Realistic Particle Fire & Volumetric Smoke**: Animated multi-layer additive flames, glowing coal beds, spiraling ember sparks, dynamic flickering firelight, and tall wind-drifting volumetric smoke plumes (with manual **Extinguish** support).

### Terraforming, Diagonal Bridges & X-Ray Underground Tunnels
- **0.01m Incremental Terraforming**: Workers can **Dig**, **Raise**, and **Level** terrain (100 soil units = 1.0m elevation change) with cooperative multi-worker speed-up, live elevation markers, **Cancel without reverting**, and resuming unfinished jobs with other workers.
- **Free-Angle Stone Bridges**: Span rivers and lakes at straight or diagonal angles.
- **Underground Tunnels with 3D X-Ray Cutaway**: Excavation scales with tunnel length; flat tunnels offer faster travel than climbing slopes so units automatically route through them. Clicking a tunnel activates a textured **3D X-Ray Cutaway** showing animated 0 A.D. workers digging and travelers walking inside and exiting through the portal door.

### Living Wildlife & Aquatic Monsters
- Biome-specific wild animals, soaring birds (eagles & seagulls), and textured **Sea Dragons, Giant Krakens**, and **Loch Ness Monsters**.
- **Bidirectional Combat**: Sea and lake monsters attack both ships and nearby people along shores/bridges, and units/ships/towers can fight back.
- **Species AI & Speeds**: Fierce predators counterattack when attacked while docile fauna (deer, gazelles) flee away, with distinct movement speeds per species.

### UI, Quality of Life & Architecture
- **Bilingual UI**: Switch seamlessly between **English** and **Traditional Chinese (`繁體中文`)**.
- **Clear Feedback**: Disabled buttons explain exact unlock/resource reasons, invalid building placements display floating reason badges, and **Under Attack** toasts include a clickable **`📍 Jump`** button to snap the camera to the action.
- **Deterministic Headless Simulation (`src/sim/`)**: 20 Hz fixed-timestep simulation, seeded PRNG, A* land/water pathfinding + spatial-hash avoidance, Fog of War & Shroud, **Petra-lite Skirmish AI** (Easy / Medium / Hard), and built-in Cheat panel.

---

## Quick Start

```bash
npm install
npm run dev
```

Open `http://127.0.0.1:8000/` in your browser.

### Build & Tests

```bash
npm run build   # TypeScript check (tsc --noEmit) + Vite production bundle
npm test        # 32 automated Vitest suites (assets + headless simulation)
```

### 0 A.D. Official Assets (`public/assets/0ad/`)

3D COLLADA models (`.dae`), textures (`.png`), UI portraits/icons, Mediterranean terrain maps, sound effects, and music are fetched from the official **0 A.D.** repository (`https://gitea.wildfiregames.com/0ad/0ad`) and are licensed under **CC-BY-SA 3.0** by Wildfire Games (see [LICENSE.txt](public/assets/0ad/LICENSE.txt)).

To re-sync or update assets from Gitea:

```bash
npm run fetch-assets
```

---

## Controls
- **Left-Click / Drag**: Select entity or marquee box-select units (Double-click selects all visible units of the same type; click a Tunnel for 3D X-Ray view; click a garrison chip to eject an individual unit).
- **Right-Click**: Context-sensitive order (Move, Gather / Shore Fish, Build / Repair, Heal friendly/allied unit with Doctor, Attack / Capture enemy, Enter Tunnel, Market Trade, or Set Rally Point for selected production buildings).
- **Alt + Right-Click**: Garrison into friendly Civic Center / Tower / Fortress / Beacon Tower, or force-attack enemy building.
- **Camera**: `WASD` / Arrow keys pan, Middle-drag pan, `Q` / `E` rotate, Mouse Wheel zoom, `Space` / `Home` jump to Civic Center, Minimap click/drag jump.
- **Hotkeys**: `.` Idle Worker, `C` toggle Capture/Destroy mode, `G` Garrison mode, `Ctrl+1..9` & `1..9` Control Groups, `Esc` cancel placement / terraforming / rally mode / selection.
