import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  ISO_FORMAT_ERROR,
  ISO_TIMEZONE_REQUIRED_ERROR,
  clampLocationLimit,
  parseIso8601Instant,
} from "../src/iso-time.ts";

describe("parseIso8601Instant", () => {
  it("accepts Z and offset forms as the same Instant", () => {
    const tokyo = parseIso8601Instant("2026-09-12T00:00:00+09:00");
    const utc = parseIso8601Instant("2026-09-11T15:00:00Z");
    assert.equal(tokyo.ok, true);
    assert.equal(utc.ok, true);
    if (tokyo.ok && utc.ok) {
      assert.equal(tokyo.ms, utc.ms);
      assert.equal(tokyo.ms, Date.parse("2026-09-11T15:00:00.000Z"));
    }
  });

  it("does not assume Asia/Tokyo for a Z timestamp", () => {
    const parsed = parseIso8601Instant("2026-09-11T15:00:00Z");
    assert.equal(parsed.ok, true);
    if (parsed.ok) assert.equal(parsed.ms, Date.UTC(2026, 8, 11, 15, 0, 0));
  });

  it("rejects timezone-less local datetimes", () => {
    const parsed = parseIso8601Instant("2026-09-12T00:00:00");
    assert.deepEqual(parsed, { ok: false, error: ISO_TIMEZONE_REQUIRED_ERROR });
    assert.equal(parseIso8601Instant("2026-09-12T00:00:00.000").ok, false);
  });

  it("rejects date-only, empty, and malformed values", () => {
    assert.equal(parseIso8601Instant("2026-09-12").ok, false);
    assert.deepEqual(parseIso8601Instant(""), { ok: false, error: ISO_FORMAT_ERROR });
    assert.equal(parseIso8601Instant("  ").ok, false);
    assert.equal(parseIso8601Instant(1).ok, false);
    assert.equal(parseIso8601Instant("2026-09-12 00:00:00+09:00").ok, false);
    assert.equal(parseIso8601Instant("2026-09-12T00:00:00+0900").ok, false);
  });

  it("accepts fractional seconds with timezone", () => {
    const parsed = parseIso8601Instant("2026-09-11T15:00:00.500Z");
    assert.equal(parsed.ok, true);
    if (parsed.ok) assert.equal(parsed.ms, Date.UTC(2026, 8, 11, 15, 0, 0, 500));
  });
});

describe("clampLocationLimit", () => {
  it("defaults to 100 and caps at 1000", () => {
    assert.deepEqual(clampLocationLimit(undefined), { ok: true, value: 100 });
    assert.deepEqual(clampLocationLimit(1), { ok: true, value: 1 });
    assert.deepEqual(clampLocationLimit(1000), { ok: true, value: 1000 });
    assert.deepEqual(clampLocationLimit(1001), { ok: true, value: 1000 });
    assert.equal(clampLocationLimit(0).ok, false);
    assert.equal(clampLocationLimit(1.5).ok, false);
  });
});
