import { assert, assertEquals, assertStringIncludes, assertThrows } from "@std/assert";
import { renderToString } from "../src/render-string.ts";

Deno.test("renderToString: self-contained svg markup", () => {
	const svg = renderToString([3, 5, 4, 8, 6], { width: 300, height: 100 });
	assert(svg.startsWith("<svg "));
	assert(svg.endsWith("</svg>"));
	assertStringIncludes(svg, 'xmlns="http://www.w3.org/2000/svg"');
	assertStringIncludes(svg, 'width="300"');
	assertStringIncludes(svg, "trend-chart-line");
	assertStringIncludes(svg, "trend-chart-area");
	assertStringIncludes(svg, "<linearGradient");
	assertStringIncludes(svg, 'role="img"');
});

Deno.test("renderToString: throws without explicit size", () => {
	assertThrows(
		// deno-lint-ignore no-explicit-any
		() => renderToString([1, 2], { width: 300 } as any),
		Error,
		"width and height",
	);
});

Deno.test("renderToString: sparkline config omits axes chrome", () => {
	const svg = renderToString([3, 5, 4], {
		width: 300,
		height: 60,
		xAxis: false,
		yAxis: false,
		grid: false,
	});
	assert(!svg.includes("trend-chart-grid"));
	assert(!svg.includes("<text"));
});

Deno.test("renderToString: escapes label text", () => {
	const svg = renderToString([{ x: 0, y: 1 }, { x: 1, y: 2 }], {
		width: 300,
		height: 100,
		formatX: () => `<&"evil>`,
		ariaLabel: `a "quoted" & <label>`,
	});
	assert(!/<&/.test(svg));
	assertStringIncludes(svg, "&lt;&amp;&quot;evil&gt;");
	assertStringIncludes(svg, 'aria-label="a &quot;quoted&quot; &amp; &lt;label&gt;"');
	assertStringIncludes(svg, "<title>");
});

Deno.test("renderToString: endDot + zones markup", () => {
	const svg = renderToString([{ x: 0, y: 60 }, { x: 1, y: 120 }], {
		width: 300,
		height: 100,
		endDot: true,
		zones: {
			boundaries: [50, 100, 150],
			colors: ["#0a0", "#a00"],
			labels: ["lo", "hi"],
		},
	});
	assertStringIncludes(svg, "trend-chart-end-dot");
	assertStringIncludes(svg, "trend-chart-bands");
	assertStringIncludes(svg, ">lo</text>");
	// stroke uses the zone gradient
	assertStringIncludes(svg, "stroke:url(#");
});

Deno.test("renderToString: cssVars opt-in", () => {
	const plain = renderToString([1, 2], { width: 100, height: 50 });
	assert(!plain.includes("var(--trend-chart-"));
	const themed = renderToString([1, 2], { width: 100, height: 50, cssVars: true });
	assertStringIncludes(themed, "var(--trend-chart-line,");
});

Deno.test("renderToString: unique def ids across calls", () => {
	const a = renderToString([1, 2], { width: 100, height: 50 });
	const b = renderToString([1, 2], { width: 100, height: 50 });
	const idOf = (s: string) => s.match(/clipPath id="([^"]+)"/)![1];
	assert(idOf(a) !== idOf(b));
});

Deno.test("renderToString: empty data still yields valid svg", () => {
	const svg = renderToString([], { width: 100, height: 50 });
	assert(svg.startsWith("<svg "));
	assertEquals(svg.includes("trend-chart-line"), false);
});

Deno.test("renderToString: escapes color options into style attributes", () => {
	const evil = `"><script>alert(1)</script>`;
	const svg = renderToString([1, 2, 3], {
		width: 300,
		height: 100,
		lineColor: evil,
		points: "all",
		endDot: { color: evil, ringColor: evil },
	});
	// nothing after the opening tag may introduce live markup
	assertEquals(svg.slice(svg.indexOf(">") + 1).includes("<script"), false);
	assertEquals(svg.includes(evil), false);
	// all three sinks are present and escaped
	assertStringIncludes(svg, "stroke:&quot;&gt;&lt;script&gt;");
	assertStringIncludes(svg, `class="trend-chart-marker"`);
	assertStringIncludes(svg, "fill:&quot;&gt;&lt;script&gt;");
	assertStringIncludes(
		svg,
		`style="fill:&quot;&gt;&lt;script&gt;alert(1)&lt;/script&gt;;` +
			`stroke:&quot;&gt;&lt;script&gt;alert(1)&lt;/script&gt;;stroke-width:2"`,
	);
});

Deno.test("renderToString: escapes zone colors", () => {
	const svg = renderToString([{ x: 0, y: 60 }, { x: 1, y: 120 }], {
		width: 300,
		height: 100,
		zones: {
			boundaries: [50, 100, 150],
			colors: [`"><b>`, "#a00"],
			labels: ["lo", "hi"],
		},
	});
	assertEquals(svg.includes(`"><b>`), false);
	assertStringIncludes(svg, "&quot;&gt;&lt;b&gt;");
});

Deno.test("renderToString: annotation rules render behind the series, labels in front", () => {
	const svg = renderToString([{ x: 0, y: 1 }, { x: 10, y: 4 }, { x: 20, y: 2 }], {
		width: 400,
		height: 150,
		annotations: [{ x: 10, label: "bankruptcy" }],
	});
	assertStringIncludes(svg, "trend-chart-annotations");
	assertStringIncludes(svg, "stroke-dasharray:4 3");
	assertStringIncludes(svg, "#f59e0b");
	assertStringIncludes(svg, ">bankruptcy</text>");
	// context first, data on top of it, label on top of that
	assert(
		svg.indexOf("trend-chart-annotations") < svg.indexOf("trend-chart-line"),
	);
	assert(
		svg.indexOf("trend-chart-line") < svg.indexOf("trend-chart-annotation-labels"),
	);
});

Deno.test("renderToString: annotation label and color are escaped", () => {
	const svg = renderToString([{ x: 0, y: 1 }, { x: 10, y: 4 }], {
		width: 400,
		height: 150,
		annotations: [{ x: 5, label: `a<b&"c`, color: 'red"/><script>' }],
	});
	assert(!svg.includes("<script>"));
	assert(!svg.includes(`a<b&"c`));
	assertStringIncludes(svg, "a&lt;b&amp;&quot;c");
});

Deno.test("renderToString: no annotations means no annotation markup at all", () => {
	const svg = renderToString([1, 2, 3], { width: 300, height: 100 });
	assert(!svg.includes("trend-chart-annotation"));
});
