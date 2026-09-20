import { browserSource } from "./browser.ts";
import { googleDriveSource } from "./google-drive.ts";
import { localFolderSource } from "./local-folder.ts";
import type { SourceProvider } from "./types.ts";

/**
 * Every source the app can offer, in the order they are shown. Sources are
 * compiled in on purpose: nothing is loaded at runtime, so a deployment only
 * ever runs code that was reviewed into this repository.
 *
 * A deployment narrows the list with the SOURCES environment variable
 * (see app/api/workspace/sources). "browser" is always offered.
 */
export const sources: SourceProvider[] = [browserSource, localFolderSource, googleDriveSource];

export function sourceById(id: string): SourceProvider {
  return sources.find((source) => source.id === id) ?? browserSource;
}
