// Night Freight — the freight yard: geometry, collision and the bot routes.
// An original map: a floodlit rail yard at night. Two rail lines cross a gravel
// yard; rows of shipping containers and a warehouse form three lanes (north past
// a tall gantry crane, mid through the warehouse, south along the yard edge) and
// two charge sites — Gantry A, a fuel gantry, and Signal B, a signal-tower yard.
// Collision is a flat list of axis-aligned boxes; bots walk a waypoint graph
// whose nodes sit in the open lanes, never inside a box.
import * as THREE from 'three';

export const YARD = {
  half: 46,            // yard extends x,z in [-46, 46]
  wallHeight: 5,
  spawnJackals: { x: -40, z: 0 },
  spawnWardens: { x: 40, z: 0 },
  siteA: { x: 26, z: -22, r: 5.5, name: 'Gantry A' },
  siteB: { x: 26, z: 22, r: 5.5, name: 'Signal B' },
  laneY: 1.7,          // eye height used by bots for line of sight
};

// Every solid box: { min:{x,z}, max:{x,z}, h } — y runs 0..h.
export const COLLIDERS = [];
function solid(cx, cz, w, d, h) {
  COLLIDERS.push({ min: { x: cx - w / 2, z: cz - d / 2 }, max: { x: cx + w / 2, z: cz + d / 2 }, h });
  return { cx, cz, w, d, h };
}

// Container rows and the warehouse, laid out once so geometry and collision agree.
const CONTAINERS = [
  // north lane containers (leave a gap at the crane, x ~ -6)
  { x: -30, z: -30, w: 12, d: 3, h: 2.6, c: 0x8a4a2b },
  { x: -16, z: -30, w: 12, d: 3, h: 2.6, c: 0x2e5d6b },
  { x: 2, z: -30, w: 12, d: 3, h: 2.6, c: 0x7a6a2f },
  { x: 16, z: -30, w: 12, d: 3, h: 2.6, c: 0x5d3a5e },
  { x: 30, z: -30, w: 10, d: 3, h: 2.6, c: 0x8a4a2b },
  // mid-field stacks
  { x: -24, z: -12, w: 6, d: 3, h: 2.6, c: 0x2e5d6b },
  { x: -24, z: -9, w: 6, d: 3, h: 5.2, c: 0x7a6a2f },
  { x: -8, z: -14, w: 12, d: 3, h: 2.6, c: 0x5d3a5e },
  { x: 8, z: -12, w: 6, d: 3, h: 2.6, c: 0x8a4a2b },
  { x: -10, z: 14, w: 12, d: 3, h: 2.6, c: 0x2e5d6b },
  { x: 6, z: 12, w: 6, d: 3, h: 5.2, c: 0x7a6a2f },
  { x: -28, z: 14, w: 8, d: 3, h: 2.6, c: 0x5d3a5e },
  // south lane containers
  { x: -30, z: 30, w: 12, d: 3, h: 2.6, c: 0x7a6a2f },
  { x: -16, z: 30, w: 12, d: 3, h: 2.6, c: 0x8a4a2b },
  { x: 2, z: 30, w: 12, d: 3, h: 2.6, c: 0x2e5d6b },
  { x: 16, z: 30, w: 12, d: 3, h: 2.6, c: 0x5d3a5e },
  { x: 30, z: 30, w: 10, d: 3, h: 2.6, c: 0x2e5d6b },
  // site props (low cover)
  { x: 22, z: -16, w: 4, d: 2, h: 1.2, c: 0x6b6f75 },
  { x: 30, z: -16, w: 4, d: 2, h: 1.2, c: 0x6b6f75 },
  { x: 22, z: 16, w: 4, d: 2, h: 1.2, c: 0x6b6f75 },
  { x: 30, z: 16, w: 4, d: 2, h: 1.2, c: 0x6b6f75 },
];

// The warehouse: a roofed hall across mid, open at both ends, walls with a
// wide doorway on each side so mid is a real lane, not a dead end.
const WAREHOUSE = { x: 0, z: 0, w: 18, d: 14, h: 6 };

