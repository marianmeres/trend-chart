# @marianmeres/trend-chart

[![NPM](https://img.shields.io/npm/v/@marianmeres/trend-chart)](https://www.npmjs.com/package/@marianmeres/trend-chart)
[![JSR](https://jsr.io/badges/@marianmeres/trend-chart)](https://jsr.io/@marianmeres/trend-chart)
[![License](https://img.shields.io/npm/l/@marianmeres/trend-chart)](LICENSE)

Framework-agnostic, zero-dependency single-series trend chart (SVG). Line/area
rendering with optional smoothing, value-zone coloring, axes and gridlines,
domain pan/zoom (drag, wheel, pinch), point interaction, context annotations —
and server-side rendering to a static SVG string (no DOM required).

Single purpose by design: one line/area series. No bars, pies, or multi-series.

## Installation

```bash
deno add jsr:@marianmeres/trend-chart
```

```bash
npm install @marianmeres/trend-chart
```

## Usage

### Interactive chart (browser)

```typescript
import { TrendChart } from "@marianmeres/trend-chart";

const chart = new TrendChart(
	document.querySelector("#chart")!,
	[{ x: 1700000000000, y: 42 }, { x: 1700000060000, y: 45 } /* ... */],
	{
		smooth: true,
		endDot: true,
		formatX: (x) => new Date(x).toLocaleTimeString(),
		onPointClick: (e) => console.log(e.point, e.index),
	},
);

// later
chart.update(newData);
chart.setDomainX([from, to]); // programmatic pan/zoom
chart.resetDomain();
chart.destroy();
```

The chart sizes itself to its container (and follows it via `ResizeObserver`)
unless explicit `width`/`height` are given — so the container needs a non-zero
size of its own (a `div` with no height renders nothing). Pan by dragging,
zoom with the mouse wheel or pinch — both enabled by default, disable with
`{ pan: false, zoom: false }`.

Gappy data is fine: samples whose `x` or `y` is `NaN` or `±Infinity` are
dropped and the line bridges the gap: no truncated render, no distorted axes.

### Sparkline

A plain `number[]` works as data (index becomes `x`):

```typescript
new TrendChart(el, [3, 5, 4, 8, 6], {
	xAxis: false,
	yAxis: false,
	grid: false,
	pan: false,
	zoom: false,
	points: "none",
});
```

### Value zones (e.g. heart-rate zones)

```typescript
new TrendChart(el, data, {
	zones: {
		boundaries: [55, 90, 115, 135, 175],
		colors: ["#22c55e", "#eab308", "#f97316", "#ef4444"],
		labels: ["easy", "steady", "hard", "max"],
	},
});
```

The line and area are colored by value using hard-stop gradients; translucent
background bands (with optional labels) provide context.

### Context annotations

Not every mark on a chart is a data point. An annotation marks _why_ the line
does what it does at some `x` — the day a supplier went bankrupt, a deploy, a
policy change:

```typescript
new TrendChart(el, gasPrices, {
	annotations: [
		{ x: Date.UTC(2026, 1, 3), label: "Helios files Ch.11", data: article },
		{ x: Date.UTC(2026, 2, 18), label: "OPEC+ output raise" },
	],
	onAnnotationClick: (e) => showArticle(e.annotation.data, e.pixel),
});
```

The chart draws a dashed vertical rule behind the series (data always wins
visually) with the short `label` on top, and hands the annotation back — `data`
untouched — on hover and click. **The library says where it is and fires when
it is interacted with; the host says what it means.** Rendering the note itself
stays yours, exactly as with points: there is still no built-in tooltip.

Annotations pan and zoom with the series and are dropped when they leave the
window. In a crowded window a colliding _label_ is dropped; its rule never is.

### Per-point metadata

A sample can carry a `data` payload too — the same opaque-passthrough contract
as annotations: never plotted, never inspected, handed back verbatim on hover
and click:

```typescript
new TrendChart(el, [
	{ x: t0, y: 84, data: { deviceId: "sensor-2", raw: reading } },
	// ...
], {
	onPointClick: (e) => showDetail(e.point.data),
});
```

### Server-side rendering (Deno, no DOM)

```typescript
import { renderToString } from "@marianmeres/trend-chart";

const svg = renderToString([3, 5, 4, 8, 6], {
	width: 300,
	height: 80,
	xAxis: false,
	yAxis: false,
	grid: false,
});
// → "<svg …>…</svg>" — self-contained static markup
```

### Theming via CSS custom properties

Rendered colors are wrapped as `var(--trend-chart-*, fallback)` (DOM chart
default; opt-in for `renderToString` via `cssVars: true`), so hosts can theme
without JS — e.g. dark mode:

```css
.my-dashboard {
	--trend-chart-line: #a78bfa;
	--trend-chart-fill: #a78bfa;
	--trend-chart-grid: #312e81;
	--trend-chart-label: #9ca3af;
	--trend-chart-annotation: #f59e0b;
	--trend-chart-annotation-halo: #1e1b4b; /* the page background */
}
```

## Example

An interactive showcase of everything above — pan/zoom, live option toggles,
sparklines, streaming `update()`, `renderToString()` output and runtime theme
switching — lives in [`example/index.html`](example/index.html):

```bash
deno task example:build   # bundle example/src -> example/dist/bundle.js
deno task example:serve   # then open http://localhost:8000
```

`deno task example:watch` rebuilds on change (library sources included), and
`deno task example:themes` regenerates the theme CSS the page switches between.

## API

See [API.md](API.md) for complete API documentation.

## License

[MIT](LICENSE)
