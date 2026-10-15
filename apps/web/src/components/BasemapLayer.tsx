import { maplibreGL } from "@maplibre/maplibre-gl-leaflet";
import type { MapOptions } from "leaflet";
import { setWorkerUrl } from "maplibre-gl";
import maplibreWorkerUrl from "maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url";
import { useEffect } from "react";
import { useMap } from "react-leaflet";

/**
 * Key-free vector basemap rendered by MapLibre GL inside the Leaflet maps.
 *
 * CARTO started requiring an API key on its raster basemaps in Sept 2026, which
 * watermarked every `basemaps.cartocdn.com/dark_all` tile. OpenFreeMap serves the
 * same OpenStreetMap/OpenMapTiles data with no key, no quota and no registration.
 */
const BASEMAP_STYLE_URL = "https://tiles.openfreemap.org/styles/dark";

const BASEMAP_ATTRIBUTION = [
	'<a href="https://openfreemap.org" target="_blank" rel="noreferrer">OpenFreeMap</a>',
	'© <a href="https://www.openmaptiles.org/" target="_blank" rel="noreferrer">OpenMapTiles</a>',
	'Data from <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap</a>',
].join(" ");

// MapLibre GL loads its tile worker from a separate module; Vite needs the URL
// handed to it explicitly (see the OpenFreeMap quick start guide).
setWorkerUrl(maplibreWorkerUrl);

/**
 * Map options each basemap-backed map needs. The old CARTO `TileLayer` used to
 * supply a finite max zoom for `fitBounds`; the vector layer does not, so it is
 * pinned here. MapLibre also cannot pan to zoom 0 without losing sync.
 */
export const basemapMapOptions: MapOptions = {
	minZoom: 1,
	maxZoom: 19,
};

/**
 * Adds the OpenFreeMap basemap to the enclosing Leaflet map. Renders nothing of
 * its own: the vector layer is a Leaflet layer, so polylines and markers stack on
 * top of it unchanged.
 */
export function BasemapLayer() {
	const map = useMap();

	useEffect(() => {
		let layer: ReturnType<typeof maplibreGL> | null = null;
		try {
			layer = maplibreGL({
				style: BASEMAP_STYLE_URL,
				// The OpenFreeMap style carries no source attribution, so supply it here.
				attributionControl: { customAttribution: BASEMAP_ATTRIBUTION },
			});
			layer.addTo(map);
		} catch (error) {
			// Without WebGL2 MapLibre cannot render; keep the map usable so the
			// route/heat overlays and interactions still work.
			console.error("Failed to initialize the map basemap", error);
		}
		return () => {
			if (layer) map.removeLayer(layer);
		};
	}, [map]);

	return null;
}
