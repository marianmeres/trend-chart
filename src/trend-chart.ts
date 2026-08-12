import type {
	AnnotationEvent,
	DataPoint,
	PointEvent,
	Scene,
	SceneGradient,
	TrendChartOptions,
	TrendData,
} from "./types.ts";
import { computeScene, cssColor, normalizeData } from "./scene.ts";
import { clampDomainX, dataRangeX, type ScaleConfig } from "./scale.ts";
import { attachGestures } from "./gestures.ts";

const SVG_NS = "http://www.w3.org/2000/svg";
const FONT_FAMILY = "ui-sans-serif, system-ui, sans-serif";
const HOVER_MAX_DISTANCE = 30;
// Annotations are sparse, deliberate targets — a tight radius, unlike points.
const ANNOTATION_MAX_DISTANCE = 8;

let instanceCounter = 0;

/** `document.createElementNS` shorthand, typed by tag name. */
function createSvg<K extends keyof SVGElementTagNameMap>(
	tag: K,
): SVGElementTagNameMap[K] {
	return document.createElementNS(SVG_NS, tag);
}

/** Trim or grow `parent`'s children (all of `tag`) to `count`, returning them. */
function syncChildren(parent: SVGElement, tag: string, count: number): SVGElement[] {
	while (parent.children.length > count) parent.lastElementChild!.remove();
	while (parent.children.length < count) {
		parent.appendChild(document.createElementNS(SVG_NS, tag));
	}
	return [...parent.children] as SVGElement[];
}

/** Reconstruct the scale config a scene was computed with (for gestures). */
function sceneScale(scene: Scene): ScaleConfig {
	return {
		width: scene.width,
		height: scene.height,
		padding: {
			top: scene.plot.y,
			left: scene.plot.x,
			right: scene.width - scene.plot.x - scene.plot.width,
			bottom: scene.height - scene.plot.y - scene.plot.height,
		},
		domainX: scene.domainX,
		domainY: scene.domainY,
	};
}

/**
 * Framework-agnostic single-series trend chart rendered as retained-mode SVG:
 * the element tree is built once, redraws only patch attributes.
 *
 * ```ts
 * import { TrendChart } from "@marianmeres/trend-chart";
 *
 * const chart = new TrendChart(document.querySelector("#chart")!, [3, 5, 4, 8], {
 * 	smooth: true,
 * 	endDot: true,
 * 	onPointClick: (e) => console.log(e.point, e.index),
 * });
 * chart.update([3, 5, 4, 8, 9]);
 * chart.destroy();
 * ```
 */
export class TrendChart {
	#container: HTMLElement;
	#data: DataPoint[];
	#options: TrendChartOptions;
	#idPrefix: string;

	/** Current visible x window; `null` = follow the full data range. */
	#domainX: [number, number] | null = null;
	#scene: Scene | null = null;

	#svg: SVGSVGElement;
	#title: SVGTitleElement;
	#defs: SVGDefsElement;
	#clipRect: SVGRectElement;
	#fillGrad: SVGLinearGradientElement | null = null;
	#strokeGrad: SVGLinearGradientElement | null = null;
	#gBands: SVGGElement;
	#gGrid: SVGGElement;
	#gAnnotations: SVGGElement;
	#gSeries: SVGGElement;
	#areaEl: SVGPathElement;
	#lineEl: SVGPathElement;
	#gMarkers: SVGGElement;
	#hoverDot: SVGCircleElement;
	#endDotEl: SVGCircleElement;
	#gAnnotationLabels: SVGGElement;
	#gXLabels: SVGGElement;
	#gYLabels: SVGGElement;

	#ro: ResizeObserver | null = null;
	#detachGestures: (() => void) | null = null;
	#hoverIndex: number | null = null;
	#hoverAnnotation: number | null = null;
	#downAt: { x: number; y: number } | null = null;
	#moved = false;

