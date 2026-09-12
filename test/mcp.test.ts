import assert from "node:assert/strict";
import { after, describe, it } from "node:test";
import type { Pool } from "pg";
import { buildApp } from "../src/app.ts";
import type { LocationRead } from "../src/db.ts";
import { createOmlMcpHttpHandler } from "../src/mcp.ts";
import { queryLatestLocation, queryLocationsInRange } from "../src/locations-query.ts";

const env = { OML_BEARER_TOKEN: "secret-token" };

type StoredRow = LocationRead & { recorded_at_ts: Date };

function locationRow(
  row: Partial<LocationRead> & { id: string; recorded_at: string; received_at: string },
): StoredRow {
  const recordedAtTs = new Date(Date.parse(row.recorded_at));
  return {
    id: row.id,
    recorded_at: row.recorded_at,
    lat: row.lat ?? 35.68,
    lon: row.lon ?? 139.76,
    accuracy_m: row.accuracy_m ?? null,
    altitude_m: row.altitude_m ?? null,
    course_deg: row.course_deg ?? null,
    battery_level: row.battery_level ?? null,
    battery_state: row.battery_state ?? null,
    network_type: row.network_type ?? null,
    step_count: row.step_count ?? null,
    device_id: row.device_id ?? "iphone",
    received_at: row.received_at,
    place_name: row.place_name ?? null,
    geocode_name: row.geocode_name ?? null,
    geocode_locality: row.geocode_locality ?? null,
    geocode_thoroughfare: row.geocode_thoroughfare ?? null,
    geocode_sub_thoroughfare: row.geocode_sub_thoroughfare ?? null,
    geocode_administrative_area: row.geocode_administrative_area ?? null,
    geocode_iso_country_code: row.geocode_iso_country_code ?? null,
    recorded_at_ts: recordedAtTs,
  };
}

function compareStored(desc: boolean): (a: StoredRow, b: StoredRow) => number {
  const dir = desc ? -1 : 1;
  return (a, b) => {
    const recorded = a.recorded_at_ts.getTime() - b.recorded_at_ts.getTime();
    if (recorded !== 0) return dir * recorded;
    const received = Date.parse(a.received_at) - Date.parse(b.received_at);
    if (received !== 0) return dir * received;
    return dir * a.id.localeCompare(b.id);
  };
}

function memoryPool(rows: StoredRow[]): Pool {
  return {
    query: async (sql: string, params?: unknown[]) => {
      const text = String(sql).replace(/\s+/g, " ");
      if (text.includes("WHERE recorded_at_ts IS NOT NULL") && text.includes("recorded_at_ts >=")) {
        const from = params?.[0] as Date;
        const to = params?.[1] as Date;
        const limit = params?.[2] as number;
        const filtered = rows
          .filter((row) => {
            const ms = row.recorded_at_ts.getTime();
            return ms >= from.getTime() && ms <= to.getTime();
          })
          .sort(compareStored(false))
          .slice(0, limit)
          .map(({ recorded_at_ts: _ts, ...rest }) => rest);
        return { rows: filtered, rowCount: filtered.length };
      }
      if (text.includes("ORDER BY recorded_at_ts DESC")) {
        const latest = [...rows]
          .sort(compareStored(true))
          .slice(0, 1)
          .map(({ recorded_at_ts: _ts, ...rest }) => rest);
        return { rows: latest, rowCount: latest.length };
      }
      throw new Error(`unexpected query: ${text}`);
    },
  } as unknown as Pool;
}

function mcpRequest(body: unknown, token = "secret-token"): Request {
  return new Request("http://127.0.0.1:8080/mcp", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
    },
    body: JSON.stringify(body),
  });
}

function jsonRpcFromMcpBody(body: string): unknown {
  const trimmed = body.trim();
  if (trimmed.startsWith("{")) return JSON.parse(trimmed) as unknown;
  const dataLines: string[] = [];
  for (const line of trimmed.split(/\r?\n/)) {
    if (line.startsWith("data:")) dataLines.push(line.slice(5).trimStart());
  }
  if (dataLines.length === 0) {
    throw new Error(`unrecognized MCP body: ${trimmed.slice(0, 300)}`);
  }
  return JSON.parse(dataLines[dataLines.length - 1] ?? "{}") as unknown;
}

