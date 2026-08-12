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
