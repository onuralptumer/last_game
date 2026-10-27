# LAST LIGHT

A dark, rain-soaked arena FPS for the browser, built with Three.js. You hold the Crucible, a ruined cathedral-arena under a broken dome, against endless waves pouring from six blood-gates. Keep the last light burning.

## Play

```bash
npm install
npm run dev      # http://localhost:5173
npm run build    # production build in dist/
```

Desktop browser with mouse & keyboard. Click **Begin the Vigil** to lock the mouse.

| Key | Action |
| --- | --- |
| WASD | Move |
| Mouse / LMB | Aim / fire |
| Space | Jump |
| Shift | Dash (brief invulnerability) |
| R | Reload |
| 1–5, wheel, Q | Switch weapon / last weapon |
| F | Flashlight |
| Esc | Pause |

## Features

- **Arena combat**: five weapons (Vesper pistol, Breaker shotgun, Lancer rifle, Pale Lance piercing rail cannon, Cinder grenade launcher that you can rocket-jump with). Weak-point crits, hit markers, damage numbers, combo scoring.
- **Enemies**: Husks, pouncing Stalkers, orb-casting Wisps, ground-slamming Brutes and a boss every fifth wave, **the Warden**, with barrages, spiral volleys, summons and shockwave novas you have to jump over.
- **Progression within a run**: after each wave you pick one of three boons (16 roguelite upgrades in three rarities) and spend shards in the Armory on weapons, weapon mastery and supplies.
- **Progression across runs**: when you die, your run turns into embers that you spend in the **Reliquary** on permanent perks. Saved in `localStorage`.
- **Realistic surfaces, generated in code**: at load time, a PBR texture generator running in parallel Web Workers builds flagstones, ashlar masonry, cast concrete, painted and rusted steel, tread plate, veined flesh, chitin, gunmetal, knurled grips and cloth. A triplanar material system projects them onto every shape without UV seams.
- **Detailed models**:
  - The arena has fluted columns with moulded bases and capitals, voussoir gate arches with portcullises, jersey barriers with sandbags, ribbed steel crates and oil drums, steel-framed platforms with railings, pipe runs, drains and debris.
  - Enemies have ribcages, spines, teeth, carapace plates, riveted armour, chains and furnace grilles.
  - Guns have slide serrations, rails, holo sights and grip knurling.
- **Atmosphere**: rain, lightning, fog, fake volumetric light shafts, a bloom + colour-grade + film-grain pipeline, wet reflective puddles, an adaptive synthesized soundtrack and spatial SFX. There are no external asset files.

## Deploying to Vercel

It's a standard static Vite app. Import the repo in Vercel and it picks up the defaults on its own: build command `npm run build`, output directory `dist`.

## Code map

| File | Purpose |
| --- | --- |
| `src/game.js` | State machine, waves, combat resolution, pickups, run lifecycle |
| `src/world.js` | Arena geometry, sky, lighting, rain, shafts, banners |
| `src/pbr-gen.js`, `src/pbr.js` | Procedural PBR texture generators and the worker-based loader |
| `src/triplanar.js` | Triplanar material patch for MeshStandardMaterial |
| `src/shapes.js` | Rounded/detailed geometry builders |
| `src/enemy-models.js` | Detailed enemy models (merged per bone, cloned per spawn) |
| `src/enemies.js` | Enemy models, AI, projectiles, boss |
| `src/weapons.js` | Weapon definitions, viewmodels, firing |
| `src/player.js` | Input + movement controller (dash, coyote time, step-up) |
| `src/physics.js` | Analytic collision & raycasts |
| `src/effects.js` | Pooled particles, tracers, explosions, decals, gibs |
| `src/post.js` | Post-processing |
| `src/audio.js` | Procedural WebAudio SFX and music |
| `src/progression.js` | Boons, Reliquary perks, persistence |
| `src/ui.js` | HUD and menus |

Append `?manual` to the URL to stop the render loop. Automated tests use it to step frames by hand through `window.__game.frame(dt)`.
