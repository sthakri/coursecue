import { describe, expect, it } from "vitest";
import { chartLabelColor } from "../chart-contrast";

describe("workload cell labels", () => {
  it("uses dark text on the pale empty and low-load cells", () => {
    expect(chartLabelColor(240, 234, 230)).toBe("var(--chart-label-dark)");
    expect(chartLabelColor(244, 231, 228)).toBe("var(--chart-label-dark)");
  });

  it("uses white text on the TXST Canvas maroon high-load cells", () => {
    expect(chartLabelColor(75, 22, 16)).toBe("var(--primary-foreground)");
  });

  it("keeps at least 4.5:1 contrast throughout the density scale", () => {
    for (let step = 0; step <= 100; step++) {
      const channels = [240, 234, 230].map((start, i) =>
        Math.round(start + ([75, 22, 16][i] - start) * step / 100)
      );
      const linear = channels.map((channel) => {
        const c = channel / 255;
        return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
      });
      const luminance = linear[0] * 0.2126 + linear[1] * 0.7152 + linear[2] * 0.0722;
      const label = chartLabelColor(channels[0], channels[1], channels[2]);
      const contrast = label === "var(--chart-label-dark)"
        ? (luminance + 0.05) / 0.05
        : 1.05 / (luminance + 0.05);
      expect(contrast, `density ${step}%`).toBeGreaterThanOrEqual(4.5);
    }
  });
});
