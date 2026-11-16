// Night Freight — bootstrap, fixed-step simulation and rendering.
// The sim runs at a fixed 60 Hz, apart from rendering: update() never creates
// objects in its hot loops (tracers and grenades reuse pooled arrays), and all
// match state lives in the state module. Rendering is three.js from the
// vendored module, nothing fetched over the network.
import * as THREE from 'three';
import { makeRng } from './rng.js';
import { buildWorld } from './world.js';
import { newMatch, startLive, endRound, nextRound, aliveOf, buy, setBanner, WIN_ROUNDS, BUY_SECONDS } from './state.js';
import { initBots, updateBot } from './bots.js';
import { makeInput, bindInput, updatePlayer, updateGrenades, eyePos } from './player.js';
import { buildHud, updateHud, showHitmarker } from './hud.js';
import { playSound, setMuted } from './audio.js';
import { WEAPONS } from './weapons.js';

const STEP = 1 / 60;
const params = new URLSearchParams(window.location.search);
const SHOT = params.get('shot'); // start | play | end | null
const SEED = Number(params.get('seed') || '1');
window.__shotMode = SHOT || null;

const canvas = document.getElementById('game');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(78, window.innerWidth / window.innerHeight, 0.1, 300);
camera.rotation.order = 'YXZ';

buildWorld(scene);

// --- combatant meshes -------------------------------------------------------
const TEAM_COLORS = { jackals: 0xc96a2e, wardens: 0x2e9d8f };
const bodyGeo = new THREE.BoxGeometry(0.62, 1.05, 0.36);
const headGeo = new THREE.SphereGeometry(0.27, 12, 10);
const gunGeo = new THREE.BoxGeometry(0.09, 0.12, 0.85);
const legGeo = new THREE.BoxGeometry(0.22, 0.55, 0.26);
const chargeGeo = new THREE.BoxGeometry(0.4, 0.3, 0.22);
const hitMeshes = []; // raycast targets: { mesh, target, part }
const worldMeshes = []; // occluders for shots
scene.traverse((o) => { if (o.isMesh) worldMeshes.push(o); });

function makeFighterMesh(c) {
  const color = TEAM_COLORS[c.team];
  const mat = new THREE.MeshStandardMaterial({ color, roughness: 0.7, metalness: 0.2 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x22242a, roughness: 0.8 });
  const g = new THREE.Group();
  const body = new THREE.Mesh(bodyGeo, mat);
  body.position.y = 1.0;
  body.castShadow = true;
  body.userData = { target: c, part: 'body' };
  const head = new THREE.Mesh(headGeo, new THREE.MeshStandardMaterial({ color: 0xd9a986, roughness: 0.6 }));
  head.position.y = 1.68;
  head.userData = { target: c, part: 'head' };
  const visor = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.1, 0.05),
    new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0.7 }));
  visor.position.set(0, 1.7, -0.24);
  const gun = new THREE.Mesh(gunGeo, dark);
  gun.position.set(0.28, 1.25, -0.4);
  const legL = new THREE.Mesh(legGeo, dark);
  legL.position.set(-0.16, 0.28, 0);
  const legR = new THREE.Mesh(legGeo, dark);
  legR.position.set(0.16, 0.28, 0);
  // team stripe on the chest so teams read at a glance
  const stripe = new THREE.Mesh(new THREE.BoxGeometry(0.64, 0.14, 0.02), new THREE.MeshBasicMaterial({ color }));
  stripe.position.set(0, 1.15, -0.19);
  g.add(body, head, visor, gun, legL, legR, stripe);
  if (c.hasCharge) {
    const pack = new THREE.Mesh(chargeGeo, new THREE.MeshStandardMaterial({ color: 0xffc93c, emissive: 0x996600, roughness: 0.4 }));
    pack.position.set(0, 1.05, 0.24);
    pack.name = 'charge-pack';
    g.add(pack);
  }
  g.visible = false;
  scene.add(g);
  hitMeshes.push(body, head);
  return g;
}

// --- state ------------------------------------------------------------------
const rng = makeRng(SHOT ? SEED : (Date.now() % 2147483647));
const state = newMatch(rng);
initBots(state);
const meshes = new Map();
for (const c of state.combatants) meshes.set(c.id, makeFighterMesh(c));
state.playerMesh = meshes.get(state.player.id);

