import { useCallback } from "react";
import { useDrag } from "@use-gesture/react";
import { useSpring, config } from "@react-spring/web";

const gentle = { ...config.gentle, friction: 26, tension: 210 };
const quick = { ...config.default, friction: 22, tension: 300 };

interface UseSpringScaleOptions {
	scaleDown?: number;
}

export function useSpringScale({
	scaleDown = 0.96,
}: UseSpringScaleOptions = {}) {
	const [style, api] = useSpring(() => ({ scale: 1, config: quick }));

	const onPointerDown = useCallback(() => {
		api.start({ scale: scaleDown });
	}, [api, scaleDown]);

	const onPointerUp = useCallback(() => {
		api.start({ scale: 1 });
	}, [api]);

	const onPointerLeave = useCallback(() => {
		api.start({ scale: 1 });
	}, [api]);

	return { style, onPointerDown, onPointerUp, onPointerLeave };
}

export function usePressSpring({ scaleDown = 0.97 } = {}) {
	const [style, api] = useSpring(() => ({
		scale: 1,
		translateY: 0,
		config: quick,
	}));

	const bind = useCallback(
		(isDown: boolean) => {
			api.start({
				scale: isDown ? scaleDown : 1,
				translateY: isDown ? 1 : 0,
			});
		},
		[api, scaleDown],
	);

	return { style, bind };
}

export function useGestureSpring({ scaleDown = 0.95, dragMax = 8 } = {}) {
	const [style, api] = useSpring(() => ({
		scale: 1,
		x: 0,
		y: 0,
		config: gentle,
	}));

	const handlers = useCallback(
		(state: { active: boolean; offset: [number, number] }) => {
			const { active, offset } = state;
			api.start({
				scale: active ? scaleDown : 1,
				x: active ? Math.max(-dragMax, Math.min(dragMax, offset[0] * 0.1)) : 0,
				y: active ? Math.max(-dragMax, Math.min(dragMax, offset[1] * 0.1)) : 0,
			});
		},
		[api, scaleDown, dragMax],
	);

	const reset = useCallback(() => {
		api.start({ scale: 1, x: 0, y: 0 });
	}, [api]);

	return { style, handlers, reset };
}

/** Lightweight press hook for simple scale effect via @use-gesture/react */
export function useTapScale(
	ref: React.RefObject<HTMLElement | null>,
	scaleDown = 0.96,
) {
	useDrag(
		({ down, cancel }) => {
			const el = ref.current;
			if (!el) return;
			if (down) {
				el.style.transition = "transform 0.08s ease-out";
				el.style.transform = `scale(${scaleDown})`;
			} else {
				el.style.transform = "scale(1)";
				requestAnimationFrame(() => {
					if (el) el.style.transition = "";
				});
			}
			if (cancel) cancel();
		},
		{
			target: ref,
			filterTaps: true,
			preventDefault: false,
			rubberband: false,
		},
	);
}
