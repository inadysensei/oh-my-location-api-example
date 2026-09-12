import type { Pool } from "pg";
import {
  geocodeJson,
  type ParsedLocation,
  type ParsedLocationPatch,
  type ParsedPayload,
} from "./oml.js";

const INSERT_SQL = `INSERT INTO oml_locations (
  id, recorded_at, recorded_at_ts, lat, lon, accuracy_m, altitude_m, course_deg,
  battery_level, battery_state, network_type, step_count, device_id,
  received_at, raw_json, place_name,
  geocode_name, geocode_locality, geocode_thoroughfare,
  geocode_sub_thoroughfare, geocode_administrative_area,
  geocode_iso_country_code, geocode_json
) VALUES (
  $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15::jsonb, $16,
  $17, $18, $19, $20, $21, $22, $23::jsonb
)
ON CONFLICT (id) DO NOTHING`;

const LOCATION_READ_SQL = `id, recorded_at, lat, lon, accuracy_m, altitude_m, course_deg,
  battery_level, battery_state, network_type, step_count, device_id, received_at,
  place_name,
  geocode_name, geocode_locality, geocode_thoroughfare,
  geocode_sub_thoroughfare, geocode_administrative_area,
  geocode_iso_country_code`;

export type LocationRead = {
  id: string;
  recorded_at: string;
  lat: number;
  lon: number;
  accuracy_m: number | null;
  altitude_m: number | null;
  course_deg: number | null;
  battery_level: number | null;
  battery_state: string | null;
  network_type: string | null;
  step_count: number | null;
  device_id: string | null;
  received_at: string;
  place_name: string | null;
  geocode_name: string | null;
  geocode_locality: string | null;
  geocode_thoroughfare: string | null;
  geocode_sub_thoroughfare: string | null;
  geocode_administrative_area: string | null;
  geocode_iso_country_code: string | null;
};

export type UpdateLocationResult = "updated" | "not_found";

type PlaceGeocodeRow = {
  place_name: string | null;
  geocode_name: string | null;
  geocode_locality: string | null;
  geocode_thoroughfare: string | null;
  geocode_sub_thoroughfare: string | null;
  geocode_administrative_area: string | null;
  geocode_iso_country_code: string | null;
  geocode_json: unknown;
  raw_json: unknown;
};

function asNullableText(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  return String(value);
}

function asFiniteNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.length > 0) {
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function asInteger(value: unknown): number | null {
  const n = asFiniteNumber(value);
  if (n === null || !Number.isInteger(n)) return null;
  return n;
}

function asRequiredText(value: unknown, fallback = ""): string {
  if (value === null || value === undefined) return fallback;
  if (value instanceof Date) return value.toISOString();
  return String(value);
}

function asRequiredNumber(value: unknown, fallback = 0): number {
  return asFiniteNumber(value) ?? fallback;
}

function asIso(value: unknown): string {
  if (value instanceof Date) return value.toISOString();
  return asRequiredText(value);
}

export function mapLocationRow(row: Record<string, unknown>): LocationRead {
  return {
    id: asRequiredText(row.id),
    recorded_at: asRequiredText(row.recorded_at),
    lat: asRequiredNumber(row.lat),
    lon: asRequiredNumber(row.lon),
    accuracy_m: asFiniteNumber(row.accuracy_m),
    altitude_m: asFiniteNumber(row.altitude_m),
    course_deg: asFiniteNumber(row.course_deg),
    battery_level: asFiniteNumber(row.battery_level),
    battery_state: asNullableText(row.battery_state),
    network_type: asNullableText(row.network_type),
    step_count: asInteger(row.step_count),
    device_id: asNullableText(row.device_id),
    received_at: asIso(row.received_at),
    place_name: asNullableText(row.place_name),
    geocode_name: asNullableText(row.geocode_name),
    geocode_locality: asNullableText(row.geocode_locality),
    geocode_thoroughfare: asNullableText(row.geocode_thoroughfare),
    geocode_sub_thoroughfare: asNullableText(row.geocode_sub_thoroughfare),
    geocode_administrative_area: asNullableText(row.geocode_administrative_area),
    geocode_iso_country_code: asNullableText(row.geocode_iso_country_code),
  };
}

function locationArgs(loc: ParsedLocation, receivedAt: Date): unknown[] {
  const geocode = loc.geocode;
  return [
    loc.id,
    loc.recordedAt,
    loc.recordedAtTs,
    loc.lat,
    loc.lon,
    loc.accuracy,
    loc.altitude,
    loc.course,
    loc.batteryLevel,
    loc.batteryState,
    loc.networkType,
    loc.stepCount,
    loc.deviceId,
    receivedAt,
    JSON.stringify(loc.raw),
    loc.placeName,
    geocode?.name ?? null,
    geocode?.locality ?? null,
    geocode?.thoroughfare ?? null,
    geocode?.subThoroughfare ?? null,
    geocode?.administrativeArea ?? null,
    geocode?.isoCountryCode ?? null,
    geocode ? JSON.stringify(geocodeJson(geocode)) : null,
  ];
}

export async function insertOmlBatch(
  pool: Pool,
  payload: ParsedPayload,
  receivedAt = new Date(),
): Promise<number> {
  if (payload.locations.length === 0) return 0;

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    for (const loc of payload.locations) {
      await client.query(INSERT_SQL, locationArgs(loc, receivedAt));
    }
    await client.query("COMMIT");
  } catch (err) {
    try {
      await client.query("ROLLBACK");
    } catch {
      /* ignore */
    }
    throw err;
  } finally {
    client.release();
  }
  return payload.locations.length;
}

