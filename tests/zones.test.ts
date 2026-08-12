import { assertEquals } from "@std/assert";
import { zoneBands, zoneColorAt, zoneGradientStops } from "../src/zones.ts";
import type { ZoneConfig } from "../src/types.ts";

const zones: ZoneConfig = {
	boundaries: [0, 50, 100],
	colors: ["green", "red"],
	labels: ["ok", "hot"],
};

Deno.test("zoneColorAt clamps outside values to edge zones", () => {
	assertEquals(zoneColorAt(zones, -10), "green");
	assertEquals(zoneColorAt(zones, 25), "green");
	assertEquals(zoneColorAt(zones, 50), "red"); // boundary belongs to the upper zone
	assertEquals(zoneColorAt(zones, 75), "red");
	assertEquals(zoneColorAt(zones, 500), "red");
});

Deno.test("zoneGradientStops emits hard stops top→bottom", () => {
	assertEquals(zoneGradientStops(zones, [0, 100]), [
		{ offset: 0, color: "red" },
		{ offset: 0.5, color: "red" },
		{ offset: 0.5, color: "green" },
		{ offset: 1, color: "green" },
	]);
});

Deno.test("zoneGradientStops: boundaries outside the domain are dropped", () => {
	// domain fully inside zone 2
	assertEquals(zoneGradientStops(zones, [60, 90]), [
		{ offset: 0, color: "red" },
		{ offset: 1, color: "red" },
	]);
});

Deno.test("zoneGradientStops: optional uniform opacity", () => {
	const stops = zoneGradientStops(zones, [0, 100], 0.2);
	for (const s of stops) assertEquals(s.opacity, 0.2);
});

Deno.test("zoneBands computes pixel rects + labels", () => {
	const plot = { x: 0, y: 0, width: 100, height: 100 };
	const bands = zoneBands(zones, [0, 100], plot);
	assertEquals(bands.length, 2);
	// zone 1 (green, values 0-50) is the bottom half
	assertEquals(bands[0].y, 50);
	assertEquals(bands[0].height, 50);
	assertEquals(bands[0].color, "green");
	assertEquals(bands[0].label?.text, "ok");
	// zone 2 (red, 50-100) is the top half
	assertEquals(bands[1].y, 0);
	assertEquals(bands[1].height, 50);
});

Deno.test("zoneBands skips zones outside the domain", () => {
	const plot = { x: 0, y: 0, width: 100, height: 100 };
	const bands = zoneBands(zones, [60, 90], plot);
	assertEquals(bands.length, 1);
	assertEquals(bands[0].color, "red");
	assertEquals(bands[0].height, 100);
});

Deno.test("zoneGradientStops: domain top edge on a boundary paints the visible zone", () => {
	// domainY[1] === 50 is a boundary; everything visible is the green zone, and
	// the corrective hard-stop pair would land at offset 0 and be skipped
	assertEquals(zoneGradientStops(zones, [0, 50]), [
		{ offset: 0, color: "green" },
		{ offset: 1, color: "green" },
	]);
});

Deno.test("zoneGradientStops: domain bottom edge on a boundary paints the visible zone", () => {
	assertEquals(zoneGradientStops(zones, [50, 100]), [
		{ offset: 0, color: "red" },
		{ offset: 1, color: "red" },
	]);
});

Deno.test("zoneGradientStops: edge stops agree with zoneBands", () => {
	const three: ZoneConfig = {
		boundaries: [0, 25, 50, 100],
		colors: ["a", "b", "c"],
	};
	const plot = { x: 0, y: 0, width: 100, height: 100 };
	for (const domainY of [[0, 50], [25, 50], [0, 25], [0, 100]] as [number, number][]) {
		const stops = zoneGradientStops(three, domainY);
		const bands = zoneBands(three, domainY, plot);
		// bands run bottom (low values) → top; stops run top → bottom
		assertEquals(stops[0].color, bands.at(-1)?.color, `top @ ${domainY}`);
		assertEquals(stops.at(-1)?.color, bands[0].color, `bottom @ ${domainY}`);
	}
});

Deno.test("zoneGradientStops: boundary-capped domain keeps its interior hard stops", () => {
	const three: ZoneConfig = {
		boundaries: [0, 25, 50, 100],
		colors: ["a", "b", "c"],
	};
	assertEquals(zoneGradientStops(three, [0, 50]), [
		{ offset: 0, color: "b" },
		{ offset: 0.5, color: "b" },
		{ offset: 0.5, color: "a" },
		{ offset: 1, color: "a" },
	]);
});
