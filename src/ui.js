// DOM-based HUD and menu screens.

import * as THREE from 'three';
import { WEAPONS } from './weapons.js';
import { PERKS, RARITY } from './progression.js';

const $ = (sel) => document.querySelector(sel);
const SCREENS = ['menu', 'reliquary', 'settings', 'manual', 'pause', 'intermission', 'death'];

export class UI {
  constructor(audio) {
    this.audio = audio;
    this.onAction = null;
    this.cache = {};
    this.dnums = [];
    this.screenStack = [];

    document.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-action]');
      if (!btn || btn.disabled) return;
      this.audio.play('ui');
      if (this.onAction) this.onAction(btn.dataset.action, btn);
    });
    document.addEventListener('mouseover', (e) => {
      const btn = e.target.closest('button, .card');
      if (btn && btn !== this._lastHover && !btn.disabled) this.audio.play('uiHover');
      this._lastHover = btn;
    });

    this.el = {
      hud: $('#hud'),
      crosshair: $('#crosshair'),
      hitmarker: $('#hitmarker'),
      dmgInd: $('#dmg-indicators'),
      dnums: $('#dmg-numbers'),
      hurt: $('#vignette-hurt'),
      waveLabel: $('#wave-label'),
      waveSub: $('#wave-sub'),
      bossBar: $('#boss-bar'),
      bossName: $('#boss-bar .boss-name'),
      bossFill: $('#boss-bar .boss-fill'),
      bossTrail: $('#boss-bar .boss-trail'),
      shards: $('#shards-val'),
      score: $('#score-val'),
      combo: $('#combo'),
      comboVal: $('#combo-val'),
      comboFill: $('#combo .combo-fill'),
      feed: $('#feed'),
      hpVal: $('#hp-val'),
      hpBar: $('.bar.hp'),
      hpFill: $('.bar.hp .fill'),
      hpTrail: $('.bar.hp .trail'),
      armorVal: $('#armor-val'),
      armorFill: $('.bar.armor .fill'),
      armorRow: $('.armor-row'),
      dashPips: $('#dash-pips'),
      weaponName: $('#weapon-name'),
      ammo: $('#ammo'),
      ammoMag: $('#ammo-mag'),
      ammoRes: $('#ammo-res'),
      reloadHint: $('#reload-hint'),
      slots: $('#weapon-slots'),
      banner: $('#banner'),
      bannerTitle: $('#banner .b-title'),
      bannerSub: $('#banner .b-sub'),
      resume: $('#click-to-resume'),
    };

    // weapon slots
    this.el.slots.innerHTML = WEAPONS.map((w) => `<div class="slot" data-id="${w.id}" style="--accent:#${w.color.toString(16).padStart(6, '0')}">${w.slot}</div>`).join('');
  }

  // --- screens ----------------------------------------------------------------------------
  show(id) {
    for (const s of SCREENS) $('#' + s).classList.toggle('hidden', s !== id);
    this.current = id;
  }

  hideScreens() {
    for (const s of SCREENS) $('#' + s).classList.add('hidden');
    this.current = null;
  }

  // Open an overlay screen remembering where to return to.
  push(id) {
    this.screenStack.push(this.current);
    this.show(id);
  }

  pop() {
    const prev = this.screenStack.pop();
    if (prev) this.show(prev);
    else this.hideScreens();
    return prev;
  }

  setHud(visible) {
    this.el.hud.classList.toggle('hidden', !visible);
  }

  setResumeHint(v) {
    this.el.resume.classList.toggle('hidden', !v);
  }

  fade(on) {
    $('#fade').classList.toggle('on', on);
  }

  loaded() {
    $('#loading').classList.add('done');
  }

  _set(key, el, value, prop = 'textContent') {
    if (this.cache[key] === value) return;
    this.cache[key] = value;
    el[prop] = value;
  }

  // --- HUD --------------------------------------------------------------------------------
  updateHUD(g, dt) {
    const p = g.player;
    const E = this.el;
    const hp = Math.max(0, Math.ceil(p.hp));
    this._set('hp', E.hpVal, String(hp));
    const hpPct = Math.max(0, p.hp / p.maxHp) * 100;
    this._set('hpw', E.hpFill.style, hpPct.toFixed(1) + '%', 'width');
    this._set('hpt', E.hpTrail.style, hpPct.toFixed(1) + '%', 'width');
    const low = p.hp / p.maxHp < 0.3;
    if (this.cache.low !== low) {
      this.cache.low = low;
      E.hpBar.classList.toggle('low', low);
    }
    this._set('ar', E.armorVal, String(Math.ceil(p.armor)));
    this._set('arw', E.armorFill.style, ((p.armor / p.maxArmor) * 100).toFixed(1) + '%', 'width');
    this._set('arv', E.armorRow.style, p.armor > 0.5 || p.maxArmor > 50 ? '1' : '0.35', 'opacity');

    // dash pips
    if (this.cache.dashMax !== p.dashMax) {
      this.cache.dashMax = p.dashMax;
      E.dashPips.innerHTML = Array.from({ length: p.dashMax }, () => '<div class="pip"><div class="f"></div></div>').join('');
      this.pipEls = [...E.dashPips.querySelectorAll('.f')];
    }
    this.pipEls.forEach((f, i) => {
      const v = i < p.dashCharges ? 1 : i === p.dashCharges ? p.dashRecharge / p.dashCooldown : 0;
      f.style.transform = `scaleX(${v.toFixed(3)})`;
      f.style.opacity = v >= 1 ? '1' : '0.45';
    });

    // weapon
    const W = g.weapons;
    const def = W.def;
    const s = W.ammo;
    this._set('wn', E.weaponName, def.name + (s.tier ? ' ' + 'I'.repeat(s.tier) : ''));
    this._set('am', E.ammoMag, String(s.mag));
    this._set('ar2', E.ammoRes, s.reserve === Infinity ? '∞' : String(s.reserve));
    const magSize = W.magSize(def, g.mods);
    const lowAmmo = s.mag <= Math.ceil(magSize * 0.25);
    if (this.cache.lowAmmo !== lowAmmo) {
      this.cache.lowAmmo = lowAmmo;
      E.ammo.classList.toggle('low', lowAmmo);
    }
    const showReload = s.mag === 0 && W.reloadTime <= 0 && s.reserve > 0;
    const noAmmo = s.mag === 0 && s.reserve <= 0;
    const hint = W.reloadTime > 0 ? 'RELOADING' : showReload ? 'RELOAD [R]' : noAmmo ? 'NO AMMO — SWITCH' : '';
    this._set('rh', E.reloadHint, hint);
    E.reloadHint.classList.toggle('hidden', !hint);
    const slotKey = WEAPONS.map((w) => (W.state[w.id].owned ? 1 : 0)).join('') + W.current;
    if (this.cache.slots !== slotKey) {
      this.cache.slots = slotKey;
      E.slots.querySelectorAll('.slot').forEach((el) => {
        const st = W.state[el.dataset.id];
        el.classList.toggle('owned', st.owned);
        el.classList.toggle('locked', !st.owned);
        el.classList.toggle('active', el.dataset.id === W.current);
      });
    }

    // crosshair spread
    const spread = W.currentSpread(p);
    const gap = 5 + spread * 500 + W.recoil * 6;
    const gapStr = `${gap.toFixed(1)}px`;
    if (this.cache.gap !== gapStr) {
      this.cache.gap = gapStr;
      E.crosshair.style.setProperty('--gap', gapStr);
    }

    // wave / meta
    this._set('wave', E.waveLabel, g.waveLabel());
    this._set('wsub', E.waveSub, g.waveSubLabel());
    this._set('shards', E.shards, String(g.shards));
    this._set('score', E.score, g.score.toLocaleString());

    if (g.combo >= 2) {
      E.combo.classList.remove('hidden');
      this._set('combo', E.comboVal, 'x' + g.combo);
      E.comboFill.style.width = Math.max(0, (g.comboTimer / g.comboWindow) * 100) + '%';
    } else E.combo.classList.add('hidden');

    // boss
    const boss = g.enemies.bossAlive;
    if (boss) {
      E.bossBar.classList.remove('hidden');
      const pct = Math.max(0, boss.hp / boss.maxHp) * 100;
      this._set('boss', E.bossFill.style, pct.toFixed(2) + '%', 'width');
      this._set('bosst', E.bossTrail.style, pct.toFixed(2) + '%', 'width');
      this._set('bossn', E.bossName, boss.bossPhase === 2 ? 'THE WARDEN — ENRAGED' : 'THE WARDEN');
    } else E.bossBar.classList.add('hidden');

    // hurt vignette
    const hurt = Math.max(g.hurtFlash, low ? 0.35 + Math.sin(performance.now() * 0.006) * 0.15 : 0);
    E.hurt.style.opacity = hurt.toFixed(3);

    this._updateDamageNumbers(dt, g.camera);
  }

  hitmarker(kind) {
    const h = this.el.hitmarker;
    h.classList.remove('show', 'crit', 'kill');
    void h.offsetWidth;
    h.classList.add('show');
    if (kind === 'crit') h.classList.add('crit');
    if (kind === 'kill') h.classList.add('kill', 'crit');
    clearTimeout(this._hmT);
    this._hmT = setTimeout(() => h.classList.remove('show'), 60);
  }

  damageIndicator(angle) {
    const d = document.createElement('div');
    d.className = 'dmg-ind';
    d.style.transform = `rotate(${angle}rad)`;
    this.el.dmgInd.appendChild(d);
    requestAnimationFrame(() => {
      d.style.opacity = '0';
    });
    setTimeout(() => d.remove(), 1000);
  }

  damageNumber(pos, amount, kind) {
    if (this.dnums.length > 40) {
      const old = this.dnums.shift();
      old.el.remove();
    }
    const el = document.createElement('div');
    el.className = 'dnum ' + (kind || '');
    el.textContent = Math.round(amount);
    this.el.dnums.appendChild(el);
    this.dnums.push({ el, pos: pos.clone(), t: 0, dx: (Math.random() - 0.5) * 30 });
  }

  _updateDamageNumbers(dt, camera) {
    const w = window.innerWidth, h = window.innerHeight;
    const v = new THREE.Vector3();
    for (let i = this.dnums.length - 1; i >= 0; i--) {
      const d = this.dnums[i];
      d.t += dt;
      if (d.t > 0.9) {
        d.el.remove();
        this.dnums.splice(i, 1);
        continue;
      }
      v.copy(d.pos);
      v.y += d.t * 0.8;
      v.project(camera);
      if (v.z > 1) {
        d.el.style.display = 'none';
        continue;
      }
      d.el.style.display = '';
      const x = (v.x * 0.5 + 0.5) * w + d.dx * d.t;
      const y = (-v.y * 0.5 + 0.5) * h;
      const s = d.t < 0.1 ? 1.4 - d.t * 4 : 1;
      d.el.style.transform = `translate(-50%,-50%) translate(${x.toFixed(1)}px, ${y.toFixed(1)}px) scale(${s})`;
      d.el.style.left = '0';
      d.el.style.top = '0';
      d.el.style.opacity = String(Math.min(1, (0.9 - d.t) * 4));
    }
  }

  clearTransient() {
    this.dnums.forEach((d) => d.el.remove());
    this.dnums = [];
    this.el.dmgInd.innerHTML = '';
    this.el.feed.innerHTML = '';
  }

  feed(html) {
    const d = document.createElement('div');
    d.className = 'feed-item';
    d.innerHTML = html;
    this.el.feed.appendChild(d);
    while (this.el.feed.children.length > 5) this.el.feed.firstChild.remove();
    setTimeout(() => (d.style.opacity = '0'), 2200);
    setTimeout(() => d.remove(), 2900);
  }

  banner(title, sub = '', { boss = false, duration = 2.6 } = {}) {
    const b = this.el.banner;
    this.el.bannerTitle.textContent = title;
    this.el.bannerSub.textContent = sub;
    b.classList.toggle('boss', boss);
    b.classList.add('show');
    clearTimeout(this._bT);
    this._bT = setTimeout(() => b.classList.remove('show'), duration * 1000);
  }

  // --- Menu --------------------------------------------------------------------------------
  updateMenu(save) {
    $('#menu-embers').textContent = save.embers > 0 ? `✦ ${save.embers}` : '';
    $('#menu-stats').innerHTML = save.runs
      ? `Best wave <b>${save.best}</b> &nbsp;·&nbsp; Vigils <b>${save.runs}</b> &nbsp;·&nbsp; Slain <b>${save.kills}</b>`
      : 'Click <b>Begin the Vigil</b> to start. Mouse & keyboard required.';
  }

  buildReliquary(save) {
    $('#rel-embers').textContent = save.embers;
    $('#perk-grid').innerHTML = PERKS.map((p) => {
      const lvl = save.perks[p.id] || 0;
      const maxed = lvl >= p.max;
      const cost = maxed ? 0 : p.cost(lvl);
      return `<div class="perk ${maxed ? 'maxed' : ''}">
        <div class="name">${p.name}</div>
        <div class="desc">${p.desc}</div>
        <div class="pips">${Array.from({ length: p.max }, (_, i) => `<i class="${i < lvl ? 'on' : ''}"></i>`).join('')}</div>
        <button data-action="perk" data-id="${p.id}" ${maxed || save.embers < cost ? 'disabled' : ''}>${maxed ? 'MASTERED' : `✦ ${cost}`}</button>
      </div>`;
    }).join('');
  }

  bindSettings(settings, onChange) {
    const bind = (id, key, fmt = (v) => v) => {
      const input = $('#' + id);
      const out = input.parentElement.querySelector('output');
      const isCheck = input.type === 'checkbox';
      if (isCheck) input.checked = !!settings[key];
      else input.value = settings[key];
      if (out) out.textContent = fmt(settings[key]);
      input.addEventListener('input', () => {
        const v = isCheck ? input.checked : input.tagName === 'SELECT' ? input.value : parseFloat(input.value);
        settings[key] = v;
        if (out) out.textContent = fmt(v);
        onChange(key);
      });
    };
    const pct = (v) => Math.round(v * 100) + '%';
    bind('set-sens', 'sensitivity', (v) => Number(v).toFixed(2));
    bind('set-fov', 'fov', (v) => v + '°');
    bind('set-sfx', 'sfx', pct);
    bind('set-music', 'music', pct);
    bind('set-shake', 'shake', pct);
    bind('set-invert', 'invertY');
    bind('set-quality', 'quality');
  }

  // --- Intermission -----------------------------------------------------------------------
  buildIntermission(g) {
    $('#inter-pre').textContent = `WAVE ${g.wave} SURVIVED`;
    const next = g.wave + 1;
    $('#inter-stats').innerHTML = `Slain <b>${g.stats.kills}</b> &nbsp;·&nbsp; Score <b>${g.score.toLocaleString()}</b> &nbsp;·&nbsp; Next: <b>${next % 5 === 0 ? 'THE WARDEN' : 'Wave ' + next}</b>`;
    this.renderCards(g);
    this.renderArmory(g);
  }

  renderCards(g) {
    const picked = g.pickedCard;
    $('#cards').innerHTML = g.cardChoices
      .map((c, i) => {
        const n = g.cardsTaken[c.id] || 0;
        const cls = picked ? (picked === c.id ? 'selected' : 'dimmed') : '';
        return `<div class="card ${c.rarity} ${cls}" data-action="card" data-i="${i}">
          ${n ? `<div class="ccount">${n}/${c.max}</div>` : ''}
          <div class="icon">${c.icon}</div>
          <div class="rar">${RARITY[c.rarity].label}</div>
          <div class="cname">${c.name}</div>
          <div class="cdesc">${c.desc}</div>
        </div>`;
      })
      .join('');
    const rb = $('#reroll-btn');
    rb.textContent = `Reroll (${g.rerolls})`;
    rb.disabled = !!picked || g.rerolls <= 0;
    const nb = $('#next-wave-btn');
    nb.disabled = !picked;
    nb.textContent = picked ? (((g.wave + 1) % 5 === 0) ? 'Face the Warden' : `Begin Wave ${g.wave + 1}`) : 'Choose a boon';
    $('#inter-title').textContent = picked ? 'Prepare' : 'Choose a Boon';
  }

  renderArmory(g) {
    $('#armory-shards').textContent = g.shards;
    const p = g.player;
    $('#inter-vitals').innerHTML = `Health <b>${Math.ceil(p.hp)}/${p.maxHp}</b> &nbsp;·&nbsp; Armor <b>${Math.ceil(p.armor)}/${p.maxArmor}</b>`;
    const items = g.armoryItems();
    let html = '';
    let group = null;
    for (const it of items) {
      if (it.group !== group) {
        group = it.group;
        html += `<div class="arm-group">${group}</div>`;
      }
      const afford = g.shards >= it.cost;
      html += `<div class="arm-item">
        <div class="an" style="${it.color ? `color:${it.color}` : ''}">${it.name}</div>
        <button data-action="buy" data-id="${it.id}" class="${it.done ? 'owned' : ''}" ${it.done || !afford || it.disabled ? 'disabled' : ''}>${it.done ? it.doneLabel || 'OWNED' : '◆ ' + it.cost}</button>
        <div class="ad">${it.desc}</div>
      </div>`;
    }
    $('#armory-list').innerHTML = html;
  }

  // --- Death --------------------------------------------------------------------------------
  buildDeath(g, embers, newBest) {
    const s = g.stats;
    const acc = s.shots ? Math.round((s.hits / s.shots) * 100) : 0;
    const t = Math.floor(s.time);
    const rows = [
      ['Wave reached', g.wave],
      ['Enemies slain', s.kills],
      ['Score', g.score.toLocaleString()],
      ['Wardens felled', s.bossKills],
      ['Accuracy', acc + '%'],
      ['Critical hits', s.crits],
      ['Damage dealt', Math.round(s.damage).toLocaleString()],
      ['Time survived', `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`],
    ];
    $('#death-stats').innerHTML = rows.map(([k, v]) => `<div><span>${k}</span><b>${v}</b></div>`).join('');
    $('#death-embers').innerHTML = `+ ✦ ${embers} embers${newBest ? '<span class="best">NEW BEST WAVE</span>' : ''}`;
  }
}