function boxMat(color, rough = 0.85) {
  return new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: 0.25 });
}

export function buildWorld(scene) {
  const group = new THREE.Group();
  group.name = 'yard';
  scene.add(group);

  // Night sky, moon and yard lighting.
  scene.background = new THREE.Color(0x0a0f1e);
  scene.fog = new THREE.Fog(0x0a0f1e, 55, 130);
  const moon = new THREE.DirectionalLight(0x9fb8ff, 0.55);
  moon.position.set(-30, 48, -20);
  scene.add(moon);
  scene.add(new THREE.HemisphereLight(0x2a3550, 0x1a140f, 0.7));
  const floodPositions = [[-32, -20], [-8, 0], [16, -20], [32, 20], [0, 32], [-32, 24]];
  for (const [x, z] of floodPositions) {
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.16, 9, 6), boxMat(0x3a3f46, 0.6));
    pole.position.set(x, 4.5, z);
    group.add(pole);
    const lamp = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.5, 0.7), boxMat(0x222222, 0.4));
    lamp.position.set(x, 9.1, z);
    group.add(lamp);
    const light = new THREE.PointLight(0xffd9a0, 900, 42, 1.8);
    light.position.set(x, 8.8, z);
    scene.add(light);
    const glow = new THREE.Mesh(
      new THREE.PlaneGeometry(2.2, 1.1),
      new THREE.MeshBasicMaterial({ color: 0xffe6b0, transparent: true, opacity: 0.85, side: THREE.DoubleSide }),
    );
    glow.position.set(x, 8.9, z);
    glow.rotation.x = Math.PI / 2;
    group.add(glow);
  }

  // Gravel ground with two rail lines.
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(96, 96),
    new THREE.MeshStandardMaterial({ color: 0x3d3a35, roughness: 1, metalness: 0 }),
  );
  ground.rotation.x = -Math.PI / 2;
  group.add(ground);
  const railMat = new THREE.MeshStandardMaterial({ color: 0x8f9296, roughness: 0.35, metalness: 0.9 });
  const tieMat = boxMat(0x2c2118, 1);
  for (const z of [-6, 6]) {
    for (const x of [-1.4, 1.4]) {
      const rail = new THREE.Mesh(new THREE.BoxGeometry(92, 0.18, 0.18), railMat);
      rail.position.set(0, 0.12, z + x);
      group.add(rail);
    }
    for (let x = -45; x <= 45; x += 2.2) {
      const tie = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.08, 3.6), tieMat);
      tie.position.set(x, 0.05, z);
      group.add(tie);
    }
  }

  // Perimeter fence walls (also the collision boundary).
  const wallMat = boxMat(0x4a4d55, 0.9);
  const walls = [
    { w: 96, d: 0.6, x: 0, z: -47 }, { w: 96, d: 0.6, x: 0, z: 47 },
    { w: 0.6, d: 96, x: -47, z: 0 }, { w: 0.6, d: 96, x: 47, z: 0 },
  ];
  for (const wl of walls) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(wl.w, YARD.wallHeight, wl.d), wallMat);
    m.position.set(wl.x, YARD.wallHeight / 2, wl.z);
    group.add(m);
  }

  // Containers.
  for (const c of CONTAINERS) {
    solid(c.x, c.z, c.w, c.d, c.h);
    const m = new THREE.Mesh(new THREE.BoxGeometry(c.w, c.h, c.d), boxMat(c.c, 0.8));
    m.position.set(c.x, c.h / 2, c.z);
    m.castShadow = true;
    group.add(m);
    // corrugation ribs so the boxes read as containers, not slabs
    const rib = new THREE.Mesh(
      new THREE.BoxGeometry(c.w, c.h * 0.92, 0.08),
      new THREE.MeshStandardMaterial({ color: c.c, roughness: 0.7, metalness: 0.4 }),
    );
    rib.position.set(c.x, c.h / 2, c.z + c.d / 2 + 0.02);
    group.add(rib);
  }

  // Warehouse shell: two side walls with a doorway gap, back wall, roof.
  const wh = WAREHOUSE;
  const whMat = boxMat(0x5b6068, 0.85);
  const roofMat = boxMat(0x3c4048, 0.9);
  const mkWall = (w, d, x, z, y = wh.h / 2) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, wh.h, d), whMat);
    m.position.set(x, y, z);
    group.add(m);
    return m;
  };
  mkWall(wh.w, 0.5, wh.x, wh.z - wh.d / 2); // north wall
  mkWall(wh.w, 0.5, wh.x, wh.z + wh.d / 2); // south wall
  mkWall(0.5, 4, wh.x - wh.w / 2, wh.z - 5); // west wall, north segment
  mkWall(0.5, 4, wh.x - wh.w / 2, wh.z + 5); // west wall, south segment
  mkWall(0.5, 4, wh.x + wh.w / 2, wh.z - 5); // east wall, north segment
  mkWall(0.5, 4, wh.x + wh.w / 2, wh.z + 5); // east wall, south segment
  const roof = new THREE.Mesh(new THREE.BoxGeometry(wh.w + 1, 0.4, wh.d + 1), roofMat);
  roof.position.set(wh.x, wh.h + 0.2, wh.z);
  group.add(roof);
  // warehouse walls are colliders except for the two door gaps
  solid(wh.x, wh.z - wh.d / 2, wh.w, 0.5, wh.h);
  solid(wh.x, wh.z + wh.d / 2, wh.w, 0.5, wh.h);
  solid(wh.x - wh.w / 2, wh.z - 5, 0.5, 4, wh.h);
  solid(wh.x - wh.w / 2, wh.z + 5, 0.5, 4, wh.h);
  solid(wh.x + wh.w / 2, wh.z - 5, 0.5, 4, wh.h);
  solid(wh.x + wh.w / 2, wh.z + 5, 0.5, 4, wh.h);
  // crates inside the warehouse
  for (const [x, z, s] of [[-5, -3, 1.6], [4, 3, 1.8], [-4, 4, 1.2], [5, -4, 1.4]]) {
    solid(x, z, s, s, s);
    const m = new THREE.Mesh(new THREE.BoxGeometry(s, s, s), boxMat(0x6e5636, 0.95));
    m.position.set(x, s / 2, z);
    group.add(m);
  }

  // Gantry crane over the north lane.
  const craneMat = boxMat(0xc78a2e, 0.6);
  for (const [x, z] of [[-8, -38], [8, -38]]) {
    const leg = new THREE.Mesh(new THREE.BoxGeometry(1.2, 16, 1.2), craneMat);
    leg.position.set(x, 8, z);
    group.add(leg);
    solid(x, z, 1.4, 1.4, 16);
  }
  const beam = new THREE.Mesh(new THREE.BoxGeometry(22, 1.4, 1.6), craneMat);
  beam.position.set(0, 16.5, -38);
  group.add(beam);
  const hook = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), boxMat(0x222222, 0.5));
  hook.position.set(3, 12, -38);
  group.add(hook);
  const cable = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 3.5, 4), boxMat(0x111111, 0.5));
  cable.position.set(3, 14.2, -38);
  group.add(cable);

  // Charge sites: a fuel gantry (A) and a signal tower (B), each ringed on the ground.
  buildSite(group, YARD.siteA, 0xff9a3c, 'A');
  buildSite(group, YARD.siteB, 0x3cd2c2, 'B');

  // Spawn markers: painted yard lines.
  const lineMat = new THREE.MeshBasicMaterial({ color: 0xd8d8d8, transparent: true, opacity: 0.5 });
  for (const s of [YARD.spawnJackals, YARD.spawnWardens]) {
    const line = new THREE.Mesh(new THREE.PlaneGeometry(1, 8), lineMat);
    line.rotation.x = -Math.PI / 2;
    line.position.set(s.x, 0.02, s.z);
    group.add(line);
  }
  return group;
}

