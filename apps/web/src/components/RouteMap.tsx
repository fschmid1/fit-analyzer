import { useState, useMemo, useCallback } from "react";
import { MapContainer, TileLayer, Polyline, useMap } from "react-leaflet";
import type { LatLngBoundsExpression, LatLngTuple } from "leaflet";
import type { ActivityRecord } from "@fit-analyzer/shared";
import { ChevronDown, Map as MapIcon } from "lucide-react";

interface RouteMapProps {
	records: ActivityRecord[];
	selectionRange: [number, number] | null;
}

function coordsFromRecords(records: ActivityRecord[]): {
	all: LatLngTuple[];
	selected: LatLngTuple[] | null;
} {
	const all: LatLngTuple[] = [];
	for (const r of records) {
		if (r.lat != null && r.lng != null) {
			all.push([r.lat, r.lng]);
		}
	}
	return { all, selected: null };
}

function coordsForRange(
	records: ActivityRecord[],
	range: [number, number],
): LatLngTuple[] {
	const [start, end] = range;
	const result: LatLngTuple[] = [];
	for (const r of records) {
		if (
			r.elapsedSeconds >= start &&
			r.elapsedSeconds <= end &&
			r.lat != null &&
			r.lng != null
		) {
			result.push([r.lat, r.lng]);
		}
	}
	return result;
}

function FitBounds({ coords }: { coords: LatLngTuple[] }) {
	const map = useMap();
	if (coords.length >= 2) {
		const bounds = coords as LatLngBoundsExpression;
		map.fitBounds(bounds, { padding: [20, 20] });
	}
	return null;
}

export function RouteMap({ records, selectionRange }: RouteMapProps) {
	const [expanded, setExpanded] = useState(false);

	const allCoords = useMemo(() => {
		const result: LatLngTuple[] = [];
		for (const r of records) {
			if (r.lat != null && r.lng != null) {
				result.push([r.lat, r.lng]);
			}
		}
		return result;
	}, [records]);

	const selectedCoords = useMemo(() => {
		if (!selectionRange) return null;
		const coords = coordsForRange(records, selectionRange);
		return coords.length >= 2 ? coords : null;
	}, [records, selectionRange]);

	const hasGps = allCoords.length >= 2;

	const toggle = useCallback(() => setExpanded((prev) => !prev), []);

	if (!hasGps) return null;

	return (
		<div className="mx-6 mb-4 rounded-xl border border-[rgba(139,92,246,0.1)] overflow-hidden">
			<button
				type="button"
				onClick={toggle}
				className="w-full flex items-center justify-between px-4 py-3 bg-[#1a1533] hover:bg-[#241e3d] transition-colors"
			>
				<div className="flex items-center gap-2">
					<MapIcon size={16} stroke="#8b5cf6" />
					<span className="text-sm font-medium text-[#f1f5f9]">Route</span>
					<span className="text-xs text-[#94a3b8]">
						{allCoords.length.toLocaleString()} track points
					</span>
				</div>
				<ChevronDown
					size={18}
					className={`text-[#94a3b8] transition-transform duration-200 ${expanded ? "rotate-180" : ""}`}
				/>
			</button>
			{expanded && (
				<div className="h-[300px] w-full">
					<MapContainer
						center={allCoords[0]}
						zoom={13}
						className="h-full w-full"
						zoomControl={false}
						attributionControl={false}
					>
						<TileLayer
							url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png"
							attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
						/>
						<FitBounds coords={allCoords} />
						<Polyline
							positions={allCoords}
							pathOptions={{
								color: "#8b5cf6",
								weight: 3,
								opacity: 0.35,
							}}
						/>
						{selectedCoords && (
							<Polyline
								positions={selectedCoords}
								pathOptions={{
									color: "#a78bfa",
									weight: 4,
									opacity: 0.9,
								}}
							/>
						)}
					</MapContainer>
				</div>
			)}
		</div>
	);
}
