// Night Freight — one place for match state: rounds, phases, economy, scores.
// The simulation steps at a fixed 60 Hz in main.js; this module only holds the
// rules. A round is won by elimination, by a planted charge going off, or by a
// defuse / the round timer expiring with no plant. First team to 5 rounds wins.
import { WEAPONS, GEAR, freshAmmo } from './weapons.js';
import { YARD } from './world.js';

export const WIN_ROUNDS = 5;
export const BUY_SECONDS = 10;
export const ROUND_SECONDS = 100;
export const FUSE_SECONDS = 38;
export const PLANT_SECONDS = 3.0;
export const DEFUSE_SECONDS = 5;
export const KILL_REWARD = 300;
export const WIN_REWARD = 3000;
export const OBJECTIVE_REWARD = 3500;
export const START_MONEY = 800;

export function makeCombatant(id, name, team, isPlayer, weaponId) {
  return {
    id, name, team, isPlayer,
    pos: { x: 0, y: 0, z: 0 },
    yaw: 0, pitch: 0,
    health: 100, alive: true,
    weaponId, ammo: freshAmmo(weaponId),
    kevlar: false, frags: 0, flashes: 0,
    money: START_MONEY, kills: 0, deaths: 0,
    bloom: 0, lastShotAt: -999, ads: false, crouched: false, moving: false,
    // bot brain lives here too, so the sim never hunts for it elsewhere
    bot: null,
    hasCharge: false,
    planting: 0, defusing: 0,
    flashUntil: 0, flashStrength: 0,
    speedMul: 1,
  };
}

export function newMatch(rng) {
  const state = {
    rng,
    time: 0,            // seconds since match start (sim time)
    phase: 'buy',       // buy | live | planted | ended | matchover
    phaseUntil: BUY_SECONDS,
    round: 1,
    score: { jackals: 0, wardens: 0 },
    lossStreak: { jackals: 0, wardens: 0 },
    plant: null,        // { site: 'A'|'B', plantedAt, fuseUntil }
    charge: { holder: null, dropped: null }, // dropped: {x,z} when carrier dies
    killfeed: [],       // { text, at } newest last, capped
    banner: null,       // { title, sub, at, until }
    combatants: [],
    grenades: [],       // live grenade sim objects
    tracers: [],        // { from, to, until, color }
    winner: null,
    roundWinner: null,
    log: [],
  };
  const names = {
    jackals: ['Rook', 'Sable', 'Dune'],
    wardens: ['Iris', 'Bram', 'Kestrel', 'Voss'],
  };
  let id = 0;
  const player = makeCombatant(id++, 'You', 'jackals', true, 'p9');
  player.pos = { x: YARD.spawnJackals.x, y: 0, z: YARD.spawnJackals.z - 4 };
  player.yaw = -Math.PI / 2; // face east, into the yard
  state.combatants.push(player);
  for (const n of names.jackals) {
    const b = makeCombatant(id++, n, 'jackals', false, 'vk7');
    b.pos = { x: YARD.spawnJackals.x + rng.range(-2, 2), y: 0, z: YARD.spawnJackals.z + rng.range(-6, 6) };
    b.yaw = 0; // bots measure yaw from +x: 0 faces east, into the yard
    state.combatants.push(b);
  }
  for (const n of names.wardens) {
    const b = makeCombatant(id++, n, 'wardens', false, 'vk7');
    b.pos = { x: YARD.spawnWardens.x + rng.range(-2, 2), y: 0, z: YARD.spawnWardens.z + rng.range(-6, 6) };
    b.yaw = Math.PI; // faces west, into the yard
    state.combatants.push(b);
  }
  state.player = player;
  state.charge.holder = player;
  player.hasCharge = true;
  state.banner = { title: 'NIGHT FREIGHT', sub: 'Jackals attack — plant the charge at Gantry A or Signal B', at: 0, until: 4 };
  return state;
}

export function teamOf(state, team) {
  return state.combatants.filter((c) => c.team === team);
}
export function aliveOf(state, team) {
  return teamOf(state, team).filter((c) => c.alive);
}
export function phaseTimeLeft(state) {
  return Math.max(0, state.phaseUntil - state.time);
}

export function addKillfeed(state, text) {
  state.killfeed.push({ text, at: state.time });
  if (state.killfeed.length > 6) state.killfeed.shift();
}

export function setBanner(state, title, sub, seconds = 4) {
  state.banner = { title, sub, at: state.time, until: state.time + seconds };
}

// --- economy ---------------------------------------------------------------
export function lossBonus(streak) {
  // Escalating loss bonus: 1400, 1900, 2400, then 2900 for 4+ in a row.
  return Math.min(1400 + 500 * streak, 2900);
}

export function awardRound(state, winnerTeam, objective) {
  const loser = winnerTeam === 'jackals' ? 'wardens' : 'jackals';
  state.score[winnerTeam] += 1;
  state.lossStreak[winnerTeam] = 0;
  const streak = state.lossStreak[loser];
  for (const c of teamOf(state, winnerTeam)) {
    c.money += objective ? OBJECTIVE_REWARD : WIN_REWARD;
  }
  for (const c of teamOf(state, loser)) {
    c.money += lossBonus(streak);
  }
  state.lossStreak[loser] = streak + 1;
  state.roundWinner = winnerTeam;
}

// --- buying -----------------------------------------------------------------
export function buyPrice(state, c, kind, id) {
  if (kind === 'weapon') {
    if (c.weaponId === id) return -1; // already held
    return WEAPONS[id].price;
  }
  if (kind === 'kevlar') return c.kevlar ? -1 : GEAR.kevlar.price;
  if (kind === 'frag') return c.frags >= GEAR.frag.max ? -1 : GEAR.frag.price;
  if (kind === 'flash') return c.flashes >= GEAR.flash.max ? -1 : GEAR.flash.price;
  return -1;
}

