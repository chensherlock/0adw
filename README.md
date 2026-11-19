# Web 0 A.D. — Empires Ascendant (Browser 3D RTS)

A browser-playable, 3D historical Real-Time Strategy (RTS) MVP inspired by **0 A.D.: Empires Ascendant**, built with **TypeScript**, **Three.js**, and **Vite**.

## Features Included in MVP
- **Two Asymmetric Ancient Civilizations**: **Athenians** (Hoplites, Archers, Prodromos Cavalry, Epilektos Champions) vs. **Romans** (Hastati, Velites, Equites, Centurion Champions).
- **Citizen-Soldiers & Economy**: Dual-role infantry & cavalry harvest Wood/Stone/Metal, build structures, fight, and earn **XP Ranks** (Basic → Advanced → Elite), while Female Citizens excel at foraging & Wheat Fields.
- **4 Resources + Population**: Food, Wood, Stone, Metal, and House/Civic Center population caps.
- **Dynamic Territory Borders & Territory Decay**: Civic Centers, Defense Towers, and Fortresses project live team-colored territory borders on the 3D terrain; structures cut off from territory decay over time.
- **Building Capture & Garrisoning**: Capture enemy buildings (toggle `C` between Capture & Destroy) to flip ownership and expand territory; garrison units inside Civic Centers, Towers, and Fortresses for healing, extra arrow volleys, and capture resistance.
- **Phase I (Village) → Phase II (Town) & Upgrades**: Research Town Phase, Iron Sickles & Axes, Forged Iron Weapons, Reinforced Shields, and Ashlar Masonry.
- **Deterministic Headless Simulation (`src/sim/`)**: 20 Hz fixed-timestep ECS world, seeded PRNG, A* pathfinding + spatial-hash local avoidance, Fog of War & Shroud, and **Petra-lite Skirmish AI** (Easy / Medium / Hard).

## Quick Start

```bash
npm install
npm run dev
```

Open `http://127.0.0.1:5175/` in your browser.

### Build & Tests

```bash
npm run build
npm test
```

### 0 A.D. Official Assets (`public/assets/0ad/`)

3D COLLADA models (`.dae`), textures (`.png`), UI portraits/icons, Mediterranean terrain maps, sound effects, and music are fetched from the official **0 A.D.** repository (`https://gitea.wildfiregames.com/0ad/0ad`) and are licensed under **CC-BY-SA 3.0** by Wildfire Games (see `public/assets/0ad/LICENSE.txt`).

To re-sync or update assets from Gitea:

```bash
npm run fetch-assets
```

## Controls
- **Left-Click / Drag**: Select entity or marquee box-select units (Double-click selects all visible units of same type).
- **Right-Click**: Context-sensitive order (Move, Gather, Build/Repair, Attack, Capture/Destroy enemy building, Set Rally Point).
- **Alt + Right-Click**: Garrison into friendly Civic Center / Tower / Fortress, or force-attack enemy building.
- **Camera**: `WASD` / Arrow keys pan, Middle-drag pan, `Q` / `E` rotate, Mouse Wheel zoom, `Space` / `Home` jump to Civic Center.
- **Hotkeys**: `.` Idle Worker, `C` toggle Capture/Destroy mode, `G` Garrison mode, `Ctrl+1..9` & `1..9` Control Groups, `Esc` cancel placement/selection.
