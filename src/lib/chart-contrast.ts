/** Choose the higher-contrast label for a resolved, opaque sRGB chart fill.
 * WCAG relative luminance: https://www.w3.org/TR/WCAG22/#dfn-relative-luminance
 */
export function chartLabelColor(red: number, green: number, blue: number): string {
  const linear = [red, green, blue].map((channel) => {
    const c = channel / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  const luminance = linear[0] * 0.2126 + linear[1] * 0.7152 + linear[2] * 0.0722;
  const darkContrast = (luminance + 0.05) / 0.05;
  const lightContrast = 1.05 / (luminance + 0.05);
  return darkContrast >= lightContrast
    ? "var(--chart-label-dark)"
    : "var(--primary-foreground)";
}
