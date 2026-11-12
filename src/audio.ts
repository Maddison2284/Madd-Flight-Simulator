import type { EngineKind } from "./aircraft";

const MUTE_KEY = "maddflight-muted";
const VOLUME_KEY = "maddflight-volume";

export type FlightAudioState = {
  flying: boolean;
  crashed: boolean;
  stall: boolean;
  throttle: number;
  speed: number;
  boost: boolean;
  engine: EngineKind;
  /** Fighter afterburner lit (louder, brighter roar). */
  afterburner?: boolean;
  /** 3-D speed in m/s, used for the sonic boom. */
  speedMs?: number;
  warp?: 0 | 1 | 2 | 3;
};

/** One-time migration of audio prefs saved before the 2026-11-11 sound fix.
 * Players who heard nothing (volume stuck at 0, iOS silent switch) often
 * pressed the old "Sound" button, which actually MUTED them and saved it.
 * Reset a saved mute or a saved 0 volume once so everyone starts audible. */
export const AUDIO_PREFS_VERSION_KEY = "maddflight-audio-v";
export const AUDIO_PREFS_VERSION = "2";
export function migrateAudioPrefs(store: Pick<Storage, "getItem" | "setItem" | "removeItem">) {
  if (store.getItem(AUDIO_PREFS_VERSION_KEY) === AUDIO_PREFS_VERSION) return;
  if (store.getItem(MUTE_KEY) === "1") store.setItem(MUTE_KEY, "0");
  const v = store.getItem(VOLUME_KEY);
  if (v != null && !(Number(v) > 0.05)) store.removeItem(VOLUME_KEY);
  store.setItem(AUDIO_PREFS_VERSION_KEY, AUDIO_PREFS_VERSION);
}
try {
  migrateAudioPrefs(localStorage);
} catch {}

function readMuted(): boolean {
  try {
    return localStorage.getItem(MUTE_KEY) === "1";
  } catch {
    return false;
  }
}

export const DEFAULT_VOLUME = 0.7;

/** Stored volume, or the default when nothing valid is stored. (Bug fixed:
 * `Number(localStorage.getItem(..))` turned a missing key, null, into 0, so
 * every new player started at volume 0 and heard nothing.) */
export function parseVolume(raw: string | null | undefined): number {
  if (raw == null || raw.trim() === "") return DEFAULT_VOLUME;
  const value = Number(raw);
  if (!Number.isFinite(value)) return DEFAULT_VOLUME;
  return Math.max(0, Math.min(1, value));
}

function readVolume(): number {
  try {
    return parseVolume(localStorage.getItem(VOLUME_KEY));
  } catch {
    return DEFAULT_VOLUME;
  }
}

/** Tiny silent mono WAV (0.25 s, 8 kHz, 8-bit) as a data URI. */
let silentUri: string | null = null;
function silentWavDataUri(): string {
  if (silentUri) return silentUri;
  const n = 2000;
  const bytes = new Uint8Array(44 + n);
  const dv = new DataView(bytes.buffer);
  const str = (o: number, t: string) => { for (let i = 0; i < t.length; i++) bytes[o + i] = t.charCodeAt(i); };
  str(0, "RIFF"); dv.setUint32(4, 36 + n, true); str(8, "WAVE"); str(12, "fmt ");
  dv.setUint32(16, 16, true); dv.setUint16(20, 1, true); dv.setUint16(22, 1, true);
  dv.setUint32(24, 8000, true); dv.setUint32(28, 8000, true); dv.setUint16(32, 1, true);
  dv.setUint16(34, 8, true); str(36, "data"); dv.setUint32(40, n, true);
  bytes.fill(128, 44);
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  silentUri = "data:audio/wav;base64," + btoa(bin);
  return silentUri;
}

/** Noise buffers are cached per context + length: one-shot sounds (boom,
 * jump zap, held Jump every ~0.3 s) reuse them instead of allocating and
 * filling a fresh buffer each time. */
