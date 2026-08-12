/**
 * @module @marianmeres/trend-chart
 *
 * Framework-agnostic, zero-dependency single-series trend chart (SVG).
 * Line/area rendering with optional smoothing, value-zone coloring, axes,
 * gridlines, pan/zoom, point interaction and context annotations — plus
 * server-side rendering to a static SVG string.
 */

export * from "./types.ts";
export { TrendChart } from "./trend-chart.ts";
export { renderToString, sceneToString } from "./render-string.ts";
export { computeScene, normalizeData, type SceneContext } from "./scene.ts";
export { attachGestures, type GestureHooks } from "./gestures.ts";

// pure helpers (useful on their own)
export {
	clampDomainX,
	dataRangeX,
	dataRangeY,
	invertX,
	plotRect,
	type ScaleConfig,
	scaleX,
	scaleY,
} from "./scale.ts";
export { buildAreaPath, buildLinePath, type PxPoint, visibleSlice } from "./path.ts";
export {
	evenTicks,
	niceDomain,
	niceTicks,
	resolveXTicks,
	sampleTicks,
	ticksForStep,
} from "./ticks.ts";
export { zoneBands, zoneColorAt, zoneGradientStops } from "./zones.ts";
