import type { GradientStop, SceneBand, ZoneConfig } from "./types.ts";

/** Clamp to `[0, 1]`. */
function clamp01(v: number): number {
	return Math.max(0, Math.min(1, v));
}

/** Color of the zone containing `value` (values outside the boundaries clamp
 * to the first/last zone). */
export function zoneColorAt(zones: ZoneConfig, value: number): string {
	const { boundaries, colors } = zones;
	let i = 0;
	while (i < boundaries.length && boundaries[i] <= value) i++;
	// i = count of boundaries <= value; zone index is i - 1
	return colors[Math.max(0, Math.min(i - 1, colors.length - 1))];
}

/** Fractional offset of `value` measured from the top of the plot
 * (`domainY[1]` → 0, `domainY[0]` → 1), clamped to `[0, 1]`. */
function offsetOf(value: number, domainY: [number, number]): number {
	const span = domainY[1] - domainY[0];
	if (span === 0) return 0.5;
	return clamp01((domainY[1] - value) / span);
}

/** Gradient stops implementing hard-cutoff zone coloring: two stops at the
 * same offset per zone boundary inside the domain, so transitions are instant
 * rather than blended. Offsets run top (0, high values) → bottom (1). */
export function zoneGradientStops(
	zones: ZoneConfig,
	domainY: [number, number],
	opacity?: number,
): GradientStop[] {
	const { boundaries, colors } = zones;
	const stops: GradientStop[] = [];
	const push = (offset: number, color: string) => {
		stops.push(
			opacity === undefined ? { offset, color } : { offset, color, opacity },
		);
	};
	push(0, zoneColorAt(zones, domainY[1]));
	// walk boundaries from high value (top) to low so offsets stay ascending;
	// boundary j separates zone j (above) from zone j - 1 (below)
	for (let j = boundaries.length - 1; j >= 0; j--) {
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

/** Background band rects (one per zone slice visible in the domain), in pixel
 * space. Purely decorative context behind the plot. */
export function zoneBands(
	zones: ZoneConfig,
	domainY: [number, number],
	plot: { x: number; y: number; width: number; height: number },
	opts: { opacity?: number; fontSize?: number } = {},
): SceneBand[] {
	const { boundaries, colors, labels } = zones;
	const opacity = opts.opacity ?? 0.08;
	const fontSize = opts.fontSize ?? 11;
	const out: SceneBand[] = [];
	for (let i = 0; i < colors.length; i++) {
		const topOff = offsetOf(boundaries[i + 1], domainY);
		const bottomOff = offsetOf(boundaries[i], domainY);
		const y = plot.y + topOff * plot.height;
		const height = (bottomOff - topOff) * plot.height;
		if (height <= 0) continue;
		const band: SceneBand = {
			x: plot.x,
			y,
			width: plot.width,
			height,
			color: colors[i],
			opacity,
		};
		const label = labels?.[i];
		if (label && height >= fontSize + 4) {
			band.label = {
				x: plot.x + 6,
				y: y + fontSize + 2,
				text: label,
				anchor: "start",
			};
		}
		out.push(band);
	}
	return out;
}
