import { handleStore } from "../../../lib/server-store";

export const dynamic = "force-dynamic";

export const GET = (request: Request) => handleStore("branding", request);
export const PUT = (request: Request) => handleStore("branding", request);