function asRecord(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return { ...(value as Record<string, unknown>) };
  }
  if (typeof value === "string") {
    try {
      const parsed: unknown = JSON.parse(value);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        return { ...(parsed as Record<string, unknown>) };
      }
    } catch {
      /* ignore */
    }
  }
  return {};
}

function mergeRawJson(rawJson: unknown, patch: ParsedLocationPatch): Record<string, unknown> {
  const rec = asRecord(rawJson);
  if (patch.placeName.present) rec.place_name = patch.placeName.value;
  if (patch.geocode.present) {
    rec.geocode = patch.geocode.value ? patch.geocode.value.raw : null;
  }
  return rec;
}

function applyPlaceGeocodePatch(
  row: PlaceGeocodeRow,
  patch: ParsedLocationPatch,
): PlaceGeocodeRow {
  const next: PlaceGeocodeRow = { ...row };
  if (patch.placeName.present) next.place_name = patch.placeName.value;
  if (patch.geocode.present) {
    const geocode = patch.geocode.value;
    next.geocode_name = geocode?.name ?? null;
    next.geocode_locality = geocode?.locality ?? null;
    next.geocode_thoroughfare = geocode?.thoroughfare ?? null;
    next.geocode_sub_thoroughfare = geocode?.subThoroughfare ?? null;
    next.geocode_administrative_area = geocode?.administrativeArea ?? null;
    next.geocode_iso_country_code = geocode?.isoCountryCode ?? null;
    next.geocode_json = geocodeJson(geocode);
  }
  next.raw_json = mergeRawJson(row.raw_json, patch);
  return next;
}

function readPlaceGeocodeRow(row: Record<string, unknown>): PlaceGeocodeRow {
  return {
    place_name: asNullableText(row.place_name),
    geocode_name: asNullableText(row.geocode_name),
    geocode_locality: asNullableText(row.geocode_locality),
    geocode_thoroughfare: asNullableText(row.geocode_thoroughfare),
    geocode_sub_thoroughfare: asNullableText(row.geocode_sub_thoroughfare),
    geocode_administrative_area: asNullableText(row.geocode_administrative_area),
    geocode_iso_country_code: asNullableText(row.geocode_iso_country_code),
    geocode_json: row.geocode_json ?? null,
    raw_json: row.raw_json ?? {},
  };
}

export async function updateOmlLocationPlaceGeocode(
  pool: Pool,
  id: string,
  patch: ParsedLocationPatch,
): Promise<UpdateLocationResult> {
  const existing = await pool.query(
    `SELECT place_name,
            geocode_name, geocode_locality, geocode_thoroughfare,
            geocode_sub_thoroughfare, geocode_administrative_area,
            geocode_iso_country_code, geocode_json, raw_json
     FROM oml_locations
     WHERE id = $1`,
    [id],
  );
  if (existing.rowCount === 0) return "not_found";

  const next = applyPlaceGeocodePatch(
    readPlaceGeocodeRow(existing.rows[0] as Record<string, unknown>),
    patch,
  );

  await pool.query(
    `UPDATE oml_locations SET
       place_name = $1,
       geocode_name = $2,
       geocode_locality = $3,
       geocode_thoroughfare = $4,
       geocode_sub_thoroughfare = $5,
       geocode_administrative_area = $6,
       geocode_iso_country_code = $7,
       geocode_json = $8::jsonb,
       raw_json = $9::jsonb
     WHERE id = $10`,
    [
      next.place_name,
      next.geocode_name,
      next.geocode_locality,
      next.geocode_thoroughfare,
      next.geocode_sub_thoroughfare,
      next.geocode_administrative_area,
      next.geocode_iso_country_code,
      next.geocode_json ? JSON.stringify(next.geocode_json) : null,
      JSON.stringify(next.raw_json),
      id,
    ],
  );
  return "updated";
}

export async function selectLocationById(
  pool: Pool,
  id: string,
): Promise<LocationRead | null> {
  const result = await pool.query(
    `SELECT ${LOCATION_READ_SQL} FROM oml_locations WHERE id = $1`,
    [id],
  );
  if (result.rowCount === 0) return null;
  return mapLocationRow(result.rows[0] as Record<string, unknown>);
}

export const DEFAULT_LOCATION_LIMIT = 100;
export const MAX_LOCATION_LIMIT = 1000;

export async function selectLatestLocations(
  pool: Pool,
  limit = DEFAULT_LOCATION_LIMIT,
): Promise<LocationRead[]> {
  const capped = Math.min(Math.max(limit, 1), MAX_LOCATION_LIMIT);
  const result = await pool.query(
    `SELECT ${LOCATION_READ_SQL}
     FROM oml_locations
     ORDER BY COALESCE(recorded_at_ts, received_at) DESC, received_at DESC, id DESC
     LIMIT $1`,
    [capped],
  );
  return result.rows.map((row) => mapLocationRow(row as Record<string, unknown>));
}

export async function pingDb(pool: Pool): Promise<boolean> {
  try {
    await pool.query("SELECT 1");
    return true;
  } catch {
    return false;
  }
}
