/**
 * Utility to detect if the application is running in a Tauri environment.
 * In Tauri v2, the IPC bridge is injected into window.__TAURI_INTERNALS__.
 */
export const isTauri = () => {
  return typeof window !== 'undefined' && (
    !!window.__TAURI_INTERNALS__ || 
    !!window.__TAURI_IPC__ ||
    !!window.__TAURI__
  );
};

/**
 * Higher-order function to safely execute Tauri-specific calls.
 * @param {Function} tauriFn The Tauri API function to call.
 * @param {*} fallback The value to return if not in Tauri.
 */
export const withTauri = async (tauriFn, fallback = null) => {
  if (isTauri()) {
    try {
      return await tauriFn();
    } catch (err) {
      console.warn('Tauri API call failed even though environment was detected:', err);
      return fallback;
    }
  }
  return fallback;
};
