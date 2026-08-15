import { assert, assertEquals, assertStrictEquals } from "@std/assert";
import { computeScene, normalizeData } from "../src/scene.ts";
import type { DataPoint } from "../src/types.ts";

const ctx = { width: 300, height: 150, idPrefix: "t" };

Deno.test("normalizeData: number[] shorthand becomes {x: index, y}", () => {
	assertEquals(normalizeData([5, 7]), [{ x: 0, y: 5 }, { x: 1, y: 7 }]);
	assertEquals(normalizeData([{ x: 3, y: 4 }]), [{ x: 3, y: 4 }]);
	assertEquals(normalizeData([]), []);
});

Deno.test("normalizeData: DataPoint[] passes through untouched — `data` payload, identity", () => {
	const data: DataPoint[] = [{ x: 0, y: 1, data: { id: "a" } }, { x: 1, y: 2 }];
	// same array, same objects — the `data` passthrough contract relies on it
	assertStrictEquals(normalizeData(data), data);
});

Deno.test("DataPoint.data survives the index round trip, dropped samples included", () => {
	const data: DataPoint[] = [
		{ x: 0, y: 1, data: "a" },
		{ x: 1, y: NaN, data: "dropped" },
		{ x: 2, y: 3, data: "b" },
		{ x: 3, y: 4 },
	];
	const s = computeScene(data, {}, ctx);
	// `PointEvent.point` is `data[index]` — the very lookup exercised here
	assertEquals(s.visible.map((p) => data[p.index].data), ["a", "b", undefined]);
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

Deno.test("non-finite samples are dropped instead of truncating the line", () => {
	// a NaN reaching the `d` attribute halts SVG path rendering from there on,
	// so the line used to just stop while the axes still looked correct
	const s = computeScene([1, 2, NaN, 4], {}, ctx);
	assert(!s.linePath.includes("NaN"));
	assert(!s.areaPath.includes("NaN"));
	assertEquals(s.visible.map((p) => p.y), [1, 2, 4]);
	// four `M`/`L` commands minus the dropped one
	assertEquals(s.linePath.split(" L ").length, 3);
});

Deno.test("dropped samples keep ScenePoint.index pointing into the full dataset", () => {
	const data = [
		{ x: 0, y: 1 },
		{ x: 1, y: NaN },
		{ x: 2, y: 3 },
		{ x: 3, y: Infinity },
		{ x: NaN, y: 5 },
		{ x: 5, y: 6 },
	];
	const s = computeScene(data, {}, ctx);
	assertEquals(s.visible.map((p) => p.index), [0, 2, 5]);
	// index still resolves to the original sample (PointEvent.index contract)
	for (const p of s.visible) {
		assertEquals(data[p.index].y, p.y);
	}
});

Deno.test("dropped samples keep indices correct under a panned domain", () => {
	const data = Array.from({ length: 20 }, (_, i) => ({
		x: i,
		y: i % 3 === 0 ? NaN : i,
	}));
	const s = computeScene(data, {}, { ...ctx, domainX: [8, 14] });
	for (const p of s.visible) {
		assertEquals(data[p.index].x, p.x);
		assertEquals(data[p.index].y, p.y);
	}
	assert(s.visible.every((p) => Number.isFinite(p.y)));
});

Deno.test("an infinite sample does not poison the y domain", () => {
	// ±Infinity survives dataRangeY's comparisons (unlike NaN), so it used to
	// collapse the whole plot into a single pixel row
	const auto = computeScene([10, 20, Infinity, 30], {}, ctx);
	assertEquals(auto.domainY, [10, 30]);
	const full = computeScene([10, 20, -Infinity, 30], { domainY: "full" }, ctx);
	assert(Number.isFinite(full.domainY[0]) && Number.isFinite(full.domainY[1]));
	assert(full.yLabels.every((l) => !l.text.includes("Infinity")));
});

Deno.test("all-non-finite data falls back to the empty-data scene", () => {
	const s = computeScene([NaN, Infinity, -Infinity], {}, ctx);
	assertEquals(s.visible, []);
	assertEquals(s.linePath, "");
	assertEquals(s.areaPath, "");
	assertEquals(s.domainY, [0, 1]);
	assertEquals(s.domainX, [0, 1]);
	assert(s.grid.every((g) => Number.isFinite(g.y1)));
	assert(s.yLabels.every((l) => Number.isFinite(l.y)));
});

Deno.test("endDot follows the last plottable sample, not a dropped tail", () => {
	const data = Array.from({ length: 10 }, (_, i) => ({
		x: i,
		y: i >= 8 ? NaN : i,
	}));
	const s = computeScene(data, { endDot: true }, ctx);
	assert(s.endDot !== null);
	assertEquals(s.endDot!.px, s.visible[s.visible.length - 1].px);
	assertEquals(s.visible[s.visible.length - 1].index, 7);
	// still hidden when the (dropped-tail) dataset end is panned away
	const panned = computeScene(data, { endDot: true }, { ...ctx, domainX: [0, 4] });
	assertEquals(panned.endDot, null);
});

/* --- annotations ---------------------------------------------------------- */

const ANN_DATA = Array.from({ length: 21 }, (_, i) => ({ x: i * 5, y: 10 + i }));

Deno.test("annotations: rule spans the plot, index maps back to the option array", () => {
	const s = computeScene(ANN_DATA, {
		annotations: [{ x: 50, label: "bankruptcy" }],
	}, ctx);
	assertEquals(s.annotations.length, 1);
	const a = s.annotations[0];
	assertEquals(a.index, 0);
	assertEquals(a.x, 50);
	assertEquals(a.y1, s.plot.y);
	assertEquals(a.y2, s.plot.y + s.plot.height);
	// x need not coincide with a sample
	const off = computeScene(ANN_DATA, { annotations: [{ x: 52.5 }] }, ctx);
	assert(off.annotations[0].px > a.px);
});

Deno.test("annotations: outside the visible window are dropped, not clamped", () => {
	const opts = { annotations: [{ x: 5 }, { x: 50 }, { x: 95 }] };
	const all = computeScene(ANN_DATA, opts, ctx);
	assertEquals(all.annotations.map((a) => a.index), [0, 1, 2]);
	const panned = computeScene(ANN_DATA, opts, { ...ctx, domainX: [40, 60] });
	assertEquals(panned.annotations.map((a) => a.index), [1]);
	// non-finite x is dropped like a non-finite sample
	const bad = computeScene(ANN_DATA, { annotations: [{ x: NaN }] }, ctx);
	assertEquals(bad.annotations, []);
});

Deno.test("annotations: emitted ascending by px, whatever the input order", () => {
	const s = computeScene(ANN_DATA, {
		annotations: [{ x: 80 }, { x: 20 }, { x: 50 }],
	}, ctx);
	assertEquals(s.annotations.map((a) => a.index), [1, 2, 0]);
	assertEquals(s.annotations.map((a) => a.x), [20, 50, 80]);
});

Deno.test("annotations: a colliding label is dropped, its rule is not", () => {
	const s = computeScene(ANN_DATA, {
		annotations: [
			{ x: 20, label: "refinery fire" },
			{ x: 21, label: "opec meeting" },
		],
	}, ctx);
	assertEquals(s.annotations.length, 2);
	assert(s.annotations[0].label, "the first label is placed");
	assertEquals(s.annotations[1].label, undefined);
});

Deno.test("annotations: a label near the right edge flips to the left of its rule", () => {
	const s = computeScene(ANN_DATA, {
		annotations: [{ x: 100, label: "bankruptcy" }],
	}, ctx);
	const label = s.annotations[0].label!;
	assertEquals(label.anchor, "end");
	assert(label.x <= s.annotations[0].px);
	assert(label.x <= s.plot.x + s.plot.width);
});

Deno.test("annotations: color defaults are themable, explicit ones pass through", () => {
	const themed = computeScene(ANN_DATA, { annotations: [{ x: 50 }] }, {
		...ctx,
		cssVars: true,
	});
	assertEquals(
		themed.annotations[0].color,
		"var(--trend-chart-annotation, #f59e0b)",
	);
	assertEquals(themed.annotations[0].dash, true);
	const explicit = computeScene(ANN_DATA, {
		annotations: [{ x: 50, color: "rebeccapurple", dash: false }],
	}, { ...ctx, cssVars: true });
	assertEquals(explicit.annotations[0].color, "rebeccapurple");
	assertEquals(explicit.annotations[0].dash, false);
});
