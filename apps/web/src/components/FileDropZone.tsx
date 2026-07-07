import { useState, useRef, useCallback } from "react";
import { useDrag } from "@use-gesture/react";
import { useSpring, animated } from "@react-spring/web";
import { Upload, FileWarning, Loader2 } from "lucide-react";
import { parseFit } from "@fit-analyzer/shared";
import type { ParsedActivity } from "@fit-analyzer/shared";

interface FileDropZoneProps {
	onFileParsed: (data: ParsedActivity) => void;
}

export function FileDropZone({ onFileParsed }: FileDropZoneProps) {
	const [isDragging, setIsDragging] = useState(false);
	const [isParsing, setIsParsing] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const inputRef = useRef<HTMLInputElement>(null);
	const dropRef = useRef<HTMLButtonElement>(null);

	const [springStyle, springApi] = useSpring(() => ({
		scale: 1,
		config: { friction: 22, tension: 300 },
	}));

	// Tap gesture feedback for better mobile feel + drag drop feedback
	useDrag(
		({ down }) => {
			if (!dropRef.current || isParsing) return;
			if (down) {
				setIsDragging(true);
				springApi.start({ scale: 0.97, immediate: true });
			} else {
				setIsDragging(false);
				springApi.start({ scale: 1 });
			}
		},
		{
			target: dropRef,
			axis: "x",
			rubberband: false,
			filterTaps: true,
			preventDefault: false,
		},
	);

	const handleFile = useCallback(
		async (file: File) => {
			if (!file.name.toLowerCase().endsWith(".fit")) {
				setError("Please select a .fit file");
				return;
			}

			setError(null);
			setIsParsing(true);
			springApi.start({ scale: 1 });

			try {
				const arrayBuffer = await file.arrayBuffer();
				const data = parseFit(arrayBuffer);
				onFileParsed(data);
			} catch (err) {
				setError(
					err instanceof Error ? err.message : "Failed to parse FIT file",
				);
			} finally {
				setIsParsing(false);
			}
		},
		[onFileParsed, springApi],
	);

	const handleDrop = useCallback(
		(e: React.DragEvent) => {
			e.preventDefault();
			setIsDragging(false);
			if (isParsing) return;

			const file = e.dataTransfer.files[0];
			if (file) handleFile(file);
		},
		[handleFile, isParsing],
	);

	const handleDragOver = useCallback((e: React.DragEvent) => {
		e.preventDefault();
		setIsDragging(true);
	}, []);

	const handleDragLeave = useCallback((e: React.DragEvent) => {
		e.preventDefault();
		setIsDragging(false);
	}, []);

	const handleClick = useCallback(() => {
		if (isParsing) return;
		inputRef.current?.click();
	}, [isParsing]);

	const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
		if (isParsing) return;
		const file = e.target.files?.[0];
		if (file) handleFile(file);
	};

	return (
		<div className="flex-1 flex items-center justify-center p-8">
			<input
				ref={inputRef}
				type="file"
				accept=".fit"
				onChange={handleInputChange}
				className="hidden"
			/>
			<animated.button
				ref={dropRef}
				type="button"
				disabled={isParsing}
				onClick={handleClick}
				onDrop={handleDrop}
				onDragOver={handleDragOver}
				onDragLeave={handleDragLeave}
				style={springStyle}
				className={`
          relative w-full max-w-lg aspect-square flex flex-col items-center justify-center gap-6
          rounded-3xl border-2 border-dashed cursor-pointer
          transition-colors duration-300 ease-out
          ${
						isDragging
							? "border-[#8b5cf6] bg-[#8b5cf6]/10 shadow-[0_0_60px_rgba(139,92,246,0.2)]"
							: "border-[rgba(139,92,246,0.2)] bg-[#1a1533]/30 hover:border-[rgba(139,92,246,0.4)] hover:bg-[#1a1533]/50"
					}
        `}
			>
				{isParsing ? (
					<>
						<Loader2 className="w-16 h-16 text-[#8b5cf6] animate-spin" />
						<p className="text-lg font-medium text-[#f1f5f9]">
							Parsing FIT file...
						</p>
					</>
				) : (
					<>
						<div
							className={`flex items-center justify-center w-20 h-20 rounded-2xl transition-colors duration-300 ${
								isDragging ? "bg-[#8b5cf6]/30" : "bg-[#8b5cf6]/10"
							}`}
						>
							<Upload
								className={`w-10 h-10 transition-all duration-300 ${
									isDragging ? "text-[#8b5cf6] scale-110" : "text-[#8b5cf6]/70"
								}`}
							/>
						</div>
						<div className="text-center">
							<p className="text-lg font-semibold text-[#f1f5f9]">
								Drop your .fit file here
							</p>
							<p className="mt-1 text-sm text-[#94a3b8]">or click to browse</p>
						</div>
					</>
				)}

				{error && (
					<div className="flex items-center gap-2 px-4 py-2 bg-red-500/10 border border-red-500/20 rounded-xl">
						<FileWarning className="w-4 h-4 text-red-400" />
						<p className="text-sm text-red-400">{error}</p>
					</div>
				)}
			</animated.button>
		</div>
	);
}
