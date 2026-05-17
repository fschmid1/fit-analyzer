export const CHART_MARGIN = { top: 5, right: 10, left: 10, bottom: 5 };
export const AXIS_TICK = { fontSize: 11, fill: "#94a3b8" };
export const AXIS_LINE = { stroke: "rgba(139, 92, 246, 0.1)" };
export const TICK_LINE = { stroke: "rgba(139, 92, 246, 0.1)" };
export const POWER_LABEL = {
	value: "W",
	position: "insideTopLeft" as const,
	offset: -5,
	style: { fontSize: 10, fill: "#8b5cf6" },
};
export const HR_CAD_LABEL = {
	value: "bpm / rpm / km/h",
	position: "insideTopRight" as const,
	offset: -5,
	style: { fontSize: 10, fill: "#94a3b8" },
};
export const GRADIENT_LABEL = {
	value: "%",
	position: "insideTopRight" as const,
	offset: -5,
	style: { fontSize: 10, fill: "#10b981" },
};
export const POWER_ACTIVE_DOT = {
	r: 4,
	fill: "#8b5cf6",
	stroke: "#1a1533",
	strokeWidth: 2,
};
export const HR_ACTIVE_DOT = {
	r: 4,
	fill: "#ef4444",
	stroke: "#1a1533",
	strokeWidth: 2,
};
export const CAD_ACTIVE_DOT = {
	r: 4,
	fill: "#06b6d4",
	stroke: "#1a1533",
	strokeWidth: 2,
};
export const SPEED_ACTIVE_DOT = {
	r: 4,
	fill: "#f59e0b",
	stroke: "#1a1533",
	strokeWidth: 2,
};
export const GRADIENT_ACTIVE_DOT = {
	r: 4,
	fill: "#10b981",
	stroke: "#1a1533",
	strokeWidth: 2,
};
export const DEFAULT_INITIAL_WINDOW_SECONDS = 60 * 30;