	/** Build the svg skeleton inside `container`, wire gestures/interaction and
	 * render the first frame.
	 *
	 * @param container Host element the `<svg>` is appended to. Its size is
	 * observed unless both `width` and `height` options are given.
	 * @param data The series ({@link TrendData}).
	 * @param options Chart options ({@link TrendChartOptions}).
	 */
	constructor(
		container: HTMLElement,
		data: TrendData,
		options: TrendChartOptions = {},
	) {
		this.#container = container;
		this.#data = normalizeData(data);
		this.#options = { ...options };
		this.#idPrefix = `tc-${++instanceCounter}`;
		if (options.domainX) this.#domainX = [...options.domainX];

		// --- static skeleton (built once) ---------------------------------
		const svg = (this.#svg = createSvg("svg"));
		svg.setAttribute("class", "trend-chart");
		svg.setAttribute("role", "img");
		svg.style.display = "block";
		this.#title = svg.appendChild(createSvg("title"));

		this.#defs = svg.appendChild(createSvg("defs"));
		const clip = this.#defs.appendChild(createSvg("clipPath"));
		clip.id = `${this.#idPrefix}-clip`;
		this.#clipRect = clip.appendChild(createSvg("rect"));

		this.#gBands = svg.appendChild(createSvg("g"));
		this.#gBands.setAttribute("class", "trend-chart-bands");
		this.#gGrid = svg.appendChild(createSvg("g"));
		this.#gGrid.setAttribute("class", "trend-chart-grid");
		this.#gGrid.setAttribute("shape-rendering", "crispEdges");

		// context rules sit behind the series (their labels go in front, below)
		this.#gAnnotations = svg.appendChild(createSvg("g"));
		this.#gAnnotations.setAttribute("class", "trend-chart-annotations");

		this.#gSeries = svg.appendChild(createSvg("g"));
		this.#gSeries.setAttribute("clip-path", `url(#${this.#idPrefix}-clip)`);
		this.#areaEl = this.#gSeries.appendChild(createSvg("path"));
		this.#areaEl.setAttribute("class", "trend-chart-area");
		this.#lineEl = this.#gSeries.appendChild(createSvg("path"));
		this.#lineEl.setAttribute("class", "trend-chart-line");
		this.#gMarkers = this.#gSeries.appendChild(createSvg("g"));
		this.#gMarkers.setAttribute("class", "trend-chart-markers");

		this.#endDotEl = svg.appendChild(createSvg("circle"));
		this.#endDotEl.setAttribute("class", "trend-chart-end-dot");
		this.#hoverDot = svg.appendChild(createSvg("circle"));
		this.#hoverDot.setAttribute("class", "trend-chart-hover-dot");
		this.#hoverDot.style.display = "none";
		this.#hoverDot.style.pointerEvents = "none";

		this.#gAnnotationLabels = svg.appendChild(createSvg("g"));
		this.#gAnnotationLabels.setAttribute("class", "trend-chart-annotation-labels");
		this.#gAnnotationLabels.style.pointerEvents = "none";

		this.#gXLabels = svg.appendChild(createSvg("g"));
		this.#gXLabels.setAttribute("class", "trend-chart-x-labels");
		this.#gYLabels = svg.appendChild(createSvg("g"));
		this.#gYLabels.setAttribute("class", "trend-chart-y-labels");

		container.appendChild(svg);

		// --- wiring ---------------------------------------------------------
		this.#detachGestures = attachGestures(svg, {
			pan: this.#options.pan ?? true,
			zoom: this.#options.zoom ?? true,
			getScale: () => sceneScale(this.#scene!),
			getFullRange: () => dataRangeX(this.#data),
			getMinSpan: () => this.#minSpan(),
			setDomainX: (d) => this.#applyDomain(d),
		});
		this.#wirePointerInteraction();

		if (this.#options.width === undefined || this.#options.height === undefined) {
			this.#ro = new ResizeObserver(() => this.#render());
			this.#ro.observe(container);
		}

		this.#render();
	}

	/** Replace the dataset (options unchanged). The visible window is kept and
	 * clamped, unless it followed the full range — then it keeps following. */
	update(data: TrendData): void {
		this.#data = normalizeData(data);
		if (this.#domainX) {
			this.#domainX = clampDomainX(
				this.#domainX,
				dataRangeX(this.#data),
				this.#minSpan(),
			);
		}
		this.#render();
	}

	/** Merge in new options and re-render. */
	setOptions(options: Partial<TrendChartOptions>): void {
		this.#options = { ...this.#options, ...options };
		if (options.pan !== undefined || options.zoom !== undefined) {
			this.#detachGestures?.();
			this.#detachGestures = attachGestures(this.#svg, {
				pan: this.#options.pan ?? true,
				zoom: this.#options.zoom ?? true,
				getScale: () => sceneScale(this.#scene!),
				getFullRange: () => dataRangeX(this.#data),
				getMinSpan: () => this.#minSpan(),
				setDomainX: (d) => this.#applyDomain(d),
			});
		}
		this.#render();
	}

	/** Programmatic pan/zoom: set the visible x window (clamped to the data). */
	setDomainX(domainX: [number, number]): void {
		this.#applyDomain(clampDomainX(domainX, dataRangeX(this.#data), this.#minSpan()));
	}

	/** The currently visible x window. */
	getDomainX(): [number, number] {
		return this.#scene ? [...this.#scene.domainX] : dataRangeX(this.#data);
	}

	/** Reset to the full data range (and follow it on future `update()`s). */
	resetDomain(): void {
		this.#domainX = null;
		this.#render();
		this.#options.onDomainChange?.(this.getDomainX());
	}

	/** Remove listeners/observers and detach from the DOM. */
	destroy(): void {
		this.#ro?.disconnect();
		this.#detachGestures?.();
		this.#svg.remove();
	}

	/* --- internals -------------------------------------------------------- */

	/** Zoom-in limit: the explicit option, or the span of ~3 data points. */
	#minSpan(): number {
		if (this.#options.minDomainSpan) return this.#options.minDomainSpan;
		const [x0, x1] = dataRangeX(this.#data);
		return this.#data.length > 1 ? ((x1 - x0) / (this.#data.length - 1)) * 3 : 0;
	}

	/** Store a new visible window, redraw, notify `onDomainChange`. */
	#applyDomain(domain: [number, number]): void {
		this.#domainX = domain;
		this.#render();
		this.#options.onDomainChange?.(domain);
	}

	/** Explicit `width`/`height` options, else the measured container size. */
	#size(): { width: number; height: number } {
		return {
			width: this.#options.width ?? this.#container.clientWidth ?? 300,
			height: this.#options.height ?? this.#container.clientHeight ?? 150,
		};
	}

