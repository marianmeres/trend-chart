/** A single data sample. `x` must be numeric (timestamp in ms, index, ...) and
 * monotonically non-decreasing across the dataset.
 *
 * Samples with a non-finite `x` or `y` (`NaN`, `±Infinity`) are **dropped** —
 * the line simply bridges the gap with a straight segment, and the axes are
 * fitted to the remaining samples. Indices reported by
 * {@link PointEvent.index} / {@link ScenePoint.index} stay indices into the
 * dataset you passed in, gaps included. */
export interface DataPoint {
	/** Position on the x axis (timestamp in ms, index, ... — the semantics are
	 * the host's business). */
	x: number;
	/** Value on the y axis. */
	y: number;
}

/** Accepted input data: `DataPoint[]`, or a plain `number[]` shorthand where
 * each value is `y` and its array index becomes `x`. */
export type TrendData = number[] | DataPoint[];

/** Value-zone configuration (e.g. heart-rate zones). */
export interface ZoneConfig {
	/** Ascending zone boundaries, e.g. `[55, 90, 115, 135]` for 3 zones. */
	boundaries: number[];
	/** One color per zone, `length === boundaries.length - 1`. */
	colors: string[];
	/** Optional labels rendered on the background bands, same length as `colors`. */
	labels?: string[];
	/** Render background band rects. Default `true` when zones are configured. */
	bands?: boolean;
}

/** Plot paddings in px. */
export interface Padding {
	/** Space above the plot (headroom for the topmost y label). */
	top: number;
	/** Space right of the plot. */
	right: number;
	/** Space below the plot (room for x labels). */
	bottom: number;
	/** Space left of the plot (room for y labels). */
	left: number;
}

/** Payload for point click/hover callbacks. */
export interface PointEvent {
	/** The data point (in data space). */
	point: DataPoint;
	/** Index into the full dataset (not the visible slice). */
	index: number;
	/** Pixel position within the svg. */
	pixel: { x: number; y: number };
}

/** A context annotation: a note on the x axis that is *not* a data point — the
 * day a refinery went offline, a deploy, a policy change. The library says
 * **where** it is and fires **when** it is interacted with; rendering the note
 * itself (tooltip, popover, side panel) stays the host's business. */
export interface Annotation {
	/** Position on the x axis, same units as {@link DataPoint.x}. Need not
	 * coincide with a sample — an event happens when it happens. */
	x: number;
	/** Short label drawn at the top of the rule. Keep it short: it is dropped
	 * (the rule stays) when it would collide with an already placed one. */
	label?: string;
	/** Rule and label color. Default `#f59e0b`. */
	color?: string;
	/** Dashed rule, so it never reads as data. Default `true`. */
	dash?: boolean;
	/** Opaque passthrough handed back on every {@link AnnotationEvent} — an id,
	 * a record, the full note text. Never inspected by the library. */
	data?: unknown;
}

/** Payload for annotation click/hover callbacks. */
export interface AnnotationEvent {
	/** The annotation as configured (including its `data` passthrough). */
	annotation: Annotation;
	/** Index into the `annotations` array that was passed in. */
	index: number;
	/** Pixel position of the rule's top end within the svg — anchor a tooltip here. */
	pixel: { x: number; y: number };
}

/** X tick placement: target count, explicit values, or a resolver callback. */
export type XTicksOption =
	| number
	| number[]
	| ((domain: [number, number]) => number[]);

/** All chart options. Every member is optional — defaults favor the plain
 * "line with axes and grid" look. */
export interface TrendChartOptions {
	/** Fixed width in px. Default: container width (kept in sync via ResizeObserver). */
	width?: number;
	/** Fixed height in px. Default: container height (kept in sync via ResizeObserver). */
	height?: number;
	/** Plot padding overrides. Defaults adapt to which axes are visible. */
	padding?: Partial<Padding>;

	/** Line stroke color. Default `#4a9eed`. Ignored for stroke when zones are set. */
	lineColor?: string;
	/** Line stroke width in px. Default `2`. */
	lineWidth?: number;
	/** Curve smoothing: `false` (default) straight segments, `true` full
	 * Catmull-Rom smoothing, or a `0..1` tension value. */
	smooth?: boolean | number;
	/** Area fill under the line: `true` (default) fades the line color to
	 * transparent, `false` disables, a string sets an explicit base color. */
	fill?: boolean | string;
	/** Max opacity of the area fill. Default `0.15`. */
	fillOpacity?: number;
	/** Emphasized marker on the dataset's last point (hidden while that point
	 * is panned out of view). Default `false`. */
	endDot?: boolean | { r?: number; color?: string; ringColor?: string };

