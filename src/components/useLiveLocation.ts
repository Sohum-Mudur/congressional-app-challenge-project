"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export type LivePosition = {
  lat: number;
  lng: number;
  accuracy: number; // meters
  at: number; // ms timestamp
  /** GPS direction of travel, only while actually moving (GPS heading is meaningless when stopped). */
  movingHeading: number | null;
  /** True while driving, and for a few seconds after slowing down, so the car arrow doesn't flicker at slow speeds. */
  driving: boolean;
  /** The last direction of travel while driving. */
  travelHeading: number | null;
};

/** Faster than a brisk walk: below this, the GPS heading jumps around and isn't trustworthy. */
const MOVING_MPS = 2.5;
/** How long the last direction of travel stays useful, e.g. while waiting at a red light. */
const TRAVEL_HEADING_TTL_MS = 2 * 60 * 1000;
/** Keep showing the driving arrow this long after the last moving GPS fix. */
const DRIVING_GRACE_MS = 8_000;

type CompassEvent = DeviceOrientationEvent & { webkitCompassHeading?: number };
type OrientationPermission = { requestPermission?: () => Promise<"granted" | "denied"> };

/**
 * Follows the phone's location continuously (like the blue dot in Google Maps) plus its compass,
 * so the map can show where you are and which way you're facing.
 */
export function useLiveLocation() {
  const [position, setPosition] = useState<LivePosition | null>(null);
  const [compass, setCompass] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [active, setActive] = useState(false);
  const watchId = useRef<number | null>(null);
  const lastTravel = useRef<{ heading: number; at: number } | null>(null);
  const compassOn = useRef(false);
  const removeCompass = useRef<(() => void) | null>(null);
  const hasFix = useRef(false);
  const stopDriving = useRef<ReturnType<typeof setTimeout> | null>(null);

  const stop = useCallback(() => {
    if (watchId.current != null) navigator.geolocation.clearWatch(watchId.current);
    watchId.current = null;
    setActive(false);
  }, []);

  const startWatch = useCallback(() => {
    if (watchId.current != null) return;
    if (!navigator.geolocation) {
      setError("This device can't share its location.");
      return;
    }
    setActive(true);
    watchId.current = navigator.geolocation.watchPosition(
      (p) => {
        const { latitude, longitude, accuracy, heading, speed } = p.coords;
        const moving = speed != null && speed >= MOVING_MPS && heading != null && !Number.isNaN(heading);
        if (moving) lastTravel.current = { heading, at: p.timestamp };
        const t = lastTravel.current;
        const driving = t != null && p.timestamp - t.at < DRIVING_GRACE_MS;
        hasFix.current = true;
        // Phones often stop sending updates while standing still, so end "driving" on a timer too,
        // not only when the next GPS fix arrives.
        if (stopDriving.current) clearTimeout(stopDriving.current);
        if (driving) {
          stopDriving.current = setTimeout(
            () => setPosition((p) => p && { ...p, driving: false, travelHeading: null, movingHeading: null }),
            DRIVING_GRACE_MS - (p.timestamp - t.at) + 100,
          );
        }
        setPosition({
          lat: latitude,
          lng: longitude,
          accuracy,
          at: p.timestamp,
          movingHeading: moving ? heading : null,
          driving,
          travelHeading: driving ? t.heading : null,
        });
        setError(null);
      },
      (err) => {
        if (err.code === err.PERMISSION_DENIED) {
          setError("Location is turned off for this app. Turn it on in Settings → Privacy → Location Services, or tap a light on the map.");
          stop();
        } else if (!hasFix.current) {
          // A slow fix after we already have one isn't worth interrupting anyone; the dot just waits for the next update.
          setError("Can't get your location right now. Try again in a moment, or tap a light on the map.");
        }
      },
      { enableHighAccuracy: true, maximumAge: 2_000, timeout: 20_000 },
    );
  }, [stop]);

  /** Compass for the direction cone. iPhones only allow it after a tap, so call this from a button. */
  const startCompass = useCallback(async () => {
    if (compassOn.current || typeof window === "undefined" || !("DeviceOrientationEvent" in window)) return;
    const permission = (window.DeviceOrientationEvent as unknown as OrientationPermission).requestPermission;
    if (permission) {
      try {
        if ((await permission()) !== "granted") return;
      } catch {
        return;
      }
    }
    compassOn.current = true;
    let last = -999;
    const onOrientation = (e: Event) => {
      const ev = e as CompassEvent;
      // iPhone gives a true compass heading; Android gives alpha (counter-clockwise) on the "absolute" event.
      const raw = ev.webkitCompassHeading ?? (ev.absolute && ev.alpha != null ? 360 - ev.alpha : null);
      if (raw == null) return;
      const h = (raw + (screen.orientation?.angle ?? 0) + 360) % 360;
      // These events fire ~60 times a second; only re-render when the direction really changes.
      if (Math.abs(((h - last + 540) % 360) - 180) >= 4) {
        last = h;
        setCompass(Math.round(h));
      }
    };
    window.addEventListener("deviceorientationabsolute", onOrientation);
    window.addEventListener("deviceorientation", onOrientation);
    removeCompass.current = () => {
      window.removeEventListener("deviceorientationabsolute", onOrientation);
      window.removeEventListener("deviceorientation", onOrientation);
      compassOn.current = false;
    };
  }, []);

  /** Turn on live location (and the compass). Call from a tap so the phone shows its permission prompts. */
  const start = useCallback(() => {
    startWatch();
    void startCompass();
  }, [startWatch, startCompass]);

  // If location was already allowed on an earlier visit, start right away without asking again.
  useEffect(() => {
    let cancelled = false;
    navigator.permissions
      ?.query({ name: "geolocation" })
      .then((status) => {
        if (!cancelled && status.state === "granted") startWatch();
      })
      .catch(() => {});
    return () => {
      cancelled = true;
      if (watchId.current != null) navigator.geolocation.clearWatch(watchId.current);
      watchId.current = null;
      removeCompass.current?.();
      if (stopDriving.current) clearTimeout(stopDriving.current);
    };
  }, [startWatch]);

  /** Which way you were driving just before stopping, if that was recently. */
  const travelHeading = useCallback((): number | null => {
    const t = lastTravel.current;
    return t && Date.now() - t.at < TRAVEL_HEADING_TTL_MS ? t.heading : null;
  }, []);

  // Driving: trust the GPS direction of travel. Standing still: the compass shows which way the phone faces.
  const heading = position?.travelHeading ?? compass;

  return { position, heading, compass, error, active, start, travelHeading };
}
