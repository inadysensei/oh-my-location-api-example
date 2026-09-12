# MCP (read-only)

Public URL is **`/mcp`**. Local example: `http://127.0.0.1:8080/mcp`.

This is Streamable HTTP via [`@modelcontextprotocol/server`](https://www.npmjs.com/package/@modelcontextprotocol/server) (`createMcpHandler`). Fastify serves it at `src/mcp.ts` (not `/api/mcp`). It is an **optional read path** — the iOS app does not use it. Writes stay on `POST` / `PATCH /v1/locations`.

## Connect

Same Bearer as ingest. `OML_BEARER_TOKEN`. `Authorization: Bearer <token>`. Missing or wrong → **401** (empty body). No OAuth.

Cursor / Streamable HTTP clients:

```json
{
  "mcpServers": {
    "oh-my-location": {
      "url": "http://127.0.0.1:8080/mcp",
      "headers": {
        "Authorization": "Bearer <OML_BEARER_TOKEN>"
      }
    }
  }
}
```

Replace `<OML_BEARER_TOKEN>` with the same value as in `.env`. If the API is on another host, use that host instead of `127.0.0.1`.

stdio-only clients can reach the same URL through [`mcp-remote`](https://www.npmjs.com/package/mcp-remote).

## Tools

Both tools are read-only. They never INSERT or UPDATE `oml_locations`. `raw_json` and `geocode_json` are not returned. `step_count` is included when present. There is no `motion` field.

### `get_locations`

| Argument | Type | Required | Description |
| --- | --- | --- | --- |
| `from` | string | yes | Start of range. **Timezone-aware ISO 8601** |
| `to` | string | yes | End of range. Same format |
| `limit` | number | no | Max rows. Default **100**. Cap **1000** |

The range is the `recorded_at` Instant **`[from, to]` (inclusive on both ends)**. `+09:00` and `Z` that name the same Instant match the same rows. This is not a lexical string compare and does not assume Asia/Tokyo.

Order is `recorded_at` ascending (same Instant → `received_at`, then `id`). Use this to read what happened in time order.

`from` / `to` examples:

| OK | Why |
| --- | --- |
| `2026-09-12T00:00:00+09:00` | Offset present |
| `2026-09-11T15:00:00Z` | UTC (same Instant as the row above) |
| `2026-09-11T15:00:00.500Z` | Fractional seconds + timezone |

| Rejected | Why |
| --- | --- |
| `2026-09-12T00:00:00` | Timezone-less local datetime |
| `2026-09-12` | Date only |
| `2026-09-12 00:00:00+09:00` | Not `T`-separated |

The tool result is JSON text:

```json
{
  "from": "2026-09-12T00:00:00+09:00",
  "to": "2026-09-12T23:59:59+09:00",
  "inclusive": true,
  "order": "recorded_at_asc",
  "limit": 100,
  "count": 1,
  "locations": [
    {
      "id": "550e8400-e29b-41d4-a716-446655440000",
      "recorded_at": "2026-09-12T00:00:00+09:00",
      "lat": 35.6812,
      "lon": 139.7671,
      "accuracy_m": 65,
      "altitude_m": null,
      "course_deg": null,
      "battery_level": null,
      "battery_state": null,
      "network_type": null,
      "step_count": 12345,
      "device_id": "iphone",
      "received_at": "2026-09-11T15:00:01.000Z",
      "place_name": "Home",
      "geocode_name": null,
      "geocode_locality": null,
      "geocode_thoroughfare": null,
      "geocode_sub_thoroughfare": null,
      "geocode_administrative_area": null,
      "geocode_iso_country_code": null
    }
  ]
}
```

### `get_latest_location`

No arguments. Newest row by `recorded_at` Instant. Same Instant → `received_at`, then `id`. Empty store → `{"location":null}`.

```json
{ "location": { "id": "...", "recorded_at": "...", "lat": 35.68, "lon": 139.76 } }
```
