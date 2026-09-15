/**
 * Shared workspace storage for the Node server.
 *
 * Each key is one JSON document on disk under DATA_DIR (default ./data). In
 * the OpenShift deployment that directory is a persistent volume, so the
 * catalog and brand survive restarts and are the same for every visitor.
 * Last write wins; there is no per-user data here. Writes require an editor
 * identity (see identity.ts); reads are open to anyone the proxy lets in.
 */
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { readIdentity } from "./identity.ts";

const keys = ["catalog", "branding"] as const;
export type StoreKey = (typeof keys)[number];
export const isStoreKey = (value: string): value is StoreKey => (keys as readonly string[]).includes(value);

const dataDir = () => path.resolve(process.env.DATA_DIR || "data");
const fileFor = (key: StoreKey) => path.join(dataDir(), `${key}.json`);

export async function readDocument(key: StoreKey): Promise<unknown | null> {
  try {
    return JSON.parse(await readFile(fileFor(key), "utf8")) as unknown;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

export async function writeDocument(key: StoreKey, value: unknown): Promise<void> {
  await mkdir(dataDir(), { recursive: true });
  const target = fileFor(key);
  const temp = `${target}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(temp, JSON.stringify(value, null, 2), "utf8");
  await rename(temp, target);
}

const MAX_BYTES = 2_000_000;

/** GET/PUT handler shared by the workspace routes. */
export async function handleStore(key: StoreKey, request: Request): Promise<Response> {
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });
  try {
    if (request.method === "GET") {
      const value = await readDocument(key);
      return json({ key, value });
    }
    if (request.method === "PUT") {
      const identity = readIdentity(request.headers);
      if (identity.mode === "proxy" && !identity.user && !identity.email) return json({ error: "Sign in to change the workspace" }, 401);
      if (!identity.editor) return json({ error: "Only editors can change the shared workspace" }, 403);
      const text = await request.text();
      if (text.length > MAX_BYTES) return json({ error: "Document too large" }, 413);
      let value: unknown;
      try {
        value = JSON.parse(text);
      } catch {
        return json({ error: "Body must be JSON" }, 400);
      }
      if (!value || typeof value !== "object") return json({ error: "Body must be a JSON object" }, 400);
      await writeDocument(key, value);
      return json({ key, savedAt: new Date().toISOString() });
    }
    return json({ error: "Method not allowed" }, 405);
  } catch (error) {
    return json({ error: (error as Error).message }, 500);
  }
}
