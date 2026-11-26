import './downloads.css';

const hints = navigator as Navigator & { userAgentData?: { platform: string } };
const userAgent = navigator.userAgent;
const ios =
  /iPhone|iPad|iPod/i.test(userAgent) ||
  (/Mac/i.test(navigator.platform) && navigator.maxTouchPoints > 1);
const system = `${hints.userAgentData?.platform ?? ''} ${navigator.platform} ${userAgent}`;
const platform = /Android/i.test(userAgent)
  ? 'android'
  : ios
    ? null
    : /Windows|Win32|Win64/i.test(system)
      ? 'windows'
      : /Mac/i.test(system)
        ? 'macos'
        : /Linux/i.test(system)
          ? 'linux'
          : null;
const card = platform ? document.querySelector<HTMLElement>(`[data-platform="${platform}"]`) : null;
if (card) {
  card.parentElement!.prepend(card);
  card.classList.add('current-platform');
  card.querySelector<HTMLElement>('.platform-current')!.hidden = false;
}
if (ios) document.getElementById('ios-notice')!.hidden = false;

// Refresh an existing offline shell without starting the resource engine here.
if ('serviceWorker' in navigator) {
  if (navigator.serviceWorker.controller)
    navigator.serviceWorker.addEventListener('controllerchange', () => location.reload(), {
      once: true,
    });
  void navigator.serviceWorker
    .getRegistration()
    .then((registration) => registration?.update())
    .catch(() => {});
}
