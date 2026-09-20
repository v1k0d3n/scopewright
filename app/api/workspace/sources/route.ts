import { readSourcesConfig } from "../../../lib/sources/server-config";

export const dynamic = "force-dynamic";

/** Which estimate sources this deployment offers, and their public settings. */
export const GET = () => new Response(JSON.stringify(readSourcesConfig(process.env)), { headers: { "content-type": "application/json", "cache-control": "no-store" } });
