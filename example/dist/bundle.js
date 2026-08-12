function plotRect(cfg) {
    const { width, height, padding } = cfg;
    return {
        x: padding.left,
        y: padding.top,
        width: Math.max(0, width - padding.left - padding.right),
        height: Math.max(0, height - padding.top - padding.bottom)
    };
}
function span(domain) {
    return domain[1] - domain[0];
}
function scaleX(value, cfg) {
    const plot = plotRect(cfg);
    const s = span(cfg.domainX);
    if (s === 0) return plot.x + plot.width / 2;
    return plot.x + (value - cfg.domainX[0]) / s * plot.width;
}
function scaleY(value, cfg) {
    const plot = plotRect(cfg);
    const s = span(cfg.domainY);
    if (s === 0) return plot.y + plot.height / 2;
    return plot.y + (1 - (value - cfg.domainY[0]) / s) * plot.height;
}
function invertX(pixelX, cfg) {
    const plot = plotRect(cfg);
    if (plot.width === 0) return cfg.domainX[0];
    return cfg.domainX[0] + (pixelX - plot.x) / plot.width * span(cfg.domainX);
}
function clampDomainX(domain, full, minSpan = 0) {
    const fullSpan = Math.max(0, span(full));
    let s = span(domain);
    if (!Number.isFinite(s) || s <= 0) s = fullSpan;
    s = Math.min(Math.max(s, Math.min(minSpan, fullSpan)), fullSpan || s);
    let d0 = domain[0];
    if (d0 < full[0]) d0 = full[0];
    if (d0 + s > full[1]) d0 = full[1] - s;
    if (d0 < full[0]) d0 = full[0];
    return [
        d0,
        d0 + s
    ];
}
function dataRangeX(points) {
    if (!points.length) return [
        0,
        1
    ];
    return [
        points[0].x,
        points[points.length - 1].x
    ];
}
function dataRangeY(points) {
    if (!points.length) return [
        0,
        1
    ];
    let min = Infinity;
    let max = -Infinity;
    for (const p of points){
        if (p.y < min) min = p.y;
        if (p.y > max) max = p.y;
    }
    return [
        min,
        max
    ];
}
function n(v) {
    return Math.round(v * 100) / 100;
}
function visibleSlice(points, domainX, overscan = 1) {
    if (!points.length) return {
        points: [],
        startIndex: 0
    };
    let start = 0;
    while(start < points.length && points[start].x < domainX[0])start++;
    let end = points.length;
    while(end > 0 && points[end - 1].x > domainX[1])end--;
    start = Math.max(0, start - overscan);
    end = Math.min(points.length, end + overscan);
    if (start >= end) return {
        points: [],
        startIndex: 0
    };
    return {
        points: points.slice(start, end),
        startIndex: start
    };
}
function buildLinePath(points, smooth = false) {
    if (points.length < 2) return "";
    const t = smooth === true ? 1 : smooth === false ? 0 : Math.max(0, Math.min(1, smooth));
    if (t === 0) return buildLinear(points);
    return buildSmooth(points, t);
}
function buildAreaPath(points, baselineY, smooth = false) {
    const line = buildLinePath(points, smooth);
    if (!line) return "";
    const first = points[0];
    const last = points[points.length - 1];
    return `${line} L ${n(last.x)} ${n(baselineY)} L ${n(first.x)} ${n(baselineY)} Z`;
}
function buildLinear(points) {
    const parts = [
        `M ${n(points[0].x)} ${n(points[0].y)}`
    ];
    for(let i = 1; i < points.length; i++){
        parts.push(`L ${n(points[i].x)} ${n(points[i].y)}`);
    }
    return parts.join(" ");
}
function buildSmooth(points, tension) {
    const parts = [
        `M ${n(points[0].x)} ${n(points[0].y)}`
    ];
    const k = tension / 6;
    for(let i = 0; i < points.length - 1; i++){
        const p0 = points[i - 1] ?? points[i];
        const p1 = points[i];
        const p2 = points[i + 1];
        const p3 = points[i + 2] ?? points[i + 1];
        const c1x = p1.x + (p2.x - p0.x) * k;
        const c1y = p1.y + (p2.y - p0.y) * k;
        const c2x = p2.x - (p3.x - p1.x) * k;
        const c2y = p2.y - (p3.y - p1.y) * k;
        parts.push(`C ${n(c1x)} ${n(c1y)}, ${n(c2x)} ${n(c2y)}, ${n(p2.x)} ${n(p2.y)}`);
    }
    return parts.join(" ");
}
function niceNum(x, round) {
    if (x === 0 || !Number.isFinite(x)) return 0;
    const exp = Math.floor(Math.log10(x));
    const f = x / 10 ** exp;
    let nf;
    if (round) nf = f < 1.5 ? 1 : f < 3 ? 2 : f < 7 ? 5 : 10;
    else nf = f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10;
    return nf * 10 ** exp;
}
function snap(v, step) {
    const p = Math.max(0, -Math.floor(Math.log10(step)) + 1);
    return Number(v.toFixed(Math.min(20, p + 1)));
}
function niceDomain(domain, targetCount = 5) {
    let [min, max] = domain;
    if (min === max) {
        const pad = min === 0 ? 1 : Math.abs(min) * 0.1;
        min -= pad;
        max += pad;
    }
    const step = niceNum((max - min) / Math.max(1, targetCount - 1), true);
    if (!step) return [
        min,
        max,
        0
    ];
    return [
        snap(Math.floor(min / step) * step, step),
        snap(Math.ceil(max / step) * step, step),
        step
    ];
}
function ticksForStep(min, max, step) {
    if (!step || !Number.isFinite(step)) return [
        min
    ];
    const count = Math.floor((max - min) / step + 0.5);
    if (!Number.isFinite(count) || count < 0) return [
        min
    ];
    const out = [];
    for(let i = 0; i <= Math.min(count, 1000); i++){
        const v = snap(min + i * step, step);
        if (out[out.length - 1] !== v) out.push(v);
    }
    return out;
}
function niceTicks(domain, targetCount = 5) {
    return ticksForStep(...niceDomain(domain, targetCount));
}
function evenTicks(domain, count) {
    if (count <= 0) return [];
    if (count === 1) return [
        (domain[0] + domain[1]) / 2
    ];
    const out = [];
    const step = (domain[1] - domain[0]) / (count - 1);
    for(let i = 0; i < count; i++)out.push(domain[0] + step * i);
    return out;
}
function sampleTicks(samples, count) {
    if (count <= 0 || !samples.length) return [];
    if (samples.length <= count) return [
        ...new Set(samples)
    ];
    const out = [];
    for(let i = 0; i < count; i++){
        const idx = Math.round(i * (samples.length - 1) / (count - 1));
        const v = samples[idx];
        if (out[out.length - 1] !== v) out.push(v);
    }
    return out;
}
function resolveXTicks(domain, plotWidth, option) {
    if (typeof option === "function") {
        return option(domain).filter((v)=>v >= domain[0] && v <= domain[1]);
    }
    if (Array.isArray(option)) {
        return option.filter((v)=>v >= domain[0] && v <= domain[1]);
    }
    const count = typeof option === "number" ? Math.max(0, Math.floor(option)) : Math.min(8, Math.max(2, Math.floor(plotWidth / 80)));
    return evenTicks(domain, count);
}
function clamp01(v) {
    return Math.max(0, Math.min(1, v));
}
function zoneColorAt(zones, value) {
    const { boundaries, colors } = zones;
    let i = 0;
    while(i < boundaries.length && boundaries[i] <= value)i++;
    return colors[Math.max(0, Math.min(i - 1, colors.length - 1))];
}
function zoneColorBelow(zones, value) {
    const { boundaries, colors } = zones;
    let i = 0;
    while(i < boundaries.length && boundaries[i] < value)i++;
    return colors[Math.max(0, Math.min(i - 1, colors.length - 1))];
}
function offsetOf(value, domainY) {
    const span = domainY[1] - domainY[0];
    if (span === 0) return 0.5;
    return clamp01((domainY[1] - value) / span);
}
function zoneGradientStops(zones, domainY, opacity) {
    const { boundaries, colors } = zones;
    const stops = [];
    const push = (offset, color)=>{
        stops.push(opacity === undefined ? {
            offset,
            color
        } : {
            offset,
            color,
            opacity
        });
    };
    push(0, zoneColorBelow(zones, domainY[1]));
    for(let j = boundaries.length - 1; j >= 0; j--){
        const o = offsetOf(boundaries[j], domainY);
        if (o <= 0 || o >= 1) continue;
        const above = colors[Math.min(j, colors.length - 1)];
        const below = colors[Math.max(j - 1, 0)];
        if (above === below) continue;
        push(o, above);
        push(o, below);
    }
    push(1, zoneColorAt(zones, domainY[0]));
    return stops;
}
function zoneBands(zones, domainY, plot, opts = {}) {
    const { boundaries, colors, labels } = zones;
    const opacity = opts.opacity ?? 0.08;
    const fontSize = opts.fontSize ?? 11;
    const out = [];
    for(let i = 0; i < colors.length; i++){
        const topOff = offsetOf(boundaries[i + 1], domainY);
        const bottomOff = offsetOf(boundaries[i], domainY);
        const y = plot.y + topOff * plot.height;
        const height = (bottomOff - topOff) * plot.height;
        if (height <= 0) continue;
        const band = {
            x: plot.x,
            y,
            width: plot.width,
            height,
            color: colors[i],
            opacity
        };
        const label = labels?.[i];
        if (label && height >= fontSize + 4) {
            band.label = {
                x: plot.x + 6,
                y: y + fontSize + 2,
                text: label,
                anchor: "start"
            };
        }
        out.push(band);
    }
    return out;
}
function normalizeData(data) {
    if (!data.length) return [];
    if (typeof data[0] === "number") {
        return data.map((y, x)=>({
                x,
                y
            }));
    }
    return data;
}
function finiteSamples(points) {
    let allFinite = true;
    for (const p of points){
        if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) {
            allFinite = false;
            break;
        }
    }
    if (allFinite) return {
        points,
        indices: null
    };
    const kept = [];
    const indices = [];
    for(let i = 0; i < points.length; i++){
        const p = points[i];
        if (Number.isFinite(p.x) && Number.isFinite(p.y)) {
            kept.push(p);
            indices.push(i);
        }
    }
    return {
        points: kept,
        indices
    };
}
function cssColor(name, fallback, useVars) {
    return useVars ? `var(--trend-chart-${name}, ${fallback})` : fallback;
}
const DEFAULTS = {
    lineColor: "#4a9eed",
    lineWidth: 2,
    fillOpacity: 0.15,
    yTickCount: 5,
    pointRadius: 3
};
function computeScene(data, options = {}, ctx) {
    const { points, indices: srcIndex } = finiteSamples(normalizeData(data));
    const idPrefix = ctx.idPrefix ?? "tc";
    const cssVars = ctx.cssVars ?? false;
    const xAxis = options.xAxis ?? true;
    const yAxis = options.yAxis ?? true;
    const grid = options.grid ?? true;
    const lineWidth = options.lineWidth ?? DEFAULTS.lineWidth;
    const lineColor = options.lineColor ?? DEFAULTS.lineColor;
    const fillOpacity = options.fillOpacity ?? DEFAULTS.fillOpacity;
    const yTickCount = options.yTickCount ?? DEFAULTS.yTickCount;
    const pointRadius = options.pointRadius ?? DEFAULTS.pointRadius;
    const edge = Math.ceil(lineWidth / 2) + 2;
    const padding = {
        top: options.padding?.top ?? (yAxis ? Math.max(edge, Math.ceil(11 / 2) + 2) : edge),
        right: options.padding?.right ?? edge,
        bottom: options.padding?.bottom ?? (xAxis ? 11 + 14 : edge),
        left: options.padding?.left ?? (yAxis ? 40 : edge)
    };
    const fullX = dataRangeX(points);
    const domainX = ctx.domainX ?? options.domainX ?? fullX;
    const { points: slice, startIndex } = visibleSlice(points, domainX);
    let domainY;
    let yNice = null;
    const domainYOpt = options.domainY ?? (options.zones ? "full" : "auto");
    if (Array.isArray(domainYOpt)) {
        domainY = domainYOpt;
    } else {
        const raw = dataRangeY(domainYOpt === "full" ? points : slice);
        if (yAxis || grid) {
            const [min, max, step] = niceDomain(raw, yTickCount);
            yNice = [
                min,
                max,
                step
            ];
            domainY = [
                Math.min(min, raw[0]),
                Math.max(max, raw[1])
            ];
        } else {
            const pad = (raw[1] - raw[0]) * 0.02 || Math.abs(raw[0]) * 0.02 || 0.5;
            domainY = [
                raw[0] - pad,
                raw[1] + pad
            ];
        }
    }
    const cfg = {
        width: ctx.width,
        height: ctx.height,
        padding,
        domainX,
        domainY
    };
    const plot = plotRect(cfg);
    const visible = slice.map((p, i)=>{
        const at = startIndex + i;
        return {
            px: scaleX(p.x, cfg),
            py: scaleY(p.y, cfg),
            x: p.x,
            y: p.y,
            index: srcIndex ? srcIndex[at] : at
        };
    });
    const px = visible.map((p)=>({
            x: p.px,
            y: p.py
        }));
    const smooth = options.smooth ?? false;
    const linePath = buildLinePath(px, smooth);
    const fill = options.fill ?? true;
    const baselineY = plot.y + plot.height;
    const areaPath = fill === false ? "" : buildAreaPath(px, baselineY, smooth);
    const gy = {
        y1: plot.y,
        y2: plot.y + plot.height
    };
    let strokeGradient = null;
    let fillGradient = null;
    if (options.zones) {
        strokeGradient = {
            id: `${idPrefix}-stroke`,
            ...gy,
            stops: zoneGradientStops(options.zones, domainY)
        };
        if (fill !== false) {
            fillGradient = {
                id: `${idPrefix}-fill`,
                ...gy,
                stops: zoneGradientStops(options.zones, domainY, fillOpacity)
            };
        }
    } else if (fill !== false) {
        const base = typeof fill === "string" ? fill : cssColor("fill", lineColor, cssVars);
        fillGradient = {
            id: `${idPrefix}-fill`,
            ...gy,
            stops: [
                {
                    offset: 0,
                    color: base,
                    opacity: fillOpacity
                },
                {
                    offset: 1,
                    color: base,
                    opacity: 0
                }
            ]
        };
    }
    const yTicks = yAxis || grid ? yNice && yNice[2] ? ticksForStep(yNice[0], yNice[1], yNice[2]) : niceTicks(domainY, yTickCount) : [];
    const inPlotY = yTicks.filter((v)=>v >= domainY[0] && v <= domainY[1]);
    const formatY = options.formatY ?? String;
    const formatX = options.formatX ?? String;
    const gridLines = grid ? inPlotY.map((v)=>{
        const y = scaleY(v, cfg);
        return {
            x1: plot.x,
            y1: y,
            x2: plot.x + plot.width,
            y2: y
        };
    }) : [];
    const yLabels = yAxis ? inPlotY.map((v)=>({
            x: plot.x - 8,
            y: scaleY(v, cfg) + 11 * 0.35,
            text: formatY(v),
            anchor: "end"
        })) : [];
    const xTickValues = options.xTicks !== undefined ? resolveXTicks(domainX, plot.width, options.xTicks) : sampleTicks(visible.map((p)=>p.x).filter((v)=>v >= domainX[0] && v <= domainX[1]), Math.min(8, Math.max(2, Math.floor(plot.width / 80))));
    const xLabels = xAxis ? xTickValues.map((v)=>{
        const x = scaleX(v, cfg);
        const anchor = x - plot.x < 30 ? "start" : plot.x + plot.width - x < 30 ? "end" : "middle";
        return {
            x,
            y: plot.y + plot.height + 11 + 8,
            text: formatX(v),
            anchor
        };
    }) : [];
    const bandsEnabled = options.zones && (options.zones.bands ?? true);
    const bands = bandsEnabled && options.zones ? zoneBands(options.zones, domainY, plot, {
        fontSize: 11
    }) : [];
    const pointsMode = options.points ?? "nearest";
    const markers = pointsMode === "all" ? visible : [];
    let endDot = null;
    if (options.endDot) {
        const cfgDot = typeof options.endDot === "object" ? options.endDot : {};
        const last = visible.length ? visible[visible.length - 1] : null;
        const lastIndex = points.length ? srcIndex ? srcIndex[srcIndex.length - 1] : points.length - 1 : -1;
        if (last && last.index === lastIndex) {
            endDot = {
                px: last.px,
                py: last.py,
                r: cfgDot.r ?? Math.max(4, lineWidth * 1.75),
                color: cfgDot.color ?? cssColor("line", lineColor, cssVars),
                ringColor: cfgDot.ringColor ?? cssColor("end-dot-ring", "#ffffff", cssVars)
            };
        }
    }
    return {
        width: ctx.width,
        height: ctx.height,
        plot,
        domainX,
        domainY,
        linePath,
        areaPath,
        lineColor: strokeGradient ? lineColor : cssColor("line", lineColor, cssVars),
        lineWidth,
        strokeGradient,
        fillGradient,
        bands,
        grid: gridLines,
        yLabels,
        xLabels,
        markers,
        visible,
        endDot,
        pointRadius,
        fontSize: 11,
        ariaLabel: options.ariaLabel,
        cssVars,
        idPrefix
    };
}
function attachGestures(el, hooks) {
    const pointers = new Map();
    let pinchDist = 0;
    const toLocalX = (ev)=>ev.clientX - el.getBoundingClientRect().left;
    const zoomAround = (centerX, factor)=>{
        const cfg = hooks.getScale();
        const [d0, d1] = cfg.domainX;
        const next = [
            centerX - (centerX - d0) * factor,
            centerX + (d1 - centerX) * factor
        ];
        hooks.setDomainX(clampDomainX(next, hooks.getFullRange(), hooks.getMinSpan()));
    };
    const onPointerDown = (ev)=>{
        if (ev.button !== 0 && ev.pointerType === "mouse") return;
        pointers.set(ev.pointerId, {
            x: ev.clientX,
            y: ev.clientY
        });
        el.setPointerCapture(ev.pointerId);
        if (pointers.size === 2) {
            const [a, b] = [
                ...pointers.values()
            ];
            pinchDist = Math.hypot(a.x - b.x, a.y - b.y);
        }
    };
    const onPointerMove = (ev)=>{
        const prev = pointers.get(ev.pointerId);
        if (!prev) return;
        const curr = {
            x: ev.clientX,
            y: ev.clientY
        };
        pointers.set(ev.pointerId, curr);
        if (pointers.size === 1 && hooks.pan) {
            const cfg = hooks.getScale();
            const plot = plotRect(cfg);
            if (!plot.width) return;
            const [d0, d1] = cfg.domainX;
            const shift = -(curr.x - prev.x) / plot.width * (d1 - d0);
            hooks.setDomainX(clampDomainX([
                d0 + shift,
                d1 + shift
            ], hooks.getFullRange(), hooks.getMinSpan()));
        } else if (pointers.size === 2 && hooks.zoom) {
            const [a, b] = [
                ...pointers.values()
            ];
            const dist = Math.hypot(a.x - b.x, a.y - b.y);
            if (pinchDist > 0 && dist > 0) {
                const cfg = hooks.getScale();
                const midX = (a.x + b.x) / 2 - el.getBoundingClientRect().left;
                zoomAround(invertX(midX, cfg), pinchDist / dist);
            }
            pinchDist = dist;
        }
    };
    const onPointerEnd = (ev)=>{
        pointers.delete(ev.pointerId);
        if (el.hasPointerCapture(ev.pointerId)) el.releasePointerCapture(ev.pointerId);
        pinchDist = 0;
    };
    const onWheel = (ev)=>{
        ev.preventDefault();
        const factor = ev.deltaY > 0 ? 1.15 : 1 / 1.15;
        zoomAround(invertX(toLocalX(ev), hooks.getScale()), factor);
    };
    el.style.touchAction = hooks.pan || hooks.zoom ? "none" : "";
    el.style.cursor = hooks.pan ? "grab" : "";
    el.style.userSelect = hooks.pan ? "none" : "";
    el.style.setProperty("-webkit-user-select", hooks.pan ? "none" : "");
    if (hooks.pan || hooks.zoom) {
        el.addEventListener("pointerdown", onPointerDown);
        el.addEventListener("pointermove", onPointerMove);
        el.addEventListener("pointerup", onPointerEnd);
        el.addEventListener("pointercancel", onPointerEnd);
    }
    if (hooks.zoom) el.addEventListener("wheel", onWheel, {
        passive: false
    });
    return ()=>{
        el.removeEventListener("pointerdown", onPointerDown);
        el.removeEventListener("pointermove", onPointerMove);
        el.removeEventListener("pointerup", onPointerEnd);
        el.removeEventListener("pointercancel", onPointerEnd);
        el.removeEventListener("wheel", onWheel);
    };
}
const SVG_NS = "http://www.w3.org/2000/svg";
const FONT_FAMILY = "ui-sans-serif, system-ui, sans-serif";
let instanceCounter = 0;
function createSvg(tag) {
    return document.createElementNS(SVG_NS, tag);
}
function syncChildren(parent, tag, count) {
    while(parent.children.length > count)parent.lastElementChild.remove();
    while(parent.children.length < count){
        parent.appendChild(document.createElementNS(SVG_NS, tag));
    }
    return [
        ...parent.children
    ];
}
function sceneScale(scene) {
    return {
        width: scene.width,
        height: scene.height,
        padding: {
            top: scene.plot.y,
            left: scene.plot.x,
            right: scene.width - scene.plot.x - scene.plot.width,
            bottom: scene.height - scene.plot.y - scene.plot.height
        },
        domainX: scene.domainX,
        domainY: scene.domainY
    };
}
class TrendChart {
    #container;
    #data;
    #options;
    #idPrefix;
    #domainX = null;
    #scene = null;
    #svg;
    #title;
    #defs;
    #clipRect;
    #fillGrad = null;
    #strokeGrad = null;
    #gBands;
    #gGrid;
    #gSeries;
    #areaEl;
    #lineEl;
    #gMarkers;
    #hoverDot;
    #endDotEl;
    #gXLabels;
    #gYLabels;
    #ro = null;
    #detachGestures = null;
    #hoverIndex = null;
    #downAt = null;
    #moved = false;
    constructor(container, data, options = {}){
        this.#container = container;
        this.#data = normalizeData(data);
        this.#options = {
            ...options
        };
        this.#idPrefix = `tc-${++instanceCounter}`;
        if (options.domainX) this.#domainX = [
            ...options.domainX
        ];
        const svg = this.#svg = createSvg("svg");
        svg.setAttribute("class", "trend-chart");
        svg.setAttribute("role", "img");
        svg.style.display = "block";
        this.#title = svg.appendChild(createSvg("title"));
        this.#defs = svg.appendChild(createSvg("defs"));
        const clip = this.#defs.appendChild(createSvg("clipPath"));
        clip.id = `${this.#idPrefix}-clip`;
        this.#clipRect = clip.appendChild(createSvg("rect"));
        this.#gBands = svg.appendChild(createSvg("g"));
        this.#gBands.setAttribute("class", "trend-chart-bands");
        this.#gGrid = svg.appendChild(createSvg("g"));
        this.#gGrid.setAttribute("class", "trend-chart-grid");
        this.#gGrid.setAttribute("shape-rendering", "crispEdges");
        this.#gSeries = svg.appendChild(createSvg("g"));
        this.#gSeries.setAttribute("clip-path", `url(#${this.#idPrefix}-clip)`);
        this.#areaEl = this.#gSeries.appendChild(createSvg("path"));
        this.#areaEl.setAttribute("class", "trend-chart-area");
        this.#lineEl = this.#gSeries.appendChild(createSvg("path"));
        this.#lineEl.setAttribute("class", "trend-chart-line");
        this.#gMarkers = this.#gSeries.appendChild(createSvg("g"));
        this.#gMarkers.setAttribute("class", "trend-chart-markers");
        this.#endDotEl = svg.appendChild(createSvg("circle"));
        this.#endDotEl.setAttribute("class", "trend-chart-end-dot");
        this.#hoverDot = svg.appendChild(createSvg("circle"));
        this.#hoverDot.setAttribute("class", "trend-chart-hover-dot");
        this.#hoverDot.style.display = "none";
        this.#hoverDot.style.pointerEvents = "none";
        this.#gXLabels = svg.appendChild(createSvg("g"));
        this.#gXLabels.setAttribute("class", "trend-chart-x-labels");
        this.#gYLabels = svg.appendChild(createSvg("g"));
        this.#gYLabels.setAttribute("class", "trend-chart-y-labels");
        container.appendChild(svg);
        this.#detachGestures = attachGestures(svg, {
            pan: this.#options.pan ?? true,
            zoom: this.#options.zoom ?? true,
            getScale: ()=>sceneScale(this.#scene),
            getFullRange: ()=>dataRangeX(this.#data),
            getMinSpan: ()=>this.#minSpan(),
            setDomainX: (d)=>this.#applyDomain(d)
        });
        this.#wirePointerInteraction();
        if (this.#options.width === undefined || this.#options.height === undefined) {
            this.#ro = new ResizeObserver(()=>this.#render());
            this.#ro.observe(container);
        }
        this.#render();
    }
    update(data) {
        this.#data = normalizeData(data);
        if (this.#domainX) {
            this.#domainX = clampDomainX(this.#domainX, dataRangeX(this.#data), this.#minSpan());
        }
        this.#render();
    }
    setOptions(options) {
        this.#options = {
            ...this.#options,
            ...options
        };
        if (options.pan !== undefined || options.zoom !== undefined) {
            this.#detachGestures?.();
            this.#detachGestures = attachGestures(this.#svg, {
                pan: this.#options.pan ?? true,
                zoom: this.#options.zoom ?? true,
                getScale: ()=>sceneScale(this.#scene),
                getFullRange: ()=>dataRangeX(this.#data),
                getMinSpan: ()=>this.#minSpan(),
                setDomainX: (d)=>this.#applyDomain(d)
            });
        }
        this.#render();
    }
    setDomainX(domainX) {
        this.#applyDomain(clampDomainX(domainX, dataRangeX(this.#data), this.#minSpan()));
    }
    getDomainX() {
        return this.#scene ? [
            ...this.#scene.domainX
        ] : dataRangeX(this.#data);
    }
    resetDomain() {
        this.#domainX = null;
        this.#render();
        this.#options.onDomainChange?.(this.getDomainX());
    }
    destroy() {
        this.#ro?.disconnect();
        this.#detachGestures?.();
        this.#svg.remove();
    }
    #minSpan() {
        if (this.#options.minDomainSpan) return this.#options.minDomainSpan;
        const [x0, x1] = dataRangeX(this.#data);
        return this.#data.length > 1 ? (x1 - x0) / (this.#data.length - 1) * 3 : 0;
    }
    #applyDomain(domain) {
        this.#domainX = domain;
        this.#render();
        this.#options.onDomainChange?.(domain);
    }
    #size() {
        return {
            width: this.#options.width ?? this.#container.clientWidth ?? 300,
            height: this.#options.height ?? this.#container.clientHeight ?? 150
        };
    }
    #render() {
        const { width, height } = this.#size();
        if (!width || !height) return;
        const o = this.#options;
        const scene = this.#scene = computeScene(this.#data, o, {
            width,
            height,
            domainX: this.#domainX ?? undefined,
            idPrefix: this.#idPrefix,
            cssVars: o.cssVars ?? true
        });
        const svg = this.#svg;
        svg.setAttribute("width", String(width));
        svg.setAttribute("height", String(height));
        svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
        svg.setAttribute("class", `trend-chart${o.class ? ` ${o.class}` : ""}`);
        if (scene.ariaLabel) svg.setAttribute("aria-label", scene.ariaLabel);
        else svg.removeAttribute("aria-label");
        this.#title.textContent = scene.ariaLabel ?? "";
        const plot = scene.plot;
        this.#clipRect.setAttribute("x", String(plot.x));
        this.#clipRect.setAttribute("y", String(plot.y));
        this.#clipRect.setAttribute("width", String(plot.width));
        this.#clipRect.setAttribute("height", String(plot.height));
        this.#fillGrad = this.#syncGradient(this.#fillGrad, scene.fillGradient);
        this.#strokeGrad = this.#syncGradient(this.#strokeGrad, scene.strokeGradient);
        const bandGroups = syncChildren(this.#gBands, "g", scene.bands.length);
        scene.bands.forEach((b, i)=>{
            const g = bandGroups[i];
            const rect = g.firstElementChild ?? g.appendChild(createSvg("rect"));
            rect.setAttribute("x", String(b.x));
            rect.setAttribute("y", String(b.y));
            rect.setAttribute("width", String(b.width));
            rect.setAttribute("height", String(b.height));
            rect.style.fill = b.color;
            rect.style.opacity = String(b.opacity);
            let text = rect.nextElementSibling;
            if (b.label) {
                text ??= g.appendChild(createSvg("text"));
                this.#patchText(text, b.label, b.color);
                text.style.opacity = "0.8";
            } else {
                text?.remove();
            }
        });
        const gridColor = cssColor("grid", "#e5e7eb", scene.cssVars);
        const gridLines = syncChildren(this.#gGrid, "line", scene.grid.length);
        scene.grid.forEach((l, i)=>{
            const el = gridLines[i];
            el.setAttribute("x1", String(l.x1));
            el.setAttribute("y1", String(l.y1));
            el.setAttribute("x2", String(l.x2));
            el.setAttribute("y2", String(l.y2));
            el.style.stroke = gridColor;
            el.style.strokeWidth = "1";
        });
        this.#areaEl.setAttribute("d", scene.areaPath);
        this.#areaEl.style.fill = scene.fillGradient ? `url(#${scene.fillGradient.id})` : "none";
        this.#lineEl.setAttribute("d", scene.linePath);
        this.#lineEl.style.fill = "none";
        this.#lineEl.style.stroke = scene.strokeGradient ? `url(#${scene.strokeGradient.id})` : scene.lineColor;
        this.#lineEl.style.strokeWidth = `${scene.lineWidth}px`;
        this.#lineEl.style.strokeLinejoin = "round";
        this.#lineEl.style.strokeLinecap = "round";
        const markers = syncChildren(this.#gMarkers, "circle", scene.markers.length);
        scene.markers.forEach((m, i)=>{
            const el = markers[i];
            el.setAttribute("cx", String(m.px));
            el.setAttribute("cy", String(m.py));
            el.setAttribute("r", String(scene.pointRadius));
            el.style.fill = scene.lineColor;
        });
        if (scene.endDot) {
            const d = scene.endDot;
            this.#endDotEl.style.display = "";
            this.#endDotEl.setAttribute("cx", String(d.px));
            this.#endDotEl.setAttribute("cy", String(d.py));
            this.#endDotEl.setAttribute("r", String(d.r));
            this.#endDotEl.style.fill = d.color;
            this.#endDotEl.style.stroke = d.ringColor;
            this.#endDotEl.style.strokeWidth = "2";
        } else {
            this.#endDotEl.style.display = "none";
        }
        const labelColor = cssColor("label", "#9ca3af", scene.cssVars);
        const xEls = syncChildren(this.#gXLabels, "text", scene.xLabels.length);
        scene.xLabels.forEach((t, i)=>this.#patchText(xEls[i], t, labelColor));
        const yEls = syncChildren(this.#gYLabels, "text", scene.yLabels.length);
        scene.yLabels.forEach((t, i)=>this.#patchText(yEls[i], t, labelColor));
    }
    #patchText(el, t, color) {
        el.setAttribute("x", String(t.x));
        el.setAttribute("y", String(t.y));
        el.setAttribute("text-anchor", t.anchor);
        el.textContent = t.text;
        el.style.fill = color;
        el.style.fontFamily = `var(--trend-chart-font, ${FONT_FAMILY})`;
        el.style.fontSize = `${this.#scene?.fontSize ?? 11}px`;
    }
    #syncGradient(el, g) {
        if (!g) {
            el?.remove();
            return null;
        }
        if (!el) {
            el = this.#defs.appendChild(createSvg("linearGradient"));
            el.setAttribute("gradientUnits", "userSpaceOnUse");
            el.setAttribute("x1", "0");
            el.setAttribute("x2", "0");
        }
        el.id = g.id;
        el.setAttribute("y1", String(g.y1));
        el.setAttribute("y2", String(g.y2));
        const stops = syncChildren(el, "stop", g.stops.length);
        g.stops.forEach((s, i)=>{
            const stop = stops[i];
            stop.setAttribute("offset", String(s.offset));
            stop.style.stopColor = s.color;
            stop.style.stopOpacity = s.opacity === undefined ? "1" : String(s.opacity);
        });
        return el;
    }
    #wirePointerInteraction() {
        const svg = this.#svg;
        svg.addEventListener("pointerdown", (ev)=>{
            this.#downAt = {
                x: ev.clientX,
                y: ev.clientY
            };
            this.#moved = false;
        });
        svg.addEventListener("pointermove", (ev)=>{
            if (this.#downAt) {
                const dist = Math.hypot(ev.clientX - this.#downAt.x, ev.clientY - this.#downAt.y);
                if (dist > 4) this.#moved = true;
            }
            if (this.#pointsMode() === "none" || this.#downAt) return;
            this.#setHover(this.#nearest(ev));
        });
        svg.addEventListener("pointerup", (ev)=>{
            const wasClick = this.#downAt && !this.#moved;
            this.#downAt = null;
            if (wasClick && this.#pointsMode() !== "none") {
                const hit = this.#nearest(ev);
                if (hit) this.#options.onPointClick?.(hit);
            }
        });
        svg.addEventListener("pointerleave", ()=>{
            this.#downAt = null;
            this.#setHover(null);
        });
    }
    #pointsMode() {
        return this.#options.points ?? "nearest";
    }
    #nearest(ev) {
        const scene = this.#scene;
        if (!scene || !scene.visible.length) return null;
        const rect = this.#svg.getBoundingClientRect();
        const px = ev.clientX - rect.left;
        let best = scene.visible[0];
        for (const p of scene.visible){
            if (Math.abs(p.px - px) < Math.abs(best.px - px)) best = p;
        }
        if (Math.abs(best.px - px) > 30) return null;
        return {
            point: {
                x: best.x,
                y: best.y
            },
            index: best.index,
            pixel: {
                x: best.px,
                y: best.py
            }
        };
    }
    #setHover(hit) {
        if ((hit?.index ?? null) === this.#hoverIndex) {
            return;
        }
        this.#hoverIndex = hit?.index ?? null;
        const scene = this.#scene;
        if (hit && scene) {
            this.#hoverDot.style.display = "";
            this.#hoverDot.setAttribute("cx", String(hit.pixel.x));
            this.#hoverDot.setAttribute("cy", String(hit.pixel.y));
            this.#hoverDot.setAttribute("r", String(scene.pointRadius + 1.5));
            this.#hoverDot.style.fill = scene.lineColor;
            this.#hoverDot.style.stroke = cssColor("end-dot-ring", "#ffffff", scene.cssVars);
            this.#hoverDot.style.strokeWidth = "2";
        } else {
            this.#hoverDot.style.display = "none";
        }
        this.#options.onPointHover?.(hit);
    }
}
function esc(s) {
    return s.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
}
function color(c) {
    return esc(c);
}
function n1(v) {
    return Math.round(v * 100) / 100;
}
const FONT_FAMILY1 = "ui-sans-serif, system-ui, sans-serif";
function textStyle(scene) {
    const fill = color(cssColor("label", "#9ca3af", scene.cssVars));
    return `fill:${fill};font-family:${FONT_FAMILY1};font-size:${scene.fontSize}px`;
}
function gradientMarkup(g) {
    const stops = g.stops.map((s)=>{
        const op = s.opacity === undefined ? "" : `;stop-opacity:${s.opacity}`;
        return `<stop offset="${n1(s.offset)}" style="stop-color:${color(s.color)}${op}"/>`;
    }).join("");
    return `<linearGradient id="${g.id}" gradientUnits="userSpaceOnUse" ` + `x1="0" y1="${n1(g.y1)}" x2="0" y2="${n1(g.y2)}">${stops}</linearGradient>`;
}
function textMarkup(t, style) {
    return `<text x="${n1(t.x)}" y="${n1(t.y)}" text-anchor="${t.anchor}" ` + `style="${style}">${esc(t.text)}</text>`;
}
function sceneToString(scene) {
    const out = [];
    const clipId = `${scene.idPrefix}-clip`;
    const labelStyle = textStyle(scene);
    out.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${scene.width}" ` + `height="${scene.height}" viewBox="0 0 ${scene.width} ${scene.height}" ` + `class="trend-chart" role="img"` + (scene.ariaLabel ? ` aria-label="${esc(scene.ariaLabel)}"` : "") + `>`);
    if (scene.ariaLabel) out.push(`<title>${esc(scene.ariaLabel)}</title>`);
    out.push(`<defs><clipPath id="${clipId}"><rect x="${n1(scene.plot.x)}" ` + `y="${n1(scene.plot.y)}" width="${n1(scene.plot.width)}" ` + `height="${n1(scene.plot.height)}"/></clipPath>`);
    if (scene.fillGradient) out.push(gradientMarkup(scene.fillGradient));
    if (scene.strokeGradient) out.push(gradientMarkup(scene.strokeGradient));
    out.push(`</defs>`);
    if (scene.bands.length) {
        out.push(`<g class="trend-chart-bands">`);
        for (const b of scene.bands){
            out.push(`<rect x="${n1(b.x)}" y="${n1(b.y)}" width="${n1(b.width)}" ` + `height="${n1(b.height)}" style="fill:${color(b.color)};opacity:${b.opacity}"/>`);
            if (b.label) {
                out.push(textMarkup(b.label, `fill:${color(b.color)};opacity:0.8;` + `font-family:${FONT_FAMILY1};font-size:${scene.fontSize}px`));
            }
        }
        out.push(`</g>`);
    }
    if (scene.grid.length) {
        const stroke = color(cssColor("grid", "#e5e7eb", scene.cssVars));
        out.push(`<g class="trend-chart-grid" shape-rendering="crispEdges">`);
        for (const l of scene.grid){
            out.push(`<line x1="${n1(l.x1)}" y1="${n1(l.y1)}" x2="${n1(l.x2)}" ` + `y2="${n1(l.y2)}" style="stroke:${stroke};stroke-width:1"/>`);
        }
        out.push(`</g>`);
    }
    out.push(`<g clip-path="url(#${clipId})">`);
    if (scene.areaPath && scene.fillGradient) {
        out.push(`<path class="trend-chart-area" d="${scene.areaPath}" ` + `style="fill:url(#${scene.fillGradient.id})"/>`);
    }
    if (scene.linePath) {
        const stroke = scene.strokeGradient ? `url(#${scene.strokeGradient.id})` : color(scene.lineColor);
        out.push(`<path class="trend-chart-line" d="${scene.linePath}" ` + `style="fill:none;stroke:${stroke};stroke-width:${scene.lineWidth}px;` + `stroke-linejoin:round;stroke-linecap:round"/>`);
    }
    for (const m of scene.markers){
        out.push(`<circle class="trend-chart-marker" cx="${n1(m.px)}" cy="${n1(m.py)}" ` + `r="${scene.pointRadius}" style="fill:${color(scene.lineColor)}"/>`);
    }
    out.push(`</g>`);
    if (scene.endDot) {
        const d = scene.endDot;
        out.push(`<circle class="trend-chart-end-dot" cx="${n1(d.px)}" cy="${n1(d.py)}" ` + `r="${d.r}" style="fill:${color(d.color)};stroke:${color(d.ringColor)};stroke-width:2"/>`);
    }
    if (scene.xLabels.length) {
        out.push(`<g class="trend-chart-x-labels">`);
        for (const t of scene.xLabels)out.push(textMarkup(t, labelStyle));
        out.push(`</g>`);
    }
    if (scene.yLabels.length) {
        out.push(`<g class="trend-chart-y-labels">`);
        for (const t of scene.yLabels)out.push(textMarkup(t, labelStyle));
        out.push(`</g>`);
    }
    out.push(`</svg>`);
    return out.join("");
}
let ssrCounter = 0;
function renderToString(data, options) {
    if (!options?.width || !options?.height) {
        throw new Error("[trend-chart] renderToString requires explicit width and height");
    }
    const scene = computeScene(data, options, {
        width: options.width,
        height: options.height,
        domainX: options.domainX,
        idPrefix: `tcs-${++ssrCounter}`,
        cssVars: options.cssVars ?? false
    });
    return sceneToString(scene);
}
const Scheduler = (()=>{
    const queues = {
        microtask: {
            map: new Map(),
            scheduled: false,
            arm: (cb)=>queueMicrotask(cb)
        },
        raf: {
            map: new Map(),
            scheduled: false,
            arm: (cb)=>requestAnimationFrame(cb)
        }
    };
    let flushing = false;
    let chainDepth = 0;
    function flush(kind) {
        const q = queues[kind];
        const entries = q.map;
        q.map = new Map();
        q.scheduled = false;
        flushing = true;
        try {
            entries.forEach((read, fn)=>fn(read()));
        } finally{
            flushing = false;
        }
    }
    function enqueue(fn, kind, read) {
        const q = queues[kind] ?? queues.microtask;
        const arming = !q.scheduled;
        if (arming) {
            if (flushing) {
                if (++chainDepth > 1000) {
                    chainDepth = 0;
                    throw new Error(`vanilla: maximum update depth exceeded (${1000}) — ` + `likely a feedback loop where an effect's set() retriggers ` + `itself (a writes b, b writes a, …). Check your reactTo/computed ` + `wiring, or make the loop converge so the equality guard can ` + `stop it.`);
                }
            } else {
                chainDepth = 0;
            }
        }
        q.map.set(fn, read);
        if (arming) {
            q.scheduled = true;
            q.arm(()=>flush(kind));
        }
    }
    return {
        enqueue
    };
})();
let computing = 0;
function observable(value) {
    const subs = new Map();
    function notify() {
        subs.forEach((kind, fn)=>Scheduler.enqueue(fn, kind, ()=>value));
    }
    const self = {
        get: ()=>value,
        set (v) {
            if (computing > 0) {
                throw new Error("vanilla: cannot set() an observable from inside a computed's " + "calc — calc must be a pure derivation of its sources (no writes " + "/ side effects). Move the write into a reactTo(...) effect.");
            }
            if (v === value) return;
            value = v;
            notify();
        },
        update (fn) {
            self.set(fn(value));
        },
        subscribe (fn, { immediate = true, scheduler = "microtask" } = {}) {
            subs.set(fn, scheduler);
            if (immediate) fn(value);
            return ()=>{
                subs.delete(fn);
            };
        }
    };
    return self;
}
function reactTo(sources, fn, { immediate = true, scheduler = "microtask" } = {}) {
    const unsubs = sources.map((o)=>o.subscribe(fn, {
            immediate: false,
            scheduler
        }));
    if (immediate) fn();
    return ()=>unsubs.forEach((u)=>u());
}
function fromTemplate(id) {
    const tpl = document.getElementById(id);
    if (!tpl) throw new Error(`Template not found: #${id}`);
    const first = tpl.content.firstElementChild;
    if (!first) throw new Error(`Template #${id} has no element content`);
    return first.cloneNode(true);
}
function refs(root) {
    const map = {};
    const self = root;
    if (self.matches?.("[data-ref]")) map[self.dataset.ref] = self;
    root.querySelectorAll("[data-ref]").forEach((el)=>{
        map[el.dataset.ref] = el;
    });
    return map;
}
const BIND_ALIAS = {
    text: "textContent",
    html: "innerHTML",
    class: "className"
};
function applyBindings(root, data) {
    const targets = [
        ...root.matches?.("[data-bind]") ? [
            root
        ] : [],
        ...root.querySelectorAll("[data-bind]")
    ];
    targets.forEach((el)=>{
        el.dataset.bind.split(";").forEach((rule)=>{
            const [kind, field] = rule.split(":").map((s)=>s.trim());
            if (!kind) return;
            const prop = BIND_ALIAS[kind] ?? kind;
            el[prop] = data[field];
        });
    });
}
function tracker() {
    const cleanups = [];
    return {
        track: (unsub)=>{
            cleanups.push(unsub);
            return unsub;
        },
        dispose: ()=>{
            cleanups.forEach((fn)=>fn());
            cleanups.length = 0;
        }
    };
}
function enhance(target, mountFn) {
    const el = typeof target === "string" ? document.querySelector(target) : target;
    if (!el) throw new Error(`enhance: no element matches ${JSON.stringify(target)}`);
    const { track, dispose } = tracker();
    const api = mountFn(el, track) ?? {};
    return {
        ...api,
        el,
        destroy () {
            dispose();
        }
    };
}
function delegate(root, handlers) {
    const seen = new Set();
    const collect = (scope)=>scope.querySelectorAll("[data-on]").forEach((el)=>el.dataset.on.split(";").forEach((r)=>seen.add(r.split(":")[0].trim())));
    collect(root);
    document.querySelectorAll("template").forEach((t)=>collect(t.content));
    const unsubs = [];
    seen.forEach((evt)=>{
        const listener = (e)=>{
            const el = e.target?.closest("[data-on]");
            if (!el || !root.contains(el)) return;
            el.dataset.on.split(";").forEach((rule)=>{
                const [type, action] = rule.split(":").map((s)=>s.trim());
                if (type === evt && handlers[action]) handlers[action](e, el);
            });
        };
        root.addEventListener(evt, listener);
        unsubs.push(()=>root.removeEventListener(evt, listener));
    });
    return ()=>unsubs.forEach((u)=>u());
}
new Map();
new Map();
export { renderToString as renderToString, TrendChart as TrendChart };
export { applyBindings as applyBindings, delegate as delegate, enhance as enhance, fromTemplate as fromTemplate, observable as observable, reactTo as reactTo, refs as refs };
