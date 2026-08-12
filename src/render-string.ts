import type {
	Scene,
	SceneGradient,
	SceneText,
	TrendChartOptions,
	TrendData,
} from "./types.ts";
import { computeScene, cssColor } from "./scene.ts";

/** Escape text for use in markup (both text nodes and attribute values). */
function esc(s: string): string {
	return s
		.replaceAll("&", "&amp;")
		.replaceAll("<", "&lt;")
		.replaceAll(">", "&gt;")
		.replaceAll('"', "&quot;");
}

/** Escape a resolved color before it is interpolated into a `style` attribute.
 * Colors come from user options (`lineColor`, `zones.colors`, `endDot.color`, …)
 * so they are markup sinks like any other string — route every one through here. */
function color(c: string): string {
	return esc(c);
}

/** Round to 2 decimals to keep the markup compact. */
function n(v: number): number {
	return Math.round(v * 100) / 100;
}

const FONT_FAMILY = "ui-sans-serif, system-ui, sans-serif";

/** Inline `style` for axis/tick labels. */
function textStyle(scene: Scene): string {
	const fill = color(cssColor("label", "#9ca3af", scene.cssVars));
	return `fill:${fill};font-family:${FONT_FAMILY};font-size:${scene.fontSize}px`;
}

/** `<linearGradient>` element for a scene gradient. */
function gradientMarkup(g: SceneGradient): string {
	const stops = g.stops
		.map((s) => {
			const op = s.opacity === undefined ? "" : `;stop-opacity:${s.opacity}`;
			return `<stop offset="${n(s.offset)}" style="stop-color:${
				color(s.color)
			}${op}"/>`;
		})
		.join("");
	return (
		`<linearGradient id="${g.id}" gradientUnits="userSpaceOnUse" ` +
		`x1="0" y1="${n(g.y1)}" x2="0" y2="${n(g.y2)}">${stops}</linearGradient>`
	);
}

/** `<text>` element for a positioned scene label. */
function textMarkup(t: SceneText, style: string): string {
	return (
		`<text x="${n(t.x)}" y="${n(t.y)}" text-anchor="${t.anchor}" ` +
		`style="${style}">${esc(t.text)}</text>`
	);
}

/** Serialize a computed {@link Scene} to static SVG markup. */
export function sceneToString(scene: Scene): string {
	const out: string[] = [];
	const clipId = `${scene.idPrefix}-clip`;
	const labelStyle = textStyle(scene);

	out.push(
		`<svg xmlns="http://www.w3.org/2000/svg" width="${scene.width}" ` +
			`height="${scene.height}" viewBox="0 0 ${scene.width} ${scene.height}" ` +
			`class="trend-chart" role="img"` +
			(scene.ariaLabel ? ` aria-label="${esc(scene.ariaLabel)}"` : "") +
			`>`,
	);
	if (scene.ariaLabel) out.push(`<title>${esc(scene.ariaLabel)}</title>`);

	// defs
	out.push(
		`<defs><clipPath id="${clipId}"><rect x="${n(scene.plot.x)}" ` +
			`y="${n(scene.plot.y)}" width="${n(scene.plot.width)}" ` +
			`height="${n(scene.plot.height)}"/></clipPath>`,
	);
	if (scene.fillGradient) out.push(gradientMarkup(scene.fillGradient));
	if (scene.strokeGradient) out.push(gradientMarkup(scene.strokeGradient));
	out.push(`</defs>`);

	// zone bands
	if (scene.bands.length) {
		out.push(`<g class="trend-chart-bands">`);
		for (const b of scene.bands) {
			out.push(
				`<rect x="${n(b.x)}" y="${n(b.y)}" width="${n(b.width)}" ` +
					`height="${n(b.height)}" style="fill:${
						color(b.color)
					};opacity:${b.opacity}"/>`,
			);
			if (b.label) {
				out.push(
					textMarkup(
						b.label,
						`fill:${color(b.color)};opacity:0.8;` +
							`font-family:${FONT_FAMILY};font-size:${scene.fontSize}px`,
					),
				);
			}
		}
		out.push(`</g>`);
	}

	// grid
	if (scene.grid.length) {
		const stroke = color(cssColor("grid", "#e5e7eb", scene.cssVars));
		out.push(`<g class="trend-chart-grid" shape-rendering="crispEdges">`);
		for (const l of scene.grid) {
			out.push(
				`<line x1="${n(l.x1)}" y1="${n(l.y1)}" x2="${n(l.x2)}" ` +
					`y2="${n(l.y2)}" style="stroke:${stroke};stroke-width:1"/>`,
			);
		}
		out.push(`</g>`);
	}

	// series (clipped)
	out.push(`<g clip-path="url(#${clipId})">`);
	if (scene.areaPath && scene.fillGradient) {
		out.push(
			`<path class="trend-chart-area" d="${scene.areaPath}" ` +
				`style="fill:url(#${scene.fillGradient.id})"/>`,
		);
	}
	if (scene.linePath) {
		const stroke = scene.strokeGradient
			? `url(#${scene.strokeGradient.id})`
			: color(scene.lineColor);
		out.push(
			`<path class="trend-chart-line" d="${scene.linePath}" ` +
				`style="fill:none;stroke:${stroke};stroke-width:${scene.lineWidth}px;` +
				`stroke-linejoin:round;stroke-linecap:round"/>`,
		);
	}
	for (const m of scene.markers) {
		out.push(
			`<circle class="trend-chart-marker" cx="${n(m.px)}" cy="${n(m.py)}" ` +
				`r="${scene.pointRadius}" style="fill:${color(scene.lineColor)}"/>`,
		);
	}
	out.push(`</g>`);

	// end dot (unclipped so it survives sitting on the plot edge)
	if (scene.endDot) {
		const d = scene.endDot;
		out.push(
			`<circle class="trend-chart-end-dot" cx="${n(d.px)}" cy="${n(d.py)}" ` +
				`r="${d.r}" style="fill:${color(d.color)};stroke:${
					color(d.ringColor)
				};stroke-width:2"/>`,
		);
	}

	// labels
	if (scene.xLabels.length) {
		out.push(`<g class="trend-chart-x-labels">`);
		for (const t of scene.xLabels) out.push(textMarkup(t, labelStyle));
		out.push(`</g>`);
	}
	if (scene.yLabels.length) {
		out.push(`<g class="trend-chart-y-labels">`);
		for (const t of scene.yLabels) out.push(textMarkup(t, labelStyle));
		out.push(`</g>`);
	}

	out.push(`</svg>`);
	return out.join("");
}

let ssrCounter = 0;

/** Render a chart to a self-contained static SVG string — no DOM required,
 * works in pure Deno (SSR, emails, docs).
 *
 * `width` and `height` are required (there is no container to measure).
 * Interactive options (pan/zoom/points callbacks) are ignored.
 *
 * ```ts
 * import { renderToString } from "@marianmeres/trend-chart";
 *
 * const svg = renderToString([3, 5, 4, 8, 6], { width: 300, height: 80, xAxis: false, yAxis: false, grid: false });
 * ```
 */
export function renderToString(
	data: TrendData,
	options: TrendChartOptions & { width: number; height: number },
): string {
	if (!options?.width || !options?.height) {
		throw new Error(
			"[trend-chart] renderToString requires explicit width and height",
		);
	}
	const scene = computeScene(data, options, {
		width: options.width,
		height: options.height,
		domainX: options.domainX,
		idPrefix: `tcs-${++ssrCounter}`,
		cssVars: options.cssVars ?? false,
	});
	return sceneToString(scene);
}
