let ctx: AudioContext | null = null;

function ac(): AudioContext | null {
  if (typeof window === "undefined") return null;
  if (!ctx) {
    const Ctor = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return null;
    ctx = new Ctor();
  }
  return ctx;
}

export function unlockAudio() {
  const c = ac();
  if (c?.state === "suspended") void c.resume();
}

function beep(freq: number, dur: number, type: OscillatorType, gain = 0.05, slide?: number) {
  const c = ac();
  if (!c) return;
  const t = c.currentTime;
  const o = c.createOscillator();
  const g = c.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, t);
  if (slide) o.frequency.exponentialRampToValueAtTime(slide, t + dur);
  g.gain.setValueAtTime(gain, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g);
  g.connect(c.destination);
  o.start(t);
  o.stop(t + dur + 0.02);
}

export function playGive() {
  beep(660, 0.08, "triangle", 0.04);
  beep(880, 0.12, "triangle", 0.035);
}

export function playDawn() {
  beep(392, 0.18, "sine", 0.05);
  beep(523, 0.28, "sine", 0.04);
}

export function playHang() {
  beep(160, 0.22, "sawtooth", 0.04, 90);
  beep(110, 0.7, "triangle", 0.035, 48);
  beep(70, 0.9, "sine", 0.028, 36);
}

export function playTalk() {
  beep(620, 0.07, "triangle", 0.025);
}

export function playShout() {
  beep(220, 0.22, "square", 0.03, 160);
  beep(330, 0.28, "triangle", 0.022);
}

export function playSpawn() {
  beep(520, 0.1, "square", 0.03);
  beep(780, 0.16, "square", 0.025);
}


