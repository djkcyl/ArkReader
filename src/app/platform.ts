import { invoke, isTauri } from '@tauri-apps/api/core';

declare global {
  interface Window {
    __ARKREADER_PLATFORM__?: string;
  }
}
export const isNative = typeof window !== 'undefined' && isTauri();
export const isMobile =
  isNative &&
  (window.__ARKREADER_PLATFORM__ === 'android' || window.__ARKREADER_PLATFORM__ === 'ios');
export const isDesktop = isNative && !isMobile;
export interface DesktopInfo {
  version: string;
  platform: string;
  library: string;
  displayRecovery?: string | null;
}
export const desktop = {
  info: () => invoke<DesktopInfo>('app_info'),
  openLibrary: () => invoke<void>('app_open_library'),
  playing: (playing: boolean) => invoke<void>('app_playing', { playing }),
};

export function setDesktopPlaying(playing: boolean): void {
  document.dispatchEvent(new CustomEvent('arkreader-playback-state', { detail: { playing } }));
  if (isNative) void desktop.playing(playing).catch(console.error);
}
