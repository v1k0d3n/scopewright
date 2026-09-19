import { folderNameFor, uniqueName } from "./documents.ts";
import { parseLock } from "./locks.ts";
import { ConflictError, NotConnectedError } from "./types.ts";
import type { DocumentBody, DocumentRef, LockInfo, SourceContext, SourceProvider } from "./types.ts";

/**
 * Estimates as JSON files in a Google Drive folder.
 *
 * Everything happens between the user's browser and Google. The user signs in
 * to Google in Google's own popup and grants this app the narrow "drive.file"
 * permission: files the app created or the user picked, nothing else in their
 * Drive. The access token lives in this module's memory for about an hour and
 * is never stored or sent to the Scopewright server. There is no client
 * secret and no refresh token.
 *
 * A deployment enables this source by setting SOURCE_GOOGLE_CLIENT_ID,
 * SOURCE_GOOGLE_API_KEY and SOURCE_GOOGLE_PROJECT_NUMBER (all public values
 * from a Google Cloud project whose OAuth client lists this site's origin).
 * Google's scripts are loaded only when the user clicks Connect.
 *
 * Locks and the list summary are kept in the file's appProperties, which are
 * visible only to this app, so listing a folder never downloads file contents.
 */

const SCOPE = "https://www.googleapis.com/auth/drive.file";
const API = "https://www.googleapis.com/drive/v3/files";
const UPLOAD = "https://www.googleapis.com/upload/drive/v3/files";
const FOLDER_KEY = "scopewright:google-drive-folder";
const MAX_BYTES = 5 * 1024 * 1024;
const FIELDS = "id,name,modifiedTime,headRevisionId,size,appProperties";

type TokenResponse = { access_token?: string; expires_in?: number; error?: string };
type TokenClient = { requestAccessToken(options?: { prompt?: string }): void };
type PickerDoc = { id: string; name: string };
type PickerBuilder = { [method: string]: (...args: unknown[]) => PickerBuilder } & { build(): { setVisible(visible: boolean): void } };
type GoogleGlobals = {
  google?: {
    accounts?: { oauth2: { initTokenClient(config: { client_id: string; scope: string; callback: (response: TokenResponse) => void; error_callback: (error: { type: string }) => void }): TokenClient; revoke(token: string, done: () => void): void } };
    picker?: { PickerBuilder: new () => PickerBuilder; DocsView: new (viewId: unknown) => PickerBuilder; ViewId: { FOLDERS: unknown }; Feature: { SUPPORT_DRIVES: unknown }; Action: { PICKED: string; CANCEL: string } };
  };
  gapi?: { load(name: string, done: () => void): void };
};
type DriveFile = { id: string; name: string; modifiedTime?: string; headRevisionId?: string; size?: string; appProperties?: Record<string, string> };

let token: { value: string; expires: number } | null = null;
let folder: PickerDoc | null = null;

const globals = () => window as unknown as GoogleGlobals;

function script(src: string): Promise<void> {
  return new Promise((resolve, reject) => {
    if (document.querySelector(`script[src="${src}"]`)) return resolve();
    const element = Object.assign(document.createElement("script"), { src, async: true });
    element.onload = () => resolve();
    element.onerror = () => reject(new Error("Could not reach Google. Check your connection or content blocker."));
    document.head.appendChild(element);
  });
}

function settings(context: SourceContext) {
  return { clientId: context.config.GOOGLE_CLIENT_ID ?? "", apiKey: context.config.GOOGLE_API_KEY ?? "", projectNumber: context.config.GOOGLE_PROJECT_NUMBER ?? "" };
}

function authorize(clientId: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const client = globals().google!.accounts!.oauth2.initTokenClient({
      client_id: clientId,
      scope: SCOPE,
      callback: (response) => {
        if (!response.access_token) return reject(new Error(response.error === "access_denied" ? "Google Drive access was not granted." : "Google sign-in did not complete."));
        token = { value: response.access_token, expires: Date.now() + ((response.expires_in ?? 3600) - 60) * 1000 };
        resolve();
      },
      // Closing the popup is the user changing their mind, not a failure.
      error_callback: (error) => reject(error.type === "popup_closed" ? new DOMException("Cancelled", "AbortError") : new Error(error.type === "popup_failed_to_open" ? "The Google sign-in window was blocked. Allow pop-ups for this site and try again." : "Google sign-in did not complete.")),
    });
    client.requestAccessToken({ prompt: "" });
  });
}

