import "server-only";
import { createLocalStore } from "./local";
import { createSupabaseStore } from "./supabase";
import type { Store } from "./types";

let store: Store | undefined;

/** The app's data store: Supabase when it's configured, otherwise a local JSON file (for offline development). */
export function getStore(): Store {
  if (store) return store;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const secretKey = process.env.SUPABASE_SECRET_KEY;
  store = url && secretKey ? createSupabaseStore(url, secretKey) : createLocalStore();
  return store;
}

export type { Store };
