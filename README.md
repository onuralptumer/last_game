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
- **Atmosphere**: all of it is generated in code, so there are no asset files. That covers the textures, models, shaders and sound: rain, lightning, fog, fake volumetric light shafts, a bloom + colour-grade + film-grain pipeline, a wet floor with puddle reflections, an adaptive synthesized soundtrack and spatial SFX.

## Deploying to Vercel

It's a standard static Vite app. Import the repo in Vercel and it picks up the defaults on its own: build command `npm run build`, output directory `dist`.

## Code map

| File | Purpose |
| --- | --- |
| `src/game.js` | State machine, waves, combat resolution, pickups, run lifecycle |
| `src/world.js` | Arena geometry, sky, lighting, rain, shafts, banners |
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
