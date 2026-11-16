// Night Freight — the player: pointer-lock mouse look, WASD movement with
// acceleration and crouching, hitscan shooting with spread/recoil, grenades,
// and the plant / defuse channel (hold E inside a site).
import * as THREE from 'three';
import { WEAPONS, currentSpread, pelletDamage } from './weapons.js';
import { collideCircle, losBlocked, YARD } from './world.js';
import { damage, plantCharge, PLANT_SECONDS } from './state.js';
import { playSound, unlockAudio } from './audio.js';
import { hearNoise } from './bots.js';

const EYE_STAND = 1.62;
const EYE_CROUCH = 1.05;
const RADIUS = 0.42;
const WALK_SPEED = 5.0;
const CROUCH_SPEED = 2.6;
const ADS_SPEED = 3.2;
const ACCEL = 42;

export function makeInput() {
  return {
    keys: new Set(),
    yawDelta: 0, pitchDelta: 0,
    mouseDown: false, mouseDownAt: 0,
    locked: false,
    buyOpen: false,
    plantHeld: false,
    queuedGrenade: null, // 'frag' | 'flash'
    queuedReload: false,
    queuedBuy: null,     // { kind, id }
  };
}

export function bindInput(input, canvas, onLockChange) {
  canvas.addEventListener('click', () => {
    unlockAudio();
    if (!input.locked && !window.__shotMode) canvas.requestPointerLock();
  });
  document.addEventListener('pointerlockchange', () => {
    input.locked = document.pointerLockElement === canvas;
    onLockChange(input.locked);
  });
  document.addEventListener('mousemove', (e) => {
    if (!input.locked) return;
    input.yawDelta -= e.movementX * 0.0022;
    input.pitchDelta -= e.movementY * 0.0022;
  });
  document.addEventListener('mousedown', (e) => {
    if (e.button === 0 && input.locked) { input.mouseDown = true; input.mouseDownAt = performance.now(); }
  });
  document.addEventListener('mouseup', (e) => {
    if (e.button === 0) input.mouseDown = false;
  });
  document.addEventListener('keydown', (e) => {
    if (e.repeat) return;
    input.keys.add(e.code);
    if (e.code === 'KeyR') input.queuedReload = true;
    if (e.code === 'KeyG') input.queuedGrenade = 'frag';
    if (e.code === 'KeyF') input.queuedGrenade = 'flash';
    if (e.code === 'KeyE') input.plantHeld = true;
    if (e.code === 'KeyB') input.buyOpen = !input.buyOpen;
    if (e.code === 'Digit1') input.queuedBuy = { kind: 'weapon', id: 'p9' };
    if (e.code === 'Digit2') input.queuedBuy = { kind: 'weapon', id: 'mule' };
    if (e.code === 'Digit3') input.queuedBuy = { kind: 'weapon', id: 'vk7' };
    if (e.code === 'Digit4') input.queuedBuy = { kind: 'weapon', id: 'longshot' };
    if (e.code === 'Digit5') input.queuedBuy = { kind: 'kevlar', id: 'kevlar' };
    if (e.code === 'Digit6') input.queuedBuy = { kind: 'frag', id: 'frag' };
    if (e.code === 'Digit7') input.queuedBuy = { kind: 'flash', id: 'flash' };
  });
  document.addEventListener('keyup', (e) => {
    input.keys.delete(e.code);
    if (e.code === 'KeyE') input.plantHeld = false;
  });
  document.addEventListener('contextmenu', (e) => {
    if (input.locked) e.preventDefault();
  });
}

