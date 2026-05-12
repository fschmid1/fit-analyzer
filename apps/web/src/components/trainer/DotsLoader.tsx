export function DotsLoader() {
	return (
		<span className="flex gap-1 items-center h-5">
			<span className="w-1.5 h-1.5 rounded-full bg-[#8b5cf6] animate-bounce [animation-delay:0ms]" />
			<span className="w-1.5 h-1.5 rounded-full bg-[#8b5cf6] animate-bounce [animation-delay:150ms]" />
			<span className="w-1.5 h-1.5 rounded-full bg-[#8b5cf6] animate-bounce [animation-delay:300ms]" />
		</span>
	);
}
