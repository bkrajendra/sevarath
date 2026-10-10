import { useEffect, useRef } from 'react';
import { Marker, Popup } from 'maplibre-gl';
import { useMapLibreMap } from '@/hooks/useMapLibreMap';
import { formatRelativeTime } from '@/lib/format';
import type { components } from '@/types/api';

type LiveMapDriver = components['schemas']['LiveMapDriverResponseDto'];

const markerColorByAvailability: Record<LiveMapDriver['availability'], string> = {
  AVAILABLE: '#15803d', // green-700
  BUSY: '#b45309', // amber-700
  ON_BREAK: '#b45309',
  OFFLINE: '#64748b', // slate-500
};

function popupHtml(driver: LiveMapDriver): string {
  const ride = driver.activeRideId
    ? `${driver.activeRideStatus} (${driver.activeRideId.slice(0, 8)}…)`
    : 'No active ride';
  return `
    <div style="font-family: inherit; font-size: 13px; line-height: 1.4;">
      <div style="font-weight: 600;">${driver.driverCode}</div>
      <div>${driver.availability}</div>
      <div>${ride}</div>
      <div style="color: #64748b;">Updated ${formatRelativeTime(driver.locationUpdatedAt)}</div>
    </div>
  `;
}

/**
 * Renders every driver from GET /admin/live-map as a colored pin on a real basemap - the map
 * rendering docs/open-items.md #38/#41 explicitly deferred (no reachable tile server at the
 * time), now unblocked by reusing the same public OpenFreeMap style the mobile app already
 * uses for ride screens.
 */
export function LiveDriverMap({ drivers }: { drivers: LiveMapDriver[] }) {
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

    const seen = new Set(drivers.map((d) => d.driverId));
    for (const [driverId, marker] of markersRef.current) {
      if (!seen.has(driverId)) {
        marker.remove();
        markersRef.current.delete(driverId);
      }
    }

    for (const driver of drivers) {
      const existing = markersRef.current.get(driver.driverId);
      const popupNode = document.createElement('div');
      popupNode.innerHTML = popupHtml(driver);

      if (existing) {
        existing.setLngLat([driver.longitude, driver.latitude]);
        existing.getPopup()?.setDOMContent(popupNode);
        existing.getElement().style.backgroundColor = markerColorByAvailability[driver.availability];
        continue;
      }

      const el = document.createElement('div');
      el.style.width = '16px';
      el.style.height = '16px';
      el.style.borderRadius = '50%';
      el.style.border = '2px solid white';
      el.style.boxShadow = '0 1px 3px rgba(0,0,0,0.4)';
      el.style.backgroundColor = markerColorByAvailability[driver.availability];

      const marker = new Marker({ element: el })
        .setLngLat([driver.longitude, driver.latitude])
        .setPopup(new Popup({ offset: 12 }).setDOMContent(popupNode))
        .addTo(map);
      markersRef.current.set(driver.driverId, marker);
    }
  }, [drivers, mapRef]);

  return <div ref={containerRef} className="h-[420px] w-full rounded-lg" />;
}
