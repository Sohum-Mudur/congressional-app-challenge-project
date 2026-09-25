import "server-only";
import { createLocalStore } from "./local";
import type { Store } from "./types";

let store: Store | undefined;

/** The app's data store. Uses the local JSON store until Supabase is configured. */
export function getStore(): Store {
  // TODO(supabase): return createSupabaseStore() when NEXT_PUBLIC_SUPABASE_URL is set.
  return (store ??= createLocalStore());
}

export type { Store };
