import type { Padding } from "./types.ts";

/** Everything needed to map data space to pixel space. */
export interface ScaleConfig {
	/** Svg width in px. */
	width: number;
	/** Svg height in px. */
	height: number;
	/** Resolved plot paddings in px. */
	padding: Padding;
	/** Visible x range (pan/zoom mutates this). */
	domainX: [number, number];
	/** Visible y range. */
	domainY: [number, number];
}

/** Inner plot rectangle (the drawable area between paddings). */
export function plotRect(
	cfg: ScaleConfig,
): { x: number; y: number; width: number; height: number } {
	const { width, height, padding } = cfg;
	return {
		x: padding.left,
		y: padding.top,
		width: Math.max(0, width - padding.left - padding.right),
		height: Math.max(0, height - padding.top - padding.bottom),
	};
}

/** Width of a domain (may be negative for inverted input). */
function span(domain: [number, number]): number {
	return domain[1] - domain[0];
}

/** Map a data x value to a pixel x. A zero-span domain maps to the plot center. */
export function scaleX(value: number, cfg: ScaleConfig): number {
	const plot = plotRect(cfg);
	const s = span(cfg.domainX);
	if (s === 0) return plot.x + plot.width / 2;
	return plot.x + ((value - cfg.domainX[0]) / s) * plot.width;
}

/** Map a data y value to a pixel y (larger value = higher = smaller pixel y).
 * A zero-span domain maps to the plot center. */
export function scaleY(value: number, cfg: ScaleConfig): number {
	const plot = plotRect(cfg);
	const s = span(cfg.domainY);
	if (s === 0) return plot.y + plot.height / 2;
	return plot.y + (1 - (value - cfg.domainY[0]) / s) * plot.height;
}

/** Inverse of `scaleX` — map a pixel x back to a data x (pointer → data). */
export function invertX(pixelX: number, cfg: ScaleConfig): number {
	const plot = plotRect(cfg);
	if (plot.width === 0) return cfg.domainX[0];
	return cfg.domainX[0] + ((pixelX - plot.x) / plot.width) * span(cfg.domainX);
}

/** Clamp a visible x window into the full data range, preserving its span when
 * possible. The span itself is clamped to `[minSpan, full span]`. */
export function clampDomainX(
	domain: [number, number],
	full: [number, number],
	minSpan = 0,
): [number, number] {
	const fullSpan = Math.max(0, span(full));
	let s = span(domain);
	if (!Number.isFinite(s) || s <= 0) s = fullSpan;
	s = Math.min(Math.max(s, Math.min(minSpan, fullSpan)), fullSpan || s);
	let d0 = domain[0];
	if (d0 < full[0]) d0 = full[0];
	if (d0 + s > full[1]) d0 = full[1] - s;
	if (d0 < full[0]) d0 = full[0]; // fullSpan < s edge
	return [d0, d0 + s];
}

/** Min/max x over the dataset (assumes non-decreasing x, so first/last). */
export function dataRangeX(points: { x: number }[]): [number, number] {
	if (!points.length) return [0, 1];
	return [points[0].x, points[points.length - 1].x];
}

/** Min/max y over a set of points. */
export function dataRangeY(points: { y: number }[]): [number, number] {
	if (!points.length) return [0, 1];
	let min = Infinity;
	let max = -Infinity;
	for (const p of points) {
		if (p.y < min) min = p.y;
		if (p.y > max) max = p.y;
	}
	return [min, max];
}
