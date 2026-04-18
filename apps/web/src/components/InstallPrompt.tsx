import { Share, X } from "lucide-react";
import { useEffect, useState } from "react";

const IOS_INSTALL_PROMPT_DISMISSED = "fit-analyzer-ios-install-prompt-dismissed";

interface NavigatorWithStandalone extends Navigator {
  standalone?: boolean;
}

function isAppleMobileDevice() {
  const ua = window.navigator.userAgent;
  const platform = window.navigator.platform;

  return (
    /iPad|iPhone|iPod/.test(ua) ||
    (platform === "MacIntel" && window.navigator.maxTouchPoints > 1)
  );
}

function isStandalone() {
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    (window.navigator as NavigatorWithStandalone).standalone === true
  );
}

function hasDismissedPrompt() {
  try {
    return localStorage.getItem(IOS_INSTALL_PROMPT_DISMISSED) === "1";
  } catch {
    return false;
  }
}

function dismissPrompt() {
  try {
    localStorage.setItem(IOS_INSTALL_PROMPT_DISMISSED, "1");
  } catch {
    // Ignore storage failures, for example private browsing restrictions.
  }
}

export function InstallPrompt() {
  const [isVisible, setIsVisible] = useState(false);

  useEffect(() => {
    if (!isAppleMobileDevice() || isStandalone() || hasDismissedPrompt()) return;

    const timeout = window.setTimeout(() => setIsVisible(true), 1200);
    return () => window.clearTimeout(timeout);
  }, []);

  if (!isVisible) return null;

  const handleDismiss = () => {
    dismissPrompt();
    setIsVisible(false);
  };

  return (
    <div className="fixed inset-x-3 bottom-3 z-[60] sm:hidden">
      <div className="rounded-2xl border border-[#8b5cf6]/25 bg-[#17122b]/95 p-4 shadow-2xl shadow-black/40 backdrop-blur">
        <div className="flex items-start gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[#8b5cf6]/20 text-[#c4b5fd]">
            <Share className="h-5 w-5" />
          </div>

          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold text-[#f1f5f9]">
              Install FIT Analyzer
            </p>
            <p className="mt-1 text-xs leading-5 text-[#94a3b8]">
              On iPhone, tap Share, then Add to Home Screen. Apple does not show
              an automatic install prompt.
            </p>
          </div>

          <button
            type="button"
            onClick={handleDismiss}
            className="rounded-lg p-1.5 text-[#94a3b8] transition-colors hover:bg-white/5 hover:text-[#f1f5f9]"
            aria-label="Dismiss install instructions"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>
    </div>
  );
}
