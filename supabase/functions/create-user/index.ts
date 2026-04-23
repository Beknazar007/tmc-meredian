import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function json(status: number, payload: Record<string, unknown>) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json",
    },
  });
}

function asEmail(login: string) {
  const normalized = login.trim().toLowerCase();
  return normalized.includes("@") ? normalized : `${normalized}@tmc.local`;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return json(405, { error: "Method not allowed" });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceRoleKey) {
    return json(500, { error: "Missing Supabase environment variables for function." });
  }

  const authHeader = req.headers.get("Authorization");
  if (!authHeader) {
    return json(401, { error: "Missing Authorization header." });
  }

  const callerClient = createClient(supabaseUrl, serviceRoleKey, {
    global: { headers: { Authorization: authHeader } },
  });
  const adminClient = createClient(supabaseUrl, serviceRoleKey);

  const {
    data: { user: caller },
    error: callerError,
  } = await callerClient.auth.getUser();
  if (callerError || !caller) {
    return json(401, { error: "Invalid auth session." });
  }

  const { data: callerProfile, error: callerProfileError } = await adminClient
    .from("tmc_users")
    .select("id, role")
    .eq("auth_user_id", caller.id)
    .maybeSingle();
  if (callerProfileError) {
    return json(500, { error: callerProfileError.message });
  }
  if (!callerProfile || callerProfile.role !== "admin") {
    return json(403, { error: "Only admin users can create users." });
  }

  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return json(400, { error: "Invalid payload." });
  }

  const id = String(body.id ?? "").trim();
  const name = String(body.name ?? "").trim();
  const login = String(body.login ?? "").trim().toLowerCase();
  const password = String(body.password ?? "").trim();
  const role = String(body.role ?? "user").trim().toLowerCase();
  const warehouseIdRaw = body.warehouseId;
  const warehouseId =
    warehouseIdRaw === undefined || warehouseIdRaw === null || String(warehouseIdRaw).trim() === ""
      ? null
      : String(warehouseIdRaw).trim();

  if (!id || !name || !login || !password) {
    return json(400, { error: "id, name, login and password are required." });
  }
  if (!["admin", "user"].includes(role)) {
    return json(400, { error: "Role must be admin or user." });
  }

  const email = asEmail(login);
  const { data: createdAuth, error: createAuthError } = await adminClient.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { name },
  });
  if (createAuthError || !createdAuth.user) {
    return json(400, { error: createAuthError?.message || "Failed to create auth user." });
  }

  const { data: profile, error: profileError } = await adminClient
    .from("tmc_users")
    .insert({
      id,
      auth_user_id: createdAuth.user.id,
      name,
      login,
      password: null,
      role,
      warehouse_id: warehouseId,
    })
    .select("*")
    .single();

  if (profileError) {
    await adminClient.auth.admin.deleteUser(createdAuth.user.id);
    return json(400, { error: profileError.message });
  }

  return json(200, {
    user: {
      id: profile.id,
      name: profile.name,
      login: profile.login,
      role: profile.role,
      password: profile.password ?? null,
      warehouseId: profile.warehouse_id,
      authUserId: profile.auth_user_id,
      created_at: profile.created_at,
      updated_at: profile.updated_at,
    },
  });
});
