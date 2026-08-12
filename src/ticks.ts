import type { XTicksOption } from "./types.ts";

/** Round a raw step to a "nice" one (1/2/5 × power of 10). */
function niceNum(x: number, round: boolean): number {
	if (x === 0 || !Number.isFinite(x)) return 0;
	const exp = Math.floor(Math.log10(x));
	const f = x / 10 ** exp;
	let nf: number;
	if (round) nf = f < 1.5 ? 1 : f < 3 ? 2 : f < 7 ? 5 : 10;
	else nf = f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10;
	return nf * 10 ** exp;
}

/** Snap floating point tick values (e.g. `0.30000000000000004` → `0.3`). */
function snap(v: number, step: number): number {
	const p = Math.max(0, -Math.floor(Math.log10(step)) + 1);
	return Number(v.toFixed(Math.min(20, p + 1)));
}

/** Expand a domain outward to "nice" bounds for the given target tick count.
 * Returns `[min, max, step]`. A zero-span domain is padded to a usable range. */
export function niceDomain(
	domain: [number, number],
	targetCount = 5,
): [number, number, number] {
	let [min, max] = domain;
	if (min === max) {
		const pad = min === 0 ? 1 : Math.abs(min) * 0.1;
		min -= pad;
		max += pad;
	}
	const step = niceNum((max - min) / Math.max(1, targetCount - 1), true);
	if (!step) return [min, max, 0];
	return [
		snap(Math.floor(min / step) * step, step),
		snap(Math.ceil(max / step) * step, step),
		step,
	];
}

/** Hard ceiling on generated ticks. Guards against a pathological `targetCount`
 * (or a step tiny relative to the span) growing the output without bound. */
const MAX_TICKS = 1000;

/** Tick values spaced by `step` covering `[min, max]` — the companion to the
 * triple `niceDomain()` returns, so a domain and its ticks can be derived from
 * a single pass instead of two that may disagree on the step.
 *
 * `min` is expected to sit on the step lattice (as `niceDomain`'s does); ticks
 * are generated upward from it. Output is deduped and capped at 1000 values. */
export function ticksForStep(min: number, max: number, step: number): number[] {
	if (!step || !Number.isFinite(step)) return [min];
	// index-based, never accumulated: `min + step` can equal `min` when the step
	// falls below the float resolution of the domain's magnitude (e.g. a span of
	// 0.125 at 1e15), which would make an accumulating loop spin forever
	const count = Math.floor((max - min) / step + 0.5);
	if (!Number.isFinite(count) || count < 0) return [min];
	const out: number[] = [];
	for (let i = 0; i <= Math.min(count, MAX_TICKS); i++) {
		// same magnitude case: consecutive indices can snap to the same value
		const v = snap(min + i * step, step);
		if (out[out.length - 1] !== v) out.push(v);
	}
	return out;
}

/** "Nice numbers" y ticks: round values at round intervals covering the domain.
 * At most 1000 values are returned. */
export function niceTicks(domain: [number, number], targetCount = 5): number[] {
	return ticksForStep(...niceDomain(domain, targetCount));
}

/** Evenly spaced values across a domain, endpoints included. */
export function evenTicks(domain: [number, number], count: number): number[] {
	if (count <= 0) return [];
	if (count === 1) return [(domain[0] + domain[1]) / 2];
	const out: number[] = [];
	const step = (domain[1] - domain[0]) / (count - 1);
	for (let i = 0; i < count; i++) out.push(domain[0] + step * i);
	return out;
}

/** Pick ~`count` evenly index-spaced values from `samples` (deduped, ordered).
 * Used for default x ticks so labels always land on real data points. */
export function sampleTicks(samples: number[], count: number): number[] {
	if (count <= 0 || !samples.length) return [];
	if (samples.length <= count) return [...new Set(samples)];
	const out: number[] = [];
	for (let i = 0; i < count; i++) {
		const idx = Math.round((i * (samples.length - 1)) / (count - 1));
		const v = samples[idx];
		if (out[out.length - 1] !== v) out.push(v);
	}
	return out;
}

/** Resolve the x-tick option to concrete tick values for the visible domain.
 * Default: even spacing with a count derived from the plot width (~1 label
 * per 80px). Explicit arrays/callbacks are filtered to the visible domain. */
export function resolveXTicks(
	domain: [number, number],
	plotWidth: number,
	option?: XTicksOption,
): number[] {
	if (typeof option === "function") {
		return option(domain).filter((v) => v >= domain[0] && v <= domain[1]);
	}
	if (Array.isArray(option)) {
		return option.filter((v) => v >= domain[0] && v <= domain[1]);
	}
	const count = typeof option === "number"
		? Math.max(0, Math.floor(option))
		: Math.min(8, Math.max(2, Math.floor(plotWidth / 80)));
	return evenTicks(domain, count);
}
