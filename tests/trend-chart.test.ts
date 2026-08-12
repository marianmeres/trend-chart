// Public API surface smoke test. The TrendChart class itself is DOM-bound and
// covered by manual/visual testing (tmp/demo) — everything below it (scene,
// paths, scales, ticks, zones, string rendering) is unit-tested without a DOM.
import { assert, assertEquals } from "@std/assert";
import * as mod from "../src/mod.ts";

Deno.test("public exports", () => {
	assertEquals(typeof mod.TrendChart, "function");
	assertEquals(typeof mod.renderToString, "function");
	assertEquals(typeof mod.computeScene, "function");
	assertEquals(typeof mod.niceTicks, "function");
	assertEquals(typeof mod.buildLinePath, "function");
	assertEquals(typeof mod.attachGestures, "function");
});

Deno.test("renderToString works end-to-end via mod", () => {
	const svg = mod.renderToString([1, 3, 2], { width: 200, height: 80 });
	assert(svg.includes("</svg>"));
});
