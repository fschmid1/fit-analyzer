import { useRef, useState, useMemo } from "react";
import {
	ArrowLeft,
	ArrowRight,
	Check,
	Target,
	Bike,
	Timer,
	Dumbbell,
	Upload,
} from "lucide-react";
import { AVAILABLE_MODELS, type ModelEntry } from "@fit-analyzer/shared";
import { ModelPicker } from "./ModelPicker";

const STEPS = ["Goals", "Fitness", "Limits", "Review"];

interface FormData {
	primaryGoal: string;
	secondaryGoal: string;
	targetDate: string;
	ridesPerWeek: string;
	hoursPerWeek: string;
	trainingDescription: string;
	strengthSessions: string;
	currentFtp: string;
	maxHours: string;
	outdoorRatio: string;
	hrMonitor: boolean;
	powerMeter: boolean;
	cadence: boolean;
}

const INITIAL_FORM: FormData = {
	primaryGoal: "Improving FTP by 20%",
	secondaryGoal: "",
	targetDate: "",
	ridesPerWeek: "3-5",
	hoursPerWeek: "5-10",
	trainingDescription: "",
	strengthSessions: "2",
	currentFtp: "200",
	maxHours: "12",
	outdoorRatio: "70",
	hrMonitor: true,
	powerMeter: true,
	cadence: true,
};

function generatePrompt(form: FormData): string {
	const equipment = [
		"road bike",
		"turbo trainer",
		form.hrMonitor ? "heart rate monitor" : null,
		form.powerMeter ? "power meter" : null,
	]
		.filter(Boolean)
		.join(", ");

	const metrics = [
		form.hrMonitor ? "heart rate" : null,
		form.cadence ? "cadence" : null,
	]
		.filter(Boolean)
		.join(", ");

	const outdoorPct = Number.parseInt(form.outdoorRatio) || 70;
	const indoorPct = 100 - outdoorPct;

	return `I'd like you to become my cycling coach and help me create a customised training plan. Below are details to guide you in designing a plan that fits my goals, timeline, and lifestyle:

I'm an amateur cyclist, not a performance athlete, but I'm looking to improve.
My time for training is limited, so I want a plan that prioritises "bang for buck" workouts—maximising results in the time I can commit.

Format: Provide the plan as a diary with daily workouts, broken down into:
- Indoor Workouts: Include a corresponding Zwift workout that matches the session.
- Outdoor Rides: Keep these simple and enjoyable—no need for constant stat-checking.

In the first two weeks, help me establish performance baselines to track progress.
Limit tests to one per week and keep them trainer-based, as the weather isn't ideal for outdoor testing.
Let me know how to provide weekly feedback so you can adapt the plan as we go.
Present the training plan in a table format for easy reference.
Include clear descriptions of each workout and its purpose (e.g., endurance, power, recovery).
If a workout is Z2 or Z3, give me an indication of the metrics (e.g. power, heart rate or exertion level) that the workout should be done at.

Goals:
- My primary cycling goal is ${form.primaryGoal.toLowerCase()}.${form.secondaryGoal ? `\n- My secondary cycling goal is ${form.secondaryGoal.toLowerCase()}.` : ""}
- I want to achieve this by ${form.targetDate || "[date to be set later]"}.

Current Fitness Level:
- I currently cycle ${form.ridesPerWeek} rides per week and a total time of ${form.hoursPerWeek} hours per week.
- My training consists mainly of ${form.trainingDescription || "easy zone 2 rides with a couple of intervals thrown in"}.
- In addition to cycling, I also strength train about ${form.strengthSessions} times per week.
- My current FTP is ${form.currentFtp} W.

Limitations:
- I can dedicate about ${form.maxHours} hours per week to training.
- The equipment I have available includes ${equipment} and I'd like to train at a ratio of around ${outdoorPct}% outdoor / ${indoorPct}% indoor if the weather allows it.

${metrics ? `Metrics:\n- I track my rides with ${metrics}.\n` : ""}`;
}

