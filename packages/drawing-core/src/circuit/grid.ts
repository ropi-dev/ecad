export const CIRCUIT_GRID_SPACING = 20;

export function circuitGridStep(scale: number) {
	return (
		CIRCUIT_GRID_SPACING *
		2 ** Math.max(0, Math.ceil(Math.log2(12 / (CIRCUIT_GRID_SPACING * scale))))
	);
}

export function snapCircuitPoint<T extends { x: number; y: number }>(
	point: T,
	step = CIRCUIT_GRID_SPACING,
): T {
	return {
		...point,
		x: Math.round(point.x / step) * step,
		y: Math.round(point.y / step) * step,
	};
}
