# oh-my-location-api-example

Sample **self-hosted ingest API** for the Oh My Location iOS app (`oml/1`).

The iOS app already works **offline on the device**. This repository is optional: run it if you want a private log server that accepts the app's self-hosted POST URL.

This repo is **self-contained**. The full HTTP contract lives in [`PROTOCOL.md`](PROTOCOL.md) (English). You do not need the iOS app source to run this stack or to understand the wire format.

It is a Docker-first example: **PostgreSQL** plus a small Node.js (Fastify) API.

Field names are snake_case. This is not Overland / BetterTracks.

## Quick start

```bash
cp .env.example .env
# Edit .env and set OML_BEARER_TOKEN to a long random string.
docker compose up --build
```

The API listens on `http://127.0.0.1:8080` (override the host port with `OML_PORT`).

Health check (no auth):

```bash
curl -sS http://127.0.0.1:8080/health
# {"ok":true}
```

Stop with `Ctrl+C`, or `docker compose down`. Data lives in the `oml_pgdata` volume (`docker compose down -v` deletes it).

## Point the iOS app at this server

In Oh My Location, set the **Self Hosted Server POST URL** to the **full ingest URL** (not a base URL):

```text
http://<host>:8080/v1/locations
```

| Where the app runs | `<host>` |
| --- | --- |
| iOS Simulator on the same Mac | `127.0.0.1` or `localhost` |
| Physical iPhone on your LAN | Your computer's LAN IP, e.g. `192.168.1.20` |

Set the app **Access token** to the same value as `OML_BEARER_TOKEN` in `.env`. The app sends `Authorization: Bearer <token>`.

The phone must be able to reach that host and port. HTTP on a private LAN is enough for this example. If you expose it beyond your network, put TLS in front of it (any reverse proxy you already use).

If the POST URL is empty, the app does not send anywhere. Tracking still works locally.

## HTTP API (`oml/1`)

The ingest contract (auth, bodies, fields, error codes) is defined in [`PROTOCOL.md`](PROTOCOL.md). Summary:

| Method | Path | Auth | Purpose |
| --- | --- | --- | --- |
| `POST` | `/v1/locations` | Bearer | Insert points. Same `id` is ignored (`ON CONFLICT DO NOTHING`). |
| `PATCH` | `/v1/locations/{id}` | Bearer | Update `place_name` / `geocode` only. |
| `GET` | `/v1/locations` | Bearer | Optional: newest points (inspection; not part of `oml/1`). |
| `GET` | `/v1/locations/{id}` | Bearer | Optional: one point (inspection; not part of `oml/1`). |
| `GET` | `/health` | none | Docker / load-balancer health check. |

Missing or wrong Bearer → **401** with an empty body.

On the wire: **no `place_id`**, **no `motion`**. Optional `place_name`, `geocode`, and `step_count` are allowed (see the protocol).

### `POST /v1/locations`

```bash
curl -sS -D - \
  -X POST "http://127.0.0.1:8080/v1/locations" \
  -H "Authorization: Bearer $OML_BEARER_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
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
        "battery": { "level": 0.72, "state": "unplugged" },
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
  }'
```

Success:

```json
{"ok":true,"accepted":1}
```

`accepted` is the number of valid unique points in the request. Resending the same `id` does not insert a second row; the response is still **200** so the app can drop the local queue.

Typical **400** bodies: `{"ok":false,"error":"unsupported_schema"}`, `invalid_json`, `locations_required`, `empty_locations`, `invalid_locations`.

### `PATCH /v1/locations/{id}`

`{id}` is the client-generated id from insert. Only `place_name` and `geocode` are applied. Omitted keys stay as they are; JSON `null` clears the field. `geocode` replaces the whole object (no partial merge). `lat` / `lon` / `recorded_at` in the body are ignored. There is no `place_id` and no `motion` on the wire. There is no `POST /v1/locations/update`.

```bash
curl -sS -D - \
  -X PATCH "http://127.0.0.1:8080/v1/locations/550e8400-e29b-41d4-a716-446655440000" \
  -H "Authorization: Bearer $OML_BEARER_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "place_name": "Home",
    "geocode": {
      "name": "Tokyo Station",
      "locality": "Chiyoda",
      "thoroughfare": "Marunouchi",
      "sub_thoroughfare": "1-1",
      "administrative_area": "Tokyo",
      "iso_country_code": "JP"
    }
  }'
```

Success: `{"ok":true}`. Unknown id: **404** `{"ok":false,"error":"not_found"}`. Bad body: **400** (`invalid_json` / `invalid_id` / `invalid_patch` / `no_updates` / `unsupported_schema`).

## Configuration

Copy [`.env.example`](.env.example) to `.env`. Docker Compose reads it automatically.

| Variable | Purpose |
| --- | --- |
| `OML_BEARER_TOKEN` | Shared secret. Required. Same string as the iOS Access token. |
| `OML_PORT` | Host port published by the `api` service (default `8080`). |
| `POSTGRES_USER` / `POSTGRES_PASSWORD` / `POSTGRES_DB` | Database credentials (defaults: `oml` / `oml` / `oml`). |

The API process also accepts `DATABASE_URL` if you run the Node app without Compose.

## Schema

On startup the API applies SQL in [`migrations/`](migrations/) in filename order (tracked in `schema_migrations`).

[`migrations/0001_init.sql`](migrations/0001_init.sql) creates `oml_locations`:

- identity: client `id` (primary key), `device_id`
- when: original `recorded_at` text, optional `recorded_at_ts`, server `received_at`
- coordinates: `lat`, `lon`, optional `accuracy_m`, `altitude_m`, `course_deg`
- optional metadata: battery, `network_type`, `step_count`
- optional labels: `place_name` and `geocode_*` / `geocode_json`
- `raw_json` of the original point object

The server does not reverse-geocode. It does not store `place_id` or `motion`.

Inspect with:

```bash
docker compose exec db psql -U oml -d oml
```

## Local Node (without rebuilding the image)

Useful while hacking on this example. You still need Postgres (Compose `db` is fine).

```bash
docker compose up db -d
cp .env.example .env
export $(grep -v '^#' .env | xargs)
export DATABASE_URL=postgres://${POSTGRES_USER}:${POSTGRES_PASSWORD}@127.0.0.1:5432/${POSTGRES_DB}
npm install
npm test
npm run typecheck
npm run dev
```

The `db` service does not publish `5432` by default; add a `ports` mapping if you want a host-side `DATABASE_URL`.

## What this example is not

- Not a map UI, friend sharing, or geofence engine
- Not an MCP server
- Not a hardening / public-internet appliance — treat it as a homelab starting point
