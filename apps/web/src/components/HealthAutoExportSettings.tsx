import type {
	HealthAutoExportSettings as HaeSettingsData,
	HealthSource,
} from "@fit-analyzer/shared";
import {
	AlertCircle,
	CheckCircle2,
	Copy,
	Heart,
	Loader2,
	RefreshCw,
	Shield,
	Trash2,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import {
	fetchHaeStatus,
	generateHaeKey,
	clearHaeSettings,
	updateHealthSource,
} from "../lib/api";
import { AnimatedButton } from "./AnimatedButton";

export function HealthAutoExportSettings() {
	const [settings, setSettings] = useState<HaeSettingsData | null>(null);
	const [loading, setLoading] = useState(true);
	const [generating, setGenerating] = useState(false);
	const [clearing, setClearing] = useState(false);
	const [notification, setNotification] = useState<{
		type: "success" | "error";
		message: string;
	} | null>(null);
	const [copied, setCopied] = useState(false);
	const copyTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

	useEffect(() => {
		fetchHaeStatus()
			.then((data) => {
				setSettings({
					apiKey: data.configured ? "••••••••" : null,
					configured: data.configured,
					healthSource: data.healthSource ?? "openwearables",
					lastSyncAt: data.lastSyncAt ?? null,
				});
			})
			.catch((error) => {
				setSettings({
					apiKey: null,
					configured: false,
					healthSource: "openwearables",
					lastSyncAt: null,
				});
				setNotification({
					type: "error",
					message:
						error instanceof Error
							? error.message
							: "Failed to load Health Auto Export settings",
				});
			})
			.finally(() => setLoading(false));
	}, []);

	useEffect(() => {
		if (!notification) return;
		const timeoutId = window.setTimeout(() => setNotification(null), 5000);
		return () => window.clearTimeout(timeoutId);
	}, [notification]);

	const handleGenerateKey = async () => {
		setGenerating(true);
		setNotification(null);
		try {
			const { apiKey } = await generateHaeKey();
			setSettings((prev) =>
				prev
					? {
							...prev,
							apiKey,
							configured: true,
						}
					: null,
			);
			setNotification({
				type: "success",
				message: "API key generated. Copy it now — it won’t be shown again.",
			});
		} catch (error) {
			setNotification({
				type: "error",
				message:
					error instanceof Error ? error.message : "Failed to generate API key",
			});
		} finally {
			setGenerating(false);
		}
	};

	const handleClear = async () => {
		if (!confirm("Clear Health Auto Export data and API key?")) return;
		setClearing(true);
		try {
			await clearHaeSettings();
			setSettings({
				apiKey: null,
				configured: false,
				healthSource: "openwearables",
				lastSyncAt: null,
			});
			setNotification({
				type: "success",
				message: "Health Auto Export cleared.",
			});
		} catch (error) {
			setNotification({
				type: "error",
				message:
					error instanceof Error ? error.message : "Failed to clear settings",
			});
		} finally {
			setClearing(false);
		}
	};

	const handleCopyKey = () => {
		if (!settings?.apiKey || settings.apiKey === "••••••••") return;
		navigator.clipboard.writeText(settings.apiKey).catch(() => {});
		setCopied(true);
		if (copyTimeoutRef.current) clearTimeout(copyTimeoutRef.current);
		copyTimeoutRef.current = setTimeout(() => setCopied(false), 2000);
	};

	const handleSourceChange = async (source: HealthSource) => {
		setSettings((prev) => (prev ? { ...prev, healthSource: source } : prev));
		try {
			await updateHealthSource(source);
		} catch (error) {
			setNotification({
				type: "error",
				message:
					error instanceof Error
						? error.message
						: "Failed to update health source",
			});
		}
	};

	return (
		<div className="flex flex-col gap-4">
			{notification && (
				<div
					className={`flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-medium ${
						notification.type === "success"
							? "bg-emerald-500/10 border border-emerald-500/20 text-emerald-400"
							: "bg-red-500/10 border border-red-500/20 text-red-400"
					}`}
				>
					{notification.type === "success" ? (
						<CheckCircle2 className="w-4 h-4 shrink-0" />
					) : (
						<AlertCircle className="w-4 h-4 shrink-0" />
					)}
					{notification.message}
				</div>
			)}

			<div className="p-5 bg-[#1a1533]/70 border border-[rgba(139,92,246,0.15)] rounded-xl flex flex-col gap-4">
				<div className="flex items-center gap-3">
					<div className="flex items-center justify-center w-10 h-10 rounded-xl bg-emerald-500/10 shrink-0">
						<Heart className="w-5 h-5 text-emerald-300" />
					</div>
					<div className="min-w-0">
						<p className="text-sm font-semibold text-[#f1f5f9]">
							Health Auto Export
						</p>
						<p className="text-xs text-[#94a3b8]">
							Sync Apple Health data via the Health Auto Export app. Provides
							RHR, sleep, HRV, and more for smarter coaching.
						</p>
					</div>
					{loading && (
						<Loader2 className="w-4 h-4 text-[#8b5cf6] animate-spin ml-auto" />
					)}
				</div>

				{!loading && settings && (
					<>
						{/* Health Source Selector */}
						<div className="flex flex-col gap-2">
							<span className="text-xs font-medium text-[#cbd5e1]">
								Health Data Source
							</span>
							<div className="flex gap-2">
								{(
									[
										{ value: "openwearables", label: "OpenWearables" },
										{
											value: "health_auto_export",
											label: "Health Auto Export",
										},
										{ value: "auto", label: "Auto" },
									] as const
								).map((option) => (
									<button
										type="button"
										key={option.value}
										onClick={() =>
											handleSourceChange(option.value as HealthSource)
										}
										className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-colors ${
											settings.healthSource === option.value
												? "bg-[#8b5cf6]/20 text-[#c4b5fd] border border-[#8b5cf6]/30"
												: "bg-[#0f0b1a] text-[#94a3b8] border border-[rgba(139,92,246,0.15)] hover:text-[#cbd5e1]"
										}`}
									>
										{option.label}
									</button>
								))}
							</div>
							<p className="text-xs text-[#64748b]">
								{settings.healthSource === "auto"
									? "Uses whichever source has the most recent data."
									: settings.healthSource === "health_auto_export"
										? "Data will be pulled from Health Auto Export."
										: "Data will be pulled from OpenWearables."}
							</p>
						</div>

						{/* API Key */}
						<div className="flex flex-col gap-2">
							<span className="text-xs font-medium text-[#cbd5e1]">
								API Key
							</span>
							{settings.apiKey ? (
								<div className="flex items-center gap-2">
									<div className="flex items-center gap-2 flex-1 px-3 py-2 text-sm bg-[#0f0b1a] border border-[rgba(139,92,246,0.2)] text-[#f1f5f9] rounded-xl">
										<Shield className="w-4 h-4 text-[#8b5cf6] shrink-0" />
										<span className="font-mono text-xs">{settings.apiKey}</span>
									</div>
									{settings.apiKey !== "••••••••" && (
										<button
											type="button"
											onClick={handleCopyKey}
											className="p-2 rounded-lg bg-[#0f0b1a] border border-[rgba(139,92,246,0.2)] text-[#94a3b8] hover:text-[#f1f5f9] transition-colors"
											title="Copy API key"
										>
											{copied ? (
												<CheckCircle2 className="w-4 h-4 text-emerald-400" />
											) : (
												<Copy className="w-4 h-4" />
											)}
										</button>
									)}
								</div>
							) : (
								<p className="text-xs text-[#94a3b8]">
									No API key configured yet. Generate one to get started.
								</p>
							)}
						</div>

						{/* Last sync */}
						{settings.lastSyncAt && (
							<p className="text-xs text-[#64748b]">
								Last sync: {new Date(settings.lastSyncAt).toLocaleString()}
							</p>
						)}

						{/* Setup instructions */}
						{settings.configured && (
							<div className="flex flex-col gap-2 p-3 bg-[#0f0b1a] rounded-lg border border-[rgba(139,92,246,0.1)]">
								<span className="text-xs font-semibold text-[#cbd5e1]">
									iPhone App Setup
								</span>
								<ol className="text-xs text-[#94a3b8] list-decimal list-inside space-y-1">
									<li>
										Open Health Auto Export → Automations → New Automation →
										REST API
									</li>
									<li>Name: Fit Analyzer</li>
									<li>
										URL:{" "}
										<span className="font-mono text-[#c4b5fd]">
											https://fit.schmid-felix.de/api/health-auto-export
										</span>
									</li>
									<li>
										HTTP Header:{" "}
										<span className="font-mono text-[#c4b5fd]">
											X-API-Key:{" "}
											{settings.apiKey === "••••••••"
												? "••••••••"
												: settings.apiKey}
										</span>
									</li>
									<li>Data Type: Health Metrics</li>
									<li>
										Metrics: RHR, HRV, Respiratory Rate, SpO2, Body Temperature,
										Sleep
									</li>
									<li>Format: JSON, Version 2, Aggregation: ON</li>
									<li>
										Date Range: Since last sync (or Last 365 days for first run)
									</li>
									<li>Batch Requests: ON</li>
								</ol>
							</div>
						)}

						{/* Actions */}
						<div className="flex items-center justify-between gap-3 pt-1 border-t border-[rgba(139,92,246,0.1)]">
							<div className="flex gap-2">
								<AnimatedButton
									onClick={handleGenerateKey}
									disabled={generating}
									className="flex items-center gap-2 px-3 py-2 text-xs font-medium text-[#c4b5fd] bg-[#8b5cf6]/10 hover:bg-[#8b5cf6]/20 border border-[#8b5cf6]/20 hover:border-[#8b5cf6]/40 rounded-xl transition-[color,background-color,border-color] duration-200 cursor-pointer disabled:opacity-50"
								>
									{generating ? (
										<Loader2 className="w-3.5 h-3.5 animate-spin" />
									) : (
										<RefreshCw className="w-3.5 h-3.5" />
									)}
									{settings.apiKey ? "Regenerate Key" : "Generate Key"}
								</AnimatedButton>

								{settings.configured && (
									<AnimatedButton
										onClick={handleClear}
										disabled={clearing}
										className="flex items-center gap-2 px-3 py-2 text-xs font-medium text-red-400 bg-red-500/10 hover:bg-red-500/20 border border-red-500/20 hover:border-red-500/40 rounded-xl transition-[color,background-color,border-color] duration-200 cursor-pointer disabled:opacity-50"
									>
										{clearing ? (
											<Loader2 className="w-3.5 h-3.5 animate-spin" />
										) : (
											<Trash2 className="w-3.5 h-3.5" />
										)}
										Clear
									</AnimatedButton>
								)}
							</div>
						</div>
					</>
				)}
			</div>
		</div>
	);
}
