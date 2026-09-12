import { timingSafeEqual } from "node:crypto";

function bearerToken(header: string | null | undefined): string | null {
  if (!header) return null;
  const match = /^Bearer\s+(\S+)/i.exec(header.trim());
  if (!match) return null;
  return match[1];
}

function equalSecret(actual: string, expected: string): boolean {
  const a = Buffer.from(actual);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export type Env = Record<string, string | undefined>;

export function expectedBearerToken(env: Env = process.env): string | undefined {
  const value = env.OML_BEARER_TOKEN?.trim();
  return value || undefined;
}

export function authorizeBearer(
  authorizationHeader: string | null | undefined,
  env: Env = process.env,
): boolean {
  const expected = expectedBearerToken(env);
  const token = bearerToken(authorizationHeader);
  if (!expected || !token) return false;
  return equalSecret(token, expected);
}