const input = makeInput();
const hud = buildHud(document);
let adsHeld = false;
const api = {
  get adsHeld() { return adsHeld; },
  buy(kind, id) {
    return buy(state, state.player, kind, id);
  },
  onHitMarker(head) { showHitmarker(hud, head); },
  onGrenadeThrown() {},
  onExplosion(g) { spawnExplosion(g); },
  onFlash(g) { spawnFlashSprite(g); },
  addTracer(from, dir, color) {
    addTracer(from, dir, color);
  },
};

bindInput(input, canvas, (locked) => {
  if (!locked) input.buyOpen = false;
  if (locked) hud.startScreen.style.display = 'none';
});
hud.playBtn.addEventListener('click', () => {
  canvas.requestPointerLock();
  hud.startScreen.style.display = 'none';
});
hud.againBtn.addEventListener('click', () => window.location.reload());
document.addEventListener('mousedown', (e) => { if (e.button === 2) adsHeld = true; });
document.addEventListener('mouseup', (e) => { if (e.button === 2) adsHeld = false; });
document.addEventListener('keydown', (e) => {
  if (e.code === 'KeyM') { mutedFlag = !mutedFlag; setMuted(mutedFlag); }
});
let mutedFlag = false;

// buy menu clicks
hud.buymenu.addEventListener('click', (e) => {
  const row = e.target.closest('.buyrow');
  if (!row) return;
  const [kind, id] = row.dataset.buy.split(':');
  if (api.buy(kind, id)) playSound('buy');
});

// --- tracers, explosions ----------------------------------------------------
const tracerPool = [];
const tracerMat = new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.9 });
function addTracer(from, dir, color) {
  const to = from.clone().add(dir.clone().multiplyScalar(60));
  // shorten the tracer at the first world hit so it never crosses walls
  const rc = new THREE.Raycaster(from, dir, 0.1, 90);
  const hits = rc.intersectObjects(worldMeshes, false);
  const end = hits.length ? hits[0].point : to;
  const geo = new THREE.BufferGeometry().setFromPoints([from, end]);
  const mat = tracerMat.clone();
  mat.color.setHex(color);
  const line = new THREE.Line(geo, mat);
  scene.add(line);
  tracerPool.push({ line, until: state.time + 0.07 });
}

const explosionSprites = [];
function spawnExplosion(g) {
  const mat = new THREE.MeshBasicMaterial({ color: 0xffa63c, transparent: true, opacity: 0.9 });
  const s = new THREE.Mesh(new THREE.SphereGeometry(1, 12, 10), mat);
  s.position.set(g.x, Math.max(0.6, g.y), g.z);
  scene.add(s);
  explosionSprites.push({ mesh: s, until: state.time + 0.5, size: 1 });
  const light = new THREE.PointLight(0xff8c2e, 600, 25, 1.6);
  light.position.copy(s.position);
  scene.add(light);
  explosionSprites.push({ mesh: light, until: state.time + 0.4, size: 0, isLight: true });
}

function spawnFlashSprite(g) {
  const mat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.95 });
  const s = new THREE.Mesh(new THREE.SphereGeometry(0.5, 10, 8), mat);
  s.position.set(g.x, g.y, g.z);
  scene.add(s);
  explosionSprites.push({ mesh: s, until: state.time + 0.25, size: 0.5 });
}

// --- shooting raycast -------------------------------------------------------
const raycaster = new THREE.Raycaster();
const _eye = new THREE.Vector3();
function raycastShot(eye, dir) {
  raycaster.set(eye, dir);
  raycaster.far = 120;
  const hits = raycaster.intersectObjects(hitMeshes, false);
  const wall = raycaster.intersectObjects(worldMeshes, false);
  const wallDist = wall.length ? wall[0].distance : Infinity;
  for (const h of hits) {
    if (h.distance > wallDist) break; // a wall is in the way
    if (!h.object.userData.target.alive) continue;
    return { target: h.object.userData.target, part: h.object.userData.part, distance: h.distance, point: h.point };
  }
  return null;
}
const shotWorld = { raycastShot };
api.raycastWorld = shotWorld;

// --- charge marker ----------------------------------------------------------
const chargeMarker = new THREE.Mesh(
  new THREE.OctahedronGeometry(0.35),
  new THREE.MeshStandardMaterial({ color: 0xffc93c, emissive: 0x996600, emissiveIntensity: 0.9 }),
);
chargeMarker.visible = false;
scene.add(chargeMarker);

