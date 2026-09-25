import "server-only";
import { randomUUID } from "node:crypto";
import { cookies } from "next/headers";

const COOKIE = "reporter_id";

/**
 * Anonymous per-device id, kept in an httpOnly cookie so the page can't fake it.
 * Lets us require "2+ different people" and rate-limit without making anyone sign up.
 */
export async function getReporterId(): Promise<string> {
  const jar = await cookies();
  const existing = jar.get(COOKIE)?.value;
  if (existing) return existing;
  const id = randomUUID();
  jar.set(COOKIE, id, { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", maxAge: 60 * 60 * 24 * 365 * 2, path: "/" });
  return id;
}
