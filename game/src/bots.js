// Night Freight — bot brains.
// Seven bots share one update: each has a role, a waypoint route, a reaction
// delay, and a small state machine (move / hold / fight / plant / defuse /
// guard / investigate). They see through line of sight, hear grenades and
// gunfire as noise, strafe while firing in bursts, and rotate between sites.
import { WAYPOINTS, nearestWaypoint, findRoute, losBlocked, collideCircle, YARD } from './world.js';
import { WEAPONS, currentSpread, pelletDamage } from './weapons.js';
import { damage, plantCharge, endRound, aliveOf, PLANT_SECONDS, DEFUSE_SECONDS } from './state.js';

const WALK_SPEED = 4.2;
const REACT_MIN = 0.35;
const REACT_MAX = 0.9;

export function initBots(state) {
  for (const c of state.combatants) {
    if (c.isPlayer) continue;
    c.bot = {
      role: c.team === 'jackals' ? 'attack' : 'defend',
      site: c.team === 'wardens' ? (c.name === 'Iris' || c.name === 'Bram' ? 'A' : 'B') : null,
      route: [],
      routeIdx: 0,
      targetSite: null,
      seen: null,        // { combatant, at } — last seen enemy
      reactUntil: 0,
      nextShotAt: 0,
      burstLeft: 0,
      strafeDir: 1,
      strafeUntil: 0,
      holdUntil: 0,
      holdPos: null,
      noise: null,       // { x, z, at }
      retargetAt: 0,
      thinkAt: 0,
    };
  }
  // attackers pick a site per round; defenders split across both sites
  assignAttackSites(state);
}

export function assignAttackSites(state) {
  // The Jackals push one site together: a split team arrives piecemeal and
  // dies to defenders holding in pairs, so the whole team commits to a site.
  const teamSite = state.rng.chance(0.5) ? 'A' : 'B';
  const attackers = state.combatants.filter((c) => !c.isPlayer && c.team === 'jackals');
  for (const b of attackers) {
    b.bot.targetSite = teamSite;
    b.bot.route = [];
    b.bot.routeIdx = 0;
    b.bot.routeDest = null;
  }
}

function sitePos(site) {
  return site === 'A' ? YARD.siteA : YARD.siteB;
}

function dist2d(ax, az, bx, bz) {
  const dx = ax - bx;
  const dz = az - bz;
  return Math.sqrt(dx * dx + dz * dz);
}

function nearestEnemy(state, bot) {
  let best = null;
  let bestD = Infinity;
  for (const e of state.combatants) {
    if (e.team === bot.team || !e.alive) continue;
    const d = dist2d(bot.pos.x, bot.pos.z, e.pos.x, e.pos.z);
    if (d < bestD) { bestD = d; best = e; }
  }
  return best ? { enemy: best, dist: bestD } : null;
}

function canSee(bot, enemy) {
  const d = dist2d(bot.pos.x, bot.pos.z, enemy.pos.x, enemy.pos.z);
  if (d > 42) return false;
  return !losBlocked(bot.pos.x, bot.pos.z, enemy.pos.x, enemy.pos.z, 1.6);
}

// Turn the bot's yaw toward a point, capped by a turn rate.
function turnToward(bot, tx, tz, dt, rate = 5.5) {
  const want = Math.atan2(-(tz - bot.pos.z), tx - bot.pos.x);
  let diff = want - bot.yaw;
  while (diff > Math.PI) diff -= Math.PI * 2;
  while (diff < -Math.PI) diff += Math.PI * 2;
  const step = Math.max(-rate * dt, Math.min(rate * dt, diff));
  bot.yaw += step;
  return Math.abs(diff) < 0.12;
}

function walkAlongRoute(state, bot, dt, speed = WALK_SPEED) {
  const b = bot.bot;
  if (!b.route.length || b.routeIdx >= b.route.length) {
    b.route = [];
    b.routeIdx = 0;
    return true;
  }
  const wp = b.route[b.routeIdx];
  const d = dist2d(bot.pos.x, bot.pos.z, wp.x, wp.z);
  if (d < 1.2) { b.routeIdx += 1; return b.routeIdx >= b.route.length; }
  turnToward(bot, wp.x, wp.z, dt);
  const fx = Math.cos(bot.yaw);
  const fz = -Math.sin(bot.yaw);
  bot.pos.x += fx * speed * dt;
  bot.pos.z += fz * speed * dt;
  bot.moving = true;
  collideCircle(bot.pos, 0.45);
  return false;
}

