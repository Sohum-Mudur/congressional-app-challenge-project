"use client";

import { Map as MapLibreMap, Marker, setWorkerUrl, type GeoJSONSource } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { useEffect, useRef, useState } from "react";
import { OWNER_COLORS } from "./labels";
import type { MapSignal } from "./types";
import type { LivePosition } from "./useLiveLocation";

// Free, keyless vector tiles built on OpenStreetMap.
const MAP_STYLE = "https://tiles.openfreemap.org/styles/liberty";
const HILLSBOROUGH_CENTER: [number, number] = [-74.64, 40.5];

// Served from public/ by scripts/copy-maplibre-worker.mjs.
setWorkerUrl("/maplibre/maplibre-gl-worker.mjs");


/** Keeps the user's dot above the bottom sheet when the map centers on it. */
const SHEET_PADDING = { bottom: 280, top: 0, left: 0, right: 0 };

type Props = {
  signals: MapSignal[];
  selectedId: string | null;
  userPosition: LivePosition | null;
  heading: number | null;
  onSelect: (id: string) => void;
  /** Turn on live location; called when the "follow me" button is tapped. */
  onLocate: () => void;
};

/** MapLibre uses 512 px tiles: meters per pixel at zoom 0, before latitude correction. */
const METERS_PER_PIXEL_Z0 = 40_075_016.686 / 512;

function accuracyCircle(p: LivePosition): GeoJSON.FeatureCollection {
  return {
    type: "FeatureCollection",
    features: [{ type: "Feature", geometry: { type: "Point", coordinates: [p.lng, p.lat] }, properties: {} }],
  };
}

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

export default function SignalMap({ signals, selectedId, userPosition, heading, onSelect, onLocate }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const meMarkerRef = useRef<Marker | null>(null);
  const [ready, setReady] = useState(false);
  const [bearing, setBearing] = useState(0);
  // "Follow me" stays on until the user drags the map or picks a different light.
  const [follow, setFollow] = useState<{ on: boolean; selectedAtStart: string | null }>({ on: false, selectedAtStart: null });
  const following = follow.on && follow.selectedAtStart === selectedId;
  // Where the camera is heading while following. GPS updates arrive faster than animations finish,
  // so each update aims for this target instead of wherever the previous animation got to.
  const followView = useRef<{ zoom: number; bearing: number } | null>(null);
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
      map.addSource("me-accuracy", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
      // Soft circle showing how precise the GPS fix is (big when GPS is weak, e.g. indoors).
      map.addLayer({
        id: "me-accuracy",
        type: "circle",
        source: "me-accuracy",
        paint: { "circle-color": "#0a84ff", "circle-opacity": 0.12, "circle-stroke-color": "#0a84ff", "circle-stroke-opacity": 0.3, "circle-stroke-width": 1, "circle-radius": 0 },
      });

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
      // The blue dot with a direction cone, like Google Maps. An HTML marker so it can rotate smoothly.
      const el = document.createElement("div");
      el.className = "me-marker";
      el.innerHTML = '<div class="me-cone"></div><div class="me-dot"></div>';
      meMarkerRef.current = new Marker({ element: el, rotationAlignment: "map", pitchAlignment: "map" });

      // Dragging the map means "let me look around", so stop following.
      map.on("dragstart", () => setFollow({ on: false, selectedAtStart: null }));
      map.on("rotate", () => setBearing(map.getBearing()));
      // Respect the user's own pinch-zoom or twist while following.
      map.on("zoomend", (e) => {
        if (e.originalEvent && followView.current) followView.current.zoom = map.getZoom();
      });
      map.on("rotateend", (e) => {
        if (e.originalEvent && followView.current) followView.current.bearing = map.getBearing();
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
    if (s && mapRef.current) mapRef.current.flyTo({ center: [s.lng, s.lat], zoom: Math.max(mapRef.current.getZoom(), 15.5), padding: SHEET_PADDING });
  }, [selectedId, signals]);

  // Move the blue dot and its accuracy circle.
  useEffect(() => {
    const map = mapRef.current;
    const marker = meMarkerRef.current;
    if (!ready || !map || !marker || !userPosition) return;
    marker.setLngLat([userPosition.lng, userPosition.lat]);
    if (!marker.getElement().isConnected) marker.addTo(map);
    (map.getSource("me-accuracy") as GeoJSONSource | undefined)?.setData(accuracyCircle(userPosition));
    const metersPerPixelZ22 = (METERS_PER_PIXEL_Z0 * Math.cos((userPosition.lat * Math.PI) / 180)) / 2 ** 22;
    map.setPaintProperty("me-accuracy", "circle-radius", ["interpolate", ["exponential", 2], ["zoom"], 0, 0, 22, userPosition.accuracy / metersPerPixelZ22]);
  }, [ready, userPosition]);

  // Point the cone the way the phone is facing (or driving).
  useEffect(() => {
    const marker = meMarkerRef.current;
    if (!marker) return;
    marker.getElement().classList.toggle("has-heading", heading != null);
    if (heading != null) marker.setRotation(heading);
  }, [ready, heading]);

  // While following: keep the dot centered, and while driving turn the map so the road ahead points up.
  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map || !following || !userPosition) return;
    const view = (followView.current ??= { zoom: Math.max(map.getZoom(), 16), bearing: map.getBearing() });
    if (userPosition.movingHeading != null) view.bearing = userPosition.movingHeading;
    map.easeTo({
      center: [userPosition.lng, userPosition.lat],
      zoom: view.zoom,
      bearing: view.bearing,
      padding: SHEET_PADDING,
      duration: 800,
      easing: (t) => t, // steady motion between GPS updates, instead of speeding up and slowing down each time
    });
  }, [ready, following, userPosition]);

  // MapLibre sets `position: relative` on its container, so the absolute positioning lives on a wrapper.
  return (
    <div className="absolute inset-0">
      <div ref={containerRef} className="h-full w-full" aria-label="Map of traffic signals" role="region" />
      <div className="absolute right-3 top-3 z-10 flex flex-col gap-2">
        <button
          type="button"
          aria-label={following ? "Following your location" : "Show my location"}
          aria-pressed={following}
          onClick={() => {
            onLocate();
            followView.current = null;
            setFollow({ on: true, selectedAtStart: selectedId });
          }}
          className={`flex h-11 w-11 items-center justify-center rounded-xl shadow ring-1 ring-black/10 ${following ? "bg-sky-600 text-white" : "bg-white text-sky-700"}`}
        >
          <svg viewBox="0 0 24 24" className="h-5 w-5" fill={following ? "currentColor" : "none"} stroke="currentColor" strokeWidth="2" strokeLinejoin="round" aria-hidden>
            <path d="M3 11l18-8-8 18-2-8-8-2z" />
          </svg>
        </button>
        {Math.abs(bearing) > 1 && (
          <button
            type="button"
            aria-label="Point the map north"
            onClick={() => {
              if (followView.current) followView.current.bearing = 0;
              mapRef.current?.easeTo({ bearing: 0, duration: 400 });
            }}
            className="flex h-11 w-11 items-center justify-center rounded-xl bg-white shadow ring-1 ring-black/10"
          >
            <svg viewBox="0 0 24 24" className="h-6 w-6" style={{ transform: `rotate(${-bearing}deg)` }} aria-hidden>
              <path d="M12 3l4 9h-8z" fill="#dc2626" />
              <path d="M12 21l-4-9h8z" fill="#a3a3a3" />
            </svg>
          </button>
        )}
      </div>
    </div>
  );
}
