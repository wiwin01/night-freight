// Night Freight — fully synthesized sound effects.
// No audio files: every sound is built from oscillators and filtered noise in
// WebAudio, so the game ships zero media and makes zero network requests.
// The context is created lazily on the first user gesture (browser policy).
let ctx = null;
let master = null;
let muted = false;

function ensure() {
  if (ctx) return ctx;
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return null;
  ctx = new AC();
  master = ctx.createGain();
  master.gain.value = 0.5;
  master.connect(ctx.destination);
  return ctx;
}

export function unlockAudio() {
  const c = ensure();
  if (c && c.state === 'suspended') c.resume();
}

export function setMuted(m) { muted = m; if (master) master.gain.value = m ? 0 : 0.5; }
export function isMuted() { return muted; }

function noiseBuffer(seconds) {
  const c = ensure();
  const buf = c.createBuffer(1, Math.ceil(c.sampleRate * seconds), c.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < data.length; i += 1) data[i] = Math.random() * 2 - 1;
  return buf;
}

function burst({ freq = 1000, dur = 0.08, type = 'square', gain = 0.25, slideTo = null, delay = 0 }) {
  const c = ensure(); if (!c || muted) return;
  const t0 = c.currentTime + delay;
  const osc = c.createOscillator();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t0);
  if (slideTo !== null) osc.frequency.exponentialRampToValueAtTime(Math.max(20, slideTo), t0 + dur);
  const g = c.createGain();
  g.gain.setValueAtTime(gain, t0);
  g.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
  osc.connect(g); g.connect(master);
  osc.start(t0); osc.stop(t0 + dur + 0.02);
}

function noiseHit({ dur = 0.12, gain = 0.3, filterFreq = 1800, type = 'lowpass', delay = 0 }) {
  const c = ensure(); if (!c || muted) return;
  const t0 = c.currentTime + delay;
  const src = c.createBufferSource();
  src.buffer = noiseBuffer(dur + 0.05);
  const filter = c.createBiquadFilter();
  filter.type = type; filter.frequency.value = filterFreq;
  const g = c.createGain();
  g.gain.setValueAtTime(gain, t0);
  g.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
  src.connect(filter); filter.connect(g); g.connect(master);
  src.start(t0); src.stop(t0 + dur + 0.05);
}

// One named sound effect. Call sites pass the weapon kind where it matters.
export function playSound(name, opts = {}) {
  if (!ensure()) return;
  switch (name) {
    case 'shot-pistol': noiseHit({ dur: 0.09, gain: 0.28, filterFreq: 2400 }); burst({ freq: 220, dur: 0.07, slideTo: 90, gain: 0.2 }); break;
    case 'shot-shotgun': noiseHit({ dur: 0.22, gain: 0.42, filterFreq: 1200 }); burst({ freq: 140, dur: 0.18, slideTo: 55, gain: 0.3 }); break;
    case 'shot-rifle': noiseHit({ dur: 0.1, gain: 0.3, filterFreq: 3000 }); burst({ freq: 180, dur: 0.08, slideTo: 70, gain: 0.22 }); break;
    case 'shot-dmr': noiseHit({ dur: 0.28, gain: 0.4, filterFreq: 1600 }); burst({ freq: 120, dur: 0.22, slideTo: 45, gain: 0.32 }); break;
    case 'dry': burst({ freq: 1400, dur: 0.03, type: 'square', gain: 0.12 }); break;
    case 'reload': burst({ freq: 500, dur: 0.05, gain: 0.14 }); burst({ freq: 700, dur: 0.05, gain: 0.14, delay: 0.25 }); burst({ freq: 900, dur: 0.05, gain: 0.16, delay: 0.55 }); break;
    case 'hit': burst({ freq: 1150, dur: 0.05, type: 'sine', gain: 0.22 }); break;
    case 'kill': burst({ freq: 880, dur: 0.07, type: 'sine', gain: 0.22 }); burst({ freq: 1320, dur: 0.1, type: 'sine', gain: 0.2, delay: 0.07 }); break;
    case 'hurt': burst({ freq: 160, dur: 0.15, slideTo: 70, gain: 0.3 }); noiseHit({ dur: 0.1, gain: 0.15, filterFreq: 500 }); break;
    case 'plant-beep': burst({ freq: 1250, dur: 0.06, type: 'sine', gain: 0.2 }); break;
    case 'plant-done': burst({ freq: 660, dur: 0.12, type: 'sine', gain: 0.22 }); burst({ freq: 990, dur: 0.18, type: 'sine', gain: 0.22, delay: 0.12 }); break;
    case 'defuse': burst({ freq: 980, dur: 0.06, type: 'sine', gain: 0.18 }); break;
    case 'explosion': noiseHit({ dur: 0.9, gain: 0.55, filterFreq: 420 }); burst({ freq: 90, dur: 0.7, slideTo: 28, gain: 0.45 }); break;
    case 'flash': noiseHit({ dur: 0.4, gain: 0.3, filterFreq: 6000, type: 'highpass' }); break;
    case 'bounce': burst({ freq: 320, dur: 0.04, gain: 0.1 }); break;
    case 'step': noiseHit({ dur: 0.05, gain: 0.05, filterFreq: 700 }); break;
    case 'buy': burst({ freq: 740, dur: 0.06, type: 'sine', gain: 0.18 }); burst({ freq: 1108, dur: 0.08, type: 'sine', gain: 0.16, delay: 0.06 }); break;
    case 'round-win': [523, 659, 784, 1047].forEach((f, i) => burst({ freq: f, dur: 0.16, type: 'triangle', gain: 0.2, delay: i * 0.11 })); break;
    case 'round-lose': [392, 330, 262].forEach((f, i) => burst({ freq: f, dur: 0.2, type: 'triangle', gain: 0.18, delay: i * 0.13 })); break;
    case 'tick': burst({ freq: 1500, dur: 0.03, type: 'sine', gain: 0.12 }); break;
    default: break;
  }
}
