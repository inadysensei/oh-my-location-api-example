import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from "fastify";
import type { Pool } from "pg";
import { authorizeBearer, type Env } from "./auth.js";
import {
  insertOmlBatch,
  pingDb,
  selectLatestLocations,
  selectLocationById,
  updateOmlLocationPlaceGeocode,
} from "./db.js";
import { normalizeLocationId, parseLocationPatch, parseOmlBody } from "./oml.js";

export type AppOptions = {
  pool: Pool;
  env?: Env;
};

function empty(reply: FastifyReply, status: number) {
  return reply.code(status).header("content-type", "application/octet-stream").send();
}

function json(reply: FastifyReply, status: number, body: unknown) {
  return reply.code(status).send(body);
}

function requireBearer(request: FastifyRequest, reply: FastifyReply, env: Env): boolean {
  if (authorizeBearer(request.headers.authorization, env)) return true;
  empty(reply, 401);
  return false;
}

export function buildApp(options: AppOptions): FastifyInstance {
  const env = options.env ?? process.env;
  const { pool } = options;

  const app = Fastify({
    logger: true,
    bodyLimit: 10 * 1024 * 1024,
  });

  app.setErrorHandler((err, request, reply) => {
    const code = (err as { code?: string }).code;
    const status = (err as { statusCode?: number }).statusCode;
    if (
      code === "FST_ERR_CTP_INVALID_JSON_BODY" ||
      code === "FST_ERR_CTP_EMPTY_JSON_BODY" ||
      (err instanceof SyntaxError && status === 400)
    ) {
      return json(reply, 400, { ok: false, error: "invalid_json" });
    }
    request.log.error(err);
    return json(reply, 500, { ok: false, error: "server_error" });
  });

  app.get("/", async (_request, reply) => {
    return json(reply, 200, {
      name: "oh-my-location-api-example",
      schema: "oml/1",
      ingest: "/v1/locations",
      health: "/health",
    });
  });

  app.get("/health", async (_request, reply) => {
    const db = await pingDb(pool);
    if (!db) return json(reply, 503, { ok: false, error: "db_error" });
    return json(reply, 200, { ok: true });
  });

  app.route({
    method: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS", "HEAD"],
    url: "/v1/locations",
    handler: async (request, reply) => {
      if (request.method === "GET" || request.method === "HEAD") {
        if (!requireBearer(request, reply, env)) return;
        const query = request.query as { limit?: string };
        const parsedLimit = query.limit === undefined ? undefined : Number(query.limit);
        const limit =
          parsedLimit !== undefined && Number.isInteger(parsedLimit) ? parsedLimit : undefined;
        try {
          const locations = await selectLatestLocations(pool, limit);
          return json(reply, 200, { ok: true, locations });
        } catch (err) {
          request.log.error(err);
          return json(reply, 500, { ok: false, error: "db_error" });
        }
      }

      if (request.method !== "POST") {
        return empty(reply, 405);
      }

      if (!requireBearer(request, reply, env)) return;

      const parsed = parseOmlBody(request.body);
      if (!parsed.ok) {
        return json(reply, 400, { ok: false, error: parsed.error });
      }

      try {
        const accepted = await insertOmlBatch(pool, parsed.value);
        return json(reply, 200, { ok: true, accepted });
      } catch (err) {
        request.log.error(err);
        return json(reply, 500, { ok: false, error: "db_error" });
      }
    },
  });

  app.route({
    method: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS", "HEAD"],
    url: "/v1/locations/:id",
    handler: async (request, reply) => {
      const { id: rawId } = request.params as { id: string };
      const id = normalizeLocationId(rawId);

      if (request.method === "GET" || request.method === "HEAD") {
        if (!requireBearer(request, reply, env)) return;
        if (!id) return json(reply, 400, { ok: false, error: "invalid_id" });
        try {
          const location = await selectLocationById(pool, id);
          if (!location) return json(reply, 404, { ok: false, error: "not_found" });
          return json(reply, 200, { ok: true, location });
        } catch (err) {
          request.log.error(err);
          return json(reply, 500, { ok: false, error: "db_error" });
        }
      }

      if (request.method !== "PATCH") {
        return empty(reply, 405);
      }

      if (!requireBearer(request, reply, env)) return;
      if (!id) return json(reply, 400, { ok: false, error: "invalid_id" });

      const parsed = parseLocationPatch(request.body);
      if (!parsed.ok) {
        return json(reply, 400, { ok: false, error: parsed.error });
      }

      try {
        const result = await updateOmlLocationPlaceGeocode(pool, id, parsed.value);
        if (result === "not_found") {
          return json(reply, 404, { ok: false, error: "not_found" });
        }
        return json(reply, 200, { ok: true });
      } catch (err) {
        request.log.error(err);
        return json(reply, 500, { ok: false, error: "db_error" });
      }
    },
  });

  return app;
}
