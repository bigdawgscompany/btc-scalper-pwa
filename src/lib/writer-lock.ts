export type LockStatus = "UNINITIALIZED" | "ACQUIRED" | "SECONDARY_READONLY" | "UNSUPPORTED";

const LOCK_NAME = "btc_scalper_writer_lock";

let lockReleaseCallback: (() => void) | null = null;
let currentStatus: LockStatus = "UNINITIALIZED";

/**
 * Request exclusive cross-tab writer lock for autopilot execution.
 */
export async function requestWriterLock(
  onStatusChange: (status: LockStatus) => void
): Promise<boolean> {
  if (typeof window === "undefined" || !("locks" in navigator)) {
    currentStatus = "UNSUPPORTED";
    onStatusChange("UNSUPPORTED");
    return false;
  }

  try {
    // Attempt non-blocking `ifAvailable: true` lock acquisition
    navigator.locks.request(
      LOCK_NAME,
      { ifAvailable: true },
      async (lock) => {
        if (!lock) {
          currentStatus = "SECONDARY_READONLY";
          onStatusChange("SECONDARY_READONLY");
          return;
        }

        currentStatus = "ACQUIRED";
        onStatusChange("ACQUIRED");

        // Hold the lock until explicitly released
        await new Promise<void>((resolve) => {
          lockReleaseCallback = resolve;
        });

        currentStatus = "SECONDARY_READONLY";
        onStatusChange("SECONDARY_READONLY");
      }
    );

    return true;
  } catch {
    currentStatus = "UNSUPPORTED";
    onStatusChange("UNSUPPORTED");
    return false;
  }
}

/**
 * Explicitly release the writer lock.
 */
export function releaseWriterLock(): void {
  if (lockReleaseCallback) {
    lockReleaseCallback();
    lockReleaseCallback = null;
  }
}

export function getWriterLockStatus(): LockStatus {
  return currentStatus;
}
