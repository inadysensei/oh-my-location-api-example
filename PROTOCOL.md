# Oh My Location Protocol (`oml/1`)

HTTP contract for sending location logs from the **Oh My Location** iOS app to a self-hosted ingest server (this repository is one such server).

This document is the full wire spec. You do not need the iOS app source to implement or operate an ingest API.

This example implements **`POST /v1/locations`** and **`PATCH /v1/locations/{id}`**. Extra routes such as `GET /health` are operational helpers; they are not part of `oml/1`.

This example also exposes an optional read-only Streamable HTTP endpoint at **`/mcp`** (`get_locations`, `get_latest_location`). Agents can query stored points there; the iOS ingest contract does not use it. See [`docs/mcp.md`](docs/mcp.md).

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
| `network_type` | no | string | `wifi` \| `cellular` \| `none` \| `unknown`. |
| `step_count` | no | number | Cumulative step **snapshot** at this point (integer). Omit the key if unavailable. |
| `place_name` | no | string | Display name of a user-defined Named Place. Omit if none. |
| `geocode` | no | object | Reverse-geocode snapshot filled by the client. Omit if none. |

---

## Update (`PATCH /v1/locations/{id}`)

After a point has been inserted, attach or correct `place_name` / `geocode`.

`{id}` is the client `id` from insert (path; percent-encode as needed).

If insert is `http://<host>:8080/v1/locations`, update is `http://<host>:8080/v1/locations/{id}`.

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

### Update responses

| HTTP | Body | Meaning |
| --- | --- | --- |
| `200` | `{"ok":true}` | Updated. There is no `updated` count. The client treats this as one success |
| `401` | empty | Bearer missing or wrong |
| `400` | `{"ok":false,"error":"<code>"}` | See codes below |
| `404` | `{"ok":false,"error":"not_found"}` | No row with that `id` |
| `405` | empty | Method is not `PATCH` |
| `5xx` | `{"ok":false,"error":"..."}` allowed | Client should keep a pending update and retry |
