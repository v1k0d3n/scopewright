import { readIdentity } from "../../../lib/identity";

export const dynamic = "force-dynamic";

/** Who the proxy says is calling, and whether they may edit. Public fields only. */
export const GET = (request: Request) => {
  const identity = readIdentity(request.headers);
  return new Response(JSON.stringify(identity), { headers: { "content-type": "application/json", "cache-control": "no-store" } });
};
