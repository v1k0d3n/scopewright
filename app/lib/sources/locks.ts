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

/**
 * Locks are only ever granted for LOCK_MINUTES. Lock records sit in shared
 * folders and can be written by anyone, so one that claims to last longer than
 * that (with room for two machines' clocks disagreeing) was not written by this
 * app and is ignored; honouring it would let a crafted file block a document forever.
 */
export const MAX_LOCK_AHEAD_MS = 2 * LOCK_MINUTES * 60_000;

export function lockedByOther(lock: LockInfo | null, token: string, now: number): boolean {
  return Boolean(lock && lock.token !== token && lock.until > now && lock.until - now <= MAX_LOCK_AHEAD_MS);
}

/** Take or renew the lock. Resolves to the other holder's lock if there is one, else null. */
export async function acquire(provider: Pick<SourceProvider, "readLock" | "writeLock">, id: string, owner: string, token: string, now: number): Promise<LockInfo | null> {
  const current = await provider.readLock(id);
  if (lockedByOther(current, token, now)) return current;
  await provider.writeLock(id, newLock(owner, token, now));
  // Two people can pass the check above at the same moment; whoever wrote last
  // wins, so read back and yield if it was not us.
  const settled = await provider.readLock(id);
  return lockedByOther(settled, token, now) ? settled : null;
}

/** How long before expiry a lock is treated as already gone when releasing it. */
export const RELEASE_MARGIN_MS = 15_000;

/**
 * Give the lock up. None of the stores can delete conditionally, so the read
 * and the delete are two steps. Someone else can only take the lock once ours
 * has expired, so a lock that is ours and comfortably live cannot change hands
 * between those steps and is safe to delete. One that has expired, or is about
 * to, is left alone: it no longer blocks anyone, and deleting it could remove a
 * lock somebody has just taken.
 */
export async function release(provider: Pick<SourceProvider, "readLock" | "writeLock">, id: string, token: string, now: number): Promise<void> {
  const current = await provider.readLock(id);
  if (current && current.token === token && current.until - now > RELEASE_MARGIN_MS) await provider.writeLock(id, null);
}
