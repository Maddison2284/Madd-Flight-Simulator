import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn, step, DEFAULT_PERFORMANCE, wrap } from "../src/physics.ts";
import {
  ARRIVAL_METERS,
  autopilotControls,
  engageAutopilot,
  formatDistance,
  formatEta,
  greatCircleBearingDeg,
  greatCircleDistanceMeters,
  headingErrorDeg,
  isManualInput,
  navTo,
} from "../src/autopilot.ts";
import { searchAirports } from "../src/destinations.ts";

const lax = { name: "Los Angeles Intl", city: "Los Angeles", icao: "KLAX", iata: "LAX", lat: 33.9425, lon: -118.408 };
const sfo = { name: "San Francisco Intl", city: "San Francisco", icao: "KSFO", iata: "SFO", lat: 37.6188, lon: -122.3754 };

test("great-circle SFO to LAX is southeast and about 337 NM", () => {
  const meters = greatCircleDistanceMeters(sfo.lat, sfo.lon, lax.lat, lax.lon);
  const nm = meters / 1852;
  assert.ok(nm > 280 && nm < 320, `unexpected distance ${nm} NM`);
  const bearing = greatCircleBearingDeg(sfo.lat, sfo.lon, lax.lat, lax.lon);
  assert.ok(bearing > 120 && bearing < 150, `unexpected bearing ${bearing}`);
  assert.equal(wrap(headingErrorDeg(bearing, bearing) + 360), 0);
});

test("airport search finds LAX by code or city", () => {
  assert.equal(searchAirports("LAX")[0].iata, "LAX");
  assert.ok(searchAirports("los angeles")[0].iata === "LAX");
});

test("autopilot from SFO toward LAX reduces heading error and holds altitude", () => {
  let f = spawn(sfo.lat, sfo.lon, 900, 90, 120);
  let ap = engageAutopilot(f);
  const startError = Math.abs(navTo(f, lax, false).bugOffsetDeg);
  for (let i = 0; i < 2400; i++) {
    const { controls, state } = autopilotControls(f, lax, ap, DEFAULT_PERFORMANCE);
    ap = state;
    f = step(f, controls, 1 / 60, 0, DEFAULT_PERFORMANCE);
  }
  const nav = navTo(f, lax, ap.holding);
  assert.equal(f.crashed, false);
  assert.ok(f.alt > 800, `lost altitude ${f.alt}`);
  assert.ok(Math.abs(f.alt - 900) < 80, `altitude wander ${f.alt}`);
  assert.ok(Math.abs(nav.bugOffsetDeg) < startError * 0.35 || nav.holding);
  assert.ok(nav.distanceMeters < greatCircleDistanceMeters(sfo.lat, sfo.lon, lax.lat, lax.lon) - 2000);
});

test("arrival near the destination enters a hold rather than overflying forever", () => {
  let f = spawn(lax.lat + 0.03, lax.lon, 900, 180, 120);
  let ap = engageAutopilot(f);
  for (let i = 0; i < 1800; i++) {
    const { controls, state } = autopilotControls(f, lax, ap, DEFAULT_PERFORMANCE);
    ap = state;
    f = step(f, controls, 1 / 60, 0, DEFAULT_PERFORMANCE);
  }
  assert.equal(f.crashed, false);
  assert.ok(ap.holding);
  const distance = greatCircleDistanceMeters(f.lat, f.lon, lax.lat, lax.lon);
  assert.ok(distance < ARRIVAL_METERS + 4000);
});

test("manual stick input is detected and formatters are stable", () => {
  assert.equal(isManualInput({ pitch: 0, roll: 0, yaw: 0, throttle: 0 }), false);
  assert.equal(isManualInput({ pitch: 0.5, roll: 0, yaw: 0, throttle: 0 }), true);
  assert.match(formatDistance(1852 * 12.3), /12/);
  assert.equal(formatEta(65), "1:05");
});
