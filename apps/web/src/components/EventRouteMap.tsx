import type { LatLngTuple } from "leaflet";
import { useMemo } from "react";
import { MapContainer, Polyline, TileLayer } from "react-leaflet";
import {
	DirectionIndicators,
	FitBounds,
	FlowingRouteOverlay,
	gradientColor,
} from "./routeMapShared";

interface Point {
	lat: number;
	lng: number;
	ele: number;
	gradient: number;
}

interface RouteStats {
	points: Point[];
	distanceM: number;
	minEle: number;
	maxEle: number;
	gainM: number;
}

function computeStats(
	coordinates: ([number, number] | [number, number, number])[],
): RouteStats {
	const pts: { lat: number; lng: number; ele: number | null }[] =
		coordinates.map((c) => ({
			lat: c[0],
			lng: c[1],
			ele: c.length >= 3 ? (c[2] ?? null) : null,
		}));

	const hasElevation = pts.some((p) => p.ele != null);
	if (!hasElevation) {
		return {
			points: pts.map((p) => ({ lat: p.lat, lng: p.lng, ele: 0, gradient: 0 })),
			distanceM: 0,
			minEle: 0,
			maxEle: 0,
			gainM: 0,
		};
	}

	const R = 6371000;
	const result: Point[] = [];
	let totalDist = 0;
	let minE = Number.POSITIVE_INFINITY;
	let maxE = Number.NEGATIVE_INFINITY;
	let gain = 0;

	for (let i = 0; i < pts.length; i++) {
		let gradient = 0;
		const curEle = pts[i].ele;
		if (curEle != null) {
			if (curEle < minE) minE = curEle;
			if (curEle > maxE) maxE = curEle;
		}

		if (i > 0) {
			const prevEle = pts[i - 1].ele;
			if (curEle != null && prevEle != null) {
				const a = pts[i - 1];
				const b = pts[i];
				const dLat = ((b.lat - a.lat) * Math.PI) / 180;
				const dLng = ((b.lng - a.lng) * Math.PI) / 180;
				const sinDLat = Math.sin(dLat / 2);
				const sinDLng = Math.sin(dLng / 2);
				const aLatRad = (a.lat * Math.PI) / 180;
				const bLatRad = (b.lat * Math.PI) / 180;
				const horiz =
					R *
					2 *
					Math.asin(
						Math.sqrt(
							sinDLat * sinDLat +
								Math.cos(aLatRad) * Math.cos(bLatRad) * sinDLng * sinDLng,
						),
					);
				totalDist += horiz;
				if (horiz > 0) {
					gradient = ((curEle - prevEle) / horiz) * 100;
				}
				const diff = curEle - prevEle;
				if (diff > 0) gain += diff;
			}
		}
		result.push({
			lat: pts[i].lat,
			lng: pts[i].lng,
			ele: curEle ?? 0,
			gradient,
		});
	}

	return {
		points: result,
		distanceM: totalDist,
		minEle: Number.isFinite(minE) ? minE : 0,
		maxEle: Number.isFinite(maxE) ? maxE : 0,
		gainM: gain,
	};
}

function formatDistance(m: number): string {
	if (m < 1000) return `${Math.round(m)} m`;
	return `${(m / 1000).toFixed(1)} km`;
}

function formatElevation(m: number): string {
	return `${Math.round(m)} m`;
}

interface EventRouteMapProps {
	coordinates: ([number, number] | [number, number, number])[];
}

export function EventRouteMap({ coordinates }: EventRouteMapProps) {
	const stats = useMemo(() => computeStats(coordinates), [coordinates]);
	const coords = useMemo(
		() => stats.points.map((p) => [p.lat, p.lng] as LatLngTuple),
		[stats.points],
	);

	if (coords.length < 2) return null;

	return (
		<div className="h-[300px] w-full relative">
			<MapContainer
				center={coords[0]}
				zoom={13}
				className="h-full w-full"
				zoomControl={false}
				attributionControl={false}
			>
				<TileLayer url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png" />
				<FitBounds coords={coords} />
				{stats.points.slice(0, -1).map((a, i) => {
					const b = stats.points[i + 1];
					const avgGrad = (a.gradient + b.gradient) / 2;
					return (
						<Polyline
							// biome-ignore lint/suspicious/noArrayIndexKey: immutable segments
							key={`g-${i}`}
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
				<FlowingRouteOverlay coords={coords} />
				<DirectionIndicators coords={coords} />
			</MapContainer>
			<div className="absolute bottom-0 right-0 z-[1000] w-16 h-6 bg-[#1a1533]" />
			<div className="absolute bottom-2 left-2 z-[1000] flex gap-3">
				<span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-xs font-medium bg-black/50 text-[#f1f5f9] backdrop-blur-sm border border-white/10">
					{formatDistance(stats.distanceM)}
				</span>
				<span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-xs font-medium bg-black/50 text-[#f1f5f9] backdrop-blur-sm border border-white/10">
					{formatElevation(stats.gainM)} D+
				</span>
				<span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-xs font-medium bg-black/50 text-[#f1f5f9] backdrop-blur-sm border border-white/10">
					{formatElevation(stats.minEle)}–{formatElevation(stats.maxEle)}
				</span>
			</div>
		</div>
	);
}
