import { useSpring, animated } from "@react-spring/web";

export interface AnimatedButtonProps
	extends React.ButtonHTMLAttributes<HTMLButtonElement> {}

export function AnimatedButton({
	className,
	children,
	...props
}: AnimatedButtonProps) {
	const [spring, api] = useSpring(() => ({
		scale: 1,
		config: { friction: 22, tension: 300 },
	}));

	return (
		<animated.button
			type="button"
			className={className}
			style={spring}
			onPointerDown={() => api.start({ scale: 0.96, immediate: true })}
			onPointerUp={() => api.start({ scale: 1 })}
			onPointerLeave={() => api.start({ scale: 1 })}
			onPointerCancel={() => api.start({ scale: 1 })}
			{...props}
		>
			{children}
		</animated.button>
	);
}
