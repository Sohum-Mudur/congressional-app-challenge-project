import { describe, expect, it } from "vitest";
import { renderFixedEmail } from "./fix-alerts";

describe("renderFixedEmail", () => {
  it("says which light was fixed, by whom, and that the address is deleted", () => {
    const email = renderFixedEmail({ id: "osm-1", name: "Triangle Road & Auten Road" }, "Hillsborough DPW", { mapUrl: "https://app/?signal=osm-1" });
    expect(email.subject).toBe("Fixed: the traffic light at Triangle Road & Auten Road");
    expect(email.text).toContain("Hillsborough DPW has marked the traffic light at Triangle Road & Auten Road as fixed");
    expect(email.text).toContain("deleted your email address");
    expect(email.html).toContain("Triangle Road &amp; Auten Road");
    expect(email.html).toContain("https://app/?signal=osm-1");
  });
});
