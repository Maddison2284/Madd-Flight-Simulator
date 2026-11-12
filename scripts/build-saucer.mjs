// Procedural "MADD Saucer" model (original, CC0). The ChatGPT-era build loaded
// /models/saucer.glb but that binary was not in git, PATCHES, or any backup,
// so this rebuilds one. glTF is Y up; the nose (red marker) is +X.
// Node "mf_saucer_ring" carries the glowing light ring and spins in the app.
//   npm i --no-save @gltf-transform/core @gltf-transform/extensions
//   node scripts/build-saucer.mjs public/models/saucer.glb
import { Document, NodeIO } from "@gltf-transform/core";
import { KHRMaterialsEmissiveStrength } from "@gltf-transform/extensions";

const out = process.argv[2] || "public/models/saucer.glb";
const doc = new Document();
const buffer = doc.createBuffer();
const strength = doc.createExtension(KHRMaterialsEmissiveStrength);
const scene = doc.createScene("Saucer");

function mesh(name, positions, indices, material) {
  const normals = new Float32Array(positions.length);
  for (let i = 0; i < indices.length; i += 3) {
    const [a, b, c] = [indices[i] * 3, indices[i + 1] * 3, indices[i + 2] * 3];
    const u = [0, 1, 2].map((k) => positions[b + k] - positions[a + k]);
    const v = [0, 1, 2].map((k) => positions[c + k] - positions[a + k]);
    const n = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
    for (const p of [a, b, c]) for (let k = 0; k < 3; k++) normals[p + k] += n[k];
  }
  for (let i = 0; i < normals.length; i += 3) {
    const l = Math.hypot(normals[i], normals[i + 1], normals[i + 2]) || 1;
    normals[i] /= l; normals[i + 1] /= l; normals[i + 2] /= l;
  }
  const prim = doc.createPrimitive().setMaterial(material)
    .setAttribute("POSITION", doc.createAccessor().setType("VEC3").setArray(new Float32Array(positions)).setBuffer(buffer))
    .setAttribute("NORMAL", doc.createAccessor().setType("VEC3").setArray(normals).setBuffer(buffer))
    .setIndices(doc.createAccessor().setType("SCALAR").setArray(new Uint32Array(indices)).setBuffer(buffer));
  return doc.createMesh(name).addPrimitive(prim);
}

/** Surface of revolution about Y from a (radius, y) profile, outward facing. */
function lathe(profile, seg = 72, cx = 0, cz = 0) {
  const pos = [], ind = [];
  for (let i = 0; i <= seg; i++) {
    const t = (i / seg) * Math.PI * 2;
    for (const [r, y] of profile) pos.push(cx + Math.cos(t) * r, y, cz + Math.sin(t) * r);
  }
  const n = profile.length;
  for (let i = 0; i < seg; i++)
    for (let k = 0; k < n - 1; k++) {
      const a = i * n + k, b = (i + 1) * n + k;
      ind.push(a, a + 1, b, b, a + 1, b + 1);
    }
  return { pos, ind };
}
function sphere(r, cx, cy, cz, seg = 16) {
  const prof = [];
  for (let k = 0; k <= seg / 2; k++) {
    const a = -Math.PI / 2 + (k / (seg / 2)) * Math.PI;
    prof.push([Math.max(1e-4, Math.cos(a) * r), cy + Math.sin(a) * r]);
  }
  return lathe(prof, seg, cx, cz);
}
function merge(parts) {
  const pos = [], ind = [];
  for (const p of parts) {
    const base = pos.length / 3;
    pos.push(...p.pos);
    ind.push(...p.ind.map((i) => i + base));
  }
  return { pos, ind };
}
const mat = (name, color, { metal = 0.8, rough = 0.35, emissive, strengthV, alpha } = {}) => {
  const m = doc.createMaterial(name).setBaseColorFactor([...color, alpha ?? 1]).setMetallicFactor(metal).setRoughnessFactor(rough).setDoubleSided(true);
  if (alpha !== undefined) m.setAlphaMode("BLEND").setDoubleSided(true);
  if (emissive) {
    m.setEmissiveFactor(emissive);
    if (strengthV) m.setExtension("KHR_materials_emissive_strength", strength.createEmissiveStrength().setEmissiveStrength(strengthV));
  }
  return m;
};

