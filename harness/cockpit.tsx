// Dev-only harness: cockpit camera + panel for one aircraft, same math as the app.
import * as C from "cesium";
import "cesium/Build/Cesium/Widgets/widgets.css";
import "../src/style.css";
import { createRoot } from "react-dom/client";
import { aircraftById } from "../src/aircraft";
import { modelOrientation } from "../src/attitude";
import { Cockpit } from "../src/Cockpit";
import { spawn } from "../src/physics";
const q = new URLSearchParams(location.search);
const spec = aircraftById(q.get("id"));
const h = Number(q.get("h") || 90), p = Number(q.get("p") || 3), r = Number(q.get("r") || 10);
const f = { ...spawn(37.62, -122.2, 900, h, spec.defaultSpeedKt / 1.943844), pitch: p, roll: r, throttle: 0.7, vs: 4 };
const v = new C.Viewer("c", { baseLayer: false, baseLayerPicker: false, geocoder: false, timeline: false, animation: false, homeButton: false, sceneModePicker: false, navigationHelpButton: false, infoBox: false, selectionIndicator: false, fullscreenButton: false });
v.scene.globe.baseColor = C.Color.fromCssColorString("#3c6b3f");
// A grid of ground markers so horizon tilt / heading are readable.
for (let i = -6; i <= 6; i++) for (let j = -6; j <= 6; j++) v.entities.add({ position: C.Cartesian3.fromDegrees(-122.2 + i * 0.03, 37.62 + j * 0.03, 0), point: { pixelSize: 6, color: (i === 0 || j === 0) ? C.Color.YELLOW : C.Color.WHITE } });
const origin = C.Cartesian3.fromDegrees(f.lon, f.lat, f.alt);
const body = C.Matrix3.fromQuaternion(modelOrientation(origin, f.heading, f.pitch, f.roll));
const [ex, ey, ez] = spec.eye;
const eye = C.Matrix3.multiplyByVector(body, new C.Cartesian3(ex, ey, ez), new C.Cartesian3());
v.camera.setView({ destination: C.Cartesian3.add(origin, eye, new C.Cartesian3()), orientation: { direction: C.Matrix3.multiplyByVector(body, C.Cartesian3.UNIT_X, new C.Cartesian3()), up: C.Matrix3.multiplyByVector(body, C.Cartesian3.UNIT_Z, new C.Cartesian3()) } });
createRoot(document.getElementById("ui")!).render(<Cockpit flight={f} aircraft={spec} />);
(window as any).ready = false;
setTimeout(() => ((window as any).ready = true), 4000);
