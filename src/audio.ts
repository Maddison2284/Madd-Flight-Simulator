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
};

function readMuted(): boolean {
  try {
    return localStorage.getItem(MUTE_KEY) === "1";
  } catch {
    return false;
  }
}

function readVolume(): number {
  try {
    const value = Number(localStorage.getItem(VOLUME_KEY));
    if (Number.isFinite(value)) return Math.max(0, Math.min(1, value));
  } catch {}
  return 0.7;
}

function noiseBuffer(ctx: AudioContext, seconds = 2): AudioBuffer {
  const buffer = ctx.createBuffer(1, Math.floor(ctx.sampleRate * seconds), ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  return buffer;
}

export class FlightAudio {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private engineGain: GainNode | null = null;
  private windGain: GainNode | null = null;
  private stallGain: GainNode | null = null;
  private engineFilter: BiquadFilterNode | null = null;
  private engineOsc: OscillatorNode | null = null;
  private engineOsc2: OscillatorNode | null = null;
  private noiseSrc: AudioBufferSourceNode | null = null;
  private stallOsc: OscillatorNode | null = null;
  private started = false;
  private wasCrashed = false;
  private engineKind: EngineKind | null = null;
  muted = readMuted();
  volume = readVolume();

  get ready(): boolean {
    return this.started;
  }

  setMuted(muted: boolean) {
    this.muted = muted;
    try {
      localStorage.setItem(MUTE_KEY, muted ? "1" : "0");
    } catch {}
    this.applyGain();
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

  /** Must be called from a user gesture (Start flight, unmute, etc.). */
  async start() {
    const AC =
      window.AudioContext ||
      (window as Window & { webkitAudioContext?: typeof AudioContext })
        .webkitAudioContext;
    if (!AC) return;
    if (!this.ctx) this.ctx = new AC();
    if (this.ctx.state === "suspended") await this.ctx.resume().catch(() => {});
    if (this.started || this.ctx.state !== "running") return;
    const ctx = this.ctx;
    const master = ctx.createGain();
    master.gain.value = this.muted ? 0 : this.volume;
    master.connect(ctx.destination);

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
    noiseGain.gain.value = 0.35;
    noise.connect(noiseGain);
    noiseGain.connect(engineFilter);
    const osc = ctx.createOscillator();
    osc.type = "sawtooth";
    osc.frequency.value = 80;
    const oscGain = ctx.createGain();
    oscGain.gain.value = 0.12;
    osc.connect(oscGain);
    oscGain.connect(engineFilter);
    const osc2 = ctx.createOscillator();
    osc2.type = "square";
    osc2.frequency.value = 40;
    const osc2Gain = ctx.createGain();
    osc2Gain.gain.value = 0.06;
    osc2.connect(osc2Gain);
    osc2Gain.connect(engineFilter);
    engineFilter.connect(engineGain);
    engineGain.connect(master);

    const windGain = ctx.createGain();
    windGain.gain.value = 0;
    const windFilter = ctx.createBiquadFilter();
    windFilter.type = "bandpass";
    windFilter.frequency.value = 800;
    windFilter.Q.value = 0.6;
    const wind = ctx.createBufferSource();
    wind.buffer = noiseBuffer(ctx, 3);
    wind.loop = true;
    wind.connect(windFilter);
    windFilter.connect(windGain);
    windGain.connect(master);

    const stallGain = ctx.createGain();
    stallGain.gain.value = 0;
    const stallOsc = ctx.createOscillator();
    stallOsc.type = "square";
    stallOsc.frequency.value = 1700;
    stallOsc.connect(stallGain);
    stallGain.connect(master);

    noise.start();
    wind.start();
    osc.start();
    osc2.start();
    stallOsc.start();

    this.master = master;
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
    gain.gain.value = volume;
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + duration);
    src.connect(filter);
    filter.connect(gain);
    gain.connect(this.master);
    src.start();
    src.stop(ctx.currentTime + duration);
  }

  update(state: FlightAudioState) {
    if (!this.started || !this.ctx) return;
    const t = this.ctx.currentTime;
    const flying = state.flying && !state.crashed;
    const throttle = flying ? Math.max(0, Math.min(1, state.throttle)) : 0;
    const speed = flying ? state.speed : 0;
    if (this.engineGain) {
      const base = state.engine === "rotor" ? 0.22 : state.engine === "prop" ? 0.2 : 0.16;
      const level = flying ? base * (0.25 + throttle * 0.85 + (state.boost ? 0.15 : 0)) : 0;
      this.engineGain.gain.setTargetAtTime(level, t, 0.08);
    }
    if (this.engineFilter) {
      const cutoff =
        state.engine === "prop"
          ? 500 + throttle * 1200
          : state.engine === "rotor"
            ? 350 + throttle * 600
            : 700 + throttle * 1800;
      this.engineFilter.frequency.setTargetAtTime(cutoff, t, 0.1);
    }
    if (this.engineOsc) {
      const freq =
        state.engine === "prop"
          ? 70 + throttle * 90
          : state.engine === "rotor"
            ? 28 + throttle * 36
            : 55 + throttle * 70;
      this.engineOsc.frequency.setTargetAtTime(freq, t, 0.1);
    }
    if (this.engineOsc2) {
      const freq =
        state.engine === "prop"
          ? 35 + throttle * 40
          : state.engine === "rotor"
            ? 12 + throttle * 16
            : 28 + throttle * 30;
      this.engineOsc2.frequency.setTargetAtTime(freq, t, 0.1);
    }
    if (this.windGain) {
      const wind = flying ? Math.min(0.28, (speed / 280) * 0.28) : 0;
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