function buildSite(group, site, color, letter) {
  const ring = new THREE.Mesh(
    new THREE.RingGeometry(site.r - 0.35, site.r, 40),
    new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.8, side: THREE.DoubleSide }),
  );
  ring.rotation.x = -Math.PI / 2;
  ring.position.set(site.x, 0.03, site.z);
  group.add(ring);
  const disc = new THREE.Mesh(
    new THREE.CircleGeometry(site.r - 0.4, 40),
    new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.08, side: THREE.DoubleSide }),
  );
  disc.rotation.x = -Math.PI / 2;
  disc.position.set(site.x, 0.025, site.z);
  group.add(disc);
  if (letter === 'A') {
    // fuel gantry: two tanks and a pipe frame
    for (const [dx, dz] of [[-2.5, -2], [2.5, -2]]) {
      const tank = new THREE.Mesh(
        new THREE.CylinderGeometry(1.4, 1.4, 3.4, 14),
        new THREE.MeshStandardMaterial({ color: 0x9c5a24, roughness: 0.6, metalness: 0.5 }),
      );
      tank.position.set(site.x + dx, 1.7, site.z + dz);
      group.add(tank);
      solid(site.x + dx, site.z + dz, 2.8, 2.8, 3.4);
    }
  } else {
    // signal tower: a mast with a crossbar and two lamps
    const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.35, 9, 8), boxMat(0x3a3f46, 0.5));
    mast.position.set(site.x, 4.5, site.z - 2.5);
    group.add(mast);
    solid(site.x, site.z - 2.5, 0.8, 0.8, 9);
    const bar = new THREE.Mesh(new THREE.BoxGeometry(4.5, 0.4, 0.4), boxMat(0x3a3f46, 0.5));
    bar.position.set(site.x, 8.6, site.z - 2.5);
    group.add(bar);
    for (const dx of [-1.8, 1.8]) {
      const lamp = new THREE.Mesh(
        new THREE.SphereGeometry(0.32, 10, 8),
        new THREE.MeshBasicMaterial({ color: dx < 0 ? 0xff4444 : 0x44ff88 }),
      );
      lamp.position.set(site.x + dx, 8.6, site.z - 2.5);
      group.add(lamp);
    }
  }
}

