import { describe, expect, it } from "vitest";
import { approachDirection, distanceMeters, headingToApproach, snapToNearest } from "./geo";

// Two points on US 206 in Hillsborough, ~1 km apart.
const A = { id: "a", lat: 40.4959, lng: -74.6388 };
const B = { id: "b", lat: 40.5049, lng: -74.6388 };

describe("distanceMeters", () => {
  it("is ~111 m per 0.001° of latitude", () => {
    expect(distanceMeters({ lat: 40.5, lng: -74.6 }, { lat: 40.501, lng: -74.6 })).toBeCloseTo(111.2, 0);
  });
});

describe("snapToNearest", () => {
  const signals = [A, B];

  it("picks the closest signal within range", () => {
    const hit = snapToNearest({ lat: 40.4962, lng: -74.6388 }, signals);
    expect(hit?.signal.id).toBe("a");
    expect(hit!.distance).toBeLessThan(40);
  });

  it("returns null when nothing is within the radius", () => {
    expect(snapToNearest({ lat: 40.5, lng: -74.6388 }, signals)).toBeNull();
  });
});

describe("approachDirection", () => {
  it("uses the phone heading when available", () => {
    expect(approachDirection(A, A, 185)).toBe("southbound");
    expect(approachDirection(A, A, 350)).toBe("northbound");
  });

  it("falls back to the bearing toward the signal", () => {
    // Driver is south of the light, so they are heading north.
    expect(approachDirection({ lat: 40.4955, lng: -74.6388 }, A, null)).toBe("northbound");
  });
});

describe("headingToApproach", () => {
  it.each([
    [0, "northbound"],
    [44, "northbound"],
    [46, "eastbound"],
    [180, "southbound"],
    [270, "westbound"],
    [359, "northbound"],
    [-90, "westbound"],
  ] as const)("%s° -> %s", (h, out) => expect(headingToApproach(h)).toBe(out));
});