function pickFolder(apiKey: string, projectNumber: string): Promise<PickerDoc> {
  return new Promise((resolve, reject) => {
    const picker = globals().google!.picker!;
    // One tab per place a folder can live. setEnableDrives turns a view into
    // "shared drives only", so it must be its own view rather than a flag on the first.
    const folders = () => new picker.DocsView(picker.ViewId.FOLDERS).setSelectFolderEnabled(true).setIncludeFolders(true).setMimeTypes("application/vnd.google-apps.folder");
    new picker.PickerBuilder()
      .setTitle("Choose the folder that holds your estimates")
      .addView(folders().setParent("root").setLabel("My Drive"))
      .addView(folders().setOwnedByMe(false).setLabel("Shared with me"))
      .addView(folders().setEnableDrives(true).setLabel("Shared drives"))
      .enableFeature(picker.Feature.SUPPORT_DRIVES)
      .setOAuthToken(token!.value)
      .setDeveloperKey(apiKey)
      .setAppId(projectNumber)
      .setOrigin(window.location.origin)
      .setCallback((data: unknown) => {
        const result = data as { action: string; docs?: PickerDoc[] };
        if (result.action === picker.Action.PICKED && result.docs?.[0]) resolve({ id: result.docs[0].id, name: result.docs[0].name });
        else if (result.action === picker.Action.CANCEL) reject(new DOMException("Cancelled", "AbortError"));
      })
      .build()
      .setVisible(true);
  });
}

async function drive(url: string, init: RequestInit = {}): Promise<Response> {
  if (!token || token.expires < Date.now()) throw new NotConnectedError("Your Google session ended. Reconnect Google Drive to continue.");
  const response = await fetch(url, { ...init, headers: { ...init.headers, authorization: `Bearer ${token.value}` } });
  if (response.status === 401) { token = null; throw new NotConnectedError("Your Google session ended. Reconnect Google Drive to continue."); }
  if (response.status === 403) throw new Error("Google Drive refused that. You may only have view access to this folder or file.");
  if (response.status === 404) throw new Error("That file is no longer in the folder, or this app cannot see it.");
  if (!response.ok) throw new Error(`Google Drive answered ${response.status}.`);
  return response;
}

function rememberFolder() {
  try { window.localStorage.setItem(FOLDER_KEY, JSON.stringify(folder)); } catch { /* remembered for this page only */ }
}

function where(): PickerDoc {
  if (!folder) throw new NotConnectedError();
  return folder;
}

/** Drive ids are opaque; accept only their alphabet so an id can never alter a URL. */
function safeId(id: string): string {
  if (!/^[A-Za-z0-9_-]{10,200}$/.test(id)) throw new Error("Not a Google Drive file id.");
  return id;
}

/** appProperties allow 124 bytes per key and value together; trim on a character boundary. */
function fit(value: string, bytes = 90): string {
  let out = "";
  let used = 0;
  for (const char of value) {
    used += new TextEncoder().encode(char).length;
    if (used > bytes) break;
    out += char;
  }
  return out;
}

function summaryProperties(payload: unknown): Record<string, string> {
  const summary = (payload as { summary?: { customer?: unknown; title?: unknown; totalHours?: unknown } } | null)?.summary;
  return { swCustomer: fit(typeof summary?.customer === "string" ? summary.customer : ""), swTitle: fit(typeof summary?.title === "string" ? summary.title : ""), swHours: typeof summary?.totalHours === "number" ? String(summary.totalHours) : "" };
}

function lockFrom(properties: Record<string, string> | undefined): LockInfo | null {
  return parseLock({ owner: properties?.swLockOwner, token: properties?.swLockToken, until: Number(properties?.swLockUntil) });
}

function toRef(file: DriveFile): DocumentRef {
  const hours = Number(file.appProperties?.swHours);
  return { id: file.id, name: file.name, customer: file.appProperties?.swCustomer ?? "", title: file.appProperties?.swTitle ?? "", totalHours: file.appProperties?.swHours && Number.isFinite(hours) ? hours : null, updatedAt: Date.parse(file.modifiedTime ?? "") || 0, lock: lockFrom(file.appProperties) };
}

async function children(): Promise<DriveFile[]> {
  const query = new URLSearchParams({ q: `'${where().id}' in parents and trashed = false and mimeType = 'application/json'`, fields: `files(${FIELDS})`, pageSize: "200", supportsAllDrives: "true", includeItemsFromAllDrives: "true" });
  return ((await (await drive(`${API}?${query}`)).json()) as { files?: DriveFile[] }).files ?? [];
}

const metadata = async (id: string) => (await (await drive(`${API}/${safeId(id)}?fields=${FIELDS}&supportsAllDrives=true`)).json()) as DriveFile;