function toolText(rpc: unknown): string {
  const result = (rpc as { result?: { content?: Array<{ text?: string }>; isError?: boolean } })
    .result;
  const text = result?.content?.[0]?.text;
  if (typeof text !== "string") {
    throw new Error(`missing tool text: ${JSON.stringify(rpc)}`);
  }
  return text;
}

const handlers: Array<{ close: () => Promise<void> }> = [];

after(async () => {
  while (handlers.length > 0) {
    const handler = handlers.pop();
    try {
      await handler?.close();
    } catch {
      /* ignore */
    }
  }
});

function trackedHandler(pool: Pool) {
  const handler = createOmlMcpHttpHandler({ pool, env });
  handlers.push(handler);
  return handler;
}

describe("queryLocationsInRange bounds", () => {
  it("compares mixed offsets as Instant and includes both ends", async () => {
    const pool = memoryPool([
      locationRow({
        id: "early",
        recorded_at: "2026-09-11T23:00:00+09:00",
        received_at: "2026-09-11T14:00:01Z",
        step_count: 10,
      }),
      locationRow({
        id: "mid",
        recorded_at: "2026-09-11T15:00:00Z",
        received_at: "2026-09-11T15:00:01Z",
        step_count: 20,
        place_name: "Tokyo Station",
      }),
      locationRow({
        id: "late",
        recorded_at: "2026-09-12T01:00:00+09:00",
        received_at: "2026-09-11T16:00:01Z",
        step_count: 30,
      }),
    ]);

    const bothEnds = await queryLocationsInRange(
      pool,
      "2026-09-11T14:00:00Z",
      "2026-09-11T15:00:00Z",
      100,
    );
    assert.equal(bothEnds.ok, true);
    if (bothEnds.ok) {
      assert.equal(bothEnds.value.inclusive, true);
      assert.equal(bothEnds.value.order, "recorded_at_asc");
      assert.deepEqual(
        bothEnds.value.locations.map((row) => row.id),
        ["early", "mid"],
      );
      assert.equal(bothEnds.value.locations[0]?.step_count, 10);
      assert.equal(bothEnds.value.locations[1]?.place_name, "Tokyo Station");
      assert.equal("raw_json" in (bothEnds.value.locations[0] ?? {}), false);
    }

    const tokyoDay = await queryLocationsInRange(
      pool,
      "2026-09-12T00:00:00+09:00",
      "2026-09-12T00:00:00+09:00",
      100,
    );
    assert.equal(tokyoDay.ok, true);
    if (tokyoDay.ok) {
      assert.deepEqual(
        tokyoDay.value.locations.map((row) => row.id),
        ["mid"],
      );
    }

    const empty = await queryLocationsInRange(
      pool,
      "2026-09-11T14:30:00Z",
      "2026-09-11T14:45:00Z",
      100,
    );
    assert.equal(empty.ok, true);
    if (empty.ok) assert.deepEqual(empty.value.locations, []);
  });

  it("orders by recorded_at Instant ascending, not lexical strings", async () => {
    const pool = memoryPool([
      locationRow({
        id: "lexically-first-but-later",
        recorded_at: "2026-09-11T15:00:00Z",
        received_at: "2026-09-11T15:00:02Z",
      }),
      locationRow({
        id: "lexically-later-but-earlier",
        recorded_at: "2026-09-11T23:00:00+09:00",
        received_at: "2026-09-11T14:00:02Z",
      }),
    ]);

    const result = await queryLocationsInRange(
      pool,
      "2026-09-11T00:00:00Z",
      "2026-09-12T00:00:00Z",
      100,
    );
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.deepEqual(
        result.value.locations.map((row) => row.id),
        ["lexically-later-but-earlier", "lexically-first-but-later"],
      );
    }
  });

  it("rejects timezone-less from/to and inverted range", async () => {
    const pool = memoryPool([]);
    const noTz = await queryLocationsInRange(
      pool,
      "2026-09-12T00:00:00",
      "2026-09-12T01:00:00Z",
      100,
    );
    assert.equal(noTz.ok, false);
    if (!noTz.ok) assert.match(noTz.error, /timezone/);

    const inverted = await queryLocationsInRange(
      pool,
      "2026-09-12T01:00:00Z",
      "2026-09-12T00:00:00Z",
      100,
    );
    assert.equal(inverted.ok, false);
  });

  it("caps limit at 1000 and defaults to 100", async () => {
    const pool = memoryPool([]);
    const capped = await queryLocationsInRange(
      pool,
      "2026-09-11T00:00:00Z",
      "2026-09-12T00:00:00Z",
      5000,
    );
    assert.equal(capped.ok, true);
    if (capped.ok) assert.equal(capped.value.limit, 1000);

    const def = await queryLocationsInRange(
      pool,
      "2026-09-11T00:00:00Z",
      "2026-09-12T00:00:00Z",
      undefined,
    );
    assert.equal(def.ok, true);
    if (def.ok) assert.equal(def.value.limit, 100);
  });
});

