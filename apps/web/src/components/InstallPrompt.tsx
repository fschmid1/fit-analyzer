import { Share, X } from "lucide-react";
import { useEffect, useState, useRef, useCallback } from "react";
import { useDrag } from "@use-gesture/react";
import { useSpring, animated } from "@react-spring/web";

const IOS_INSTALL_PROMPT_DISMISSED =
	"fit-analyzer-ios-install-prompt-dismissed";

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
		/* ignore */
	}
}

export function InstallPrompt() {
	const [isVisible, setIsVisible] = useState(false);
	const containerRef = useRef<HTMLDivElement>(null);
	const [springStyle, springApi] = useSpring(() => ({
		y: 100,
		opacity: 0,
		config: { friction: 26, tension: 300 },
	}));

	useEffect(() => {
		if (!isAppleMobileDevice() || isStandalone() || hasDismissedPrompt())
			return;

		const timeout = window.setTimeout(() => {
			setIsVisible(true);
			springApi.start({ y: 0, opacity: 1 });
		}, 1200);
		return () => window.clearTimeout(timeout);
	}, [springApi]);

	const handleDismiss = useCallback(() => {
		springApi.start({ y: 120, opacity: 0 });
		const timeout = window.setTimeout(() => {
			dismissPrompt();
			setIsVisible(false);
		}, 220);
		return () => window.clearTimeout(timeout);
	}, [springApi]);

	// Swipe down to dismiss
	useDrag(
		({
			active,
			movement: [_, my],
			velocity: [__, vy],
			direction: [___, dy],
			cancel,
		}) => {
			const threshold = 80;
			const velocityThreshold = 0.5;

			if (!active) {
				if (dy > 0 && (my > threshold || Math.abs(vy) > velocityThreshold)) {
					handleDismiss();
				} else {
					springApi.start({ y: 0, opacity: 1 });
				}
			} else {
				if (dy > 0) {
					springApi.start({
						y: Math.max(0, my),
						opacity: 1 - my / 200,
						immediate: true,
					});
				}
			}
			if (cancel) cancel();
		},
		{
			target: containerRef,
			axis: "y",
			bounds: { top: 0, bottom: 200 },
			rubberband: true,
		},
	);

	if (!isVisible) return null;

	return (
		<animated.div
			ref={containerRef}
			style={{ touchAction: "pan-x", ...springStyle }}
			className="fixed inset-x-3 bottom-3 z-[60] sm:hidden"
		>
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
		</animated.div>
	);
}
