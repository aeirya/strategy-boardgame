import { describe, expect, it } from "vitest";
import { placeholderAreas } from "@tabletop/rules";
import { inspectMapIntegrity, visualAreasById } from "./visualMap";

describe("map integrity", () => {
  it("keeps every visual slot inside its owning region", () => {
    const slotIssues = inspectMapIntegrity(placeholderAreas).filter((issue) => issue.kind === "slot");
    expect(slotIssues).toEqual([]);
  });

  it("keeps region hexes connected and rules adjacency valid", () => {
    const issues = inspectMapIntegrity(placeholderAreas).filter((issue) => issue.kind !== "slot");
    expect(issues).toEqual([]);
  });

  it("keeps sea orders and units inside their sea region", () => {
    const westernSea = visualAreasById.westernSea;
    expect(westernSea.orderSlot).not.toEqual(visualAreasById.wahramHold.unitSlots[1]);
    expect(westernSea.unitSlots).not.toContainEqual(westernSea.orderSlot);
    expect(inspectMapIntegrity(placeholderAreas).filter((issue) => issue.areaId === "westernSea" && issue.kind === "slot")).toEqual([]);
  });
});
