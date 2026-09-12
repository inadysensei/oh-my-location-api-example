import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { authorizeBearer } from "../src/auth.ts";
import { parseLocationItem, parseLocationPatch, parseOmlBody } from "../src/oml.ts";

const sampleLocation = {
  id: "550e8400-e29b-41d4-a716-446655440000",
  recorded_at: "2026-09-11T22:00:00+09:00",
  lat: 35.6812,
  lon: 139.7671,
  accuracy_m: 65,
  altitude_m: 10.5,
  course_deg: null,
  battery: { level: 0.72, state: "unplugged" },
  network_type: "wifi",
  step_count: 18432,
  place_name: "Home",
  geocode: {
    name: "Tokyo Station",
    locality: "Chiyoda",
    thoroughfare: "Marunouchi",
    sub_thoroughfare: "1-1",
    administrative_area: "Tokyo",
    iso_country_code: "JP",
  },
};

describe("parseOmlBody", () => {
  it("parses a valid oml/1 payload", () => {
    const parsed = parseOmlBody({
      schema: "oml/1",
      device_id: "iphone",
      locations: [sampleLocation],
    });
    assert.equal(parsed.ok, true);
    if (!parsed.ok) return;
    assert.equal(parsed.value.locations.length, 1);
    assert.equal(parsed.value.deviceId, "iphone");
    assert.equal(parsed.value.locations[0]?.placeName, "Home");
    assert.equal(parsed.value.locations[0]?.stepCount, 18432);
    assert.equal(parsed.value.locations[0]?.geocode?.isoCountryCode, "JP");
  });

  it("rejects an unsupported schema", () => {
    const parsed = parseOmlBody({
      schema: "oml/2",
      locations: [sampleLocation],
    });
    assert.deepEqual(parsed, { ok: false, error: "unsupported_schema" });
  });

  it("rejects an empty locations array", () => {
    const parsed = parseOmlBody({ schema: "oml/1", locations: [] });
    assert.deepEqual(parsed, { ok: false, error: "empty_locations" });
  });

  it("rejects a payload with only invalid points", () => {
    const parsed = parseOmlBody({
      schema: "oml/1",
      locations: [{ id: "x", recorded_at: "now", lat: 999, lon: 0 }],
    });
    assert.deepEqual(parsed, { ok: false, error: "invalid_locations" });
  });

  it("dedupes points with the same id", () => {
    const parsed = parseOmlBody({
      schema: "oml/1",
      locations: [
        { ...sampleLocation, lat: 1 },
        { ...sampleLocation, lat: 2 },
      ],
    });
    assert.equal(parsed.ok, true);
    if (!parsed.ok) return;
    assert.equal(parsed.value.locations.length, 1);
    assert.equal(parsed.value.locations[0]?.lat, 2);
  });
});

describe("parseLocationPatch", () => {
  it("parses place_name and geocode", () => {
    const parsed = parseLocationPatch({
      place_name: "Home",
      geocode: { name: "Tokyo Station" },
    });
    assert.equal(parsed.ok, true);
    if (!parsed.ok) return;
    assert.deepEqual(parsed.value.placeName, { present: true, value: "Home" });
    assert.equal(parsed.value.geocode.present, true);
  });

  it("treats JSON null as a clear", () => {
    const parsed = parseLocationPatch({ place_name: null, geocode: null });
    assert.equal(parsed.ok, true);
    if (!parsed.ok) return;
    assert.deepEqual(parsed.value.placeName, { present: true, value: null });
    assert.deepEqual(parsed.value.geocode, { present: true, value: null });
  });

  it("rejects a body with no updatable fields", () => {
    const parsed = parseLocationPatch({ lat: 1, lon: 2 });
    assert.deepEqual(parsed, { ok: false, error: "no_updates" });
  });

  it("rejects a non-oml/1 schema when present", () => {
    const parsed = parseLocationPatch({ schema: "oml/2", place_name: "Home" });
    assert.deepEqual(parsed, { ok: false, error: "unsupported_schema" });
  });
});

describe("authorizeBearer", () => {
  const env = { OML_BEARER_TOKEN: "secret-token" };

  it("accepts a matching Bearer token", () => {
    assert.equal(authorizeBearer("Bearer secret-token", env), true);
  });

  it("rejects a missing or wrong token", () => {
    assert.equal(authorizeBearer(undefined, env), false);
    assert.equal(authorizeBearer("Bearer other", env), false);
    assert.equal(authorizeBearer("Basic secret-token", env), false);
  });
});