describe("queryLatestLocation", () => {
  it("returns null when empty", async () => {
    const pool = memoryPool([]);
    assert.deepEqual(await queryLatestLocation(pool), { location: null });
  });

  it("picks newest Instant and tie-breaks received_at then id", async () => {
    const pool = memoryPool([
      locationRow({
        id: "older-instant",
        recorded_at: "2026-09-11T23:00:00+09:00",
        received_at: "2026-09-11T16:00:00Z",
      }),
      locationRow({
        id: "same-instant-a",
        recorded_at: "2026-09-11T15:00:00Z",
        received_at: "2026-09-11T15:00:01Z",
      }),
      locationRow({
        id: "same-instant-b",
        recorded_at: "2026-09-12T00:00:00+09:00",
        received_at: "2026-09-11T15:00:02Z",
      }),
    ]);

    const latest = await queryLatestLocation(pool);
    assert.equal(latest.location?.id, "same-instant-b");
  });
});

describe("POST /mcp auth and tools", () => {
  it("rejects missing or wrong Bearer with 401 and empty body", async () => {
    const handler = trackedHandler(memoryPool([]));
    const missing = await handler.fetch(
      new Request("http://127.0.0.1:8080/mcp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize" }),
      }),
    );
    assert.equal(missing.status, 401);
    assert.equal(await missing.text(), "");

    const wrong = await handler.fetch(
      mcpRequest({ jsonrpc: "2.0", id: 1, method: "initialize" }, "nope"),
    );
    assert.equal(wrong.status, 401);
    assert.equal(await wrong.text(), "");
  });

  it("initialize succeeds with the ingest Bearer", async () => {
    const handler = trackedHandler(memoryPool([]));
    const response = await handler.fetch(
      mcpRequest({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: "2025-03-26",
          capabilities: {},
          clientInfo: { name: "oml-test", version: "0.0.1" },
        },
      }),
    );
    assert.equal(response.status, 200);
    const text = await response.text();
    assert.match(text, /protocolVersion/);
  });

  it("tools/call get_latest_location returns JSON text over Streamable HTTP", async () => {
    const handler = trackedHandler(
      memoryPool([
        locationRow({
          id: "latest",
          recorded_at: "2026-09-11T22:00:00+09:00",
          received_at: "2026-09-11T13:00:01Z",
          step_count: 99,
        }),
      ]),
    );
    const response = await handler.fetch(
      mcpRequest({
        jsonrpc: "2.0",
        id: 2,
        method: "tools/call",
        params: { name: "get_latest_location", arguments: {} },
      }),
    );
    assert.equal(response.status, 200);
    const text = await response.text();
    assert.match(text, /latest/);
    assert.match(text, /step_count/);
  });

  it("get_locations returns posted oml/1 fields including step_count", async () => {
    const pool = memoryPool([
      locationRow({
        id: "550e8400-e29b-41d4-a716-446655440000",
        recorded_at: "2026-09-11T22:00:00+09:00",
        received_at: "2026-09-11T13:00:01Z",
        lat: 35.6812,
        lon: 139.7671,
        accuracy_m: 65,
        step_count: 12345,
        place_name: "Home",
      }),
    ]);

    const queried = await queryLocationsInRange(
      pool,
      "2026-09-11T13:00:00Z",
      "2026-09-11T13:00:00Z",
      10,
    );
    assert.equal(queried.ok, true);
    if (queried.ok) {
      assert.equal(queried.value.locations.length, 1);
      assert.equal(queried.value.locations[0]?.step_count, 12345);
      assert.equal(queried.value.locations[0]?.place_name, "Home");
      assert.equal(queried.value.locations[0]?.lat, 35.6812);
    }

    const handler = trackedHandler(pool);
    const response = await handler.fetch(
      mcpRequest({
        jsonrpc: "2.0",
        id: 3,
        method: "tools/call",
        params: {
          name: "get_locations",
          arguments: {
            from: "2026-09-11T13:00:00Z",
            to: "2026-09-11T13:00:00Z",
          },
        },
      }),
    );
    assert.equal(response.status, 200);
    const payload = JSON.parse(toolText(jsonRpcFromMcpBody(await response.text()))) as {
      locations: LocationRead[];
    };
    assert.equal(payload.locations[0]?.step_count, 12345);
    assert.equal("raw_json" in (payload.locations[0] ?? {}), false);
    assert.equal("motion" in (payload.locations[0] ?? {}), false);
  });

  it("get_locations rejects timezone-less from over MCP", async () => {
    const handler = trackedHandler(memoryPool([]));
    const response = await handler.fetch(
      mcpRequest({
        jsonrpc: "2.0",
        id: 4,
        method: "tools/call",
        params: {
          name: "get_locations",
          arguments: {
            from: "2026-09-12T00:00:00",
            to: "2026-09-12T01:00:00Z",
          },
        },
      }),
    );
    assert.equal(response.status, 200);
    const rpc = jsonRpcFromMcpBody(await response.text()) as {
      result?: { isError?: boolean };
    };
    const text = toolText(rpc);
    assert.match(text, /timezone/);
    assert.equal(rpc.result?.isError, true);
  });
});