// --- collision -------------------------------------------------------------
// Push a circle (x, z, radius) out of every solid box it overlaps. y is the
// feet height; boxes shorter than the feet are stepped over.
export function collideCircle(p, radius) {
  for (const b of COLLIDERS) {
    if (p.y >= b.h) continue;
    const cx = Math.max(b.min.x, Math.min(p.x, b.max.x));
    const cz = Math.max(b.min.z, Math.min(p.z, b.max.z));
    const dx = p.x - cx;
    const dz = p.z - cz;
    const d2 = dx * dx + dz * dz;
    if (d2 >= radius * radius) continue;
    if (d2 > 1e-8) {
      const d = Math.sqrt(d2);
      p.x = cx + (dx / d) * radius;
      p.z = cz + (dz / d) * radius;
    } else {
      // centre inside the box: push out along the smallest penetration axis
      const pushL = p.x - b.min.x + radius;
      const pushR = b.max.x - p.x + radius;
      const pushB = p.z - b.min.z + radius;
      const pushF = b.max.z - p.z + radius;
      const m = Math.min(pushL, pushR, pushB, pushF);
      if (m === pushL) p.x = b.min.x - radius;
      else if (m === pushR) p.x = b.max.x + radius;
      else if (m === pushB) p.z = b.min.z - radius;
      else p.z = b.max.z + radius;
    }
  }
  // yard bounds
  const lim = YARD.half - 0.6;
  p.x = Math.max(-lim, Math.min(lim, p.x));
  p.z = Math.max(-lim, Math.min(lim, p.z));
}

// Segment (x1,z1)-(x2,z2) blocked by any box taller than eye height?
export function losBlocked(x1, z1, x2, z2, eyeY = 1.6) {
  for (const b of COLLIDERS) {
    if (b.h < eyeY) continue;
    if (segmentHitsBox(x1, z1, x2, z2, b)) return true;
  }
  return false;
}