const noiseCache = new WeakMap<BaseAudioContext, Map<number, AudioBuffer>>();
function noiseBuffer(ctx: BaseAudioContext, seconds = 2): AudioBuffer {
  let m = noiseCache.get(ctx);
  if (!m) noiseCache.set(ctx, (m = new Map()));
  const hit = m.get(seconds);
  if (hit) return hit;
  const made = makeNoise(ctx, seconds);
  m.set(seconds, made);
  return made;
}
/** Disconnect a one-shot's nodes once its source ends. */
function disposeOnEnd(src: AudioScheduledSourceNode, ...nodes: AudioNode[]) {
  src.onended = () => {
    for (const n of [src, ...nodes]) {
      try {
        n.disconnect();
      } catch {}
    }
  };
}
/** Pink noise (Paul Kellet's filter: −3 dB/octave) at the context's own
 * sample rate, normalised to ±0.9, with the last 40 ms crossfaded into the
 * start so a looped buffer has no click. Plain white noise (the 2026-11-11
 * build) put most of its energy at 2-20 kHz, which is the "static" players
 * heard under every engine. */
export function fillPinkNoise(data: Float32Array, sampleRate: number, rand: () => number = Math.random) {
  let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
  for (let i = 0; i < data.length; i++) {
    const w = rand() * 2 - 1;
    b0 = 0.99886 * b0 + w * 0.0555179;
    b1 = 0.99332 * b1 + w * 0.0750759;
    b2 = 0.969 * b2 + w * 0.153852;
    b3 = 0.8665 * b3 + w * 0.3104856;
    b4 = 0.55 * b4 + w * 0.5329522;
    b5 = -0.7616 * b5 - w * 0.016898;
    data[i] = b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362;
    b6 = w * 0.115926;
  }
  // Remove DC, normalise.
  let mean = 0;
  for (let i = 0; i < data.length; i++) mean += data[i];
  mean /= data.length || 1;
  let peak = 0;
  for (let i = 0; i < data.length; i++) peak = Math.max(peak, Math.abs((data[i] -= mean)));
  const k = peak > 0 ? 0.9 / peak : 1;
  for (let i = 0; i < data.length; i++) data[i] *= k;
  // Seamless loop: equal-power crossfade of the tail into the head.
  const fade = Math.min(Math.floor(sampleRate * 0.04), Math.floor(data.length / 4));
  const n = data.length;
  for (let i = 0; i < fade; i++) {
    const a = i / fade;
    data[i] = data[i] * Math.sin((a * Math.PI) / 2) + data[n - fade + i] * Math.cos((a * Math.PI) / 2);
  }
  return n - fade; // usable loop length (samples)
}
function makeNoise(ctx: BaseAudioContext, seconds: number): AudioBuffer {
  const full = Math.floor(ctx.sampleRate * seconds);
  const scratch = new Float32Array(full);
  const len = fillPinkNoise(scratch, ctx.sampleRate);
  const buffer = ctx.createBuffer(1, len, ctx.sampleRate);
  buffer.getChannelData(0).set(scratch.subarray(0, len));
  return buffer;
}

export class FlightAudio {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  /** Mix bus (−6 dB) feeding the compressor; all sounds connect here. */
  private bus: GainNode | null = null;
  private noiseLP: BiquadFilterNode | null = null;
  private engineGain: GainNode | null = null;
  private windGain: GainNode | null = null;
  private stallGain: GainNode | null = null;
  private engineFilter: BiquadFilterNode | null = null;
  private engineOsc: OscillatorNode | null = null;
  private engineOsc2: OscillatorNode | null = null;
  private noiseSrc: AudioBufferSourceNode | null = null;
  private stallOsc: OscillatorNode | null = null;
  private slapOsc: OscillatorNode | null = null;
  private slapDepth: GainNode | null = null;
  private started = false;
  private wasCrashed = false;
  private lastMach = 0;
  private engineKind: EngineKind | null = null;
  muted = readMuted();
  volume = readVolume();

  get ready(): boolean {
    return this.started;
  }

