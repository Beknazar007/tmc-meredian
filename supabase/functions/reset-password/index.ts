import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function json(status: number, payload: Record<string, unknown>) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function asEmail(login: string) {
  const normalized = login.trim().toLowerCase();
  return normalized.includes("@") ? normalized : `${normalized}@tmc.local`;
}

type AdminClient = ReturnType<typeof createClient>;

/** Find Auth user id by email (admin API has no get-by-email; listUsers is used). */
async function findAuthUserIdByEmail(adminClient: AdminClient, email: string): Promise<string | null> {
  const target = email.trim().toLowerCase();
  let page = 1;
  const perPage = 1000;
  const maxPages = 20;
  while (page <= maxPages) {
    const { data, error } = await adminClient.auth.admin.listUsers({ page, perPage });
    if (error) {
      console.error("listUsers error:", error.message);
      return null;
    }
    const users = data?.users ?? [];
    const hit = users.find((u) => (u.email ?? "").toLowerCase() === target);
    if (hit?.id) return hit.id;
    if (users.length < perPage) break;
    page += 1;
  }
  return null;
}

function isAuthDuplicateError(msg: string): boolean {
  const m = msg.toLowerCase();
  return (
    m.includes("already been registered") ||
    m.includes("already registered") ||
    m.includes("user already") ||
    m.includes("email address is already") ||
    m.includes("identity already exists")
  );
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json(405, { error: "Method not allowed" });

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceRoleKey) {
    return json(500, { error: "Missing Supabase environment variables for function." });
  }

  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return json(401, { error: "Missing Authorization header." });

  const callerClient = createClient(supabaseUrl, serviceRoleKey, {
    global: { headers: { Authorization: authHeader } },
  });
  const adminClient = createClient(supabaseUrl, serviceRoleKey);

  const {
    data: { user: caller },
    error: callerError,
  } = await callerClient.auth.getUser();
  if (callerError || !caller) return json(401, { error: "Invalid auth session." });

  const { data: callerProfile, error: callerProfileError } = await adminClient
    .from("tmc_users")
    .select("id, role")
    .eq("auth_user_id", caller.id)
    .maybeSingle();
  if (callerProfileError) return json(500, { error: callerProfileError.message });
  if (!callerProfile || callerProfile.role !== "admin") {
    return json(403, { error: "Only admin users can reset passwords." });
  }

  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object") return json(400, { error: "Invalid payload." });

  const userId = String((body as Record<string, unknown>).userId ?? "").trim();
  const password = String((body as Record<string, unknown>).password ?? "").trim();
  if (!userId) return json(400, { error: "userId is required." });
  if (!password || password.length < 6) {
    return json(400, { error: "Пароль должен содержать минимум 6 символов." });
  }

  const { data: targetProfile, error: targetErr } = await adminClient
    .from("tmc_users")
    .select("id, login, auth_user_id")
    .eq("id", userId)
    .maybeSingle();
  if (targetErr) return json(500, { error: targetErr.message });
  if (!targetProfile) return json(404, { error: "User not found." });

  let authUserId = targetProfile.auth_user_id as string | null;

  // If no row link yet: prefer existing Auth account (same email) — link + set password.
  // Only call createUser when no Auth user exists (avoids "already registered" errors).
  if (!authUserId) {
    const email = asEmail(String(targetProfile.login));
    const existingId = await findAuthUserIdByEmail(adminClient, email);
    if (existingId) {
      const { error: updateExistingErr } = await adminClient.auth.admin.updateUserById(existingId, {
        password,
        email_confirm: true,
      });
      if (updateExistingErr) {
        return json(400, { error: updateExistingErr.message || "Failed to update Auth user." });
      }
      const { error: linkErr } = await adminClient
        .from("tmc_users")
        .update({ auth_user_id: existingId, password: null })
        .eq("id", userId);
      if (linkErr) return json(400, { error: linkErr.message });
      return json(200, { ok: true, linked: true });
    }

    const { data: created, error: createErr } = await adminClient.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
    });
    if (createErr || !created?.user) {
      if (createErr?.message && isAuthDuplicateError(createErr.message)) {
        const retryId = await findAuthUserIdByEmail(adminClient, email);
        if (retryId) {
          const { error: uErr } = await adminClient.auth.admin.updateUserById(retryId, {
            password,
            email_confirm: true,
          });
          if (uErr) return json(400, { error: uErr.message || "Failed to set password for existing account." });
          const { error: linkErr2 } = await adminClient
            .from("tmc_users")
            .update({ auth_user_id: retryId, password: null })
            .eq("id", userId);
          if (linkErr2) return json(400, { error: linkErr2.message });
          return json(200, { ok: true, linked: true });
        }
      }
      return json(400, { error: createErr?.message || "Failed to create Auth user." });
    }
    authUserId = created.user.id;
    const { error: linkErr } = await adminClient
      .from("tmc_users")
      .update({ auth_user_id: authUserId, password: null })
      .eq("id", userId);
    if (linkErr) return json(400, { error: linkErr.message });
    return json(200, { ok: true, created: true });
  }

  const { error: updateErr } = await adminClient.auth.admin.updateUserById(authUserId, {
    password,
  });
  if (updateErr) return json(400, { error: updateErr.message });

  // Clear any legacy cleartext password stored on the profile row.
  await adminClient.from("tmc_users").update({ password: null }).eq("id", userId);

  return json(200, { ok: true });
});