function segmentHitsBox(x1, z1, x2, z2, b) {
  // Slab test in 2D.
  let tmin = 0;
  let tmax = 1;
  const dx = x2 - x1;
  const dz = z2 - z1;
  const axes = [
    [dx, b.min.x - x1, b.max.x - x1],
    [dz, b.min.z - z1, b.max.z - z1],
  ];
  for (const [d, lo, hi] of axes) {
    if (Math.abs(d) < 1e-9) {
      if (lo > 0 || hi < 0) return false;
    } else {
      let ta = lo / d;
      let tb = hi / d;
      if (ta > tb) { const t = ta; ta = tb; tb = t; }
      tmin = Math.max(tmin, ta);
      tmax = Math.min(tmax, tb);
      if (tmin > tmax) return false;
    }
  }
  return true;
}

// --- waypoint graph --------------------------------------------------------
export const WAYPOINTS = [
  { id: 0, x: -40, z: 0 }, { id: 1, x: -32, z: -20 }, { id: 2, x: -32, z: 20 },
  { id: 3, x: -20, z: -22 }, { id: 4, x: -20, z: 0 }, { id: 5, x: -20, z: 22 },
  { id: 6, x: -6, z: -38 }, { id: 7, x: -6, z: -20 }, { id: 8, x: -6, z: 0 },
  { id: 9, x: -6, z: 20 }, { id: 10, x: -6, z: 38 },
  { id: 11, x: 8, z: -38 }, { id: 12, x: 8, z: -20 }, { id: 13, x: 8, z: 0 },
  { id: 14, x: 8, z: 20 }, { id: 15, x: 8, z: 38 },
  { id: 16, x: 20, z: -22 }, { id: 17, x: 20, z: 0 }, { id: 18, x: 20, z: 22 },
  { id: 19, x: 32, z: -8 }, { id: 20, x: 32, z: 8 }, { id: 21, x: 40, z: 0 },
  { id: 22, x: 26, z: -22 }, { id: 23, x: 26, z: 22 },
  { id: 24, x: -14, z: -38 }, { id: 25, x: -14, z: 38 },
];
export const EDGES = [
  [0, 1], [0, 2], [0, 4], [1, 3], [2, 5], [3, 4], [4, 5], [3, 7], [5, 9],
  [1, 24], [2, 25], [24, 6], [25, 10], [6, 11], [10, 15], [6, 7], [10, 9],
  [7, 8], [8, 9], [7, 12], [9, 14], [8, 13], [11, 12], [12, 13], [13, 14],
  [14, 15], [11, 16], [15, 18], [12, 16], [14, 18], [13, 17], [16, 17],
  [17, 18], [16, 22], [18, 23], [22, 19], [23, 20], [19, 21], [20, 21],
  [17, 19], [17, 20], [19, 22], [20, 23],
];

const ADJ = new Map();
for (const w of WAYPOINTS) ADJ.set(w.id, []);
for (const [a, b] of EDGES) { ADJ.get(a).push(b); ADJ.get(b).push(a); }

export function nearestWaypoint(x, z) {
  let best = 0;
  let bestD = Infinity;
  for (const w of WAYPOINTS) {
    const d = (w.x - x) ** 2 + (w.z - z) ** 2;
    if (d < bestD) { bestD = d; best = w.id; }
  }
  return best;
}

// Breadth-first route from one waypoint to another; returns waypoint ids.
export function findRoute(fromId, toId) {
  if (fromId === toId) return [toId];
  const prev = new Map([[fromId, -1]]);
  const queue = [fromId];
  while (queue.length) {
    const cur = queue.shift();
    for (const n of ADJ.get(cur) ?? []) {
      if (prev.has(n)) continue;
      prev.set(n, cur);
      if (n === toId) {
        const path = [n];
        let c = cur;
        while (c !== -1) { path.unshift(c); c = prev.get(c); }
        return path;
      }
      queue.push(n);
    }
  }
  return [toId];
}
