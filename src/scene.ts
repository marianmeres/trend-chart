import type {
	DataPoint,
	Scene,
	SceneAnnotation,
	SceneGradient,
	ScenePoint,
	SceneText,
	TrendChartOptions,
	TrendData,
} from "./types.ts";
import {
	dataRangeX,
	dataRangeY,
	plotRect,
	type ScaleConfig,
	scaleX,
	scaleY,
} from "./scale.ts";
import { buildAreaPath, buildLinePath, visibleSlice } from "./path.ts";
import {
	niceDomain,
	niceTicks,
	resolveXTicks,
	sampleTicks,
	ticksForStep,
} from "./ticks.ts";
import { zoneBands, zoneGradientStops } from "./zones.ts";

/** Sizing/identity context the caller (DOM chart or string renderer) provides. */
export interface SceneContext {
	/** Svg width in px. */
	width: number;
	/** Svg height in px. */
	height: number;
	/** Current visible x window (pan/zoom state). Default: full data range. */
	domainX?: [number, number];
	/** Unique prefix for svg def ids. */
	idPrefix?: string;
	/** Emit CSS custom property wrappers around colors. */
	cssVars?: boolean;
}

/** Normalize input data to `DataPoint[]` (the `number[]` shorthand becomes
 * `{x: index, y: value}`). */
export function normalizeData(data: TrendData): DataPoint[] {
	if (!data.length) return [];
	if (typeof data[0] === "number") {
		return (data as number[]).map((y, x) => ({ x, y }));
	}
	return data as DataPoint[];
}

/** Samples with a non-finite `x` or `y` dropped, plus a map from each kept
 * position back to its index in the caller's dataset (`null` when nothing was
 * dropped, so the common case neither copies the data nor remaps indices).
 *
 * A non-finite coordinate would reach the path `d` attribute verbatim, and per
 * the SVG spec a path stops rendering at the first erroneous command — so a
 * single `NaN` sample silently truncates the line while the axes, which are
 * incidentally non-finite-tolerant, still look perfectly correct. */
function finiteSamples(
	points: DataPoint[],
): { points: DataPoint[]; indices: number[] | null } {
	let allFinite = true;
	for (const p of points) {
		if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) {
			allFinite = false;
			break;
		}
	}
	if (allFinite) return { points, indices: null };
	const kept: DataPoint[] = [];
	const indices: number[] = [];
	for (let i = 0; i < points.length; i++) {
		const p = points[i];
		if (Number.isFinite(p.x) && Number.isFinite(p.y)) {
			kept.push(p);
			indices.push(i);
		}
	}
	return { points: kept, indices };
}

/** Wrap a resolved color in a themable CSS custom property reference. */
export function cssColor(name: string, fallback: string, useVars: boolean): string {
	return useVars ? `var(--trend-chart-${name}, ${fallback})` : fallback;
}

const FONT_SIZE = 11;
const DEFAULTS = {
	lineColor: "#4a9eed",
	lineWidth: 2,
	fillOpacity: 0.15,
	yTickCount: 5,
	pointRadius: 3,
	annotationColor: "#f59e0b",
} as const;

/** Compute one fully resolved chart frame from data + options + context.
 * Pure — no DOM access; both the DOM chart and `renderToString()` consume
 * the returned {@link Scene}. */
