import type { LatLngBoundsExpression, LatLngTuple } from "leaflet";
import { useEffect, useMemo } from "react";
import { MapContainer, Polyline, TileLayer, useMap } from "react-leaflet";

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

interface EventRouteMapProps {
	coordinates: [number, number][];
}

export function EventRouteMap({ coordinates }: EventRouteMapProps) {
	const coords = useMemo(
		() => coordinates.map(([lat, lng]) => [lat, lng] as LatLngTuple),
		[coordinates],
	);

	if (coords.length < 2) return null;

	return (
		<div className="h-[300px] w-full">
			<MapContainer
				center={coords[0]}
				zoom={13}
				className="h-full w-full"
				zoomControl={false}
			>
				<TileLayer
					url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png"
					attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
				/>
				<FitBounds coords={coords} />
				<Polyline
					positions={coords}
					pathOptions={{ color: "#8b5cf6", weight: 3, opacity: 0.85 }}
				/>
			</MapContainer>
		</div>
	);
}
