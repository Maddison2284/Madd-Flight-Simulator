// Append every scene root of a simple (single-buffer, uncompressed) GLB into
// another GLB as extra scene roots, without re-encoding the target's
// compressed (meshopt / Basis) data. Used to add the afterburner plumes to
// fighter.glb.  usage: node scripts/merge-glb.mjs target.glb extra.glb out.glb
import { readFileSync, writeFileSync } from "node:fs";
const read = (f) => {
  const b = readFileSync(f), jl = b.readUInt32LE(12);
  const json = JSON.parse(b.subarray(20, 20 + jl).toString());
  const o = 20 + jl; const bl = b.readUInt32LE(o);
  return { json, bin: b.subarray(o + 8, o + 8 + bl) };
};
const [tf, ef, out] = process.argv.slice(2);
const t = read(tf), e = read(ef);
const pad = (n) => (4 - (n % 4)) % 4;
const binBuffer = t.json.buffers.findIndex((b) => b.uri === undefined);
if (binBuffer < 0) throw Error("target has no GLB-stored buffer");
const base = t.bin.length + pad(t.bin.length);
const off = (k) => (t.json[k] = t.json[k] || []).length;
const bvOff = off("bufferViews"), accOff = off("accessors"), matOff = off("materials"), meshOff = off("meshes"), nodeOff = off("nodes");
for (const bv of e.json.bufferViews) t.json.bufferViews.push({ ...bv, buffer: binBuffer, byteOffset: base + (bv.byteOffset || 0) });
for (const a of e.json.accessors) t.json.accessors.push({ ...a, bufferView: a.bufferView + bvOff });
for (const m of e.json.materials || []) t.json.materials.push(m);
for (const m of e.json.meshes) t.json.meshes.push({ ...m, primitives: m.primitives.map((p) => ({ ...p, material: p.material === undefined ? undefined : p.material + matOff, indices: p.indices + accOff, attributes: Object.fromEntries(Object.entries(p.attributes).map(([k, v]) => [k, v + accOff])) })) });
for (const n of e.json.nodes) t.json.nodes.push({ ...n, mesh: n.mesh === undefined ? undefined : n.mesh + meshOff, children: n.children?.map((c) => c + nodeOff) });
t.json.scenes[t.json.scene ?? 0].nodes.push(...e.json.scenes[e.json.scene ?? 0].nodes.map((n) => n + nodeOff));
t.json.extensionsUsed = [...new Set([...(t.json.extensionsUsed || []), ...(e.json.extensionsUsed || [])])];
const bin = Buffer.concat([t.bin, Buffer.alloc(pad(t.bin.length)), e.bin, Buffer.alloc(pad(e.bin.length))]);
t.json.buffers[binBuffer].byteLength = bin.length;
let json = Buffer.from(JSON.stringify(t.json));
json = Buffer.concat([json, Buffer.alloc(pad(json.length), 0x20)]);
const h = Buffer.alloc(12); h.writeUInt32LE(0x46546c67, 0); h.writeUInt32LE(2, 4); h.writeUInt32LE(12 + 8 + json.length + 8 + bin.length, 8);
const jh = Buffer.alloc(8); jh.writeUInt32LE(json.length, 0); jh.writeUInt32LE(0x4e4f534a, 4);
const bh = Buffer.alloc(8); bh.writeUInt32LE(bin.length, 0); bh.writeUInt32LE(0x004e4942, 4);
writeFileSync(out, Buffer.concat([h, jh, json, bh, bin]));
console.log("wrote", out, bin.length);
