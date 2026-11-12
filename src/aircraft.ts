import type { ModelFix } from "./attitude";
import { SAUCER, type RotorcraftParams } from "./heli";
import {
  type Performance,
} from "./physics";

export type EngineKind = "prop" | "jet" | "rotor" | "saucer";

export type AircraftCredit = {
  title: string;
  author: string;
  license: string;
  licenseUrl: string;
  sourceUrl: string;
  modifications: string;
};

export type Aircraft = {
  id: string;
  name: string;
  shortName: string;
  blurb: string;
  uri: string;
  engine: EngineKind;
  radiusMeters: number;
  /** Model-frame correction so the GLB nose is +X, left wing +Y, top +Z. */
  modelFix: ModelFix;
  /** Pilot eye point in the body frame (m): forward, left, up from model origin. */
  eye: [number, number, number];
  performance: Performance;
  /** Hover flight model for "saucer" aircraft (rotorcraft-style physics). */
  hover?: RotorcraftParams;
  defaultAltFt: number;
  defaultSpeedKt: number;
  plannerMinKt: number;
  plannerMaxKt: number;
  credit: AircraftCredit;
};

export const AIRCRAFT: Aircraft[] = [
  {
    id: "c172",
    name: "Cessna 172",
    shortName: "C172",
    blurb: "High-wing trainer · piston prop",
    uri: "/models/c172.glb",
    engine: "prop",
    radiusMeters: 6,
    modelFix: { heading: -90, pitch: 0, roll: 0 },
    eye: [0.6, 0.35, 0.75],
    performance: {
      stallSpeed: 24,
      minSpeed: 15,
      spawnMax: 75,
      cruiseMax: 80,
      boostMax: 200,
      thrust: 6,
      boostThrust: 40,
      drag: 0.00035,
      boostDrag: 0.00008,
      rollRate: 32,
      pitchRate: 16,
      yawRate: 12,
      stallSink: 0.7,
      gear: 1.4,
    },
    defaultAltFt: 2500,
    defaultSpeedKt: 110,
    plannerMinKt: 60,
    plannerMaxKt: 180,
    credit: {
      title: "Cessna 172",
      author: "e737",
      license: "CC BY 4.0",
      licenseUrl: "https://creativecommons.org/licenses/by/4.0/",
      sourceUrl: "https://github.com/bilawalsidhu/gods-eye-view",
      modifications:
        "Optimized webp GLB via gods-eye-view (bilawalsidhu); used with original author credit.",
    },
  },
  {
    id: "citation",
    name: "Cessna Citation",
    shortName: "Citation",
    blurb: "Light business jet · twin turbofan",
    uri: "/models/citation2.glb",
    engine: "jet",
    radiusMeters: 9,
    modelFix: { heading: -90, pitch: 0, roll: 0 },
    eye: [3.6, 0.4, 0.7],
    performance: {
      stallSpeed: 42,
      minSpeed: 20,
      spawnMax: 200,
      cruiseMax: 220,
      boostMax: 500,
      thrust: 10,
      boostThrust: 80,
      drag: 0.00016,
      boostDrag: 0.00005,
      rollRate: 40,
      pitchRate: 18,
      yawRate: 10,
      stallSink: 0.6,
    },
    defaultAltFt: 3000,
    defaultSpeedKt: 230,
    plannerMinKt: 110,
    plannerMaxKt: 450,
    credit: {
      title: "private jet / Citation-type",
      author: "BlenderCommunityHead",
      license: "CC BY 4.0",
      licenseUrl: "https://creativecommons.org/licenses/by/4.0/",
      sourceUrl: "https://github.com/bilawalsidhu/gods-eye-view",
      modifications:
        "Optimized webp GLB via gods-eye-view (bilawalsidhu); used with original author credit.",
    },
  },
  {
    id: "a320",
    name: "Airbus A320",
    shortName: "A320",
    blurb: "Narrow-body airliner · logo-free",
    uri: "/models/a320.glb",
    engine: "jet",
    radiusMeters: 22,
    modelFix: { heading: 90, pitch: 0, roll: 0 },
    eye: [15.5, 0.5, 1.9],
    performance: {
      stallSpeed: 70,
      minSpeed: 40,
      spawnMax: 250,
      cruiseMax: 260,
      boostMax: 400,
      thrust: 12,
      boostThrust: 50,
      drag: 0.00012,
      boostDrag: 0.00005,
      rollRate: 22,
      pitchRate: 12,
      yawRate: 6,
      stallSink: 0.55,
    },
    defaultAltFt: 5000,
    defaultSpeedKt: 250,
    plannerMinKt: 140,
    plannerMaxKt: 520,
    credit: {
      title: "A320 (logo-free)",
      author: "amvlab",
      license: "CC BY 4.0",
      licenseUrl: "https://creativecommons.org/licenses/by/4.0/",
      sourceUrl: "https://github.com/amvlab/aircraft-models",
      modifications: "Draco + weld optimization for web delivery; no livery changes.",
    },
  },
  {
    id: "fighter",
    name: "Stealth Fighter",
    shortName: "Fighter",
    blurb: "Twin-engine stealth fighter",
    uri: "/models/fighter.glb",
    engine: "jet",
    radiusMeters: 10,
    modelFix: { heading: 0, pitch: 0, roll: 0 },
    eye: [4.2, 0, 1.0],
    performance: {
      stallSpeed: 60,
      minSpeed: 30,
      spawnMax: 350,
      cruiseMax: 400,
      boostMax: 1100,
      thrust: 22,
      boostThrust: 120,
      drag: 0.0001,
      boostDrag: 0.00004,
      rollRate: 80,
      pitchRate: 32,
      yawRate: 16,
      stallSink: 0.5,
    },
    defaultAltFt: 4000,
    defaultSpeedKt: 350,
    plannerMinKt: 140,
    plannerMaxKt: 2000,
    credit: {
      title: "Stealth Fighter",
      author: "tevy.dev",
      license: "CC0 1.0",
      licenseUrl: "https://creativecommons.org/publicdomain/zero/1.0/",
      sourceUrl: "https://tevy.dev/models/stealth-fighter",
      modifications: "LOD0 GLB used as published (meshopt + Basis).",
    },
  },
  {
    id: "bell206",
    name: "Bell 206",
    shortName: "B206",
    blurb: "Light utility helicopter",
    uri: "/models/bell206.glb",
    engine: "rotor",
    radiusMeters: 7,
    modelFix: { heading: -90, pitch: 0, roll: 0 },
    eye: [2.0, -0.35, 0.25],
    performance: {
      stallSpeed: 8,
      minSpeed: 5,
      spawnMax: 70,
      cruiseMax: 75,
      boostMax: 120,
      thrust: 7,
      boostThrust: 30,
      drag: 0.0004,
      boostDrag: 0.0001,
      rollRate: 28,
      pitchRate: 20,
      yawRate: 20,
      stallSink: 0.4,
    },
    defaultAltFt: 1500,
    defaultSpeedKt: 90,
    plannerMinKt: 40,
    plannerMaxKt: 150,
    credit: {
      title: "Bell 206",
      author: "terran4627",
      license: "CC BY 4.0",
      licenseUrl: "https://creativecommons.org/licenses/by/4.0/",
      sourceUrl: "https://github.com/bilawalsidhu/gods-eye-view",
      modifications:
        "Optimized webp GLB via gods-eye-view (bilawalsidhu); used with original author credit.",
    },
  },
  {
    id: "saucer",
    name: "MADD Saucer",
    shortName: "Saucer",
    blurb: "Fictional spacecraft · assisted hover",
    uri: "/models/saucer.glb",
    engine: "saucer",
    radiusMeters: 9,
    modelFix: { heading: 0, pitch: 0, roll: 0 },
    eye: [1.0, 0, 1.2],
    performance: {
      stallSpeed: 1,
      minSpeed: 0,
      spawnMax: 130,
      cruiseMax: 130,
      boostMax: 130,
      thrust: 0,
      boostThrust: 0,
      drag: 0,
      boostDrag: 0,
      rollRate: 40,
      pitchRate: 30,
      yawRate: 60,
      stallSink: 0,
    },
    hover: SAUCER,
    defaultAltFt: 1500,
    defaultSpeedKt: 0,
    plannerMinKt: 0,
    plannerMaxKt: 250,
    credit: {
      title: "MADD Saucer",
      author: "MADD Flight",
      license: "CC0 1.0",
      licenseUrl: "https://creativecommons.org/publicdomain/zero/1.0/",
      sourceUrl: "https://maddflight.maddisonempire.com/",
      modifications: "Original procedural model (scripts/build-saucer.mjs).",
    },
  },
];

export const DEFAULT_AIRCRAFT_ID = "citation";
const AIRCRAFT_KEY = "maddflight-aircraft";

export function aircraftById(id: string | null | undefined): Aircraft {
  return (
    AIRCRAFT.find((item) => item.id === id) ??
    AIRCRAFT.find((item) => item.id === DEFAULT_AIRCRAFT_ID)!
  );
}

export function readAircraftId(): string {
  try {
    const value = localStorage.getItem(AIRCRAFT_KEY);
    if (value && AIRCRAFT.some((item) => item.id === value)) return value;
  } catch {}
  return DEFAULT_AIRCRAFT_ID;
}

export function persistAircraftId(id: string) {
  try {
    localStorage.setItem(AIRCRAFT_KEY, id);
  } catch {}
}

export function stallKnots(aircraft: Aircraft): number {
  return Math.round(aircraft.performance.stallSpeed / 0.514444);
}