describe("Fastify /mcp route", () => {
  it("returns 401 with empty body through Fastify.inject", async () => {
    const app = buildApp({ pool: memoryPool([]), env });
    try {
      const missing = await app.inject({
        method: "POST",
        url: "/mcp",
        headers: { "content-type": "application/json" },
        payload: { jsonrpc: "2.0", id: 1, method: "initialize" },
      });
      assert.equal(missing.statusCode, 401);
      assert.equal(missing.body, "");
    } finally {
      await app.close();
    }
  });

  it("initializes over the Fastify route", async () => {
    const app = buildApp({ pool: memoryPool([]), env });
    try {
      const response = await app.inject({
        method: "POST",
        url: "/mcp",
        headers: {
          authorization: "Bearer secret-token",
          "content-type": "application/json",
          accept: "application/json, text/event-stream",
        },
        payload: {
          jsonrpc: "2.0",
          id: 1,
          method: "initialize",
          params: {
            protocolVersion: "2025-03-26",
            capabilities: {},
            clientInfo: { name: "oml-test", version: "0.0.1" },
          },
        },
      });
      assert.equal(response.statusCode, 200);
      assert.match(response.body, /protocolVersion/);
    } finally {
      await app.close();
    }
  });

  it("get_latest_location is null on an empty store through Fastify", async () => {
    const app = buildApp({ pool: memoryPool([]), env });
    try {
      const response = await app.inject({
        method: "POST",
        url: "/mcp",
        headers: {
          authorization: "Bearer secret-token",
          "content-type": "application/json",
          accept: "application/json, text/event-stream",
        },
        payload: {
          jsonrpc: "2.0",
          id: 2,
          method: "tools/call",
          params: { name: "get_latest_location", arguments: {} },
        },
      });
      assert.equal(response.statusCode, 200);
      const payload = JSON.parse(toolText(jsonRpcFromMcpBody(response.body))) as {
        location: LocationRead | null;
      };
      assert.equal(payload.location, null);
    } finally {
      await app.close();
    }
  });
});
