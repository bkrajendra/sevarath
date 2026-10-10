import { useEffect, useRef } from 'react';
import { Marker, Popup } from 'maplibre-gl';
import { useMapLibreMap } from '@/hooks/useMapLibreMap';
import type { components } from '@/types/api';

type CampusLocation = components['schemas']['CampusLocationResponseDto'];

const ACTIVE_COLOR = '#15803d'; // green-700
const INACTIVE_COLOR = '#94a3b8'; // slate-400

function popupHtml(location: CampusLocation): string {
  return `
    <div style="font-family: inherit; font-size: 13px; line-height: 1.4;">
      <div style="font-weight: 600;">${location.name}</div>
      <div>${location.type}</div>
      <div style="color: #64748b;">${location.isActive ? 'Active' : 'Inactive'}</div>
    </div>
  `;
}

/**
 * Renders every campus location as a pin, colored by active state - same MapLibre lifecycle
 * (style/worker-URL) as LiveDriverMap via useMapLibreMap, but static data (no polling) and a
 * different marker shape, so the marker-diffing logic stays separate rather than generalized.
 */
export function CampusLocationsMap({ locations }: { locations: CampusLocation[] }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useMapLibreMap(containerRef);
  const markersRef = useRef<Map<string, Marker>>(new Map());

  useEffect(() => {
    const markers = markersRef.current;
    return () => {
      markers.forEach((marker) => marker.remove());
      markers.clear();
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    const seen = new Set(locations.map((l) => l.id));
    for (const [id, marker] of markersRef.current) {
      if (!seen.has(id)) {
        marker.remove();
        markersRef.current.delete(id);
      }
    }

    for (const location of locations) {
      const existing = markersRef.current.get(location.id);
      const popupNode = document.createElement('div');
      popupNode.innerHTML = popupHtml(location);
      const color = location.isActive ? ACTIVE_COLOR : INACTIVE_COLOR;

      if (existing) {
        existing.setLngLat([location.longitude, location.latitude]);
        existing.getPopup()?.setDOMContent(popupNode);
        existing.getElement().style.backgroundColor = color;
        continue;
      }

      const el = document.createElement('div');
      el.style.width = '14px';
      el.style.height = '14px';
      el.style.borderRadius = '4px';
      el.style.border = '2px solid white';
      el.style.boxShadow = '0 1px 3px rgba(0,0,0,0.4)';
      el.style.backgroundColor = color;

      const marker = new Marker({ element: el })
        .setLngLat([location.longitude, location.latitude])
        .setPopup(new Popup({ offset: 12 }).setDOMContent(popupNode))
        .addTo(map);
      markersRef.current.set(location.id, marker);
    }
  }, [locations, mapRef]);

  return <div ref={containerRef} className="h-[420px] w-full rounded-lg" />;
}
