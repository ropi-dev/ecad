export interface RulerTick {
	position: number;
	value: number;
	label?: string;
}

export interface GridTick {
	value: number;
	position: number;
	opacity: number;
	majorOpacity: number;
}

const subdivisions = 10;
const minimumMinorPixels = 10;

/** Shared by the visible grid, ruler ticks, and editor snapping. */
export function rulerSpacing(scale: number) {
	const desired = minimumMinorPixels / scale;
	const decade = 10 ** Math.ceil(Math.log10(desired));
	const minor = decade / 5 >= desired ? decade / 5 : decade;
	return { major: minor * subdivisions, minor };
}

/** Screen positions for millimetre coordinates, labelled every ten grid cells. */
export function rulerTicks(
	center: number,
	scale: number,
	length: number,
	reversed = false,
): RulerTick[] {
	return ticksForSpacing(center, scale, length, reversed, rulerSpacing(scale));
}

function ticksForSpacing(
	center: number,
	scale: number,
	length: number,
	reversed: boolean,
	{ minor }: ReturnType<typeof rulerSpacing>,
): RulerTick[] {
	if (
		![center, scale, length].every(Number.isFinite) ||
		scale <= 0 ||
		length <= 0
	)
		return [];
	const first = Math.ceil((center - length / (2 * scale)) / minor);
	const last = Math.floor((center + length / (2 * scale)) / minor);
	const ticks: RulerTick[] = [];
	for (let index = first; index <= last; index++) {
		const value = index === 0 ? 0 : index * minor;
		const position =
			length / 2 + (value - center) * scale * (reversed ? -1 : 1);
		ticks.push({
			position,
			value,
			label:
				index % subdivisions === 0
					? String(Number(value.toPrecision(12)))
					: undefined,
		});
	}
	return ticks;
}

/** Crossfade over a 25% zoom band centered on the ruler and snapping cutoff. */
export function gridTicks(
	center: number,
	scale: number,
	length: number,
	reversed = false,
): GridTick[] {
	const layers = gridLayers(scale);
	const ticks = new Map<string, GridTick>();
	for (const { spacing, opacity } of layers) {
		if (opacity === 0) continue;
		for (const tick of ticksForSpacing(
			center,
			scale,
			length,
			reversed,
			spacing,
		)) {
			// Merge coincident lines so shared grid points never dim or draw twice.
			const key = tick.value.toPrecision(14);
			const existing = ticks.get(key);
			const majorOpacity = tick.label === undefined ? 0 : opacity;
			if (existing) {
				existing.opacity += opacity;
				existing.majorOpacity += majorOpacity;
			} else {
				ticks.set(key, {
					value: tick.value,
					position: tick.position,
					opacity,
					majorOpacity,
				});
			}
		}
	}
	return [...ticks.values()].sort(
		(first, second) => first.value - second.value,
	);
}

export function gridLayers(scale: number) {
	if (!Number.isFinite(scale) || scale <= 0) return [];
	const halfBand = 0.125;
	const coarse = rulerSpacing(scale / (1 + halfBand));
	const fine = rulerSpacing(scale / (1 - halfBand));
	const cutoff = minimumMinorPixels / fine.minor;
	const progress = Math.max(
		0,
		Math.min(1, (scale / cutoff - (1 - halfBand)) / (halfBand * 2)),
	);
	const blend = progress * progress * (3 - 2 * progress);
	return coarse.minor === fine.minor
		? [{ spacing: fine, opacity: 1 }]
		: [
				{ spacing: coarse, opacity: 1 - blend },
				{ spacing: fine, opacity: blend },
			];
}
