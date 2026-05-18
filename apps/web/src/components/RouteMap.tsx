import type { ActivityRecord } from "@fit-analyzer/shared";
import type { LatLngBoundsExpression, LatLngTuple } from "leaflet";
import { ChevronDown, Map as MapIcon } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { MapContainer, Polyline, TileLayer, useMap } from "react-leaflet";

interface Point {
	lat: number;
	lng: number;
	gradient: number;
}

function gradientColor(gradient: number): string {
	if (gradient < 0) return "#22c55e";
	if (gradient < 4) return "#22c55e";
	if (gradient < 8) return "#eab308";
	if (gradient < 12) return "#f97316";
	return "#ef4444";
}

function pointsFromRecords(records: ActivityRecord[]): Point[] {
	const result: Point[] = [];
	for (const r of records) {
		if (r.lat != null && r.lng != null) {
			result.push({ lat: r.lat, lng: r.lng, gradient: r.gradient ?? 0 });
		}
	}
	return result;
}

function pointsForRange(
	records: ActivityRecord[],
	range: [number, number],
): Point[] {
	const [start, end] = range;
	const result: Point[] = [];
	for (const r of records) {
		if (
			r.elapsedSeconds >= start &&
			r.elapsedSeconds <= end &&
			r.lat != null &&
			r.lng != null
		) {
			result.push({ lat: r.lat, lng: r.lng, gradient: r.gradient ?? 0 });
		}
	}
	return result;
}

interface RouteMapProps {
	records: ActivityRecord[];
	selectionRange: [number, number] | null;
}

function FitBounds({ coords }: { coords: LatLngTuple[] }) {
	const map = useMap();
	useEffect(() => {
		if (coords.length >= 2) {
			const bounds = coords as LatLngBoundsExpression;
			map.fitBounds(bounds, { padding: [20, 20] });
		}
	}, [map, coords]);
	return null;
}

export function RouteMap({ records, selectionRange }: RouteMapProps) {
	const [expanded, setExpanded] = useState(true);

	const allPoints = useMemo(() => pointsFromRecords(records), [records]);
	const allCoords: LatLngTuple[] = useMemo(
		() => allPoints.map((p) => [p.lat, p.lng] as LatLngTuple),
		[allPoints],
	);

	const selectedPoints = useMemo(() => {
		if (!selectionRange) return null;
		const pts = pointsForRange(records, selectionRange);
		return pts.length >= 2 ? pts : null;
	}, [records, selectionRange]);

	const hasGps = allPoints.length >= 2;

	const toggle = useCallback(() => setExpanded((prev) => !prev), []);

	if (!hasGps) return null;

	return (
		<>
			<div className="mx-6 mb-4 rounded-xl border border-[rgba(139,92,246,0.1)] overflow-hidden shrink-0">
				<button
					type="button"
					onClick={toggle}
					className="w-full flex items-center justify-between px-4 py-3 bg-[#1a1533] hover:bg-[#241e3d] transition-colors"
				>
					<div className="flex items-center gap-2">
						<MapIcon size={16} stroke="#8b5cf6" />
						<span className="text-sm font-medium text-[#f1f5f9]">Route</span>
						<span className="text-xs text-[#94a3b8]">
							{allPoints.length.toLocaleString()} track points
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
							center={allCoords[0]}
							zoom={13}
							className="h-full w-full"
							zoomControl={false}
						>
							<TileLayer
								url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png"
								attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
							/>
							<FitBounds coords={allCoords} />
							{allPoints.slice(0, -1).map((a, i) => {
								const b = allPoints[i + 1];
								const avgGrad = (a.gradient + b.gradient) / 2;
								return (
									<Polyline
										// biome-ignore lint/suspicious/noArrayIndexKey: immutable segments
										key={`seg-${i}`}
										positions={[
											[a.lat, a.lng],
											[b.lat, b.lng],
										]}
										pathOptions={{
											color: gradientColor(avgGrad),
											weight: 3,
											opacity: 0.85,
										}}
									/>
								);
							})}
							{selectedPoints?.slice(0, -1).map((a, i) => {
								const b = selectedPoints[i + 1];
								const avgGrad = (a.gradient + b.gradient) / 2;
								return (
									<Polyline
										// biome-ignore lint/suspicious/noArrayIndexKey: immutable segments
										key={`sel-${i}`}
										positions={[
											[a.lat, a.lng],
											[b.lat, b.lng],
										]}
										pathOptions={{
											color: gradientColor(avgGrad),
											weight: 5,
											opacity: 1,
										}}
									/>
								);
							})}
						</MapContainer>
					</div>
				)}
			</div>
		</>
	);
}
