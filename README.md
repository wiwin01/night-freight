# Night Freight

A round-based tactical FPS in the style Counter-Strike made famous — two
teams, short rounds won by elimination or by an objective, a buy phase with
money between rounds, and gunfire where accuracy counts more than speed —
played in an original setting: a floodlit freight rail yard at night.

## The game

**Teams.** Jackals (rust orange, attackers) versus Wardens (teal, defenders).
You play for the Jackals, with three bot teammates, against four Warden bots.

**The map.** Shipping-container rows and a warehouse form three lanes across
the yard — north past a tall gantry crane, mid through the warehouse, south
along the yard edge — with two rail lines crossing it. Two charge sites:
**Gantry A**, a fuel gantry, and **Signal B**, a signal-tower yard.

**The match.** First team to 5 rounds. Each round opens with a 10-second buy
phase, then a 100-second live round. Plant the charge (hold **E** inside a
site, 3.5 s channel) and it burns a 38-second fuse; defenders defuse in 5 s.
Rounds are also won by eliminating the other team, or by the clock running
out with no plant (defenders hold).

**Economy.** Start with $800. $300 per kill, $3,000 for a round win, $3,500
for an objective win, and an escalating loss bonus ($1,400 → $2,900) for
consecutive lost rounds. Dying strips you back to the P9 sidearm.

**Arsenal.** Four guns — P9 Sidearm, Mule Scattergun, VK-7 Carbine, scoped
Longshot DMR — plus Kevlar armour, frag grenades and flash grenades (buy with
**B** or keys 1–7 during the buy phase). Spread blooms with firing and
movement and tightens when stopped, crouched or aiming down sights; damage
falls off with distance; headshots multiply damage.

**Bots.** Seven bots on a waypoint graph with line-of-sight perception,
reaction delays, burst fire, strafing, noise investigation, site holds and
rotations, charge pickup after a dropped carrier, and plant / defuse / guard
behaviour.

**Presentation.** Full HUD (health, ammo, money, timer, team scores,
killfeed, buy menu, round banners, plant channel bar), a spectate orbit
camera when dead, and fully synthesized WebAudio sound effects — no audio
files, no network requests.

## Controls

| Key | Action |
| --- | --- |
| WASD | Move |
| Mouse | Aim (click the game to lock the pointer) |
| Click | Fire · Right-click: aim down sights |
| R | Reload · Ctrl / C: crouch |
| B or 1–7 | Buy menu / buy during the buy phase |
| E (hold) | Plant the charge / defuse |
| G / F | Throw frag / flash grenade |
| M | Mute |

## Screenshots

Deterministic modes freeze a representative frame and set
`window.__shotReady`: `?shot=start&seed=1`, `?shot=play&seed=1`,
`?shot=end&seed=1`.

## Run it

Static files under `game/`, ES modules, no build step, no network requests;
three.js 0.187.0 is vendored under `game/`. Serve the folder any way you
like, for example:

```
node serve.ts   # http://localhost:8080
```

## Hand it in

`main.ts` (Node 22, standard library only) copies `game/` and `screenshots/`
to `/output` and writes `/output/dossier.json` with the kit's vendored
`buildDossier`:

```
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts
```

## License

MIT — see `LICENSE`.
