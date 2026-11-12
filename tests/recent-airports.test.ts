import { test } from "node:test";
import assert from "node:assert/strict";
import { pushRecent, quickAirports } from "../src/recent-airports";
import { searchAirports } from "../src/destinations";

test("recent picks go first, de-duplicated, max 6", () => {
  let list: string[] = [];
  for (const c of ["LHR", "SFO", "LHR", "HND", "JFK", "DXB", "SYD", "CDG"]) list = pushRecent(c, list);
  assert.deepEqual(list, ["CDG", "SYD", "DXB", "JFK", "HND", "LHR"]);
});

test("quick airports: recents then defaults, no duplicates", () => {
  const q = quickAirports(["LHR", "SFO"]);
  assert.equal(q.length, 6);
  assert.deepEqual(q.slice(0, 2).map((x) => [x.airport.iata, x.recent]), [["LHR", true], ["SFO", true]]);
  assert.equal(new Set(q.map((x) => x.airport.iata)).size, 6);
  assert.equal(quickAirports([]).every((x) => !x.recent), true);
});

test("typeahead matches IATA, city and name", () => {
  assert.equal(searchAirports("lhr")[0].iata, "LHR");
  assert.equal(searchAirports("tokyo")[0].city, "Tokyo");
  assert.ok(searchAirports("heathrow").some((a) => a.iata === "LHR"));
});