// --- fixed-step simulation --------------------------------------------------
let acc = 0;
let last = performance.now();
let frames = 0;

function step(dt) {
  state.time += dt;
  const p = state.player;

  // phase transitions
  if (state.phase === 'buy' && state.time >= state.phaseUntil) {
    startLive(state);
    setBanner(state, 'ROUND LIVE', 'Plant the charge or eliminate the Wardens', 2.5);
  } else if (state.phase === 'ended' && state.time >= state.phaseUntil) {
    if (state.winner) { state.phase = 'matchover'; }
    else nextRound(state);
  }

  // live phase timers and win checks
  if (state.phase === 'live' || state.phase === 'planted') {
    if (state.phase === 'live' && state.time >= state.phaseUntil) {
      endRound(state, 'wardens', 'time');
      playSound('round-lose');
    } else if (state.phase === 'planted' && state.time >= state.phaseUntil) {
      endRound(state, 'jackals', 'detonation');
      playSound('explosion');
      playSound('round-win');
    } else {
      const jAlive = aliveOf(state, 'jackals').length;
      const wAlive = aliveOf(state, 'wardens').length;
      if (jAlive === 0 && wAlive === 0) endRound(state, 'wardens', 'elimination');
      else if (jAlive === 0) endRound(state, 'wardens', 'elimination');
      else if (wAlive === 0) endRound(state, 'jackals', state.plant ? 'elimination-objective' : 'elimination');
    }
    if (state.phase === 'ended' && state.roundWinner) {
      playSound(state.roundWinner === 'jackals' ? 'round-win' : 'round-lose');
    }
  }

  // player + bots (in shot modes the player stands still for the frame)
  if (p.alive) updatePlayer(state, p, input, dt, shotWorld, api);
  for (const c of state.combatants) {
    if (!c.isPlayer && c.alive) updateBot(state, c, dt);
  }
  updateGrenades(state, dt, api);

  // tracers and explosion sprites expire
  for (let i = tracerPool.length - 1; i >= 0; i -= 1) {
    if (state.time >= tracerPool[i].until) {
      scene.remove(tracerPool[i].line);
      tracerPool[i].line.geometry.dispose();
      tracerPool[i].line.material.dispose();
      tracerPool.splice(i, 1);
    }
  }
  for (let i = explosionSprites.length - 1; i >= 0; i -= 1) {
    const s = explosionSprites[i];
    if (state.time >= s.until) {
      scene.remove(s.mesh);
      if (s.mesh.material) s.mesh.material.dispose();
      explosionSprites.splice(i, 1);
    } else if (!s.isLight) {
      const k = 1 + (state.time - (s.until - 0.5)) * 6;
      s.mesh.scale.setScalar(Math.max(0.1, s.size * k));
      s.mesh.material.opacity = Math.max(0, 0.9 - k * 0.18);
    }
  }
}

// --- camera + fighter sync --------------------------------------------------
const spectateTarget = { x: 0, z: 0 };
function syncScene() {
  const p = state.player;
  for (const c of state.combatants) {
    const g = meshes.get(c.id);
    if (!g) continue;
    g.visible = c.alive && !(c.isPlayer && !SHOT);
    if (!c.alive) continue;
    g.position.set(c.pos.x, 0, c.pos.z);
    // Bot yaw is measured from +x (forward = cos yaw, -sin yaw); the model
    // faces -z, so its rotation is yaw - PI/2.
    g.rotation.y = c.yaw - Math.PI / 2;
    // charge pack appears on whoever carries it
    const pack = g.getObjectByName('charge-pack');
    if (pack) pack.visible = c.hasCharge;
    // crouch squash
    g.scale.y = c.crouched ? 0.72 : 1;
  }
  // dropped charge marker
  if (state.charge.dropped) {
    chargeMarker.visible = true;
    chargeMarker.position.set(state.charge.dropped.x, 0.6 + Math.sin(state.time * 3) * 0.12, state.charge.dropped.z);
    chargeMarker.rotation.y = state.time * 1.5;
  } else {
    chargeMarker.visible = false;
  }
  // camera
  if (SHOT) {
    // deterministic shot cameras are set once in setupShot()
  } else if (p.alive) {
    camera.position.set(p.pos.x, p.crouched ? 1.05 : 1.62, p.pos.z);
    camera.rotation.set(p.pitch, p.yaw, 0);
    if (p.ads) camera.fov = WEAPONS[p.weaponId].scoped ? 32 : 55;
    else camera.fov = 78;
    camera.updateProjectionMatrix();
  } else {
    // spectate orbit around a living teammate
    const mate = state.combatants.find((c) => c.alive && c.team === p.team && !c.isPlayer)
      || state.combatants.find((c) => c.alive);
    if (mate) {
      spectateTarget.x = mate.pos.x;
      spectateTarget.z = mate.pos.z;
      const a = state.time * 0.45;
      camera.position.set(mate.pos.x + Math.cos(a) * 7, 4.2, mate.pos.z + Math.sin(a) * 7);
      camera.lookAt(mate.pos.x, 1.4, mate.pos.z);
      camera.fov = 62;
      camera.updateProjectionMatrix();
    }
  }
}

