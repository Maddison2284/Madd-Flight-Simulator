import React, { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import * as C from "cesium";
import "cesium/Build/Cesium/Widgets/widgets.css";
import "./style.css";
import { spawn, step, clamp, type Flight } from "./physics";
import { TouchControls, type TouchAxes } from "./TouchControls";
import { Cockpit } from "./Cockpit";
const cameraModes = ["chase", "cockpit", "wing", "front"] as const;
const cameraLabels: Record<string, string> = {
  chase: "Chase",
  cockpit: "Cockpit",
  wing: "Left wing",
  front: "Front",
};
const initial = spawn(37.807, -122.475, 900, 90, 120);
const presets = [
  ["San Francisco", 37.807, -122.475],
  ["New York", 40.705, -74.015],
  ["London", 51.505, -0.12],
  ["Dubai", 25.197, 55.274],
  ["Tokyo", 35.68, 139.76],
  ["Sydney", -33.856, 151.215],
] as const;
function App() {
  const host = useRef<HTMLDivElement>(null),
    viewer = useRef<C.Viewer | null>(null),
    flight = useRef<Flight>(initial),
    keys = useRef(new Set<string>()),
    touch = useRef<TouchAxes>({ pitch: 0, roll: 0, yaw: 0 }),
    camera = useRef("chase"),
    active = useRef(false),
    paused = useRef(false),
    ground = useRef(0),
    pending = useRef(false),
    tiles = useRef<C.Cesium3DTileset | null>(null);
  const [f, setF] = useState(initial),
    [ready, setReady] = useState(false),
    [flying, setFlying] = useState(false),
    [pause, setPause] = useState(false),
    [cam, setCam] = useState("chase"),
    [status, setStatus] = useState("Free global scenery"),
    [query, setQuery] = useState(""),
    [results, setResults] = useState<
      { name: string; lat: number; lon: number }[]
    >([]),
    [searching, setSearching] = useState(false),
    [error, setError] = useState(""),
    [photo, setPhoto] = useState(false),
    [help, setHelp] = useState(false);
  const [location, setLocation] = useState({
      lat: initial.lat,
      lon: initial.lon,
      name: "San Francisco Bay",
    }),
    [alt, setAlt] = useState(3000),
    [heading, setHeading] = useState(90),
    [speed, setSpeed] = useState(230);
  const [touchVisible, setTouchVisible] = useState(
    () =>
      window.matchMedia("(any-pointer: coarse)").matches ||
      navigator.maxTouchPoints > 0,
  );
  const selected = useRef(location);
  selected.current = location;
  const lastSearch = useRef(0);
  useEffect(() => {
    if (!host.current) return;
    C.Ion.defaultAccessToken = import.meta.env.VITE_CESIUM_ION_TOKEN || "";
    const v = new C.Viewer(host.current, {
      baseLayer: false,
      terrainProvider: new C.EllipsoidTerrainProvider(),
      animation: false,
      timeline: false,
      baseLayerPicker: false,
      geocoder: false,
      homeButton: false,
      sceneModePicker: false,
      navigationHelpButton: false,
      fullscreenButton: false,
      infoBox: false,
      selectionIndicator: false,
      shouldAnimate: true,
    });
    viewer.current = v;
    C.TileMapServiceImageryProvider.fromUrl(
      C.buildModuleUrl("Assets/Textures/NaturalEarthII"),
    ).then((provider) => {
      if (!v.isDestroyed()) v.imageryLayers.addImageryProvider(provider, 0);
    });
    v.imageryLayers.addImageryProvider(
      new C.OpenStreetMapImageryProvider({
        url: "https://tile.openstreetmap.org/",
        credit: new C.Credit("© OpenStreetMap contributors", true),
      }),
    );
    v.scene.globe.depthTestAgainstTerrain = true;
    v.scene.globe.baseColor = C.Color.fromCssColorString("#244453");
    v.camera.setView({
      destination: C.Cartesian3.fromDegrees(initial.lon, initial.lat, 45000),
      orientation: { heading: 0, pitch: -Math.PI / 2, roll: 0 },
    });
    if (import.meta.env.VITE_CESIUM_ION_TOKEN)
      C.createWorldTerrainAsync()
        .then((t) => {
          if (!v.isDestroyed()) v.terrainProvider = t;
        })
        .catch(() => setStatus("Terrain unavailable · ellipsoid fallback"));
    const position = new C.CallbackPositionProperty(
      () =>
        C.Cartesian3.fromDegrees(
          flight.current.lon,
          flight.current.lat,
          flight.current.alt,
        ),
      false,
    );
    const plane = v.entities.add({
      position,
      orientation: new C.CallbackProperty(() => {
        const a = flight.current;
        return C.Transforms.headingPitchRollQuaternion(
          C.Cartesian3.fromDegrees(a.lon, a.lat, a.alt),
          new C.HeadingPitchRoll(
            C.Math.toRadians(a.heading - 90),
            C.Math.toRadians(a.pitch),
            C.Math.toRadians(-a.roll),
          ),
        );
      }, false),
      model: {
        uri: "/models/business-jet.glb",
        minimumPixelSize: 100,
        maximumScale: 1,
      },
      show: false,
    });
    const marker = v.entities.add({
      position: new C.CallbackPositionProperty(
        () =>
          C.Cartesian3.fromDegrees(selected.current.lon, selected.current.lat),
        false,
      ),
      point: {
        pixelSize: 12,
        color: C.Color.CYAN,
        outlineColor: C.Color.WHITE,
        outlineWidth: 2,
        heightReference: C.HeightReference.CLAMP_TO_GROUND,
      },
    });
    const click = new C.ScreenSpaceEventHandler(v.scene.canvas);
    click.setInputAction((e: { position: C.Cartesian2 }) => {
      if (active.current) return;
      const ray = v.camera.getPickRay(e.position);
      const p = ray && v.scene.globe.pick(ray, v.scene);
      if (!p) return;
      const c = C.Cartographic.fromCartesian(p);
      const loc = {
        lat: C.Math.toDegrees(c.latitude),
        lon: C.Math.toDegrees(c.longitude),
        name: "Custom departure",
      };
      setLocation(loc);
    }, C.ScreenSpaceEventType.LEFT_CLICK);
    const down = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).matches("input,select,textarea,button"))
        return;
      const k = e.key.toLowerCase();
      if (["arrowup", "arrowdown", "arrowleft", "arrowright", " "].includes(k))
        e.preventDefault();
      keys.current.add(k);
      if (e.repeat) return;
      if (k === "c") {
        camera.current =
          cameraModes[
            (cameraModes.indexOf(
              camera.current as (typeof cameraModes)[number],
            ) +
              1) %
              cameraModes.length
          ];
        setCam(camera.current);
      }
      if (k === "p") {
        paused.current = !paused.current;
        setPause(paused.current);
      }
    };
    const up = (e: KeyboardEvent) => keys.current.delete(e.key.toLowerCase());
    const blur = () => keys.current.clear();
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    window.addEventListener("blur", blur);
    let last = performance.now(),
      ui = 0,
      terrainTime = 0;
    const tick = () => {
      const now = performance.now(),
        dt = Math.min((now - last) / 1000, 0.05);
      last = now;
      plane.show = active.current && camera.current !== "cockpit";
      v.scene.screenSpaceCameraController.enableInputs = !active.current;
      marker.show = !active.current;
      if (!active.current) return;
      const a = flight.current;
      const cart = C.Cartographic.fromDegrees(a.lon, a.lat);
      const h = v.scene.globe.getHeight(cart);
      if (h !== undefined) ground.current = h;
      if (now - terrainTime > 2000 && !pending.current) {
        terrainTime = now;
        pending.current = true;
        const sampledLat = a.lat,
          sampledLon = a.lon;
        const terrain = v.terrainProvider.availability
          ? C.sampleTerrainMostDetailed(v.terrainProvider, [cart])
          : Promise.resolve([cart]);
        terrain
          .then((points) => {
            if (
              Math.abs(flight.current.lat - sampledLat) < 0.02 &&
              Math.abs(flight.current.lon - sampledLon) < 0.02 &&
              Number.isFinite(points[0].height)
            )
              ground.current = points[0].height;
          })
          .catch(() => {})
          .finally(() => (pending.current = false));
      }
      const k = keys.current;
      if (!paused.current)
        flight.current = step(
          a,
          {
            pitch:
              Number(k.has("arrowdown") || k.has("s")) -
              Number(k.has("arrowup") || k.has("w")) +
              touch.current.pitch,
            roll:
              Number(k.has("arrowright") || k.has("d")) -
              Number(k.has("arrowleft") || k.has("a")) +
              touch.current.roll,
            yaw: clamp(
              Number(k.has("e")) - Number(k.has("q")) + touch.current.yaw,
              -1,
              1,
            ),
            throttle: Number(k.has("=") || k.has("+")) - Number(k.has("-")),
          },
          dt,
          ground.current,
        );
      const b = flight.current,
        pos = C.Cartesian3.fromDegrees(b.lon, b.lat, b.alt),
        transform = C.Transforms.headingPitchRollToFixedFrame(
          pos,
          new C.HeadingPitchRoll(C.Math.toRadians(b.heading), 0, 0),
        );
      if (camera.current !== "cockpit") {
        const destination = C.Matrix4.multiplyByPoint(
          transform,
          camera.current === "wing"
            ? new C.Cartesian3(-32, -6, 8)
            : camera.current === "front"
              ? new C.Cartesian3(0, 42, 10)
              : new C.Cartesian3(0, -42, 12),
          new C.Cartesian3(),
        );
        const target = C.Cartesian3.add(
          pos,
          new C.Cartesian3(0, 0, 0),
          new C.Cartesian3(),
        );
        const direction = C.Cartesian3.normalize(
          C.Cartesian3.subtract(target, destination, new C.Cartesian3()),
          new C.Cartesian3(),
        );
        v.camera.setView({
          destination,
          orientation: {
            direction,
            up: C.Cartesian3.normalize(pos, new C.Cartesian3()),
          },
        });
      } else {
        v.camera.setView({
          destination: pos,
          orientation: {
            heading: C.Math.toRadians(b.heading),
            pitch: C.Math.toRadians(b.pitch),
            roll: C.Math.toRadians(b.roll),
          },
        });
      }
      if (now - ui > 100) {
        setF({ ...b });
        ui = now;
      }
    };
    v.clock.onTick.addEventListener(tick);
    setReady(true);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
      window.removeEventListener("blur", blur);
      click.destroy();
      v.destroy();
      viewer.current = null;
    };
  }, []);
  const locate = (lat: number, lon: number, name: string) => {
    if (
      !Number.isFinite(lat) ||
      !Number.isFinite(lon) ||
      Math.abs(lat) > 89.9 ||
      Math.abs(lon) > 180
    ) {
      setError("Use latitude −89.9…89.9 and longitude −180…180.");
      return;
    }
    setError("");
    setLocation({ lat, lon, name });
    viewer.current?.camera.flyTo({
      destination: C.Cartesian3.fromDegrees(lon, lat, 35000),
      duration: 1.2,
      orientation: { heading: 0, pitch: -Math.PI / 2, roll: 0 },
    });
    setResults([]);
  };
  async function search() {
    const pair = query.split(",").map(Number);
    if (
      pair.length === 2 &&
      query.includes(",") &&
      pair.every(Number.isFinite)
    ) {
      locate(pair[0], pair[1], "Coordinates");
      return;
    }
    if (query.trim().length < 3) {
      setError("Enter a place name or latitude, longitude.");
      return;
    }
    if (searching || Date.now() - lastSearch.current < 1100) return;
    lastSearch.current = Date.now();
    setSearching(true);
    setError("");
    try {
      const response = await fetch(
        `https://nominatim.openstreetmap.org/search?format=jsonv2&limit=5&q=${encodeURIComponent(query)}`,
        { signal: AbortSignal.timeout(10000) },
      );
      if (!response.ok) throw Error();
      const data = await response.json();
      setResults(
        data.map((r: { display_name: string; lat: string; lon: string }) => ({
          name: r.display_name,
          lat: Number(r.lat),
          lon: Number(r.lon),
        })),
      );
      if (!data.length) setError("No locations found. Try coordinates.");
    } catch {
      setError(
        "Search unavailable. Enter latitude, longitude or select the globe.",
      );
    } finally {
      setSearching(false);
    }
  }
  function launch() {
    const v = viewer.current;
    if (!v) return;
    v.camera.cancelFlight();
    setError("");
    keys.current.clear();
    touch.current = { pitch: 0, roll: 0, yaw: 0 };
    const p = C.Cartographic.fromDegrees(location.lon, location.lat);
    const cached = v.scene.globe.getHeight(p) || 0;
    ground.current = cached;
    flight.current = spawn(
      location.lat,
      location.lon,
      Math.max(alt * 0.3048, cached + 150),
      heading,
      speed * 0.514444,
    );
    setF({ ...flight.current });
    active.current = true;
    paused.current = false;
    setPause(false);
    setFlying(true);
    setStatus(photo ? "Google photorealistic 3D" : "Free global scenery");
    // Spawn immediately; refine height without blocking departure on network requests.
    const departure = flight.current;
    const refine = async () => {
      let height = cached;
      if (v.terrainProvider.availability) {
        const points = await C.sampleTerrainMostDetailed(v.terrainProvider, [
          p,
        ]);
        height = Math.max(height, points[0]?.height || 0);
      }
      if (tiles.current && v.scene.sampleHeightSupported) {
        const points = await v.scene.sampleHeightMostDetailed([p]);
        height = Math.max(height, points[0]?.height || 0);
      }
      if (
        active.current &&
        Math.abs(flight.current.lat - departure.lat) < 0.01 &&
        Math.abs(flight.current.lon - departure.lon) < 0.01
      ) {
        ground.current = height;
        flight.current = {
          ...flight.current,
          alt: Math.max(flight.current.alt, height + 150),
        };
      }
    };
    void refine().catch(() =>
      setStatus("Flying · available terrain clearance only"),
    );
    (document.activeElement as HTMLElement)?.blur();
  }
  async function togglePhoto() {
    const v = viewer.current;
    if (!v) return;
    if (photo && tiles.current) {
      v.scene.primitives.remove(tiles.current);
      tiles.current = null;
      setPhoto(false);
      setStatus("Free global scenery");
      return;
    }
    const key = import.meta.env.VITE_GOOGLE_MAPS_API_KEY;
    if (!key) {
      setError(
        "Google mode needs VITE_GOOGLE_MAPS_API_KEY. Free scenery is ready to fly.",
      );
      return;
    }
    setStatus("Loading Google 3D…");
    try {
      const t = await C.createGooglePhotorealistic3DTileset({ key });
      if (v.isDestroyed()) return;
      v.scene.primitives.add(t);
      tiles.current = t;
      setPhoto(true);
      setStatus("Google 3D · global map fallback");
      t.tileFailed.addEventListener(() =>
        setStatus("3D tiles unavailable here · global map fallback"),
      );
    } catch {
      setStatus("Free global scenery");
      setError(
        "Google 3D could not load. Check API key, billing and domain restrictions.",
      );
    }
  }
  const returnMap = () => {
    active.current = false;
    setFlying(false);
    const a = flight.current;
    locate(a.lat, a.lon, "Current position");
  };
  return (
    <main
      data-camera={flying ? cam : "planner"}
      data-touch={flying && touchVisible ? "true" : "false"}
    >
      <div ref={host} className="globe" />
      <header>
        <a className="brand" href="#" onClick={(e) => e.preventDefault()}>
          <span className="logo">
            M<span>↗</span>
          </span>
          <div>
            MADD <b>FLIGHT</b>
            <small>THE WORLD IS YOUR RUNWAY</small>
          </div>
        </a>
        <div className="top-right">
          <span className="live-dot" /> <span>{status}</span>
          <button onClick={() => setHelp(!help)}>
            Controls <kbd>?</kbd>
          </button>
        </div>
      </header>
      {!flying ? (
        <>
          <section className="panel dispatch">
            <div className="eyebrow">
              FLIGHT PLANNER <span>01 / DEPARTURE</span>
            </div>
            <h1>
              Anywhere.
              <br />
              <em>From here.</em>
            </h1>
            <p className="intro">Pick a place on Earth. Take the controls.</p>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                search();
              }}
              className="search"
            >
              <span>⌕</span>
              <input
                aria-label="Search worldwide"
                placeholder="Search city, landmark or coordinates"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
              <button aria-label="Find location" disabled={searching}>
                {searching ? "…" : "↗"}
              </button>
            </form>
            {results.length > 0 && (
              <div className="results">
                {results.map((r) => (
                  <button
                    key={`${r.lat},${r.lon}`}
                    onClick={() => locate(r.lat, r.lon, r.name)}
                  >
                    {r.name}
                  </button>
                ))}
              </div>
            )}
            <div className="destination">
              <span className="pin">⌖</span>
              <div>
                <strong>{location.name}</strong>
                <small>
                  {location.lat.toFixed(4)}° / {location.lon.toFixed(4)}°
                </small>
              </div>
              <span className="tag">SELECTED</span>
            </div>
            <p className="hint">
              Click anywhere on the globe to set your departure.
            </p>
            <div className="settings">
              <label>
                ALTITUDE <span>FT MSL</span>
                <input
                  type="number"
                  min="100"
                  max="49000"
                  value={alt}
                  onChange={(e) =>
                    setAlt(clamp(Number(e.target.value), 100, 49000))
                  }
                />
              </label>
              <label>
                HEADING <span>DEG</span>
                <input
                  type="number"
                  min="0"
                  max="359"
                  value={heading}
                  onChange={(e) =>
                    setHeading(clamp(Number(e.target.value), 0, 359))
                  }
                />
              </label>
              <label>
                AIRSPEED <span>KTS</span>
                <input
                  type="number"
                  min="110"
                  max="480"
                  value={speed}
                  onChange={(e) =>
                    setSpeed(clamp(Number(e.target.value), 110, 480))
                  }
                />
              </label>
            </div>
            <div className="aircraft">
              <span>✈</span>
              <div>
                <strong>MADD BJ-35</strong>
                <small>Generic business jet · twin engine</small>
              </div>
              <span className="tag">READY</span>
            </div>
            <button className="launch" disabled={!ready} onClick={launch}>
              Start flight <span>↗</span>
            </button>
            <div className="panel-foot">
              NO RUNWAY REQUIRED <span>SPAWN & FLY</span>
            </div>
          </section>
          <aside className="places">
            <span className="eyebrow">EXPLORE A DEPARTURE</span>
            {presets.map(([name, lat, lon], i) => (
              <button onClick={() => locate(lat, lon, name)} key={name}>
                <span>0{i + 1}</span>
                {name}
                <b>↗</b>
              </button>
            ))}
          </aside>
        </>
      ) : (
        <>
          <div className="flight-actions">
            <button onClick={returnMap}>← Flight planner</button>
            <button
              onClick={() => {
                paused.current = !paused.current;
                setPause(paused.current);
              }}
            >
              {pause ? "▶ Resume" : "Ⅱ Pause"}
            </button>
            <button
              onClick={() => {
                camera.current =
                  cameraModes[
                    (cameraModes.indexOf(cam as (typeof cameraModes)[number]) +
                      1) %
                      cameraModes.length
                  ];
                setCam(camera.current);
              }}
            >
              {`◉ ${cameraLabels[cam]}`} <kbd>C</kbd>
            </button>
            <select
              aria-label="Camera view"
              value={cam}
              onChange={(e) => {
                camera.current = e.target.value;
                setCam(e.target.value);
                e.target.blur();
              }}
            >
              {cameraModes.map((mode) => (
                <option key={mode} value={mode}>
                  {cameraLabels[mode]}
                </option>
              ))}
            </select>
          </div>
          <button
            className="touch-toggle"
            aria-pressed={touchVisible}
            onClick={() => setTouchVisible(!touchVisible)}
          >
            Touch controls {touchVisible ? "on" : "off"}
          </button>
          <div className="heading-strip">
            {String(Math.round(f.heading)).padStart(3, "0")}°
            <small>HEADING</small>
          </div>
          <div className="reticle">
            ┈┈ <span>⌖</span> ┈┈
          </div>
          {cam === "cockpit" && <Cockpit flight={f} />}
          {touchVisible && (
            <TouchControls
              throttle={f.throttle}
              onAxes={(axes) => {
                touch.current = axes;
              }}
              onThrottle={(value) => {
                flight.current = { ...flight.current, throttle: value };
                setF({ ...flight.current });
              }}
            />
          )}
          <div className="instruments">
            <Instrument
              label="AIRSPEED"
              value={Math.round(f.speed / 0.514444)}
              unit="KTS"
            />
            <div className="attitude">
              <div
                style={{
                  transform: `rotate(${-f.roll}deg) translateY(${f.pitch * 1.2}px)`,
                }}
              />
              <span>─ ⊕ ─</span>
            </div>
            <Instrument
              label="ALTITUDE"
              value={Math.round(f.alt / 0.3048).toLocaleString()}
              unit="FT MSL"
            />
            <Instrument
              label="VERTICAL SPEED"
              value={Math.round(f.vs * 196.85)}
              unit="FT / MIN"
            />
            <Instrument
              label="THROTTLE"
              value={Math.round(f.throttle * 100)}
              unit="%"
            />
            <Instrument
              label="CLEARANCE"
              value={Math.round((f.alt - ground.current) / 0.3048)}
              unit="FT AGL"
            />
          </div>
          {(f.crashed || pause || f.stall) && (
            <div className="alert">
              {f.crashed ? (
                <>
                  <strong>Flight ended · ground contact</strong>
                  <button onClick={launch}>Restart departure ↗</button>
                </>
              ) : pause ? (
                "FLIGHT PAUSED"
              ) : (
                "STALL · LOWER NOSE & ADD THROTTLE"
              )}
            </div>
          )}
        </>
      )}
      {error && (
        <div role="alert" className="error" onClick={() => setError("")}>
          {error} <span>×</span>
        </div>
      )}
      {help && (
        <section className="help panel">
          <button className="close" onClick={() => setHelp(false)}>
            ×
          </button>
          <h2>You have the controls.</h2>
          <p>
            Click the flight view to focus. Keyboard controls work while flying.
          </p>
          {[
            ["↑ / W", "Pitch down"],
            ["↓ / S", "Pitch up"],
            ["← → / A D", "Roll left / right"],
            ["Q / E", "Rudder left / right"],
            ["+ / −", "Increase / decrease throttle"],
            ["C", "Cycle chase / cockpit / wing / front"],
            ["P", "Pause / resume"],
          ].map(([k, t]) => (
            <div key={k}>
              <kbd>{k}</kbd>
              <span>{t}</span>
            </div>
          ))}
          <p>
            Bank to turn. Keep airspeed above 107 knots. Spawn height
            automatically clears terrain by at least 150 m. Simplified
            recreational physics.
          </p>
        </section>
      )}
      <footer>
        <span>
          ◈ WORLD EXPLORER <span className="muted">/</span>{" "}
          {flying ? "IN FLIGHT" : "PREFLIGHT"}
        </span>
        <div>
          <button onClick={togglePhoto}>
            {photo ? "● Google 3D" : "○ Enable Google 3D"}
          </button>
          <span className="muted">
            {photo
              ? "Google usage may be billed"
              : "Free scenery · no key required"}
          </span>
        </div>
      </footer>
    </main>
  );
}
function Instrument({
  label,
  value,
  unit,
}: {
  label: string;
  value: string | number;
  unit: string;
}) {
  return (
    <div className="instrument">
      <small>{label}</small>
      <strong>{value}</strong>
      <span>{unit}</span>
    </div>
  );
}
createRoot(document.getElementById("root")!).render(<App />);