	/** Render x axis labels. Default `true`. */
	xAxis?: boolean;
	/** Render y axis labels. Default `true`. */
	yAxis?: boolean;
	/** Render horizontal gridlines. Default `true`. */
	grid?: boolean;
	/** Target y tick count for the nice-ticks algorithm. Default `5`. */
	yTickCount?: number;
	/** X tick placement: target count, explicit values or a resolver. Default:
	 * ~evenly index-spaced *real data points*, so labels never show interpolated
	 * values. */
	xTicks?: XTicksOption;
	/** X label formatter (dates etc. are the host's business). Default `String`. */
	formatX?: (x: number) => string;
	/** Y label formatter. Default `String`. */
	formatY?: (y: number) => string;

	/** Initial visible x window. Default: full data range. */
	domainX?: [number, number];
	/** Y domain: fixed range, `"auto"` (fit visible slice) or `"full"` (fit whole
	 * dataset). Default `"auto"`, or `"full"` when zones are configured. */
	domainY?: [number, number] | "auto" | "full";

	/** Enable drag panning. Default `true`. */
	pan?: boolean;
	/** Enable wheel/pinch zooming. Default `true`. */
	zoom?: boolean;
	/** Smallest allowed visible x span when zooming in. Default: ~3 points. */
	minDomainSpan?: number;
	/** Point markers: `"all"` renders a marker per visible point, `"nearest"`
	 * (default) highlights only the hovered point, `"none"` disables. */
	points?: "all" | "nearest" | "none";
	/** Marker radius in px. Default `3`. */
	pointRadius?: number;

	/** Fired on click near a data point. */
	onPointClick?: (event: PointEvent) => void;
	/** Fired when the hovered nearest point changes (`null` = none). */
	onPointHover?: (event: PointEvent | null) => void;
	/** Fired whenever the visible x window changes (gesture or programmatic). */
	onDomainChange?: (domainX: [number, number]) => void;

	/** Value-zone coloring. */
	zones?: ZoneConfig;

	/** Context annotations — events on the x axis that are not data points.
	 * Ones outside the visible window are simply not rendered. */
	annotations?: Annotation[];
	/** Fired when the hovered annotation changes (`null` = none). */
	onAnnotationHover?: (event: AnnotationEvent | null) => void;
	/** Fired on click near an annotation rule. Takes precedence over
	 * `onPointClick` when both would hit (annotations are the sparser,
	 * more deliberate target) — but only if this handler is set. */
	onAnnotationClick?: (event: AnnotationEvent) => void;

	/** Extra class name(s) on the root `<svg>`. */
	class?: string;
	/** Accessible label (`aria-label` + `<title>`). */
	ariaLabel?: string;
	/** Emit colors as `var(--trend-chart-*, fallback)` so hosts can theme via
	 * CSS. Default: `true` in the DOM chart, `false` in `renderToString()`. */
	cssVars?: boolean;
}

/* ------------------------------------------------------------------ */
/* Scene model (computed geometry — the contract between chart logic  */
/* and the two renderers: DOM and string)                             */
/* ------------------------------------------------------------------ */

/** A gradient color stop; `offset` is `0..1` from gradient start. */
export interface GradientStop {
	/** Position along the gradient, `0..1`. */
	offset: number;
	/** Stop color (may be a `var(--trend-chart-*, fallback)` reference). */
	color: string;
	/** Stop opacity. Default: fully opaque. */
	opacity?: number;
}

/** A vertical linear gradient in user (pixel) space, spanning the plot height. */
export interface SceneGradient {
	/** Svg def id to reference via `url(#id)`. */
	id: string;
	/** Pixel y of gradient start (plot top). */
	y1: number;
	/** Pixel y of gradient end (plot bottom). */
	y2: number;
	/** Color stops, ascending by `offset`. */
	stops: GradientStop[];
}

