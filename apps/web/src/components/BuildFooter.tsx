import { GitCommit } from "lucide-react";

const buildTime = import.meta.env.VITE_BUILD_TIME;
const commitHash = import.meta.env.VITE_GIT_COMMIT;

export function BuildFooter() {
	return (
		<footer className="shrink-0 px-3 py-1.5 bg-[#0f0b1a] border-t border-[rgba(139,92,246,0.1)]">
			<div className="flex items-center justify-center gap-3 text-[10px] text-[#64748b]">
				{buildTime && <span>Built {buildTime}</span>}
				{commitHash && (
					<div className="flex items-center gap-1">
						<GitCommit className="w-3 h-3" />
						<span className="font-mono">{commitHash}</span>
					</div>
				)}
			</div>
		</footer>
	);
}
