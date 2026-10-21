import { catalog } from "./catalog.ts";
import { legacySymbols } from "./legacy.ts";
import type { DefaultSymbol, SourceSymbol, SymbolPrimitive } from "./types.ts";

export type {
	DefaultSymbol,
	DefaultSymbolFile,
	SymbolCategory,
	SymbolPrimitive,
} from "./types.ts";
export { symbolCategories } from "./types.ts";

// Fifty mils become one editor grid step. Do not fit each symbol independently,
// since that would move multi-terminal devices off the connection grid.
const MIL_TO_GRID = 1 / 50;
const round = (value: number) => Math.round(value * 1e9) / 1e9 || 0;

function generate(source: SourceSymbol): DefaultSymbol {
	const radians = (source.rotation * Math.PI) / 180;
	const point = (x: number, y: number) => ({
		x: round((x * Math.cos(radians) - y * Math.sin(radians)) * MIL_TO_GRID),
		y: round((x * Math.sin(radians) + y * Math.cos(radians)) * MIL_TO_GRID),
	});
	const shapes: SymbolPrimitive[] = [];
	const line = (x1: number, y1: number, x2: number, y2: number) => {
		const a = point(x1, y1);
		const b = point(x2, y2);
		// Source polylines sometimes repeat a vertex. They are not valid file lines.
		if (Math.hypot(b.x - a.x, b.y - a.y) >= 0.01)
			shapes.push({ kind: "line", x1: a.x, y1: a.y, x2: b.x, y2: b.y });
	};
	for (const shape of source.drawing) {
		switch (shape[0]) {
			case "polyline": {
				const [, ...points] = shape;
				for (let i = 0; i < points.length - 1; i++) {
					const a = points[i];
					const b = points[i + 1];
					line(...a, ...b);
				}
				break;
			}
			case "rectangle": {
				const [, x1, y1, x2, y2] = shape;
				shapes.push({
					kind: "rectangle",
					...point((x1 + x2) / 2, (y1 + y2) / 2),
					width: Math.abs(x2 - x1) * MIL_TO_GRID,
					height: Math.abs(y2 - y1) * MIL_TO_GRID,
					rotation: source.rotation,
				});
				break;
			}
			case "circle":
				shapes.push({
					kind: "circle",
					...point(shape[1], shape[2]),
					radius: shape[3] * MIL_TO_GRID,
				});
				break;
			case "arc": {
				const [, x, y, radius, start, sweep] = shape;
				const steps = Math.max(1, Math.ceil(Math.abs(sweep) / 15));
				for (let i = 0; i < steps; i++) {
					const a = ((start + (sweep * i) / steps) * Math.PI) / 180;
					const b = ((start + (sweep * (i + 1)) / steps) * Math.PI) / 180;
					line(
						x + radius * Math.cos(a),
						y + radius * Math.sin(a),
						x + radius * Math.cos(b),
						y + radius * Math.sin(b),
					);
				}
				break;
			}
			case "pin": {
				const [, name, x, y, length, direction] = shape;
				const dx = direction === "R" ? length : direction === "L" ? -length : 0;
				const dy = direction === "U" ? length : direction === "D" ? -length : 0;
				line(x, y, x + dx, y + dy);
				shapes.push({ kind: "pin", name, ...point(x, y) });
				break;
			}
		}
	}
	// Keep labels clear of the geometry, including tall connectors and power pins.
	const ys = shapes.flatMap((shape) => {
		if ("x1" in shape) return [shape.y1, shape.y2];
		const halfHeight =
			shape.kind === "circle"
				? shape.radius
				: shape.kind === "rectangle"
					? (source.rotation % 180 === 0 ? shape.height : shape.width) / 2
					: 0;
		return [shape.y - halfHeight, shape.y + halfHeight];
	});
	return {
		category: source.category,
		file: {
			format: "ecad-symbol",
			version: 1,
			units: "mm",
			id: source.id,
			name: source.name,
			description: source.description,
			prefix: source.prefix,
			value: source.value,
			shapes,
		},
		texts: [
			{ attribute: "reference", x: 0, y: Math.max(...ys) + 1.5, fontSize: 1.3 },
			{ attribute: "value", x: 0, y: Math.min(...ys) - 1.5, fontSize: 1.3 },
		],
	};
}

/** Generate fresh, deterministic definitions. Existing instances may safely edit their copies. */
export function generateDefaultSymbols(): DefaultSymbol[] {
	return [...legacySymbols(), ...catalog.map(generate)];
}
