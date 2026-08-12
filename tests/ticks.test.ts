import { assert, assertEquals } from "@std/assert";
import {
	evenTicks,
	niceDomain,
	niceTicks,
	resolveXTicks,
	sampleTicks,
} from "../src/ticks.ts";

Deno.test("sampleTicks picks evenly index-spaced real samples", () => {
	const xs = Array.from({ length: 41 }, (_, i) => i);
	assertEquals(sampleTicks(xs, 5), [0, 10, 20, 30, 40]);
	assertEquals(sampleTicks([1, 2, 3], 5), [1, 2, 3]); // fewer samples than ticks
	assertEquals(sampleTicks([], 5), []);
	assertEquals(sampleTicks([7, 7, 7], 5), [7]); // deduped
});

Deno.test("niceTicks produces round values covering the domain", () => {
	assertEquals(niceTicks([0, 100], 5), [0, 20, 40, 60, 80, 100]);
	assertEquals(niceTicks([15, 65], 5), [10, 20, 30, 40, 50, 60, 70]);
});

Deno.test("niceTicks handles negative and fractional domains", () => {
	const t1 = niceTicks([-30, 30], 5);
	assert(t1[0] <= -30 && t1[t1.length - 1] >= 30);
	const t2 = niceTicks([0.12, 0.31], 5);
	assert(t2[0] <= 0.12 && t2[t2.length - 1] >= 0.31);
	// snapped, no floating point garbage
	for (const v of t2) assertEquals(v, Number(v.toFixed(3)));
});

Deno.test("niceTicks: zero-span domain is padded, not crashed", () => {
	const t = niceTicks([5, 5], 5);
	assert(t.length > 1);
	assert(t[0] < 5 && t[t.length - 1] > 5);
});

Deno.test("niceDomain expands outward to nice bounds", () => {
	const [min, max, step] = niceDomain([15, 65], 5);
	assertEquals([min, max, step], [10, 70, 10]);
});

Deno.test("evenTicks includes endpoints", () => {
	assertEquals(evenTicks([0, 10], 3), [0, 5, 10]);
	assertEquals(evenTicks([0, 10], 1), [5]);
	assertEquals(evenTicks([0, 10], 0), []);
});

Deno.test("resolveXTicks: default count derives from plot width", () => {
	const t = resolveXTicks([0, 100], 400, undefined);
	assertEquals(t.length, 5); // 400 / 80
	assertEquals(t[0], 0);
	assertEquals(t[t.length - 1], 100);
});

Deno.test("resolveXTicks: explicit array is filtered to the domain", () => {
	assertEquals(resolveXTicks([10, 50], 400, [0, 10, 30, 50, 90]), [10, 30, 50]);
});

Deno.test("resolveXTicks: callback receives the domain", () => {
	const t = resolveXTicks([0, 100], 400, (d) => [d[0], (d[0] + d[1]) / 2, d[1], 999]);
	assertEquals(t, [0, 50, 100]); // 999 filtered out
});

Deno.test("resolveXTicks: numeric option sets the count", () => {
	assertEquals(resolveXTicks([0, 100], 400, 3), [0, 50, 100]);
});