// Hull: lower and upper skins meeting at a sharp rim (r = 5 m).
const hullProfile = [[0.001, -0.9], [1.4, -0.86], [2.6, -0.7], [3.8, -0.42], [4.6, -0.15], [5.0, 0], [4.6, 0.18], [3.6, 0.38], [2.4, 0.55], [1.7, 0.62], [0.001, 0.62]];
const hull = lathe(hullProfile);
const hullNode = doc.createNode("hull").setMesh(mesh("hull", hull.pos, hull.ind, mat("hull", [0.62, 0.66, 0.72])));
// Glass dome.
const domeProf = [];
for (let k = 0; k <= 12; k++) { const a = (k / 12) * (Math.PI / 2); domeProf.push([Math.max(1e-3, Math.cos(a) * 1.65), 0.6 + Math.sin(a) * 1.25]); }
const dome = lathe(domeProf, 48);
const domeNode = doc.createNode("dome").setMesh(mesh("dome", dome.pos, dome.ind, mat("dome", [0.45, 0.9, 1.0], { metal: 0, rough: 0.05, alpha: 0.55, emissive: [0.05, 0.25, 0.3], strengthV: 1 })));
// Underside glow (tractor emitter) and nose marker.
const glow = lathe([[0.001, -0.93], [1.3, -0.9]], 48);
const glowNode = doc.createNode("under_glow").setMesh(mesh("under_glow", glow.pos, glow.ind, mat("glow", [0.4, 1, 0.9], { metal: 0, rough: 1, emissive: [0.35, 1, 0.85], strengthV: 4 })));
const nose = sphere(0.22, 4.95, 0.05, 0);
const noseNode = doc.createNode("nose_light").setMesh(mesh("nose_light", nose.pos, nose.ind, mat("nose", [1, 0.2, 0.2], { metal: 0, rough: 0.5, emissive: [1, 0.15, 0.1], strengthV: 4 })));
// Landing legs (3) ending at y = -1.4 (gear height 1.4 m).
const legs = merge([0, 1, 2].map((i) => {
  const t = (i / 3) * Math.PI * 2 + Math.PI / 3; const x = Math.cos(t) * 2.4, z = Math.sin(t) * 2.4;
  return merge([lathe([[0.09, -1.35], [0.09, -0.7]], 8, x, z), lathe([[0.001, -1.4], [0.35, -1.4], [0.35, -1.33], [0.001, -1.33]], 12, x, z)]);
}));
const legNode = doc.createNode("legs").setMesh(mesh("legs", legs.pos, legs.ind, mat("legs", [0.3, 0.32, 0.36])));
// Spinning light ring: emissive band + 16 pods alternating cyan / magenta.
const ring = doc.createNode("mf_saucer_ring");
const band = lathe([[4.25, -0.2], [4.5, -0.13], [4.5, -0.09], [4.25, -0.16]], 96);
ring.addChild(doc.createNode("ring_band").setMesh(mesh("ring_band", band.pos, band.ind, mat("band", [0.3, 0.95, 1], { metal: 0, rough: 0.6, emissive: [0.2, 0.85, 1], strengthV: 3 }))));
const podsA = [], podsB = [];
for (let i = 0; i < 16; i++) { const t = (i / 16) * Math.PI * 2; (i % 2 ? podsB : podsA).push(sphere(0.2, Math.cos(t) * 4.35, -0.24, Math.sin(t) * 4.35, 12)); }
const pa = merge(podsA), pb = merge(podsB);
ring.addChild(doc.createNode("pods_a").setMesh(mesh("pods_a", pa.pos, pa.ind, mat("pod_a", [0.4, 1, 1], { metal: 0, rough: 0.4, emissive: [0.3, 1, 1], strengthV: 5 }))));
ring.addChild(doc.createNode("pods_b").setMesh(mesh("pods_b", pb.pos, pb.ind, mat("pod_b", [1, 0.4, 1], { metal: 0, rough: 0.4, emissive: [1, 0.3, 0.95], strengthV: 5 }))));
for (const n of [hullNode, domeNode, glowNode, noseNode, legNode, ring]) scene.addChild(n);
doc.getRoot().setDefaultScene(scene);
await new NodeIO().registerExtensions([KHRMaterialsEmissiveStrength]).write(out, doc);
console.log("wrote", out);
