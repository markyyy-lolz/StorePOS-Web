import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const code = readFileSync("web/app.js", "utf8");
const begin = code.indexOf("// Verify the current session with Supabase Auth");
const end = code.indexOf("function friendlyError(error)", begin);
assert.ok(begin > 0 && end > begin, "protected function helper must exist");
const helper = code.slice(begin, end);

function makeApp({ validUser = true, responseStatus = 200 } = {}) {
  const calls = [];
  const state = { session: { user: { id: "old" } }, user: { id: "old" },
    membership: {}, shop: {}, isSystemAdmin: true, entitlements: {} };
  const supabase = {
    auth: {
      getUser: async () => ({ data: { user: validUser ? { id: "owner" } : null },
        error: validUser ? null : new Error("Session not found") }),
      getSession: async () => ({ data: { session: { access_token: "valid-jwt" } }, error: null }),
      signOut: async options => { calls.push(["signOut", options]); return { error: null }; }
    },
    functions: {
      invoke: async (name, options) => {
        calls.push(["invoke", name, options]);
        if (responseStatus === 200) return { data: { success: true }, error: null };
        return { data: null, error: { message: "Edge Function returned a non-2xx status code",
          context: { status: responseStatus } } };
      }
    }
  };
  const sandbox = {
    supabase, state, setHash: route => calls.push(["navigate", route]),
    functionErrorDetails: async () => ({ error: "Server: permission rejected" })
  };
  const { invokeProtectedStorePosFunction } = vm.runInNewContext(
    helper + "\n({invokeProtectedStorePosFunction})", sandbox
  );
  return { invokeProtectedStorePosFunction, calls, state };
}

test("StorePOS browser Auth has a stable unique storage key", () => {
  assert.match(code, /storageKey:\s*"storepos-cloud-auth-v1"/);
  assert.doesNotMatch(code, /await supabase\.auth\.signOut\(\);/);
  assert.match(code, /supabase\.auth\.signOut\(\{ scope: "local" \}\)/);
});

test("privileged calls validate session and send the current access token", async () => {
  const app = makeApp();
  const result = await app.invokeProtectedStorePosFunction("storepos-paymongo-admin", {
    body: { action: "status", shop_id: "shop-a" }
  });
  assert.equal(result.data.success, true);
  const invocation = app.calls.find(c => c[0] === "invoke");
  assert.equal(invocation[1], "storepos-paymongo-admin");
  assert.equal(invocation[2].headers.Authorization, "Bearer valid-jwt");
  assert.equal(app.calls.filter(c => c[0] === "signOut").length, 0);
});

test("revoked session does not invoke the function and redirects to sign in", async () => {
  const app = makeApp({ validUser: false });
  const result = await app.invokeProtectedStorePosFunction("admin-users", { body: { action: "list" } });
  assert.match(result.error.message, /session has expired/i);
  assert.equal(app.calls.some(c => c[0] === "invoke"), false);
  assert.equal(app.calls.find(c => c[0] === "signOut")[1].scope, "local");
  assert.equal(app.calls.find(c => c[0] === "navigate")[1], "login");
  assert.equal(app.state.session, null);
});

test("401 function response clears only current StorePOS session", async () => {
  const app = makeApp({ responseStatus: 401 });
  const result = await app.invokeProtectedStorePosFunction("storepos-paymongo-admin", { body: { action: "status" } });
  assert.match(result.error.message, /sign in again/i);
  assert.equal(app.calls.find(c => c[0] === "signOut")[1].scope, "local");
});

test("403 permission rejection is displayed without signing out", async () => {
  const app = makeApp({ responseStatus: 403 });
  const result = await app.invokeProtectedStorePosFunction("storepos-paymongo-admin", { body: { action: "connect" } });
  assert.equal(result.error.message, "Server: permission rejected");
  assert.equal(app.calls.some(c => c[0] === "signOut"), false);
});

test("all protected administrative entry points use auth guard", () => {
  for (const name of ["storepos-invite-staff", "storepos-paymongo-admin", "admin-users"]) {
    assert.match(code, new RegExp('invokeProtectedStorePosFunction\\("' + name + '"'));
    assert.doesNotMatch(code, new RegExp('supabase\\.functions\\.invoke\\("' + name + '"'));
  }
});
