import { describe, expect, it } from "vitest";
import { searchSignals } from "./search";

const light = (name: string, roads: { name: string | null; ref: string | null }[]) => ({ name, roads });
const signals = [
  light("Triangle Road & Auten Road", [{ name: "Triangle Road", ref: null }, { name: "Auten Road", ref: null }]),
  light("Farm Road & Triangle Road", [{ name: "Farm Road", ref: null }, { name: "Triangle Road", ref: null }]),
  light("Amwell Road & US 206", [{ name: "Amwell Road", ref: "CR 514" }, { name: null, ref: "US 206" }]),
  light("Partridge Road & US 206", [{ name: "Partridge Road", ref: null }, { name: null, ref: "US 206" }]),
];
const names = (q: string) => searchSignals(signals, q).map((s) => s.name);

describe("searchSignals", () => {
  it("finds every light on a street, with abbreviations", () => {
    expect(names("triangle rd")).toEqual(["Farm Road & Triangle Road", "Triangle Road & Auten Road"]);
  });
  it("matches the start of a word while typing", () => {
    expect(names("partr")).toEqual(["Partridge Road & US 206"]);
  });
  it("understands route numbers however they're written", () => {
    expect(names("rt 206")).toHaveLength(2);
    expect(names("Route 206")).toHaveLength(2);
    expect(names("514")).toEqual(["Amwell Road & US 206"]);
  });
  it("narrows down to an intersection", () => {
    expect(names("amwell and 206")).toEqual(["Amwell Road & US 206"]);
    expect(names("auten & triangle")).toEqual(["Triangle Road & Auten Road"]);
  });
  it("returns nothing for empty or unknown input", () => {
    expect(names("")).toEqual([]);
    expect(names("  & ")).toEqual([]);
    expect(names("main street")).toEqual([]);
  });
});