// Per-frame player update. `world` carries the raycast targets and the meshes
// the renderer owns; `api` is the small set of callbacks main.js provides.
export function updatePlayer(state, player, input, dt, world, api) {
  const now = state.time;
  player.yaw += input.yawDelta;
  player.pitch = Math.max(-1.5, Math.min(1.5, player.pitch + input.pitchDelta));
  input.yawDelta = 0;
  input.pitchDelta = 0;

  const w = WEAPONS[player.weaponId];
  const crouched = input.keys.has('ControlLeft') || input.keys.has('KeyC');
  // Aim-down-sights is the right mouse button; a scoped weapon zooms further.
  player.ads = api.adsHeld;
  player.crouched = crouched;

  // --- movement with acceleration, then AABB collision
  const fwd = (input.keys.has('KeyW') ? 1 : 0) - (input.keys.has('KeyS') ? 1 : 0);
  const strafe = (input.keys.has('KeyD') ? 1 : 0) - (input.keys.has('KeyA') ? 1 : 0);
  const speed = crouched ? CROUCH_SPEED : (player.ads ? ADS_SPEED : WALK_SPEED);
  // Camera convention (three.js YXZ): forward is (-sin yaw, -cos yaw) and
  // right is (cos yaw, -sin yaw). W walks forward, D strafes right.
  const sin = Math.sin(player.yaw);
  const cos = Math.cos(player.yaw);
  let mx = (-sin * fwd + cos * strafe) * speed;
  let mz = (-cos * fwd - sin * strafe) * speed;
  const len = Math.hypot(mx, mz);
  if (len > speed) { mx = (mx / len) * speed; mz = (mz / len) * speed; }
  player.vel = player.vel || { x: 0, z: 0 };
  player.vel.x += (mx - player.vel.x) * Math.min(1, ACCEL * dt / speed);
  player.vel.z += (mz - player.vel.z) * Math.min(1, ACCEL * dt / speed);
  player.pos.x += player.vel.x * dt;
  player.pos.z += player.vel.z * dt;
  collideCircle(player.pos, RADIUS);
  player.moving = Math.hypot(player.vel.x, player.vel.z) > 0.6;
  if (player.moving && now - (player.lastStepAt || 0) > 0.45) {
    player.lastStepAt = now;
    playSound('step');
  }

  // --- reload
  if (input.queuedReload) {
    input.queuedReload = false;
    startReload(state, player);
  }
  if (player.ammo.reloading && now >= player.ammo.reloadUntil) {
    const need = w.mag - player.ammo.mag;
    const take = Math.min(need, player.ammo.reserve);
    player.ammo.mag += take;
    player.ammo.reserve -= take;
    player.ammo.reloading = false;
  }

  // --- firing (semi-auto fires on click, auto fires while held)
  const wantFire = w.auto ? input.mouseDown : (input.mouseDown && !input.mouseWasDown);
  input.mouseWasDown = input.mouseDown;
  if (wantFire && player.alive && state.phase !== 'buy' && state.phase !== 'ended') {
    fireWeapon(state, player, world, api);
  } else if (wantFire && player.alive && state.phase === 'buy') {
    playSound('dry');
  }

  // bloom decays when not firing
  player.bloom = Math.max(0, player.bloom - dt * 0.9);

  // --- grenades
  if (input.queuedGrenade) {
    const kind = input.queuedGrenade;
    input.queuedGrenade = null;
    throwGrenade(state, player, kind, api);
  }

  // --- plant / defuse channel
  updateObjectiveChannel(state, player, input, dt);

  // --- buy menu purchases queued by number keys
  if (input.queuedBuy) {
    const b = input.queuedBuy;
    input.queuedBuy = null;
    if (api.buy(b.kind, b.id)) playSound('buy');
  }

  // flash decay
  if (now > player.flashUntil) player.flashStrength = 0;
}

export function startReload(state, player) {
  const w = WEAPONS[player.weaponId];
  if (player.ammo.reloading) return;
  if (player.ammo.mag >= w.mag || player.ammo.reserve <= 0) return;
  player.ammo.reloading = true;
  player.ammo.reloadUntil = state.time + w.reloadMs / 1000;
  playSound('reload');
}

function fireWeapon(state, player, world, api) {
  const w = WEAPONS[player.weaponId];
  const now = state.time;
  if (player.ammo.reloading) return;
  if (now < (player.nextShotAt || 0)) return;
  if (player.ammo.mag <= 0) { playSound('dry'); startReload(state, player); return; }
  player.ammo.mag -= 1;
  player.nextShotAt = now + 60 / w.rpm;
  player.bloom = Math.min(1, player.bloom + 0.16);
  // recoil kicks the pitch up a touch
  player.pitch += w.kick * 0.0035;
  const sound = { p9: 'shot-pistol', mule: 'shot-shotgun', vk7: 'shot-rifle', longshot: 'shot-dmr' }[w.id];
  playSound(sound);
  hearNoise(state, player.pos.x, player.pos.z);

  const eye = eyePos(player);
  const spread = currentSpread(w, {
    moving: player.moving, crouched: player.crouched, ads: player.ads,
    bloom: player.bloom, grounded: true,
  });
  for (let p = 0; p < w.pellets; p += 1) {
    const dir = new THREE.Vector3(
      (Math.random() - 0.5) * 2 * spread,
      (Math.random() - 0.5) * 2 * spread,
      -1,
    ).applyEuler(new THREE.Euler(player.pitch, player.yaw, 0, 'YXZ')).normalize();
    const hit = world.raycastShot(eye, dir);
    if (hit) {
      const dist = hit.distance;
      const head = hit.part === 'head';
      const dmg = pelletDamage(w, dist) * (head ? w.headMult : 1);
      const res = damage(state, hit.target, dmg, player, head ? 'head' : 'body');
      playSound(res === 'killed' ? 'kill' : 'hit');
      api.onHitMarker(head);
    }
    api.addTracer(eye, dir, w.tracer);
  }
}

