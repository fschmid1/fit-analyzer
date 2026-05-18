import type { HeatmapPoint } from "@fit-analyzer/shared";
import L from "leaflet";
import "leaflet.heat";
import { ChevronDown, Map as MapIcon } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { MapContainer, TileLayer, useMap } from "react-leaflet";

type HeatLayer = L.Layer & {
	setLatLngs(latlngs: L.LatLngExpression[]): HeatLayer;
	setOptions(options: Record<string, unknown>): HeatLayer;
	redraw(): HeatLayer;
};

function heatLayer(
	latlngs: L.LatLngExpression[],
	options: Record<string, unknown>,
): HeatLayer {
	// biome-ignore lint/suspicious/noExplicitAny: leaflet.heat has no TS types
	return (L as any).heatLayer(latlngs, options) as HeatLayer;
}

interface HeatmapMapProps {
	points: HeatmapPoint[];
}

function HeatLayerComponent({ points }: { points: HeatmapPoint[] }) {
	const map = useMap();
	const layerRef = useRef<HeatLayer | null>(null);

	// biome-ignore lint/correctness/useExhaustiveDependencies: layer created once, data updated in separate effect
	useEffect(() => {
		const arr: [number, number, number][] = points.map((p) => [
			p.lat,
			p.lng,
			1,
		]);
		const layer = heatLayer(arr, {
			radius: 5,
			blur: 5,
			maxZoom: 16,
			gradient: {
				0.4: "green",
				0.6: "yellow",
				0.8: "orange",
				1.0: "red",
			},
		});
		layer.addTo(map);
		layerRef.current = layer;

		return () => {
			map.removeLayer(layer);
		};
	}, [map]);

	useEffect(() => {
		const layer = layerRef.current;
		if (!layer) return;
		const arr: [number, number, number][] = points.map((p) => [
			p.lat,
			p.lng,
			1,
		]);
		layer.setLatLngs(arr);
	}, [points]);

	return null;
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
						<HeatLayerComponent points={points} />
					</MapContainer>
				</div>
			)}
		</div>
	);
}
