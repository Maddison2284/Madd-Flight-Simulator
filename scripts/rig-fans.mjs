// Rigs spinning engine fans into the jet GLBs so the app can turn them with
// Cesium nodeTransformations (src/rotors.ts):
//  - a320.glb: the model already has a textured fan face + spinner cone per
//    engine, baked into the single airframe mesh. The cone and a copy of the
//    face move to `mf_fan_N` (pivot on the fan axis, a hair in front of the
//    original face, which stays put as a static backing so the rim never
//    shows a gap while the 16-sided face turns).
//  - citation2.glb: its baked texture has no fan, just a dark intake; a fan
//    disc (scripts/fan-textures.py art) is placed inside each intake.
// Each fan also gets two translucent motion-blur discs, `mf_fan_N_blur1/2`,
// authored at scale 0.001 and shown by the app as N1 rises.
// Usage (deps are not part of the app build):
//   npm i --no-save @gltf-transform/core @gltf-transform/extensions draco3dgltf
//   python3 scripts/fan-textures.py <a320 atlas.webp> <texDir>
//   node scripts/rig-fans.mjs <sourceModelDir> <texDir> public/models
import { NodeIO } from "@gltf-transform/core";
import { ALL_EXTENSIONS } from "@gltf-transform/extensions";
import draco3d from "draco3dgltf";
import fs from "node:fs";
import path from "node:path";

const [srcDir, texDir, outDir] = process.argv.slice(2);
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({
  "draco3d.decoder": await draco3d.createDecoderModule(),
  "draco3d.encoder": await draco3d.createEncoderModule(),
});

const acc = (doc, buffer, type, arr) => doc.createAccessor().setType(type).setArray(arr).setBuffer(buffer);

function texture(doc, file) {
  return doc.createTexture(path.basename(file)).setImage(fs.readFileSync(path.join(texDir, file))).setMimeType("image/png");
}

/** Flat textured disc in the plane normal to `axis`, facing `facing` (±1),
 * offset `lift` along the axis. UVs map the full texture square. */
function disc(doc, buffer, name, { axis, facing, radius, lift = 0, material, seg = 48 }) {
  const [a, b] = [0, 1, 2].filter((d) => d !== axis);
  const pos = [0, 0, 0], nor = [0, 0, 0], uv = [0.5, 0.5], ind = [];
  pos[axis] = lift; nor[axis] = facing;
  for (let i = 0; i <= seg; i++) {
    const t = (i / seg) * Math.PI * 2, p = [0, 0, 0], n = [0, 0, 0];
    p[a] = Math.cos(t) * radius; p[b] = Math.sin(t) * radius; p[axis] = lift; n[axis] = facing;
    pos.push(...p); nor.push(...n); uv.push(0.5 + 0.5 * Math.cos(t), 0.5 - 0.5 * Math.sin(t));
  }
  for (let i = 1; i <= seg; i++) {
    // Winding so the front face points along `facing` on the given axis.
    const ccw = (facing > 0) === ((axis + 1) % 3 === a);
    ind.push(...(ccw ? [0, i, i + 1] : [0, i + 1, i]));
  }
  const prim = doc.createPrimitive().setMaterial(material)
    .setAttribute("POSITION", acc(doc, buffer, "VEC3", new Float32Array(pos)))
    .setAttribute("NORMAL", acc(doc, buffer, "VEC3", new Float32Array(nor)))
    .setAttribute("TEXCOORD_0", acc(doc, buffer, "VEC2", new Float32Array(uv)))
    .setIndices(acc(doc, buffer, "SCALAR", new Uint16Array(ind)));
  return doc.createMesh(name).addPrimitive(prim);
}

function blurMaterial(doc, file) {
  return doc.createMaterial("mf_fan_blur_" + file).setBaseColorTexture(texture(doc, file))
    .setAlphaMode("BLEND").setMetallicFactor(0).setRoughnessFactor(0.8).setDoubleSided(false);
}

function addBlur(doc, parent, name, pivot, mesh) {
  for (const k of [1, 2])
    parent.addChild(doc.createNode(`${name}_blur${k}`).setTranslation(pivot).setScale([0.001, 0.001, 0.001]).setMesh(mesh));
}