function routeTo(state, bot, tx, tz) {
  const b = bot.bot;
  const dest = `${tx.toFixed(0)},${tz.toFixed(0)}`;
  if (b.routeDest === dest && b.route.length && b.routeIdx < b.route.length) return;
  b.routeDest = dest;
  const from = nearestWaypoint(bot.pos.x, bot.pos.z);
  const to = nearestWaypoint(tx, tz);
  const ids = findRoute(from, to);
  b.route = ids.map((id) => WAYPOINTS[id]);
  b.routeIdx = 0;
}

// Fire one hitscan burst at the bot's current target.
function botShoot(state, bot, enemy, dt) {
  const b = bot.bot;
  const w = WEAPONS[bot.weaponId];
  const now = state.time;
  if (now < b.nextShotAt) return;
  if (b.burstLeft <= 0) {
    if (now < b.reactUntil) return;
    b.burstLeft = bot.weaponId === 'mule' ? 1 : (bot.weaponId === 'longshot' ? 1 : 3 + Math.floor(state.rng.next() * 3));
    b.nextShotAt = now + 0.25 + state.rng.next() * 0.5;
    return;
  }
  if (bot.ammo.mag <= 0) {
    bot.ammo.mag = w.mag;
    bot.ammo.reserve = Math.max(0, bot.ammo.reserve - w.mag);
    b.nextShotAt = now + w.reloadMs / 1000;
    b.burstLeft = 0;
    return;
  }
  bot.ammo.mag -= 1;
  b.burstLeft -= 1;
  b.nextShotAt = now + 60 / w.rpm;
  const d = dist2d(bot.pos.x, bot.pos.z, enemy.pos.x, enemy.pos.z);
  // Aim error shrinks with reaction time and grows with distance and spread;
  // bots are marksmen up close and spray at range, so closing distance pays.
  const spread = currentSpread(w, { moving: bot.moving, crouched: false, ads: false, bloom: bot.bloom, grounded: true });
  const aimErr = spread * 2 + d * 0.004;
  let hitChance = Math.max(0.15, 0.85 - aimErr * 2 - d * 0.006);
  // A planter crouched over the charge is a smaller, harder target.
  if (enemy.planting > 0) hitChance *= 0.75;
  // A defender standing still on a held site shoots steadier than anyone
  // moving through the open.
  if (bot.team === 'wardens' && !bot.moving) hitChance = Math.min(0.9, hitChance + 0.04);
  const from = { x: bot.pos.x, y: 1.55, z: bot.pos.z };
  const aimX = enemy.pos.x + (state.rng.next() - 0.5) * aimErr * d * 2;
  const aimZ = enemy.pos.z + (state.rng.next() - 0.5) * aimErr * d * 2;
  state.tracers.push({
    from, to: { x: aimX, y: 1.2, z: aimZ }, until: now + 0.07, color: w.tracer,
  });
  if (state.rng.next() > hitChance) return; // the shot misses outright
  const head = state.rng.next() < 0.14;
  const dmg = pelletDamage(w, d) * (head ? w.headMult : 1);
  const res = damage(state, enemy, dmg, bot, head ? 'head' : 'body');
  if (res === 'killed') { b.seen = null; b.burstLeft = 0; }
}

export function hearNoise(state, x, z) {
  for (const c of state.combatants) {
    if (c.isPlayer || !c.alive || !c.bot) continue;
    const d = dist2d(c.pos.x, c.pos.z, x, z);
    if (d < 30) c.bot.noise = { x, z, at: state.time };
  }
}

