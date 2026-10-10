import { useEffect, useRef, type RefObject } from 'react';
import { Map as MapLibreMap, NavigationControl, setWorkerUrl } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';

// maplibre-gl's default worker-loading strategy expects a sibling
// `maplibre-gl-worker.mjs` file next to wherever its own bundled module ends up being served
// from (derived from `import.meta.url`) - Vite/Rollup's single-chunk build for this app never
// emits that file, so the request 404s, and this app's SPA-fallback nginx config
// (`try_files ... /index.html`) turns that 404 into a 200 of index.html's HTML, which the
// browser then fails to parse as a worker module ("Worker failed to load. Check that the
// worker URL is correct."). Pointing it at the CDN build for the exact pinned version sidesteps
// needing a custom Vite copy step - bump this string together with the `maplibre-gl` version
// in package.json. Module-level (not inside the hook) since it's a one-time global config call,
// not something that should re-run per map instance.
setWorkerUrl('https://unpkg.com/maplibre-gl@6.13.0/dist/maplibre-gl-worker.mjs');

// Same public OpenFreeMap style the mobile app's CampusMapPreview uses
// (campus_map_preview.dart) - no self-hosted Martin tile server is reachable from a browser yet
// (docs/open-items.md #38/#41), but this public style already gives a real basemap
// (roads/buildings/land use).
export const MAP_STYLE_URL = 'https://tiles.openfreemap.org/styles/liberty';
// Diamond Hall Shanti Van, Abu Road - the actual campus this app is built for
// (apps/api/src/db/seed.ts's own named-location entry for this exact building). MapLibre wants
// [lng, lat], the reverse of how this coordinate is recorded everywhere else in this codebase.
export const DEFAULT_MAP_CENTER: [number, number] = [72.7947805, 24.5313075];
export const DEFAULT_MAP_ZOOM = 15.5;

/**
 * Creates and tears down a MapLibre map instance bound to `containerRef`, with this app's
 * shared style/worker-URL setup. Returns a ref (not state) to the map instance so a consumer's
 * own marker-diffing effect can read `mapRef.current` without re-running on every render - same
 * pattern `live-driver-map.tsx` already used before this was extracted; only the lifecycle
 * plumbing is shared here, marker rendering stays per-component since drivers and campus
 * locations need different marker shapes/popups.
 */
export function useMapLibreMap(
  containerRef: RefObject<HTMLDivElement | null>,
  options?: { center?: [number, number]; zoom?: number },
): RefObject<MapLibreMap | null> {
  const mapRef = useRef<MapLibreMap | null>(null);
  const center = options?.center ?? DEFAULT_MAP_CENTER;
  const zoom = options?.zoom ?? DEFAULT_MAP_ZOOM;

  useEffect(() => {
    if (!containerRef.current) return;
    const map = new MapLibreMap({
      container: containerRef.current,
      style: MAP_STYLE_URL,
      center,
      zoom,
    });
    map.addControl(new NavigationControl({ showCompass: false }), 'top-right');
    mapRef.current = map;

    return () => {
      map.remove();
      mapRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return mapRef;
}
