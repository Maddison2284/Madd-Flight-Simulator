import React, { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { ClerkProvider, UserButton, useAuth } from "@clerk/react";
import { AuthPanel, clearClerkHash, isClerkHashRoute, openAuth } from "./AuthPanel";
import * as C from "cesium";
import "cesium/Build/Cesium/Widgets/widgets.css";
import "./style.css";
import {
  applyCameraZoom,
  computeExteriorCamera,
  smoothExteriorCamera,
  zoomAfterStep,
  zoomAfterWheel,
  type ExteriorCameraPose,
  type ExteriorCameraMode,
} from "./camera";
import { keyboardControls } from "./controls";
import { modelOrientation } from "./attitude";
import { spawn, clamp, type Flight } from "./physics";
import {
  aircraftAutopilot,
  gearHeight,
  isHoverCapable,
  rotorParams,
  spawnAircraft,
  stepAircraft,
} from "./flight-model";
import { hoverTrimCollective, HOVER_COLLECTIVE } from "./heli";
import { RotorAnimator } from "./rotors";
import { TouchControls, type TouchAxes } from "./TouchControls";
import { Cockpit } from "./Cockpit";
import {
  AIRCRAFT,
  aircraftById,
  persistAircraftId,
  readAircraftId,
  stallKnots,
} from "./aircraft";
import { flightAudio } from "./audio";
import {
  disengageAutopilot,
  engageAutopilot,
  formatDistance,
  formatEta,
  greatCirclePositions,
  isManualInput,
  navTo,
  type AutopilotState,
  type NavInfo,
} from "./autopilot";
import {
  AIRPORTS,
  formatAirport,
  searchAirports,
  type Destination,
} from "./destinations";
import { AdminPage } from "./AdminPage";
import { pushRecent, quickAirports, readRecent } from "./recent-airports";
import { Paywall, formatTrialClock } from "./Paywall";
import { useEntitlement } from "./entitlement-client";
const cameraModes = ["chase", "cockpit", "wing", "front"] as const;
const cameraLabels: Record<string, string> = {
  chase: "Chase",
  cockpit: "Cockpit",
  wing: "Left wing",
  front: "Front",
};
const initial = spawn(37.807, -122.475, 900, 90, 120);
const rotors = new RotorAnimator();
const clerkPublishableKey = (
  import.meta.env.VITE_CLERK_PUBLISHABLE_KEY || ""
).trim();

/** Hide the ellipsoid + fallback imagery while Google Photorealistic 3D Tiles
 *  are active so the base globe cannot draw through tile gaps (Cesium/Google guidance). */
function setFallbackGlobeVisible(v: C.Viewer, visible: boolean) {
  v.scene.globe.show = visible;
  v.scene.globe.depthTestAgainstTerrain = visible;
  const layers = v.imageryLayers;
  for (let i = 0; i < layers.length; i++) {
    const layer = layers.get(i);
    if (layer) layer.show = visible;
  }
}
const DEPARTURE_GRACE_MS = 5000;
const DEPARTURE_CLEARANCE_METERS = 150;
/** Reject heights that sit on/above the aircraft when the previous ground was
 *  much lower — that is the aircraft model or a coarse tileset shell, not terrain. */
function isPlausibleGroundHeight(
  height: number,
  aircraftAlt: number,
  previousGround: number,
) {
  if (!Number.isFinite(height)) return false;
  if (height >= aircraftAlt - 5 && height > previousGround + 20) return false;
  return true;
}
const GAUGE_SIZES = ["sm", "md", "lg", "xl"] as const;
type GaugeSize = (typeof GAUGE_SIZES)[number];
const GAUGE_SIZE_KEY = "maddflight-gauge-size";
function isGaugeSize(value: string | null): value is GaugeSize {
  return !!value && (GAUGE_SIZES as readonly string[]).includes(value);
}
function readGaugeSize(): GaugeSize {
  try {
    const value = localStorage.getItem(GAUGE_SIZE_KEY);
    if (isGaugeSize(value)) return value;
  } catch {}
  return "md";
}
function stepGaugeSize(current: GaugeSize, direction: 1 | -1): GaugeSize {
  const index = GAUGE_SIZES.indexOf(current);
  return GAUGE_SIZES[Math.max(0, Math.min(GAUGE_SIZES.length - 1, index + direction))];
}
function cycleGaugeSize(current: GaugeSize): GaugeSize {
  return GAUGE_SIZES[(GAUGE_SIZES.indexOf(current) + 1) % GAUGE_SIZES.length];
}
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
    tiles = useRef<C.Cesium3DTileset | null>(null),
    cameraZoom = useRef(1),
    cameraZoomTarget = useRef(1),
    heightExclude = useRef<object[]>([]),
    airborneSince = useRef(0),
    planeEntity = useRef<C.Entity | null>(null),
    destRef = useRef<Destination | null>(null),
    clickModeRef = useRef<"departure" | "destination">("departure"),
    apRef = useRef<AutopilotState>({
      engaged: false,
      holding: false,
      targetAlt: 0,
      targetSpeed: 0,
    }),
    aircraftRef = useRef(aircraftById(readAircraftId())),
    navRef = useRef<NavInfo | null>(null);
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
    [help, setHelp] = useState(false),
    [startOnGround, setStartOnGround] = useState(false);
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
  const [googleKey, setGoogleKey] = useState("");
  const [googleSettings, setGoogleSettings] = useState(false);
  const [photoLoading, setPhotoLoading] = useState(false);
  const [gaugesExpanded, setGaugesExpanded] = useState(false);
  const [gaugeSize, setGaugeSize] = useState<GaugeSize>(readGaugeSize);
  const persistGaugeSize = (size: GaugeSize) => {
    setGaugeSize(size);
    try {
      localStorage.setItem(GAUGE_SIZE_KEY, size);
    } catch {}
  };
  const [aircraftId, setAircraftId] = useState(readAircraftId);
  const aircraft = aircraftById(aircraftId);
  aircraftRef.current = aircraft;
  const [destination, setDestination] = useState<Destination | null>(null);
  destRef.current = destination;
  const [destQuery, setDestQuery] = useState("");
  const [recentAirports, setRecentAirports] = useState<string[]>(() => readRecent());
  const [depIata, setDepIata] = useState("");
  const [depMatches, setDepMatches] = useState<Destination[]>([]);
  const [destResults, setDestResults] = useState<Destination[]>([]);
  const [clickMode, setClickMode] = useState<"departure" | "destination">(
    "departure",
  );
  clickModeRef.current = clickMode;
  const [apMode, setApMode] = useState<"off" | "nav" | "hold">("off");
  const [nav, setNav] = useState<NavInfo | null>(null);
  const [muted, setMuted] = useState(() => flightAudio.muted);
  const [credits, setCredits] = useState(false);
  const [flightHint, setFlightHint] = useState(false);
  const [paywall, setPaywall] = useState(false);
  // Reopen the sign-in box when Clerk returns to one of its hash steps
  // (Google OAuth return, email verification, etc.); otherwise nothing is
  // mounted to finish the flow.
  const [authOpen, setAuthOpen] = useState(() => isClerkHashRoute());
  const closeAuth = () => {
    setAuthOpen(false);
    clearClerkHash();
  };
  useEffect(() => {
    const onHash = () => {
      if (isClerkHashRoute()) setAuthOpen(true);
    };
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);
  const invertPitch = useRef(readInvertPitch());
  const [billingBusy, setBillingBusy] = useState(false);
  const [billingError, setBillingError] = useState("");
  const [trialMs, setTrialMs] = useState<number | null>(null);
  const [priceIds, setPriceIds] = useState({ month: "", year: "" });
  const { isLoaded: authLoaded, isSignedIn, getToken } = useAuth();
  useEffect(() => {
    if (isSignedIn && isClerkHashRoute()) clearClerkHash();
  }, [isSignedIn]);
  const entitlement = useEntitlement();
  const [orientationHint, setOrientationHint] = useState(
    "Rotate your phone for a wider view.",
  );
  useEffect(() => {
    if (!flying) return;
    document.documentElement.classList.add("in-flight");
    const preventPagePan = (event: TouchEvent) => {
      if (
        !(event.target as HTMLElement)?.closest(
          "input,select,.help,.google-settings,.credits,.paywall",
        )
      )
        event.preventDefault();
    };
    document.addEventListener("touchmove", preventPagePan, { passive: false });
    return () => {
      document.documentElement.classList.remove("in-flight");
      document.removeEventListener("touchmove", preventPagePan);
    };
  }, [flying]);
  async function requestLandscape() {
    try {
      if (
        !document.fullscreenElement &&
        document.documentElement.requestFullscreen
      )
        await document.documentElement.requestFullscreen();
      const orientation = screen.orientation as ScreenOrientation & {
        lock?: (value: string) => Promise<void>;
      };
      if (orientation?.lock) {
        await orientation.lock("landscape");
        setOrientationHint("Landscape requested. Rotate your phone if needed.");
      } else
        setOrientationHint(
          "Rotate your phone sideways; this browser cannot lock orientation.",
        );
    } catch {
      setOrientationHint(
        "Rotate your phone sideways; this browser cannot lock orientation.",
      );
    }
  }
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
    (host.current as HTMLDivElement & { __viewer?: C.Viewer }).__viewer = v;
    C.TileMapServiceImageryProvider.fromUrl(
      C.buildModuleUrl("Assets/Textures/NaturalEarthII"),
    ).then((provider) => {
      if (v.isDestroyed()) return;
      const layer = v.imageryLayers.addImageryProvider(provider, 0);
      layer.show = v.scene.globe.show;
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
        const spec = aircraftRef.current;
        return modelOrientation(
          C.Cartesian3.fromDegrees(a.lon, a.lat, a.alt),
          a.heading,
          a.pitch,
          a.roll,
          spec.modelFix,
        );
      }, false),
      model: {
        uri: aircraftRef.current.uri,
        minimumPixelSize: 80,
        maximumScale: 1,
        nodeTransformations: rotors.nodeTransformations(() => aircraftRef.current),
      },
      show: false,
    });
    planeEntity.current = plane;
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
    const destMarker = v.entities.add({
      position: new C.CallbackPositionProperty(() => {
        const dest = destRef.current;
        return dest
          ? C.Cartesian3.fromDegrees(dest.lon, dest.lat)
          : undefined;
      }, false),
      point: {
        pixelSize: 13,
        color: C.Color.fromCssColorString("#f3c14a"),
        outlineColor: C.Color.WHITE,
        outlineWidth: 2,
        heightReference: C.HeightReference.CLAMP_TO_GROUND,
      },
      label: {
        text: new C.CallbackProperty(() => {
          const dest = destRef.current;
          return dest ? dest.iata || dest.name : "";
        }, false),
        font: "12px sans-serif",
        fillColor: C.Color.WHITE,
        outlineColor: C.Color.BLACK,
        outlineWidth: 3,
        style: C.LabelStyle.FILL_AND_OUTLINE,
        pixelOffset: new C.Cartesian2(0, -18),
        heightReference: C.HeightReference.CLAMP_TO_GROUND,
        show: new C.CallbackProperty(() => !!destRef.current, false),
      },
      show: true,
    });
    const destLine = v.entities.add({
      polyline: {
        positions: new C.CallbackProperty(() => {
          const dest = destRef.current;
          if (!dest) return [];
          const from = active.current ? flight.current : selected.current;
          const alt = active.current ? flight.current.alt : 2500;
          return greatCirclePositions(from.lat, from.lon, alt, dest).map((pt) =>
            C.Cartesian3.fromDegrees(pt.lon, pt.lat, pt.alt),
          );
        }, false),
        width: 3,
        material: C.Color.fromCssColorString("#a4f4be").withAlpha(0.8),
        arcType: C.ArcType.NONE,
        clampToGround: false,
      },
    });
    heightExclude.current = [plane, marker, destMarker, destLine];
    const pickLocation = (position: C.Cartesian2) => {
      let p: C.Cartesian3 | undefined;
      if (tiles.current && v.scene.pickPositionSupported)
        p = v.scene.pickPosition(position);
      if (!p) {
        const ray = v.camera.getPickRay(position);
        if (ray && v.scene.globe.show) p = v.scene.globe.pick(ray, v.scene);
        else if (ray)
          p =
            v.camera.pickEllipsoid(position, v.scene.globe.ellipsoid) ||
            undefined;
      }
      if (!p) return null;
      const c = C.Cartographic.fromCartesian(p);
      return {
        lat: C.Math.toDegrees(c.latitude),
        lon: C.Math.toDegrees(c.longitude),
      };
    };
    const click = new C.ScreenSpaceEventHandler(v.scene.canvas);
    const applyMapPick = (
      position: C.Cartesian2,
      mode: "departure" | "destination",
    ) => {
      if (active.current) return;
      const picked = pickLocation(position);
      if (!picked) return;
      if (mode === "destination") {
        setDestination({
          name: "Map point",
          city: "Custom",
          icao: "",
          iata: "",
          lat: picked.lat,
          lon: picked.lon,
        });
        return;
      }
      setDepIata("");
      setLocation({
        lat: picked.lat,
        lon: picked.lon,
        name: "Custom departure",
      });
    };
    click.setInputAction((e: { position: C.Cartesian2 }) => {
      applyMapPick(e.position, clickModeRef.current);
    }, C.ScreenSpaceEventType.LEFT_CLICK);
    click.setInputAction((e: { position: C.Cartesian2 }) => {
      applyMapPick(e.position, "destination");
    }, C.ScreenSpaceEventType.RIGHT_CLICK);
    const down = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).matches("input,select,textarea,button"))
        return;
      const k = e.key.toLowerCase();
      if (["arrowup", "arrowdown", "arrowleft", "arrowright", " "].includes(k))
        e.preventDefault();
      keys.current.add(k);
      if (k === "pageup" || k === "pagedown") {
        e.preventDefault();
        if (!active.current) {
          const height = v.camera.positionCartographic.height;
          const amount = Math.max(80, Math.abs(height) * 0.12);
          if (k === "pageup") v.camera.zoomIn(amount);
          else v.camera.zoomOut(amount);
        } else {
          cameraZoomTarget.current = zoomAfterStep(
            cameraZoomTarget.current,
            k === "pageup" ? -1 : 1,
          );
        }
        return;
      }
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
      if (k === "b") {
        flight.current = { ...flight.current, boost: !flight.current.boost };
        setF({ ...flight.current });
      }
      if (k === "h" && active.current) {
        const rotor = rotorParams(aircraftRef.current);
        if (rotor && !flight.current.crashed) {
          flight.current = {
            ...flight.current,
            throttle: hoverTrimCollective(flight.current, ground.current, rotor),
          };
          setF({ ...flight.current });
        }
      }
      if (k === "p") {
        paused.current = !paused.current;
        setPause(paused.current);
      }
      if (k === "i") {
        invertPitch.current = !invertPitch.current;
        try {
          localStorage.setItem(INVERT_KEY, invertPitch.current ? "1" : "0");
        } catch {}
        setError(
          invertPitch.current
            ? "Pitch inverted: ↑ / W now raises the nose (arcade style). Press I to switch back."
            : "Pitch normal: ↓ / S raises the nose (flight-sim style). Press I to invert.",
        );
      }
    };
    const up = (e: KeyboardEvent) => keys.current.delete(e.key.toLowerCase());
    const blur = () => keys.current.clear();
    const scrollableZoomTarget = (target: EventTarget | null) =>
      Boolean(
        (target as HTMLElement | null)?.closest?.(
          "input,select,textarea,.help,.google-settings,.dispatch,.places,.results",
        ),
      );
    const wheel = (event: WheelEvent) => {
      if (scrollableZoomTarget(event.target)) return;
      event.preventDefault();
      if (!active.current) return;
      cameraZoomTarget.current = zoomAfterWheel(
        cameraZoomTarget.current,
        event.deltaY,
        event.deltaMode,
      );
    };
    const contextMenu = (event: Event) => {
      if ((event.target as HTMLElement)?.closest?.(".globe"))
        event.preventDefault();
    };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    window.addEventListener("blur", blur);
    window.addEventListener("wheel", wheel, { passive: false });
    host.current.addEventListener("contextmenu", contextMenu);
    let last = performance.now(),
      ui = 0,
      terrainTime = 0,
      accumulator = 0;
    let previousCamera: ExteriorCameraPose | undefined;
    const tick = () => {
      const now = performance.now(),
        dt = Math.min((now - last) / 1000, 0.1);
      last = now;
      plane.show = active.current && camera.current !== "cockpit";
      rotors.update(aircraftRef.current, flight.current, dt, active.current && !paused.current);
      v.scene.screenSpaceCameraController.enableInputs = !active.current;
      v.scene.screenSpaceCameraController.enableZoom = true;
      v.scene.screenSpaceCameraController.enableCollisionDetection =
        !active.current;
      marker.show = !active.current;
      if (!active.current) {
        previousCamera = undefined;
        accumulator = 0;
        return;
      }
      const a = flight.current;
      const cart = C.Cartographic.fromDegrees(a.lon, a.lat);
      // When Google 3D is active the globe is hidden, so do not sample it
      // (or the synchronous tileset height, which can hit a coarse LOD).
      // Launch refine + the periodic sampleHeightMostDetailed path below
      // provide ground height from the detailed tiles.
      if (!tiles.current || !v.scene.sampleHeightSupported) {
        const h = v.scene.globe.getHeight(cart);
        if (h !== undefined) ground.current = h;
      }
      if (now - terrainTime > 2000 && !pending.current) {
        terrainTime = now;
        pending.current = true;
        const sampledLat = a.lat,
          sampledLon = a.lon;
        const terrain = v.terrainProvider.availability
          ? C.sampleTerrainMostDetailed(v.terrainProvider, [cart])
          : Promise.resolve([cart]);
        const tileHeight =
          tiles.current && v.scene.sampleHeightSupported
            ? v.scene.sampleHeightMostDetailed(
                [cart],
                heightExclude.current,
              )
            : Promise.resolve([] as (C.Cartographic | undefined)[]);
        Promise.all([terrain, tileHeight])
          .then(([points, tilePoints]) => {
            if (
              Math.abs(flight.current.lat - sampledLat) < 0.02 &&
              Math.abs(flight.current.lon - sampledLon) < 0.02
            ) {
              const terrainH = points[0]?.height;
              const tileH = tilePoints[0]?.height;
              const candidate = Number.isFinite(tileH)
                ? (tileH as number)
                : Number.isFinite(terrainH)
                  ? (terrainH as number)
                  : undefined;
              if (
                candidate === undefined ||
                !isPlausibleGroundHeight(
                  candidate,
                  flight.current.alt,
                  ground.current,
                )
              )
                return;
              ground.current = candidate;
              if (
                performance.now() - airborneSince.current < DEPARTURE_GRACE_MS &&
                !flight.current.onGround &&
                flight.current.alt <= candidate + 3
              ) {
                flight.current = {
                  ...flight.current,
                  alt: Math.max(
                    flight.current.alt,
                    candidate + DEPARTURE_CLEARANCE_METERS,
                  ),
                  crashed: false,
                };
              }
            }
          })
          .catch(() => {})
          .finally(() => (pending.current = false));
      }
      const keyboard = keyboardControls(keys.current);
      const perf = aircraftRef.current.performance;
      const dest = destRef.current;
      const pilot: {
        pitch: number;
        roll: number;
        yaw: number;
        throttle: number;
        brake?: number;
      } = {
        pitch: clamp(
          (invertPitch.current ? -keyboard.pitch : keyboard.pitch) + touch.current.pitch,
          -1,
          1,
        ),
        roll: clamp(keyboard.roll + touch.current.roll, -1, 1),
        yaw: clamp(keyboard.yaw + touch.current.yaw, -1, 1),
        throttle: keyboard.throttle,
        brake: keyboard.brake,
      };
      let controls = pilot;
      if (apRef.current.engaged && dest) {
        if (isManualInput(pilot)) {
          apRef.current = disengageAutopilot(apRef.current);
        } else {
          const result = aircraftAutopilot(
            aircraftRef.current,
            flight.current,
            dest,
            apRef.current,
            ground.current,
          );
          apRef.current = result.state;
          controls = result.controls;
          navRef.current = result.nav;
        }
      } else if (dest) {
        navRef.current = navTo(flight.current, dest, false);
      } else {
        navRef.current = null;
      }
      const inGrace =
        now - airborneSince.current < DEPARTURE_GRACE_MS;
      if (
        inGrace &&
        !flight.current.crashed &&
        !flight.current.onGround &&
        flight.current.alt <= ground.current + 3
      ) {
        flight.current = {
          ...flight.current,
          alt: Math.max(
            flight.current.alt,
            ground.current + DEPARTURE_CLEARANCE_METERS,
          ),
          crashed: false,
        };
      }
      if (!paused.current) {
        accumulator += dt;
        while (accumulator >= 1 / 120) {
          flight.current = stepAircraft(
            aircraftRef.current,
            flight.current,
            controls,
            1 / 120,
            ground.current,
          );
          if (inGrace && flight.current.crashed) {
            flight.current = {
              ...flight.current,
              crashed: false,
              alt: Math.max(
                flight.current.alt,
                ground.current + DEPARTURE_CLEARANCE_METERS,
              ),
            };
          }
          accumulator -= 1 / 120;
        }
      } else accumulator = 0;
      // Viewer evaluates entity callbacks before this listener. Render camera
      // from that same pre-step pose so fast motion cannot outrun the model.
      const b = a;
      if (camera.current !== "cockpit") {
        const aspect =
          v.scene.canvas.clientWidth / Math.max(1, v.scene.canvas.clientHeight);
        const desired = computeExteriorCamera(
          { ...b, mode: camera.current as ExteriorCameraMode },
          aspect,
          aircraftRef.current.radiusMeters,
        );
        previousCamera = smoothExteriorCamera(previousCamera, desired, dt);
        const zoomAlpha = 1 - Math.exp(-dt / 0.18);
        cameraZoom.current +=
          (cameraZoomTarget.current - cameraZoom.current) * zoomAlpha;
        const view = applyCameraZoom(previousCamera, cameraZoom.current);
        v.container.closest("main")?.setAttribute(
          "data-camera-zoom",
          cameraZoom.current.toFixed(3),
        );
        v.camera.setView({
          destination: view.destination,
          orientation: {
            direction: view.direction,
            up: view.up,
          },
        });
      } else {
        previousCamera = undefined;
        // First-person view from the pilot seat, built from the same body
        // axes as the model so the view always matches the aircraft attitude.
        const origin = C.Cartesian3.fromDegrees(b.lon, b.lat, b.alt);
        const body = C.Matrix3.fromQuaternion(
          modelOrientation(origin, b.heading, b.pitch, b.roll),
        );
        const [ex, ey, ez] = aircraftRef.current.eye;
        const eye = C.Matrix3.multiplyByVector(
          body,
          new C.Cartesian3(ex, ey, ez),
          new C.Cartesian3(),
        );
        v.camera.setView({
          destination: C.Cartesian3.add(origin, eye, new C.Cartesian3()),
          orientation: {
            direction: C.Matrix3.multiplyByVector(body, C.Cartesian3.UNIT_X, new C.Cartesian3()),
            up: C.Matrix3.multiplyByVector(body, C.Cartesian3.UNIT_Z, new C.Cartesian3()),
          },
        });
      }
      if (now - ui > 100) {
        setF({ ...flight.current });
        setNav(navRef.current);
        const ap = apRef.current;
        setApMode(ap.engaged ? (ap.holding ? "hold" : "nav") : "off");
        flightAudio.update({
          flying: active.current,
          crashed: flight.current.crashed,
          stall: flight.current.stall && !isHoverCapable(aircraftRef.current),
          throttle: flight.current.throttle,
          speed: flight.current.speed,
          boost: flight.current.boost,
          engine: aircraftRef.current.engine,
        });
        ui = now;
      }
    };
    v.clock.onTick.addEventListener(tick);
    setReady(true);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
      window.removeEventListener("blur", blur);
      window.removeEventListener("wheel", wheel);
      host.current?.removeEventListener("contextmenu", contextMenu);
      click.destroy();
      planeEntity.current = null;
      if (host.current)
        delete (host.current as HTMLDivElement & { __viewer?: C.Viewer }).__viewer;
      heightExclude.current = [];
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
    setDepIata("");
    setLocation({ lat, lon, name });
    viewer.current?.camera.flyTo({
      destination: C.Cartesian3.fromDegrees(lon, lat, 35000),
      duration: 1.2,
      orientation: { heading: 0, pitch: -Math.PI / 2, roll: 0 },
    });
    setResults([]);
  };
  const pickDeparture = (r: Destination) => {
    locate(r.lat, r.lon, formatAirport(r));
    setDepIata(r.iata);
    setQuery("");
    setDepMatches([]);
    setRecentAirports((list) => pushRecent(r.iata, list));
  };
  const pickDestination = (r: Destination) => {
    setDestination(r);
    setDestQuery(r.iata ? `${r.iata} ${r.city}` : r.name);
    setDestResults([]);
    if (r.iata) setRecentAirports((list) => pushRecent(r.iata, list));
  };
  const swapRoute = () => {
    if (!destination) return;
    const dep = location;
    const depAirport = AIRPORTS.find((a) => a.iata === depIata);
    const nextDest: Destination = depAirport ?? {
      name: dep.name,
      city: dep.name,
      icao: "",
      iata: "",
      lat: dep.lat,
      lon: dep.lon,
    };
    const d = destination;
    locate(d.lat, d.lon, d.iata ? formatAirport(d) : d.name);
    setDepIata(d.iata || "");
    setDestination(nextDest);
    setDestQuery(nextDest.iata ? `${nextDest.iata} ${nextDest.city}` : nextDest.name);
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
    if (!authLoaded) return;
    if (!isSignedIn) {
      setAuthOpen(true);
      setBillingError("");
      return;
    }
    if (!entitlement.canFly) {
      setPaywall(true);
      setBillingError("");
      return;
    }
    const v = viewer.current;
    if (!v) return;
    v.camera.cancelFlight();
    setError("");
    keys.current.clear();
    touch.current = { pitch: 0, roll: 0, yaw: 0 };
    const p = C.Cartographic.fromDegrees(location.lon, location.lat);
    const cached = v.scene.globe.show
      ? v.scene.globe.getHeight(p) || 0
      : 0;
    ground.current = Number.isFinite(cached) ? cached : 0;
    airborneSince.current = performance.now();
    setFlightHint(true);
    apRef.current = disengageAutopilot(apRef.current);
    setApMode("off");
    const gear = gearHeight(aircraft);
    flight.current = spawnAircraft(
      aircraft,
      location.lat,
      location.lon,
      startOnGround ? cached + gear : Math.max(alt * 0.3048, cached + 150),
      heading,
      speed * 0.514444,
      speed > 480,
      startOnGround,
    );
    if (startOnGround) flight.current = { ...flight.current, alt: cached + gear };
    setF({ ...flight.current });
    void flightAudio.start().then(() =>
      flightAudio.update({
        flying: true,
        crashed: false,
        stall: false,
        throttle: flight.current.throttle,
        speed: flight.current.speed,
        boost: flight.current.boost,
        engine: aircraft.engine,
      }),
    );
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
        const points = await v.scene.sampleHeightMostDetailed(
          [p],
          heightExclude.current,
        );
        const tileH = points[0]?.height;
        if (
          Number.isFinite(tileH) &&
          isPlausibleGroundHeight(
            tileH as number,
            flight.current.alt,
            height,
          )
        )
          height = Math.max(height, tileH as number);
      }
      if (
        active.current &&
        Math.abs(flight.current.lat - departure.lat) < 0.01 &&
        Math.abs(flight.current.lon - departure.lon) < 0.01 &&
        Number.isFinite(height)
      ) {
        ground.current = height;
        flight.current = flight.current.onGround
          ? { ...flight.current, alt: height + gear, crashed: false }
          : {
              ...flight.current,
              alt: Math.max(
                flight.current.alt,
                height + DEPARTURE_CLEARANCE_METERS,
              ),
              crashed: false,
            };
      }
    };
    void refine().catch(() =>
      setStatus("Flying · available terrain clearance only"),
    );
    (document.activeElement as HTMLElement)?.blur();
  }
  async function togglePhoto(keyOverride?: string) {
    if (photoLoading) return;
    const v = viewer.current;
    if (!v) return;
    if (photo && tiles.current) {
      v.scene.primitives.remove(tiles.current);
      tiles.current = null;
      setFallbackGlobeVisible(v, true);
      setPhoto(false);
      setStatus("Free global scenery");
      if (!keyOverride) return;
    }
    const key = keyOverride || googleKey.trim();
    if (!key) {
      setGoogleSettings(true);
      setError(
        "Enter your Map Tiles API key to load Google 3D. Free scenery is ready to fly.",
      );
      return;
    }
    setError("");
    setGoogleSettings(false);
    setPhotoLoading(true);
    setStatus("Loading Google 3D…");
    try {
      const t = await C.createGooglePhotorealistic3DTileset(
        { key },
        {
          maximumScreenSpaceError: 8,
          cacheBytes: 1024 * 1024 * 1024,
          maximumCacheOverflowBytes: 512 * 1024 * 1024,
          dynamicScreenSpaceError: true,
        },
      );
      if (v.isDestroyed()) {
        setPhotoLoading(false);
        return;
      }
      v.scene.primitives.add(t);
      tiles.current = t;
      setFallbackGlobeVisible(v, false);
      setPhoto(true);
      setStatus("Loading Google 3D tiles…");
      const finishLoading = () => {
        if (v.isDestroyed() || tiles.current !== t) return;
        setStatus("Google photorealistic 3D");
        setPhotoLoading(false);
      };
      t.initialTilesLoaded.addEventListener(finishLoading);
      window.setTimeout(finishLoading, 10000);
      t.tileFailed.addEventListener(() =>
        setStatus("3D tiles unavailable here · global map fallback"),
      );
    } catch {
      setFallbackGlobeVisible(v, true);
      setStatus("Free global scenery");
      setError(
        "Google 3D could not load. Check API key, billing and domain restrictions.",
      );
      setPhotoLoading(false);
    }
  }

  const autoEnabledGoogle = useRef(false);
  useEffect(() => {
    if (!ready || !entitlement.canFly || autoEnabledGoogle.current || photo || photoLoading)
      return;
    let cancelled = false;
    const enable = async () => {
      try {
        const token = await getToken();
        if (!token) return;
        const res = await fetch("/api/maps-key", {
          headers: { Authorization: `Bearer ${token}` },
        });
        const data = (await res.json().catch(() => ({}))) as { key?: string; error?: string };
        if (!res.ok || !data.key || cancelled) return;
        autoEnabledGoogle.current = true;
        setGoogleKey(data.key);
        void togglePhoto(data.key);
      } catch {}
    };
    void enable();
    return () => {
      cancelled = true;
    };
  }, [ready, entitlement.canFly, photo, photoLoading, getToken]);
  useEffect(() => {
    void fetch("/api/config")
      .then((res) => res.json())
      .then((data) => {
        if (data?.prices?.month?.id && data?.prices?.year?.id) {
          setPriceIds({ month: data.prices.month.id, year: data.prices.year.id });
        }
      })
      .catch(() => {});
  }, []);
  useEffect(() => {
    if (entitlement.state) setTrialMs(entitlement.state.trialRemainingMs);
  }, [entitlement.state]);
  useEffect(() => {
    if (!isSignedIn) return;
    const params = new URLSearchParams(window.location.search);
    if (params.get("checkout") !== "success") return;
    const sessionId = params.get("session_id") || "";
    if (!sessionId) return;
    setBillingBusy(true);
    void entitlement
      .withToken(`/api/checkout/verify?session_id=${encodeURIComponent(sessionId)}`)
      .then(() => {
        window.history.replaceState({}, "", "/");
        setPaywall(false);
        setBillingError("");
      })
      .catch((err) =>
        setBillingError(err instanceof Error ? err.message : "Could not verify checkout."),
      )
      .finally(() => setBillingBusy(false));
  }, [isSignedIn]);
  useEffect(() => {
    if (!flying || !isSignedIn || entitlement.state?.entitled) return;
    let last = performance.now();
    const timer = window.setInterval(() => {
      if (paused.current) {
        last = performance.now();
        return;
      }
      const now = performance.now();
      const elapsedMs = now - last;
      last = now;
      void entitlement
        .withToken("/api/trial/heartbeat", {
          method: "POST",
          body: JSON.stringify({ elapsedMs }),
        })
        .then((data) => {
          const remaining = (data as { trialRemainingMs?: number }).trialRemainingMs ?? 0;
          setTrialMs(remaining);
          if (remaining <= 0 && !(data as { entitled?: boolean }).entitled) {
            paused.current = true;
            setPause(true);
            setPaywall(true);
            const v = viewer.current;
            if (v && tiles.current) {
              v.scene.primitives.remove(tiles.current);
              tiles.current = null;
              setFallbackGlobeVisible(v, true);
              setPhoto(false);
              setStatus("Free global scenery");
              autoEnabledGoogle.current = false;
            }
          }
        })
        .catch(() => {});
    }, 8000);
    return () => window.clearInterval(timer);
  }, [flying, isSignedIn, entitlement.state?.entitled]);
  const chooseAircraft = (id: string) => {
    const next = aircraftById(id);
    setAircraftId(next.id);
    persistAircraftId(next.id);
    setAlt(next.defaultAltFt);
    setSpeed(next.defaultSpeedKt);
    const plane = planeEntity.current;
    if (plane?.model) plane.model.uri = new C.ConstantProperty(next.uri);
  };
  const toggleMute = () => {
    const next = !flightAudio.muted;
    void flightAudio.start().then(() => {
      flightAudio.setMuted(next);
      setMuted(next);
    });
  };
  const toggleAutopilot = () => {
    if (!active.current || flight.current.crashed) return;
    if (apRef.current.engaged) {
      apRef.current = disengageAutopilot(apRef.current);
      setApMode("off");
      return;
    }
    if (!destRef.current) {
      setError("Set a destination before engaging autopilot.");
      return;
    }
    apRef.current = engageAutopilot(flight.current);
    setApMode("nav");
  };
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.target as HTMLElement).matches("input,select,textarea,button"))
        return;
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      if (event.key === "[" || event.key === "]") {
        event.preventDefault();
        const direction = event.key === "]" ? 1 : -1;
        setGaugeSize((current) => {
          const next = stepGaugeSize(current, direction);
          try {
            localStorage.setItem(GAUGE_SIZE_KEY, next);
          } catch {}
          return next;
        });
        return;
      }
      if (event.key === "g" || event.key === "G") {
        event.preventDefault();
        setGaugeSize((current) => {
          const next = cycleGaugeSize(current);
          try {
            localStorage.setItem(GAUGE_SIZE_KEY, next);
          } catch {}
          return next;
        });
        return;
      }
      if (event.key === "o" || event.key === "O") {
        event.preventDefault();
        toggleAutopilot();
        return;
      }
      if (event.key === "m" || event.key === "M") {
        event.preventDefault();
        toggleMute();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  useEffect(() => {
    if (!flightHint) return;
    const timer = window.setTimeout(() => setFlightHint(false), 7000);
    return () => window.clearTimeout(timer);
  }, [flightHint]);
  const returnMap = () => {
    active.current = false;
    setFlying(false);
    setFlightHint(false);
    apRef.current = disengageAutopilot(apRef.current);
    setApMode("off");
    flightAudio.stopLoops();
    const a = flight.current;
    locate(a.lat, a.lon, "Current position");
  };
  return (
    <main
      data-camera={flying ? cam : "planner"}
      data-touch={flying && touchVisible ? "true" : "false"}
      data-gauges={gaugesExpanded ? "expanded" : "compact"}
      data-gauge-size={gaugeSize}
      data-aircraft={aircraftId}
      data-autopilot={apMode}
      data-muted={muted ? "true" : "false"}
      data-destination={destination ? destination.iata || destination.name : ""}
      data-auth={isSignedIn ? "in" : "out"}
      data-entitled={entitlement.state?.entitled ? "true" : "false"}
      data-trial-ms={String(trialMs ?? entitlement.state?.trialRemainingMs ?? "")}
    >
      <div ref={host} className="globe" />
      {(photoLoading || status.startsWith("Loading Google")) && (
        <div className="scenery-loading" role="status">
          Loading Google 3D tiles…
        </div>
      )}
      <header>
        <a className="brand" href="#" onClick={(e) => e.preventDefault()}>
          <img className="brand-logo" src="/brand/logo-dark.png" alt="MADD FLIGHT" width="216" height="34" />
          <small className="brand-tag">THE WORLD IS YOUR RUNWAY</small>
        </a>
        <div className="top-right">
          <span className="live-dot" /> <span>{status}</span>
          {isSignedIn && entitlement.state && !entitlement.state.entitled && (
            <span className="trial-chip" data-trial={formatTrialClock(entitlement.state.trialRemainingMs)}>
              Trial {formatTrialClock(trialMs ?? entitlement.state.trialRemainingMs)}
            </span>
          )}
          {isSignedIn ? (
            <>
              {entitlement.state?.isAdmin && (
                <a className="admin-link" href="/admin">
                  Admin
                </a>
              )}
              <UserButton />
            </>
          ) : (
            <>
              <button
                onClick={() => {
                  openAuth("signIn");
                  setAuthOpen(true);
                }}
              >
                Sign in
              </button>
              <button
                className="signup-btn"
                onClick={() => {
                  openAuth("signUp");
                  setAuthOpen(true);
                }}
              >
                Sign up
              </button>
            </>
          )}
          <button onClick={() => setCredits(!credits)}>Credits</button>
          <button onClick={() => setHelp(!help)}>
            Controls <kbd>?</kbd>
          </button>
        </div>
      </header>
      {flying && flightHint && (
        <div className="flight-hint" role="note">
          Scroll to zoom · O autopilot · M mute · [ ] or G for gauges · ? for controls
        </div>
      )}
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
                onChange={(e) => {
                  const value = e.target.value;
                  setQuery(value);
                  setDepMatches(value.trim() ? searchAirports(value, 6) : []);
                }}
              />
              <button aria-label="Find location" disabled={searching}>
                {searching ? "…" : "↗"}
              </button>
            </form>
            {depMatches.length > 0 && (
              <div className="results dep-results" aria-label="Matching airports">
                {depMatches.map((r) => (
                  <button key={`dep-${r.icao}`} type="button" onClick={() => pickDeparture(r)}>
                    {formatAirport(r)} — {r.name}
                  </button>
                ))}
              </div>
            )}
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
              <span className="tag tag-dep">DEPARTURE</span>
            </div>
            <div className="quick-dest quick-dep" role="group" aria-label="Quick departure airports">
              {quickAirports(recentAirports).map(({ airport: r, recent }) => (
                <button
                  key={`dep-${r.iata}`}
                  type="button"
                  title={`${r.name}${recent ? " (recent)" : ""}`}
                  aria-pressed={depIata === r.iata}
                  data-recent={recent ? "1" : undefined}
                  onClick={() => pickDeparture(r)}
                >
                  {r.iata}
                </button>
              ))}
            </div>
            <div className="click-mode" role="group" aria-label="Map click sets">
              <button
                type="button"
                aria-pressed={clickMode === "departure"}
                onClick={() => setClickMode("departure")}
              >
                Click sets departure
              </button>
              <button
                type="button"
                aria-pressed={clickMode === "destination"}
                onClick={() => setClickMode("destination")}
              >
                Click sets destination
              </button>
            </div>
            <p className="hint">
              Left-click the globe to set {clickMode}. Right-click always sets
              the destination.
            </p>
            <div className="route-swap">
              <button
                type="button"
                onClick={swapRoute}
                disabled={!destination}
                title="Swap departure and destination"
              >
                ⇅ Swap departure / destination
              </button>
            </div>
            <form
              className="search dest-search"
              onSubmit={(e) => {
                e.preventDefault();
                setDestResults(searchAirports(destQuery, 8));
              }}
            >
              <span>◎</span>
              <input
                aria-label="Search destination airport or city"
                placeholder="Destination: SFO, LAX, London…"
                value={destQuery}
                onChange={(e) => {
                  const value = e.target.value;
                  setDestQuery(value);
                  setDestResults(value.trim() ? searchAirports(value, 8) : []);
                }}
              />
              <button type="submit" aria-label="Find destination">
                ↗
              </button>
            </form>
            {destResults.length > 0 && (
              <div className="results dest-results">
                {destResults.map((r) => (
                  <button
                    key={`${r.icao}-${r.lat}`}
                    onClick={() => pickDestination(r)}
                  >
                    {formatAirport(r)} — {r.name}
                  </button>
                ))}
              </div>
            )}
            <div className="destination dest-target">
              <span className="pin pin-dest">◎</span>
              <div>
                <strong>
                  {destination
                    ? destination.iata
                      ? formatAirport(destination)
                      : destination.name
                    : "No destination"}
                </strong>
                <small>
                  {destination
                    ? `${destination.lat.toFixed(4)}° / ${destination.lon.toFixed(4)}°`
                    : "Search or click the map"}
                </small>
              </div>
              {destination ? (
                <button
                  type="button"
                  className="clear-dest"
                  onClick={() => {
                    setDestination(null);
                    setDestQuery("");
                    setDestResults([]);
                  }}
                >
                  Clear
                </button>
              ) : (
                <span className="tag">DEST</span>
              )}
            </div>
            <div className="quick-dest" role="group" aria-label="Quick destination airports">
              {quickAirports(recentAirports).map(({ airport: r, recent }) => (
                <button
                  key={`dest-${r.iata}`}
                  type="button"
                  title={`${r.name}${recent ? " (recent)" : ""}`}
                  aria-pressed={destination?.iata === r.iata}
                  data-recent={recent ? "1" : undefined}
                  onClick={() => pickDestination(r)}
                >
                  {r.iata}
                </button>
              ))}
            </div>
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
                  min={aircraft.plannerMinKt}
                  max={aircraft.plannerMaxKt}
                  value={speed}
                  onChange={(e) =>
                    setSpeed(
                      clamp(
                        Number(e.target.value),
                        aircraft.plannerMinKt,
                        aircraft.plannerMaxKt,
                      ),
                    )
                  }
                />
              </label>
            </div>
            <label className="ground-start">
              <input
                type="checkbox"
                checked={startOnGround}
                onChange={(e) => setStartOnGround(e.target.checked)}
              />
              Start on the ground{" "}
              <span>
                {isHoverCapable(aircraft)
                  ? "(vertical takeoff)"
                  : "(take off from here)"}
              </span>
            </label>
            <div className="aircraft-picker" role="listbox" aria-label="Aircraft">
              <div className="aircraft-picker-label">AIRCRAFT</div>
              {AIRCRAFT.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  role="option"
                  aria-selected={aircraftId === item.id}
                  data-aircraft-option={item.id}
                  onClick={() => chooseAircraft(item.id)}
                >
                  <strong>{item.name}</strong>
                  <small>{item.blurb}</small>
                </button>
              ))}
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
            <button aria-label="Flight planner" onClick={returnMap}>
              <span className="planner-full">← Flight planner</span>
              <span className="planner-compact">Map</span>
            </button>
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
            <button
              className="ap-toggle"
              aria-pressed={apMode !== "off"}
              data-ap={apMode}
              onClick={toggleAutopilot}
            >
              AP {apMode === "off" ? "off" : apMode === "hold" ? "hold" : "on"}{" "}
              <kbd>O</kbd>
            </button>
            <button
              className="mute-toggle"
              aria-pressed={muted}
              aria-label={muted ? "Unmute" : "Mute"}
              onClick={toggleMute}
            >
              {muted ? "Muted" : "Sound"} <kbd>M</kbd>
            </button>
          </div>
          <button
            className="touch-toggle"
            aria-pressed={touchVisible}
            onClick={() => setTouchVisible(!touchVisible)}
          >
            Touch controls {touchVisible ? "on" : "off"}
          </button>
          <button
            className="desktop-boost"
            aria-pressed={f.boost}
            onClick={() => {
              flight.current = {
                ...flight.current,
                boost: !flight.current.boost,
              };
              setF({ ...flight.current });
            }}
          >
            Boost {f.boost ? "on" : "off"} · B
          </button>
          <div className="phone-actions">
            <button
              aria-label="Speed boost"
              aria-pressed={f.boost}
              onClick={() => {
                flight.current = {
                  ...flight.current,
                  boost: !flight.current.boost,
                };
                setF({ ...flight.current });
              }}
            >
              Boost
            </button>
            <button
              aria-pressed={apMode !== "off"}
              onClick={toggleAutopilot}
            >
              AP
            </button>
            <button
              aria-pressed={muted}
              onClick={toggleMute}
            >
              {muted ? "Muted" : "Sound"}
            </button>
            <button
              aria-expanded={gaugesExpanded}
              onClick={() => setGaugesExpanded(!gaugesExpanded)}
            >
              Gauges
            </button>
            <div className="gauge-size" role="group" aria-label="Instrument size">
              <button
                type="button"
                aria-label="Smaller gauges"
                disabled={gaugeSize === "sm"}
                onClick={() => persistGaugeSize(stepGaugeSize(gaugeSize, -1))}
              >
                [
              </button>
              <span aria-live="polite">{gaugeSize.toUpperCase()}</span>
              <button
                type="button"
                aria-label="Larger gauges"
                disabled={gaugeSize === "xl"}
                onClick={() => persistGaugeSize(stepGaugeSize(gaugeSize, 1))}
              >
                ]
              </button>
            </div>
          </div>
          <div className="phone-hud" aria-label="Compact flight instruments">
            <span>
              <small>KTS</small>
              {Math.round(f.speed / 0.514444)}
            </span>
            <span>
              <small>FT MSL</small>
              {Math.round(f.alt / 0.3048).toLocaleString()}
            </span>
            <span>
              <small>HDG</small>
              {String(Math.round(f.heading) % 360).padStart(3, "0")}°
            </span>
            <span>
              <small>FT AGL</small>
              {Math.round((f.alt - ground.current) / 0.3048)}
            </span>
          </div>
          <div className="rotate-hint">
            <span>{orientationHint}</span>
            <button onClick={requestLandscape}>Landscape</button>
          </div>
          <div
            className="heading-strip"
            data-nav={destination ? "on" : "off"}
            data-ap={apMode}
          >
            <div className="hdg-tape" aria-hidden="true">
              {Array.from({ length: 36 }, (_, i) => {
                const deg = i * 10;
                const offset = ((deg - f.heading + 540) % 360) - 180;
                if (Math.abs(offset) > 100) return null;
                const major = deg % 30 === 0;
                return (
                  <span
                    key={deg}
                    className={major ? "hdg-tick major" : "hdg-tick"}
                    style={{ left: `calc(50% + ${offset * 3}px)` }}
                  >
                    {major
                      ? deg === 0
                        ? "N"
                        : deg === 90
                          ? "E"
                          : deg === 180
                            ? "S"
                            : deg === 270
                              ? "W"
                              : String(deg).padStart(3, "0")
                      : ""}
                  </span>
                );
              })}
              {nav && (
                <span
                  className="hdg-bug"
                  style={{
                    left: `calc(50% + ${Math.max(-90, Math.min(90, nav.bugOffsetDeg)) * 3}px)`,
                  }}
                />
              )}
              <span className="hdg-caret" />
            </div>
            <div className="hdg-readout">
              {String(Math.round(f.heading) % 360).padStart(3, "0")}°
              <small>HEADING</small>
            </div>
            {nav && destination && (
              <div className="nav-readout">
                <span>
                  BRG {String(Math.round(nav.bearing) % 360).padStart(3, "0")}°
                </span>
                <span>{formatDistance(nav.distanceMeters)}</span>
                <span>
                  {nav.holding ? "HOLD" : `ETA ${formatEta(nav.etaSec)}`}
                </span>
              </div>
            )}
          </div>
          <div className="reticle">
            ┈┈ <span>⌖</span> ┈┈
          </div>
          {cam === "cockpit" && <Cockpit flight={f} aircraft={aircraft} />}
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
            <div
              className="gauge-size gauge-size-panel"
              role="group"
              aria-label="Instrument size"
            >
              {GAUGE_SIZES.map((size) => (
                <button
                  key={size}
                  type="button"
                  aria-label={`Gauge size ${size.toUpperCase()}`}
                  aria-pressed={gaugeSize === size}
                  onClick={() => persistGaugeSize(size)}
                >
                  {size.toUpperCase()}
                </button>
              ))}
            </div>
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
              label={isHoverCapable(aircraft) ? "COLLECTIVE" : "THROTTLE"}
              value={Math.round(f.throttle * 100)}
              unit={isHoverCapable(aircraft) ? `% · HOVER ${Math.round(HOVER_COLLECTIVE * 100)}` : "%"}
            />
            <Instrument
              label="CLEARANCE"
              value={Math.round((f.alt - ground.current) / 0.3048)}
              unit="FT AGL"
            />
          </div>
          {f.onGround && !f.crashed && !pause && (
            <div className="ground-chip" data-on-ground="1">
              {isHoverCapable(aircraft)
                ? "ON GROUND · R / + raise collective to lift off"
                : f.speed < 1
                  ? "ON GROUND · + throttle to roll, ↓ / S to rotate"
                  : "ROLLING · Space brakes · ↓ / S to rotate"}
            </div>
          )}
          {(f.crashed || pause || (f.stall && !isHoverCapable(aircraft))) && (
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
      <Paywall
        open={paywall || Boolean(isSignedIn && entitlement.state && !entitlement.canFly && !flying)}
        state={entitlement.state}
        busy={billingBusy}
        error={billingError || entitlement.error}
        signedIn={Boolean(isSignedIn)}
        onSignIn={() => setAuthOpen(true)}
        onCheckout={async (plan) => {
          setBillingBusy(true);
          setBillingError("");
          try {
            const priceId = plan === "month" ? priceIds.month : priceIds.year;
            const session = await entitlement.withToken<{ url: string }>("/api/checkout", {
              method: "POST",
              body: JSON.stringify({ priceId }),
            });
            if (session.url) window.location.href = session.url;
          } catch (err) {
            setBillingError(err instanceof Error ? err.message : "Could not start checkout.");
          } finally {
            setBillingBusy(false);
          }
        }}
        onRestore={async (email) => {
          setBillingBusy(true);
          setBillingError("");
          try {
            await entitlement.withToken("/api/restore", {
              method: "POST",
              body: JSON.stringify({ email }),
            });
            setPaywall(false);
          } catch (err) {
            setBillingError(err instanceof Error ? err.message : "Could not restore the purchase.");
          } finally {
            setBillingBusy(false);
          }
        }}
        onRedeem={async (code) => {
          setBillingBusy(true);
          setBillingError("");
          try {
            await entitlement.withToken("/api/codes/redeem", {
              method: "POST",
              body: JSON.stringify({ code }),
            });
            setPaywall(false);
          } catch (err) {
            setBillingError(err instanceof Error ? err.message : "Could not redeem that code.");
          } finally {
            setBillingBusy(false);
          }
        }}
      />
      {authOpen && !isSignedIn && (
        <div className="clerk-modal" role="dialog" aria-modal="true" aria-label="Sign in">
          <div className="clerk-modal-backdrop" onClick={closeAuth} />
          <div className="clerk-modal-card">
            <button className="close" onClick={closeAuth} aria-label="Close sign in">
              ×
            </button>
            <AuthPanel />
          </div>
        </div>
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
          {(isHoverCapable(aircraft)
            ? [
                ["R / +", "Collective up: climb (hold to raise)"],
                ["F / −", "Collective down: descend / land"],
                ["H", "Hover trim: set collective to hold altitude"],
                ["↑ ↓ / W S", "Cyclic forward / back (tilt to fly)"],
                ["← → / A D", "Cyclic left / right (sideways)"],
                ["Q / E", "Pedals: yaw left / right (tail rotor)"],
                ["I", "Invert pitch keys"],
                ["Scroll wheel", "Zoom camera in / out"],
                ["Page Up / Page Down", "Zoom camera in / out"],
                ["[ / ]", "Smaller / larger gauges"],
                ["G", "Cycle gauge size"],
                ["C", "Cycle chase / cockpit / wing / front"],
                ["P", "Pause / resume"],
                ["O", "Autopilot on / off (set a destination first)"],
                ["M", "Mute / unmute sound"],
              ]
            : [
            ["↑ / W", "Push nose down (aircraft-relative)"],
            ["↓ / S", "Pull nose up (aircraft-relative)"],
            ["← → / A D", "Roll left / right"],
            ["Q / E", "Rudder left / right"],
            ["I", "Invert pitch keys (↑ / W climbs)"],
            ["+ / − (R / F)", "Increase / decrease throttle"],
            ["Space", "Wheel brakes on the ground"],
            ["Scroll wheel", "Zoom camera in / out"],
            ["Page Up / Page Down", "Zoom camera in / out"],
            ["[ / ]", "Smaller / larger gauges"],
            ["G", "Cycle gauge size"],
            ["C", "Cycle chase / cockpit / wing / front"],
            ["B", "Toggle arcade speed boost"],
            ["P", "Pause / resume"],
            ["O", "Autopilot on / off (set a destination first)"],
            ["M", "Mute / unmute sound"],
          ]).map(([k, t]) => (
            <div key={k}>
              <kbd>{k}</kbd>
              <span>{t}</span>
            </div>
          ))}
          {isHoverCapable(aircraft) ? (
            <p>
              Collective sets lift: at about {Math.round(HOVER_COLLECTIVE * 100)}%
              the {aircraft.name} hovers and holds altitude (press H to trim).
              Raise it to climb straight up, lower it to descend. Tilt the
              cyclic to fly that way; let go and the helicopter levels and
              slows to a hover. Ground effect adds lift near the ground, and
              you gain extra lift above about 20 knots. Land gently (under
              about 700 ft/min, level, slow) anywhere flat and you stay put;
              raise the collective to take off again. Helicopters do not stall.
            </p>
          ) : (
          <p>
            Bank to turn. Touch down gently (under about 1,000 ft/min, wings
            level) to land and roll out; Space brakes. Keep airspeed above {stallKnots(aircraft)} knots in
            the {aircraft.name}. Autopilot holds altitude and speed and flies a
            great-circle to your destination, then circles in a hold. Manual
            stick or throttle input disengages it. Spawn height automatically
            clears terrain by at least 150 m. Simplified recreational physics.
          </p>
          )}
        </section>
      )}
      {credits && (
        <section className="credits panel" role="dialog" aria-label="Credits">
          <button className="close" onClick={() => setCredits(false)}>
            ×
          </button>
          <h2>Aircraft credits</h2>
          <p>
            Models are used under open licenses. Sounds are procedural (no
            sampled recordings).
          </p>
          {AIRCRAFT.map((item) => (
            <div key={item.id} className="credit-row">
              <strong>{item.name}</strong>
              <span>
                {item.credit.title} by {item.credit.author} ·{" "}
                <a href={item.credit.licenseUrl} target="_blank" rel="noreferrer">
                  {item.credit.license}
                </a>
              </span>
              <small>
                {item.credit.modifications}{" "}
                <a href={item.credit.sourceUrl} target="_blank" rel="noreferrer">
                  Source
                </a>
              </small>
            </div>
          ))}
        </section>
      )}
      {googleSettings && (
        <div className="google-settings-backdrop">
          <section
            className="google-settings panel"
            role="dialog"
            aria-modal="true"
            aria-label="Google 3D settings"
          >
            <button
              className="close"
              aria-label="Close Google settings"
              onClick={() => {
                setGoogleSettings(false);
                setError("");
              }}
            >
              ×
            </button>
            <h2>Connect Google 3D</h2>
            <p>
              Paste your Google Maps Platform <strong>Map Tiles API</strong>{" "}
              key. Restrict it to this website in Google Cloud.
            </p>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void togglePhoto(googleKey.trim());
              }}
            >
              <label htmlFor="google-key">Google Maps API key</label>
              <input
                id="google-key"
                type="password"
                autoComplete="off"
                autoCapitalize="none"
                spellCheck={false}
                autoFocus
                required
                minLength={10}
                value={googleKey}
                onChange={(e) => setGoogleKey(e.target.value)}
                placeholder="Paste your API key"
              />
              <small>
                Used only in this browser session. No key is saved to the
                repository.
              </small>
              <p className="billing-note">
                Loading Google tiles can incur Google usage charges.
              </p>
              <button
                className="launch"
                disabled={photoLoading || !googleKey.trim()}
                type="submit"
              >
                Load Google 3D ↗
              </button>
            </form>
          </section>
        </div>
      )}
      <footer>
        <span>
          ◈ WORLD EXPLORER <span className="muted">/</span>{" "}
          {flying ? "IN FLIGHT" : "PREFLIGHT"}
        </span>
        <div>
          <button
            disabled={photoLoading}
            onClick={() => {
              if (!entitlement.canFly) {
                if (!isSignedIn) setAuthOpen(true);
                else setPaywall(true);
                return;
              }
              void togglePhoto(googleKey || undefined);
            }}
          >
            {photoLoading
              ? "Loading Google 3D…"
              : photo
                ? "● Google 3D"
                : "○ Enable Google 3D"}
          </button>
          {!entitlement.canFly && isSignedIn && (
            <button onClick={() => setPaywall(true)}>Unlock Google 3D</button>
          )}
          <button
            className="mute-toggle"
            aria-pressed={muted}
            onClick={toggleMute}
          >
            {muted ? "Muted" : "Sound"} · M
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
const clerkAppearance = {
  // Clerk Core 3 renamed appearance.layout to appearance.options.
  options: {
    logoImageUrl: "/brand/logo-dark.png",
    logoPlacement: "inside" as const,
  },
  variables: {
    colorPrimary: "#a4f4be",
    colorPrimaryForeground: "#04140b",
    colorBackground: "#0f1f2a",
    colorForeground: "#ffffff",
    colorText: "#ffffff",
    colorTextSecondary: "#c9dde6",
    colorMutedForeground: "#c9dde6",
    colorInput: "#183342",
    colorInputBackground: "#183342",
    colorInputForeground: "#ffffff",
    colorInputText: "#ffffff",
    colorNeutral: "#ffffff",
    colorDanger: "#ff8a8a",
    fontSize: "15px",
    borderRadius: "8px",
  },
  elements: {
    rootBox: { width: "100%" },
    cardBox: {
      width: "100%",
      background: "#0f1f2a",
      border: "1px solid #3b5a6b",
      boxShadow: "0 24px 60px rgba(0,0,0,0.6)",
    },
    card: { background: "#0f1f2a", boxShadow: "none" },
    footer: { background: "#0b1820" },
    logoBox: { height: "40px", justifyContent: "center" },
    logoImage: { height: "36px", width: "auto" },
    headerTitle: { color: "#ffffff", fontSize: "20px" },
    headerSubtitle: { color: "#c9dde6" },
    formFieldLabel: { color: "#ffffff", fontWeight: 600 },
    formFieldInput: {
      background: "#183342",
      color: "#ffffff",
      border: "1px solid #4d7487",
    },
    formButtonPrimary: { color: "#04140b", fontWeight: 700 },
    footerActionText: { color: "#c9dde6" },
    footerActionLink: { color: "#a4f4be", fontWeight: 600 },
    dividerText: { color: "#c9dde6" },
    socialButtonsBlockButton: { color: "#ffffff", border: "1px solid #4d7487" },
  },
};
const INVERT_KEY = "maddflight-invert-pitch";
function readInvertPitch(): boolean {
  try {
    return localStorage.getItem(INVERT_KEY) === "1";
  } catch {
    return false;
  }
}
function Root() {
  if (window.location.pathname.startsWith("/admin")) return <AdminPage />;
  return <App />;
}
createRoot(document.getElementById("root")!).render(
  <ClerkProvider
    publishableKey={clerkPublishableKey}
    proxyUrl={window.location.origin + "/__clerk"}
    appearance={clerkAppearance}
    signInUrl="/"
    signUpUrl="/"
  >
    <Root />
  </ClerkProvider>,
);
