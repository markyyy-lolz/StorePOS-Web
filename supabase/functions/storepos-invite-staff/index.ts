import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.117.2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

const STAFF_ROLES = new Set(["manager", "cashier", "inventory"]);
const MANAGER_ROLES = new Set(["owner", "admin"]);

function asEmail(value: unknown) {
  return String(value || "").trim().toLowerCase();
}

async function findAuthUserByEmail(admin: any, email: string) {
  for (let page = 1; page <= 20; page += 1) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 });
    if (error) throw error;
    const users = data?.users || [];
    const found = users.find((u: any) => String(u.email || "").toLowerCase() === email);
    if (found) return found;
    if (users.length < 200) break;
  }
  return null;
}

async function writeAudit(admin: any, payload: {
  shop_id: string;
  actor_id: string;
  action: string;
  entity_type?: string;
  entity_id?: string | null;
  old_data?: unknown;
  new_data?: unknown;
}) {
  const { error } = await admin.from("audit_logs").insert({
    shop_id: payload.shop_id,
    actor_id: payload.actor_id,
    action: payload.action,
    entity_type: payload.entity_type || "shop_member",
    entity_id: payload.entity_id || null,
    old_data: payload.old_data || null,
    new_data: payload.new_data || null,
  });
  if (error) console.error("audit_logs insert failed", error.message);
}

async function validateStorePosShop(admin: any, shopId: string) {
  const { data: shop, error } = await admin
    .from("shops")
    .select("id,name,app_code,business_type")
    .eq("id", shopId)
    .maybeSingle();

  if (error) throw error;
  if (!shop || shop.app_code !== "storepos" || shop.business_type !== "retail") {
    throw new Response(JSON.stringify({ error: "This action is only available for StorePOS retail workspaces.", code: "not_storepos_shop" }), { status: 403 });
  }
  return shop;
}

async function validateManager(admin: any, shopId: string, userId: string) {
  const { data: membership, error } = await admin
    .from("shop_members")
    .select("id,role,is_active")
    .eq("shop_id", shopId)
    .eq("user_id", userId)
    .eq("is_active", true)
    .maybeSingle();

  if (error) throw error;
  if (!membership || !MANAGER_ROLES.has(String(membership.role))) {
    throw new Response(JSON.stringify({
      error: "Only the StorePOS shop owner or shop admin can manage staff.",
      code: "staff_admin_required",
    }), { status: 403 });
  }
  return membership;
}

