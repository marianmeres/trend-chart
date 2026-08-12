import { assert, assertEquals } from "@std/assert";
import {
	evenTicks,
	niceDomain,
	niceTicks,
	resolveXTicks,
	sampleTicks,
	ticksForStep,
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

Deno.test("niceTicks terminates when the step is below the domain's float resolution", () => {
	// these hang forever under an accumulating `v += step` loop (min + step === min),
	// so a regression here shows up as a stuck test run rather than a failed assert
	const t1 = niceTicks([1e15, 1e15 + 0.125], 5);
	assert(t1.length > 0 && t1.length < 1000);
	const t2 = niceTicks([1.7e18, 1.7e18 + 300], 5);
	assert(t2.length > 0 && t2.length < 1000);
});

Deno.test("niceTicks output length stays bounded for hostile tick counts", () => {
	for (const count of [1e6, 1e9, Number.MAX_SAFE_INTEGER, Infinity, NaN, -5, 0]) {
		const t = niceTicks([0, 100], count);
		assert(t.length >= 1 && t.length <= 1001, `count ${count} → ${t.length} ticks`);
	}
});

Deno.test("niceDomain expands outward to nice bounds", () => {
	const [min, max, step] = niceDomain([15, 65], 5);
	assertEquals([min, max, step], [10, 70, 10]);
});

Deno.test("ticksForStep walks the lattice from min to max", () => {
	assertEquals(ticksForStep(0, 120, 20), [0, 20, 40, 60, 80, 100, 120]);
	assertEquals(ticksForStep(-120, 0, 20), [-120, -100, -80, -60, -40, -20, 0]);
	// snapped, no accumulated float drift
	assertEquals(ticksForStep(0, 0.5, 0.1), [0, 0.1, 0.2, 0.3, 0.4, 0.5]);
});

Deno.test("ticksForStep: degenerate steps stay bounded and deduped", () => {
	assertEquals(ticksForStep(5, 10, 0), [5]);
	assertEquals(ticksForStep(5, 10, NaN), [5]);
	assertEquals(ticksForStep(5, 10, Infinity), [5]);
	assertEquals(ticksForStep(10, 5, 1), [10]); // max < min → no lattice to walk
	assert(ticksForStep(0, 100, 1e-9).length <= 1001); // capped
	// a step below the domain's float resolution can't advance every index, so
	// the output collapses to the distinct representable values instead of
	// repeating one value per index
	const collapsed = ticksForStep(1e15, 1e15 + 1, 0.001);
	assert(collapsed.length < 20, `${collapsed.length} ticks`);
	for (let i = 1; i < collapsed.length; i++) {
		assert(collapsed[i] > collapsed[i - 1], `not strictly increasing: ${collapsed}`);
	}
});

Deno.test("niceTicks is ticksForStep over the niceDomain triple", () => {
	for (const d of [[0, 100], [15, 65], [-30, 30], [0.12, 0.31], [5, 5]]) {
		const domain = d as [number, number];
		assertEquals(niceTicks(domain, 5), ticksForStep(...niceDomain(domain, 5)));
	}
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
