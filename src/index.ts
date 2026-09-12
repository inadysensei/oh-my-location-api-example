import { Pool } from "pg";
import { expectedBearerToken } from "./auth.js";
import { buildApp } from "./app.js";
import { applyMigrations } from "./migrate.js";

function databaseUrl(env: NodeJS.ProcessEnv = process.env): string {
  const fromUrl = env.DATABASE_URL?.trim();
  if (fromUrl) return fromUrl;

  const user = env.POSTGRES_USER?.trim() || "oml";
  const password = env.POSTGRES_PASSWORD ?? "oml";
  const host = env.POSTGRES_HOST?.trim() || "127.0.0.1";
  const port = env.POSTGRES_PORT?.trim() || "5432";
  const database = env.POSTGRES_DB?.trim() || "oml";
  return `postgres://${encodeURIComponent(user)}:${encodeURIComponent(password)}@${host}:${port}/${encodeURIComponent(database)}`;
}

async function waitForDb(pool: Pool, attempts = 30): Promise<void> {
  let lastError: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      await pool.query("SELECT 1");
      return;
    } catch (err) {
      lastError = err;
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }
  throw lastError instanceof Error ? lastError : new Error("database not ready");
}

async function main() {
  if (!expectedBearerToken()) {
    console.error("OML_BEARER_TOKEN is required");
    process.exit(1);
  }

  const pool = new Pool({ connectionString: databaseUrl() });
  await waitForDb(pool);
  await applyMigrations(pool);

  const app = buildApp({ pool });
  const port = Number(process.env.PORT || process.env.OML_PORT || 8080);
  const host = process.env.HOST || "0.0.0.0";

  const shutdown = async () => {
    try {
      await app.close();
    } catch {
      /* ignore */
    }
    try {
      await pool.end();
    } catch {
      /* ignore */
    }
    process.exit(0);
  };
  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);

  await app.listen({ port, host });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
