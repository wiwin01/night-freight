// Night Freight — the hand-in program for make.fun's threejs-fps-01 bounty.
// Node 22, standard library only. It copies this repository's game/ and
// screenshots/ into the output directory and writes /output/dossier.json with
// buildDossier from the kit's vendored library, so the sealed scorer can check
// the entry and the judge can read its source and screenshots.
//
//   mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts
//
// Outside the grader MAKEFUN_OUTPUT_DIR stands in for /output; inside the
// grader the program runs twice and both runs must write identical bytes, so
// nothing here depends on the clock, the environment or the network.

import { cpSync, existsSync, mkdirSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildDossier } from './vendor/makefun-threejs.ts';

const here = fileURLToPath(new URL('.', import.meta.url));
const out = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';

// The scorer's own caps, from the kit's reference/gate.json: the dossier text
// is capped at 160 KiB; the other caps only make this program fail where the
// scorer would refuse the entry (more than 4 screenshots, one over 256 KiB,
// more than 993 files in game/ or 48 MiB of game files in all).
const caps = {
  text_max_bytes: 163840,
  screenshots: { max: 4, max_bytes: 262144 },
  game_max_files: 993,
  game_max_bytes: 50331648,
};

function copyTree(src, dst) {
  mkdirSync(dst, { recursive: true });
  for (const name of readdirSync(src).sort()) {
    const from = join(src, name);
    const to = join(dst, name);
    const st = statSync(from);
    if (st.isDirectory()) copyTree(from, to);
    else if (st.isFile()) cpSync(from, to);
    // anything else (symlink, socket, device) is refused: the gate only
    // accepts plain files and directories, so fail loudly instead of
    // silently dropping it.
    else throw new Error(`refusing non-file entry in game tree: ${from}`);
  }
}

mkdirSync(out, { recursive: true });
copyTree(join(here, 'game'), join(out, 'game'));
mkdirSync(join(out, 'screenshots'), { recursive: true });
if (existsSync(join(here, 'screenshots'))) {
  copyTree(join(here, 'screenshots'), join(out, 'screenshots'));
}

writeFileSync(join(out, 'dossier.json'), buildDossier(out, caps));