export function buy(state, c, kind, id) {
  if (state.phase !== 'buy') return false;
  const price = buyPrice(state, c, kind, id);
  if (price < 0 || c.money < price) return false;
  c.money -= price;
  if (kind === 'weapon') {
    c.weaponId = id;
    c.ammo = freshAmmo(id);
  } else if (kind === 'kevlar') c.kevlar = true;
  else if (kind === 'frag') c.frags += 1;
  else if (kind === 'flash') c.flashes += 1;
  return true;
}

// --- rounds -----------------------------------------------------------------
export function startRound(state) {
  state.phase = 'buy';
  state.phaseUntil = state.time + BUY_SECONDS;
  state.plant = null;
  state.charge.dropped = null;
  state.grenades.length = 0;
  for (const c of state.combatants) {
    c.alive = true;
    c.health = 100;
    c.planting = 0;
    c.defusing = 0;
    c.flashUntil = 0;
    c.flashStrength = 0;
    c.bloom = 0;
    // dying strips you back to the sidearm; armour and grenades are lost.
    // A survivor keeps their loadout and just tops up ammunition.
    if (!c.survivedLastRound) {
      c.weaponId = 'p9';
      c.ammo = freshAmmo('p9');
      c.kevlar = false;
      c.frags = 0;
      c.flashes = 0;
    } else {
      c.ammo = freshAmmo(c.weaponId);
      c.ammo.reserve = WEAPONS[c.weaponId].reserve;
    }
    const spawn = c.team === 'jackals' ? YARD.spawnJackals : YARD.spawnWardens;
    c.pos = { x: spawn.x + state.rng.range(-2, 2), y: 0, z: spawn.z + state.rng.range(-6, 6) };
    c.yaw = c.team === 'jackals' ? 0 : Math.PI;
    c.hasCharge = false;
  }
  // the player aims with the camera (yaw from -z), so restore their yaw
  state.player.yaw = -Math.PI / 2;
  // the charge goes to a random living Jackal, player included
  const attackers = teamOf(state, 'jackals');
  const carrier = attackers[Math.floor(state.rng.next() * attackers.length)];
  carrier.hasCharge = true;
  state.charge.holder = carrier;
  state.roundWinner = null;
  setBanner(state, `ROUND ${state.round}`, state.round === 1 ? 'Buy phase — spend your $800' : 'Buy phase', 3);
}

export function startLive(state) {
  state.phase = 'live';
  state.phaseUntil = state.time + ROUND_SECONDS;
}

export function plantCharge(state, site) {
  state.plant = { site, plantedAt: state.time, fuseUntil: state.time + FUSE_SECONDS };
  state.phase = 'planted';
  state.phaseUntil = state.time + FUSE_SECONDS;
  const carrier = state.charge.holder;
  if (carrier) carrier.hasCharge = false;
  state.charge.holder = null;
  setBanner(state, 'CHARGE PLANTED', `Fuse running at ${site === 'A' ? 'Gantry A' : 'Signal B'} — ${FUSE_SECONDS}s`, 3);
}

export function endRound(state, winnerTeam, reason) {
  if (state.phase === 'ended' || state.phase === 'matchover') return;
  awardRound(state, winnerTeam, reason === 'detonation' || reason === 'elimination-objective');
  // who survived keeps their loadout into the next buy phase
  for (const c of state.combatants) c.survivedLastRound = c.alive;
  state.phase = 'ended';
  state.phaseUntil = state.time + 4.5;
  const label = winnerTeam === 'jackals' ? 'JACKALS WIN THE ROUND' : 'WARDENS WIN THE ROUND';
  setBanner(state, label, reasonText(reason), 4.5);
  if (state.score[winnerTeam] >= WIN_ROUNDS) {
    state.winner = winnerTeam;
    state.phase = 'matchover';
    state.phaseUntil = state.time + 9999;
    setBanner(state, winnerTeam === 'jackals' ? 'JACKALS TAKE THE YARD' : 'WARDENS HOLD THE YARD',
      `Final score ${state.score.jackals} — ${state.score.wardens}`, 9999);
  }
}

function reasonText(reason) {
  switch (reason) {
    case 'elimination': return 'Enemy team eliminated';
    case 'detonation': return 'The charge went off';
    case 'defuse': return 'Charge defused';
    case 'time': return 'Time expired — defenders hold';
    case 'elimination-objective': return 'Attackers eliminated after the plant';
    default: return reason;
  }
}

export function nextRound(state) {
  state.round += 1;
  startRound(state);
}

// Damage one combatant; returns 'killed' when it drops them.
export function damage(state, target, amount, attacker, hitPart) {
  if (!target.alive) return null;
  let dmg = amount;
  if (target.kevlar) dmg *= 1 - GEAR.kevlar.absorb * 0.5;
  target.health -= dmg;
  if (target.health > 0) return 'hit';
  target.health = 0;
  target.alive = false;
  target.deaths += 1;
  if (attacker) {
    attacker.kills += 1;
    attacker.money += KILL_REWARD;
  }
  const part = hitPart === 'head' ? ' (headshot)' : '';
  addKillfeed(state, `${attacker ? attacker.name : '—'} ▸ ${target.name}${part}`);
  // the charge drops where its carrier falls
  if (target.hasCharge) {
    target.hasCharge = false;
    state.charge.holder = null;
    state.charge.dropped = { x: target.pos.x, z: target.pos.z };
  }
  return 'killed';
}
