import { describe, expect, it } from "vitest";
import { planFrameSampling } from "../src/index.js";

describe("planFrameSampling", () => {
  it("1 fps over a 7 s play yields 7 ordered timestamps and records the coverage gaps", () => {
    const plan = planFrameSampling({ startSec: 12.5, endSec: 19.5, fps: 1, maxFrames: 12 });
    expect(plan.timestampsSec).toEqual([12.5, 13.5, 14.5, 15.5, 16.5, 17.5, 18.5]);
    for (let i = 1; i < plan.timestampsSec.length; i++) expect(plan.timestampsSec[i]!).toBeGreaterThan(plan.timestampsSec[i - 1]!);
    expect(plan.capped).toBe(false);
    expect(plan.effectiveFps).toBe(1);
    // six 1 s gaps between samples plus the 1 s tail after the last sample
    expect(plan.gaps).toHaveLength(7);
    expect(plan.gaps.slice(0, 6).every((g) => g.reason === "between_samples")).toBe(true);
    expect(plan.gaps[6]).toEqual({ fromSec: 18.5, toSec: 19.5, reason: "after_last_sample" });
    expect(plan.maxGapSec).toBe(1);
    expect(plan.note).toContain("not inspected");
  });

  it("spreads frames evenly and flags the cap when the request exceeds maxFrames", () => {
    const plan = planFrameSampling({ startSec: 0, endSec: 30, fps: 2, maxFrames: 6 });
    expect(plan.timestampsSec).toEqual([0, 5, 10, 15, 20, 25]);
    expect(plan.capped).toBe(true);
    expect(plan.effectiveFps).toBe(0.2);
    expect(plan.gaps.every((g) => g.reason === "cap_reached" || g.reason === "after_last_sample")).toBe(true);
    expect(plan.maxGapSec).toBe(5);
    expect(plan.note).toContain("cap 6");
  });

  it("always yields at least one frame for very short segments and validates input", () => {
    expect(planFrameSampling({ startSec: 3, endSec: 3.2, fps: 1, maxFrames: 5 }).timestampsSec).toEqual([3]);
    expect(() => planFrameSampling({ startSec: 3, endSec: 3, fps: 1, maxFrames: 5 })).toThrow();
    expect(() => planFrameSampling({ startSec: 0, endSec: 1, fps: 0, maxFrames: 5 })).toThrow();
    expect(() => planFrameSampling({ startSec: 0, endSec: 1, fps: 1, maxFrames: 0 })).toThrow();
  });
});
