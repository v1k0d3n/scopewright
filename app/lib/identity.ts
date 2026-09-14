/**
 * Who is making this request, and may they change shared data?
 *
 * Scopewright never authenticates users itself. An authenticating reverse
 * proxy in front of the app (OpenShift oauth-proxy, oauth2-proxy, Cloudflare
 * Access, Traefik ForwardAuth, ...) does that and asserts the identity in
 * request headers. This module reads those headers; which headers, and who
 * counts as an editor, is configuration:
 *
 *   AUTH_MODE            "open" (default) — no proxy; everyone may read and write.
 *                        "proxy"          — identity headers are required; only
 *                                           editors may write.
 *   AUTH_USER_HEADER     header carrying the username   (default x-forwarded-user)
 *   AUTH_EMAIL_HEADER    header carrying the email      (default x-forwarded-email)
 *   AUTH_GROUPS_HEADER   header carrying group names, comma-separated
 *                                                       (default x-forwarded-groups)
 *   AUTH_EDITORS         comma-separated usernames or emails allowed to write
 *   AUTH_EDITOR_GROUP    a group whose members may write
 *   AUTH_LOGOUT_URL      link offered to signed-in users (e.g. /oauth/sign_out)
 *   AUTH_DEV_USER        in "open" mode, a name to show as signed in locally
 *
 * In proxy mode with neither AUTH_EDITORS nor AUTH_EDITOR_GROUP set, every
 * authenticated user is an editor: the proxy already decided who may log in.
 *
 * The app must only be reachable through the proxy (bind to localhost inside
 * the pod); otherwise anyone could forge the headers.
 */

export type Identity = {
  user: string | null;
  email: string | null;
  groups: string[];
  /** True when this request may change the shared catalog and brand. */
  editor: boolean;
  mode: "open" | "proxy";
  logoutUrl: string | null;
};

export type IdentityConfig = {
  mode: "open" | "proxy";
  userHeader: string;
  emailHeader: string;
  groupsHeader: string;
  editors: string[];
  editorGroup: string | null;
  logoutUrl: string | null;
  devUser: string | null;
};

const list = (value: string | undefined) => (value ?? "").split(",").map((item) => item.trim()).filter(Boolean);

export function configFromEnv(env: Record<string, string | undefined> = process.env): IdentityConfig {
  return {
    mode: env.AUTH_MODE === "proxy" ? "proxy" : "open",
    userHeader: (env.AUTH_USER_HEADER || "x-forwarded-user").toLowerCase(),
    emailHeader: (env.AUTH_EMAIL_HEADER || "x-forwarded-email").toLowerCase(),
    groupsHeader: (env.AUTH_GROUPS_HEADER || "x-forwarded-groups").toLowerCase(),
    editors: list(env.AUTH_EDITORS).map((item) => item.toLowerCase()),
    editorGroup: env.AUTH_EDITOR_GROUP?.trim() || null,
    logoutUrl: env.AUTH_LOGOUT_URL?.trim() || null,
    devUser: env.AUTH_DEV_USER?.trim() || null,
  };
}

export function readIdentity(headers: Headers, config: IdentityConfig = configFromEnv()): Identity {
  const user = headers.get(config.userHeader)?.trim() || null;
  const email = headers.get(config.emailHeader)?.trim() || null;
  const groups = list(headers.get(config.groupsHeader) ?? undefined);
  if (config.mode === "open") {
    return { user: user ?? config.devUser, email, groups, editor: true, mode: "open", logoutUrl: null };
  }
  if (!user && !email) return { user: null, email: null, groups: [], editor: false, mode: "proxy", logoutUrl: config.logoutUrl };
  const restricted = config.editors.length > 0 || config.editorGroup !== null;
  const listed = [user, email].some((value) => value && config.editors.includes(value.toLowerCase()));
  const inGroup = config.editorGroup !== null && groups.includes(config.editorGroup);
  return { user, email, groups, editor: !restricted || listed || inGroup, mode: "proxy", logoutUrl: config.logoutUrl };
}
