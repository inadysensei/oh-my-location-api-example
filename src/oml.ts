export const OML_SCHEMA = "oml/1";

export type ParsedGeocode = {
  name: string | null;
  locality: string | null;
  thoroughfare: string | null;
  subThoroughfare: string | null;
  administrativeArea: string | null;
  isoCountryCode: string | null;
  raw: Record<string, unknown>;
};

export type ParsedLocation = {
  id: string;
  recordedAt: string;
  recordedAtTs: Date | null;
  lat: number;
  lon: number;
  accuracy: number | null;
  altitude: number | null;
  course: number | null;
  batteryLevel: number | null;
  batteryState: string | null;
  networkType: string | null;
  stepCount: number | null;
  deviceId: string | null;
  placeName: string | null;
  geocode: ParsedGeocode | null;
  raw: unknown;
};

export type ParsedPayload = {
  schema: typeof OML_SCHEMA;
  deviceId: string | null;
  locations: ParsedLocation[];
};

export type PatchField<T> =
  | { present: false }
  | { present: true; value: T };

export type ParsedLocationPatch = {
  placeName: PatchField<string | null>;
  geocode: PatchField<ParsedGeocode | null>;
};

function absent<T>(): PatchField<T> {
  return { present: false };
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return null;
}

function asFiniteNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  return null;
}

function asInteger(value: unknown): number | null {
  if (typeof value === "number" && Number.isInteger(value)) return value;
  return null;
}

function asString(value: unknown): string | null {
  if (typeof value === "string") return value;
  return null;
}

function asNonEmptyString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  if (value.length === 0) return null;
  return value;
}

function optionalText(value: unknown): string | null {
  return asNonEmptyString(value);
}

export function parseInstant(value: string): Date | null {
  const ms = Date.parse(value);
  if (!Number.isFinite(ms)) return null;
  return new Date(ms);
}

export function parseGeocode(value: unknown): ParsedGeocode | null {
  const rec = asRecord(value);
  if (!rec) return null;
  return {
    name: optionalText(rec.name),
    locality: optionalText(rec.locality),
    thoroughfare: optionalText(rec.thoroughfare),
    subThoroughfare: optionalText(rec.sub_thoroughfare),
    administrativeArea: optionalText(rec.administrative_area),
    isoCountryCode: optionalText(rec.iso_country_code),
    raw: rec,
  };
}

export function geocodeJson(geocode: ParsedGeocode | null): Record<string, unknown> | null {
  if (!geocode) return null;
  return geocode.raw;
}

export function parseLocationItem(
  item: unknown,
  deviceId: string | null,
): ParsedLocation | null {
  const rec = asRecord(item);
  if (!rec) return null;

  const id = asNonEmptyString(rec.id);
  const recordedAt = asNonEmptyString(rec.recorded_at);
  const lat = asFiniteNumber(rec.lat);
  const lon = asFiniteNumber(rec.lon);
  if (!id || !recordedAt || lat === null || lon === null) return null;
  if (lat < -90 || lat > 90 || lon < -180 || lon > 180) return null;

  const battery = asRecord(rec.battery);

  return {
    id,
    recordedAt,
    recordedAtTs: parseInstant(recordedAt),
    lat,
    lon,
    accuracy: asFiniteNumber(rec.accuracy_m),
    altitude: asFiniteNumber(rec.altitude_m),
    course: asFiniteNumber(rec.course_deg),
    batteryLevel: battery ? asFiniteNumber(battery.level) : null,
    batteryState: battery ? asString(battery.state) : null,
    networkType: asString(rec.network_type),
    stepCount: asInteger(rec.step_count),
    deviceId,
    placeName: optionalText(rec.place_name),
    geocode: parseGeocode(rec.geocode),
    raw: item,
  };
}

export function parseOmlBody(
  body: unknown,
): { ok: true; value: ParsedPayload } | { ok: false; error: string } {
  const rec = asRecord(body);
  if (!rec) return { ok: false, error: "invalid_json" };
  if (rec.schema !== OML_SCHEMA) {
    return { ok: false, error: "unsupported_schema" };
  }
  if (!Array.isArray(rec.locations)) {
    return { ok: false, error: "locations_required" };
  }
  if (rec.locations.length === 0) {
    return { ok: false, error: "empty_locations" };
  }

  const deviceId = asNonEmptyString(rec.device_id);
  const byId = new Map<string, ParsedLocation>();
  for (const item of rec.locations) {
    const parsed = parseLocationItem(item, deviceId);
    if (parsed) byId.set(parsed.id, parsed);
  }

  const locations = [...byId.values()];
  if (locations.length === 0) {
    return { ok: false, error: "invalid_locations" };
  }

  return {
    ok: true,
    value: {
      schema: OML_SCHEMA,
      deviceId,
      locations,
    },
  };
}

function readPatchString(
  rec: Record<string, unknown>,
  key: string,
): { ok: true; field: PatchField<string | null> } | { ok: false; error: string } {
  if (!(key in rec)) return { ok: true, field: absent() };
  const value = rec[key];
  if (value === null) return { ok: true, field: { present: true, value: null } };
  if (typeof value === "string") {
    return {
      ok: true,
      field: { present: true, value: value.length === 0 ? null : value },
    };
  }
  return { ok: false, error: "invalid_patch" };
}

export function hasPatchUpdates(patch: ParsedLocationPatch): boolean {
  return patch.placeName.present || patch.geocode.present;
}

export function parseLocationPatch(
  body: unknown,
): { ok: true; value: ParsedLocationPatch } | { ok: false; error: string } {
  const rec = asRecord(body);
  if (!rec) return { ok: false, error: "invalid_json" };
  if ("schema" in rec && rec.schema !== OML_SCHEMA) {
    return { ok: false, error: "unsupported_schema" };
  }

  const placeName = readPatchString(rec, "place_name");
  if (!placeName.ok) return placeName;

  let geocode: PatchField<ParsedGeocode | null> = absent();
  if ("geocode" in rec) {
    if (rec.geocode === null) {
      geocode = { present: true, value: null };
    } else {
      const parsed = parseGeocode(rec.geocode);
      if (!parsed) return { ok: false, error: "invalid_patch" };
      geocode = { present: true, value: parsed };
    }
  }

  const value: ParsedLocationPatch = {
    placeName: placeName.field,
    geocode,
  };
  if (!hasPatchUpdates(value)) {
    return { ok: false, error: "no_updates" };
  }
  return { ok: true, value };
}

export function normalizeLocationId(id: string | undefined | null): string | null {
  if (typeof id !== "string") return null;
  const trimmed = id.trim();
  if (trimmed.length === 0) return null;
  try {
    return decodeURIComponent(trimmed);
  } catch {
    return trimmed;
  }
}