/** A positioned text label. */
export interface SceneText {
	/** Pixel x of the text anchor. */
	x: number;
	/** Pixel y of the text baseline. */
	y: number;
	/** The (unescaped) label content. */
	text: string;
	/** Svg `text-anchor` for the given `x`. */
	anchor: "start" | "middle" | "end";
}

/** A gridline. */
export interface SceneLine {
	/** Pixel x of the line start. */
	x1: number;
	/** Pixel y of the line start. */
	y1: number;
	/** Pixel x of the line end. */
	x2: number;
	/** Pixel y of the line end. */
	y2: number;
}

/** A zone background band. */
export interface SceneBand {
	/** Pixel x of the band rect (plot left). */
	x: number;
	/** Pixel y of the band rect top. */
	y: number;
	/** Band width in px (plot width). */
	width: number;
	/** Band height in px. */
	height: number;
	/** Zone color. */
	color: string;
	/** Band fill opacity (bands are decorative context, not the series). */
	opacity: number;
	/** Zone label, present only if configured and the band is tall enough. */
	label?: SceneText;
}

/** A visible data point mapped to pixel space. */
export interface ScenePoint {
	/** Pixel x. */
	px: number;
	/** Pixel y. */
	py: number;
	/** Data x. */
	x: number;
	/** Data y. */
	y: number;
	/** Index into the full dataset. */
	index: number;
}

/** An {@link Annotation} mapped to pixel space: a vertical rule spanning the
 * plot, with its label already placed (or dropped, on collision). */
export interface SceneAnnotation {
	/** Pixel x of the rule. */
	px: number;
	/** Pixel y of the rule's top end (plot top). */
	y1: number;
	/** Pixel y of the rule's bottom end (plot bottom). */
	y2: number;
	/** Data x. */
	x: number;
	/** Index into the `annotations` option array. */
	index: number;
	/** Resolved rule/label color. */
	color: string;
	/** Whether the rule is dashed. */
	dash: boolean;
	/** Placed label — absent when unset, or dropped to avoid a collision. */
	label?: SceneText;
}

/** Fully computed, renderer-independent description of one chart frame. */
export interface Scene {
	/** Svg width in px. */
	width: number;
	/** Svg height in px. */
	height: number;
	/** Inner plot rectangle (the area between the paddings), in px. */
	plot: { x: number; y: number; width: number; height: number };
	/** Visible x window this frame was computed for. */
	domainX: [number, number];
	/** Resolved y range this frame was computed for. */
	domainY: [number, number];
	/** `d` attribute of the series line (`""` for fewer than 2 points). */
	linePath: string;
	/** `d` attribute of the closed fill area (`""` when `fill: false`). */
	areaPath: string;
	/** Resolved stroke color; ignored when `strokeGradient` is set. */
	lineColor: string;
	/** Stroke width in px. */
	lineWidth: number;
	/** Zone gradient for the stroke, `null` when no zones. */
	strokeGradient: SceneGradient | null;
	/** Area fill gradient, `null` when `fill: false`. */
	fillGradient: SceneGradient | null;
	/** Zone background bands (empty when zones are off). */
	bands: SceneBand[];
	/** Horizontal gridlines (empty when `grid: false`). */
	grid: SceneLine[];
	/** Y axis labels (empty when `yAxis: false`). */
	yLabels: SceneText[];
	/** X axis labels (empty when `xAxis: false`). */
	xLabels: SceneText[];
	/** Static markers (only in `points: "all"` mode). */
	markers: ScenePoint[];
	/** All visible points (hit-testing source, superset of `markers`). */
	visible: ScenePoint[];
	/** Visible context annotations, ascending by `px` (hit-testing source). */
	annotations: SceneAnnotation[];
	/** Emphasized last-point marker, `null` when disabled or panned out of view. */
	endDot:
		| { px: number; py: number; r: number; color: string; ringColor: string }
		| null;
	/** Marker/hover dot radius in px. */
	pointRadius: number;
	/** Label font size in px. */
	fontSize: number;
	/** Accessible label (`aria-label` + `<title>`), if configured. */
	ariaLabel?: string;
	/** Whether colors are emitted as `var(--trend-chart-*, fallback)`. */
	cssVars: boolean;
	/** Unique prefix for def ids (gradients, clip path). */
	idPrefix: string;
}