// --- deterministic screenshot modes -----------------------------------------
function setupShot() {
  if (!SHOT) return;
  const p = state.player;
  if (SHOT === 'start') {
    // buy phase at the Jackals spawn, looking down the yard
    state.phase = 'buy';
    state.phaseUntil = state.time + BUY_SECONDS;
    p.pos = { x: -40, y: 0, z: 0 };
    p.yaw = -Math.PI / 2; p.pitch = 0.02;
    camera.position.set(p.pos.x, 1.62, p.pos.z);
    camera.rotation.set(p.pitch, p.yaw, 0);
    hud.startScreen.style.display = 'none';
  } else if (SHOT === 'play') {
    // mid-round: run the sim forward 9 seconds so bots spread into the lanes,
    // then freeze with the player mid-yard aiming at a Warden.
    state.phase = 'live';
    state.phaseUntil = state.time + 100;
    for (let i = 0; i < 9 * 60; i += 1) step(STEP);
    p.pos = { x: -2, y: 0, z: -8 };
    p.yaw = -Math.PI / 2 + 0.35; p.pitch = -0.01;
    p.weaponId = 'vk7';
    p.ammo = { mag: 24, reserve: 90, reloading: false, reloadUntil: 0 };
    camera.position.set(p.pos.x, 1.62, p.pos.z);
    camera.rotation.set(p.pitch, p.yaw, 0);
    addTracer(eyePos(p), new THREE.Vector3(0, 0, -1).applyEuler(camera.rotation), 0xffe9a8);
    hud.startScreen.style.display = 'none';
  } else if (SHOT === 'end') {
    // match point won: banner over the yard from the Gantry A site
    state.score.jackals = WIN_ROUNDS;
    state.score.wardens = 3;
    state.round = 8;
    state.winner = 'jackals';
    state.phase = 'matchover';
    state.phaseUntil = state.time + 9999;
    state.banner = { title: 'JACKALS TAKE THE YARD', sub: 'Final score 5 — 3 · Night Freight', at: state.time, until: state.time + 9999 };
    p.pos = { x: 20, y: 0, z: -18 };
    p.yaw = -Math.PI / 2 - 0.4; p.pitch = 0.05;
    p.alive = true; p.health = 64;
    camera.position.set(p.pos.x, 1.62, p.pos.z);
    camera.rotation.set(p.pitch, p.yaw, 0);
    hud.startScreen.style.display = 'none';
  }
  syncScene();
  updateHud(hud, state, input);
  renderer.render(scene, camera);
  window.__shotReady = true;
}

// --- main loop ----------------------------------------------------------------
function frame(now) {
  requestAnimationFrame(frame);
  const dtMs = Math.min(100, now - last);
  last = now;
  if (SHOT) {
    if (frames === 0) setupShot();
    frames += 1;
    if (frames < 3) renderer.render(scene, camera);
    return;
  }
  acc += dtMs / 1000;
  let n = 0;
  while (acc >= STEP && n < 5) { step(STEP); acc -= STEP; n += 1; }
  if (n === 5) acc = 0;
  syncScene();
  updateHud(hud, state, input);
  renderer.render(scene, camera);
  frames += 1;
}

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// In shot mode the game is frozen after setup; otherwise the loop runs.
if (SHOT) {
  requestAnimationFrame(frame);
} else {
  requestAnimationFrame(frame);
}
