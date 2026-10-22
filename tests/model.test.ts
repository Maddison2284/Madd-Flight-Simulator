import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
test("shipped model is a complete glTF 2 binary with valid geometry", () => {
  const b = readFileSync(
    new URL("../public/models/business-jet.glb", import.meta.url),
  );
  assert.equal(b.readUInt32LE(0), 0x46546c67);
  assert.equal(b.readUInt32LE(4), 2);
  assert.equal(b.readUInt32LE(8), b.length);
  const jlen = b.readUInt32LE(12);
  const g = JSON.parse(b.subarray(20, 20 + jlen).toString());
  assert.equal(g.asset.version, "2.0");
  assert.ok(g.accessors[0].count > 100);
  const offset = 20 + jlen + 8 + g.bufferViews[1].byteOffset;
  for (let i = 0; i < g.accessors[1].count; i++)
    assert.ok(b.readUInt32LE(offset + i * 4) < g.accessors[0].count);
});
