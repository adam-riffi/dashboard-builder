import { describe, expect, it } from "vitest";
import { unwrapAntimeridian } from "../src/index.ts";

describe("unwrapAntimeridian (ADR 0014)", () => {
  it("moves the western side of a ring that crosses 180° east, so it draws without wrapping", () => {
    const geometry = {
      type: "Polygon" as const,
      coordinates: [
        [
          [178, 60],
          [-178, 61],
          [-176, 64],
          [179, 65],
          [178, 60],
        ],
      ],
    };
    expect(unwrapAntimeridian(geometry).coordinates).toEqual([
      [
        [178, 60],
        [182, 61],
        [184, 64],
        [179, 65],
        [178, 60],
      ],
    ]);
  });

  it("leaves rings that stay on one side alone, in multi-polygons too", () => {
    const geometry = {
      type: "MultiPolygon" as const,
      coordinates: [
        [
          [
            [2, 48],
            [3, 49],
            [2, 48],
          ],
        ],
        [
          [
            [-179, -16],
            [-178, -17],
            [-179, -16],
          ],
        ],
      ],
    };
    expect(unwrapAntimeridian(geometry)).toEqual(geometry);
  });
});
