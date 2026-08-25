/** Pixel-space point. */
export interface PxPoint {
	/** Pixel x. */
	x: number;
	/** Pixel y. */
	y: number;
}

/** Round to 2 decimals to keep path strings compact. */
function n(v: number): number {
	return Math.round(v * 100) / 100;
}

/** Slice the dataset to the points visible within `domainX`, padded by
 * `overscan` extra points on each side so panning shows a continuous line.
 * Returns the slice and its start index into the full dataset. */
export function visibleSlice<T extends { x: number }>(
	points: T[],
	domainX: [number, number],
	overscan = 1,
): { points: T[]; startIndex: number } {
	if (!points.length) return { points: [], startIndex: 0 };
	let start = 0;
	while (start < points.length && points[start].x < domainX[0]) start++;
	let end = points.length; // exclusive
	while (end > 0 && points[end - 1].x > domainX[1]) end--;
	start = Math.max(0, start - overscan);
	end = Math.min(points.length, end + overscan);
	if (start >= end) return { points: [], startIndex: 0 };
	return { points: points.slice(start, end), startIndex: start };
}

/** Build an open line path. `smooth` is `false` (straight segments), `true`
 * (full monotone-cubic smoothing) or a `0..1` tension. The smoothed curve never
 * overshoots a sample, so it stays inside the data's own range. Returns `""` for
 * fewer than 2 points. */
export function buildLinePath(
	points: PxPoint[],
	smooth: boolean | number = false,
): string {
	if (points.length < 2) return "";
	const t = smooth === true
		? 1
		: smooth === false
		? 0
		: Math.max(0, Math.min(1, smooth));
	if (t === 0) return buildLinear(points);
	return buildSmooth(points, t);
}

/** Build a closed area path: the line, down to `baselineY`, back to start.
 * Returns `""` for fewer than 2 points. */
export function buildAreaPath(
	points: PxPoint[],
	baselineY: number,
	smooth: boolean | number = false,
): string {
	const line = buildLinePath(points, smooth);
	if (!line) return "";
	const first = points[0];
	const last = points[points.length - 1];
	return `${line} L ${n(last.x)} ${n(baselineY)} L ${n(first.x)} ${n(baselineY)} Z`;
}

function buildLinear(points: PxPoint[]): string {
	const parts = [`M ${n(points[0].x)} ${n(points[0].y)}`];
	for (let i = 1; i < points.length; i++) {
		parts.push(`L ${n(points[i].x)} ${n(points[i].y)}`);
	}
	return parts.join(" ");
}

/** Monotone cubic (Fritsch-Carlson) → cubic Bézier conversion.
 *
 * The tangent at each sample is limited so a segment never leaves the range of
 * the two samples it connects: a peak peaks at its own value instead of bulging
 * past it. The plain Catmull-Rom this replaced overshot local extrema by as much
 * as several percent of the domain — invisible mid-chart, but a spike sitting on
 * a `domainY` bound had its bulge clipped away and came out with a flat top, and
 * a curve that dips under a floor of 0 shows values the data never had.
 *
 * `tension` blends each end tangent between the straight chord (0) and the full
 * monotone tangent (1); the blend stays inside the monotone region, so no
 * tension value can reintroduce overshoot. */
function buildSmooth(points: PxPoint[], tension: number): string {
	const last = points.length - 1;
	// secant slope of every interval (dy/dx in pixel space)
	const secant: number[] = [];
	for (let i = 0; i < last; i++) {
		const dx = points[i + 1].x - points[i].x;
		secant.push(dx === 0 ? 0 : (points[i + 1].y - points[i].y) / dx);
	}
	// tangent per sample: mean of the adjacent secants, flattened to 0 wherever
	// they disagree in sign (a local max/min) so the curve cannot pass the sample
	const slope: number[] = [];
	for (let i = 0; i <= last; i++) {
		if (i === 0) slope.push(secant[0]);
		else if (i === last) slope.push(secant[last - 1]);
		else if (secant[i - 1] * secant[i] <= 0) slope.push(0);
		else slope.push((secant[i - 1] + secant[i]) / 2);
	}
	// Fritsch-Carlson: shrink any tangent pair too steep for its interval
	for (let i = 0; i < last; i++) {
		if (secant[i] === 0) {
			slope[i] = slope[i + 1] = 0;
			continue;
		}
		const a = slope[i] / secant[i];
		const b = slope[i + 1] / secant[i];
		const sum = a * a + b * b;
		if (sum > 9) {
			const t = 3 / Math.sqrt(sum);
			slope[i] = t * a * secant[i];
			slope[i + 1] = t * b * secant[i];
		}
	}
	const parts = [`M ${n(points[0].x)} ${n(points[0].y)}`];
	for (let i = 0; i < last; i++) {
		const p1 = points[i];
		const p2 = points[i + 1];
		const third = (p2.x - p1.x) / 3;
		const m1 = secant[i] + (slope[i] - secant[i]) * tension;
		const m2 = secant[i] + (slope[i + 1] - secant[i]) * tension;
		parts.push(
			`C ${n(p1.x + third)} ${n(p1.y + m1 * third)}, ` +
				`${n(p2.x - third)} ${n(p2.y - m2 * third)}, ${n(p2.x)} ${n(p2.y)}`,
		);
	}
	return parts.join(" ");
}
