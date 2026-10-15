"use client";

import { Map as MapLibreMap, Marker, setWorkerUrl, type GeoJSONSource } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { useEffect, useRef, useState } from "react";
import { OWNER_COLORS } from "./labels";
import { applyMapColors, MAP_STYLE } from "./mapStyle";
import type { MapSignal } from "./types";
import type { LivePosition } from "./useLiveLocation";

// Somerset County, NJ: the whole area the app covers.
const COUNTY_CENTER: [number, number] = [-74.6, 40.56];

// Served from public/ by scripts/copy-maplibre-worker.mjs.
setWorkerUrl("/maplibre/maplibre-gl-worker.mjs");

/** Keeps the user's dot above the bottom sheet when the map centers on it. */
const SHEET_PADDING = { bottom: 260, top: 0, left: 0, right: 0 };

/**
 * The location button works like Google Maps:
 *  - off: the map stays where you put it
 *  - follow: keeps you centered; north stays up, except while driving, when the road ahead points up (like Waze)
 *  - compass (tap again): the map also turns with your phone, so what's in front of you is up
 */
export type FollowMode = "off" | "follow" | "compass";

type Props = {
  signals: MapSignal[];
  selectedId: string | null;
  userPosition: LivePosition | null;
  /** Which way to point the cone: direction of travel while driving, otherwise the compass. */
  heading: number | null;
  /** A light was tapped, or null when empty map was tapped. */
  onSelect: (id: string | null) => void;
  /** Turn on live location; called when the location button is tapped. */
  onLocate: () => void;
  /** Zoom out to fit these points, e.g. you and the closest light. Changes to a new array re-frame the map. */
  frame?: { lat: number; lng: number }[] | null;
};

/** MapLibre uses 512 px tiles: meters per pixel at zoom 0, before latitude correction. */
const METERS_PER_PIXEL_Z0 = 40_075_016.686 / 512;

const point = (lng: number, lat: number): GeoJSON.FeatureCollection => ({
  type: "FeatureCollection",
  features: [{ type: "Feature", geometry: { type: "Point", coordinates: [lng, lat] }, properties: {} }],
});

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

/** Keeps the screen on while following, like a navigation app. Phones that don't support it just ignore this. */
function useWakeLock(on: boolean) {
  useEffect(() => {
    if (!on || !("wakeLock" in navigator)) return;
    let lock: WakeLockSentinel | null = null;
    let cancelled = false;
    const request = () =>
      navigator.wakeLock
        .request("screen")
        .then((l) => {
          if (cancelled) void l.release();
          else lock = l;
        })
        .catch(() => {});
    // The phone drops the lock whenever the app goes to the background, so take it again on return.
    const onVisible = () => document.visibilityState === "visible" && request();
    request();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", onVisible);
      void lock?.release().catch(() => {});
    };
  }, [on]);
}

