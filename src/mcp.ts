import { createMcpHandler, McpServer } from "@modelcontextprotocol/server";
import type { Pool } from "pg";
import { z } from "zod";
import { authorizeBearer, type Env } from "./auth.js";
import { MAX_LOCATION_LIMIT } from "./iso-time.js";
import { queryLatestLocation, queryLocationsInRange } from "./locations-query.js";

const getLocationsInput = z.object({
  from: z
    .string()
    .describe(
      "Start of range (inclusive). ISO 8601 datetime with timezone: 2026-09-12T00:00:00+09:00 or 2026-09-11T15:00:00Z. Timezone-less local datetimes are rejected. Compared as an absolute Instant, not as Asia/Tokyo lexical strings.",
    ),
  to: z
    .string()
    .describe(
      "End of range (inclusive). Same format as from. Compared as an absolute Instant.",
    ),
  limit: z
    .number()
    .int()
    .min(1)
    .max(MAX_LOCATION_LIMIT)
    .optional()
    .describe(`Max rows to return. Default 100, max ${MAX_LOCATION_LIMIT}.`),
});

const readOnly = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
};

function jsonText(value: unknown) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(value) }],
  };
}

function errorText(message: string) {
  return {
    isError: true as const,
    content: [{ type: "text" as const, text: message }],
  };
}

function createOmlMcpServer(pool: Pool): McpServer {
  const server = new McpServer(
    { name: "oh-my-location-api-example", version: "1.0.0" },
    {
      instructions:
        "Read-only MCP for oh-my-location-api. Tools never write. get_locations requires ISO 8601 from/to with a timezone (Z or ±HH:MM). The range is inclusive on both ends and compared as absolute time.",
    },
  );

  server.registerTool(
    "get_locations",
    {
      title: "Get locations",
      description:
        "Read location points whose recorded_at Instant is in [from, to] (both ends inclusive). Ordered by recorded_at ascending. Read-only. from/to must include a timezone.",
      inputSchema: getLocationsInput,
      annotations: readOnly,
    },
    async ({ from, to, limit }) => {
      try {
        const queried = await queryLocationsInRange(pool, from, to, limit);
        if (!queried.ok) return errorText(queried.error);
        return jsonText(queried.value);
      } catch {
        return errorText("db_error");
      }
    },
  );

  server.registerTool(
    "get_latest_location",
    {
      title: "Get latest location",
      description:
        "Return the single newest location by recorded_at Instant (tie-break received_at, then id). Read-only. If the store is empty, location is null.",
      annotations: readOnly,
    },
    async () => {
      try {
        return jsonText(await queryLatestLocation(pool));
      } catch {
        return errorText("db_error");
      }
    },
  );

  return server;
}

export type OmlMcpHttpHandler = {
  fetch: (request: Request, options?: { parsedBody?: unknown }) => Promise<Response>;
  close: () => Promise<void>;
};

export function createOmlMcpHttpHandler(options: { pool: Pool; env?: Env }): OmlMcpHttpHandler {
  const env = options.env ?? process.env;
  const mcp = createMcpHandler(() => createOmlMcpServer(options.pool), {
    legacy: "stateless",
  });

  return {
    async fetch(request, extra) {
      if (!authorizeBearer(request.headers.get("authorization"), env)) {
        return new Response(null, { status: 401 });
      }
      return mcp.fetch(request, extra);
    },
    close: () => mcp.close(),
  };
}
