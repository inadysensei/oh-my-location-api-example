# Oh My Location Protocol (`oml/1`)

HTTP contract for sending location logs from the **Oh My Location** iOS app to a self-hosted ingest server (this repository is one such server).

This document is the full wire spec. You do not need the iOS app source to implement or operate an ingest API.

Field names are all **snake_case**. This is **not** Overland / BetterTracks.

This example implements **`POST /v1/locations`** and **`PATCH /v1/locations/{id}`**. Extra routes such as `GET /health` are operational helpers; they are not part of `oml/1`.

## Auth

Every ingest write uses the same header:

```http
Authorization: Bearer <token>
```

The token is a shared secret (`OML_BEARER_TOKEN` in this example). It must match the Access token configured in the iOS app.

| HTTP | Body | Meaning |
| --- | --- | --- |
| `401` | empty | Missing header, wrong scheme, or token mismatch |

Do not retry `401` in a tight loop; it is a configuration error.

---

## Insert (`POST /v1/locations`)

The iOS **Self Hosted Server POST URL** is this **full URL** (not a base URL). Example: `http://192.168.1.20:8080/v1/locations`

| Item | Value |
| --- | --- |
| Method | `POST` |
| Path | `/v1/locations` |
| Content-Type | `application/json` |
| Auth | `Authorization: Bearer <token>` (required) |

### Responses

| HTTP | Body | Meaning |
| --- | --- | --- |
| `200` | `{"ok":true,"accepted":<number>}` | Accepted. `accepted` is the number of valid unique points in the request. Resending the same `id` does not insert a second row; the response is still `200` so the client can drop its local queue. |
| `401` | empty | Bearer missing or wrong |
| `400` | `{"ok":false,"error":"<code>"}` | Bad JSON, unsupported schema, or validation failure |
| `405` | empty | Method is not `POST` (on this path; this example also allows `GET` for inspection) |
| `5xx` | `{"ok":false,"error":"..."}` allowed | Server / database failure. The client may retry. |

Anything other than success should leave the client's local queue in place.

Typical `400` error codes from this server:

| `error` | When |
| --- | --- |
| `invalid_json` | Body is not a JSON object |
| `unsupported_schema` | `schema` is missing or not `"oml/1"` |
| `locations_required` | `locations` is not an array |
| `empty_locations` | `locations` is `[]` |
| `invalid_locations` | Every item failed validation (no usable points) |

Invalid items inside a mixed batch are skipped. If at least one item is valid, the request succeeds. Duplicate `id` values in the same body are collapsed (last one wins).

### Request body

```json
{
  "schema": "oml/1",
  "device_id": "iphone",
  "locations": [
    {
      "id": "550e8400-e29b-41d4-a716-446655440000",
      "recorded_at": "2026-09-11T22:00:00+09:00",
      "lat": 35.6812,
      "lon": 139.7671,
      "accuracy_m": 65,
      "altitude_m": 10.5,
      "course_deg": null,
      "battery": {
        "level": 0.72,
        "state": "unplugged"
      },
      "network_type": "wifi",
      "step_count": 18432,
      "place_name": "Home",
      "geocode": {
        "name": "Tokyo Station",
        "locality": "Chiyoda",
        "thoroughfare": "Marunouchi",
        "sub_thoroughfare": "1-1",
        "administrative_area": "Tokyo",
        "iso_country_code": "JP"
      }
    }
  ]
}
```

### Root

| Field | Required | Type | Description |
| --- | --- | --- | --- |
| `schema` | yes | string | Must be `"oml/1"`. Anything else → `400` `unsupported_schema` |
| `device_id` | no | string | Human label for the device (chosen in app settings). Not Apple's IDFV |
| `locations` | yes | array | Client usually sends one or more points. Empty array → `400` `empty_locations` |

### Each location

| Field | Required | Type | Description |
| --- | --- | --- | --- |
| `id` | yes | string | Client-generated unique id (UUID recommended). Used for retries. Server: `ON CONFLICT DO NOTHING` |
| `recorded_at` | yes | string | Fix time. ISO 8601 with a timezone is recommended (`Z` or `+09:00`) |
| `lat` | yes | number | Latitude in degrees, WGS84. Must be finite and in `[-90, 90]` |
| `lon` | yes | number | Longitude in degrees, WGS84. Must be finite and in `[-180, 180]` |
| `accuracy_m` | no | number \| null | Horizontal accuracy in meters. Omit or `null` if invalid |
| `altitude_m` | no | number \| null | Altitude in meters. Omit or `null` if invalid |
| `course_deg` | no | number \| null | Course in degrees (north is 0). Omit or `null` if invalid |
| `battery` | no | object | See below |
| `network_type` | no | string | `wifi` \| `cellular` \| `none` \| `unknown`. **Do not send SSID** |
| `step_count` | no | number | Cumulative step **snapshot** at this point (integer). Not a per-point delta. Omit the key if unavailable. Interval steps = `later - earlier` when both consecutive points have it. Do not send activity arrays (`walking` / `automotive` / …) |
| `place_name` | no | string | Display name of a user-defined Named Place (circle). Omit if none. **Do not send `place_id`** (client-only) |
| `geocode` | no | object | Reverse-geocode snapshot filled by the client. Omit if none. **Do not send a `reverse_geocode` string key** (servers ignore it) |

Unknown fields may be ignored. This example keeps the original point object in `raw_json`.

A point is dropped from the batch (not a hard 400 by itself) if `id` / `recorded_at` are missing or empty, or `lat` / `lon` are missing or out of range.

