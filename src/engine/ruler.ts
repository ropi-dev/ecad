export interface RulerTick {
	position: number;
	value: number;
	label?: string;
}

const subdivisions = 10;

/** Shared by the visible grid, ruler ticks, and editor snapping. */
export function rulerSpacing(scale: number) {
	const desired = 80 / scale;
	const magnitude = 10 ** Math.floor(Math.log10(desired));
	const major =
		([1, 2, 5, 10].find((n) => n * magnitude >= desired) ?? 10) * magnitude;
	return { major, minor: major / subdivisions };
}

/** Screen positions for millimetre coordinates, with labels at least 80px apart. */
export function rulerTicks(
	center: number,
	scale: number,
	length: number,
	reversed = false,
): RulerTick[] {
	if (
		![center, scale, length].every(Number.isFinite) ||
		scale <= 0 ||
		length <= 0
	)
		return [];
	const { major, minor } = rulerSpacing(scale);
	const precision = Math.max(0, -Math.floor(Math.log10(major)));
	const first = Math.ceil((center - length / (2 * scale)) / minor);
	const last = Math.floor((center + length / (2 * scale)) / minor);
	const ticks: RulerTick[] = [];
	for (let index = first; index <= last; index++) {
		const value = index === 0 ? 0 : index * minor;
		const position =
			length / 2 + (value - center) * scale * (reversed ? -1 : 1);
		if (position < 24) continue;
		ticks.push({
			position,
			value,
			label: index % subdivisions === 0 ? value.toFixed(precision) : undefined,
		});
	}
	return ticks;
}
