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
