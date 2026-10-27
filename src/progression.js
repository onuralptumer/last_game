// Run upgrades (cards), meta progression (the Reliquary) and persistence.

const SAVE_KEY = 'lastlight.save.v1';
const SETTINGS_KEY = 'lastlight.settings.v1';

export const RARITY = {
  common: { label: 'Common', weight: 60 },
  rare: { label: 'Rare', weight: 30 },
  relic: { label: 'Relic', weight: 10 },
};

// apply(mods, game) mutates run modifiers. `max` caps how often a card can be taken.
export const CARDS = [
  { id: 'vital', name: 'Vital Graft', rarity: 'common', icon: '✚', desc: '+25 max health and heal fully.', max: 6,
    apply: (m, g) => { m.maxHp += 25; g.player.maxHp = m.maxHp; g.player.hp = m.maxHp; } },
  { id: 'hollow', name: 'Hollow Point', rarity: 'common', icon: '◎', desc: '+15% damage with all weapons.', max: 8,
    apply: (m) => { m.damageMul += 0.15; } },
  { id: 'quick', name: 'Quickhands', rarity: 'common', icon: '↻', desc: '+25% reload speed.', max: 4,
    apply: (m) => { m.reloadMul += 0.25; } },
  { id: 'overclock', name: 'Overclock', rarity: 'common', icon: '≫', desc: '+12% fire rate.', max: 5,
    apply: (m) => { m.fireRateMul += 0.12; } },
  { id: 'fleet', name: 'Fleetfoot', rarity: 'common', icon: '➶', desc: '+8% movement speed.', max: 4,
    apply: (m, g) => { m.speedMul += 0.08; g.player.speedMul = m.speedMul; } },
  { id: 'plated', name: 'Plated', rarity: 'common', icon: '⬢', desc: '+25 max armor. Armor slowly regenerates.', max: 4,
    apply: (m, g) => { m.maxArmor += 25; m.armorRegen += 1.5; g.player.maxArmor = m.maxArmor; g.player.armor = m.maxArmor; } },
  { id: 'pockets', name: 'Deep Pockets', rarity: 'common', icon: '▤', desc: '+25% magazine size and +50% reserve ammo.', max: 3,
    apply: (m, g) => { m.magMul += 0.25; m.ammoMul += 0.5; g.weapons.refill(m, 1); } },
  { id: 'deadeye', name: 'Deadeye', rarity: 'rare', icon: '✛', desc: '+40% critical (weak-point) damage.', max: 4,
    apply: (m) => { m.critMul += 0.4; } },
  { id: 'leech', name: 'Bloodlight', rarity: 'rare', icon: '♥', desc: 'Kills restore 3 health.', max: 4,
    apply: (m) => { m.lifeOnKill += 3; } },
  { id: 'phase', name: 'Phase Step', rarity: 'rare', icon: '⇉', desc: '+1 dash charge and dashes recharge 20% faster.', max: 2,
    apply: (m, g) => { m.dashMax += 1; m.dashCooldown *= 0.8; g.player.dashMax = m.dashMax; g.player.dashCooldown = m.dashCooldown; g.player.dashCharges = m.dashMax; } },
  { id: 'ember', name: 'Ember Rounds', rarity: 'rare', icon: '♨', desc: 'Hits have a 15% chance to ignite foes, burning them over time.', max: 3,
    apply: (m) => { m.igniteChance += 0.15; } },
  { id: 'magnet', name: 'Lodestone', rarity: 'common', icon: '⊕', desc: 'Pickups are drawn to you from much further away. +20% shards.', max: 2,
    apply: (m) => { m.magnet += 6; m.shardMul += 0.2; } },
  { id: 'chain', name: 'Chain Spark', rarity: 'relic', icon: 'ϟ', desc: 'Kills detonate, dealing 40 damage to nearby enemies.', max: 3,
    apply: (m) => { m.chainDamage += 40; } },
  { id: 'wind', name: 'Second Wind', rarity: 'relic', icon: '☼', desc: 'Once per wave, survive a lethal blow with 30 health.', max: 1,
    apply: (m) => { m.secondWind = true; } },
  { id: 'executioner', name: 'Executioner', rarity: 'relic', icon: '☠', desc: '+60% damage to enemies below 35% health.', max: 2,
    apply: (m) => { m.executeMul += 0.6; } },
  { id: 'adrenal', name: 'Adrenal Surge', rarity: 'rare', icon: '⚡', desc: 'Dashing grants 2s of +30% damage.', max: 2,
    apply: (m) => { m.dashDamage += 0.3; } },
];