/** Union-find connected components of a triangle primitive. */
function components(prim) {
  const pos = prim.getAttribute("POSITION"), n = pos.getCount();
  const tri = Array.from(prim.getIndices().getArray());
  const parent = Int32Array.from({ length: n }, (_, i) => i);
  const find = (i) => { while (parent[i] !== i) { parent[i] = parent[parent[i]]; i = parent[i]; } return i; };
  const union = (x, y) => { x = find(x); y = find(y); if (x !== y) parent[x] = y; };
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

/** Copy the listed triangles of `prim` into a new primitive, minus `pivot`. */
function extract(doc, buffer, prim, tri, tris, pivot) {
  const remap = new Map(), order = [], ind = [];
  for (const t of tris) for (const v of tri.slice(t, t + 3)) {
    if (!remap.has(v)) { remap.set(v, order.length); order.push(v); }
    ind.push(remap.get(v));
  }
  const np = doc.createPrimitive().setMaterial(prim.getMaterial());
  for (const sem of prim.listSemantics()) {
    const src = prim.getAttribute(sem), size = src.getElementSize();
    const arr = new Float32Array(order.length * size);
    order.forEach((v, i) => {
      const el = src.getElement(v, []);
      if (sem === "POSITION") for (let d = 0; d < 3; d++) el[d] -= pivot[d];
      arr.set(el, i * size);
    });
    np.setAttribute(sem, acc(doc, buffer, src.getType(), arr));
  }
  return np.setIndices(acc(doc, buffer, "SCALAR", new Uint16Array(ind)));
}

async function rigA320() {
  const doc = await io.read(path.join(srcDir, "a320.glb"));
  const root = doc.getRoot(), buffer = root.listBuffers()[0];
  const body = root.listNodes().find((n) => n.getMesh());
  const prim = body.getMesh().listPrimitives()[0];
  const { tri, comps } = components(prim);
  // Mesh frame: x = span, y = forward (nose +y), z = down. The front fan
  // faces are flat discs at y ≈ 135.5 with a spinner cone to y ≈ 145.5.
  const fans = comps.filter((c) => Math.abs(c.min[1] - 135.5) < 0.5 && Math.abs(c.max[1] - 145.5) < 0.5)
    .sort((p, q) => p.min[0] - q.min[0]);
  if (fans.length !== 2) throw new Error("a320: expected 2 fan faces, found " + fans.length);
  const blurMesh = disc(doc, buffer, "mf_fan_blur_a320", {
    axis: 1, facing: 1, radius: ((fans[0].max[0] - fans[0].min[0]) / 2) * 0.99, lift: 1.6,
    material: blurMaterial(doc, "a320_fan_blur.png"),
  });
  const pos = prim.getAttribute("POSITION");
  const spinnerMat = doc.createMaterial("mf_fan_spinner").setBaseColorTexture(texture(doc, "a320_spinner.png"))
    .setMetallicFactor(0.4).setRoughnessFactor(0.45);
  const drop = new Set();
  fans.forEach((c, i) => {
    const name = `mf_fan_${i + 1}`;
    const pivot = [(c.min[0] + c.max[0]) / 2, c.min[1], (c.min[2] + c.max[2]) / 2];
    const isCone = (t) => tri.slice(t, t + 3).some((v) => pos.getElement(v, [])[1] > c.min[1] + 0.05);
    const cone = c.tris.filter(isCone), face = c.tris.filter((t) => !isCone(t));
    const shift = [pivot[0], pivot[1] - 1.0, pivot[2]];
    const facePrim = extract(doc, buffer, prim, tri, face, shift);
    // Spinner cone: own material with a white swirl, planar-mapped across
    // the hub, so the rotation is readable (the 24-blade face is
    // rotationally symmetric and looks the same at every angle).
    const conePrim = extract(doc, buffer, prim, tri, cone, shift).setMaterial(spinnerMat);
    const cp = conePrim.getAttribute("POSITION"), uv = [];
    let hub = 0;
    for (let i = 0; i < cp.getCount(); i++) { const v = cp.getElement(i, []); hub = Math.max(hub, Math.hypot(v[0], v[2])); }
    for (let i = 0; i < cp.getCount(); i++) { const v = cp.getElement(i, []); uv.push(0.5 + v[0] / (2 * hub), 0.5 + v[2] / (2 * hub)); }
    conePrim.setAttribute("TEXCOORD_0", acc(doc, buffer, "VEC2", new Float32Array(uv)));
    body.addChild(doc.createNode(name).setTranslation(pivot)
      .setMesh(doc.createMesh(name + "_blades").addPrimitive(facePrim).addPrimitive(conePrim)));
    addBlur(doc, body, name, pivot, blurMesh);
    // The spinner cone moves; the flat face stays as a static backing.
    cone.forEach((t) => drop.add(t));
    console.log("a320", name, "pivot", pivot.map((x) => x.toFixed(2)).join(","), "tris", c.tris.length);
  });
  const keep = [];
  for (let t = 0; t < tri.length; t += 3) if (!drop.has(t)) keep.push(tri[t], tri[t + 1], tri[t + 2]);
  prim.getIndices().setArray(new Uint16Array(keep));
  await io.write(path.join(outDir, "a320.glb"), doc);
}

async function rigCitation() {
  const doc = await io.read(path.join(srcDir, "citation2.glb"));
  const root = doc.getRoot(), buffer = root.listBuffers()[0], scene = root.listScenes()[0];
  // Native frame: x = aft (nose -x), y = up, z = span. Intake centres and
  // depth measured from the dark intake geometry (see PATCHES #27).
  const fanMat = doc.createMaterial("mf_fan_citation").setBaseColorTexture(texture(doc, "cit_fan.png"))
    .setMetallicFactor(0.35).setRoughnessFactor(0.55);
  const blades = disc(doc, buffer, "mf_fan_citation_blades", { axis: 0, facing: -1, radius: 0.4, material: fanMat });
  const blurMesh = disc(doc, buffer, "mf_fan_blur_citation", {
    axis: 0, facing: -1, radius: 0.39, lift: -0.012, material: blurMaterial(doc, "cit_fan_blur.png"),
  });
  [-1, 1].forEach((side, i) => {
    const name = `mf_fan_${i + 1}`, pivot = [2.17, -0.255, 1.29 * side];
    scene.addChild(doc.createNode(name).setTranslation(pivot).setMesh(blades));
    addBlur(doc, scene, name, pivot, blurMesh);
  });
  await io.write(path.join(outDir, "citation2.glb"), doc);
}

await rigA320();
await rigCitation();