export function updateBot(state, bot, dt) {
  const b = bot.bot;
  if (!bot.alive) return;
  bot.moving = false;
  bot.bloom = Math.max(0, bot.bloom - dt * 0.6);
  if (state.phase === 'buy') {
    // idle shuffle at spawn; defenders drift toward their site
    if (bot.team === 'wardens' && state.time > 2 && !b.route.length) {
      const s = sitePos(b.site);
      routeTo(state, bot, s.x, s.z);
    }
    if (b.route.length) walkAlongRoute(state, bot, dt, WALK_SPEED * 0.6);
    return;
  }
  if (state.phase === 'ended' || state.phase === 'matchover') return;

  // --- perception: nearest visible enemy, with a reaction delay
  const found = nearestEnemy(state, bot);
  if (found && canSee(bot, found.enemy)) {
    if (!b.seen || b.seen.combatant !== found.enemy) {
      b.seen = { combatant: found.enemy, at: state.time };
      // Defenders holding a site react a touch faster than attackers on the
      // move: a push into a held site should cost the attackers.
      const reactMin = bot.team === 'wardens' ? 0.22 : REACT_MIN;
      const reactMax = bot.team === 'wardens' ? 0.6 : REACT_MAX;
      b.reactUntil = state.time + reactMin + state.rng.next() * (reactMax - reactMin);
      b.burstLeft = 0;
    }
  } else if (b.seen && state.time - b.seen.at > 2.5) {
    b.seen = null;
  }

  const now = state.time;
  const flashed = now < bot.flashUntil;

  // --- plant / defuse take priority over fighting
  if (state.phase === 'planted' && bot.team === 'wardens') {
    const s = sitePos(state.plant.site);
    const d = dist2d(bot.pos.x, bot.pos.z, s.x, s.z);
    if (d > 2.5) {
      if (!b.route.length) routeTo(state, bot, s.x, s.z);
      walkAlongRoute(state, bot, dt);
    } else if (!flashed) {
      bot.defusing += dt;
      turnToward(bot, s.x, s.z, dt);
      if (bot.defusing >= DEFUSE_SECONDS) {
        endRound(state, 'wardens', 'defuse');
        return;
      }
    }
    if (b.seen && now >= b.reactUntil && !flashed) botShoot(state, bot, b.seen.combatant, dt);
    return;
  }

  if (bot.team === 'jackals' && state.phase === 'live' && !state.plant) {
    // pick up a dropped charge
    if (state.charge.dropped && !state.charge.holder) {
      const d = dist2d(bot.pos.x, bot.pos.z, state.charge.dropped.x, state.charge.dropped.z);
      if (d < 1.6) {
        state.charge.dropped = null;
        state.charge.holder = bot;
        bot.hasCharge = true;
      } else if (!b.route.length) routeTo(state, bot, state.charge.dropped.x, state.charge.dropped.z);
    }
    // carrier plants when inside its site (near the edge is close enough)
    if (bot.hasCharge && b.targetSite) {
      const s = sitePos(b.targetSite);
      const d = dist2d(bot.pos.x, bot.pos.z, s.x, s.z);
      if (d < s.r * 0.85) {
        bot.planting += dt;
        if (bot.planting >= PLANT_SECONDS) {
          plantCharge(state, b.targetSite);
          bot.planting = 0;
          return;
        }
      } else {
        bot.planting = 0;
        // Let an escort lead into the site: the carrier holds just outside
        // the last stretch while defenders hold the site, and only pushes
        // in once a teammate is closer to the site — or after waiting 8 s,
        // when waiting itself becomes the losing play.
        const defendersNear = aliveOf(state, 'wardens').some((w) => dist2d(w.pos.x, w.pos.z, s.x, s.z) < 15);
        const escortAhead = state.combatants.some((c) => c.team === 'jackals' && c !== bot && c.alive
          && dist2d(c.pos.x, c.pos.z, s.x, s.z) < d - 2);
        if (d < 12 && defendersNear && !escortAhead) {
          if (!b.holdSince) b.holdSince = now;
          if (now - b.holdSince < 8) {
            turnToward(bot, s.x, s.z, dt);
            if (b.seen && b.seen.combatant.alive && now >= b.reactUntil && !flashed) {
              botShoot(state, bot, b.seen.combatant, dt);
            }
            return;
          }
        } else {
          b.holdSince = 0;
        }
        if (!b.route.length) routeTo(state, bot, s.x, s.z);
        walkAlongRoute(state, bot, dt);
      }
      if (b.seen && now >= b.reactUntil && !flashed) botShoot(state, bot, b.seen.combatant, dt);
      return;
    }
  }

  // --- recovering a dropped charge beats fighting for it: a Jackal near the
  // drop walks to it even while an enemy is visible (and still shoots).
  if (bot.team === 'jackals' && state.phase === 'live' && !state.plant
    && state.charge.dropped && !state.charge.holder) {
    const dd = dist2d(bot.pos.x, bot.pos.z, state.charge.dropped.x, state.charge.dropped.z);
    if (dd < 25) {
      if (dd < 1.6) {
        state.charge.dropped = null;
        state.charge.holder = bot;
        bot.hasCharge = true;
      } else {
        if (!b.route.length) routeTo(state, bot, state.charge.dropped.x, state.charge.dropped.z);
        walkAlongRoute(state, bot, dt);
      }
      if (b.seen && b.seen.combatant.alive && now >= b.reactUntil && !flashed) {
        botShoot(state, bot, b.seen.combatant, dt);
      }
      return;
    }
  }

  // --- combat: face the seen enemy, strafe, burst fire
  if (b.seen && b.seen.combatant.alive && !flashed) {
    const e = b.seen.combatant;
    const d = dist2d(bot.pos.x, bot.pos.z, e.pos.x, e.pos.z);
    turnToward(bot, e.pos.x, e.pos.z, dt);
    if (now >= b.reactUntil) botShoot(state, bot, e, dt);
    // Cover a planting teammate: push into the site instead of strafing in
    // place, so the defenders have to split their fire off the planter.
    const planter = state.combatants.find((c) => c.team === 'jackals' && c.planting > 0 && c !== bot);
    if (planter) {
      const s = sitePos(planter.bot?.targetSite || 'A');
      if (dist2d(bot.pos.x, bot.pos.z, s.x, s.z) > s.r) {
        if (!b.route.length) routeTo(state, bot, s.x, s.z);
        walkAlongRoute(state, bot, dt);
        return;
      }
    }
    // strafe sideways while fighting, reversing at walls or on a timer
    if (now > b.strafeUntil) {
      b.strafeDir = state.rng.chance(0.5) ? 1 : -1;
      b.strafeUntil = now + 0.6 + state.rng.next() * 0.9;
    }
    if (d > 10) {
      bot.pos.x += Math.cos(bot.yaw) * WALK_SPEED * 0.55 * dt;
      bot.pos.z += -Math.sin(bot.yaw) * WALK_SPEED * 0.55 * dt;
    } else {
      const sx = Math.sin(bot.yaw) * b.strafeDir;
      const sz = Math.cos(bot.yaw) * b.strafeDir;
      bot.pos.x += sx * 2.4 * dt;
      bot.pos.z += sz * 2.4 * dt;
    }
    bot.moving = true;
    collideCircle(bot.pos, 0.45);
    return;
  }

  // --- no contact: follow the role
  if (b.noise && now - b.noise.at < 4) {
    const d = dist2d(bot.pos.x, bot.pos.z, b.noise.x, b.noise.z);
    if (d > 2) {
      if (!b.route.length) routeTo(state, bot, b.noise.x, b.noise.z);
      walkAlongRoute(state, bot, dt);
      if (d < 3) b.noise = null;
      return;
    }
    b.noise = null;
  }
  if (bot.team === 'wardens') {
    // hold near the assigned site, peeking the lanes on a slow timer
    const s = sitePos(b.site);
    const d = dist2d(bot.pos.x, bot.pos.z, s.x, s.z);
    if (d > 7) {
      if (!b.route.length) routeTo(state, bot, s.x, s.z);
      walkAlongRoute(state, bot, dt);
    } else {
      if (now > b.holdUntil) {
        b.holdUntil = now + 2 + state.rng.next() * 3;
        const lane = WAYPOINTS[Math.floor(state.rng.next() * WAYPOINTS.length)];
        b.holdPos = lane;
      }
      if (b.holdPos) turnToward(bot, b.holdPos.x, b.holdPos.z, dt, 1.2);
    }
    return;
  }
  // attackers push toward their site
  const s = sitePos(b.targetSite || 'A');
  const d = dist2d(bot.pos.x, bot.pos.z, s.x, s.z);
  if (d > s.r) {
    if (!b.route.length) routeTo(state, bot, s.x, s.z);
    walkAlongRoute(state, bot, dt);
  }
}
