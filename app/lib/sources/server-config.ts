/**
 * What a deployment tells the browser about estimate sources.
 *
 *   SOURCES            comma-separated source ids to offer (default: all).
 *                      "browser" is always offered.
 *   SOURCE_<NAME>      passed to the providers as config["<NAME>"], for example
 *                      SOURCE_GOOGLE_CLIENT_ID. These values are sent to every
 *                      browser, so they must never be secrets.
 *
 * A new provider reads its own SOURCE_* settings from the config it is given;
 * nothing here needs to change when one is added.
 */
export type SourcesConfig = { enabled: string[] | null; config: Record<string, string> };

export function readSourcesConfig(env: Record<string, string | undefined>): SourcesConfig {
  const listed = (env.SOURCES ?? "").split(",").map((item) => item.trim().toLowerCase()).filter(Boolean);
  const config: Record<string, string> = {};
  for (const [key, value] of Object.entries(env)) {
    if (!key.startsWith("SOURCE_") || !value) continue;
    // A name that says it is a secret is a deployment mistake; refuse to publish it.
    if (/SECRET|PASSWORD|PRIVATE|TOKEN/i.test(key)) continue;
    config[key.slice("SOURCE_".length)] = value.slice(0, 500);
  }
  return { enabled: listed.length ? [...new Set(["browser", ...listed])] : null, config };
}
