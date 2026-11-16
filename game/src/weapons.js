// Night Freight — weapon definitions and the gunplay math.
// Four guns plus armour and two grenades. Every number here is original to this
// game; the shape (spread that blooms, damage that falls off, headshots that
// multiply) is what makes stopping to aim pay instead of spraying on the move.
export const WEAPONS = {
  p9: {
    id: 'p9', name: 'P9 Sidearm', short: 'P9', price: 0, kind: 'pistol',
    damage: 26, headMult: 3.2, bodyMult: 1.0,
    rpm: 360, mag: 12, reserve: 48, reloadMs: 1400,
    spreadBase: 0.011, spreadMove: 0.030, spreadAir: 0.05, spreadBloom: 0.006,
    spreadMax: 0.055, adsMult: 0.45, crouchMult: 0.8,
    rangeFalloffStart: 14, rangeFalloffEnd: 46, falloffMin: 0.55,
    auto: false, pellets: 1, kick: 0.35, tracer: 0xffd27a,
  },
  mule: {
    id: 'mule', name: 'Mule Scattergun', short: 'MULE', price: 1200, kind: 'shotgun',
    damage: 13, headMult: 2.0, bodyMult: 1.0,
    rpm: 70, mag: 6, reserve: 24, reloadMs: 2600,
    spreadBase: 0.05, spreadMove: 0.07, spreadAir: 0.09, spreadBloom: 0.012,
    spreadMax: 0.11, adsMult: 0.7, crouchMult: 0.85,
    rangeFalloffStart: 7, rangeFalloffEnd: 22, falloffMin: 0.35,
    auto: false, pellets: 8, kick: 1.6, tracer: 0xffb36b,
  },
  vk7: {
    id: 'vk7', name: 'VK-7 Carbine', short: 'VK-7', price: 2700, kind: 'rifle',
    damage: 33, headMult: 3.0, bodyMult: 1.0,
    rpm: 600, mag: 30, reserve: 90, reloadMs: 2200,
    spreadBase: 0.008, spreadMove: 0.026, spreadAir: 0.045, spreadBloom: 0.0045,
    spreadMax: 0.05, adsMult: 0.4, crouchMult: 0.75,
    rangeFalloffStart: 18, rangeFalloffEnd: 55, falloffMin: 0.6,
    auto: true, pellets: 1, kick: 0.7, tracer: 0xffe9a8,
  },
  longshot: {
    id: 'longshot', name: 'Longshot DMR', short: 'LONGSHOT', price: 4200, kind: 'dmr',
    damage: 82, headMult: 3.4, bodyMult: 1.0,
    rpm: 55, mag: 5, reserve: 20, reloadMs: 3000,
    spreadBase: 0.0015, spreadMove: 0.05, spreadAir: 0.08, spreadBloom: 0.02,
    spreadMax: 0.09, adsMult: 0.12, crouchMult: 0.7,
    rangeFalloffStart: 25, rangeFalloffEnd: 80, falloffMin: 0.7,
    auto: false, pellets: 1, kick: 2.2, tracer: 0xcfe8ff, scoped: true,
  },
};

export const GEAR = {
  kevlar: { id: 'kevlar', name: 'Kevlar Vest', price: 650, absorb: 0.5 },
  frag: { id: 'frag', name: 'Frag Grenade', price: 300, max: 2 },
  flash: { id: 'flash', name: 'Flash Grenade', price: 250, max: 2 },
};

export const ORDER = ['p9', 'mule', 'vk7', 'longshot'];

// Current spread (radians) for a shooter in a given stance.
export function currentSpread(weapon, stance) {
  // stance: { moving, crouched, ads, bloom } — bloom grows 0..1 as shots land.
  let s = weapon.spreadBase;
  if (stance.moving) s += weapon.spreadMove;
  if (!stance.grounded) s += weapon.spreadAir;
  if (stance.crouched) s *= weapon.crouchMult;
  if (stance.ads) s *= weapon.adsMult;
  s += weapon.spreadBloom * stance.bloom * 10;
  return Math.min(s, weapon.spreadMax);
}

// Damage of one pellet at a distance, before the head/body multiplier.
export function pelletDamage(weapon, distance) {
  const { rangeFalloffStart, rangeFalloffEnd, falloffMin } = weapon;
  if (distance <= rangeFalloffStart) return weapon.damage;
  if (distance >= rangeFalloffEnd) return weapon.damage * falloffMin;
  const t = (distance - rangeFalloffStart) / (rangeFalloffEnd - rangeFalloffStart);
  return weapon.damage * (1 - (1 - falloffMin) * t);
}

// A fresh ammo state for a weapon id.
export function freshAmmo(id) {
  const w = WEAPONS[id];
  return { mag: w.mag, reserve: w.reserve, reloading: false, reloadUntil: 0 };
}
