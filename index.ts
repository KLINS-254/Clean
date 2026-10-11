// Deploy as a Supabase Edge Function. The service-role key is used only server-side.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const respond = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  if (req.method !== "POST") return respond({ error: "Method not allowed" }, 405);

  const url = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !anonKey || !serviceKey) return respond({ error: "Server configuration missing" }, 500);

  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return respond({ error: "Sign in as Owner first" }, 401);
  const userClient = createClient(url, anonKey, { global: { headers: { Authorization: authHeader } } });
  const { data: userData, error: userError } = await userClient.auth.getUser();
  if (userError || !userData.user) return respond({ error: "Invalid session" }, 401);

  const admin = createClient(url, serviceKey);
  const { data: actor, error: actorError } = await admin.from("profiles")
    .select("role,active").eq("id", userData.user.id).single();
  if (actorError || !actor?.active || actor.role !== "Owner") return respond({ error: "Owner access required" }, 403);

  let body: { full_name?: string; email?: string; role?: string; password?: string };
  try { body = await req.json(); } catch { return respond({ error: "Invalid JSON body" }, 400); }
  const allowedRoles = ["Owner", "Waiter 1", "Waiter 2", "Waiter 3", "Waiter 4", "Cashier"];
  const full_name = String(body.full_name || "").trim();
  const email = String(body.email || "").trim().toLowerCase();
  const role = String(body.role || "");
  const password = String(body.password || "");
  if (!full_name || !email.includes("@") || !allowedRoles.includes(role) || password.length < 8) {
    return respond({ error: "Enter a name, valid email, allowed role and password of at least 8 characters" }, 400);
  }

  const { data: created, error: createError } = await admin.auth.admin.createUser({
    email, password, email_confirm: true, user_metadata: { full_name }
  });
  if (createError || !created.user) return respond({ error: createError?.message || "Could not create user" }, 400);

  const { error: profileError } = await admin.from("profiles").insert({
    id: created.user.id, full_name, role, active: true
  });
  if (profileError) {
    await admin.auth.admin.deleteUser(created.user.id);
    return respond({ error: "Profile creation failed: " + profileError.message }, 500);
  }
  return respond({ success: true, id: created.user.id, full_name, email, role }, 201);
});