export default function SignalMap({ signals, selectedId, userPosition, heading, onSelect, onLocate, frame }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const meMarkerRef = useRef<Marker | null>(null);
  const [ready, setReady] = useState(false);
  const [bearing, setBearing] = useState(0);
  const [mode, setMode] = useState<FollowMode>("off");
  // Where the camera is aiming while following. GPS updates arrive faster than animations finish,
  // so each update aims for this target instead of wherever the previous animation got to.
  const followView = useRef<{ zoom: number; bearing: number } | null>(null);
  const onSelectRef = useRef(onSelect);
  useEffect(() => {
    onSelectRef.current = onSelect;
  }, [onSelect]);

  // Picking a light means "show me that light", so stop following (adjusting state during render, per React docs).
  const [prevSelectedId, setPrevSelectedId] = useState(selectedId);
  if (prevSelectedId !== selectedId) {
    setPrevSelectedId(selectedId);
    if (selectedId) setMode("off");
  }

  useWakeLock(mode !== "off");

  // Create the map once.
  useEffect(() => {
    if (!containerRef.current) return;
    const map = new MapLibreMap({
      container: containerRef.current,
      style: MAP_STYLE,
      center: COUNTY_CENTER,
      zoom: 10.4,
      attributionControl: { compact: true },
    });
    mapRef.current = map;
    // Handy for debugging and automated tests; stripped from production builds.
    if (process.env.NODE_ENV !== "production") (window as unknown as { __map: MapLibreMap }).__map = map;

    map.on("load", () => {
      applyMapColors(map);
      map.addSource("signals", { type: "geojson", data: toGeoJSON([], null) });
      map.addSource("me-accuracy", { type: "geojson", data: { type: "FeatureCollection", features: [] } });

      // Soft circle showing how precise the GPS fix is (big when GPS is weak, e.g. indoors).
      map.addLayer({
        id: "me-accuracy",
        type: "circle",
        source: "me-accuracy",
        paint: { "circle-color": "#1a73e8", "circle-opacity": 0.1, "circle-stroke-color": "#1a73e8", "circle-stroke-opacity": 0.25, "circle-stroke-width": 1, "circle-radius": 0 },
      });
      // Red halo whose size grows with the number of open reports.
      map.addLayer({
        id: "signal-halo",
        type: "circle",
        source: "signals",
        filter: ["all", [">", ["get", "reports"], 0], ["!=", ["get", "status"], "fixed"]],
        paint: {
          "circle-color": "#dc2626",
          "circle-opacity": 0.22,
          "circle-radius": ["interpolate", ["linear"], ["get", "reports"], 1, 13, 10, 28],
        },
      });
      map.addLayer({
        id: "signals",
        type: "circle",
        source: "signals",
        paint: {
          "circle-radius": ["interpolate", ["linear"], ["zoom"], 10, ["case", ["get", "selected"], 10, 6], 16, ["case", ["get", "selected"], 15, 10.5]],
          "circle-color": ["match", ["get", "ownerType"], "state", OWNER_COLORS.state, "county", OWNER_COLORS.county, OWNER_COLORS.municipal],
          "circle-stroke-color": ["case", ["get", "selected"], "#111827", ["==", ["get", "status"], "fixed"], "#16a34a", "#ffffff"],
          "circle-stroke-width": ["case", ["get", "selected"], 3.5, 2],
        },
      });

      // You: a blue dot with a direction cone when still, a navigation arrow while driving.
      const el = document.createElement("div");
      el.className = "me-marker";
      el.innerHTML =
        '<div class="me-cone"></div><div class="me-dot"></div>' +
        '<svg class="me-arrow" viewBox="0 0 40 40" aria-hidden="true"><path d="M20 3 L34 35 L20 27.5 L6 35 Z" /></svg>';
      meMarkerRef.current = new Marker({ element: el, rotationAlignment: "map", pitchAlignment: "map" });

      // Dots are small, so accept taps anywhere within ~16 px (a fingertip) and pick the closest.
      map.on("click", (e) => {
        const { x, y } = e.point;
        const hits = map.queryRenderedFeatures(
          [
            [x - 16, y - 16],
            [x + 16, y + 16],
          ],
          { layers: ["signals"] },
        );
        const closest = hits
          .map((f) => ({ f, d: map.project((f.geometry as GeoJSON.Point).coordinates as [number, number]).dist(e.point) }))
          .sort((a, b) => a.d - b.d)[0];
        onSelectRef.current(closest ? String(closest.f.properties.id) : null);
      });
      map.on("mouseenter", "signals", () => (map.getCanvas().style.cursor = "pointer"));
      map.on("mouseleave", "signals", () => (map.getCanvas().style.cursor = ""));

      setReady(true);
    });

    // Dragging the map means "let me look around", so stop following. Twisting it leaves compass mode.
    map.on("dragstart", () => setMode("off"));
    map.on("rotate", () => setBearing(map.getBearing()));
    map.on("rotatestart", (e) => {
      if (e.originalEvent) setMode((m) => (m === "compass" ? "follow" : m));
    });
    map.on("rotateend", (e) => {
      if (e.originalEvent && followView.current) followView.current.bearing = map.getBearing();
    });
    map.on("zoomend", (e) => {
      if (e.originalEvent && followView.current) followView.current.zoom = map.getZoom();
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

  // Fit the requested points on screen, above the bottom sheet.
  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map || !frame?.length) return;
    const lngs = frame.map((p) => p.lng);
    const lats = frame.map((p) => p.lat);
    // MapLibre remembers padding from earlier camera moves and adds it to this one, which can zoom out to the
    // whole state. Start from none so only the padding below counts.
    map.setPadding({ top: 0, bottom: 0, left: 0, right: 0 });
    map.fitBounds(
      [
        [Math.min(...lngs), Math.min(...lats)],
        [Math.max(...lngs), Math.max(...lats)],
      ],
      { padding: { top: 130, bottom: Math.min(380, map.getContainer().clientHeight * 0.45), left: 40, right: 40 }, maxZoom: 16, duration: 800 },
    );
  }, [ready, frame]);

  // Move the blue dot and its accuracy circle.
  useEffect(() => {
    const map = mapRef.current;
    const marker = meMarkerRef.current;
    if (!ready || !map || !marker || !userPosition) return;
    marker.setLngLat([userPosition.lng, userPosition.lat]);
    if (!marker.getElement().isConnected) marker.addTo(map);
    marker.getElement().classList.toggle("driving", userPosition.driving);
    (map.getSource("me-accuracy") as GeoJSONSource | undefined)?.setData(point(userPosition.lng, userPosition.lat));
    const metersPerPixelZ22 = (METERS_PER_PIXEL_Z0 * Math.cos((userPosition.lat * Math.PI) / 180)) / 2 ** 22;
    map.setPaintProperty("me-accuracy", "circle-radius", ["interpolate", ["exponential", 2], ["zoom"], 0, 0, 22, userPosition.accuracy / metersPerPixelZ22]);
  }, [ready, userPosition]);

  // Point the cone / arrow.
  useEffect(() => {
    const marker = meMarkerRef.current;
    if (!marker) return;
    marker.getElement().classList.toggle("has-heading", heading != null);
    if (heading != null) marker.setRotation(heading);
  }, [ready, heading]);

  // Keep the camera on you while following.
  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map || mode === "off" || !userPosition) return;
    const view = (followView.current ??= { zoom: Math.max(map.getZoom(), 16.5), bearing: map.getBearing() });
    if (mode === "compass" && heading != null) view.bearing = heading;
    else if (userPosition.driving && userPosition.travelHeading != null) view.bearing = userPosition.travelHeading;
    map.easeTo({
      center: [userPosition.lng, userPosition.lat],
      zoom: view.zoom,
      bearing: view.bearing,
      padding: SHEET_PADDING,
      duration: 700,
      easing: (t) => t, // steady motion between updates, instead of speeding up and slowing down each time
    });
  }, [ready, mode, userPosition, heading]);

  function tapLocate() {
    onLocate();
    if (mode === "off") {
      followView.current = null;
      setMode("follow");
    } else if (mode === "follow") {
      setMode("compass");
    } else {
      // Leaving compass mode: point north again, like Google Maps.
      if (followView.current) followView.current.bearing = 0;
      mapRef.current?.easeTo({ bearing: 0, duration: 400 });
      setMode("follow");
    }
  }

  const label = { off: "Show my location", follow: "Following you. Tap again to turn the map with your phone", compass: "Map turns with your phone. Tap to point north" }[mode];

  // MapLibre sets `position: relative` on its container, so the absolute positioning lives on a wrapper.
  return (
    <div className="absolute inset-0">
      <div ref={containerRef} className="h-full w-full" aria-label="Map of traffic signals" role="region" />
      <div className="absolute right-3 top-3 z-10 flex flex-col gap-2">
        <button
          type="button"
          aria-label={label}
          title={label}
          aria-pressed={mode !== "off"}
          onClick={tapLocate}
          className="map-button"
        >
          {mode === "compass" ? (
            <svg viewBox="0 0 24 24" className="h-6 w-6" aria-hidden>
              <circle cx="12" cy="12" r="9" fill="none" stroke="#1a73e8" strokeWidth="2" />
              <path d="M12 4.5l3 7.5h-6z" fill="#1a73e8" />
              <path d="M12 19.5l-3-7.5h6z" fill="#9aa0a6" />
            </svg>
          ) : (
            <svg viewBox="0 0 24 24" className="h-[22px] w-[22px]" aria-hidden>
              <path d="M3 11l18-8-8 18-2-8-8-2z" fill={mode === "follow" ? "#1a73e8" : "none"} stroke={mode === "follow" ? "#1a73e8" : "#5f6368"} strokeWidth="2" strokeLinejoin="round" />
            </svg>
          )}
        </button>
        {Math.abs(bearing) > 1 && mode !== "compass" && (
          <button
            type="button"
            aria-label="Point the map north"
            onClick={() => {
              if (followView.current) followView.current.bearing = 0;
              mapRef.current?.easeTo({ bearing: 0, duration: 400 });
            }}
            className="map-button"
          >
            <svg viewBox="0 0 24 24" className="h-6 w-6" style={{ transform: `rotate(${-bearing}deg)` }} aria-hidden>
              <path d="M12 3l4 9h-8z" fill="#ea4335" />
              <path d="M12 21l-4-9h8z" fill="#bdc1c6" />
            </svg>
          </button>
        )}
      </div>
    </div>
  );
}
