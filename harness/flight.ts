// Dev-only harness (not in the production build): flies one aircraft in real
// time with the app's flight model, chase camera, model orientation and
// spinning rotor/prop rig, over a flat ground at 0 m. Keyboard works as in
// the app; Playwright drives it via key presses and reads window.info.
//   /harness/flight.html?id=bell206&ground=1&view=chase
import * as C from "cesium";
import "cesium/Build/Cesium/Widgets/widgets.css";
import { aircraftById } from "../src/aircraft";
import { modelOrientation } from "../src/attitude";
import { computeExteriorCamera, type ExteriorCameraMode } from "../src/camera";
import { keyboardControls } from "../src/controls";
import { gearHeight, rotorParams, spawnAircraft, stepAircraft } from "../src/flight-model";
import { hoverTrimCollective } from "../src/heli";
import { RotorAnimator } from "../src/rotors";
const q = new URLSearchParams(location.search);
const spec = aircraftById(q.get("id"));
const onGround = q.get("ground") === "1";
const view = (q.get("view") || "chase") as ExteriorCameraMode | "side";
const lat = 37.62, lon = -122.2;
let f = spawnAircraft(spec, lat, lon, onGround ? gearHeight(spec) : Number(q.get("alt") || 120), Number(q.get("h") || 90), Number(q.get("kt") || 0) / 1.943844, false, onGround);
if (q.get("thr")) f = { ...f, throttle: Number(q.get("thr")) };
const v = new C.Viewer("c", { baseLayer: false, baseLayerPicker: false, geocoder: false, timeline: false, animation: false, homeButton: false, sceneModePicker: false, navigationHelpButton: false, infoBox: false, selectionIndicator: false, fullscreenButton: false });
v.scene.globe.baseColor = C.Color.fromCssColorString("#4f7a46");
v.scene.backgroundColor = C.Color.fromCssColorString("#bcd3e6");
for (let i = -8; i <= 8; i++) for (let j = -8; j <= 8; j++) v.entities.add({ position: C.Cartesian3.fromDegrees(lon + i * 0.0006, lat + j * 0.0006, 0), point: { pixelSize: 5, color: i === 0 || j === 0 ? C.Color.YELLOW : C.Color.WHITE } });
const rotors = new RotorAnimator();
v.entities.add({
  position: new C.CallbackPositionProperty(() => C.Cartesian3.fromDegrees(f.lon, f.lat, f.alt), false),
  orientation: new C.CallbackProperty(() => modelOrientation(C.Cartesian3.fromDegrees(f.lon, f.lat, f.alt), f.heading, f.pitch, f.roll, spec.modelFix), false),
  model: { uri: spec.uri, minimumPixelSize: 80, maximumScale: 1, nodeTransformations: rotors.nodeTransformations(() => spec) },
});
const keys = new Set<string>();
addEventListener("keydown", (e) => {
  const k = e.key.toLowerCase();
  keys.add(k);
  const rotor = rotorParams(spec);
  if (k === "h" && rotor) f = { ...f, throttle: hoverTrimCollective(f, 0, rotor) };
});
addEventListener("keyup", (e) => keys.delete(e.key.toLowerCase()));
let last = performance.now(), acc = 0, simTime = 0, maxRpm = 0;
const errors: string[] = [];
v.clock.onTick.addEventListener(() => {
  const now = performance.now(), dt = Math.min((now - last) / 1000, 0.1);
  last = now;
  rotors.update(spec, f, dt, true);
  maxRpm = Math.max(maxRpm, rotors.rpm);
  const c = keyboardControls(keys);
  acc += dt;
  while (acc >= 1 / 120) { f = stepAircraft(spec, f, c, 1 / 120, 0); acc -= 1 / 120; simTime += 1 / 120; }
  const R = spec.radiusMeters;
  if (view === "side") {
    const pos = C.Cartesian3.fromDegrees(f.lon, f.lat, f.alt);
    const enu = C.Transforms.eastNorthUpToFixedFrame(pos);
    const hr = (f.heading * Math.PI) / 180;
    // Camera on the aircraft's right side, slightly ahead and above.
    const ahead = Number(q.get("ahead") || 1.2), side = Number(q.get("side") || 4.2);
    const off = new C.Cartesian3(Math.cos(hr) * R * side + Math.sin(hr) * R * ahead, -Math.sin(hr) * R * side + Math.cos(hr) * R * ahead, R * 0.6);
    const cam = C.Matrix4.multiplyByPoint(enu, off, new C.Cartesian3());
    const dir = C.Cartesian3.normalize(C.Cartesian3.subtract(pos, cam, new C.Cartesian3()), new C.Cartesian3());
    v.camera.setView({ destination: cam, orientation: { direction: dir, up: C.Matrix4.multiplyByPointAsVector(enu, C.Cartesian3.UNIT_Z, new C.Cartesian3()) } });
  } else {
    const pose = computeExteriorCamera({ ...f, mode: view }, v.scene.canvas.clientWidth / Math.max(1, v.scene.canvas.clientHeight), R);
    v.camera.setView({ destination: pose.destination, orientation: { direction: pose.direction, up: pose.up } });
  }
  const info = {
    id: spec.id, t: +simTime.toFixed(2), alt: +f.alt.toFixed(2), vs: +f.vs.toFixed(2), kt: +(f.speed * 1.943844).toFixed(1),
    hdg: +f.heading.toFixed(1), pitch: +f.pitch.toFixed(1), roll: +f.roll.toFixed(1), collective: +f.throttle.toFixed(3),
    onGround: !!f.onGround, crashed: f.crashed, stall: f.stall, rpm: +rotors.rpm.toFixed(3), maxRpm: +maxRpm.toFixed(3),
    angles: Object.fromEntries(["mf_main_rotor", "mf_tail_rotor", "mf_prop", "mf_saucer_ring"].map((n) => [n, +rotors.angle(n).toFixed(3)])),
    lat: f.lat, lon: f.lon, errors,
  };
  (window as any).info = info;
  document.getElementById("l")!.textContent = `${spec.name}  t=${info.t}s  alt ${info.alt} m  VS ${Math.round(f.vs * 196.85)} fpm  ${info.kt} kt  HDG ${Math.round(f.heading)}\n${rotorParams(spec) ? "collective" : "throttle"} ${Math.round(f.throttle * 100)}%  rpm ${Math.round(rotors.rpm * 100)}%  ${f.onGround ? "ON GROUND" : "AIRBORNE"}${f.crashed ? " CRASHED" : ""}${f.stall ? " STALL" : ""}`;
});
(window as any).ready = false;
const t0 = performance.now();
v.scene.postRender.addEventListener(() => { if (performance.now() - t0 > 5000) (window as any).ready = true; });
