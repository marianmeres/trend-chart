import { clampDomainX, invertX, plotRect, type ScaleConfig } from "./scale.ts";

/** Wiring between gesture handlers and the chart's domain state. The handlers
 * never render — they only read scale config and push new domains. */
export interface GestureHooks {
	/** Enable drag panning. */
	pan: boolean;
	/** Enable wheel and pinch zooming. */
	zoom: boolean;
	/** Current scale config (size, padding, domains) — read on every event. */
	getScale(): ScaleConfig;
	/** Full data x range; pan/zoom results are clamped into it. */
	getFullRange(): [number, number];
	/** Smallest allowed visible x span (zoom-in limit). */
	getMinSpan(): number;
	/** Called with the new (already clamped) visible x window. */
	setDomainX(domain: [number, number]): void;
}

const WHEEL_FACTOR = 1.15;

/** Attach pan (drag), zoom (wheel, toward cursor) and pinch-zoom (two
 * pointers, toward midpoint) handlers to `el`. Returns a detach function. */
export function attachGestures(el: SVGSVGElement, hooks: GestureHooks): () => void {
	const pointers = new Map<number, { x: number; y: number }>();
	let pinchDist = 0;

	const toLocalX = (ev: { clientX: number }) =>
		ev.clientX - el.getBoundingClientRect().left;

	const zoomAround = (centerX: number, factor: number) => {
		const cfg = hooks.getScale();
		const [d0, d1] = cfg.domainX;
		const next: [number, number] = [
			centerX - (centerX - d0) * factor,
			centerX + (d1 - centerX) * factor,
		];
		hooks.setDomainX(clampDomainX(next, hooks.getFullRange(), hooks.getMinSpan()));
	};

	const onPointerDown = (ev: PointerEvent) => {
		if (ev.button !== 0 && ev.pointerType === "mouse") return;
		pointers.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });
		el.setPointerCapture(ev.pointerId);
		if (pointers.size === 2) {
			const [a, b] = [...pointers.values()];
			pinchDist = Math.hypot(a.x - b.x, a.y - b.y);
		}
	};

	const onPointerMove = (ev: PointerEvent) => {
		const prev = pointers.get(ev.pointerId);
		if (!prev) return;
		const curr = { x: ev.clientX, y: ev.clientY };
		pointers.set(ev.pointerId, curr);

		if (pointers.size === 1 && hooks.pan) {
			const cfg = hooks.getScale();
			const plot = plotRect(cfg);
			if (!plot.width) return;
			const [d0, d1] = cfg.domainX;
			const shift = (-(curr.x - prev.x) / plot.width) * (d1 - d0);
			hooks.setDomainX(clampDomainX(
				[d0 + shift, d1 + shift],
				hooks.getFullRange(),
				hooks.getMinSpan(),
			));
		} else if (pointers.size === 2 && hooks.zoom) {
			const [a, b] = [...pointers.values()];
			const dist = Math.hypot(a.x - b.x, a.y - b.y);
			if (pinchDist > 0 && dist > 0) {
				const cfg = hooks.getScale();
				const midX = (a.x + b.x) / 2 - el.getBoundingClientRect().left;
				zoomAround(invertX(midX, cfg), pinchDist / dist);
			}
			pinchDist = dist;
		}
	};

	const onPointerEnd = (ev: PointerEvent) => {
		pointers.delete(ev.pointerId);
		if (el.hasPointerCapture(ev.pointerId)) el.releasePointerCapture(ev.pointerId);
		pinchDist = 0;
	};

	const onWheel = (ev: WheelEvent) => {
		ev.preventDefault();
		const factor = ev.deltaY > 0 ? WHEEL_FACTOR : 1 / WHEEL_FACTOR;
		zoomAround(invertX(toLocalX(ev), hooks.getScale()), factor);
	};

	// Gesture styles are (re)set on every attach — `setOptions({ pan: false })`
	// detaches and re-attaches, so each branch must also clear what it set.
	el.style.touchAction = hooks.pan || hooks.zoom ? "none" : "";
	el.style.cursor = hooks.pan ? "grab" : "";
	// A drag is a pan, not a text selection: without this, dragging across the
	// plot highlights the axis labels (they are real <text> nodes).
	el.style.userSelect = hooks.pan ? "none" : "";
	el.style.setProperty("-webkit-user-select", hooks.pan ? "none" : "");

	if (hooks.pan || hooks.zoom) {
		el.addEventListener("pointerdown", onPointerDown);
		el.addEventListener("pointermove", onPointerMove);
		el.addEventListener("pointerup", onPointerEnd);
		el.addEventListener("pointercancel", onPointerEnd);
	}
	if (hooks.zoom) el.addEventListener("wheel", onWheel, { passive: false });

	return () => {
		el.removeEventListener("pointerdown", onPointerDown);
		el.removeEventListener("pointermove", onPointerMove);
		el.removeEventListener("pointerup", onPointerEnd);
		el.removeEventListener("pointercancel", onPointerEnd);
		el.removeEventListener("wheel", onWheel);
	};
}
