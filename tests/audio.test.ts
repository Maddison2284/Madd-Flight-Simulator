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