export function eyePos(player) {
  return new THREE.Vector3(
    player.pos.x,
    (player.crouched ? EYE_CROUCH : EYE_STAND),
    player.pos.z,
  );
}

function throwGrenade(state, player, kind, api) {
  if (kind === 'frag' && player.frags <= 0) return;
  if (kind === 'flash' && player.flashes <= 0) return;
  if (kind === 'frag') player.frags -= 1; else player.flashes -= 1;
  const dir = new THREE.Vector3(0, 0.25, -1).applyEuler(new THREE.Euler(player.pitch, player.yaw, 0, 'YXZ')).normalize();
  const eye = eyePos(player);
  const g = {
    kind, x: eye.x, y: eye.y, z: eye.z,
    vx: dir.x * 14, vy: dir.y * 14 + 2, vz: dir.z * 14,
    fuse: kind === 'frag' ? 1.6 : 0.9,
    bounced: false,
  };
  state.grenades.push(g);
  playSound('bounce');
  api.onGrenadeThrown(g);
}

export function updateGrenades(state, dt, api) {
  for (let i = state.grenades.length - 1; i >= 0; i -= 1) {
    const g = state.grenades[i];
    g.fuse -= dt;
    g.vy -= 12 * dt;
    g.x += g.vx * dt; g.y += g.vy * dt; g.z += g.vz * dt;
    if (g.y < 0.15) { g.y = 0.15; g.vy *= -0.35; g.vx *= 0.7; g.vz *= 0.7; if (!g.bounced) { playSound('bounce'); g.bounced = true; } }
    const probe = { x: g.x, y: g.y, z: g.z };
    collideCircle(probe, 0.2);
    g.x = probe.x; g.z = probe.z;
    if (g.fuse > 0) continue;
    state.grenades.splice(i, 1);
    if (g.kind === 'frag') {
      playSound('explosion');
      api.onExplosion(g);
      hearNoise(state, g.x, g.z);
      for (const c of state.combatants) {
        if (!c.alive) continue;
        const d = Math.hypot(c.pos.x - g.x, c.pos.z - g.z);
        if (d > 7) continue;
        const dmg = 95 * (1 - d / 7) + 10;
        if (losBlocked(g.x, g.z, c.pos.x, c.pos.z, 1.0)) continue;
        damage(state, c, dmg, state.player, 'body');
      }
    } else {
      playSound('flash');
      api.onFlash(g);
      for (const c of state.combatants) {
        if (!c.alive) continue;
        const d = Math.hypot(c.pos.x - g.x, c.pos.z - g.z);
        if (d > 26) continue;
        if (losBlocked(g.x, g.z, c.pos.x, c.pos.z, 1.5)) continue;
        const strength = Math.max(0, 1 - d / 26);
        c.flashUntil = state.time + 0.5 + strength * 2.2;
        c.flashStrength = strength;
      }
    }
  }
}

function siteContaining(x, z) {
  for (const key of ['A', 'B']) {
    const s = key === 'A' ? YARD.siteA : YARD.siteB;
    if (Math.hypot(x - s.x, z - s.z) <= s.r) return key;
  }
  return null;
}

function updateObjectiveChannel(state, player, input, dt) {
  const inSite = siteContaining(player.pos.x, player.pos.z);
  if (state.phase === 'live' && player.hasCharge && inSite && input.plantHeld && player.alive) {
    player.planting += dt;
    if (Math.floor(player.planting * 4) !== Math.floor((player.planting - dt) * 4)) playSound('plant-beep');
    if (player.planting >= PLANT_SECONDS) {
      plantCharge(state, inSite);
      playSound('plant-done');
      player.planting = 0;
    }
  } else {
    player.planting = 0;
  }
  // The player is always a Jackal (attacker), so defusing is a bot-only job;
  // a planted charge is defended, never defused by its own carrier.
  player.defusing = 0;
}
