import { invoke } from '@tauri-apps/api/core';
import { isMobile } from './platform';

let mounted = false;
export function mountMobilePlatform(): void {
  if (!isMobile || mounted) return;
  mounted = true;
  document.body.classList.add('mobile-app');
  const applyInsets = (values: Record<string, number>) => {
    for (const edge of ['top', 'right', 'bottom', 'left']) {
      const value = Math.max(0, Number(values[edge]) || 0);
      document.documentElement.style.setProperty(`--safe-${edge}`, `${value}px`);
    }
  };
  window.addEventListener('arkreader-insets', (event) => {
    applyInsets((event as CustomEvent<Record<string, number>>).detail);
  });
  const viewport = () => {
    const height = window.visualViewport?.height ?? window.innerHeight;
    document.documentElement.style.setProperty('--mobile-height', `${height}px`);
  };
  viewport();
  window.visualViewport?.addEventListener('resize', viewport);
  window.addEventListener('resize', viewport);
  void invoke<Record<string, number>>('app_insets').then(applyInsets).catch(console.warn);
}
