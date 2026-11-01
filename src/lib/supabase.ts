import { createClient, type SupabaseClient } from "@supabase/supabase-js";

type SessionPreference = "remember" | "temporary";

const clients = new Map<SessionPreference, SupabaseClient>();

export function isSupabaseConfigured(): boolean {
  return Boolean(
    import.meta.env.VITE_SUPABASE_URL &&
      import.meta.env.VITE_SUPABASE_ANON_KEY,
  );
}

export function readRememberSession(): boolean {
  try {
    return window.localStorage.getItem("tweak-remember-session") !== "false";
  } catch (error) {
    console.warn("Unable to read the saved session preference.", error);
    return true;
  }
}

export function saveRememberSession(remember: boolean): void {
  window.localStorage.setItem(
    "tweak-remember-session",
    remember ? "true" : "false",
  );
}

export function getSupabaseClient(
  remember = readRememberSession(),
): SupabaseClient | null {
  const url = import.meta.env.VITE_SUPABASE_URL;
  const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

  if (!url || !anonKey) {
    return null;
  }

  const preference: SessionPreference = remember ? "remember" : "temporary";
  const existingClient = clients.get(preference);

  if (existingClient) {
    return existingClient;
  }

  const client = createClient(url, anonKey, {
    auth: {
      storage: remember ? window.localStorage : window.sessionStorage,
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
    },
  });
  clients.set(preference, client);
  return client;
}
