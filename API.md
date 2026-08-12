# API

Single-series trend chart. Two entry points: the interactive
[`TrendChart`](#trendchart) class (browser) and the static
[`renderToString`](#rendertostringdata-options) function (any JS runtime, no
DOM). Both consume the same [options](#trendchartoptions).

## Classes

### `TrendChart`

Interactive SVG chart. The SVG element tree is built once in the constructor;
every redraw (pan, zoom, resize, data update) only patches attributes.

```typescript
new TrendChart(container: HTMLElement, data: TrendData, options?: TrendChartOptions)
```

- `container` — host element; the chart appends an `<svg>` to it and follows
  the container's size via `ResizeObserver` (unless `width`/`height` options
  are set). It must have a non-zero size — a container with no intrinsic
  height (the usual CSS trap) renders nothing until it gets one, or until
  explicit `width`/`height` are passed.
- `data` — `DataPoint[]` or `number[]` shorthand (see [`TrendData`](#trenddata)).
- `options` — see [`TrendChartOptions`](#trendchartoptions).

**Methods:**

| Method                                                  | Description                                                                                                          |
| ------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| `update(data: TrendData): void`                         | Replace the dataset, keep options. The visible window is clamped; if it followed the full range, it keeps following. |
| `setOptions(options: Partial<TrendChartOptions>): void` | Merge in new options and re-render.                                                                                  |
| `setDomainX(domainX: [number, number]): void`           | Programmatic pan/zoom (clamped to the data range).                                                                   |
| `getDomainX(): [number, number]`                        | The currently visible x window.                                                                                      |
| `resetDomain(): void`                                   | Zoom out to the full data range.                                                                                     |
| `destroy(): void`                                       | Remove listeners/observers and detach the svg.                                                                       |

**Example:**

```typescript
const chart = new TrendChart(el, data, {
	smooth: true,
	endDot: true,
	onDomainChange: (d) => console.log("visible:", d),
});
chart.setDomainX([Date.parse("2026-08-01"), Date.parse("2026-08-12")]);
chart.destroy();
```

**Interaction defaults:** drag pans, wheel/pinch zooms (toward the cursor /
pinch midpoint), hovering highlights the nearest visible point, clicking fires
`onPointClick`. Disable via `pan`, `zoom`, `points` options. While `pan` is on,
the svg is set `user-select: none` (a drag must not highlight the axis labels)
and `cursor: grab`; with gestures on, `touch-action: none`. All three are
cleared when the corresponding option is turned off.

---

## Functions

### `renderToString(data, options)`

Render a chart to a self-contained static SVG string — no DOM required, works
in pure Deno/Node (SSR pages, emails, docs). Interactive options are ignored.

**Parameters:**

- `data` ([`TrendData`](#trenddata)) — the series
- `options` ([`TrendChartOptions`](#trendchartoptions) & `{ width: number; height: number }`) —
  `width`/`height` are **required** (there is no container to measure); throws
  otherwise. `cssVars` defaults to `false` here (resolved literal colors).

**Returns:** `string` — `<svg …>…</svg>` markup.

**Example:**

```typescript
const svg = renderToString([3, 5, 4, 8, 6], { width: 300, height: 80 });
```

### Lower-level building blocks

The internals are exported for advanced use (custom renderers, testing):

| Export                                        | Description                                                                                                                             |
| --------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| `computeScene(data, options, ctx)`            | Pure: data + options + `{width, height, domainX?, idPrefix?, cssVars?}` → [`Scene`](#scene) (all geometry and styles resolved, no DOM). |
| `sceneToString(scene)`                        | Serialize a `Scene` to SVG markup (what `renderToString` uses).                                                                         |
| `normalizeData(data)`                         | `TrendData` → `DataPoint[]` (expands the `number[]` shorthand).                                                                         |
| `attachGestures(svg, hooks)`                  | Pan/wheel/pinch wiring used by `TrendChart`; returns a detach function.                                                                 |
| `scaleX/scaleY/invertX(value, cfg)`           | Data ↔ pixel mapping for a `ScaleConfig`.                                                                                               |
| `plotRect(cfg)`                               | Inner plot rectangle for a `ScaleConfig`.                                                                                               |
| `clampDomainX(domain, full, minSpan?)`        | Clamp a visible window into the data range, preserving span.                                                                            |
| `dataRangeX/dataRangeY(points)`               | Min/max over a dataset.                                                                                                                 |
| `buildLinePath(points, smooth?)`              | Pixel points → SVG path `d` (straight or Catmull-Rom smoothed).                                                                         |
| `buildAreaPath(points, baselineY, smooth?)`   | Closed fill-area variant of the above.                                                                                                  |
| `visibleSlice(points, domainX, overscan?)`    | Slice a dataset to the visible window (+1 overscan point per side).                                                                     |
| `niceTicks(domain, targetCount?)`             | "Nice numbers" tick values (1/2/5 × 10ⁿ steps).                                                                                         |
| `niceDomain(domain, targetCount?)`            | Expand a domain outward to nice bounds; returns `[min, max, step]`.                                                                     |
| `ticksForStep(min, max, step)`                | Ticks at a given step covering `[min, max]` — companion to `niceDomain`'s triple.                                                       |
| `evenTicks(domain, count)`                    | Evenly spaced values, endpoints included.                                                                                               |
| `sampleTicks(samples, count)`                 | ~`count` evenly index-spaced real sample values (default x ticks).                                                                      |
| `resolveXTicks(domain, plotWidth, option?)`   | Resolve an `xTicks` option to concrete values.                                                                                          |
| `zoneGradientStops(zones, domainY, opacity?)` | Hard-stop gradient stops for zone coloring.                                                                                             |
| `zoneBands(zones, domainY, plot, opts?)`      | Zone background band rects in pixel space.                                                                                              |
| `zoneColorAt(zones, value)`                   | Color of the zone containing a value.                                                                                                   |

---

## Types

### `TrendData`

```typescript
type TrendData = number[] | DataPoint[];
```

A plain `number[]` is treated as y-values with their array index as `x`
(convenient for sparklines).

### `DataPoint`

```typescript
interface DataPoint {
	x: number; // timestamp (ms), index, ... — numeric and non-decreasing
	y: number;
}
```

`x` semantics are the host's business — the chart only needs numbers. Format
labels via `formatX`/`formatY`.

**Non-finite samples** (`NaN`, `±Infinity` in `x` or `y`) are dropped: the line
bridges the gap with a straight segment and the axes fit only the remaining
samples. Nothing else shifts — `PointEvent.index` and `ScenePoint.index` remain
indices into the array you passed in, dropped samples included — and an
all-non-finite dataset renders as the empty scene. (Emitting a non-finite
coordinate instead would silently truncate the line: per the SVG spec a path
stops rendering at the first erroneous command.)

### `TrendChartOptions`

All optional. Defaults produce a "line with y axis, x labels and gridlines"
look.

| Option                   | Type                                         | Default                         | Description                                                                                                                                   |
| ------------------------ | -------------------------------------------- | ------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `width`, `height`        | `number`                                     | container size                  | Fixed size in px. When omitted, the container is measured and observed.                                                                       |
| `padding`                | `Partial<Padding>`                           | adaptive                        | Plot padding; defaults adapt to axis visibility and line width.                                                                               |
| `lineColor`              | `string`                                     | `#4a9eed`                       | Stroke color (ignored for the stroke when `zones` set).                                                                                       |
| `lineWidth`              | `number`                                     | `2`                             | Stroke width in px.                                                                                                                           |
| `smooth`                 | `boolean \| number`                          | `false`                         | `true` = Catmull-Rom smoothing, number = tension `0..1`, `false` = straight segments.                                                         |
| `fill`                   | `boolean \| string`                          | `true`                          | Area fill: `true` fades `lineColor` to transparent, string = explicit base color, `false` = none.                                             |
| `fillOpacity`            | `number`                                     | `0.15`                          | Max fill opacity.                                                                                                                             |
| `endDot`                 | `boolean \| {r?, color?, ringColor?}`        | `false`                         | Emphasized marker on the dataset's last point (hidden when panned out of view).                                                               |
| `xAxis`, `yAxis`, `grid` | `boolean`                                    | `true`                          | Independently toggle x labels, y labels, horizontal gridlines. All off = sparkline.                                                           |
| `yTickCount`             | `number`                                     | `5`                             | Target count for nice y ticks.                                                                                                                |
| `xTicks`                 | `number \| number[] \| (domain) => number[]` | data-point snapped              | Tick count, explicit values, or resolver. Default picks ~evenly spaced _real data points_. Use the callback + `formatX` for round time ticks. |
| `formatX`, `formatY`     | `(v: number) => string`                      | `String`                        | Label formatters. Date/number formatting is deliberately the host's job.                                                                      |
| `domainX`                | `[number, number]`                           | full range                      | Initial visible window.                                                                                                                       |
| `domainY`                | `[number, number] \| "auto" \| "full"`       | `"auto"` (`"full"` with zones)  | Fixed range, fit visible slice, or fit whole dataset.                                                                                         |
| `pan`, `zoom`            | `boolean`                                    | `true`                          | Drag panning / wheel + pinch zooming.                                                                                                         |
| `minDomainSpan`          | `number`                                     | ~3 points                       | Zoom-in limit.                                                                                                                                |
| `points`                 | `"all" \| "nearest" \| "none"`               | `"nearest"`                     | Static marker per point, hover-highlight nearest only, or no point interaction.                                                               |
| `pointRadius`            | `number`                                     | `3`                             | Marker radius.                                                                                                                                |
| `onPointClick`           | `(e: PointEvent) => void`                    | —                               | Click near a point.                                                                                                                           |
| `onPointHover`           | `(e: PointEvent \| null) => void`            | —                               | Nearest hovered point changed (`null` = left).                                                                                                |
| `onDomainChange`         | `(domainX) => void`                          | —                               | Visible window changed (gesture or programmatic).                                                                                             |
| `zones`                  | `ZoneConfig`                                 | —                               | Value-zone coloring, see below.                                                                                                               |
| `annotations`            | `Annotation[]`                               | —                               | Context events on the x axis (not data points), see below. Ones outside the visible window are not rendered.                                  |
| `onAnnotationHover`      | `(e: AnnotationEvent \| null) => void`       | —                               | Hovered annotation changed (`null` = left).                                                                                                   |
| `onAnnotationClick`      | `(e: AnnotationEvent) => void`               | —                               | Click near an annotation rule.                                                                                                                |
| `class`                  | `string`                                     | —                               | Extra class on the root svg.                                                                                                                  |
| `ariaLabel`              | `string`                                     | —                               | Accessible label (`aria-label` + `<title>`).                                                                                                  |
| `cssVars`                | `boolean`                                    | `true` (DOM) / `false` (string) | Wrap colors in `var(--trend-chart-*, fallback)`.                                                                                              |

### `ZoneConfig`

```typescript
interface ZoneConfig {
	boundaries: number[]; // ascending, e.g. [55, 90, 115, 135] = 3 zones
	colors: string[]; // one per zone: boundaries.length - 1
	labels?: string[]; // optional band labels
	bands?: boolean; // background bands, default true
}
```

Zone coloring applies to the stroke and fill via vertical hard-stop gradients;
values outside the boundaries clamp to the first/last zone color. With zones
configured, `domainY` defaults to `"full"` so bands don't jump while panning.

### `PointEvent`

```typescript
interface PointEvent {
	point: DataPoint;
	index: number; // into the full dataset, not the visible slice
	pixel: { x: number; y: number }; // svg coordinates (tooltip anchoring)
}
```

There is no built-in tooltip — render your own from `onPointHover`/`onPointClick`.

### `Annotation`

A context note on the x axis that is **not** a data point — the day a refinery
went offline, a deploy, a policy change. It answers "why does the line do that
here?", which a series alone cannot.

```typescript
interface Annotation {
	x: number; // same units as DataPoint.x; need not match a sample
	label?: string; // short label at the top of the rule
	color?: string; // default #f59e0b
	dash?: boolean; // dashed rule, default true
	data?: unknown; // opaque passthrough, handed back on every event
}
```

The division of labour is deliberate: **the library says where an annotation is
and fires when it is interacted with; the host says what it means.** The chart
draws a vertical rule (plus the short `label`, if it fits) and hands the whole
annotation back — `data` untouched — through `onAnnotationHover` /
`onAnnotationClick`. Rendering the actual note (tooltip, popover, side panel) is
the host's business, exactly as with points.

```typescript
new TrendChart(el, prices, {
	annotations: [
		{ x: Date.UTC(2026, 1, 3), label: "Helios files Ch.11", data: article },
	],
	onAnnotationClick: (e) => showArticle(e.annotation.data, e.pixel),
});
```

Label placement is intentionally dumb: labels are placed left to right and a
label that would collide with an already placed one is **dropped — its rule is
not**. So a crowded window loses text, never the marks themselves. A label that
would overflow the right edge flips to the left of its rule. Labels are drawn in
front of the series (with a halo, see `--trend-chart-annotation-halo`); rules are
drawn behind it, so data always wins visually.

Hit-testing radius is 8px — much tighter than the 30px used for points, since
annotations are sparse, deliberate targets. When both would hit, an annotation
wins the click — but only if `onAnnotationClick` is set, so an unhandled
annotation never becomes a dead zone inside the point hit radius. Hover is
independent: `onPointHover` and `onAnnotationHover` both fire.

### `AnnotationEvent`

```typescript
interface AnnotationEvent {
	annotation: Annotation; // as configured, including `data`
	index: number; // into the `annotations` option array
	pixel: { x: number; y: number }; // rule's top end (tooltip anchoring)
}
```

### `Scene`

The renderer-independent output of `computeScene()` — one fully resolved chart
frame. Both built-in renderers (`TrendChart`, `sceneToString`) consume only
this, so it is also what a custom renderer or a DOM-less snapshot test works
against.

```typescript
interface Scene {
	width: number;
	height: number;
	plot: { x: number; y: number; width: number; height: number };
	domainX: [number, number];
	domainY: [number, number];
	linePath: string; // svg path `d` ("" for < 2 points)
	areaPath: string; // closed fill path ("" when fill: false)
	lineColor: string; // ignored when strokeGradient is set
	lineWidth: number;
	strokeGradient: SceneGradient | null; // zone coloring
	fillGradient: SceneGradient | null;
	bands: SceneBand[]; // zone background bands
	grid: SceneLine[];
	yLabels: SceneText[];
	xLabels: SceneText[];
	markers: ScenePoint[]; // only in points: "all"
	visible: ScenePoint[]; // all visible points (hit-test source)
	annotations: SceneAnnotation[]; // visible annotations, ascending by px
	endDot: { px; py; r; color; ringColor } | null;
	pointRadius: number;
	fontSize: number;
	ariaLabel?: string;
	cssVars: boolean;
	idPrefix: string; // unique prefix for gradient/clip-path ids
}
```

Note: gridline and label _colors_ are not part of the scene — both renderers
apply the shared defaults (`#e5e7eb` / `#9ca3af`, wrapped in
`--trend-chart-grid` / `--trend-chart-label` when `cssVars` is on). A custom
renderer should do the same.

### Supporting types

```typescript
/** Plot paddings in px (resolved; the option accepts a Partial). */
interface Padding {
	top: number;
	right: number;
	bottom: number;
	left: number;
}

/** The `xTicks` option. */
type XTicksOption =
	| number // target count
	| number[] // explicit values (filtered to the domain)
	| ((domain: [number, number]) => number[]);

/** Everything the data↔pixel mapping helpers need. */
interface ScaleConfig {
	width: number;
	height: number;
	padding: Padding;
	domainX: [number, number];
	domainY: [number, number];
}

/** Sizing/identity context passed to `computeScene()`. */
interface SceneContext {
	width: number;
	height: number;
	domainX?: [number, number]; // default: full data range
	idPrefix?: string; // default: "tc"
	cssVars?: boolean; // default: false
}

/** Wiring `attachGestures()` needs; handlers never render, they only push domains. */
interface GestureHooks {
	pan: boolean;
	zoom: boolean;
	getScale(): ScaleConfig;
	getFullRange(): [number, number];
	getMinSpan(): number;
	setDomainX(domain: [number, number]): void;
}

/** Pixel-space point (input of the path builders). */
interface PxPoint {
	x: number;
	y: number;
}
```

Scene primitives — `GradientStop` (`offset`, `color`, `opacity?`),
`SceneGradient` (`id`, `y1`, `y2`, `stops`), `SceneText` (`x`, `y`, `text`,
`anchor`), `SceneLine` (`x1`, `y1`, `x2`, `y2`), `SceneBand` (rect + `color`,
`opacity`, optional `label`), `ScenePoint` (`px`, `py`, `x`, `y`, `index`) and
`SceneAnnotation` (`px`, `y1`, `y2`, `x`, `index`, `color`, `dash`, optional
`label`) — are all exported too; each member is documented in the type declarations.

---

## Styling

Stable class names on rendered elements: `trend-chart` (root svg),
`trend-chart-line`, `trend-chart-area`, `trend-chart-grid`,
`trend-chart-bands`, `trend-chart-markers`, `trend-chart-end-dot`,
`trend-chart-hover-dot`, `trend-chart-annotations`,
`trend-chart-annotation-labels`, `trend-chart-x-labels`,
`trend-chart-y-labels`.

CSS custom properties (all optional, fall back to option-derived values):

| Variable                        | Themes                                  |
| ------------------------------- | --------------------------------------- |
| `--trend-chart-line`            | line stroke                             |
| `--trend-chart-fill`            | area fill base color                    |
| `--trend-chart-grid`            | gridline stroke                         |
| `--trend-chart-label`           | axis label color                        |
| `--trend-chart-font`            | label font family                       |
| `--trend-chart-end-dot-ring`    | end-dot/hover-dot ring color            |
| `--trend-chart-annotation`      | annotation rule + label color           |
| `--trend-chart-annotation-halo` | halo punched behind an annotation label |