export function CoachOnboarding({
	onComplete,
	onImport,
	availableModels,
	defaultModel,
	favorites,
	onToggleFavorite,
}: {
	onComplete: (prompt: string, coachModel: string | null) => void;
	onImport: (file: File) => Promise<void> | void;
	availableModels: ModelEntry[];
	defaultModel: string | null;
	favorites: string[];
	onToggleFavorite: (modelId: string) => void;
}) {
	const [step, setStep] = useState(0);
	const [form, setForm] = useState<FormData>(INITIAL_FORM);
	const [selectedModel, setSelectedModel] = useState<string | null>(null);
	const [importState, setImportState] = useState<
		"idle" | "loading" | "done" | "error"
	>("idle");
	const [importError, setImportError] = useState<string | null>(null);
	const importInputRef = useRef<HTMLInputElement>(null);

	const handleImportFile = (e: React.ChangeEvent<HTMLInputElement>) => {
		const file = e.target.files?.[0];
		e.target.value = "";
		if (!file) return;
		setImportState("loading");
		setImportError(null);
		Promise.resolve()
			.then(() => onImport(file))
			.then(() => {
				setImportState("done");
			})
			.catch((err) => {
				setImportError(err instanceof Error ? err.message : "Import failed");
				setImportState("error");
				setTimeout(() => setImportState("idle"), 5000);
			});
	};

	const update = (field: keyof FormData, value: string | boolean) => {
		setForm((prev) => ({ ...prev, [field]: value }));
	};

	const prompt = useMemo(() => generatePrompt(form), [form]);

	const canNext = () => {
		if (step === 0) return !!form.primaryGoal.trim();
		if (step === 1) return true;
		if (step === 2) return true;
		return true;
	};

	const handleComplete = () => {
		onComplete(prompt, selectedModel);
	};

	const fieldClass =
		"w-full rounded-lg border border-[rgba(139,92,246,0.15)] bg-[#1a1533]/60 px-3 py-2.5 text-sm text-[#f1f5f9] placeholder-[#4a4468] outline-none focus:border-[rgba(139,92,246,0.4)] focus:ring-1 focus:ring-[rgba(139,92,246,0.3)] transition-all";
	const labelClass = "text-xs font-medium text-[#94a3b8] mb-1.5 block";
	const btnPrimaryClass =
		"flex items-center gap-1.5 px-4 py-2 text-sm font-medium rounded-lg bg-[#8b5cf6] hover:bg-[#7c3aed] text-white transition-all duration-200 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed";
	const btnSecondaryClass =
		"flex items-center gap-1.5 px-4 py-2 text-sm font-medium rounded-lg bg-[#1a1533]/70 hover:bg-[#241e3d] border border-[rgba(139,92,246,0.1)] hover:border-[rgba(139,92,246,0.25)] text-[#94a3b8] hover:text-[#c4b5fd] transition-all duration-200 cursor-pointer";
	const toggleClass = (active: boolean) =>
		`px-3 py-2 rounded-lg text-sm font-medium border transition-all duration-200 cursor-pointer ${
			active
				? "bg-[#8b5cf6]/20 border-[#8b5cf6]/40 text-[#c4b5fd]"
				: "bg-[#1a1533]/70 border-[rgba(139,92,246,0.1)] text-[#4a4468] hover:text-[#94a3b8] hover:border-[rgba(139,92,246,0.2)]"
		}`;

	return (
		<div className="flex-1 flex flex-col items-center justify-center px-4 py-8 overflow-y-auto">
			<input
				ref={importInputRef}
				type="file"
				accept=".md,text/markdown,text/plain"
				className="hidden"
				onChange={handleImportFile}
			/>
			<div className="w-full max-w-lg">
				<div className="flex items-center gap-2 mb-8">
					<Bike className="w-5 h-5 text-[#8b5cf6]" />
					<h2 className="text-lg font-semibold text-[#f1f5f9]">Coach Setup</h2>
					<span className="ml-auto text-xs text-[#4a4468]">
						Step {step + 1} of {STEPS.length}
					</span>
				</div>

				<div className="flex gap-1 mb-6">
					{STEPS.map((label, i) => (
						<div
							key={label}
							className={`h-1 flex-1 rounded-full transition-all duration-300 ${
								i <= step ? "bg-[#8b5cf6]" : "bg-[#1a1533]"
							}`}
						/>
					))}
				</div>

				{step === 0 && (
					<div className="space-y-5">
						<p className="text-sm text-[#94a3b8]">
							Tell me what you want to achieve.
						</p>
						<div>
							<label htmlFor="coach-primary-goal" className={labelClass}>
								<Target className="w-3 h-3 inline mr-1" />
								Primary Goal
							</label>
							<select
								id="coach-primary-goal"
								value={form.primaryGoal}
								onChange={(e) => update("primaryGoal", e.target.value)}
								className={fieldClass}
							>
								<option>Improving FTP by 20%</option>
								<option>Improve 5 min power efforts</option>
								<option>Improve endurance for long rides</option>
								<option>Improve sprint power</option>
								<option>Prepare for a specific event</option>
								<option>Lose weight while maintaining fitness</option>
								<option>General fitness improvement</option>
							</select>
						</div>
						<div>
							<label htmlFor="coach-target-date" className={labelClass}>
								Target Date (optional)
							</label>
							<input
								id="coach-target-date"
								type="date"
								value={form.targetDate}
								onChange={(e) => update("targetDate", e.target.value)}
								className={fieldClass}
							/>
						</div>
						<div>
							<label htmlFor="coach-secondary-goal" className={labelClass}>
								Secondary Goal (optional)
							</label>
							<input
								id="coach-secondary-goal"
								type="text"
								value={form.secondaryGoal}
								onChange={(e) => update("secondaryGoal", e.target.value)}
								placeholder="e.g. improve 5 min power, lose 2kg..."
								className={fieldClass}
							/>
						</div>
					</div>
				)}

				{step === 1 && (
					<div className="space-y-5">
						<p className="text-sm text-[#94a3b8]">
							Describe your current fitness level.
						</p>
						<div className="grid grid-cols-2 gap-4">
							<div>
								<label htmlFor="coach-rides-week" className={labelClass}>
									Rides per week
								</label>
								<select
									id="coach-rides-week"
									value={form.ridesPerWeek}
									onChange={(e) => update("ridesPerWeek", e.target.value)}
									className={fieldClass}
								>
									<option>1-2</option>
									<option>3-5</option>
									<option>5-7</option>
									<option>7+</option>
								</select>
							</div>
							<div>
								<label htmlFor="coach-hours-week" className={labelClass}>
									Hours per week
								</label>
								<select
									id="coach-hours-week"
									value={form.hoursPerWeek}
									onChange={(e) => update("hoursPerWeek", e.target.value)}
									className={fieldClass}
								>
									<option>1-3</option>
									<option>3-5</option>
									<option>5-10</option>
									<option>10-15</option>
									<option>15+</option>
								</select>
							</div>
						</div>
						<div>
							<label htmlFor="coach-training-mix" className={labelClass}>
								Training mix
							</label>
							<textarea
								id="coach-training-mix"
								rows={3}
								value={form.trainingDescription}
								onChange={(e) => update("trainingDescription", e.target.value)}
								placeholder="e.g. easy zone 2 rides with a couple of intervals thrown in"
								className={fieldClass}
							/>
						</div>
						<div className="grid grid-cols-2 gap-4">
							<div>
								<label htmlFor="coach-strength" className={labelClass}>
									<Dumbbell className="w-3 h-3 inline mr-1" />
									Strength / week
								</label>
								<select
									id="coach-strength"
									value={form.strengthSessions}
									onChange={(e) => update("strengthSessions", e.target.value)}
									className={fieldClass}
								>
									<option>0</option>
									<option>1</option>
									<option>2</option>
									<option>3+</option>
								</select>
							</div>
							<div>
								<label htmlFor="coach-ftp" className={labelClass}>
									Current FTP (W)
								</label>
								<input
									id="coach-ftp"
									type="number"
									value={form.currentFtp}
									onChange={(e) => update("currentFtp", e.target.value)}
									placeholder="200"
									className={fieldClass}
								/>
							</div>
						</div>
					</div>
				)}

				{step === 2 && (
					<div className="space-y-5">
						<p className="text-sm text-[#94a3b8]">
							Let me know your constraints.
						</p>
						<div>
							<label htmlFor="coach-max-hours" className={labelClass}>
								<Timer className="w-3 h-3 inline mr-1" />
								Max training hours / week
							</label>
							<input
								id="coach-max-hours"
								type="range"
								min="4"
								max="25"
								step="1"
								value={form.maxHours}
								onChange={(e) => update("maxHours", e.target.value)}
								className="w-full accent-[#8b5cf6]"
							/>
							<div className="flex justify-between text-xs text-[#4a4468]">
								<span>4h</span>
								<span className="text-[#8b5cf6] font-medium">
									{form.maxHours}h
								</span>
								<span>25h</span>
							</div>
						</div>
						<div>
							<label htmlFor="coach-outdoor-ratio" className={labelClass}>
								Outdoor / Indoor ratio
							</label>
							<input
								id="coach-outdoor-ratio"
								type="range"
								min="0"
								max="100"
								step="10"
								value={form.outdoorRatio}
								onChange={(e) => update("outdoorRatio", e.target.value)}
								className="w-full accent-[#8b5cf6]"
							/>
							<div className="flex justify-between text-xs text-[#4a4468]">
								<span>All indoor</span>
								<span className="text-[#8b5cf6] font-medium">
									{form.outdoorRatio}% outdoor /{" "}
									{100 - Number.parseInt(form.outdoorRatio)}% indoor
								</span>
								<span>All outdoor</span>
							</div>
						</div>
						<div>
							<span className={labelClass}>Equipment</span>
							<div className="flex flex-wrap gap-2">
								<button
									type="button"
									onClick={() => update("hrMonitor", !form.hrMonitor)}
									className={toggleClass(form.hrMonitor)}
								>
									Heart Rate Monitor
								</button>
								<button
									type="button"
									onClick={() => update("powerMeter", !form.powerMeter)}
									className={toggleClass(form.powerMeter)}
								>
									Power Meter
								</button>
								<button
									type="button"
									onClick={() => update("cadence", !form.cadence)}
									className={toggleClass(form.cadence)}
								>
									Cadence
								</button>
							</div>
						</div>
					</div>
				)}

				{step === 3 && (
					<div className="space-y-4">
						<p className="text-sm text-[#94a3b8]">
							Review your coaching request before sending. Choose a model for
							the first message.
						</p>
						<div className="flex items-center gap-2">
							<span className="text-xs text-[#64748b]">Model:</span>
							<ModelPicker
								currentModel={selectedModel}
								defaultModel={defaultModel}
								availableModels={availableModels}
								onChange={setSelectedModel}
								favorites={favorites}
								onToggleFavorite={onToggleFavorite}
							/>
						</div>
						<div className="rounded-lg border border-[rgba(139,92,246,0.1)] bg-[#1a1533]/40 p-4 max-h-[45vh] overflow-y-auto">
							<pre className="text-xs text-[#94a3b8] whitespace-pre-wrap leading-relaxed font-mono">
								{prompt}
							</pre>
						</div>
					</div>
				)}

				<div className="flex justify-between mt-8">
					<button
						type="button"
						onClick={() => setStep((s) => Math.max(0, s - 1))}
						disabled={step === 0}
						className={btnSecondaryClass}
					>
						<ArrowLeft className="w-4 h-4" />
						Back
					</button>

					{step < 3 ? (
						<button
							type="button"
							onClick={() => setStep((s) => s + 1)}
							disabled={!canNext()}
							className={btnPrimaryClass}
						>
							Next
							<ArrowRight className="w-4 h-4" />
						</button>
					) : (
						<button
							type="button"
							onClick={handleComplete}
							className={btnPrimaryClass}
						>
							<Check className="w-4 h-4" />
							Send to Coach
						</button>
					)}
				</div>

				<div className="mt-4 flex items-center gap-2 justify-center">
					<span className="text-[11px] text-[#4a4468]">or</span>
					<button
						type="button"
						onClick={() => importInputRef.current?.click()}
						disabled={importState === "loading"}
						title="Import a ChatGPT markdown export"
						className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border transition-all duration-200 cursor-pointer disabled:cursor-wait ${
							importState === "done"
								? "bg-emerald-500/10 border-emerald-500/20 text-emerald-400"
								: importState === "error"
									? "bg-rose-500/10 border-rose-500/20 text-rose-400"
									: "bg-[#8b5cf6]/10 border-[#8b5cf6]/20 text-[#c4b5fd] hover:bg-[#8b5cf6]/20 hover:border-[#8b5cf6]/40"
						}`}
					>
						<Upload className="w-3.5 h-3.5" />
						<span>
							{importState === "loading" && "Importing…"}
							{importState === "done" && "Imported!"}
							{importState === "error" && (importError ?? "Error")}
							{importState === "idle" && "Import .md"}
						</span>
					</button>
				</div>
			</div>
		</div>
	);
}
