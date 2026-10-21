import {
	drawShape,
	type EditorShape,
	openPins,
	openWireEnds,
	PIN_RADIUS,
	type ShapeKind,
	selectionSize,
	symbolShapes,
	symbolTextShapes,
} from "./shapes";

interface GeometrySize {
	width: number;
	height: number;
	lineWidth: number;
}

export interface DrawingTransform {
	x: number;
	y: number;
	width: number;
	height: number;
	rotation: number;
}

/** Geometry contains only the dimensions needed to draw an object. */
export type DrawingGeometry =
	| (GeometrySize & { kind: ShapeKind })
	| (GeometrySize & { kind: "pin-halo" })
	| (GeometrySize & {
			kind: "symbol";
			children: (GeometrySize &
				DrawingTransform & { kind: Exclude<ShapeKind, "text"> })[];
	  });

export type DrawingAppearance = "stroke" | "pin" | "wire" | "selected";

export interface DisplayShape extends DrawingTransform {
	key: string;
	name: string;
	geometry: DrawingGeometry;
	appearance: DrawingAppearance;
	text?: string;
	renderOrder: number;
	children?: DisplayShape[];
}

export interface DisplaySelection extends DrawingTransform {
	shapeKey: string;
	renderOrder: number;
}

export interface DrawingDisplay {
	shapes: DisplayShape[];
	selections: DisplaySelection[];
	terminals: DisplayShape[];
	connections: DisplayShape[];
	halos: DisplayShape[];
	previews: DisplayShape[];
}

function geometryFor(shape: EditorShape): DrawingGeometry {
	const { kind, width, height, lineWidth } = shape;
	if (kind !== "symbol") return { kind, width, height, lineWidth };
	return {
		kind,
		width,
		height,
		lineWidth,
		children: shape.children
			.filter(({ kind }) => kind !== "pin" && kind !== "wire")
			.map(({ kind, x, y, width, height, lineWidth, rotation }) => ({
				kind,
				x,
				y,
				width,
				height,
				lineWidth,
				rotation,
			})),
	};
}

function displayShape(
	shape: EditorShape,
	key: string,
	name: string,
	appearance: DrawingAppearance,
	renderOrder: number,
): DisplayShape {
	const display: DisplayShape = {
		key,
		name,
		geometry: geometryFor(shape),
		x: shape.x,
		y: shape.y,
		width: shape.width,
		height:
			shape.kind === "wire" || shape.kind === "line"
				? shape.lineWidth
				: shape.height,
		rotation: shape.rotation,
		appearance,
		...(shape.kind === "text" ? { text: shape.text } : {}),
		renderOrder,
	};
	if (shape.kind === "symbol") {
		const labels = shape.texts.filter(
			(label) => shape.attributes[label.attribute],
		);
		display.children = symbolTextShapes(shape).map((text, index) => ({
			...displayShape(
				text,
				`${key}:${labels[index].attribute}`,
				`${labels[index].attribute} ${shape.id}`,
				appearance,
				renderOrder + 1,
			),
			x: labels[index].x / shape.width,
			y: labels[index].y / shape.height,
			width: text.width / shape.width,
			height: text.height / shape.height,
			rotation: 0,
		}));
	}
	return display;
}

/** Resolve document, selection, and temporary previews without a renderer or UI. */
export function buildDrawingDisplay(
	shapes: EditorShape[],
	selectedIds: ReadonlySet<number>,
	previews: EditorShape[] = [],
): DrawingDisplay {
	const terminal = drawShape(0, "pin", { x: 0, y: 0 }, { x: 0, y: 0 });
	return {
		shapes: shapes.map((shape, index) =>
			displayShape(
				shape,
				`shape:${shape.id}`,
				`${shape.kind} ${shape.id}`,
				selectedIds.has(shape.id)
					? "selected"
					: shape.kind === "pin" || shape.kind === "wire"
						? shape.kind
						: "stroke",
				index + 1,
			),
		),
		selections: shapes
			.filter((shape) => selectedIds.has(shape.id))
			.map((shape) => ({
				shapeKey: `shape:${shape.id}`,
				x: shape.x,
				y: shape.y,
				...selectionSize(shape),
				rotation: shape.rotation,
				renderOrder: shapes.length + 1,
			})),
		terminals: openWireEnds(shapes).map(({ shape, point }) =>
			displayShape(
				{ ...terminal, ...point },
				"wire-terminal",
				"",
				selectedIds.has(shape.id) ? "selected" : "wire",
				shapes.length + 1,
			),
		),
		connections: shapes.flatMap((shape, index) =>
			shape.kind === "symbol"
				? symbolShapes(shape).flatMap((child) =>
						child.kind === "pin" || child.kind === "wire"
							? [
									displayShape(
										child,
										`shape:${shape.id}:connection:${child.id}`,
										`${child.kind} ${shape.id}:${child.id}`,
										selectedIds.has(shape.id)
											? "selected"
											: child.kind === "pin"
												? "pin"
												: "stroke",
										index + 1,
									),
								]
							: [],
					)
				: [],
		),
		halos: openPins(shapes).map(({ shape, point }, index) => ({
			...displayShape(
				{ ...terminal, ...point },
				`pin-halo:${shape.id}:${index}`,
				"editor-pin-halo",
				selectedIds.has(shape.id) ? "selected" : "pin",
				shapes.length + 1,
			),
			width: PIN_RADIUS * 4,
			height: PIN_RADIUS * 4,
			geometry: {
				kind: "pin-halo",
				width: PIN_RADIUS * 4,
				height: PIN_RADIUS * 4,
				lineWidth: 0.1,
			},
		})),
		previews: previews.flatMap((preview, index) => {
			if (preview.width <= 0) return [];
			const name =
				preview.kind === "symbol"
					? "editor-symbol-preview"
					: preview.kind === "wire"
						? index === 0
							? "editor-wire-preview"
							: "editor-wire-tail-preview"
						: "editor-shape-preview";
			return [
				displayShape(
					preview,
					`preview:${preview.id}`,
					name,
					"selected",
					shapes.length + 2,
				),
				...(preview.kind === "symbol"
					? symbolShapes(preview).flatMap((child) =>
							child.kind === "pin" || child.kind === "wire"
								? [
										displayShape(
											child,
											`preview:${preview.id}:connection:${child.id}`,
											"editor-connection-preview",
											"selected",
											shapes.length + 2,
										),
									]
								: [],
						)
					: []),
			];
		}),
	};
}
