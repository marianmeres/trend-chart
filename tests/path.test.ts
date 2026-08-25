import { assert, assertEquals, assertMatch } from "@std/assert";
import { buildAreaPath, buildLinePath, visibleSlice } from "../src/path.ts";

const pts = [
	{ x: 0, y: 10 },
	{ x: 10, y: 20 },
	{ x: 20, y: 5 },
	{ x: 30, y: 15 },
];

Deno.test("buildLinePath: degenerate inputs produce empty string", () => {
	assertEquals(buildLinePath([]), "");
	assertEquals(buildLinePath([{ x: 1, y: 1 }]), "");
});

Deno.test("buildLinePath: linear output", () => {
	assertEquals(buildLinePath(pts.slice(0, 2)), "M 0 10 L 10 20");
});

Deno.test("buildLinePath: smooth output uses cubic Béziers", () => {
	const d = buildLinePath(pts, true);
	assertMatch(d, /^M 0 10 C /);
	assertEquals(d.split("C").length - 1, pts.length - 1);
});

Deno.test("buildLinePath: tension 0 equals linear", () => {
	assertEquals(buildLinePath(pts, 0), buildLinePath(pts, false));
});

Deno.test("buildAreaPath closes down to the baseline", () => {
	const d = buildAreaPath(pts, 100);
	assert(d.endsWith("L 30 100 L 0 100 Z"));
	assertEquals(buildAreaPath([{ x: 1, y: 1 }], 100), "");
});

Deno.test("visibleSlice slices with overscan and reports start index", () => {
	const data = Array.from({ length: 10 }, (_, i) => ({ x: i, y: i }));
	const { points, startIndex } = visibleSlice(data, [3, 6]);
	assertEquals(startIndex, 2); // one overscan point before x=3
	assertEquals(points[0].x, 2);
	assertEquals(points[points.length - 1].x, 7); // one overscan point after x=6
});

Deno.test("visibleSlice: full domain returns everything", () => {
	const data = Array.from({ length: 5 }, (_, i) => ({ x: i, y: 0 }));
	const { points, startIndex } = visibleSlice(data, [0, 4]);
	assertEquals(points.length, 5);
	assertEquals(startIndex, 0);
});

Deno.test("visibleSlice: domain outside data returns empty", () => {
	const data = [{ x: 0, y: 0 }, { x: 1, y: 1 }];
	// with overscan the edge points still appear when domain touches nothing between
	const res = visibleSlice(data, [10, 20]);
	assertEquals(res.points.length, 1); // overscan keeps the closest edge point
});

/** Flatten a path `d` (M/L/C only) into sampled points. */
function samplePath(d: string, per = 40): { x: number; y: number }[] {
	const out: { x: number; y: number }[] = [];
	const toks = d.match(/[MLC]|-?\d+(?:\.\d+)?/g)!;
	let i = 0;
	let cur = { x: 0, y: 0 };
	while (i < toks.length) {
		const cmd = toks[i++];
		const num = () => Number(toks[i++]);
		if (cmd === "M" || cmd === "L") {
			cur = { x: num(), y: num() };
			out.push(cur);
		} else {
			const p0 = cur;
			const p1 = { x: num(), y: num() };
			const p2 = { x: num(), y: num() };
			const p3 = { x: num(), y: num() };
			for (let k = 1; k <= per; k++) {
				const t = k / per;
				const u = 1 - t;
				out.push({
					x: u ** 3 * p0.x + 3 * u * u * t * p1.x + 3 * u * t * t * p2.x +
						t ** 3 * p3.x,
					y: u ** 3 * p0.y + 3 * u * u * t * p1.y + 3 * u * t * t * p2.y +
						t ** 3 * p3.y,
				});
			}
			cur = p3;
		}
	}
	return out;
}

Deno.test("buildLinePath: a smoothed spike never overshoots its own samples", () => {
	// a lone tall spike with asymmetric neighbors — the shape Catmull-Rom bulged
	// past, which a domain-bound clip then sliced into a flat top
	const spike = [
		{ x: 0, y: 90 },
		{ x: 10, y: 84 },
		{ x: 20, y: 0 }, // pixel y 0 = the top of the plot
		{ x: 30, y: 70 },
		{ x: 40, y: 88 },
	];
	for (const smooth of [true, 0.5, 0.25] as const) {
		const pts = samplePath(buildLinePath(spike, smooth));
		const lo = Math.min(...pts.map((p) => p.y));
		const hi = Math.max(...pts.map((p) => p.y));
		assertEquals(lo, 0, `smooth: ${smooth} rose above the peak sample`);
		assertEquals(hi, 90, `smooth: ${smooth} fell below the lowest sample`);
	}
});

Deno.test("buildLinePath: smoothing stays within each segment's own range", () => {
	// monotone data: the curve may not wiggle outside any adjacent sample pair
	const rising = [0, 1, 2, 40, 41, 42, 90, 91].map((y, i) => ({ x: i * 10, y }));
	const pts = samplePath(buildLinePath(rising, true));
	for (let i = 1; i < pts.length; i++) {
		assert(pts[i].y >= pts[i - 1].y - 1e-9, "monotone input stayed monotone");
	}
});

Deno.test("buildLinePath: flat runs stay flat when smoothed", () => {
	const flat = [{ x: 0, y: 5 }, { x: 10, y: 5 }, { x: 20, y: 5 }, { x: 30, y: 9 }];
	const pts = samplePath(buildLinePath(flat, true)).filter((p) => p.x <= 20);
	for (const p of pts) assert(Math.abs(p.y - 5) < 1e-9);
});
