import { test } from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_VOLUME, parseVolume } from "../src/audio.ts";

test("missing or bad stored volume defaults to audible, not 0", () => {
  assert.equal(parseVolume(null), DEFAULT_VOLUME);
  assert.equal(parseVolume(undefined), DEFAULT_VOLUME);
  assert.equal(parseVolume(""), DEFAULT_VOLUME);
  assert.equal(parseVolume("abc"), DEFAULT_VOLUME);
  assert.ok(DEFAULT_VOLUME > 0.3);
  assert.equal(parseVolume("0.4"), 0.4);
  assert.equal(parseVolume("0"), 0);
  assert.equal(parseVolume("7"), 1);
});

import { migrateAudioPrefs, AUDIO_PREFS_VERSION_KEY } from "../src/audio.ts";
const mem = (init: Record<string, string>) => {
  const m = new Map(Object.entries(init));
  return {
    getItem: (k: string) => (m.has(k) ? m.get(k)! : null),
    setItem: (k: string, v: string) => void m.set(k, v),
    removeItem: (k: string) => void m.delete(k),
    m,
  };
};

test("stale saved mute / zero volume from before the fix are reset once", () => {
  const s = mem({ "maddflight-muted": "1", "maddflight-volume": "0" });
  migrateAudioPrefs(s);
  assert.equal(s.getItem("maddflight-muted"), "0");
  assert.equal(s.getItem("maddflight-volume"), null);
  assert.equal(parseVolume(s.getItem("maddflight-volume")), DEFAULT_VOLUME);
  assert.equal(s.getItem(AUDIO_PREFS_VERSION_KEY), "2");
  // After migration, a deliberate mute is respected.
  s.setItem("maddflight-muted", "1");
  migrateAudioPrefs(s);
  assert.equal(s.getItem("maddflight-muted"), "1");
});

test("a real saved volume survives the migration", () => {
  const s = mem({ "maddflight-volume": "0.4" });
  migrateAudioPrefs(s);
  assert.equal(s.getItem("maddflight-volume"), "0.4");
});

test("engine/wind noise is pink (little hiss), normalised, and loops without a click", async () => {
  const { fillPinkNoise } = await import("../src/audio.ts");
  let seed = 12345;
  const rand = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
  const sr = 48000;
  const data = new Float32Array(sr * 2);
  const len = fillPinkNoise(data, sr, rand);
  assert.ok(len > sr * 1.9 && len < sr * 2);
  let peak = 0, mean = 0;
  for (let i = 0; i < len; i++) { peak = Math.max(peak, Math.abs(data[i])); mean += data[i]; }
  assert.ok(peak <= 0.9 + 1e-6 && peak > 0.5, `peak ${peak}`);
  assert.ok(Math.abs(mean / len) < 0.02, `dc ${mean / len}`);
  // High-frequency content: mean |first difference| vs mean |sample|. White
  // noise is ~1.1; pink noise is much smoother.
  let d = 0, a = 0;
  for (let i = 1; i < len; i++) { d += Math.abs(data[i] - data[i - 1]); a += Math.abs(data[i]); }
  assert.ok(d / a < 0.75, `hf ratio ${d / a}`);
  // Loop seam: the wrap-around step is no bigger than a typical step.
  const seam = Math.abs(data[0] - data[len - 1]);
  assert.ok(seam < 4 * (d / len) + 0.05, `seam ${seam}`);
});
