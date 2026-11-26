import { invoke, isTauri } from '@tauri-apps/api/core';

declare global {
  interface Window {
    __ARKREADER_PLATFORM__?: string;
    __ARKREADER_WEB__?: { invoke<T>(command: string, args?: Record<string, unknown>): Promise<T> };
  }
}
export const isNative = typeof window !== 'undefined' && isTauri();
export const isWeb = import.meta.env.VITE_RUNTIME === 'web';
export const isMobile =
  (isNative &&
    (window.__ARKREADER_PLATFORM__ === 'android' || window.__ARKREADER_PLATFORM__ === 'ios')) ||
  (isWeb && matchMedia('(pointer: coarse)').matches);
export const isDesktop = isNative && !isMobile;
export function appInvoke<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  return isWeb ? window.__ARKREADER_WEB__!.invoke<T>(command, args) : invoke<T>(command, args);
}
export interface DesktopInfo {
  version: string;
  platform: string;
  library: string;
  displayRecovery?: string | null;
}
export const desktop = {
  info: () => appInvoke<DesktopInfo>('app_info'),
  openLibrary: () => appInvoke<void>('app_open_library'),
  playing: (playing: boolean) => appInvoke<void>('app_playing', { playing }),
};

export function setDesktopPlaying(playing: boolean): void {
  document.dispatchEvent(new CustomEvent('arkreader-playback-state', { detail: { playing } }));
  if (isNative || isWeb) void desktop.playing(playing).catch(console.error);
}
