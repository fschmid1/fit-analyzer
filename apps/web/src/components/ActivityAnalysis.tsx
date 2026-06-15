import { useEffect, useState, useRef, useCallback } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { ChevronDown, ChevronUp, RefreshCw, AlertCircle } from "lucide-react";
import { mdComponents } from "../components/trainer/markdownComponents";
import { DotsLoader } from "../components/trainer/DotsLoader";
import { streamActivityAnalysis } from "../lib/api";

interface ActivityAnalysisProps {
	activityId: string;
	initialAnalysis: string | null | undefined;
}

type AnalysisState =
	| { status: "idle" }
	| { status: "streaming"; text: string }
	| { status: "error"; message: string };

export function ActivityAnalysis({
	activityId,
	initialAnalysis,
}: ActivityAnalysisProps) {
	const hasCached = Boolean(initialAnalysis);
	const [expanded, setExpanded] = useState(!hasCached);
	const [analysis, setAnalysis] = useState(initialAnalysis ?? null);
	const [state, setState] = useState<AnalysisState>({ status: "idle" });
	const abortRef = useRef<AbortController | null>(null);
	const hasTriggeredRef = useRef(false);

	const stopStream = useCallback(() => {
		abortRef.current?.abort();
		abortRef.current = null;
	}, []);

	const startStream = useCallback(() => {
		stopStream();
		const controller = new AbortController();
		abortRef.current = controller;
		setState({ status: "streaming", text: "" });
		setExpanded(true);

		streamActivityAnalysis(
			activityId,
			(text) => {
				setState((prev) =>
					prev.status === "streaming" ? { status: "streaming", text } : prev,
				);
			},
			controller.signal,
		)
			.then((final) => {
				setAnalysis(final);
				setState({ status: "idle" });
			})
			.catch((err) => {
				if (controller.signal.aborted) {
					setState({ status: "idle" });
					return;
				}
				setState({
					status: "error",
					message: err instanceof Error ? err.message : "Analysis failed",
				});
			})
			.finally(() => {
				if (abortRef.current === controller) {
					abortRef.current = null;
				}
			});
	}, [activityId, stopStream]);

	useEffect(() => {
		if (!analysis && !hasTriggeredRef.current) {
			hasTriggeredRef.current = true;
			startStream();
		}
		return () => {
			stopStream();
		};
	}, [analysis, startStream, stopStream]);

	const displayText =
		state.status === "streaming"
			? state.text
			: state.status === "error"
				? null
				: analysis;

	const isStreaming = state.status === "streaming";

	return (
		<div className="mx-6 mb-6">
			<div className="relative bg-[#0d0919] border border-[rgba(139,92,246,0.15)] rounded-2xl overflow-hidden">
				<div className="flex items-center justify-between px-4 py-3 bg-[#1a1533]/50 border-b border-[rgba(139,92,246,0.1)]">
					<div className="flex items-center gap-2">
						<p className="text-xs font-medium text-[#94a3b8] uppercase tracking-wider">
							Analysis
						</p>
						{isStreaming && (
							<span className="relative flex h-2 w-2">
								<span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-[#8b5cf6] opacity-75" />
								<span className="relative inline-flex rounded-full h-2 w-2 bg-[#8b5cf6]" />
							</span>
						)}
					</div>
					<div className="flex items-center gap-1">
						<button
							type="button"
							onClick={startStream}
							disabled={isStreaming}
							className="p-2 rounded-lg transition-colors text-[#8b5cf6] hover:bg-[#8b5cf6]/10 disabled:opacity-50 disabled:cursor-not-allowed"
							title="Regenerate analysis"
							aria-label="Regenerate analysis"
						>
							<RefreshCw
								className={`w-4 h-4 ${isStreaming ? "animate-spin" : ""}`}
							/>
						</button>
						<button
							type="button"
							onClick={() => setExpanded((prev) => !prev)}
							className="p-2 rounded-lg transition-colors text-[#94a3b8] hover:text-[#f1f5f9] hover:bg-[#8b5cf6]/10"
							aria-label={expanded ? "Collapse analysis" : "Expand analysis"}
						>
							{expanded ? (
								<ChevronUp className="w-4 h-4" />
							) : (
								<ChevronDown className="w-4 h-4" />
							)}
						</button>
					</div>
				</div>

				{expanded && (
					<div className="p-4">
						{isStreaming && !state.text && (
							<div className="flex items-center gap-2 text-sm text-[#94a3b8]">
								<span>Analyzing your ride</span>
								<DotsLoader />
							</div>
						)}

						{state.status === "error" && (
							<div className="rounded-lg bg-red-500/10 border border-red-500/20 p-3 mb-3">
								<div className="flex items-start gap-2 text-red-400 text-sm">
									<AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
									<div className="flex-1">
										<p className="font-medium">Analysis failed</p>
										<p className="mt-0.5 opacity-90">{state.message}</p>
									</div>
									<button
										type="button"
										onClick={startStream}
										className="shrink-0 px-3 py-1.5 text-xs font-medium rounded-lg bg-red-500/20 text-red-300 hover:bg-red-500/30 transition-colors"
									>
										Retry
									</button>
								</div>
							</div>
						)}

						{displayText && (
							<div
								className={`text-sm leading-relaxed text-[#c4b5fd] ${isStreaming ? "animate-pulse" : ""}`}
							>
								<ReactMarkdown
									remarkPlugins={[remarkGfm]}
									components={mdComponents}
								>
									{displayText}
								</ReactMarkdown>
							</div>
						)}
					</div>
				)}
			</div>
		</div>
	);
}
