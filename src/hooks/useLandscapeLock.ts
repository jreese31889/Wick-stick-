import { useCallback, useEffect, useState } from 'react';

/**
 * Landscape-first screen orientation handling for mobile.
 *
 * On launch (and on any user gesture via `lockLandscape`) the game asks the
 * browser for a landscape orientation lock through the Screen Orientation API
 * (`screen.orientation.lock('landscape')`). Because most mobile browsers only
 * permit that lock while the document is fullscreen, we also request
 * fullscreen first and retry the lock on `fullscreenchange`.
 *
 * When the device cannot (or will not) go landscape the portrait hint overlay
 * is surfaced through `isPortrait` so the player can be asked to rotate.
 */
export interface LandscapeLock {
  /** True while the viewport is in portrait orientation. */
  isPortrait: boolean;
  /** False once we prove the orientation lock is unsupported (iOS Safari etc.). */
  lockSupported: boolean;
  /**
   * Best-effort: enter fullscreen + request the landscape orientation lock.
   * Pass `true` from a user gesture (Start tap, retry button) so a failure can
   * safely be treated as "this browser cannot lock" — silent mount-time
   * attempts never get a gesture, so they must not flip `lockSupported`.
   */
  lockLandscape: (fromGesture?: boolean) => Promise<void>;
}

/**
 * `ScreenOrientation.lock` is implemented by every modern mobile browser but
 * is absent from some lib.dom typings, so it is declared here.
 */
type LockableOrientation = ScreenOrientation & {
  lock?: (orientation: 'any' | 'natural' | 'landscape' | 'portrait') => Promise<void>;
};

function getOrientation(): LockableOrientation | undefined {
  if (typeof window === 'undefined') return undefined;
  return window.screen?.orientation as LockableOrientation | undefined;
}

function readPortrait(): boolean {
  if (typeof window === 'undefined') return false;
  return window.matchMedia('(orientation: portrait)').matches;
}

function readHandheld(): boolean {
  if (typeof window === 'undefined') return false;
  if (window.matchMedia('(pointer: coarse)').matches) return true;
  return (navigator.maxTouchPoints ?? 0) > 0;
}

export function useLandscapeLock(): LandscapeLock {
  const [isPortrait, setIsPortrait] = useState<boolean>(readPortrait);
  const [lockSupported, setLockSupported] = useState<boolean>(true);

  const tryLock = useCallback(async (): Promise<boolean> => {
    const orientation = getOrientation();
    if (!orientation || typeof orientation.lock !== 'function') return false;
    try {
      await orientation.lock('landscape');
      return true;
    } catch {
      // NotAllowedError outside fullscreen / unsupported UA — escalate below.
      return false;
    }
  }, []);

  const tryFullscreen = useCallback(async (): Promise<void> => {
    const doc = document as Document & { webkitFullscreenElement?: Element };
    const el = document.documentElement as HTMLElement & {
      webkitRequestFullscreen?: () => Promise<void>;
    };
    if (doc.fullscreenElement || doc.webkitFullscreenElement) return;
    try {
      if (typeof el.requestFullscreen === 'function') {
        await el.requestFullscreen({ navigationUI: 'hide' } as FullscreenOptions);
      } else if (typeof el.webkitRequestFullscreen === 'function') {
        await el.webkitRequestFullscreen();
      }
    } catch {
      // Fullscreen refused (no gesture, policy, or desktop embed) — ignore.
    }
  }, []);

  const lockLandscape = useCallback(async (fromGesture = false) => {
    // 1. Direct landscape lock first (allowed without fullscreen on some UAs).
    if (await tryLock()) {
      setLockSupported(true);
      return;
    }

    // 2. Escalate: fullscreen then lock again — the standard Android Chrome path.
    await tryFullscreen();
    const locked = await tryLock();
    if (locked) setLockSupported(true);
    else if (fromGesture) setLockSupported(false);
  }, [tryLock, tryFullscreen]);

  useEffect(() => {
    const sync = () => setIsPortrait(readPortrait());
    sync();

    const media = window.matchMedia('(orientation: portrait)');
    const orientation = getOrientation();

    media.addEventListener?.('change', sync);
    orientation?.addEventListener?.('change', sync);
    window.addEventListener('resize', sync);
    window.addEventListener('orientationchange', sync);

    // Fullscreen entry unlocks the orientation lock — retry immediately.
    const onFullscreen = () => {
      sync();
      void tryLock();
    };
    document.addEventListener('fullscreenchange', onFullscreen);

    if (typeof orientation?.lock !== 'function') setLockSupported(false);

    // Attempt the lock on mount too: harmless when the UA allows it silently.
    void lockLandscape();

    return () => {
      media.removeEventListener?.('change', sync);
      orientation?.removeEventListener?.('change', sync);
      window.removeEventListener('resize', sync);
      window.removeEventListener('orientationchange', sync);
      document.removeEventListener('fullscreenchange', onFullscreen);
    };
  }, [lockLandscape, tryLock]);

  return { isPortrait, lockSupported, lockLandscape };
}

/**
 * The rotate-device hint only makes sense on handheld / narrow viewports, so a
 * tall desktop window is never blocked by it.
 */
export function shouldShowRotateHint(isPortrait: boolean): boolean {
  if (!isPortrait) return false;
  if (typeof window === 'undefined') return false;
  return readHandheld() || window.innerWidth <= 820;
}
