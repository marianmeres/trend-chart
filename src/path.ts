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
 * (full Catmull-Rom smoothing) or a `0..1` tension. Returns `""` for fewer
 * than 2 points. */
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

/** Catmull-Rom → cubic Bézier conversion. Control points are derived from the
 * neighbors of each segment; endpoints reuse themselves as phantom neighbors. */
function buildSmooth(points: PxPoint[], tension: number): string {
	const parts = [`M ${n(points[0].x)} ${n(points[0].y)}`];
	const k = tension / 6;
	for (let i = 0; i < points.length - 1; i++) {
		const p0 = points[i - 1] ?? points[i];
		const p1 = points[i];
		const p2 = points[i + 1];
		const p3 = points[i + 2] ?? points[i + 1];
		const c1x = p1.x + (p2.x - p0.x) * k;
		const c1y = p1.y + (p2.y - p0.y) * k;
		const c2x = p2.x - (p3.x - p1.x) * k;
		const c2y = p2.y - (p3.y - p1.y) * k;
		parts.push(
			`C ${n(c1x)} ${n(c1y)}, ${n(c2x)} ${n(c2y)}, ${n(p2.x)} ${n(p2.y)}`,
		);
	}
	return parts.join(" ");
}
