// Procedural afterburner plumes for the stealth fighter (original, CC0).
// Two nodes, mf_ab_L / mf_ab_R, sit exactly on the fighter.glb nozzle exits
// (after its pivot re-centre) and point aft (-Z, glTF; nose is +Z). Each plume
// is authored 1 m long; the app scales its length / radius with throttle and
// flickers it every frame (src/afterburner.ts). Unlit + vertex-colour alpha
// gradient: blue-white core at the nozzle → orange → transparent tail, with
// three bright shock diamonds.
//   npm i --no-save @gltf-transform/core @gltf-transform/extensions
//   node scripts/build-afterburner.mjs public/models/afterburner.glb
import { Document, NodeIO } from "@gltf-transform/core";
import { KHRMaterialsUnlit } from "@gltf-transform/extensions";

const out = process.argv[2] || "public/models/afterburner.glb";
const NOZZLES = { mf_ab_L: [0.62, -0.04, -8.05], mf_ab_R: [-0.62, -0.04, -8.05] };
const R = 0.5; // nozzle exit radius (m)
const doc = new Document();
const buffer = doc.createBuffer();
const unlit = doc.createExtension(KHRMaterialsUnlit);
const scene = doc.createScene("Afterburner");
const mat = doc
  .createMaterial("plume")
  .setBaseColorFactor([1, 1, 1, 1])
  .setAlphaMode("BLEND")
  .setDoubleSided(true)
  .setExtension("KHR_materials_unlit", unlit.createUnlit());

/** Lathe along -Z: profile(t) → [radius, rgba]. t = 0 at the nozzle. */
function lathe(z0, len, rings, seg, profile) {
  const pos = [], col = [], idx = [];
  for (let i = 0; i <= rings; i++) {
    const t = i / rings;
    const [r, c] = profile(t);
    for (let j = 0; j < seg; j++) {
      const a = (j / seg) * Math.PI * 2;
      pos.push(Math.cos(a) * r, Math.sin(a) * r, z0 - t * len);
      col.push(...c);
    }
  }
  for (let i = 0; i < rings; i++)
    for (let j = 0; j < seg; j++) {
      const a = i * seg + j, b = i * seg + ((j + 1) % seg), c = a + seg, d = b + seg;
      idx.push(a, c, b, b, c, d);
    }
  return { pos, col, idx };
}
const mix = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t);
const BLUE = [0.55, 0.75, 1, 0.95], WHITE = [1, 0.97, 0.9, 1], ORANGE = [1, 0.5, 0.12, 0.8], RED = [0.9, 0.2, 0.05, 0];

function plume() {
  const parts = [
    // outer flame
    lathe(0, 1, 16, 14, (t) => [R * (1 - 0.85 * Math.pow(t, 0.8)) * (1 + 0.12 * Math.sin(t * 9)),
      t < 0.18 ? mix(BLUE, ORANGE, t / 0.18) : mix(ORANGE, RED, (t - 0.18) / 0.82)]),
    // hot core
    lathe(0, 0.5, 8, 12, (t) => [R * 0.55 * (1 - t), mix(WHITE, [0.5, 0.7, 1, 0], t)]),
  ];
  // shock diamonds: double cones along the axis
  for (const c of [0.16, 0.32, 0.48]) {
    const l = 0.07;
    parts.push(lathe(-c + l, 2 * l, 4, 10, (t) => [R * 0.38 * Math.sin(Math.PI * t), [1, 0.92, 0.65, 0.95]]));
  }
  const pos = [], col = [], idx = [];
  for (const p of parts) {
    const base = pos.length / 3;
    pos.push(...p.pos); col.push(...p.col); idx.push(...p.idx.map((i) => i + base));
  }
  return { pos, col, idx };
}

for (const [name, at] of Object.entries(NOZZLES)) {
  const g = plume();
  const prim = doc
    .createPrimitive()
    .setAttribute("POSITION", doc.createAccessor().setType("VEC3").setArray(new Float32Array(g.pos)).setBuffer(buffer))
    .setAttribute("COLOR_0", doc.createAccessor().setType("VEC4").setArray(new Float32Array(g.col)).setBuffer(buffer))
    .setIndices(doc.createAccessor().setType("SCALAR").setArray(new Uint16Array(g.idx)).setBuffer(buffer))
    .setMaterial(mat);
  scene.addChild(doc.createNode(name).setTranslation(at).setMesh(doc.createMesh(name).addPrimitive(prim)));
}
await new NodeIO().registerExtensions([KHRMaterialsUnlit]).write(out, doc);
console.log("wrote", out);
