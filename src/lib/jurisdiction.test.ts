import { describe, expect, it } from "vitest";
import { classifyRef, intersectionName, ownerForRoads } from "./jurisdiction";

describe("classifyRef", () => {
  it.each([
    ["US 206", "state"],
    ["US 206 BYP", "state"],
    ["NJ 27", "state"],
    ["I 287", "state"],
    ["CR 514", "county"],
    ["CR 533 Bypass", "county"],
    ["US 206;CR 514", "state"],
    [null, null],
    ["", null],
  ])("%s -> %s", (ref, expected) => {
    expect(classifyRef(ref)).toBe(expected);
  });
});

describe("ownerForRoads (real Hillsborough intersections)", () => {
  it("US 206 & Amwell Rd goes to NJDOT", () => {
    expect(ownerForRoads([{ ref: "US 206" }, { name: "Amwell Road", ref: "CR 514" }])).toEqual({
      ownerType: "state",
      viaRef: "US 206",
    });
  });

  it("Amwell Rd & Triangle Rd goes to Somerset County", () => {
    expect(ownerForRoads([{ name: "Amwell Road", ref: "CR 514" }, { name: "Triangle Road" }])).toEqual({
      ownerType: "county",
      viaRef: "CR 514",
    });
  });

  it("Raider Blvd & Triangle Rd goes to the township", () => {
    expect(ownerForRoads([{ name: "Raider Boulevard" }, { name: "Triangle Road" }])).toEqual({
      ownerType: "municipal",
      viaRef: null,
    });
  });
});

describe("intersectionName", () => {
  it("dedupes and falls back to ref", () => {
    expect(intersectionName([{ ref: "US 206" }, { ref: "US 206" }, { name: "Amwell Road", ref: "CR 514" }])).toBe(
      "US 206 & Amwell Road",
    );
  });
});
