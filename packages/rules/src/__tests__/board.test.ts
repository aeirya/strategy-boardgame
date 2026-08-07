import { describe, expect, it } from "vitest";
import { placeholderAreas } from "../data/board.js";

describe("board data integrity", () => {
  it("only references known areas and keeps adjacency two-way", () => {
    const issues: string[] = [];
    for (const [areaId, area] of Object.entries(placeholderAreas)) {
      for (const adjacentId of area.adjacent) {
        if (!placeholderAreas[adjacentId]) issues.push(`${areaId} references unknown area ${adjacentId}`);
        else if (!placeholderAreas[adjacentId].adjacent.includes(areaId)) issues.push(`${areaId} -> ${adjacentId} is not two-way`);
      }
    }
    expect(issues).toEqual([]);
  });
});
