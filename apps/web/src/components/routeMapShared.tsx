import L, { type LatLngBoundsExpression, type LatLngTuple } from "leaflet";
import { useEffect, useMemo } from "react";
import { Marker, Polyline, useMap } from "react-leaflet";

export function gradientColor(gradient: number): string {
	if (gradient < 0) return "#22c55e";
	if (gradient < 4) return "#22c55e";
	if (gradient < 8) return "#eab308";
	if (gradient < 12) return "#f97316";
	return "#ef4444";
}

export function FitBounds({ coords }: { coords: LatLngTuple[] }) {
	const map = useMap();
	useEffect(() => {
		if (coords.length >= 2) {
			const bounds = coords as LatLngBoundsExpression;
			map.fitBounds(bounds, { padding: [20, 20] });
		}
	}, [map, coords]);
	return null;
}

const EARTH_R = 6371000;

function haversine(a: LatLngTuple, b: LatLngTuple): number {
	const dLat = ((b[0] - a[0]) * Math.PI) / 180;
	const dLng = ((b[1] - a[1]) * Math.PI) / 180;
	const sinDLat = Math.sin(dLat / 2);
	const sinDLng = Math.sin(dLng / 2);
	const aLatRad = (a[0] * Math.PI) / 180;
	const bLatRad = (b[0] * Math.PI) / 180;
	const h =
		sinDLat * sinDLat +
		Math.cos(aLatRad) * Math.cos(bLatRad) * sinDLng * sinDLng;
	return 2 * EARTH_R * Math.asin(Math.sqrt(h));
}

function bearing(a: LatLngTuple, b: LatLngTuple): number {
	const aLat = (a[0] * Math.PI) / 180;
	const bLat = (b[0] * Math.PI) / 180;
	const dLng = ((b[1] - a[1]) * Math.PI) / 180;
	const y = Math.sin(dLng) * Math.cos(bLat);
	const x =
		Math.cos(aLat) * Math.sin(bLat) -
		Math.sin(aLat) * Math.cos(bLat) * Math.cos(dLng);
	return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}

const startIcon = L.divIcon({
	className: "route-anim-marker",
	html: '<div style="width:14px;height:14px;border-radius:50%;background:#22c55e;border:2px solid #0f0b1a;box-shadow:0 0 0 2px rgba(34,197,94,0.4),0 1px 2px rgba(0,0,0,0.6);"></div>',
	iconSize: [14, 14],
	iconAnchor: [7, 7],
});

const endIcon = (heading: number): L.DivIcon =>
	L.divIcon({
		className: "route-anim-end",
		html: `<div style="width:24px;height:24px;display:flex;align-items:center;justify-content:center;transform:rotate(${heading}deg);filter:drop-shadow(0 1px 2px rgba(0,0,0,0.6));"><svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#ef4444" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12 L19 12"/><path d="M13 6 L19 12 L13 18"/></svg></div>`,
		iconSize: [24, 24],
		iconAnchor: [12, 12],
	});

interface DirectionIndicatorsProps {
	coords: LatLngTuple[];
}

export function DirectionIndicators({ coords }: DirectionIndicatorsProps) {
	const {
		start,
		end,
		bearing: endBearing,
	} = useMemo(() => {
		if (coords.length < 2) {
			return { start: null, end: null, bearing: 0 };
		}
		return {
			start: coords[0],
			end: coords[coords.length - 1],
			bearing: bearing(coords[coords.length - 2], coords[coords.length - 1]),
		};
	}, [coords]);

	if (!start || !end) return null;

	return (
		<>
			<Marker position={start} icon={startIcon} interactive={false} />
			<Marker position={end} icon={endIcon(endBearing)} interactive={false} />
		</>
	);
}

interface FlowingRouteOverlayProps {
	coords: LatLngTuple[];
}

export function FlowingRouteOverlay({ coords }: FlowingRouteOverlayProps) {
	if (coords.length < 2) return null;
	return (
		<Polyline
			positions={coords}
			className="route-flow-line"
			pathOptions={{
				color: "#f1f5f9",
				weight: 2,
				opacity: 0.9,
				dashArray: "4 10",
				lineCap: "round",
				lineJoin: "round",
			}}
		/>
	);
}