export function computeScene(
	data: TrendData,
	options: TrendChartOptions = {},
	ctx: SceneContext,
): Scene {
	// non-finite samples are dropped (see finiteSamples); `srcIndex` maps the
	// survivors back to the caller's dataset indices
	const { points, indices: srcIndex } = finiteSamples(normalizeData(data));
	const idPrefix = ctx.idPrefix ?? "tc";
	const cssVars = ctx.cssVars ?? false;

	const xAxis = options.xAxis ?? true;
	const yAxis = options.yAxis ?? true;
	const grid = options.grid ?? true;
	const lineWidth = options.lineWidth ?? DEFAULTS.lineWidth;
	const lineColor = options.lineColor ?? DEFAULTS.lineColor;
	const fillOpacity = options.fillOpacity ?? DEFAULTS.fillOpacity;
	const yTickCount = options.yTickCount ?? DEFAULTS.yTickCount;
	const pointRadius = options.pointRadius ?? DEFAULTS.pointRadius;
	const edge = Math.ceil(lineWidth / 2) + 2;

	const padding = {
		// with a y axis the topmost label needs half a line of headroom
		top: options.padding?.top ??
			(yAxis ? Math.max(edge, Math.ceil(FONT_SIZE / 2) + 2) : edge),
		right: options.padding?.right ?? edge,
		bottom: options.padding?.bottom ?? (xAxis ? FONT_SIZE + 14 : edge),
		left: options.padding?.left ?? (yAxis ? 40 : edge),
	};

	// --- domains ---------------------------------------------------------
	const fullX = dataRangeX(points);
	const domainX = ctx.domainX ?? options.domainX ?? fullX;

	const { points: slice, startIndex } = visibleSlice(points, domainX);

	let domainY: [number, number];
	// the `[min, max, step]` triple the y domain was derived from, kept in scope so
	// the ticks land on the very same lattice. Re-deriving them with a second
	// `niceDomain()` pass over the already-expanded domain can pick a coarser step
	// whose ticks miss the bound the chart expanded to, leaving it unlabeled.
	let yNice: [number, number, number] | null = null;
	const domainYOpt = options.domainY ?? (options.zones ? "full" : "auto");
	if (Array.isArray(domainYOpt)) {
		domainY = domainYOpt;
	} else {
		const raw = dataRangeY(domainYOpt === "full" ? points : slice);
		if (yAxis || grid) {
			const [min, max, step] = niceDomain(raw, yTickCount);
			yNice = [min, max, step];
			domainY = [Math.min(min, raw[0]), Math.max(max, raw[1])];
		} else {
			// axis-less (sparkline): hug the data, tiny relative pad
			const pad = (raw[1] - raw[0]) * 0.02 || Math.abs(raw[0]) * 0.02 || 0.5;
			domainY = [raw[0] - pad, raw[1] + pad];
		}
	}

	const cfg: ScaleConfig = {
		width: ctx.width,
		height: ctx.height,
		padding,
		domainX,
		domainY,
	};
	const plot = plotRect(cfg);

	// --- series geometry -------------------------------------------------
	const visible: ScenePoint[] = slice.map((p, i) => {
		const at = startIndex + i;
		return {
			px: scaleX(p.x, cfg),
			py: scaleY(p.y, cfg),
			x: p.x,
			y: p.y,
			// `ScenePoint.index` is documented as an index into the FULL dataset
			index: srcIndex ? srcIndex[at] : at,
		};
	});
	const px = visible.map((p) => ({ x: p.px, y: p.py }));
	const smooth = options.smooth ?? false;
	const linePath = buildLinePath(px, smooth);
	const fill = options.fill ?? true;
	const baselineY = plot.y + plot.height;
	const areaPath = fill === false ? "" : buildAreaPath(px, baselineY, smooth);

	// --- gradients --------------------------------------------------------
	const gy = { y1: plot.y, y2: plot.y + plot.height };
	let strokeGradient: SceneGradient | null = null;
	let fillGradient: SceneGradient | null = null;
	if (options.zones) {
		strokeGradient = {
			id: `${idPrefix}-stroke`,
			...gy,
			stops: zoneGradientStops(options.zones, domainY),
		};
		if (fill !== false) {
			fillGradient = {
				id: `${idPrefix}-fill`,
				...gy,
				stops: zoneGradientStops(options.zones, domainY, fillOpacity),
			};
		}
	} else if (fill !== false) {
		const base = typeof fill === "string"
			? fill
			: cssColor("fill", lineColor, cssVars);
		fillGradient = {
			id: `${idPrefix}-fill`,
			...gy,
			stops: [
				{ offset: 0, color: base, opacity: fillOpacity },
				{ offset: 1, color: base, opacity: 0 },
			],
		};
	}

	// --- axes / grid -------------------------------------------------------
	// explicit `domainY` arrays have no pass-1 step, so they still go through niceTicks
	const yTicks = yAxis || grid
		? (yNice && yNice[2]
			? ticksForStep(yNice[0], yNice[1], yNice[2])
			: niceTicks(domainY, yTickCount))
		: [];
	const inPlotY = yTicks.filter((v) => v >= domainY[0] && v <= domainY[1]);
	const formatY = options.formatY ?? String;
	const formatX = options.formatX ?? String;

	const gridLines = grid
		? inPlotY.map((v) => {
			const y = scaleY(v, cfg);
			return { x1: plot.x, y1: y, x2: plot.x + plot.width, y2: y };
		})
		: [];

	const yLabels: SceneText[] = yAxis
		? inPlotY.map((v) => ({
			x: plot.x - 8,
			y: scaleY(v, cfg) + FONT_SIZE * 0.35,
			text: formatY(v),
			anchor: "end" as const,
		}))
		: [];

	// default x ticks snap to real data points (evenly index-spaced) so labels
	// never show interpolated values; explicit xTicks options take over fully
	const xTickValues = options.xTicks !== undefined
		? resolveXTicks(domainX, plot.width, options.xTicks)
		: sampleTicks(
			visible.map((p) => p.x).filter((v) => v >= domainX[0] && v <= domainX[1]),
			Math.min(8, Math.max(2, Math.floor(plot.width / 80))),
		);
	const xLabels: SceneText[] = xAxis
		? xTickValues.map((v) => {
			const x = scaleX(v, cfg);
			// keep edge labels inside the svg
			const anchor = x - plot.x < 30
				? "start" as const
				: plot.x + plot.width - x < 30
				? "end" as const
				: "middle" as const;
			return {
				x,
				y: plot.y + plot.height + FONT_SIZE + 8,
				text: formatX(v),
				anchor,
			};
		})
		: [];

	// --- zones bands --------------------------------------------------------
	const bandsEnabled = options.zones && (options.zones.bands ?? true);
	const bands = bandsEnabled && options.zones
		? zoneBands(options.zones, domainY, plot, { fontSize: FONT_SIZE })
		: [];

	// --- annotations ---------------------------------------------------------
	// Context events, not data: a vertical rule at a data x. Only the geometry is
	// computed here — the note itself is the host's to render (see the
	// `onAnnotation*` callbacks). Labels are placed greedily left-to-right and
	// dropped on collision; the rule always survives, so an annotation never
	// vanishes silently just because the window got crowded.
	const annotations: SceneAnnotation[] = [];
	for (const [index, a] of (options.annotations ?? []).entries()) {
		if (!a || !Number.isFinite(a.x)) continue;
		if (a.x < domainX[0] || a.x > domainX[1]) continue;
		annotations.push({
			px: scaleX(a.x, cfg),
			y1: plot.y,
			y2: plot.y + plot.height,
			x: a.x,
			index,
			// an explicit color wins verbatim; the default stays themable
			color: a.color ?? cssColor("annotation", DEFAULTS.annotationColor, cssVars),
			dash: a.dash ?? true,
		});
	}
	annotations.sort((a, b) => a.px - b.px);

	let lastLabelRight = -Infinity;
	for (const a of annotations) {
		const label = options.annotations?.[a.index]?.label;
		if (!label) continue;
		// no text metrics without a DOM — estimate, deliberately generous
		const w = label.length * FONT_SIZE * 0.6;
		// flip to the left of the rule rather than overflow the plot
		const right = a.px + 4 + w <= plot.x + plot.width;
		const left = right ? a.px + 4 : a.px - 4 - w;
		if (left < plot.x || left < lastLabelRight + 4) continue;
		a.label = {
			x: right ? a.px + 4 : a.px - 4,
			y: plot.y + FONT_SIZE,
			text: label,
			anchor: right ? "start" : "end",
		};
		lastLabelRight = left + w;
	}

	// --- points / end dot ----------------------------------------------------
	const pointsMode = options.points ?? "nearest";
	const markers = pointsMode === "all" ? visible : [];

	let endDot: Scene["endDot"] = null;
	if (options.endDot) {
		const cfgDot = typeof options.endDot === "object" ? options.endDot : {};
		const last = visible.length ? visible[visible.length - 1] : null;
		// only emphasize the true end of the dataset (not a pan-window edge);
		// with trailing samples dropped, the last plottable one is that end
		const lastIndex = points.length
			? (srcIndex ? srcIndex[srcIndex.length - 1] : points.length - 1)
			: -1;
		if (last && last.index === lastIndex) {
			endDot = {
				px: last.px,
				py: last.py,
				r: cfgDot.r ?? Math.max(4, lineWidth * 1.75),
				color: cfgDot.color ?? cssColor("line", lineColor, cssVars),
				ringColor: cfgDot.ringColor ??
					cssColor("end-dot-ring", "#ffffff", cssVars),
			};
		}
	}

	return {
		width: ctx.width,
		height: ctx.height,
		plot,
		domainX,
		domainY,
		linePath,
		areaPath,
		lineColor: strokeGradient ? lineColor : cssColor("line", lineColor, cssVars),
		lineWidth,
		strokeGradient,
		fillGradient,
		bands,
		grid: gridLines,
		yLabels,
		xLabels,
		markers,
		visible,
		annotations,
		endDot,
		pointRadius,
		fontSize: FONT_SIZE,
		ariaLabel: options.ariaLabel,
		cssVars,
		idPrefix,
	};
}
