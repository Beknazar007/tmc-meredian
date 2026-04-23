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
    return json(403, { error: "Only admin users can delete users." });
  }

  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object") return json(400, { error: "Invalid payload." });

  const userId = String((body as Record<string, unknown>).userId ?? "").trim();
  if (!userId) return json(400, { error: "userId is required." });
  if (userId === callerProfile.id) {
    return json(400, { error: "Нельзя удалить самого себя." });
  }

  const { data: targetProfile, error: targetErr } = await adminClient
    .from("tmc_users")
    .select("id, auth_user_id")
    .eq("id", userId)
    .maybeSingle();
  if (targetErr) return json(500, { error: targetErr.message });
  if (!targetProfile) return json(404, { error: "User not found." });

  const { error: delProfileErr } = await adminClient
    .from("tmc_users")
    .delete()
    .eq("id", userId);
  if (delProfileErr) return json(400, { error: delProfileErr.message });

  if (targetProfile.auth_user_id) {
    const { error: delAuthErr } = await adminClient.auth.admin.deleteUser(
      targetProfile.auth_user_id
    );
    if (delAuthErr) {
      return json(207, {
        ok: true,
        warning: `Profile deleted, but failed to remove Auth user: ${delAuthErr.message}`,
      });
    }
  }

  return json(200, { ok: true });
});
