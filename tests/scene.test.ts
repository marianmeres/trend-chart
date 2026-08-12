import { assert, assertEquals } from "@std/assert";
import { computeScene, normalizeData } from "../src/scene.ts";

const ctx = { width: 300, height: 150, idPrefix: "t" };

Deno.test("normalizeData: number[] shorthand becomes {x: index, y}", () => {
	assertEquals(normalizeData([5, 7]), [{ x: 0, y: 5 }, { x: 1, y: 7 }]);
	assertEquals(normalizeData([{ x: 3, y: 4 }]), [{ x: 3, y: 4 }]);
	assertEquals(normalizeData([]), []);
});

Deno.test("sparkline config: no axes, no grid, has line + fade fill", () => {
	const s = computeScene([3, 5, 4, 8, 6], {
		xAxis: false,
		yAxis: false,
		grid: false,
	}, ctx);
	assertEquals(s.xLabels, []);
	assertEquals(s.yLabels, []);
	assertEquals(s.grid, []);
	assert(s.linePath.startsWith("M "));
	assert(s.areaPath.endsWith("Z"));
	assertEquals(s.fillGradient!.stops.length, 2);
	assertEquals(s.fillGradient!.stops[1].opacity, 0);
	assertEquals(s.strokeGradient, null);
	// axis-less padding stays minimal
	assert(s.plot.x < 10);
});

Deno.test("axes config: labels, gridlines, nice y domain", () => {
	const s = computeScene(
		[{ x: 0, y: 15 }, { x: 50, y: 42 }, { x: 100, y: 65 }],
		{},
		ctx,
	);
	assert(s.yLabels.length > 2);
	assert(s.xLabels.length >= 2);
	assertEquals(s.grid.length, s.yLabels.length);
	// nice-expanded domain
	assertEquals(s.domainY, [10, 70]);
	// y-axis reserves left padding
	assert(s.plot.x >= 40);
});

Deno.test("y ticks and y domain come from one niceDomain pass — the bound is labeled", () => {
	// [0, 105] expands to [0, 120] at step 20; a second niceDomain pass over the
	// expanded domain used to pick step 50, labeling only 0/50/100 and leaving the
	// top sixth of the axis blank
	const s = computeScene(Array.from({ length: 22 }, (_, i) => i * 5), {}, ctx);
	assertEquals(s.domainY, [0, 120]);
	assertEquals(s.yLabels.map((l) => l.text), [
		"0",
		"20",
		"40",
		"60",
		"80",
		"100",
		"120",
	]);
	// symmetric for a negative range: the bottom bound gets a label too
	const n = computeScene(
		Array.from({ length: 22 }, (_, i) => -105 + i * 5),
		{},
		ctx,
	);
	assertEquals(n.domainY, [-120, 0]);
	assertEquals(n.yLabels[0].text, "-120");
});

Deno.test("every y domain bound is labeled and the ticks are evenly spaced", () => {
	for (let m = 1; m <= 400; m++) {
		const s = computeScene([0, m], {}, ctx);
		const vals = s.yLabels.map((l) => Number(l.text));
		assertEquals(vals[0], s.domainY[0], `[0, ${m}] lower bound unlabeled`);
		assertEquals(
			vals[vals.length - 1],
			s.domainY[1],
			`[0, ${m}] upper bound unlabeled`,
		);
		// uniform lattice
		const step = vals[1] - vals[0];
		for (let i = 1; i < vals.length; i++) {
			assert(
				Math.abs(vals[i] - vals[i - 1] - step) < step * 1e-9,
				`[0, ${m}] non-uniform tick spacing: ${vals}`,
			);
		}
	}
});

Deno.test("explicit domainY array still derives its own ticks", () => {
	const s = computeScene([1, 2, 3], { domainY: [0, 100] }, ctx);
	assertEquals(s.domainY, [0, 100]);
	assertEquals(s.yLabels.map((l) => Number(l.text)), [0, 20, 40, 60, 80, 100]);
});

Deno.test("smooth + endDot", () => {
	const s = computeScene([1, 2, 3], { smooth: true, endDot: true }, ctx);
	assert(s.linePath.includes("C "));
	assert(s.endDot !== null);
	// end dot sits on the last point
	const last = s.visible[s.visible.length - 1];
	assertEquals(s.endDot!.px, last.px);
});

Deno.test("endDot hidden when the dataset end is panned out of view", () => {
	const data = Array.from({ length: 10 }, (_, i) => ({ x: i, y: i }));
	const s = computeScene(data, { endDot: true }, { ...ctx, domainX: [0, 5] });
	assertEquals(s.endDot, null);
});

Deno.test("zones: stroke gradient + bands + full-range y domain by default", () => {
	const data = [{ x: 0, y: 60 }, { x: 1, y: 120 }, { x: 2, y: 80 }];
	const s = computeScene(data, {
		zones: { boundaries: [50, 100, 150], colors: ["green", "red"] },
	}, ctx);
	assert(s.strokeGradient !== null);
	assert(s.strokeGradient!.stops.length >= 4);
	assert(s.bands.length >= 1);
	assert(s.fillGradient !== null);
});

Deno.test("fill: false disables area and fill gradient", () => {
	const s = computeScene([1, 2, 3], { fill: false }, ctx);
	assertEquals(s.areaPath, "");
	assertEquals(s.fillGradient, null);
});

Deno.test("points: 'all' emits markers, 'nearest' does not", () => {
	const all = computeScene([1, 2, 3], { points: "all" }, ctx);
	assertEquals(all.markers.length, 3);
	const nearest = computeScene([1, 2, 3], { points: "nearest" }, ctx);
	assertEquals(nearest.markers, []);
	assertEquals(nearest.visible.length, 3);
});

Deno.test("domainX pans the visible window", () => {
	const data = Array.from({ length: 100 }, (_, i) => ({ x: i, y: i % 10 }));
	const s = computeScene(data, {}, { ...ctx, domainX: [20, 40] });
	assertEquals(s.domainX, [20, 40]);
	assert(s.visible.length < 30);
	assert(s.visible[0].index >= 19); // overscan of 1
});

Deno.test("cssVars wraps colors in custom property references", () => {
	const s = computeScene([1, 2], {}, { ...ctx, cssVars: true });
	assert(s.lineColor.startsWith("var(--trend-chart-line,"));
	const plain = computeScene([1, 2], {}, ctx);
	assertEquals(plain.lineColor, "#4a9eed");
});

Deno.test("empty data produces an empty but valid scene", () => {
	const s = computeScene([], {}, ctx);
	assertEquals(s.linePath, "");
	assertEquals(s.areaPath, "");
	assertEquals(s.visible, []);
});
