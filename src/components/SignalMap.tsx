"use client";

import { Map as MapLibreMap, setWorkerUrl, type GeoJSONSource } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { useEffect, useRef, useState } from "react";
import type { LatLng } from "@/lib/geo";
import { OWNER_COLORS } from "./labels";
import type { MapSignal } from "./types";

// Free, keyless vector tiles built on OpenStreetMap.
const MAP_STYLE = "https://tiles.openfreemap.org/styles/liberty";
const HILLSBOROUGH_CENTER: [number, number] = [-74.64, 40.5];

// Served from public/ by scripts/copy-maplibre-worker.mjs.
setWorkerUrl("/maplibre/maplibre-gl-worker.mjs");


type Props = {
  signals: MapSignal[];
  selectedId: string | null;
  userPosition: LatLng | null;
  onSelect: (id: string) => void;
};

function toGeoJSON(signals: MapSignal[], selectedId: string | null): GeoJSON.FeatureCollection {
  return {
    type: "FeatureCollection",
    features: signals.map((s) => ({
      type: "Feature",
      geometry: { type: "Point", coordinates: [s.lng, s.lat] },
      properties: {
        id: s.id,
        ownerType: s.ownerType,
        status: s.status,
        reports: s.recentReports,
        selected: s.id === selectedId,
      },
    })),
  };
}

export default function SignalMap({ signals, selectedId, userPosition, onSelect }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const [ready, setReady] = useState(false);
  const onSelectRef = useRef(onSelect);
  useEffect(() => {
    onSelectRef.current = onSelect;
  }, [onSelect]);

  // Create the map once.
  useEffect(() => {
    if (!containerRef.current) return;
    const map = new MapLibreMap({
      container: containerRef.current,
      style: MAP_STYLE,
      center: HILLSBOROUGH_CENTER,
      zoom: 11.8,
      attributionControl: { compact: true },
    });
    mapRef.current = map;
    // Handy for debugging and automated tests; stripped from production builds.
    if (process.env.NODE_ENV !== "production") (window as unknown as { __map: MapLibreMap }).__map = map;

    map.on("load", () => {
      map.addSource("signals", { type: "geojson", data: toGeoJSON([], null) });
      map.addSource("me", { type: "geojson", data: { type: "FeatureCollection", features: [] } });

      // Red halo whose size grows with the number of open reports.
      map.addLayer({
        id: "signal-halo",
        type: "circle",
        source: "signals",
        filter: ["all", [">", ["get", "reports"], 0], ["!=", ["get", "status"], "fixed"]],
        paint: {
          "circle-color": "#dc2626",
          "circle-opacity": 0.25,
          "circle-radius": ["interpolate", ["linear"], ["get", "reports"], 1, 12, 10, 26],
        },
      });
      map.addLayer({
        id: "signals",
        type: "circle",
        source: "signals",
        paint: {
          "circle-radius": ["interpolate", ["linear"], ["zoom"], 10, ["case", ["get", "selected"], 9, 4], 16, ["case", ["get", "selected"], 13, 8]],
          "circle-color": ["match", ["get", "ownerType"], "state", OWNER_COLORS.state, "county", OWNER_COLORS.county, OWNER_COLORS.municipal],
          "circle-stroke-color": ["case", ["get", "selected"], "#111827", ["==", ["get", "status"], "fixed"], "#16a34a", "#ffffff"],
          "circle-stroke-width": ["case", ["get", "selected"], 3, 1.5],
        },
      });
      map.addLayer({
        id: "me",
        type: "circle",
        source: "me",
        paint: { "circle-radius": 7, "circle-color": "#0ea5e9", "circle-stroke-color": "#fff", "circle-stroke-width": 2 },
      });

      // Dots are small, so accept taps anywhere within ~14 px (a fingertip) and pick the closest.
      map.on("click", (e) => {
        const { x, y } = e.point;
        const hits = map.queryRenderedFeatures(
          [
            [x - 14, y - 14],
            [x + 14, y + 14],
          ],
          { layers: ["signals"] },
        );
        const closest = hits
          .map((f) => ({ f, d: map.project((f.geometry as GeoJSON.Point).coordinates as [number, number]).dist(e.point) }))
          .sort((a, b) => a.d - b.d)[0];
        if (closest) onSelectRef.current(String(closest.f.properties.id));
      });
      map.on("mouseenter", "signals", () => (map.getCanvas().style.cursor = "pointer"));
      map.on("mouseleave", "signals", () => (map.getCanvas().style.cursor = ""));

      setReady(true);
    });

    return () => {
      setReady(false);
      map.remove();
    };
  }, []);

  // Push signal data into the map whenever it changes.
  useEffect(() => {
    if (!ready) return;
    (mapRef.current?.getSource("signals") as GeoJSONSource | undefined)?.setData(toGeoJSON(signals, selectedId));
  }, [ready, signals, selectedId]);

  // Fly to the selected signal.
  useEffect(() => {
    const s = signals.find((x) => x.id === selectedId);
    if (s && mapRef.current) mapRef.current.flyTo({ center: [s.lng, s.lat], zoom: Math.max(mapRef.current.getZoom(), 15.5), padding: { bottom: 280, top: 0, left: 0, right: 0 } });
  }, [selectedId, signals]);

  // Show the user's position.
  useEffect(() => {
    if (!ready || !userPosition) return;
    (mapRef.current?.getSource("me") as GeoJSONSource | undefined)?.setData({
      type: "FeatureCollection",
      features: [{ type: "Feature", geometry: { type: "Point", coordinates: [userPosition.lng, userPosition.lat] }, properties: {} }],
    });
  }, [ready, userPosition]);

  // MapLibre sets `position: relative` on its container, so the absolute positioning lives on a wrapper.
  return (
    <div className="absolute inset-0">
      <div ref={containerRef} className="h-full w-full" aria-label="Map of traffic signals" role="region" />
    </div>
  );
}
