// Splits the baked-in rotor / propeller blades out of the source GLBs into
// separately named nodes (pivot at the hub) and adds translucent motion-blur
// discs, so the app can spin them with Cesium nodeTransformations.
// Usage (deps are not part of the app build):
//   npm i --no-save @gltf-transform/core @gltf-transform/extensions
//   node scripts/rig-rotors.mjs <sourceModelDir> public/models
import { NodeIO } from "@gltf-transform/core";
import { ALL_EXTENSIONS } from "@gltf-transform/extensions";
import path from "node:path";

const [srcDir, outDir] = process.argv.slice(2);
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);

/** Rig specs in native glTF model coordinates (Y up). axis: spin axis index. */
const RIGS = {
  "bell206.glb": [
    { name: "mf_main_rotor", pivot: [-0.495, 1.32, 0], axis: 1, radius: 5.7,
      pick: (min, max) => min[1] >= 1.14 },
    { name: "mf_tail_rotor", pivot: [5.12, 0.235, 0.17], axis: 2, radius: 0.85,
      pick: (min, max) => min[0] >= 4.2 && max[0] <= 6.0 && min[1] >= 0.05 && max[1] <= 0.45 && min[2] >= 0.1 && max[2] <= 0.25 },
  ],
  "c172.glb": [
    { name: "mf_prop", pivot: [-3.78, -0.13, 0.01], axis: 0, radius: 0.95,
      pick: (min, max) => max[0] <= -3.7 && min[0] >= -4.2 },
  ],
};

function components(prim) {
  const pos = prim.getAttribute("POSITION");
  const n = pos.getCount();
  const idx = prim.getIndices();
  const tri = idx ? Array.from(idx.getArray()) : [...Array(n).keys()];
  const parent = Int32Array.from({ length: n }, (_, i) => i);
  const find = (i) => { while (parent[i] !== i) { parent[i] = parent[parent[i]]; i = parent[i]; } return i; };
  const union = (a, b) => { a = find(a); b = find(b); if (a !== b) parent[a] = b; };
  const seen = new Map();
  for (let i = 0; i < n; i++) {
    const k = pos.getElement(i, []).map((x) => Math.round(x * 1000)).join(",");
    if (seen.has(k)) union(i, seen.get(k)); else seen.set(k, i);
  }
  for (let t = 0; t < tri.length; t += 3) { union(tri[t], tri[t + 1]); union(tri[t], tri[t + 2]); }
  const comps = new Map();
  for (let t = 0; t < tri.length; t += 3) {
    const r = find(tri[t]);
    if (!comps.has(r)) comps.set(r, { tris: [], min: [1e9, 1e9, 1e9], max: [-1e9, -1e9, -1e9] });
    const c = comps.get(r);
    c.tris.push(t);
    for (const j of tri.slice(t, t + 3)) {
      const v = pos.getElement(j, []);
      for (let d = 0; d < 3; d++) { c.min[d] = Math.min(c.min[d], v[d]); c.max[d] = Math.max(c.max[d], v[d]); }
    }
  }
  return { tri, comps: [...comps.values()] };
}