  setMuted(muted: boolean) {
    const turnedOn = this.muted && !muted;
    this.muted = muted;
    try {
      localStorage.setItem(MUTE_KEY, muted ? "1" : "0");
    } catch {}
    this.applyGain();
    if (turnedOn) this.beep();
    this.emit();
  }

  setVolume(volume: number) {
    this.volume = Math.max(0, Math.min(1, volume));
    try {
      localStorage.setItem(VOLUME_KEY, String(this.volume));
    } catch {}
    this.applyGain();
  }

  private applyGain() {
    if (this.master && this.ctx)
      this.master.gain.setTargetAtTime(
        this.muted ? 0 : this.volume,
        this.ctx.currentTime,
        0.05,
      );
  }

  /** The AudioContext state, for diagnostics ("none" before first gesture). */
  get state(): string {
    return this.ctx?.state ?? "none";
  }

  /** True when sound should be audible right now (context running, unmuted). */
  get audible(): boolean {
    return this.ctx?.state === "running" && !this.muted && this.volume > 0;
  }

  private listeners = new Set<() => void>();
  /** Subscribe to state changes (context running/suspended, mute). */
  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }
  private emit() {
    for (const fn of this.listeners) fn();
  }

  private silentEl: HTMLAudioElement | null = null;
  private analyser: AnalyserNode | null = null;
  private beepedOnce = false;

  /** Install once. Every click / tap / key re-runs unlock() SYNCHRONOUSLY
   * inside the gesture (iOS ignores resume() from pointerdown, from after an
   * await, or outside a gesture). Listeners stay installed so an iOS
   * "interrupted" or suspended context (phone call, app switch, lock screen)
   * comes back on the next tap. */
  installGestureUnlock() {
    if (typeof window === "undefined") return;
    const onGesture = () => {
      if (this.ctx?.state !== "running" || !this.silentPlaying()) this.unlock();
    };
    for (const type of ["touchend", "click", "pointerup", "keydown", "mousedown"])
      window.addEventListener(type, onGesture, { capture: true, passive: true });
    const tryResume = () => {
      if (document.visibilityState === "visible" && this.ctx && this.ctx.state !== "running")
        this.ctx.resume().catch(() => {}).finally(() => this.emit());
    };
    document.addEventListener("visibilitychange", tryResume);
    window.addEventListener("pageshow", tryResume);
    window.addEventListener("focus", tryResume);
  }

  private silentPlaying(): boolean {
    return !this.isIOSLike() || (!!this.silentEl && !this.silentEl.paused);
  }

  private isIOSLike(): boolean {
    if (typeof navigator === "undefined") return false;
    const ua = navigator.userAgent || "";
    return /iP(hone|ad|od)/.test(ua) || (/Macintosh/.test(ua) && (navigator.maxTouchPoints || 0) > 1);
  }

  /** iOS: route Web Audio through the media ("playback") session so the
   * ring/silent switch does not mute it. */
  private setPlaybackSession() {
    try {
      const nav = navigator as Navigator & { audioSession?: { type: string } };
      if (nav.audioSession && nav.audioSession.type !== "playback") nav.audioSession.type = "playback";
    } catch {}
    // Older iOS (no audioSession API): a playing HTML <audio> element switches
    // the page to the playback category, which also un-mutes Web Audio.
    if (!this.isIOSLike()) return;
    try {
      if (!this.silentEl) {
        const el = document.createElement("audio");
        el.src = silentWavDataUri();
        el.loop = true;
        el.setAttribute("playsinline", "");
        el.setAttribute("webkit-playsinline", "");
        el.preload = "auto";
        el.volume = 0.01;
        this.silentEl = el;
      }
      if (this.silentEl.paused) void this.silentEl.play().catch(() => {});
    } catch {}
  }

  /** Call synchronously from a user gesture handler (no await before it). */
  unlock() {
    if (typeof window === "undefined") return;
    const AC =
      window.AudioContext ||
      (window as Window & { webkitAudioContext?: typeof AudioContext })
        .webkitAudioContext;
    if (!AC) return;
    this.setPlaybackSession();
    if (!this.ctx) {
      try {
        this.ctx = new AC({ latencyHint: "interactive" });
      } catch {
        this.ctx = new AC();
      }
      this.ctx.onstatechange = () => {
        if (this.ctx?.state === "running") this.applyGain();
        this.emit();
      };
    }
    const ctx = this.ctx;
    const wasRunning = ctx.state === "running";
    if (ctx.state !== "running" && ctx.state !== "closed") {
      // Old-iOS trick: start a 1-sample buffer inside the gesture.
      try {
        const b = ctx.createBuffer(1, 1, 22050);
        const src = ctx.createBufferSource();
        src.buffer = b;
        src.connect(ctx.destination);
        src.start(0);
      } catch {}
      ctx
        .resume()
        .then(() => {
          if (!wasRunning && (ctx.state as string) === "running" && !this.beepedOnce && !this.muted) {
            this.beepedOnce = true;
            this.beep();
          }
        })
        .catch(() => {})
        .finally(() => this.emit());
    }
    this.buildGraph();
    this.emit();
  }

  /** Back-compat: unlocks synchronously, then resolves. */
  async start() {
    this.unlock();
  }

  /** Short confirmation chirp when sound turns on. */
  beep() {
    if (!this.ctx || !this.master || this.muted) return;
    const ctx = this.ctx;
    const t = ctx.currentTime + 0.01;
    const osc = ctx.createOscillator();
    osc.type = "sine";
    osc.frequency.setValueAtTime(660, t);
    osc.frequency.setValueAtTime(990, t + 0.07);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.35, t + 0.015);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.16);
    osc.connect(g);
    g.connect(this.bus ?? this.master);
    osc.start(t);
    osc.stop(t + 0.18);
  }

  /** Landing gear motor / lock thunk (two soft low thuds). */
  gearClunk() {
    if (!this.ctx || !this.master || this.muted) return;
    const ctx = this.ctx;
    for (const [dt, f0] of [[0.01, 140], [0.12, 95]] as const) {
      const t = ctx.currentTime + dt;
      const osc = ctx.createOscillator();
      osc.type = "triangle";
      osc.frequency.setValueAtTime(f0, t);
      osc.frequency.exponentialRampToValueAtTime(f0 * 0.5, t + 0.12);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.3, t + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.14);
      osc.connect(g);
      g.connect(this.bus ?? this.master);
      osc.onended = () => {
        osc.disconnect();
        g.disconnect();
      };
      osc.start(t);
      osc.stop(t + 0.16);
    }
  }

  /** Gear-up warning: two short high beeps. */
  gearWarning() {
    if (!this.ctx || !this.master || this.muted) return;
    const ctx = this.ctx;
    for (const dt of [0.01, 0.22]) {
      const t = ctx.currentTime + dt;
      const osc = ctx.createOscillator();
      osc.type = "triangle";
      osc.frequency.setValueAtTime(1180, t);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.3, t + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.14);
      osc.connect(g);
      g.connect(this.bus ?? this.master);
      osc.onended = () => {
        osc.disconnect();
        g.disconnect();
      };
      osc.start(t);
      osc.stop(t + 0.16);
    }
  }

  /** Diagnostics for tests: context state, master gain, and the RMS level the
   * analyser on the master bus currently reads. */
  debug() {
    let rms = 0;
    if (this.analyser) {
      const buf = new Float32Array(this.analyser.fftSize);
      this.analyser.getFloatTimeDomainData(buf);
      let sum = 0;
      for (const v of buf) sum += v * v;
      rms = Math.sqrt(sum / buf.length);
    }
    return {
      state: this.state,
      started: this.started,
      muted: this.muted,
      volume: this.volume,
      gain: this.master?.gain.value ?? 0,
      rms,
      session: (navigator as Navigator & { audioSession?: { type: string } }).audioSession?.type ?? null,
      silentEl: this.silentEl ? !this.silentEl.paused : null,
    };
  }

  private buildGraph() {
    if (this.started || !this.ctx) return;
    const ctx = this.ctx;
    // Mix bus → −6 dB headroom → limiter-style compressor → gentle 9 kHz
    // shelf cut → master volume. Every sound connects to `bus`.
    const bus = ctx.createGain();
    bus.gain.value = 0.5;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -10;
    comp.knee.value = 6;
    comp.ratio.value = 12;
    comp.attack.value = 0.003;
    comp.release.value = 0.2;
    const shelf = ctx.createBiquadFilter();
    shelf.type = "highshelf";
    shelf.frequency.value = 9000;
    shelf.gain.value = -9;
    bus.connect(comp);
    comp.connect(shelf);
    const master = ctx.createGain();
    master.gain.value = this.muted ? 0 : this.volume;
    shelf.connect(master);
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 2048;
    master.connect(analyser);
    analyser.connect(ctx.destination);
    this.analyser = analyser;

    const engineGain = ctx.createGain();
    engineGain.gain.value = 0;
    const engineFilter = ctx.createBiquadFilter();
    engineFilter.type = "lowpass";
    engineFilter.frequency.value = 800;
    engineFilter.Q.value = 0.8;
    const noise = ctx.createBufferSource();
    noise.buffer = noiseBuffer(ctx);
    noise.loop = true;
    const noiseGain = ctx.createGain();
    noiseGain.gain.value = 0.5;
    // Noise gets its own lowpass in front of the engine filter (24 dB/oct
    // total) so it reads as rumble/roar rather than hiss.
    const noiseLP = ctx.createBiquadFilter();
    noiseLP.type = "lowpass";
    noiseLP.frequency.value = 600;
    noiseLP.Q.value = 0.5;
    noise.connect(noiseLP);
    noiseLP.connect(noiseGain);
    noiseGain.connect(engineFilter);
    this.noiseLP = noiseLP;
    const osc = ctx.createOscillator();
    osc.type = "sawtooth";
    osc.frequency.value = 80;
    const oscGain = ctx.createGain();
    oscGain.gain.value = 0.12;
    osc.connect(oscGain);
    oscGain.connect(engineFilter);
    const osc2 = ctx.createOscillator();
    osc2.type = "triangle";
    osc2.frequency.value = 40;
    const osc2Gain = ctx.createGain();
    osc2Gain.gain.value = 0.12;
    osc2.connect(osc2Gain);
    osc2Gain.connect(engineFilter);
    // Rotor "blade slap": an LFO at blade-pass frequency modulating the
    // engine level (depth is 0 for non-rotorcraft).
    const pulse = ctx.createGain();
    pulse.gain.value = 1;
    const slapOsc = ctx.createOscillator();
    slapOsc.type = "sine";
    slapOsc.frequency.value = 13;
    const slapDepth = ctx.createGain();
    slapDepth.gain.value = 0;
    slapOsc.connect(slapDepth);
    slapDepth.connect(pulse.gain);
    engineFilter.connect(pulse);
    pulse.connect(engineGain);
    engineGain.connect(bus);

    const windGain = ctx.createGain();
    windGain.gain.value = 0;
    // Wind: pink noise, bandpass + lowpass (was a wide bandpass on white
    // noise that let 2-8 kHz hiss through).
    const windFilter = ctx.createBiquadFilter();
    windFilter.type = "bandpass";
    windFilter.frequency.value = 520;
    windFilter.Q.value = 0.9;
    const windLP = ctx.createBiquadFilter();
    windLP.type = "lowpass";
    windLP.frequency.value = 1400;
    windLP.Q.value = 0.5;
    const wind = ctx.createBufferSource();
    wind.buffer = noiseBuffer(ctx, 3);
    wind.loop = true;
    wind.connect(windFilter);
    windFilter.connect(windLP);
    windLP.connect(windGain);
    windGain.connect(bus);

    const stallGain = ctx.createGain();
    stallGain.gain.value = 0;
    const stallOsc = ctx.createOscillator();
    // Stall horn: triangle through a lowpass (a raw 1.7 kHz square aliased).
    stallOsc.type = "triangle";
    stallOsc.frequency.value = 1700;
    const stallLP = ctx.createBiquadFilter();
    stallLP.type = "lowpass";
    stallLP.frequency.value = 3200;
    stallOsc.connect(stallLP);
    stallLP.connect(stallGain);
    stallGain.connect(bus);

    noise.start();
    wind.start();
    osc.start();
    osc2.start();
    stallOsc.start();
    slapOsc.start();
    this.slapOsc = slapOsc;
    this.slapDepth = slapDepth;

    this.master = master;
    this.bus = bus;
    this.engineGain = engineGain;
    this.engineFilter = engineFilter;
    this.engineOsc = osc;
    this.engineOsc2 = osc2;
    this.noiseSrc = noise;
    this.windGain = windGain;
    this.stallGain = stallGain;
    this.stallOsc = stallOsc;
    this.started = true;
  }

  private burst(duration = 0.35, volume = 0.9) {
    if (!this.ctx || !this.master || this.muted) return;
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = noiseBuffer(ctx, 0.5);
    const filter = ctx.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.value = 400;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(volume, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + duration);
    src.connect(filter);
    filter.connect(gain);
    gain.connect(this.bus ?? this.master);
    disposeOnEnd(src, filter, gain);
    src.start();
    src.stop(ctx.currentTime + duration);
  }

  /** Teleport whoosh/zap: a fast falling sweep plus a filtered noise swish. */
  zap(big = false) {
    if (!this.started || !this.ctx || !this.master || this.muted) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const dur = big ? 0.42 : 0.26;
    const osc = ctx.createOscillator();
    osc.type = "triangle";
    osc.frequency.setValueAtTime(big ? 1800 : 1400, t);
    osc.frequency.exponentialRampToValueAtTime(90, t + dur);
    const og = ctx.createGain();
    og.gain.setValueAtTime(0.0001, t);
    og.gain.exponentialRampToValueAtTime(0.28, t + 0.02);
    og.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(og);
    og.connect(this.bus ?? this.master);
    disposeOnEnd(osc, og);
    osc.start(t);
    osc.stop(t + dur + 0.02);
    const src = ctx.createBufferSource();
    src.buffer = noiseBuffer(ctx, 0.5);
    const bp = ctx.createBiquadFilter();
    bp.type = "bandpass";
    bp.Q.value = 1.2;
    bp.frequency.setValueAtTime(2600, t);
    bp.frequency.exponentialRampToValueAtTime(300, t + dur);
    const ng = ctx.createGain();
    ng.gain.setValueAtTime(0.5, t);
    ng.gain.exponentialRampToValueAtTime(0.001, t + dur);
    src.connect(bp);
    bp.connect(ng);
    ng.connect(this.bus ?? this.master);
    disposeOnEnd(src, bp, ng);
    src.start(t);
    src.stop(t + dur);
  }

  /** Low thump + noise burst when the saucer (or anything) crosses Mach 1. */
  boom() {
    if (!this.started || !this.ctx || !this.master || this.muted) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const osc = ctx.createOscillator();
    osc.type = "sine";
    osc.frequency.setValueAtTime(90, t);
    osc.frequency.exponentialRampToValueAtTime(28, t + 0.55);
    const og = ctx.createGain();
    og.gain.setValueAtTime(0.9, t);
    og.gain.exponentialRampToValueAtTime(0.001, t + 0.7);
    osc.connect(og);
    og.connect(this.bus ?? this.master);
    disposeOnEnd(osc, og);
    osc.start(t);
    osc.stop(t + 0.7);
    this.burst(0.45, 0.8);
  }

  update(state: FlightAudioState) {
    if (!this.started || !this.ctx) return;
    const t = this.ctx.currentTime;
    const flying = state.flying && !state.crashed;
    const throttle = flying ? Math.max(0, Math.min(1, state.throttle)) : 0;
    const speed = flying ? state.speed : 0;
    if (this.engineGain) {
      const base =
        // ×1.35 vs the 2026-11-11 mix: the hiss removed from the noise layers
        // took ~3 dB of loudness with it, and the −6 dB bus + compressor
        // keep the peaks in check.
        (state.engine === "rotor" ? 0.22 : state.engine === "prop" ? 0.2 : state.engine === "saucer" ? 0.12 : 0.16) * 1.35;
      const ab = flying && state.afterburner ? 1.7 : 1;
      const warp = state.warp ?? (state.boost && state.engine === "saucer" ? 1 : 0);
      const level = flying
        ? base * ab * (0.25 + throttle * 0.85 + (state.boost ? 0.15 : 0) + (warp ? 0.2 + warp * 0.15 : 0))
        : 0;
      this.engineGain.gain.setTargetAtTime(level, t, 0.08);
    }
    if (this.engineFilter) {
      const cutoff =
        state.engine === "prop"
          ? 500 + throttle * 1200
          : state.engine === "rotor"
            ? 350 + throttle * 600
            : state.engine === "saucer"
              ? 900 + throttle * 900
              : 700 + throttle * 1500 + (state.afterburner ? 900 : 0);
      this.engineFilter.frequency.setTargetAtTime(cutoff, t, 0.1);
      this.noiseLP?.frequency.setTargetAtTime(Math.max(250, cutoff * 0.55), t, 0.1);
    }
    if (this.engineOsc) {
      const freq =
        state.engine === "prop"
          ? 70 + throttle * 90
          : state.engine === "rotor"
            ? 28 + throttle * 36
            : state.engine === "saucer"
              ? 110 + throttle * 60
              : 55 + throttle * 70;
      this.engineOsc.frequency.setTargetAtTime(freq, t, 0.1);
    }
    if (this.engineOsc2) {
      const freq =
        state.engine === "prop"
          ? 35 + throttle * 40
          : state.engine === "rotor"
            ? 12 + throttle * 16
            : state.engine === "saucer"
              ? 55.5 + throttle * 30
              : 28 + throttle * 30;
      this.engineOsc2.frequency.setTargetAtTime(freq, t, 0.1);
    }
    if (this.slapDepth && this.slapOsc) {
      const rotor = state.engine === "rotor" && flying;
      const saucer = state.engine === "saucer" && flying;
      this.slapDepth.gain.setTargetAtTime(rotor ? 0.55 : saucer ? 0.25 : 0, t, 0.1);
      this.slapOsc.frequency.setTargetAtTime(rotor ? 12 + throttle * 2 : 3.5, t, 0.2);
    }
    if (this.windGain) {
      const wind = flying ? Math.min(0.32, (speed / 280) * 0.32) : 0;
      this.windGain.gain.setTargetAtTime(wind, t, 0.12);
    }
    if (this.stallGain && this.stallOsc) {
      const horn = flying && state.stall ? 0.12 : 0;
      this.stallGain.gain.setTargetAtTime(horn, t, 0.04);
      const pulse = 0.5 + 0.5 * Math.sin(t * 12);
      if (horn) this.stallOsc.frequency.setTargetAtTime(1500 + pulse * 400, t, 0.02);
    }
    if (state.crashed && !this.wasCrashed) this.burst(0.55, 0.95);
    this.wasCrashed = state.crashed;
    const speedMs = state.speedMs ?? state.speed;
    const mach = flying ? speedMs / 340.29 : 0;
    if (flying && this.lastMach < 1 && mach >= 1) this.boom();
    this.lastMach = mach;
    this.engineKind = state.engine;
  }

  stopLoops() {
    this.update({
      flying: false,
      crashed: false,
      stall: false,
      throttle: 0,
      speed: 0,
      boost: false,
      engine: this.engineKind || "jet",
    });
  }
}

export const flightAudio = new FlightAudio();
