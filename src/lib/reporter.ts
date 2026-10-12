import "server-only";
import { createHmac, randomUUID } from "node:crypto";
import { cookies, headers } from "next/headers";
import { config } from "./config";

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

/**
 * A salted hash of the visitor's IP address, or null if it can't be worked out. Different people
 * usually report from different connections (phones on cellular, different homes), but clearing
 * cookies doesn't change your connection. We store only the hash, never the address.
 */
export async function getNetworkId(): Promise<string | null> {
  const h = await headers();
  // Vercel sets both headers to the real client address; the first x-forwarded-for entry is the client.
  const ip = h.get("x-real-ip") ?? h.get("x-forwarded-for")?.split(",")[0]?.trim() ?? (process.env.NODE_ENV === "production" ? null : "127.0.0.1");
  if (!ip || !config.networkSalt) return null;
  return createHmac("sha256", config.networkSalt).update(ip).digest("hex").slice(0, 32);
}