#### `battery`

| Field | Required | Type | Description |
| --- | --- | --- | --- |
| `level` | no | number \| null | `0.0`–`1.0` |
| `state` | no | string | `unknown` \| `unplugged` \| `charging` \| `full` |

#### `step_count`

Each point may carry the **cumulative** step count at that timestamp (integer), not a delta.

- Interval steps between two consecutive points that both have `step_count`: `later - earlier`
- If the client cannot read steps (unsupported, no permission, failure), **omit the key**. Do not pad failures with `0` or `null`. A real zero-step snapshot may send `0`
- Do not send `CMMotionActivity`-style activity classification
- **`motion` is not part of the wire.** Do not send a `motion` array. This server does not store it

#### `place_name`

Set when the point is inside a user-registered circle, or when the user attached that place to the point on the map. The server only stores the label. It does not evaluate circles and does not manage Named Place ids.

The only Named Place field on the wire is **`place_name`**.

- **`place_id` is client-only.** Do not encode it on `POST` or `PATCH`
- Do not send a nested `place` object

#### `geocode`

Client-filled reverse-geocode snapshot. **The server does not reverse-geocode.**

Empty fields may be omitted. Unknown keys may be kept in `geocode_json`.

| Field | Type | Description |
| --- | --- | --- |
| `name` | string | Placemark name. This alone is enough |
| `locality` | string | |
| `thoroughfare` | string | |
| `sub_thoroughfare` | string | |
| `administrative_area` | string | |
| `iso_country_code` | string | |

---

## Update (`PATCH /v1/locations/{id}`)

After a point has been inserted, attach or correct `place_name` / `geocode`. **Do not send (or change) coordinates or `recorded_at`.** Do not send `place_id`.

`{id}` is the client `id` from insert (path; percent-encode as needed).

If insert is `http://<host>:8080/v1/locations`, update is `http://<host>:8080/v1/locations/{id}`.

There is **no** `POST /v1/locations/update` (404/405). This is **not** a batch `locations[]`. **One point per PATCH.**

| Item | Value |
| --- | --- |
| Method | `PATCH` |
| Path | `/v1/locations/{id}` |
| Content-Type | `application/json` |
| Auth | `Authorization: Bearer <token>` (same as insert) |

```json
{
  "place_name": "Home",
  "geocode": {
    "name": "Tokyo Station",
    "locality": "Chiyoda",
    "thoroughfare": "Marunouchi",
    "sub_thoroughfare": "1-1",
    "administrative_area": "Tokyo",
    "iso_country_code": "JP"
  }
}
```

Rules:

- Omitted keys are left unchanged
- JSON `null` clears that field
- If `geocode` is sent, replace the **whole** object (no partial merge)
- Clients usually send both `place_name` and `geocode` every time (use `null` for the missing one)
- **Do not encode `place_id`**
- `"schema": "oml/1"` is optional. If present and not `oml/1` → `400` `unsupported_schema`. The iOS client typically omits `schema` on PATCH
- `lat` / `lon` / `recorded_at` in the body are ignored

Points that have not been inserted yet must not be PATCHed. Put `place_name` / `geocode` on the original `POST` instead.

### Update responses

| HTTP | Body | Meaning |
| --- | --- | --- |
| `200` | `{"ok":true}` | Updated. There is no `updated` count. The client treats this as one success |
| `401` | empty | Bearer missing or wrong |
| `400` | `{"ok":false,"error":"<code>"}` | See codes below |
| `404` | `{"ok":false,"error":"not_found"}` | No row with that `id` |
| `405` | empty | Method is not `PATCH` |
| `5xx` | `{"ok":false,"error":"..."}` allowed | Client should keep a pending update and retry |

Typical `400` error codes:

| `error` | When |
| --- | --- |
| `invalid_json` | Body is not a JSON object |
| `invalid_id` | Path id is empty / unusable |
| `invalid_patch` | `place_name` is not a string or null, or `geocode` is not an object or null |
| `no_updates` | Neither `place_name` nor `geocode` is present |
| `unsupported_schema` | `schema` is present and not `"oml/1"` |

---

## Client behavior (recommended)

These notes explain why the server behaves as it does. Operators do not need to implement a client.

- New points are inserted with `POST /v1/locations`. If a Named Place applies, include `place_name` on insert (`place_id` stays local)
- Reverse geocode is done on the device. Unsent points include `geocode` on insert; already-sent points use `PATCH`
- Each point may include `step_count` (cumulative snapshot). Interval steps are a difference between consecutive points. No activity / `motion` array
- Offline: queue locally, then POST a `locations` array. Pending label updates PATCH one id at a time
- `5xx` / network errors: keep the queue and retry
- `401`: treat as a settings mistake; do not retry forever
- Empty POST URL: do not send. Tracking still works on the device without a server

## Out of scope (`oml/1`)

Do not send or require:

- `trigger`
- `speed_mps`
- SSID / BSSID
- GeoJSON
- `motion` / activity arrays (`walking`, `automotive`, …)
- Nested `place` objects, wire `place_id`, `reverse_geocode` string keys, `POST /v1/locations/update`
- Map UI or friend sharing
- Geofence enter/exit events
- Server-side reverse geocoding
- Settings push from the server

## Versioning

Breaking changes bump `schema` to `oml/2` (or similar). A server may reject unknown schemas with `400` `unsupported_schema`.

`place_name`, `geocode`, `PATCH /v1/locations/{id}`, and optional `step_count` are part of `oml/1`. `place_id` is client-only and must not appear on the wire. `motion` is unused.
