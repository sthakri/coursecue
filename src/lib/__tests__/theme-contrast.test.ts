import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { chartLabelColor } from "@/lib/chart-contrast";

const css = readFileSync("src/app/globals.css", "utf8");
function rgb(token: string) {
  const hex = css.match(new RegExp(`--${token}: #(\\w{6});`))?.[1];
  if (!hex) throw new Error(`Missing color ${token}`);
  return [0, 2, 4].map(i => parseInt(hex.slice(i, i + 2), 16));
}
function luminance(channels: number[]) {
  const c = channels.map(v => { const x = v / 255; return x <= .04045 ? x / 12.92 : ((x + .055) / 1.055) ** 2.4; });
  return c[0] * .2126 + c[1] * .7152 + c[2] * .0722;
}
function contrast(a: number[], b: number[]) {
  const values = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (values[0] + .05) / (values[1] + .05);
}
describe("authored study palette", () => {
  it.each([
    ["foreground", "background"], ["card-foreground", "card"], ["muted-foreground", "background"],
    ["muted-foreground", "card"], ["primary", "background"], ["primary", "primary-soft"],
    ["primary-foreground", "primary"], ["primary-foreground", "primary-hover"],
    ["sidebar-foreground", "sidebar"], ["sidebar-muted", "sidebar"], ["brand-gold", "sidebar"],
    ["sidebar-primary-foreground", "sidebar-primary"], ["destructive", "danger-soft"],
    ["success", "success-soft"], ["warning", "warning-soft"], ["primary-foreground", "success"],
  ])("keeps %s readable on %s", (text, background) => {
    expect(contrast(rgb(text), rgb(background))).toBeGreaterThanOrEqual(4.5);
  });
  it("keeps control boundaries visible against their surfaces", () => {
    for (const surface of ["background", "card"]) expect(contrast(rgb("input"), rgb(surface))).toBeGreaterThanOrEqual(3);
  });
  it("keeps labels readable throughout the actual chart color scale", () => {
    const start = rgb("chart-empty"), end = rgb("chart-high");
    for (let step = 0; step <= 100; step++) {
      const fill = start.map((v, i) => Math.round(v + (end[i] - v) * step / 100));
      const label = chartLabelColor(fill[0], fill[1], fill[2]);
      const text = rgb(label === "var(--chart-label-dark)" ? "chart-label-dark" : "primary-foreground");
      expect(contrast(fill, text)).toBeGreaterThanOrEqual(4.5);
    }
  });
});
