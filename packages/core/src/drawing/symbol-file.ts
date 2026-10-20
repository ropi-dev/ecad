import type {
	SymbolFile,
	SymbolLibrary,
} from "#/components/editor/symbolFormat.ts";
import {
	type EditorShape,
	PIN_RADIUS,
	type PrimitiveShape,
} from "#/drawing/shapes.ts";
import type { SymbolDefinition } from "#/drawing/symbols.ts";

export function libraryDefinitions(library: SymbolLibrary): SymbolDefinition[] {
	return library.map(
		({
			shapes,
			format: _format,
			version: _version,
			units: _units,
			...definition
		}) => ({
			...definition,
			texts: [],
			children: shapes.map((shape, index): PrimitiveShape => {
				const base = {
					id: index + 1,
					lineWidth: shape.lineWidth ?? 0.254,
					rotation: 0,
				};
				if ("x1" in shape) {
					const dx = shape.x2 - shape.x1;
					const dy = shape.y2 - shape.y1;
					return {
						...base,
						kind: shape.kind,
						x: (shape.x1 + shape.x2) / 2,
						y: (shape.y1 + shape.y2) / 2,
						width: Math.hypot(dx, dy),
						height: 0.254,
						rotation: Math.atan2(dy, dx),
					};
				}
				if ("radius" in shape)
					return {
						...base,
						kind: shape.kind,
						x: shape.x,
						y: shape.y,
						width: shape.radius * 2,
						height: shape.radius * 2,
					};
				if (shape.kind === "pin")
					return {
						...base,
						...shape,
						name: shape.name ?? "",
						width: 2 * PIN_RADIUS,
						height: 2 * PIN_RADIUS,
					};
				return {
					...base,
					...shape,
					rotation: ((shape.rotation ?? 0) * Math.PI) / 180,
				};
			}),
		}),
	);
}

/** Keep file metadata and the symbol origin while editing its primitive shapes. */
export function symbolFileWithShapes(
	file: SymbolFile,
	shapes: EditorShape[],
): SymbolFile {
	return {
		...file,
		shapes: shapes.map((shape): SymbolFile["shapes"][number] => {
			if (shape.kind === "text" || shape.kind === "symbol")
				throw new Error("Symbol files support primitive shapes only.");
			const base = { lineWidth: shape.lineWidth };
			if (shape.kind === "line" || shape.kind === "wire") {
				const dx = (Math.cos(shape.rotation) * shape.width) / 2;
				const dy = (Math.sin(shape.rotation) * shape.width) / 2;
				return {
					...base,
					kind: shape.kind,
					x1: shape.x - dx,
					y1: shape.y - dy,
					x2: shape.x + dx,
					y2: shape.y + dy,
				};
			}
			const position = { x: shape.x, y: shape.y };
			if (shape.kind === "pin")
				return { ...base, kind: shape.kind, ...position, name: shape.name };
			if (shape.kind === "circle")
				return {
					...base,
					kind: shape.kind,
					...position,
					radius: shape.width / 2,
				};
			const degrees = (shape.rotation * 180) / Math.PI;
			return {
				...base,
				kind: shape.kind,
				...position,
				width: shape.width,
				height: shape.height,
				rotation: (((degrees % 360) + 540) % 360) - 180,
			};
		}),
	};
}
