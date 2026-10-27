import { Game } from './game.js';

function boot() {
  const holder = document.getElementById('canvas-holder');
  try {
    new Game(holder);
  } catch (err) {
    console.error(err);
    document.getElementById('load-sub').textContent = 'WebGL 2 is required to play LAST LIGHT.';
  }
}

// Let the loading screen paint before the (synchronous) world generation.
requestAnimationFrame(() => setTimeout(boot, 30));