export const CARD_BY_ID = Object.fromEntries(CARDS.map((c) => [c.id, c]));

export function rollCards(taken, count = 3, luck = 0) {
  const pool = CARDS.filter((c) => (taken[c.id] || 0) < c.max);
  const out = [];
  while (out.length < count && pool.length) {
    const weights = pool.map((c) => RARITY[c.rarity].weight * (c.rarity === 'common' ? 1 : 1 + luck));
    const total = weights.reduce((a, b) => a + b, 0);
    let r = Math.random() * total;
    let i = 0;
    while (r > weights[i]) r -= weights[i++];
    out.push(pool[i]);
    pool.splice(i, 1);
  }
  return out;
}

// --- Meta progression ---------------------------------------------------------------------
export const PERKS = [
  { id: 'fortitude', name: 'Fortitude', desc: '+10 starting max health', max: 5, cost: (l) => 30 + l * 25 },
  { id: 'conviction', name: 'Conviction', desc: '+6% damage', max: 5, cost: (l) => 40 + l * 30 },
  { id: 'swiftness', name: 'Swiftness', desc: '+4% movement speed', max: 3, cost: (l) => 35 + l * 30 },
  { id: 'aegis', name: 'Aegis', desc: 'Start each run with +25 armor', max: 3, cost: (l) => 45 + l * 35 },
  { id: 'tithe', name: 'Tithe', desc: 'Start with +40 shards', max: 3, cost: (l) => 40 + l * 40 },
  { id: 'insight', name: 'Insight', desc: '+1 card reroll per run', max: 3, cost: (l) => 60 + l * 50 },
  { id: 'fortune', name: 'Fortune', desc: '+15% embers earned', max: 3, cost: (l) => 50 + l * 50 },
  { id: 'arsenal', name: 'Arsenal', desc: 'Start with the Breaker (lvl 1), then the Lancer (lvl 2)', max: 2, cost: (l) => 120 + l * 120 },
];

export function loadSave() {
  try {
    const s = JSON.parse(localStorage.getItem(SAVE_KEY));
    if (s && typeof s === 'object') return { embers: 0, perks: {}, best: 0, runs: 0, kills: 0, bossKills: 0, ...s };
  } catch (e) { /* ignore */ }
  return { embers: 0, perks: {}, best: 0, runs: 0, kills: 0, bossKills: 0 };
}

export function writeSave(save) {
  try {
    localStorage.setItem(SAVE_KEY, JSON.stringify(save));
  } catch (e) { /* ignore */ }
}

export const DEFAULT_SETTINGS = { sensitivity: 1, fov: 85, sfx: 0.8, music: 0.55, quality: 'high', shake: 1, invertY: false };

export function loadSettings() {
  try {
    const s = JSON.parse(localStorage.getItem(SETTINGS_KEY));
    if (s && typeof s === 'object') return { ...DEFAULT_SETTINGS, ...s };
  } catch (e) { /* ignore */ }
  return { ...DEFAULT_SETTINGS };
}

export function writeSettings(s) {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(s));
  } catch (e) { /* ignore */ }
}

// Run modifiers built from the meta perks.
export function baseMods(save) {
  const p = (id) => save.perks[id] || 0;
  return {
    maxHp: 100 + p('fortitude') * 10,
    maxArmor: 50 + p('aegis') * 25,
    startArmor: p('aegis') * 25,
    damageMul: 1 + p('conviction') * 0.06,
    speedMul: 1 + p('swiftness') * 0.04,
    reloadMul: 1,
    fireRateMul: 1,
    magMul: 1,
    ammoMul: 1,
    critMul: 2,
    lifeOnKill: 0,
    dashMax: 2,
    dashCooldown: 1.8,
    igniteChance: 0,
    magnet: 3,
    shardMul: 1,
    chainDamage: 0,
    secondWind: false,
    executeMul: 0,
    dashDamage: 0,
    armorRegen: 0,
    rerolls: p('insight'),
    startShards: p('tithe') * 40,
    emberMul: 1 + p('fortune') * 0.15,
    startWeapons: ['pistol', ...(p('arsenal') >= 1 ? ['shotgun'] : []), ...(p('arsenal') >= 2 ? ['rifle'] : [])],
  };
}

export function embersForRun(stats, mods) {
  const w = Math.max(0, stats.wave - 1);
  return Math.floor((w * w * 2.5 + w * 10 + stats.kills * 0.4 + stats.bossKills * 40) * mods.emberMul);
}
