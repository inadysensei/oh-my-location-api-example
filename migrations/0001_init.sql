-- oml/1 location points. This is the only write table.
-- There is no place_id (client-only) and no motion column.

CREATE TABLE IF NOT EXISTS oml_locations (
  id TEXT PRIMARY KEY NOT NULL,
  recorded_at TEXT NOT NULL,
  recorded_at_ts TIMESTAMPTZ,
  lat DOUBLE PRECISION NOT NULL,
  lon DOUBLE PRECISION NOT NULL,
  accuracy_m DOUBLE PRECISION,
  altitude_m DOUBLE PRECISION,
  course_deg DOUBLE PRECISION,
  battery_level DOUBLE PRECISION,
  battery_state TEXT,
  network_type TEXT,
  step_count INTEGER,
  device_id TEXT,
  received_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  raw_json JSONB NOT NULL,
  place_name TEXT,
  geocode_name TEXT,
  geocode_locality TEXT,
  geocode_thoroughfare TEXT,
  geocode_sub_thoroughfare TEXT,
  geocode_administrative_area TEXT,
  geocode_iso_country_code TEXT,
  geocode_json JSONB
);

CREATE INDEX IF NOT EXISTS oml_locations_recorded_at_ts_idx
  ON oml_locations (recorded_at_ts);
CREATE INDEX IF NOT EXISTS oml_locations_received_at_idx
  ON oml_locations (received_at);
CREATE INDEX IF NOT EXISTS oml_locations_device_id_idx
  ON oml_locations (device_id);
