"use client";

import { useEffect, useRef } from "react";
import * as d3 from "d3";
import { formatLocalHour } from "@/lib/time";

interface Props {
  data: Array<{ hour_of_day: number; day_of_week: number; score: number }>;
  userTz?: string;
}

function hourEmoji(h: number): string {
  if (h <= 5) return "🌙";
  if (h <= 11) return "🌅";
  if (h <= 16) return "☀️";
  if (h <= 20) return "🌆";
  return "🌙";
}

export default function ProductiveWindowsChart({ data, userTz }: Props) {
  const svgRef = useRef<SVGSVGElement>(null);

  // Aggregate scores by hour 0..23
  const hourlyScores = Array.from({ length: 24 }, (_, h) => {
    const total = data
      .filter((r) => r.hour_of_day === h)
      .reduce((sum, r) => sum + r.score, 0);
    return { hour: h, score: total };
  });

  const maxScore = Math.max(...hourlyScores.map((d) => d.score), 0);
  const topHourItem = [...hourlyScores].sort((a, b) => b.score - a.score)[0];
  const peakHour = maxScore > 0 ? topHourItem?.hour ?? null : null;

  useEffect(() => {
    if (!svgRef.current) return;
    const svg = d3.select(svgRef.current);
    svg.selectAll("*").remove();

    const width = 360;
    const height = 140;
    const margin = { top: 12, right: 10, bottom: 26, left: 10 };
    const innerWidth = width - margin.left - margin.right;
    const innerHeight = height - margin.top - margin.bottom;

    const g = svg
      .attr("viewBox", `0 0 ${width} ${height}`)
      .attr("width", "100%")
      .attr("height", "100%")
      .append("g")
      .attr("transform", `translate(${margin.left},${margin.top})`);

    const xScale = d3
      .scaleBand()
      .domain(d3.range(24).map(String))
      .range([0, innerWidth])
      .padding(0.2);

    const yScale = d3
      .scaleLinear()
      .domain([0, Math.max(maxScore, 0.05)])
      .range([innerHeight, 0]);

    // Background grid / bars
    g.selectAll(".bar-bg")
      .data(hourlyScores)
      .enter()
      .append("rect")
      .attr("class", "bar-bg")
      .attr("x", (d) => xScale(String(d.hour)) ?? 0)
      .attr("y", 0)
      .attr("width", xScale.bandwidth())
      .attr("height", innerHeight)
      .attr("fill", "var(--chart-empty)")
      .attr("rx", 2);

    // Active bars
    g.selectAll(".bar-fill")
      .data(hourlyScores)
      .enter()
      .append("rect")
      .attr("class", "bar-fill")
      .attr("x", (d) => xScale(String(d.hour)) ?? 0)
      .attr("y", (d) => yScale(d.score))
      .attr("width", xScale.bandwidth())
      .attr("height", (d) => Math.max(innerHeight - yScale(d.score), d.score > 0 ? 2 : 0))
      .attr("fill", (d) => (d.hour === peakHour ? "var(--primary-hover)" : "var(--primary)"))
      .attr("opacity", (d) => (d.hour === peakHour ? 1 : d.score > 0 ? 0.75 : 0.1))
      .attr("rx", 2)
      .append("title")
      .text((d) => `${formatLocalHour(d.hour, userTz)}: ${(d.score * 100).toFixed(0)} pts`);

    // Hour ticks: 0, 6, 12, 18
    const tickHours = [0, 6, 12, 18, 23];
    tickHours.forEach((h) => {
      const x = (xScale(String(h)) ?? 0) + xScale.bandwidth() / 2;
      g.append("text")
        .attr("x", x)
        .attr("y", innerHeight + 16)
        .attr("text-anchor", "middle")
        .attr("fill", "var(--muted-foreground)")
        .attr("font-size", "10px")
        .attr("font-family", "inherit")
        .text(`${h}h`);
    });
  }, [hourlyScores, maxScore, peakHour, userTz]);

  return (
    <div className="rounded-sm bg-card border border-border p-5 flex flex-col justify-between">
      <div>
        <div className="flex items-center justify-between mb-1">
          <h2 className="text-foreground font-semibold text-sm flex items-center gap-1.5">
            <span>{peakHour !== null ? hourEmoji(peakHour) : "⏰"}</span> Best Time to Review
          </h2>
          {peakHour !== null && (
            <span className="text-primary text-xs font-semibold bg-primary-soft border border-primary/20 px-2 py-0.5 rounded-full">
              Peak: {formatLocalHour(peakHour, userTz)}
            </span>
          )}
        </div>
        <p className="text-muted-foreground text-xs mb-3">Your activity across the day</p>
      </div>

      <div className="w-full my-2">
        <svg ref={svgRef} className="w-full h-32 overflow-visible" role="img" aria-label={peakHour !== null ? `Activity by hour. Your busiest hour is ${formatLocalHour(peakHour, userTz)}.` : "Activity by hour. No activity recorded yet."} />
      </div>

      <p className="text-muted-foreground text-[11px] mt-1">
        {peakHour !== null
          ? `You are most active around ${formatLocalHour(peakHour, userTz)}.`
          : "Activity records automatically while you use the dashboard."}
      </p>
    </div>
  );
}