export const googleDriveSource: SourceProvider = {
  id: "google-drive",
  label: "Google Drive",
  description: "JSON files in a Drive folder you choose, using your own Google sign-in. Share the folder to work with a team.",

  configured: (context) => Boolean(settings(context).clientId && settings(context).apiKey && settings(context).projectNumber),
  unavailable: () => null,

  async resume() {
    if (!folder) {
      try {
        const stored = JSON.parse(window.localStorage.getItem(FOLDER_KEY) ?? "null") as PickerDoc | null;
        if (stored && typeof stored.id === "string" && typeof stored.name === "string") folder = { id: safeId(stored.id), name: stored.name.slice(0, 200) };
      } catch {
        /* no remembered folder */
      }
    }
    // A token cannot be renewed without a click, so after a reload the user reconnects (one click if still signed in to Google).
    return Boolean(folder && token && token.expires > Date.now());
  },

  async connect(context) {
    await script("https://accounts.google.com/gsi/client");
    if (!token || token.expires < Date.now()) await authorize(settings(context).clientId);
    if (!folder) await this.changeLocation!(context);
  },

  async changeLocation(context) {
    const { clientId, apiKey, projectNumber } = settings(context);
    await script("https://accounts.google.com/gsi/client");
    if (!token || token.expires < Date.now()) await authorize(clientId);
    await script("https://apis.google.com/js/api.js");
    await new Promise<void>((resolve) => globals().gapi!.load("picker", resolve));
    folder = await pickFolder(apiKey, projectNumber);
    rememberFolder();
  },

  /** drive.file covers this: the app may create inside a folder the user picked, and then owns what it created. */
  async createFolder(name) {
    const body = JSON.stringify({ name: folderNameFor(name), mimeType: "application/vnd.google-apps.folder", parents: [where().id] });
    const created = (await (await drive(`${API}?supportsAllDrives=true&fields=id,name`, { method: "POST", headers: { "content-type": "application/json" }, body })).json()) as PickerDoc;
    folder = { id: safeId(created.id), name: created.name };
    rememberFolder();
  },

  async disconnect() {
    const revoked = token?.value;
    token = null;
    folder = null;
    try { window.localStorage.removeItem(FOLDER_KEY); } catch { /* ignore */ }
    if (revoked) globals().google?.accounts?.oauth2.revoke(revoked, () => {});
  },

  location: () => (folder ? `Google Drive folder “${folder.name}”` : ""),

  list: async () => (await children()).map(toRef),

  async read(id): Promise<DocumentBody> {
    const file = await metadata(id);
    if (Number(file.size ?? 0) > MAX_BYTES) throw new Error(`${file.name} is too large to be an estimate.`);
    const payload = (await (await drive(`${API}/${safeId(id)}?alt=media&supportsAllDrives=true`)).json()) as unknown;
    return { payload, revision: file.headRevisionId ?? "" };
  },

  async write(id, name, payload, revision) {
    const body = JSON.stringify(payload, null, 2);
    if (id) {
      if (revision !== null && (await metadata(id)).headRevisionId !== revision) throw new ConflictError();
      await drive(`${UPLOAD}/${safeId(id)}?uploadType=media&supportsAllDrives=true`, { method: "PATCH", headers: { "content-type": "application/json" }, body });
      const updated = (await (await drive(`${API}/${safeId(id)}?fields=${FIELDS}&supportsAllDrives=true`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ appProperties: summaryProperties(payload) }) })).json()) as DriveFile;
      return { id, name: updated.name, revision: updated.headRevisionId ?? "" };
    }
    const finalName = uniqueName(name, (await children()).map((file) => file.name));
    const boundary = `scopewright-${crypto.randomUUID()}`;
    const meta = { name: finalName, parents: [where().id], mimeType: "application/json", appProperties: summaryProperties(payload) };
    const multipart = `--${boundary}\r\ncontent-type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(meta)}\r\n--${boundary}\r\ncontent-type: application/json\r\n\r\n${body}\r\n--${boundary}--`;
    const created = (await (await drive(`${UPLOAD}?uploadType=multipart&supportsAllDrives=true&fields=${FIELDS}`, { method: "POST", headers: { "content-type": `multipart/related; boundary=${boundary}` }, body: multipart })).json()) as DriveFile;
    return { id: created.id, name: created.name, revision: created.headRevisionId ?? "" };
  },

  /** Moves the file to the Drive trash, where its owner can restore it. */
  async remove(id) {
    await drive(`${API}/${safeId(id)}?supportsAllDrives=true`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ trashed: true }) });
  },

  readLock: async (id) => lockFrom((await metadata(id)).appProperties),

  async writeLock(id, lock) {
    // A null value deletes an appProperty.
    const appProperties = lock ? { swLockOwner: fit(lock.owner, 80), swLockToken: fit(lock.token, 80), swLockUntil: String(lock.until) } : { swLockOwner: null, swLockToken: null, swLockUntil: null };
    await drive(`${API}/${safeId(id)}?supportsAllDrives=true`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ appProperties }) });
  },
};
