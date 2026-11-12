// Dev-only harness: renders one aircraft with the app's attitude math so
// orientation can be checked in screenshots. Not part of the production build.
import * as C from "cesium";
import "cesium/Build/Cesium/Widgets/widgets.css";
import { aircraftById } from "../src/aircraft";
import { modelOrientation } from "../src/attitude";
import { spawn, step } from "../src/physics";
import { keyboardControls } from "../src/controls";
const q = new URLSearchParams(location.search);
const spec = aircraftById(q.get("id"));
const raw = q.get("raw") === "1";
let h = Number(q.get("h") || 0), p = Number(q.get("p") || 0), r = Number(q.get("r") || 0);
// sim=<keys>: hold those keys for `secs` from level flight on heading h, then show the result.
const sim = q.get("sim");
let simNote = "";
if (sim !== null) {
  let f = spawn(37.7, -122.4, 1000, h, spec.defaultSpeedKt / 1.943844);
  const c = keyboardControls(new Set(sim.split(",").filter(Boolean)));
  const secs = Number(q.get("secs") || 2);
  for (let i = 0; i < secs * 120; i++) f = step(f, c, 1 / 120, 0, spec.performance);
  const track = (Math.atan2((f.lon + 122.4) * Math.cos((37.7 * Math.PI) / 180), f.lat - 37.7) * 180) / Math.PI;
  h = f.heading; p = f.pitch; r = f.roll;
  simNote = ` | held [${sim}] ${secs}s -> hdg ${f.heading.toFixed(0)} pitch ${f.pitch.toFixed(0)} bank ${f.roll.toFixed(0)} climb ${(f.alt - 1000).toFixed(0)}m`;
}
const view = q.get("view") || "top";
const v = new C.Viewer("c", { baseLayer: false, baseLayerPicker: false, geocoder: false, timeline: false, animation: false, homeButton: false, sceneModePicker: false, navigationHelpButton: false, infoBox: false, selectionIndicator: false, fullscreenButton: false });
v.scene.globe.baseColor = C.Color.fromCssColorString("#35507a");
v.scene.skyAtmosphere.show = false;
(v.scene as any).skyBox.show = false;
v.scene.backgroundColor = C.Color.fromCssColorString("#bcd3e6");
const lon = -122.4, lat = 37.7, alt = 500;
const pos = C.Cartesian3.fromDegrees(lon, lat, alt);
const fix = raw ? { heading: 0, pitch: 0, roll: 0 } : spec.modelFix;
v.entities.add({ position: pos, orientation: modelOrientation(pos, h, p, r, fix), model: { uri: spec.uri, minimumPixelSize: 0, scale: 1 } });
// North arrow (red) and east arrow (green) under the plane.
const R = spec.radiusMeters * 1.6;
const arrow = (dLon: number, dLat: number, color: C.Color) => v.entities.add({ polyline: { positions: [C.Cartesian3.fromDegrees(lon, lat, alt - 6), C.Cartesian3.fromDegrees(lon + dLon, lat + dLat, alt - 6)], width: 6, material: new C.PolylineArrowMaterialProperty(color) } });
const dDeg = R / 111000;
arrow(0, dDeg, C.Color.RED);
arrow(dDeg / Math.cos(lat * Math.PI / 180), 0, C.Color.LIME);
const d = spec.radiusMeters * 4.2;
const enu = C.Transforms.eastNorthUpToFixedFrame(pos);
const off = view === "top" ? new C.Cartesian3(0, 0, d) : view === "side" ? new C.Cartesian3(0, -d, 0) : view === "chase" ? new C.Cartesian3(-d, 0, d * 0.3) : new C.Cartesian3(d * 0.7, -d * 0.7, d * 0.5);
const camPos = C.Matrix4.multiplyByPoint(enu, off, new C.Cartesian3());
const dir = C.Cartesian3.normalize(C.Cartesian3.subtract(pos, camPos, new C.Cartesian3()), new C.Cartesian3());
const upLocal = view === "top" ? new C.Cartesian3(0, 1, 0) : new C.Cartesian3(0, 0, 1);
const up = C.Matrix4.multiplyByPointAsVector(enu, upLocal, new C.Cartesian3());
v.camera.setView({ destination: camPos, orientation: { direction: dir, up } });
document.getElementById("l")!.textContent = `${spec.id} ${raw ? "RAW" : "fixed"} hdg ${h} pitch ${p} roll ${r} view ${view} (red=N, green=E)${simNote}`;
(window as any).ready = false;
const t0 = performance.now();
v.scene.postRender.addEventListener(() => { if (performance.now() - t0 > 4000) (window as any).ready = true; });
