/**
 * PHASE 3 5/6 — thin platform bridge.
 *
 * Everything here degrades gracefully: the web build never sees Capacitor,
 * a Capacitor shell without the App plugin falls back to `popstate`, and the
 * screen wake lock is the browser Wake Lock API first (Android WebView
 * exposes it) with the optional Capacitor KeepAwake plugin as a bonus.
 *
 * `backButton` contract: the handler returns TRUE when it consumed the press
 * (it changed something — closed a modal, paused, opened the exit dialog).
 * An unconsumed press is never a dead state: on native it exits the app, on
 * web the history entry is re-armed so the gesture keeps feeding the handler.
 */
import { Capacitor } from '@capacitor/core';
import { App } from '@capacitor/app';

/** Returns true when the press was consumed (a UI change happened). */
export type BackHandler = () => boolean;

let backHandler: BackHandler | null = null;
let popstateInstalled = false;

export function isNativePlatform(): boolean {
  try {
    return Capacitor.isNativePlatform();
  } catch {
    return false;
  }
}

/** True when the native App plugin can actually deliver `backButton`. */
function hasAppPlugin(): boolean {
  try {
    return isNativePlatform() && Capacitor.isPluginAvailable('App');
  } catch {
    return false;
  }
}

function handleBack(): boolean {
  return backHandler ? backHandler() : false;
}

function onPopState(): void {
  handleBack();
  // Re-arm the entry so the browser back gesture never leaves the game —
  // every press lands in handleBack() instead of navigating away.
  try {
    window.history.pushState(null, '', window.location.href);
  } catch {
    // History unavailable (sandboxed frame) — nothing to re-arm.
  }
}

function installPopstateFallback(): void {
  if (popstateInstalled || typeof window === 'undefined') return;
  popstateInstalled = true;
  try {
    window.history.pushState(null, '', window.location.href);
  } catch {
    // Ignore — the listener below still works without an initial entry.
  }
  window.addEventListener('popstate', onPopState);
}

/**
 * Wires the platform back gesture (Android hardware/button back, browser
 * back) to `handler`. Safe to call once at boot; re-calling swaps the
 * handler so React always dispatches through its latest closure.
 */
export async function initBackButton(handler: BackHandler): Promise<void> {
  backHandler = handler;
  // StrictMode (and any re-mount) only rewires the callback — the platform
  // listener is installed exactly once so a press can never fire twice.
  if (backWired) return;
  backWired = true;
  if (hasAppPlugin()) {
    try {
      await App.addListener('backButton', () => {
        const consumed = handleBack();
        if (!consumed) exitApp();
      });
      return;
    } catch {
      // Listener refused — fall through to the browser fallback.
    }
  }
  installPopstateFallback();
}

let backWired = false;

/** Leaves the app (Android) or asks the tab to close (web). */
export function exitApp(): void {
  if (hasAppPlugin()) {
    try {
      void App.exitApp();
      return;
    } catch {
      // Fall through to the web-style close.
    }
  }
  try {
    window.close();
  } catch {
    // Blocked by the browser — the caller shows the "close this tab" hint.
  }
}

/* ------------------------------------------------------------------ */
/* Screen wake lock — keep the phone awake during a run                */
/* ------------------------------------------------------------------ */

let wakeLock: WakeLockSentinel | null = null;
let wakeWanted = false;
let wakeVisibilityHooked = false;
let wakeRequesting = false;

async function requestWakeLock(): Promise<void> {
  if (!wakeWanted || wakeLock || wakeRequesting || typeof navigator === 'undefined') return;
  wakeRequesting = true;
  try {
    const plugins = (Capacitor as unknown as { Plugins?: Record<string, unknown> }).Plugins;
    const keepAwake = plugins?.KeepAwake as { keepOn?: () => Promise<void> } | undefined;
    if (keepAwake && typeof keepAwake.keepOn === 'function') void keepAwake.keepOn();
  } catch {
    // No native plugin — the Wake Lock API below covers it.
  }

  // Browser Wake Lock API (Android WebView / Chrome / Safari 16.4+).
  try {
    if ('wakeLock' in navigator) {
      const sentinel = await navigator.wakeLock.request('screen');
      // Released again while we were waiting — don't strand the screen awake.
      if (!wakeWanted) {
        try {
          await sentinel.release();
        } catch {
          // Already gone.
        }
        return;
      }
      wakeLock = sentinel;
      sentinel.addEventListener('release', () => {
        if (wakeLock === sentinel) wakeLock = null;
      });
    }
  } catch {
    // Unsupported or denied — the screen just behaves as it does today.
    wakeLock = null;
  } finally {
    wakeRequesting = false;
  }
}

async function releaseWakeLock(): Promise<void> {
  try {
    const plugins = (Capacitor as unknown as { Plugins?: Record<string, unknown> }).Plugins;
    const keepAwake = plugins?.KeepAwake as { allowSleep?: () => Promise<void> } | undefined;
    if (keepAwake && typeof keepAwake.allowSleep === 'function') void keepAwake.allowSleep();
  } catch {
    // Ignore.
  }
  if (wakeLock) {
    try {
      await wakeLock.release();
    } catch {
      // Already released.
    }
    wakeLock = null;
  }
}

/**
 * PHASE 3 6 — browser gesture guards: the game owns the whole viewport, so
 * pinch-zoom and double-tap zoom must never fire (iOS Safari ignores
 * `user-scalable=no`, so the events are blocked in JS instead).
 */
export function installTouchGuards(): void {
  if (typeof document === 'undefined') return;
  if (guardHooked) return;
  guardHooked = true;

  const stopGesture = (e: Event) => e.preventDefault();
  document.addEventListener('gesturestart', stopGesture, { passive: false });
  document.addEventListener('gesturechange', stopGesture, { passive: false });
  document.addEventListener('gestureend', stopGesture, { passive: false });

  // Double-tap zoom: suppress only a fast second tap on the SAME element
  // (two quick taps on different buttons still both land). Menu buttons are
  // click-driven, but the controls that matter use touchstart, so gameplay
  // is unaffected.
  let lastTouchEnd = 0;
  let lastTouchTarget: EventTarget | null = null;
  document.addEventListener(
    'touchend',
    (e) => {
      const now = Date.now();
      if (now - lastTouchEnd <= 300 && e.target === lastTouchTarget) e.preventDefault();
      lastTouchEnd = now;
      lastTouchTarget = e.target;
    },
    { passive: false }
  );
  document.addEventListener('dblclick', stopGesture);
}

let guardHooked = false;

/**
 * PHASE 3 6 — hold the screen awake while `on` (a run is live). Browsers
 * drop the lock whenever the page hides, so it is re-requested on return.
 */
export function setScreenAwake(on: boolean): void {
  if (wakeWanted === on) return;
  wakeWanted = on;
  if (on) {
    if (!wakeVisibilityHooked && typeof document !== 'undefined') {
      wakeVisibilityHooked = true;
      document.addEventListener('visibilitychange', () => {
        if (!document.hidden && wakeWanted) void requestWakeLock();
      });
    }
    void requestWakeLock();
  } else {
    void releaseWakeLock();
  }
}
