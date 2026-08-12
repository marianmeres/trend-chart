import { assertAlmostEquals, assertEquals } from "@std/assert";
import {
	clampDomainX,
	dataRangeX,
	dataRangeY,
	invertX,
	plotRect,
	type ScaleConfig,
	scaleX,
	scaleY,
} from "../src/scale.ts";

const cfg: ScaleConfig = {
	width: 120,
	height: 60,
	padding: { top: 5, right: 10, bottom: 5, left: 10 },
	domainX: [0, 100],
	domainY: [0, 50],
};

Deno.test("plotRect subtracts padding", () => {
	assertEquals(plotRect(cfg), { x: 10, y: 5, width: 100, height: 50 });
});

Deno.test("scaleX maps domain edges to plot edges", () => {
	assertEquals(scaleX(0, cfg), 10);
	assertEquals(scaleX(100, cfg), 110);
	assertEquals(scaleX(50, cfg), 60);
});

Deno.test("scaleY maps larger values to smaller pixel y", () => {
	assertEquals(scaleY(0, cfg), 55);
	assertEquals(scaleY(50, cfg), 5);
	assertEquals(scaleY(25, cfg), 30);
});

Deno.test("invertX round-trips scaleX", () => {
	for (const v of [0, 13.5, 50, 99, 100]) {
		assertAlmostEquals(invertX(scaleX(v, cfg), cfg), v, 1e-9);
	}
});

Deno.test("zero-span domains map to plot center", () => {
	const flat: ScaleConfig = { ...cfg, domainX: [5, 5], domainY: [7, 7] };
	assertEquals(scaleX(5, flat), 60);
	assertEquals(scaleY(7, flat), 30);
});

Deno.test("clampDomainX keeps span and shifts into range", () => {
	assertEquals(clampDomainX([-10, 40], [0, 100]), [0, 50]);
	assertEquals(clampDomainX([80, 130], [0, 100]), [50, 100]);
	assertEquals(clampDomainX([20, 70], [0, 100]), [20, 70]);
});

Deno.test("clampDomainX clamps span to full range and min span", () => {
	assertEquals(clampDomainX([-50, 250], [0, 100]), [0, 100]);
	assertEquals(clampDomainX([50, 51], [0, 100], 10), [50, 60]);
});

Deno.test("dataRangeX/Y", () => {
	const pts = [{ x: 1, y: 5 }, { x: 2, y: -3 }, { x: 9, y: 4 }];
	assertEquals(dataRangeX(pts), [1, 9]);
	assertEquals(dataRangeY(pts), [-3, 5]);
	assertEquals(dataRangeX([]), [0, 1]);
	assertEquals(dataRangeY([]), [0, 1]);
});