async function validateStaffEntitlement(admin: any, shopId: string, forActivation = true) {
  const { data: license, error: licenseError } = await admin
    .from("shop_licenses")
    .select("status,max_staff,expires_at,plan_code,feature_overrides")
    .eq("shop_id", shopId)
    .maybeSingle();

  if (licenseError) throw licenseError;
  if (!license || !["active", "trial"].includes(String(license.status))) {
    throw new Response(JSON.stringify({
      error: "This StorePOS shop needs an active license or trial before adding staff.",
      code: "license_inactive",
    }), { status: 403 });
  }
  if (license.expires_at && new Date(license.expires_at).getTime() <= Date.now()) {
    throw new Response(JSON.stringify({
      error: "The StorePOS license or trial has expired.",
      code: "license_expired",
    }), { status: 403 });
  }

  const { data: plan, error: planError } = await admin
    .from("license_plans")
    .select("code,name,app_code,features,is_active")
    .eq("code", license.plan_code)
    .eq("app_code", "storepos")
    .eq("is_active", true)
    .maybeSingle();

  if (planError) throw planError;
  if (!plan) {
    throw new Response(JSON.stringify({
      error: "The StorePOS license plan is not configured.",
      code: "plan_missing",
    }), { status: 403 });
  }

  const planFeatures = Array.isArray(plan.features) ? plan.features : [];
  const overrideFeatures = Array.isArray(license.feature_overrides) ? license.feature_overrides : null;
  const features = license.status === "trial" ? planFeatures : (overrideFeatures ?? planFeatures);

  if (!features.includes("staff")) {
    throw new Response(JSON.stringify({
      error: "Staff management is not included in this StorePOS plan. Upgrade to StorePOS Pro, Business, or a custom plan with Staff enabled.",
      code: "staff_feature_locked",
    }), { status: 403 });
  }

  const { count, error: countError } = await admin
    .from("shop_members")
    .select("id", { count: "exact", head: true })
    .eq("shop_id", shopId)
    .eq("is_active", true);
  if (countError) throw countError;

  const maxStaff = Number(license.max_staff || 0);
  if (forActivation && maxStaff > 0 && Number(count || 0) >= maxStaff) {
    throw new Response(JSON.stringify({
      error: `Staff limit reached for this StorePOS license (${maxStaff} active accounts).`,
      code: "staff_limit_reached",
      max_staff: maxStaff,
      active_staff: Number(count || 0),
    }), { status: 403 });
  }

  return {
    license,
    plan,
    maxStaff,
    activeStaff: Number(count || 0),
  };
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed." }, 405);

  let newlyCreatedUserId: string | null = null;

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ error: "Authentication required.", code: "auth_required" }, 401);

    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!supabaseUrl || !anonKey || !serviceRoleKey) {
      return json({ error: "Server configuration is incomplete.", code: "server_config" }, 500);
    }

    const caller = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const admin = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const { data: userData, error: userError } = await caller.auth.getUser();
    const user = userData.user;
    if (userError || !user) return json({ error: "Invalid or expired StorePOS session.", code: "invalid_session" }, 401);

    const body = await req.json().catch(() => ({}));
    const action = String(body.action || "create").trim().toLowerCase();

    if (action === "change_password") {
      // Supabase Auth is shared with MotoPOS. Never update a MotoPOS or
      // unrelated account through the StorePOS temporary-password workflow.
      // app_metadata is server-managed and cannot be edited by the caller.
      const staffMetadata = user.app_metadata || {};
      if (staffMetadata.app_code !== "storepos" ||
          staffMetadata.storepos_staff !== true ||
          staffMetadata.must_change_password !== true) {
        return json({
          error: "This password-change flow is only for newly invited StorePOS staff.",
          code: "storepos_password_change_not_allowed",
        }, 403);
      }

      const newPassword = String(body.new_password || "");
      if (newPassword.length < 8) {
        return json({ error: "Your new password must be at least 8 characters.", code: "password_too_short" }, 400);
      }

      const currentMeta = user.app_metadata || {};
      const { data: updated, error: updateError } = await admin.auth.admin.updateUserById(user.id, {
        password: newPassword,
        app_metadata: {
          ...currentMeta,
          must_change_password: false,
          password_changed_at: new Date().toISOString(),
        },
      });

      if (updateError || !updated?.user) {
        return json({ error: updateError?.message || "Unable to change password.", code: "password_change_failed" }, 400);
      }

      return json({ success: true, password_changed: true });
    }

    const shopId = String(body.shop_id || "").trim();
    if (!shopId) return json({ error: "StorePOS shop is required.", code: "shop_required" }, 400);

    await validateStorePosShop(admin, shopId);
    const callerMembership = await validateManager(admin, shopId, user.id);

    if (action === "create") {
      const email = asEmail(body.email);
      const password = String(body.password || "");
      const displayName = String(body.display_name || "").trim();
      const role = String(body.role || "").trim().toLowerCase();

      if (!email || !displayName || !STAFF_ROLES.has(role)) {
        return json({
          error: "Full name, email and a valid StorePOS staff role are required.",
          code: "invalid_staff_fields",
        }, 400);
      }
      if (password.length < 8) {
        return json({ error: "Temporary password must be at least 8 characters.", code: "password_too_short" }, 400);
      }

      const entitlement = await validateStaffEntitlement(admin, shopId, true);

      let authUser = await findAuthUserByEmail(admin, email);
      let accountReused = Boolean(authUser);

      if (authUser) {
        const { data: existingMembership, error: existingMembershipError } = await admin
          .from("shop_members")
          .select("id,role,is_active")
          .eq("shop_id", shopId)
          .eq("user_id", authUser.id)
          .maybeSingle();
        if (existingMembershipError) throw existingMembershipError;

        if (existingMembership?.is_active) {
          return json({
            error: "This email already belongs to an active staff account in this StorePOS shop.",
            code: "already_staff",
          }, 409);
        }

        if (existingMembership && !existingMembership.is_active) {
          const { error: reactivateError } = await admin
            .from("shop_members")
            .update({ role, is_active: true })
            .eq("id", existingMembership.id)
            .eq("shop_id", shopId);
          if (reactivateError) throw reactivateError;

          await writeAudit(admin, {
            shop_id: shopId,
            actor_id: user.id,
            action: "staff.reactivate",
            entity_id: existingMembership.id,
            old_data: { role: existingMembership.role, is_active: false },
            new_data: { user_id: authUser.id, email, role, is_active: true, account_reused: true },
          });

          return json({
            success: true,
            account_reused: true,
            reactivated: true,
            user_id: authUser.id,
            membership_id: existingMembership.id,
            email,
            display_name: authUser.user_metadata?.display_name || displayName,
            role,
            plan_code: entitlement.license.plan_code,
            active_staff: entitlement.activeStaff + 1,
            max_staff: entitlement.maxStaff,
            message: "Existing StorePOS account reactivated. Its existing password was kept.",
          });
        }
        // Do not silently grant a new shop membership to a pre-existing
        // account from another shop or application. Use an explicit invitation
        // acceptance flow for cross-shop access instead.
        return json({
          error: "This email already has an account. Ask the user to request a shop invitation instead of setting a new temporary password.",
          code: "existing_account_requires_invitation",
        }, 409);
      }

      if (!authUser) {
        const { data: created, error: createError } = await admin.auth.admin.createUser({
          email,
          password,
          email_confirm: true,
          user_metadata: {
            display_name: displayName,
          },
          app_metadata: {
            app_code: "storepos",
            storepos_staff: true,
            must_change_password: true,
          },
        });

        if (createError || !created.user) {
          return json({
            error: createError?.message || "Unable to create StorePOS staff account.",
            code: "auth_create_failed",
          }, 400);
        }

        authUser = created.user;
        newlyCreatedUserId = authUser.id;
        accountReused = false;
      }

      const { data: profile, error: profileReadError } = await admin
        .from("user_profiles")
        .select("id,display_name")
        .eq("id", authUser.id)
        .maybeSingle();
      if (profileReadError) throw profileReadError;

      if (!profile) {
        const { error: profileInsertError } = await admin.from("user_profiles").insert({
          id: authUser.id,
          display_name: displayName,
          is_active: true,
          updated_at: new Date().toISOString(),
        });
        if (profileInsertError) throw profileInsertError;
      } else if (!profile.display_name || profile.display_name === "User") {
        const { error: profileUpdateError } = await admin.from("user_profiles")
          .update({ display_name: displayName, is_active: true, updated_at: new Date().toISOString() })
          .eq("id", authUser.id);
        if (profileUpdateError) throw profileUpdateError;
      }

      const { data: membership, error: membershipError } = await admin
        .from("shop_members")
        .insert({
          shop_id: shopId,
          user_id: authUser.id,
          role,
          is_active: true,
        })
        .select("id,joined_at")
        .single();

      if (membershipError) throw membershipError;

      await writeAudit(admin, {
        shop_id: shopId,
        actor_id: user.id,
        action: accountReused ? "staff.link_existing" : "staff.create",
        entity_id: membership.id,
        new_data: {
          app_code: "storepos",
          user_id: authUser.id,
          email,
          display_name: authUser.user_metadata?.display_name || displayName,
          role,
          account_reused: accountReused,
          must_change_password: !accountReused,
        },
      });

      newlyCreatedUserId = null;
      return json({
        success: true,
        account_reused: accountReused,
        temporary_password_used: !accountReused,
        must_change_password: !accountReused,
        user_id: authUser.id,
        membership_id: membership.id,
        email,
        display_name: authUser.user_metadata?.display_name || displayName,
        role,
        plan_code: entitlement.license.plan_code,
        active_staff: entitlement.activeStaff + 1,
        max_staff: entitlement.maxStaff,
        message: accountReused
          ? "Existing account linked to this StorePOS shop. Its existing password was kept."
          : "Staff account created. The temporary password must be changed after first sign-in.",
      });
    }

    if (action === "update_role" || action === "set_active") {
      const targetUserId = String(body.user_id || "").trim();
      if (!targetUserId) return json({ error: "Staff user is required.", code: "staff_required" }, 400);
      if (targetUserId === user.id) {
        return json({ error: "You cannot change your own StorePOS staff access from this screen.", code: "cannot_manage_self" }, 403);
      }

      const { data: target, error: targetError } = await admin
        .from("shop_members")
        .select("id,user_id,role,is_active")
        .eq("shop_id", shopId)
        .eq("user_id", targetUserId)
        .maybeSingle();

      if (targetError) throw targetError;
      if (!target) return json({ error: "Staff membership was not found.", code: "staff_not_found" }, 404);
      if (String(target.role) === "owner") {
        return json({ error: "The StorePOS owner account cannot be changed here.", code: "owner_protected" }, 403);
      }
      if (String(callerMembership.role) === "admin" && String(target.role) === "admin") {
        return json({ error: "Only the StorePOS owner can manage another shop admin.", code: "admin_protected" }, 403);
      }

      if (action === "update_role") {
        const nextRole = String(body.role || "").trim().toLowerCase();
        if (!STAFF_ROLES.has(nextRole)) {
          return json({ error: "Choose Cashier, Inventory Staff, or Manager.", code: "invalid_role" }, 400);
        }

        const { error: updateError } = await admin.from("shop_members")
          .update({ role: nextRole })
          .eq("id", target.id)
          .eq("shop_id", shopId);
        if (updateError) throw updateError;

        await writeAudit(admin, {
          shop_id: shopId,
          actor_id: user.id,
          action: "staff.role_change",
          entity_id: target.id,
          old_data: { role: target.role },
          new_data: { role: nextRole, user_id: target.user_id },
        });

        return json({ success: true, user_id: target.user_id, role: nextRole });
      }

      const active = Boolean(body.active);
      if (active && !target.is_active) await validateStaffEntitlement(admin, shopId, true);

      const { error: activeError } = await admin.from("shop_members")
        .update({ is_active: active })
        .eq("id", target.id)
        .eq("shop_id", shopId);
      if (activeError) throw activeError;

      await writeAudit(admin, {
        shop_id: shopId,
        actor_id: user.id,
        action: active ? "staff.reactivate" : "staff.deactivate",
        entity_id: target.id,
        old_data: { is_active: target.is_active },
        new_data: { is_active: active, user_id: target.user_id, role: target.role },
      });

      return json({ success: true, user_id: target.user_id, is_active: active });
    }

    return json({ error: "Unsupported StorePOS staff action.", code: "unsupported_action" }, 400);
  } catch (error) {
    if (newlyCreatedUserId) {
      try {
        const supabaseUrl = Deno.env.get("SUPABASE_URL");
        const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
        if (supabaseUrl && serviceRoleKey) {
          const cleanup = createClient(supabaseUrl, serviceRoleKey, {
            auth: { persistSession: false, autoRefreshToken: false },
          });
          await cleanup.auth.admin.deleteUser(newlyCreatedUserId);
        }
      } catch (_) {}
    }

    if (error instanceof Response) {
      try {
        const body = await error.json();
        return json(body, error.status);
      } catch (_) {
        return json({ error: "StorePOS staff action failed." }, error.status || 500);
      }
    }

    // PostgREST errors are plain objects, not always Error instances.
    const diagnosticId = crypto.randomUUID().slice(0, 12);
    const exception = error && typeof error === "object"
      ? error as Record<string, unknown> : {};
    const sqlCode = typeof exception.code === "string" ? exception.code : "";
    const rawMessage = typeof exception.message === "string"
      ? exception.message : error instanceof Error ? error.message : "";
    console.error("storepos-invite-staff failed", {
      diagnostic_id: diagnosticId,
      database_code: sqlCode || null,
      message: rawMessage || String(error),
      details: exception.details || null,
      hint: exception.hint || null,
    });
    const safeMessages: Record<string, string> = {
      "23505": "A staff account or membership already exists. Refresh the staff list before retrying.",
      "23503": "A related staff profile or shop record is missing. Contact StorePOS support with the diagnostic code.",
      "23502": "A required staff account field is missing. Contact StorePOS support with the diagnostic code.",
      "23514": "A StorePOS staff or account value was rejected by a database rule.",
      "42501": "StorePOS staff administration does not have database permission to complete the operation.",
      "PGRST116": "StorePOS could not locate the expected staff or license record.",
      "42P01": "A required StorePOS staff database table is unavailable.",
      "42703": "The StorePOS staff database schema is incompatible with this server function.",
    };
    return json({
      error: safeMessages[sqlCode] || "StorePOS staff administration could not complete the action. Contact support with the diagnostic code.",
      code: sqlCode ? "staff_database_" + sqlCode.toLowerCase() : "staff_server_error",
      request_id: diagnosticId,
    }, 500);
  }
});