function discMesh(doc, rig, buffer) {
  const seg = 64, r0 = rig.radius * 0.12, R = rig.radius;
  const rings = [r0, R * 0.55, R * 0.9, R];
  const alpha = [0.12, 0.3, 0.42, 0.18];
  const pos = [], col = [], ind = [];
  const [a, b] = [0, 1, 2].filter((d) => d !== rig.axis);
  for (let i = 0; i <= seg; i++) {
    const t = (i / seg) * Math.PI * 2;
    rings.forEach((r, k) => {
      const p = [0, 0, 0]; p[a] = Math.cos(t) * r; p[b] = Math.sin(t) * r;
      pos.push(...p); col.push(0.12, 0.12, 0.13, alpha[k]);
    });
  }
  const per = rings.length;
  for (let i = 0; i < seg; i++)
    for (let k = 0; k < per - 1; k++) {
      const q = i * per + k, w = (i + 1) * per + k;
      ind.push(q, w, q + 1, q + 1, w, w + 1);
    }
  const mat = doc.createMaterial(rig.name + "_disc_mat").setBaseColorFactor([1, 1, 1, 1])
    .setAlphaMode("BLEND").setDoubleSided(true).setMetallicFactor(0).setRoughnessFactor(1);
  const prim = doc.createPrimitive().setMaterial(mat)
    .setAttribute("POSITION", doc.createAccessor().setType("VEC3").setArray(new Float32Array(pos)).setBuffer(buffer))
    .setAttribute("COLOR_0", doc.createAccessor().setType("VEC4").setArray(new Float32Array(col)).setBuffer(buffer))
    .setIndices(doc.createAccessor().setType("SCALAR").setArray(new Uint16Array(ind)).setBuffer(buffer));
  return doc.createMesh(rig.name + "_disc").addPrimitive(prim);
}

for (const [file, rigs] of Object.entries(RIGS)) {
  const doc = await io.read(path.join(srcDir, file));
  const root = doc.getRoot();
  const buffer = root.listBuffers()[0];
  const scene = root.listScenes()[0];
  for (const rig of rigs) {
    const spun = doc.createNode(rig.name).setTranslation(rig.pivot);
    let moved = 0;
    for (const node of root.listNodes()) {
      const mesh = node.getMesh();
      if (!mesh || node.getName().startsWith("mf_")) continue;
      for (const prim of mesh.listPrimitives()) {
        const { tri, comps } = components(prim);
        const take = new Set();
        for (const c of comps) if (rig.pick(c.min, c.max)) c.tris.forEach((t) => take.add(t));
        if (!take.size) continue;
        const keep = [], picked = [];
        for (let t = 0; t < tri.length; t += 3) (take.has(t) ? picked : keep).push(tri[t], tri[t + 1], tri[t + 2]);
        // New primitive holding only the picked triangles, re-centred on the pivot.
        const remap = new Map(); const order = [];
        for (const v of picked) if (!remap.has(v)) { remap.set(v, order.length); order.push(v); }
        const np = doc.createPrimitive().setMaterial(prim.getMaterial());
        for (const sem of prim.listSemantics()) {
          const src = prim.getAttribute(sem);
          const size = src.getElementSize();
          const arr = new Float32Array(order.length * size);
          order.forEach((v, i) => {
            const el = src.getElement(v, []);
            if (sem === "POSITION") for (let d = 0; d < 3; d++) el[d] -= rig.pivot[d];
            arr.set(el, i * size);
          });
          np.setAttribute(sem, doc.createAccessor().setType(src.getType()).setArray(arr).setBuffer(buffer));
        }
        np.setIndices(doc.createAccessor().setType("SCALAR").setArray(new Uint32Array(picked.map((v) => remap.get(v)))).setBuffer(buffer));
        const idx = prim.getIndices();
        const KeepArr = order.length > 65535 || prim.getAttribute("POSITION").getCount() > 65535 ? Uint32Array : Uint32Array;
        if (idx) idx.setArray(new KeepArr(keep));
        else prim.setIndices(doc.createAccessor().setType("SCALAR").setArray(new KeepArr(keep)).setBuffer(buffer));
        spun.setMesh(doc.createMesh(rig.name + "_blades").addPrimitive(np));
        moved += picked.length / 3;
      }
    }
    if (!moved) throw new Error(`${file}: nothing picked for ${rig.name}`);
    const disc = doc.createNode(rig.name + "_disc").setTranslation(rig.pivot).setScale([0.001, 0.001, 0.001]).setMesh(discMesh(doc, rig, buffer));
    scene.addChild(spun).addChild(disc);
    console.log(file, rig.name, "triangles moved", moved);
  }
  await io.write(path.join(outDir, file), doc);
}
