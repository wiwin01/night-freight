// Night Freight — the HUD: health, ammo, money, timer, scores, killfeed,
// buy menu, round banners and the plant channel bar. All DOM, updated from the
// sim state once a frame; nothing here touches the 3D scene.
import { WEAPONS, GEAR } from './weapons.js';
import { phaseTimeLeft, buyPrice } from './state.js';
import { YARD } from './world.js';

export function buildHud(document) {
  const root = document.getElementById('hud');
  root.innerHTML = `
    <div id="crosshair"><span></span></div>
    <div id="topbar">
      <div class="score jackals"><b id="score-j">0</b><span>JACKALS</span></div>
      <div id="timer">10:00</div>
      <div class="score wardens"><span>WARDENS</span><b id="score-w">0</b></div>
    </div>
    <div id="round-label">ROUND 1 — BUY PHASE</div>
    <div id="killfeed"></div>
    <div id="banner"><h1 id="banner-title"></h1><p id="banner-sub"></p></div>
    <div id="bottombar">
      <div id="health"><b id="hp">100</b><span>HP</span><div id="armor">KEVLAR</div></div>
      <div id="weapon"><b id="ammo">12 / 48</b><span id="wname">P9 Sidearm</span></div>
      <div id="money"><b id="cash">$800</b><span id="gear">—</span></div>
    </div>
    <div id="plantbar"><div id="plantfill"></div><span id="planttext"></span></div>
    <div id="objective">CHARGE: <b id="charge-state">YOU CARRY IT</b></div>
    <div id="buymenu">
      <h2>BUY — press a number</h2>
      <div class="buyrow" data-buy="weapon:p9"><span class="k">1</span> P9 Sidearm <i>$0</i></div>
      <div class="buyrow" data-buy="weapon:mule"><span class="k">2</span> Mule Scattergun <i>$1200</i></div>
      <div class="buyrow" data-buy="weapon:vk7"><span class="k">3</span> VK-7 Carbine <i>$2700</i></div>
      <div class="buyrow" data-buy="weapon:longshot"><span class="k">4</span> Longshot DMR <i>$4200</i></div>
      <div class="buyrow" data-buy="kevlar:kevlar"><span class="k">5</span> Kevlar Vest <i>$650</i></div>
      <div class="buyrow" data-buy="frag:frag"><span class="k">6</span> Frag Grenade <i>$300</i></div>
      <div class="buyrow" data-buy="flash:flash"><span class="k">7</span> Flash Grenade <i>$250</i></div>
      <p class="hint">B closes · E plants / defuses · G frag · F flash · R reload · Ctrl crouch</p>
    </div>
    <div id="flash"></div>
    <div id="hitmarker">✕</div>
    <div id="death"><h1>YOU ARE DOWN</h1><p>Spectating your team — next round starts soon</p></div>
    <div id="start-screen">
      <h1>NIGHT FREIGHT</h1>
      <p>A round-based tactical FPS in a floodlit freight yard.<br>
      Jackals plant the charge at Gantry A or Signal B. Wardens stop them.<br>
      First to 5 rounds takes the yard.</p>
      <button id="play-btn">CLICK TO PLAY</button>
      <p class="hint">WASD move · mouse aim · click fire · right-click aim · B buy · E plant</p>
    </div>
    <div id="endscreen"><h1 id="end-title"></h1><p id="end-sub"></p><button id="again-btn">PLAY AGAIN</button></div>
  `;
  const el = (id) => document.getElementById(id);
  return {
    root,
    scoreJ: el('score-j'), scoreW: el('score-w'), timer: el('timer'),
    roundLabel: el('round-label'), killfeed: el('killfeed'),
    banner: el('banner'), bannerTitle: el('banner-title'), bannerSub: el('banner-sub'),
    hp: el('hp'), armor: el('armor'), ammo: el('ammo'), wname: el('wname'),
    cash: el('cash'), gear: el('gear'),
    plantbar: el('plantbar'), plantfill: el('plantfill'), planttext: el('planttext'),
    chargeState: el('charge-state'), buymenu: el('buymenu'),
    flash: el('flash'), hitmarker: el('hitmarker'), death: el('death'),
    startScreen: el('start-screen'), playBtn: el('play-btn'),
    endscreen: el('endscreen'), endTitle: el('end-title'), endSub: el('end-sub'),
    againBtn: el('again-btn'), crosshair: el('crosshair'),
  };
}

