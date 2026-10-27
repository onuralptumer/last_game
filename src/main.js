import { Game } from './game.js';
import { loadMaterials } from './pbr.js';

async function boot() {
  const holder = document.getElementById('canvas-holder');
  const sub = document.getElementById('load-sub');
  try {
    await loadMaterials((done, total) => {
      sub.textContent = `Forging the Crucible… ${Math.round((done / total) * 100)}%`;
    });
    sub.textContent = 'Kindling the flame…';
    await new Promise((r) => setTimeout(r, 30));
    new Game(holder);
  } catch (err) {
    console.error(err);
    sub.textContent = 'WebGL 2 is required to play LAST LIGHT.';
  }
}

// Let the loading screen paint first.
requestAnimationFrame(() => setTimeout(boot, 30));
