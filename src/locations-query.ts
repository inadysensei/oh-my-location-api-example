import type { Pool } from "pg";
import {
  selectLatestLocation,
  selectLocationsInRange,
  type LocationRead,
} from "./db.js";
import { clampLocationLimit, parseIso8601Instant } from "./iso-time.js";

export type GetLocationsResult = {
  from: string;
  to: string;
  inclusive: true;
  order: "recorded_at_asc";
  limit: number;
  count: number;
  locations: LocationRead[];
};

export type QueryResult<T> = { ok: true; value: T } | { ok: false; error: string };

export async function queryLocationsInRange(
  pool: Pool,
  fromRaw: string,
  toRaw: string,
  limitRaw: number | undefined,
): Promise<QueryResult<GetLocationsResult>> {
  const from = parseIso8601Instant(fromRaw);
  if (!from.ok) return { ok: false, error: `from: ${from.error}` };

  const to = parseIso8601Instant(toRaw);
  if (!to.ok) return { ok: false, error: `to: ${to.error}` };

  if (from.ms > to.ms) {
    return { ok: false, error: "from must be less than or equal to to (absolute time)" };
  }

  const limit = clampLocationLimit(limitRaw);
  if (!limit.ok) return { ok: false, error: limit.error };

  const locations = await selectLocationsInRange(pool, from.ms, to.ms, limit.value);
  return {
    ok: true,
    value: {
      from: from.input,
      to: to.input,
      inclusive: true,
      order: "recorded_at_asc",
      limit: limit.value,
      count: locations.length,
      locations,
    },
  };
}

export async function queryLatestLocation(
  pool: Pool,
): Promise<{ location: LocationRead | null }> {
  return { location: await selectLatestLocation(pool) };
}
