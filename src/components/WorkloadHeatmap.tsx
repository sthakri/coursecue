"use client";

import { useEffect, useRef } from "react";
import * as d3 from "d3";
import { getLocalDate, getLocalDay } from "@/lib/time";
import { chartLabelColor } from "@/lib/chart-contrast";

interface Props {
  data: Array<{ due_at: string; assignment_count: number }>;
  userTz: string;
}

interface DayEntry {
  date: Date;
  dateStr: string;
  col: number;
  row: number;
}

const MONTHS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

function fmtShort(d: Date): string {
  return `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}`;
}

export default function WorkloadHeatmap({ data, userTz }: Props) {
  const svgRef = useRef<SVGSVGElement>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    d3.select(svgRef.current).selectAll("*").remove();

    const svg = svgRef.current;
    if (!svg) return;

    const cellSize = 44;
    const gap = 6;
    const step = cellSize + gap;
    const marginTop = 6;
    const marginLeft = 36;
    const xAxisHeight = 46;
    const legendHeight = 40;
    const gridH = 7 * step - gap;
    const svgHeight = marginTop + gridH + xAxisHeight + legendHeight;
    const contentWidth = marginLeft + 6 * step + 4;

    const countMap = new Map<string, number>();
    for (const row of data) {
      const key = row.due_at.slice(0, 10);
      countMap.set(key, (countMap.get(key) ?? 0) + row.assignment_count);
    }

    const counts = Array.from(countMap.values());
    const maxDomain = counts.length > 0 ? Math.max(5, ...counts) : 5;

    // D3 interpolation requires resolved colors rather than CSS var strings.
    const theme = getComputedStyle(svg);
    const emptyColor = theme.getPropertyValue("--chart-empty").trim();
    const heavyColor = theme.getPropertyValue("--chart-high").trim();
    const colorScale = d3
      .scaleSequential(d3.interpolateRgb(emptyColor, heavyColor))
      .domain([0, maxDomain]);

    const now = new Date();
    const todayStr = getLocalDate(now, userTz);
    const todayDow = getLocalDay(now, userTz);

    const dowOff = todayDow === 0 ? -6 : 1 - todayDow;
    // Calendar math from Monday's LOCAL date in UTC midnight space — adding
    // 86_400_000 ms to a Date can duplicate a local date on the 25h DST
    // fall-back day (duplicate heatmap cell, double-counted stats).
    const mondayStr = getLocalDate(new Date(now.getTime() + dowOff * 86_400_000), userTz);
    const [my, mm, md] = mondayStr.split("-").map(Number);

    const days: DayEntry[] = Array.from({ length: 42 }, (_, i) => {
      const col = Math.floor(i / 7);
      const row = i % 7;
      const date = new Date(Date.UTC(my, mm - 1, md + col * 7 + row));
      return { date, dateStr: date.toISOString().slice(0, 10), col, row };
    });

    const weekStarts: Date[] = Array.from({ length: 6 }, (_, i) =>
      new Date(Date.UTC(my, mm - 1, md + i * 7))
    );

    function redraw() {
      d3.select(svg).selectAll("*").remove();

      const svgSel = d3
        .select(svg)
        .attr("viewBox", `0 0 ${contentWidth} ${svgHeight}`)
        .attr("width", "100%");

      // Day-of-week labels
      svgSel
        .selectAll<SVGTextElement, string>("text.dy")
        .data(["M", "T", "W", "T", "F", "S", "S"])
        .join("text")
        .attr("class", "dy")
        .attr("x", marginLeft - 8)
        .attr("y", (_, i) => marginTop + i * step + cellSize / 2 + 4)
        .attr("text-anchor", "end")
        .attr("fill", "var(--muted-foreground)")
        .attr("font-size", "10px")
        .text((l) => l);

      // Week-start labels
      svgSel
        .selectAll<SVGTextElement, Date>("text.wk")
        .data(weekStarts)
        .join("text")
        .attr("class", "wk")
        .attr(
          "transform",
          (_, i) =>
            `translate(${marginLeft + i * step + cellSize / 2}, ${marginTop + gridH + 8}) rotate(-45)`,
        )
        .attr("text-anchor", "end")
        .attr("fill", "var(--muted-foreground)")
        .attr("font-size", "10px")
        .text((d) => fmtShort(d));

      const cellGroups = svgSel
        .selectAll<SVGGElement, DayEntry>("g.cell")
        .data(days)
        .join("g")
        .attr("class", "cell");

      cellGroups
        .append("rect")
        .attr("x", (d) => marginLeft + d.col * step)
        .attr("y", (d) => marginTop + d.row * step)
        .attr("width", cellSize)
        .attr("height", cellSize)
        .attr("rx", 5)
        .attr("fill", (d) => colorScale(countMap.get(d.dateStr) ?? 0))
        .attr("stroke", (d) => (d.dateStr === todayStr ? "var(--primary-hover)" : "var(--border)"))
        .attr("stroke-width", (d) => (d.dateStr === todayStr ? 2 : 0.5));

      cellGroups.append("title").text((d) => {
        const n = countMap.get(d.dateStr) ?? 0;
        return `${fmtShort(d.date)} — ${n} assignment${n === 1 ? "" : "s"}`;
      });

      cellGroups
        .append("text")
        .attr("x", (d) => marginLeft + d.col * step + cellSize / 2)
        .attr("y", (d) => marginTop + d.row * step + cellSize / 2)
        .attr("text-anchor", "middle")
        .attr("dominant-baseline", "central")
        .attr("fill", (d) => {
          const fill = d3.rgb(colorScale(countMap.get(d.dateStr) ?? 0));
          return chartLabelColor(fill.r, fill.g, fill.b);
        })
        .attr("font-size", "13px")
        .attr("font-weight", "700")
        .attr("pointer-events", "none")
        .text((d) => {
          const n = countMap.get(d.dateStr) ?? 0;
          return n > 0 ? String(n) : "";
        });

      // Legend
      const legendY = marginTop + gridH + xAxisHeight + 10;
      const swatchSize = 14;
      const swatchGap = 4;
      const legendDomain = [0, maxDomain * 0.25, maxDomain * 0.5, maxDomain * 0.75, maxDomain];
      const swatchStartX = marginLeft + 26;

      svgSel.append("text").attr("x", marginLeft).attr("y", legendY + swatchSize - 1).attr("fill", "var(--muted-foreground)").attr("font-size", "11px").text("Low");

      svgSel
        .selectAll<SVGRectElement, number>("rect.ls")
        .data(legendDomain)
        .join("rect")
        .attr("class", "ls")
        .attr("x", (_, i) => swatchStartX + i * (swatchSize + swatchGap))
        .attr("y", legendY)
        .attr("width", swatchSize)
        .attr("height", swatchSize)
        .attr("rx", 3)
        .attr("fill", (v) => colorScale(v));

      svgSel
        .append("text")
        .attr("x", swatchStartX + legendDomain.length * (swatchSize + swatchGap))
        .attr("y", legendY + swatchSize - 1)
        .attr("fill", "var(--muted-foreground)")
        .attr("font-size", "11px")
        .text("High");
    }

    redraw();

    const ro = new ResizeObserver(() => redraw());
    if (wrapperRef.current) ro.observe(wrapperRef.current);
    return () => ro.disconnect();
  }, [data, userTz]);

  return (
    <div className="rounded-sm bg-card border border-border p-5 sm:p-6 shadow-none">
      <div className="mb-4">
        <h2 className="text-foreground font-semibold text-base">
          Workload — Next 6 Weeks
        </h2>
      </div>
      <div ref={wrapperRef} className="w-full max-w-85 mx-auto">
        <svg ref={svgRef} className="w-full h-auto block" role="img" aria-label="Assignment workload for the next six weeks. Each cell shows the number of assignments due on that day." />
      </div>
    </div>
  );
}
