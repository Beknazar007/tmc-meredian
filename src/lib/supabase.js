import { createClient } from "@supabase/supabase-js";

const runtimeConfig =
  typeof window !== "undefined" && window.__RUNTIME_CONFIG__ ? window.__RUNTIME_CONFIG__ : {};

// Accept both Vite and Next-style names to make deployments more forgiving.
const url =
  runtimeConfig.VITE_SUPABASE_URL ||
  runtimeConfig.NEXT_PUBLIC_SUPABASE_URL ||
  import.meta.env.VITE_SUPABASE_URL ||
  import.meta.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey =
  runtimeConfig.VITE_SUPABASE_ANON_KEY ||
  runtimeConfig.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ||
  import.meta.env.VITE_SUPABASE_ANON_KEY ||
  import.meta.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

export const hasSupabaseConfig = Boolean(url && anonKey);

export const supabase = hasSupabaseConfig ? createClient(url, anonKey) : null;

export async function signInWithPassword(email, password) {
  if (!supabase) throw new Error("Supabase auth is not configured.");
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) throw error;
  return data;
}

export async function signOut() {
  if (!supabase) return;
  const { error } = await supabase.auth.signOut();
  if (error) throw error;
}

export async function getSupabaseSession() {
  if (!supabase) return null;
  const {
    data: { session },
    error,
  } = await supabase.auth.getSession();
  if (error) throw error;
  return session;
}
