// "Impact" numbers for the public page and the pitch: how much time and fuel broken lights waste.
// These are estimates from reported waits only, so they undercount the real cost.

import type { Report } from "./types";

/** Used when someone reports without entering a wait time. Conservative on purpose. */
export const ASSUMED_WAIT_SECONDS = 60;

/** US DOE: an idling passenger car burns roughly 1/4–1/2 gallon per hour. We use the low end. */
export const IDLE_GALLONS_PER_HOUR = 0.25;

/** US EPA: burning one gallon of gasoline emits about 8,887 g of CO₂. */
export const CO2_GRAMS_PER_GALLON = 8887;

export function impactStats(reports: readonly Report[]) {
  const waitSeconds = reports.reduce((sum, r) => sum + (r.waitSeconds ?? ASSUMED_WAIT_SECONDS), 0);
  const idleHours = waitSeconds / 3600;
  const gallons = idleHours * IDLE_GALLONS_PER_HOUR;
  return {
    reports: reports.length,
    signals: new Set(reports.map((r) => r.signalId)).size,
    people: new Set(reports.map((r) => r.reporterId)).size,
    waitMinutes: Math.round(waitSeconds / 60),
    gallons: Math.round(gallons * 100) / 100,
    co2Kg: Math.round(((gallons * CO2_GRAMS_PER_GALLON) / 1000) * 10) / 10,
  };
}
