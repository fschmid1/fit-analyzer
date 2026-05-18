import type { HeatmapPoint } from "@fit-analyzer/shared";
import { ChevronDown, Map as MapIcon } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { MapContainer, TileLayer, useMap } from "react-leaflet";

interface HeatmapMapProps {
	points: HeatmapPoint[];
}

const BIN_SIZE = 4;
const DOT_RADIUS = 8;

function HeatmapCanvas({ points }: { points: HeatmapPoint[] }) {
	const map = useMap();
	const canvasRef = useRef<HTMLCanvasElement>(null);
	const pointsRef = useRef(points);
	pointsRef.current = points;

	const draw = useCallback(() => {
		const canvas = canvasRef.current;
		if (!canvas) return;
		const ctx = canvas.getContext("2d");
		if (!ctx) return;

		const size = map.getSize();
		canvas.width = size.x;
		canvas.height = size.y;
		canvas.style.width = `${size.x}px`;
		canvas.style.height = `${size.y}px`;

		ctx.clearRect(0, 0, size.x, size.y);

		const bins = new Map<string, number>();
		const pad = BIN_SIZE * 2;
		const pts = pointsRef.current;

		for (const p of pts) {
			const px = map.latLngToContainerPoint([p.lat, p.lng]);
			if (
				px.x < -pad ||
				px.y < -pad ||
				px.x > size.x + pad ||
				px.y > size.y + pad
			) {
				continue;
			}
			const bx = Math.floor(px.x / BIN_SIZE) * BIN_SIZE;
			const by = Math.floor(px.y / BIN_SIZE) * BIN_SIZE;
			const key = `${bx},${by}`;
			bins.set(key, (bins.get(key) ?? 0) + 1);
		}

		if (bins.size === 0) return;

		let maxHits = 1;
		for (const v of bins.values()) {
			if (v > maxHits) maxHits = v;
		}

		for (const [key, hits] of bins) {
			const [bx, by] = key.split(",").map(Number);
			const cx = bx + BIN_SIZE / 2;
			const cy = by + BIN_SIZE / 2;
			const ratio = hits / maxHits;
			const hue = 120 * (1 - ratio);
			const lightness = 55 - ratio * 20;
			const alpha = Math.min(1, ratio * 0.85 + 0.15);
			const color = `hsla(${hue}, 100%, ${lightness}%, ${alpha})`;

			const gradient = ctx.createRadialGradient(cx, cy, 0, cx, cy, DOT_RADIUS);
			gradient.addColorStop(0, color);
			gradient.addColorStop(0.5, color);
			gradient.addColorStop(1, "transparent");

			ctx.fillStyle = gradient;
			ctx.beginPath();
			ctx.arc(cx, cy, DOT_RADIUS, 0, Math.PI * 2);
			ctx.fill();
		}
	}, [map]);

	useEffect(() => {
		const onMove = () => draw();
		map.on("moveend", onMove);
		map.on("zoomend", onMove);

		const resizeObserver = new ResizeObserver(() => {
			draw();
		});
		const container = map.getContainer();
		resizeObserver.observe(container);

		draw();

		return () => {
			map.off("moveend", onMove);
			map.off("zoomend", onMove);
			resizeObserver.disconnect();
		};
	}, [map, draw]);

	// biome-ignore lint/correctness/useExhaustiveDependencies: points triggers re-render
	useEffect(() => {
		draw();
	}, [draw, points]);

	return (
		<canvas
			ref={canvasRef}
			style={{
				position: "absolute",
				top: 0,
				left: 0,
				pointerEvents: "none",
				zIndex: 1000,
				filter: "blur(1px)",
			}}
		/>
	);
}

interface FitBoundsProps {
	points: HeatmapPoint[];
}

function FitBounds({ points }: FitBoundsProps) {
	const map = useMap();
	useEffect(() => {
		if (points.length >= 2) {
			const lats = points.map((p) => p.lat);
			const lngs = points.map((p) => p.lng);
			const bounds: [[number, number], [number, number]] = [
				[Math.min(...lats), Math.min(...lngs)],
				[Math.max(...lats), Math.max(...lngs)],
			];
			map.fitBounds(bounds, { padding: [20, 20] });
		} else if (points.length === 1) {
			map.setView([points[0].lat, points[0].lng], 13);
		}
	}, [map, points]);
	return null;
}

export function HeatmapMap({ points }: HeatmapMapProps) {
	const [expanded, setExpanded] = useState(true);

	if (points.length === 0) return null;

	const toggle = useCallback(() => setExpanded((prev) => !prev), []);

	return (
		<div className="border-y border-[rgba(139,92,246,0.15)] overflow-hidden shrink-0">
			<button
				type="button"
				onClick={toggle}
				className="w-full flex items-center justify-between px-6 py-3 bg-[#1a1533] hover:bg-[#241e3d] transition-colors cursor-pointer"
			>
				<div className="flex items-center gap-2">
					<MapIcon size={16} stroke="#8b5cf6" />
					<span className="text-sm font-medium text-[#f1f5f9]">
						Training Heatmap
					</span>
					<span className="text-xs text-[#94a3b8]">
						{points.length.toLocaleString()} points
					</span>
				</div>
				<ChevronDown
					size={18}
					className={`text-[#94a3b8] transition-transform duration-200 ${expanded ? "rotate-180" : ""}`}
				/>
			</button>
			{expanded && (
				<div className="h-[800px] w-full">
					<MapContainer
						center={[points[0].lat, points[0].lng]}
						zoom={13}
						className="h-full w-full"
						zoomControl={false}
					>
						<TileLayer
							url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png"
							attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
						/>
						<FitBounds points={points} />
						<HeatmapCanvas points={points} />
					</MapContainer>
				</div>
			)}
		</div>
	);
}
