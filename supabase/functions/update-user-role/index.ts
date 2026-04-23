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
    return json(403, { error: "Only admin users can change roles." });
  }

  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object") return json(400, { error: "Invalid payload." });

  const userId = String((body as Record<string, unknown>).userId ?? "").trim();
  const role = String((body as Record<string, unknown>).role ?? "").trim().toLowerCase();
  const warehouseIdRaw = (body as Record<string, unknown>).warehouseId;
  const warehouseId =
    warehouseIdRaw === undefined
      ? undefined
      : warehouseIdRaw === null || String(warehouseIdRaw).trim() === ""
      ? null
      : String(warehouseIdRaw).trim();
  const nameRaw = (body as Record<string, unknown>).name;
  const name =
    nameRaw === undefined ? undefined : String(nameRaw).trim();

  if (!userId) return json(400, { error: "userId is required." });
  if (!["admin", "user"].includes(role)) {
    return json(400, { error: "Role must be admin or user." });
  }

  // Prevent the caller from demoting the last remaining admin.
  if (role !== "admin") {
    const { data: admins, error: adminsErr } = await adminClient
      .from("tmc_users")
      .select("id")
      .eq("role", "admin");
    if (adminsErr) return json(500, { error: adminsErr.message });
    const remainingAdmins = (admins || []).filter((a: { id: string }) => a.id !== userId);
    if (remainingAdmins.length === 0) {
      return json(400, { error: "Должен оставаться хотя бы один администратор." });
    }
  }

  const patch: Record<string, unknown> = { role };
  if (warehouseId !== undefined) patch.warehouse_id = warehouseId;
  if (name !== undefined && name.length > 0) patch.name = name;

  const { error: updateErr } = await adminClient
    .from("tmc_users")
    .update(patch)
    .eq("id", userId);
  if (updateErr) return json(400, { error: updateErr.message });

  return json(200, { ok: true });
});
