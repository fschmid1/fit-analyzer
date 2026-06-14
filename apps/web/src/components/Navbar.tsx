import {
	BarChart3,
	BotMessageSquare,
	Calendar,
	History,
	Settings,
	Upload,
} from "lucide-react";
import { useMatch, useNavigate } from "react-router-dom";
import { AnimatedButton } from "./AnimatedButton";

function navClass(active: boolean, iconOnly = false): string {
	const base =
		"flex items-center gap-2 text-sm font-medium rounded-lg transition-colors duration-200 cursor-pointer";
	const size = iconOnly ? "justify-center w-9 h-9" : "px-2 py-2 sm:px-4";
	if (active) {
		return `${base} ${size} text-[#c4b5fd] bg-[#8b5cf6]/20 border border-[#8b5cf6]/30`;
	}
	return `${base} ${size} text-[#94a3b8] hover:text-[#f1f5f9] bg-[#1a1533]/70 hover:bg-[#241e3d] border border-[rgba(139,92,246,0.1)] hover:border-[rgba(139,92,246,0.25)]`;
}

interface NavbarProps {
	onUploadNew: () => void;
	onOpenTrainer: () => void;
}

export function Navbar({ onUploadNew, onOpenTrainer }: NavbarProps) {
	const navigate = useNavigate();
	const isHome = useMatch("/");
	const isAnalysis = useMatch("/activity/:id");
	const isTrainer = useMatch("/trainer/:threadId?");
	const isStats = useMatch("/stats");
	const isEvents = useMatch("/events");
	const isSettings = useMatch("/settings");

	const showUpload = !!isAnalysis;

	return (
		<div className="flex items-center gap-2 sm:gap-3">
			<AnimatedButton
				onClick={() => navigate("/")}
				className={navClass(Boolean(isHome))}
				title="History"
			>
				<History className="w-4 h-4" />
				<span className="hidden sm:inline">History</span>
			</AnimatedButton>

			{showUpload && (
				<AnimatedButton
					onClick={onUploadNew}
					className={navClass(false)}
					title="Load New File"
				>
					<Upload className="w-4 h-4" />
					<span className="hidden sm:inline">Load New File</span>
				</AnimatedButton>
			)}

			<AnimatedButton
				onClick={onOpenTrainer}
				className={navClass(Boolean(isTrainer))}
				title="Trainer"
			>
				<BotMessageSquare className="w-4 h-4" />
				<span className="hidden sm:inline">Trainer</span>
			</AnimatedButton>

			<AnimatedButton
				onClick={() => navigate("/stats")}
				className={navClass(Boolean(isStats))}
				title="Stats"
			>
				<BarChart3 className="w-4 h-4" />
				<span className="hidden sm:inline">Stats</span>
			</AnimatedButton>

			<AnimatedButton
				onClick={() => navigate("/events")}
				className={navClass(Boolean(isEvents))}
				title="Events"
			>
				<Calendar className="w-4 h-4" />
				<span className="hidden sm:inline">Events</span>
			</AnimatedButton>

			<AnimatedButton
				onClick={() => navigate("/settings")}
				className={navClass(Boolean(isSettings), true)}
				title="Settings"
			>
				<Settings className="w-4 h-4" />
			</AnimatedButton>
		</div>
	);
}
