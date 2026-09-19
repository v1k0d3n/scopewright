import type { LockInfo, SourceProvider } from "./types.ts";

/**
 * Advisory locking, shared by every source.
 *
 * None of the places we store files offer a real lock, so a lock is a small
 * record next to the document saying who has it open and until when. The
 * holder renews it while the document is open. It is advisory: it stops two
 * people from editing by accident, and the revision check on save is what
 * stops a silent overwrite if the lock is ever bypassed.
 */

export const LOCK_MINUTES = 10;
export const RENEW_MINUTES = 3;

export function newLock(owner: string, token: string, now: number): LockInfo {
  return { owner, token, until: now + LOCK_MINUTES * 60_000 };
}

/** A lock stored by anyone is untrusted input: accept only the exact shape. */
export function parseLock(data: unknown): LockInfo | null {
  const d = data as Partial<LockInfo> | null;
  if (!d || typeof d !== "object" || typeof d.owner !== "string" || typeof d.token !== "string" || typeof d.until !== "number" || !Number.isFinite(d.until)) return null;
  return { owner: d.owner.slice(0, 120), token: d.token.slice(0, 120), until: d.until };
}

export function lockedByOther(lock: LockInfo | null, token: string, now: number): boolean {
  return Boolean(lock && lock.token !== token && lock.until > now);
}

/** Take or renew the lock. Resolves to the other holder's lock if there is one, else null. */
export async function acquire(provider: SourceProvider, id: string, owner: string, token: string, now: number): Promise<LockInfo | null> {
  const current = await provider.readLock(id);
  if (lockedByOther(current, token, now)) return current;
  await provider.writeLock(id, newLock(owner, token, now));
  // Two people can pass the check above at the same moment; whoever wrote last
  // wins, so read back and yield if it was not us.
  const settled = await provider.readLock(id);
  return lockedByOther(settled, token, now) ? settled : null;
}

export async function release(provider: SourceProvider, id: string, token: string): Promise<void> {
  const current = await provider.readLock(id);
  if (current && current.token === token) await provider.writeLock(id, null);
}
