import assert from "node:assert/strict";
import test from "node:test";
import { configFromEnv, readIdentity } from "../app/lib/identity.ts";

const headers = (pairs) => new Headers(pairs);

test("open mode: everyone may write, no identity required", () => {
  const config = configFromEnv({});
  const anon = readIdentity(headers({}), config);
  assert.equal(anon.mode, "open");
  assert.equal(anon.editor, true);
  assert.equal(anon.user, null);
  const dev = readIdentity(headers({}), configFromEnv({ AUTH_DEV_USER: "brandon" }));
  assert.equal(dev.user, "brandon");
});

test("proxy mode: no headers means anonymous and not an editor", () => {
  const id = readIdentity(headers({}), configFromEnv({ AUTH_MODE: "proxy", AUTH_LOGOUT_URL: "/oauth/sign_out" }));
  assert.equal(id.user, null);
  assert.equal(id.editor, false);
  assert.equal(id.logoutUrl, "/oauth/sign_out");
});

test("proxy mode: editors come from the list or the group, case-insensitively", () => {
  const config = configFromEnv({ AUTH_MODE: "proxy", AUTH_EDITORS: "Alice, bob@example.com", AUTH_EDITOR_GROUP: "scopewright-editors" });
  assert.equal(readIdentity(headers({ "x-forwarded-user": "alice" }), config).editor, true);
  assert.equal(readIdentity(headers({ "x-forwarded-user": "carol", "x-forwarded-email": "Bob@Example.com" }), config).editor, true);
  assert.equal(readIdentity(headers({ "x-forwarded-user": "dave", "x-forwarded-groups": "ops,scopewright-editors" }), config).editor, true);
  const viewer = readIdentity(headers({ "x-forwarded-user": "erin" }), config);
  assert.equal(viewer.editor, false);
  assert.equal(viewer.user, "erin");
});

test("proxy mode with no editor config trusts the proxy's admission decision", () => {
  const id = readIdentity(headers({ "x-forwarded-user": "anyone" }), configFromEnv({ AUTH_MODE: "proxy" }));
  assert.equal(id.editor, true);
});

test("header names are configurable for other proxies", () => {
  const config = configFromEnv({ AUTH_MODE: "proxy", AUTH_USER_HEADER: "Cf-Access-Authenticated-User-Email", AUTH_EDITORS: "me@example.com" });
  const id = readIdentity(headers({ "cf-access-authenticated-user-email": "me@example.com" }), config);
  assert.equal(id.user, "me@example.com");
  assert.equal(id.editor, true);
});