	/** Recompute the scene and patch the existing svg tree to match it. */
	#render(): void {
		const { width, height } = this.#size();
		if (!width || !height) return;
		const o = this.#options;
		const scene = (this.#scene = computeScene(this.#data, o, {
			width,
			height,
			domainX: this.#domainX ?? undefined,
			idPrefix: this.#idPrefix,
			cssVars: o.cssVars ?? true,
		}));

		const svg = this.#svg;
		svg.setAttribute("width", String(width));
		svg.setAttribute("height", String(height));
		svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
		svg.setAttribute("class", `trend-chart${o.class ? ` ${o.class}` : ""}`);
		if (scene.ariaLabel) svg.setAttribute("aria-label", scene.ariaLabel);
		else svg.removeAttribute("aria-label");
		this.#title.textContent = scene.ariaLabel ?? "";

		const plot = scene.plot;
		this.#clipRect.setAttribute("x", String(plot.x));
		this.#clipRect.setAttribute("y", String(plot.y));
		this.#clipRect.setAttribute("width", String(plot.width));
		this.#clipRect.setAttribute("height", String(plot.height));

		this.#fillGrad = this.#syncGradient(this.#fillGrad, scene.fillGradient);
		this.#strokeGrad = this.#syncGradient(this.#strokeGrad, scene.strokeGradient);

		// bands
		const bandGroups = syncChildren(this.#gBands, "g", scene.bands.length);
		scene.bands.forEach((b, i) => {
			const g = bandGroups[i];
			const rect = (g.firstElementChild ??
				g.appendChild(createSvg("rect"))) as SVGRectElement;
			rect.setAttribute("x", String(b.x));
			rect.setAttribute("y", String(b.y));
			rect.setAttribute("width", String(b.width));
			rect.setAttribute("height", String(b.height));
			rect.style.fill = b.color;
			rect.style.opacity = String(b.opacity);
			let text = rect.nextElementSibling as SVGTextElement | null;
			if (b.label) {
				text ??= g.appendChild(createSvg("text"));
				this.#patchText(text, b.label, b.color);
				text.style.opacity = "0.8";
			} else {
				text?.remove();
			}
		});

		// grid
		const gridColor = cssColor("grid", "#e5e7eb", scene.cssVars);
		const gridLines = syncChildren(this.#gGrid, "line", scene.grid.length);
		scene.grid.forEach((l, i) => {
			const el = gridLines[i];
			el.setAttribute("x1", String(l.x1));
			el.setAttribute("y1", String(l.y1));
			el.setAttribute("x2", String(l.x2));
			el.setAttribute("y2", String(l.y2));
			el.style.stroke = gridColor;
			el.style.strokeWidth = "1";
		});

		// annotations
		const rules = syncChildren(
			this.#gAnnotations,
			"line",
			scene.annotations.length,
		);
		scene.annotations.forEach((a, i) => {
			const el = rules[i];
			el.setAttribute("x1", String(a.px));
			el.setAttribute("y1", String(a.y1));
			el.setAttribute("x2", String(a.px));
			el.setAttribute("y2", String(a.y2));
			el.style.stroke = a.color;
			el.style.strokeDasharray = a.dash ? "4 3" : "";
		});
		const annLabels = scene.annotations.filter((a) => a.label);
		const annTexts = syncChildren(
			this.#gAnnotationLabels,
			"text",
			annLabels.length,
		);
		// halo: the label sits at the plot top, where the line often is
		const halo = cssColor("annotation-halo", "#ffffff", scene.cssVars);
		annLabels.forEach((a, i) => {
			const el = annTexts[i] as SVGTextElement;
			this.#patchText(el, a.label!, a.color);
			el.style.paintOrder = "stroke";
			el.style.stroke = halo;
			el.style.strokeWidth = "3px";
			el.style.strokeLinejoin = "round";
		});
		// a pan can carry the hovered annotation out of the window
		if (
			this.#hoverAnnotation !== null &&
			!scene.annotations.some((a) => a.index === this.#hoverAnnotation)
		) {
			this.#setAnnotationHover(null);
		}
		this.#paintAnnotationHover();

		// series
		this.#areaEl.setAttribute("d", scene.areaPath);
		this.#areaEl.style.fill = scene.fillGradient
			? `url(#${scene.fillGradient.id})`
			: "none";
		this.#lineEl.setAttribute("d", scene.linePath);
		this.#lineEl.style.fill = "none";
		this.#lineEl.style.stroke = scene.strokeGradient
			? `url(#${scene.strokeGradient.id})`
			: scene.lineColor;
		this.#lineEl.style.strokeWidth = `${scene.lineWidth}px`;
		this.#lineEl.style.strokeLinejoin = "round";
		this.#lineEl.style.strokeLinecap = "round";

		// markers ("all" mode)
		const markers = syncChildren(this.#gMarkers, "circle", scene.markers.length);
		scene.markers.forEach((m, i) => {
			const el = markers[i];
			el.setAttribute("cx", String(m.px));
			el.setAttribute("cy", String(m.py));
			el.setAttribute("r", String(scene.pointRadius));
			el.style.fill = scene.lineColor;
		});

		// end dot
		if (scene.endDot) {
			const d = scene.endDot;
			this.#endDotEl.style.display = "";
			this.#endDotEl.setAttribute("cx", String(d.px));
			this.#endDotEl.setAttribute("cy", String(d.py));
			this.#endDotEl.setAttribute("r", String(d.r));
			this.#endDotEl.style.fill = d.color;
			this.#endDotEl.style.stroke = d.ringColor;
			this.#endDotEl.style.strokeWidth = "2";
		} else {
			this.#endDotEl.style.display = "none";
		}

		// labels
		const labelColor = cssColor("label", "#9ca3af", scene.cssVars);
		const xEls = syncChildren(this.#gXLabels, "text", scene.xLabels.length);
		scene.xLabels.forEach((t, i) =>
			this.#patchText(xEls[i] as SVGTextElement, t, labelColor)
		);
		const yEls = syncChildren(this.#gYLabels, "text", scene.yLabels.length);
		scene.yLabels.forEach((t, i) =>
			this.#patchText(yEls[i] as SVGTextElement, t, labelColor)
		);
	}

	/** Patch a `<text>` node to a scene label. */
	#patchText(
		el: SVGTextElement,
		t: { x: number; y: number; text: string; anchor: string },
		color: string,
	): void {
		el.setAttribute("x", String(t.x));
		el.setAttribute("y", String(t.y));
		el.setAttribute("text-anchor", t.anchor);
		el.textContent = t.text;
		el.style.fill = color;
		el.style.fontFamily = `var(--trend-chart-font, ${FONT_FAMILY})`;
		el.style.fontSize = `${this.#scene?.fontSize ?? 11}px`;
	}

	/** Create/update/remove a `<linearGradient>` def for a scene gradient. */
	#syncGradient(
		el: SVGLinearGradientElement | null,
		g: SceneGradient | null,
	): SVGLinearGradientElement | null {
		if (!g) {
			el?.remove();
			return null;
		}
		if (!el) {
			el = this.#defs.appendChild(createSvg("linearGradient"));
			el.setAttribute("gradientUnits", "userSpaceOnUse");
			el.setAttribute("x1", "0");
			el.setAttribute("x2", "0");
		}
		el.id = g.id;
		el.setAttribute("y1", String(g.y1));
		el.setAttribute("y2", String(g.y2));
		const stops = syncChildren(el, "stop", g.stops.length);
		g.stops.forEach((s, i) => {
			const stop = stops[i];
			stop.setAttribute("offset", String(s.offset));
			stop.style.stopColor = s.color;
			stop.style.stopOpacity = s.opacity === undefined ? "1" : String(s.opacity);
		});
		return el;
	}

	/* --- point interaction -------------------------------------------------- */

	/** Hover/click handling (a drag is a pan, so it must not fire a click). */
	#wirePointerInteraction(): void {
		const svg = this.#svg;
		svg.addEventListener("pointerdown", (ev) => {
			this.#downAt = { x: ev.clientX, y: ev.clientY };
			this.#moved = false;
		});
		svg.addEventListener("pointermove", (ev) => {
			if (this.#downAt) {
				const dist = Math.hypot(
					ev.clientX - this.#downAt.x,
					ev.clientY - this.#downAt.y,
				);
				if (dist > 4) this.#moved = true;
			}
			if (this.#downAt) return;
			this.#setAnnotationHover(this.#nearestAnnotation(ev));
			if (this.#pointsMode() === "none") return;
			this.#setHover(this.#nearest(ev));
		});
		svg.addEventListener("pointerup", (ev) => {
			const wasClick = this.#downAt && !this.#moved;
			this.#downAt = null;
			if (!wasClick) return;
			// Annotations win over points when both are in range — but only if the
			// host actually listens, so an unhandled annotation never becomes a
			// dead zone in the middle of the (much wider) point hit radius.
			const note = this.#options.onAnnotationClick
				? this.#nearestAnnotation(ev)
				: null;
			if (note) {
				this.#options.onAnnotationClick?.(note);
				return;
			}
			if (this.#pointsMode() !== "none") {
				const hit = this.#nearest(ev);
				if (hit) this.#options.onPointClick?.(hit);
			}
		});
		svg.addEventListener("pointerleave", () => {
			this.#downAt = null;
			this.#setHover(null);
			this.#setAnnotationHover(null);
		});
	}

	/** Resolved `points` option. */
	#pointsMode(): "all" | "nearest" | "none" {
		return this.#options.points ?? "nearest";
	}

	/** Visible point nearest to the pointer's x, or `null` if none is close. */
	#nearest(ev: { clientX: number; clientY: number }): PointEvent | null {
		const scene = this.#scene;
		if (!scene || !scene.visible.length) return null;
		const rect = this.#svg.getBoundingClientRect();
		const px = ev.clientX - rect.left;
		let best = scene.visible[0];
		for (const p of scene.visible) {
			if (Math.abs(p.px - px) < Math.abs(best.px - px)) best = p;
		}
		if (Math.abs(best.px - px) > HOVER_MAX_DISTANCE) return null;
		return {
			point: { x: best.x, y: best.y },
			index: best.index,
			pixel: { x: best.px, y: best.py },
		};
	}

	/** Move/hide the hover dot and notify `onPointHover` — on change only. */
	#setHover(hit: PointEvent | null): void {
		if ((hit?.index ?? null) === this.#hoverIndex) {
			return;
		}
		this.#hoverIndex = hit?.index ?? null;
		const scene = this.#scene;
		if (hit && scene) {
			this.#hoverDot.style.display = "";
			this.#hoverDot.setAttribute("cx", String(hit.pixel.x));
			this.#hoverDot.setAttribute("cy", String(hit.pixel.y));
			this.#hoverDot.setAttribute("r", String(scene.pointRadius + 1.5));
			this.#hoverDot.style.fill = scene.lineColor;
			this.#hoverDot.style.stroke = cssColor(
				"end-dot-ring",
				"#ffffff",
				scene.cssVars,
			);
			this.#hoverDot.style.strokeWidth = "2";
		} else {
			this.#hoverDot.style.display = "none";
		}
		this.#options.onPointHover?.(hit);
	}

	/* --- annotation interaction ---------------------------------------------- */

	/** Visible annotation whose rule is within {@link ANNOTATION_MAX_DISTANCE}
	 * of the pointer's x, or `null`. */
	#nearestAnnotation(ev: { clientX: number }): AnnotationEvent | null {
		const scene = this.#scene;
		const configured = this.#options.annotations;
		if (!scene?.annotations.length || !configured?.length) return null;
		const rect = this.#svg.getBoundingClientRect();
		const px = ev.clientX - rect.left;
		let best = scene.annotations[0];
		for (const a of scene.annotations) {
			if (Math.abs(a.px - px) < Math.abs(best.px - px)) best = a;
		}
		if (Math.abs(best.px - px) > ANNOTATION_MAX_DISTANCE) return null;
		return {
			annotation: configured[best.index],
			index: best.index,
			// the rule's top end — the natural anchor for a host tooltip
			pixel: { x: best.px, y: best.y1 },
		};
	}

	/** Emphasize the hovered rule and notify `onAnnotationHover` — on change only. */
	#setAnnotationHover(hit: AnnotationEvent | null): void {
		if ((hit?.index ?? null) === this.#hoverAnnotation) return;
		this.#hoverAnnotation = hit?.index ?? null;
		this.#paintAnnotationHover();
		this.#options.onAnnotationHover?.(hit);
	}

	/** Paint the hover emphasis. Hover is pointer state, not geometry, so it is
	 * the one thing the scene does not carry — it is applied on top of it. */
	#paintAnnotationHover(): void {
		const rules = [...this.#gAnnotations.children] as SVGLineElement[];
		this.#scene?.annotations.forEach((a, i) => {
			const on = a.index === this.#hoverAnnotation;
			rules[i].style.opacity = on ? "1" : "0.75";
			rules[i].style.strokeWidth = on ? "2" : "1";
		});
	}
}
