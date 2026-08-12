/**
 * Bundle entry for `example/index.html`.
 *
 * Bundles the two libraries the page needs into a single browser ES module
 * (`example/dist/bundle.js`) via @marianmeres/deno-build:
 *
 *   · @marianmeres/trend-chart — THIS checkout (`../../src/mod.ts`), so the
 *     example always shows the local source, not a published version.
 *   · @marianmeres/vanilla     — the tiny reactive DOM layer that wires the
 *     example's own controls (not a dependency of the chart itself).
 *
 * Build:  deno task example:build   (or example:watch)
 */
export { renderToString, TrendChart } from "../../src/mod.ts";

export {
	applyBindings,
	delegate,
	enhance,
	fromTemplate,
	observable,
	reactTo,
	refs,
} from "jsr:@marianmeres/vanilla@^1.8.0";
