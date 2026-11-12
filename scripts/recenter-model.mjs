// Re-centre a GLB's pivot by adding a translation to its scene root nodes,
// editing only the JSON chunk (binary/compressed buffers untouched).
// usage: node scripts/recenter-model.mjs in.glb out.glb dx dy dz   (glTF axes, metres)
import { readFileSync, writeFileSync } from "node:fs";
const [inp, out, dx, dy, dz] = process.argv.slice(2);
const b = readFileSync(inp);
const jlen = b.readUInt32LE(12);
const g = JSON.parse(b.subarray(20, 20 + jlen).toString());
const rest = b.subarray(20 + jlen);
const d = [+dx, +dy, +dz];
for (const i of g.scenes[g.scene ?? 0].nodes) {
  const n = g.nodes[i];
  if (n.matrix) { n.matrix[12] += d[0]; n.matrix[13] += d[1]; n.matrix[14] += d[2]; }
  else n.translation = (n.translation ?? [0, 0, 0]).map((v, k) => +(v + d[k]).toFixed(4));
}
let json = Buffer.from(JSON.stringify(g));
json = Buffer.concat([json, Buffer.alloc((4 - (json.length % 4)) % 4, 0x20)]);
const head = Buffer.alloc(20);
head.writeUInt32LE(0x46546c67, 0); head.writeUInt32LE(2, 4);
head.writeUInt32LE(20 + json.length + rest.length, 8);
head.writeUInt32LE(json.length, 12); head.writeUInt32LE(0x4e4f534a, 16);
writeFileSync(out, Buffer.concat([head, json, rest]));
console.log("wrote", out);
