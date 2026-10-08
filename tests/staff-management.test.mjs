import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const web = readFileSync("web/app.js", "utf8");
const edge = readFileSync("supabase/functions/storepos-invite-staff/index.ts", "utf8");
const grants = readFileSync("supabase/migrations/20261008_storepos_staff_v2_restore_service_role_grants.sql", "utf8");

test("Cloud staff operations and first-login password change use the StorePOS-specific endpoint", () => {
  assert.match(web, /supabase\\.functions\\.invoke\\("storepos-invite-staff"/);
  assert.doesNotMatch(web, /supabase\\.functions\\.invoke\\("invite-staff"/);
});

test("Edge Function authenticates the caller and verifies the correct shop and owner/admin role", () => {
  for (const fragment of [
    'caller.auth.getUser()', 'app_code !== "storepos"',
    'business_type !== "retail"', '"owner", "admin"',
    '.eq("user_id", userId)', '.eq("shop_id", shopId)'
  ]) assert.ok(edge.includes(fragment), "missing " + fragment);
});

test("Edge Function enforces StorePOS licenses and limits before staff creation", () => {
  for (const fragment of [
    '.from("shop_licenses")', '.from("license_plans")',
    '"staff"', '"staff_limit_reached"', '"license_expired"',
    '"cashier", "inventory"', 'admin.auth.admin.createUser'
  ]) assert.ok(edge.includes(fragment), "missing " + fragment);
});

test("Password change cannot be used to modify MotoPOS credentials", () => {
  for (const fragment of [
    'staffMetadata.app_code !== "storepos"',
    'staffMetadata.storepos_staff !== true',
    'staffMetadata.must_change_password !== true',
    'updateUserById(user.id'
  ]) assert.ok(edge.includes(fragment), "missing " + fragment);
});

test("Server-side role changes, status changes, and audit entries are retained", () => {
  for (const fragment of [
    '"update_role"', '"set_active"', '"staff.role_change"',
    '"staff.deactivate"', '"staff.reactivate"',
    '.from("audit_logs")'
  ]) assert.ok(edge.includes(fragment), "missing " + fragment);
});

test("Migration only restores minimum service-role grants", () => {
  assert.match(grants, /GRANT SELECT ON TABLE public\\.shop_licenses TO service_role;/);
  assert.match(grants, /GRANT SELECT ON TABLE public\\.license_plans TO service_role;/);
  assert.match(grants, /GRANT INSERT ON TABLE public\\.shop_members TO service_role;/);
  assert.match(grants, /GRANT INSERT ON TABLE public\\.user_profiles TO service_role;/);
  assert.match(grants, /GRANT INSERT ON TABLE public\\.audit_logs TO service_role;/);
  assert.doesNotMatch(grants, /(?:DELETE FROM|TRUNCATE|DROP TABLE|ALTER TABLE)/i);
});
