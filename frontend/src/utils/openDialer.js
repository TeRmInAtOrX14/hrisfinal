import toast from 'react-hot-toast';

/**
 * Triggers the Brandigade Dialer app on desktop if installed via custom protocol,
 * falling back gracefully to opening https://dialer.brandigade.com in a new browser tab.
 */
export const openBrandigadeDialer = () => {
  const webDialerUrl = 'https://dialer.brandigade.com';
  const appProtocolUrl = 'brandigadedialer://';

  let desktopAppResponded = false;

  const onWindowBlur = () => {
    desktopAppResponded = true;
  };

  window.addEventListener('blur', onWindowBlur);

  // Attempt desktop protocol via hidden iframe
  const iframe = document.createElement('iframe');
  iframe.style.display = 'none';
  iframe.src = appProtocolUrl;
  document.body.appendChild(iframe);

  toast.success('Launching Brandigade Dialer...', { duration: 2000, id: 'dialer-launch' });

  setTimeout(() => {
    try {
      if (document.body.contains(iframe)) {
        document.body.removeChild(iframe);
      }
    } catch {
      // The iframe may already be gone; nothing to clean up.
    }

    window.removeEventListener('blur', onWindowBlur);

    if (!desktopAppResponded) {
      // App protocol didn't switch focus, open dialer in Chrome browser
      window.open(webDialerUrl, '_blank', 'noopener,noreferrer');
    }
  }, 1000);
};
