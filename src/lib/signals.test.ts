import { describe, expect, it } from "vitest";
import { buildSignals } from "./signals";

const place = { municipality: "Hillsborough Township", county: "Somerset" };

describe("buildSignals", () => {
  it("merges the two carriageway nodes of one divided-highway intersection", () => {
    const signals = buildSignals(
      [
        { osmNodeId: 2, lat: 40.5, lng: -74.64, roads: [{ ref: "US 206" }, { name: "Amwell Road", ref: "CR 514" }] },
        { osmNodeId: 1, lat: 40.5002, lng: -74.64, roads: [{ ref: "US 206" }] }, // ~22 m north
      ],
      place,
    );
    expect(signals).toHaveLength(1);
    expect(signals[0]).toMatchObject({
      id: "osm-1",
      osmNodeIds: [1, 2],
      lat: 40.5001,
      name: "US 206 & Amwell Road",
      ownerType: "state",
      municipality: "Hillsborough Township",
    });
    expect(signals[0].roads).toHaveLength(2);
  });

  it("keeps separate intersections apart", () => {
    const signals = buildSignals(
      [
        { osmNodeId: 1, lat: 40.5, lng: -74.64, roads: [] },
        { osmNodeId: 2, lat: 40.501, lng: -74.64, roads: [] }, // ~111 m away
      ],
      place,
    );
    expect(signals).toHaveLength(2);
  });
});