function fmtTime(sec) {
  const s = Math.max(0, Math.ceil(sec));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

let lastKillfeedLen = 0;

export function updateHud(hud, state, input) {
  const p = state.player;
  const w = WEAPONS[p.weaponId];
  hud.scoreJ.textContent = state.score.jackals;
  hud.scoreW.textContent = state.score.wardens;
  hud.timer.textContent = fmtTime(phaseTimeLeft(state));
  hud.timer.classList.toggle('urgent', phaseTimeLeft(state) <= 10 && state.phase !== 'buy');
  const phaseName = { buy: 'BUY PHASE', live: 'LIVE', planted: 'CHARGE PLANTED', ended: 'ROUND OVER', matchover: 'MATCH OVER' }[state.phase];
  hud.roundLabel.textContent = `ROUND ${state.round} — ${phaseName} · FIRST TO 5`;
  hud.hp.textContent = Math.max(0, Math.ceil(p.health));
  hud.hp.parentElement.classList.toggle('low', p.health <= 30);
  hud.armor.style.visibility = p.kevlar ? 'visible' : 'hidden';
  hud.ammo.textContent = p.ammo.reloading ? 'RELOADING…' : `${p.ammo.mag} / ${p.ammo.reserve}`;
  hud.wname.textContent = w.name;
  hud.cash.textContent = `$${p.money}`;
  const gear = [];
  if (p.frags) gear.push(`◉ ${p.frags} frag`);
  if (p.flashes) gear.push(`✦ ${p.flashes} flash`);
  if (p.hasCharge) gear.push('◆ CHARGE');
  hud.gear.textContent = gear.join(' · ') || '—';

  // killfeed
  if (state.killfeed.length !== lastKillfeedLen) {
    lastKillfeedLen = state.killfeed.length;
    hud.killfeed.innerHTML = state.killfeed.slice(-5).map((k) => `<div>${k.text}</div>`).join('');
  }

  // banner
  if (state.banner && state.time < state.banner.until) {
    hud.banner.style.opacity = '1';
    hud.bannerTitle.textContent = state.banner.title;
    hud.bannerSub.textContent = state.banner.sub;
  } else {
    hud.banner.style.opacity = '0';
  }

  // plant / defuse channel bar
  const channel = Math.max(p.planting, p.defusing);
  const max = p.planting > 0 ? 3.5 : 5;
  if (channel > 0) {
    hud.plantbar.style.opacity = '1';
    hud.plantfill.style.width = `${(channel / max) * 100}%`;
    hud.planttext.textContent = p.planting > 0 ? 'PLANTING…' : 'DEFUSING…';
  } else {
    hud.plantbar.style.opacity = '0';
  }

  // objective line
  if (state.plant) {
    hud.chargeState.textContent = `PLANTED AT ${state.plant.site === 'A' ? 'GANTRY A' : 'SIGNAL B'} — DEFEND IT`;
  } else if (state.charge.holder === p) {
    hud.chargeState.textContent = 'YOU CARRY IT — HOLD E IN A SITE';
  } else if (state.charge.holder) {
    hud.chargeState.textContent = `${state.charge.holder.name.toUpperCase()} CARRIES IT`;
  } else if (state.charge.dropped) {
    hud.chargeState.textContent = 'CHARGE DROPPED — PICK IT UP';
  }

  // buy menu: only during the buy phase, rows dim when unaffordable
  const showBuy = state.phase === 'buy' && (input.buyOpen || !input.locked);
  hud.buymenu.style.display = showBuy ? 'block' : 'none';
  if (showBuy) {
    for (const row of hud.buymenu.querySelectorAll('.buyrow')) {
      const [kind, id] = row.dataset.buy.split(':');
      const price = buyPrice(state, p, kind, id);
      row.classList.toggle('cant', price < 0 || price > p.money);
      row.classList.toggle('owned', price < 0);
    }
  }

  // death / spectate, end screen, flash
  hud.death.style.display = !p.alive && state.phase !== 'matchover' ? 'flex' : 'none';
  hud.crosshair.style.display = p.alive && input.locked ? 'block' : 'none';
  hud.flash.style.opacity = p.flashStrength > 0 ? String(Math.min(1, p.flashStrength)) : '0';
  if (state.phase === 'matchover') {
    hud.endscreen.style.display = 'flex';
    hud.endTitle.textContent = state.winner === 'jackals' ? 'JACKALS TAKE THE YARD' : 'WARDENS HOLD THE YARD';
    hud.endSub.textContent = `Final score ${state.score.jackals} — ${state.score.wardens} · You: ${p.kills} kills, ${p.deaths} deaths`;
  } else {
    hud.endscreen.style.display = 'none';
  }
}

export function showHitmarker(hud, head) {
  hud.hitmarker.style.opacity = '1';
  hud.hitmarker.style.color = head ? '#ff5a4e' : '#ffffff';
  setTimeout(() => { hud.hitmarker.style.opacity = '0'; }, 120);
}
