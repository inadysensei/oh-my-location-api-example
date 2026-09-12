/** Default max rows for `get_locations`. */
export const DEFAULT_LOCATION_LIMIT = 100;

/** Hard cap for `get_locations`. */
export const MAX_LOCATION_LIMIT = 1000;

/**
 * ISO 8601 datetime with a timezone: `Z` or `±HH:MM`.
 * Timezone-less local datetimes (e.g. `2026-09-12T00:00:00`) are rejected.
 */
const TZ_AWARE_ISO =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(\.\d+)?(Z|[+-]\d{2}:\d{2})$/;

const LOCAL_DATETIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?$/;

export type InstantParseOk = { ok: true; ms: number; input: string };
export type InstantParseErr = { ok: false; error: string };
export type InstantParse = InstantParseOk | InstantParseErr;

export const ISO_TIMEZONE_REQUIRED_ERROR =
  "timezone is required; use Z or an offset like +09:00 (do not send a timezone-less local datetime)";

export const ISO_FORMAT_ERROR =
  "expected ISO 8601 with timezone, e.g. 2026-09-12T00:00:00+09:00 or 2026-09-11T15:00:00Z";

/**
 * Parse a timezone-aware ISO 8601 datetime to an absolute Instant (UTC ms).
 * Does not assume Asia/Tokyo. Offset and `Z` are converted to the same timeline.
 */
export function parseIso8601Instant(input: unknown): InstantParse {
  if (typeof input !== "string") {
    return { ok: false, error: ISO_FORMAT_ERROR };
  }
  const raw = input.trim();
  if (raw.length === 0) {
    return { ok: false, error: ISO_FORMAT_ERROR };
  }
  if (LOCAL_DATETIME.test(raw)) {
    return { ok: false, error: ISO_TIMEZONE_REQUIRED_ERROR };
  }
  if (!TZ_AWARE_ISO.test(raw)) {
    return { ok: false, error: ISO_FORMAT_ERROR };
  }
  const ms = Date.parse(raw);
  if (!Number.isFinite(ms)) {
    return { ok: false, error: "invalid date/time" };
  }
  return { ok: true, ms, input: raw };
}

export function clampLocationLimit(
  limit: number | undefined,
): { ok: true; value: number } | { ok: false; error: string } {
  if (limit === undefined) {
    return { ok: true, value: DEFAULT_LOCATION_LIMIT };
  }
  if (typeof limit !== "number" || !Number.isInteger(limit)) {
    return {
      ok: false,
      error: `limit must be an integer from 1 to ${MAX_LOCATION_LIMIT}`,
    };
  }
  if (limit < 1) {
    return {
      ok: false,
      error: `limit must be an integer from 1 to ${MAX_LOCATION_LIMIT}`,
    };
  }
  return { ok: true, value: Math.min(limit, MAX_LOCATION_LIMIT) };
}
