export type Platform = 'linux' | 'windows';

/**
 * Map the host's `process.platform` to an axe `Platform`. Used by install/
 * update/verify which run BEFORE a server binary exists (so `probe()` can't
 * detect the layout). Linux is the default; only `win32` maps to windows.
 */
export function hostPlatform(): Platform {
  return process.platform === 'win32' ? 'windows' : 'linux';
}
