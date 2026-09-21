import type { Bounds, Point } from "#/engine/types";

export const A3 = { width: 420, height: 297 } as const;
export type ShapeKind = "rectangle" | "circle" | "triangle" | "line";
export interface EditorShape extends Point {
	id: number;
	kind: ShapeKind;
	width: number;
	height: number;
	lineWidth: number;
	rotation: number;
}

export type ShapeAttribute =
	| "x"
	| "y"
	| "width"
	| "height"
	| "radius"
	| "angle"
	| "lineWidth";

/** Dimension edits keep the center fixed; circles always retain equal diameters. */
export function editShapeAttribute(
	shape: EditorShape,
	attribute: ShapeAttribute,
	value: number,
): EditorShape {
	if (!Number.isFinite(value)) return shape;
	if (attribute === "x" || attribute === "y")
		return { ...shape, [attribute]: value };
	if (attribute === "angle") {
		// Line drawing and junction movement require horizontal or vertical segments.
		if (shape.kind !== "line" || value % 90 !== 0) return shape;
		return { ...shape, rotation: (value * Math.PI) / 180 };
	}
	if (value <= 0) return shape;
	if (attribute === "radius") {
		return shape.kind === "circle"
			? { ...shape, width: value * 2, height: value * 2 }
			: shape;
	}
	if (
		shape.kind === "circle" &&
		(attribute === "width" || attribute === "height")
	) {
		return { ...shape, width: value, height: value };
	}
	if (shape.kind === "line" && attribute === "height") return shape;
	return { ...shape, [attribute]: value };
}

export interface ResizeHandle extends Point {
	id: string;
	xDirection: number;
	yDirection: number;
	cursor: string;
}

export function snapCoordinate(value: number, step: number): number {
	return step > 0
		? Number((Math.round(value / step) * step).toPrecision(12))
		: value;
}

export function snapPoint(point: Point, step: number): Point {
	return { x: snapCoordinate(point.x, step), y: snapCoordinate(point.y, step) };
}

/** Keep the start fixed and project the snapped endpoint onto its nearest axis. */
export function constrainLineEndpoint(
	start: Point,
	end: Point,
	gridStep = 0,
): Point {
	const target = snapPoint(end, gridStep);
	return Math.abs(target.x - start.x) >= Math.abs(target.y - start.y)
		? { x: target.x, y: start.y }
		: { x: start.x, y: target.y };
}

function localToWorld(shape: EditorShape, x: number, y: number): Point {
	return {
		x: shape.x + x * Math.cos(shape.rotation) - y * Math.sin(shape.rotation),
		y: shape.y + x * Math.sin(shape.rotation) + y * Math.cos(shape.rotation),
	};
}

/** Handle positions use the same local axes as the rendered shape. */
export function resizeHandles(shape: EditorShape): ResizeHandle[] {
	const directions =
		shape.kind === "line"
			? [
					[-1, 0],
					[1, 0],
				]
			: shape.kind === "circle"
				? [
						[-1, 0],
						[1, 0],
						[0, -1],
						[0, 1],
					]
				: [
						[-1, -1],
						[0, -1],
						[1, -1],
						[-1, 0],
						[1, 0],
						[-1, 1],
						[0, 1],
						[1, 1],
					];
	return directions.map(([xDirection, yDirection]) => {
		const angle = Math.atan2(yDirection, xDirection) + shape.rotation;
		const cursor = ["ew-resize", "nesw-resize", "ns-resize", "nwse-resize"][
			((Math.round(angle / (Math.PI / 4)) % 4) + 4) % 4
		];
		return {
			...localToWorld(
				shape,
				(xDirection * shape.width) / 2,
				(yDirection * shape.height) / 2,
			),
			id: `${xDirection},${yDirection}`,
			xDirection,
			yDirection,
			cursor: shape.kind === "line" ? "crosshair" : cursor,
		};
	});
}

/** Resize from the initial shape so a drag never accumulates rounding errors. */
export function resizeShape(
	shape: EditorShape,
	handle: ResizeHandle,
	delta: Point,
	gridStep = 0,
): EditorShape {
	const target = { x: handle.x + delta.x, y: handle.y + delta.y };
	if (shape.kind === "circle") {
		const radius = Math.max(
			gridStep,
			0.05,
			snapCoordinate(
				Math.hypot(target.x - shape.x, target.y - shape.y),
				gridStep,
			),
		);
		const diameter = radius * 2;
		return { ...shape, width: diameter, height: diameter };
	}
	if (shape.kind === "line") {
		const fixed = localToWorld(
			shape,
			(-handle.xDirection * shape.width) / 2,
			0,
		);
		const point = constrainLineEndpoint(fixed, target, gridStep);
		const resized =
			handle.xDirection === 1
				? drawShape(shape.id, "line", fixed, point)
				: drawShape(shape.id, "line", point, fixed);
		return { ...resized, lineWidth: shape.lineWidth };
	}
	const point = snapPoint(target, gridStep);
	const deltaX = point.x - handle.x;
	const deltaY = point.y - handle.y;
	const dx =
		deltaX * Math.cos(shape.rotation) + deltaY * Math.sin(shape.rotation);
	const dy =
		-deltaX * Math.sin(shape.rotation) + deltaY * Math.cos(shape.rotation);
	const width = Math.max(
		handle.xDirection ? gridStep : 0,
		0.1,
		shape.width + handle.xDirection * dx,
	);
	const height = Math.max(
		handle.yDirection ? gridStep : 0,
		0.1,
		shape.height + handle.yDirection * dy,
	);
	return {
		...shape,
		...localToWorld(
			shape,
			(handle.xDirection * (width - shape.width)) / 2,
			(handle.yDirection * (height - shape.height)) / 2,
		),
		width,
		height,
	};
}

/** Rectangles and triangles use opposite corners; circles use center/radius; lines use endpoints. */
export function drawShape(
	id: number,
	kind: ShapeKind,
	start: Point,
	end: Point,
	gridStep = 0,
): EditorShape {
	const first = snapPoint(start, gridStep);
	const last =
		kind === "circle"
			? end
			: kind === "line"
				? constrainLineEndpoint(first, end, gridStep)
				: snapPoint(end, gridStep);
	const dx = last.x - first.x;
	const dy = last.y - first.y;
	if (kind === "circle") {
		const radius = snapCoordinate(Math.hypot(dx, dy), gridStep);
		return {
			id,
			kind,
			...first,
			width: radius * 2,
			height: radius * 2,
			rotation: 0,
			lineWidth: 0.1,
		};
	}
	return {
		id,
		kind,
		x: (first.x + last.x) / 2,
		y: (first.y + last.y) / 2,
		width: kind === "line" ? Math.hypot(dx, dy) : Math.abs(dx),
		height: kind === "line" ? 1 : Math.abs(dy),
		rotation: kind === "line" ? Math.atan2(dy, dx) : 0,
		lineWidth: 0.1,
	};
}

export function shapeBounds(shape: EditorShape): Bounds {
	const height = shape.kind === "line" ? shape.lineWidth : shape.height;
	const cos = Math.abs(Math.cos(shape.rotation));
	const sin = Math.abs(Math.sin(shape.rotation));
	const halfWidth = (shape.width * cos + height * sin) / 2;
	const halfHeight = (shape.width * sin + height * cos) / 2;
	return {
		minX: shape.x - halfWidth,
		maxX: shape.x + halfWidth,
		minY: shape.y - halfHeight,
		maxY: shape.y + halfHeight,
	};
}

export function hitShape(shape: EditorShape, point: Point, tolerance: number) {
	const { width, height } = shape;
	const dx = point.x - shape.x;
	const dy = point.y - shape.y;
	const x = Math.abs(
		dx * Math.cos(shape.rotation) + dy * Math.sin(shape.rotation),
	);
	const y = -dx * Math.sin(shape.rotation) + dy * Math.cos(shape.rotation);
	if (shape.kind === "circle") return Math.hypot(x, y) <= width / 2;
	if (shape.kind === "triangle") {
		return (
			height > 0 &&
			y >= -height / 2 &&
			y <= height / 2 &&
			x <= (width / 2) * (0.5 - y / height)
		);
	}
	return (
		x <= width / 2 &&
		Math.abs(y) <=
			(shape.kind === "line"
				? Math.max(shape.lineWidth / 2, tolerance)
				: height / 2)
	);
}

/** Select any shape touched by the rectangle, including partially covered shapes. */
export function intersectsSelection(shape: EditorShape, bounds: Bounds) {
	const { width, height } = shape;
	if (shape.kind === "circle") {
		const x = Math.max(bounds.minX, Math.min(bounds.maxX, shape.x));
		const y = Math.max(bounds.minY, Math.min(bounds.maxY, shape.y));
		return Math.hypot(x - shape.x, y - shape.y) <= width / 2;
	}
	const own = shapeBounds(shape);
	if (
		own.maxX < bounds.minX ||
		own.minX > bounds.maxX ||
		own.maxY < bounds.minY ||
		own.minY > bounds.maxY
	)
		return false;
	if (shape.kind === "line") {
		// The remaining separating axes are the line's local X and Y axes.
		const dx = (bounds.minX + bounds.maxX) / 2 - shape.x;
		const dy = (bounds.minY + bounds.maxY) / 2 - shape.y;
		const halfWidth = (bounds.maxX - bounds.minX) / 2;
		const halfHeight = (bounds.maxY - bounds.minY) / 2;
		const cos = Math.cos(shape.rotation),
			sin = Math.sin(shape.rotation);
		return (
			Math.abs(dx * cos + dy * sin) <=
				width / 2 + halfWidth * Math.abs(cos) + halfHeight * Math.abs(sin) &&
			Math.abs(-dx * sin + dy * cos) <=
				shape.lineWidth / 2 +
					halfWidth * Math.abs(sin) +
					halfHeight * Math.abs(cos)
		);
	}
	if (shape.kind !== "triangle") return true;
	const y = Math.max(own.minY, bounds.minY);
	const halfWidth = height > 0 ? ((width / 2) * (own.maxY - y)) / height : 0;
	return (
		shape.x + halfWidth >= bounds.minX && shape.x - halfWidth <= bounds.maxX
	);
}

// Pointer-to-world conversion can leave roughly 0.00001 mm after a visual collapse.
const connectionTolerance = 1e-4;
const normalizationTolerance = connectionTolerance;

/** Normalize committed segments; drag previews keep their original separate IDs. */
export function normalizeLineSegments(
	shapes: EditorShape[],
	preferredIds: ReadonlySet<number> = new Set(),
): { shapes: EditorShape[]; idMap: Map<number, number> } {
	const lines = shapes.flatMap((shape, index) => {
		if (shape.kind !== "line" || shape.width <= normalizationTolerance)
			return [];
		const start = localToWorld(shape, -shape.width / 2, 0);
		const end = localToWorld(shape, shape.width / 2, 0);
		const vertical = Math.abs(end.x - start.x) < Math.abs(end.y - start.y);
		return [
			{
				shape,
				index,
				vertical,
				coordinate: vertical ? shape.x : shape.y,
				min: Math.min(vertical ? start.y : start.x, vertical ? end.y : end.x),
				max: Math.max(vertical ? start.y : start.x, vertical ? end.y : end.x),
				forward: vertical ? end.y >= start.y : end.x >= start.x,
			},
		];
	});
	const parents = lines.map((_, index) => index);
	const root = (index: number): number => {
		while (parents[index] !== index) {
			parents[index] = parents[parents[index]];
			index = parents[index];
		}
		return index;
	};
	for (let first = 0; first < lines.length; first++) {
		for (let second = first + 1; second < lines.length; second++) {
			const a = lines[first];
			const b = lines[second];
			if (
				a.vertical === b.vertical &&
				a.shape.lineWidth === b.shape.lineWidth &&
				Math.abs(a.coordinate - b.coordinate) <= normalizationTolerance &&
				a.min <= b.max + normalizationTolerance &&
				b.min <= a.max + normalizationTolerance
			)
				parents[root(second)] = root(first);
		}
	}
	const clusters = new Map<number, typeof lines>();
	for (const [index, line] of lines.entries()) {
		const key = root(index);
		const cluster = clusters.get(key) ?? [];
		cluster.push(line);
		clusters.set(key, cluster);
	}
	const replacements = new Map<number, EditorShape>();
	const idMap = new Map<number, number>();
	for (const cluster of clusters.values()) {
		const survivor =
			cluster.find(({ shape }) => preferredIds.has(shape.id)) ?? cluster[0];
		for (const { shape } of cluster) idMap.set(shape.id, survivor.shape.id);
		if (cluster.length === 1) {
			replacements.set(cluster[0].index, survivor.shape);
			continue;
		}
		const min = Math.min(...cluster.map((line) => line.min));
		const max = Math.max(...cluster.map((line) => line.max));
		const start = survivor.forward ? min : max;
		const end = survivor.forward ? max : min;
		const point = (value: number): Point =>
			survivor.vertical
				? { x: survivor.coordinate, y: value }
				: { x: value, y: survivor.coordinate };
		replacements.set(cluster[0].index, {
			...drawShape(survivor.shape.id, "line", point(start), point(end)),
			lineWidth: survivor.shape.lineWidth,
		});
	}
	return {
		shapes: shapes.flatMap((shape, index) => {
			if (shape.kind !== "line") {
				idMap.set(shape.id, shape.id);
				return [shape];
			}
			const replacement = replacements.get(index);
			return replacement ? [replacement] : [];
		}),
		idMap,
	};
}

function pointOnLine(point: Point, start: Point, end: Point) {
	const vertical = Math.abs(end.x - start.x) < Math.abs(end.y - start.y);
	const along = vertical ? "y" : "x";
	const across = vertical ? "x" : "y";
	return (
		Math.abs(point[across] - start[across]) <= connectionTolerance &&
		point[along] >= Math.min(start[along], end[along]) - connectionTolerance &&
		point[along] <= Math.max(start[along], end[along]) + connectionTolerance
	);
}

/** Preserve endpoint junctions using the drawing as it was when movement began. */
function moveConnectedLines(
	selected: EditorShape[],
	delta: Point,
	allShapes: EditorShape[],
): EditorShape[] {
	const selectedIds = new Set(selected.map((shape) => shape.id));
	const originals = new Map(allShapes.map((shape) => [shape.id, shape]));
	for (const shape of selected) originals.set(shape.id, shape);
	const lines = [...originals.values()]
		.filter((shape) => shape.kind === "line")
		.map((shape) => ({
			shape,
			start: localToWorld(shape, -shape.width / 2, 0),
			end: localToWorld(shape, shape.width / 2, 0),
		}));
	const points = lines.flatMap(({ start, end }) => [start, end]);
	const connections = {
		x: points.map(() => new Set<number>()),
		y: points.map(() => new Set<number>()),
	};
	const connect = (axis: "x" | "y", first: number, second: number) => {
		connections[axis][first].add(second);
		connections[axis][second].add(first);
	};
	const seeds = new Set<number>();
	const attachments: { point: number; line: number }[] = [];
	for (let first = 0; first < points.length; first++) {
		for (let second = first + 1; second < points.length; second++) {
			if (
				Math.hypot(
					points[first].x - points[second].x,
					points[first].y - points[second].y,
				) <= connectionTolerance
			) {
				connect("x", first, second);
				connect("y", first, second);
			}
		}
	}
	for (const [index, line] of lines.entries()) {
		const first = index * 2;
		const second = first + 1;
		const axis =
			Math.abs(line.end.x - line.start.x) < Math.abs(line.end.y - line.start.y)
				? "x"
				: "y";
		connect(axis, first, second);
		const selectedLine = selectedIds.has(line.shape.id);
		if (selectedLine) {
			seeds.add(first);
			seeds.add(second);
		}
		for (const [pointIndex, point] of points.entries()) {
			if (Math.floor(pointIndex / 2) === index) continue;
			if (!pointOnLine(point, line.start, line.end)) continue;
			attachments.push({ point: pointIndex, line: index });
			// A T junction shares the coordinate perpendicular to the line.
			connect(axis, first, pointIndex);
			connect(axis, second, pointIndex);
			// Attachments on a translated selected segment follow it in both axes.
			if (selectedLine) seeds.add(pointIndex);
		}
	}
	const reachable = (axis: "x" | "y") => {
		const reached = new Set(seeds);
		const pending = [...seeds];
		for (let index = 0; index < pending.length; index++) {
			for (const next of connections[axis][pending[index]]) {
				if (reached.has(next)) continue;
				reached.add(next);
				pending.push(next);
			}
		}
		return reached;
	};
	const moveX = reachable("x");
	const moveY = reachable("y");
	const affected = lines.filter((_, index) =>
		[index * 2, index * 2 + 1].some(
			(point) => moveX.has(point) || moveY.has(point),
		),
	);
	const replacements = [
		...selected,
		...affected
			.filter(({ shape }) => !selectedIds.has(shape.id))
			.map(({ shape }) => shape),
	];
	// Include unchanged neighbors so reversing a drag restores their original ends.
	if (delta.x === 0 && delta.y === 0) return replacements;
	const moved = points.map((point, index) => ({
		x: point.x + (moveX.has(index) ? delta.x : 0),
		y: point.y + (moveY.has(index) ? delta.y : 0),
	}));
	// Sliding a T junction is allowed while it remains on its attached segment.
	if (
		attachments.some(
			({ point, line }) =>
				!pointOnLine(moved[point], moved[line * 2], moved[line * 2 + 1]),
		)
	)
		return replacements;
	const updated = new Map<number, EditorShape>();
	for (const [index, line] of lines.entries()) {
		const start = moved[index * 2];
		const end = moved[index * 2 + 1];
		if (
			start.x === line.start.x &&
			start.y === line.start.y &&
			end.x === line.end.x &&
			end.y === line.end.y
		)
			continue;
		updated.set(line.shape.id, {
			...drawShape(line.shape.id, "line", start, end),
			lineWidth: line.shape.lineWidth,
		});
	}
	return replacements.map((shape) =>
		shape.kind === "line"
			? (updated.get(shape.id) ?? shape)
			: { ...shape, x: shape.x + delta.x, y: shape.y + delta.y },
	);
}

/** Move selected shapes rigidly and adjust connected line ends without selecting them. */
export function moveShapes(
	shapes: EditorShape[],
	delta: Point,
	gridStep = 0,
	anchorShape = shapes[0],
	allShapes = shapes,
): EditorShape[] {
	if (gridStep > 0 && anchorShape) {
		// Keep corners on the grid even when the center lies halfway between lines.
		const anchor =
			anchorShape.kind === "circle"
				? anchorShape
				: localToWorld(
						anchorShape,
						-anchorShape.width / 2,
						anchorShape.kind === "line" ? 0 : -anchorShape.height / 2,
					);
		const target = snapPoint(
			{ x: anchor.x + delta.x, y: anchor.y + delta.y },
			gridStep,
		);
		delta = { x: target.x - anchor.x, y: target.y - anchor.y };
	}
	if (shapes.some((shape) => shape.kind === "line"))
		return moveConnectedLines(shapes, delta, allShapes);
	return shapes.map((shape) => ({
		...shape,
		x: shape.x + delta.x,
		y: shape.y + delta.y,
	}));
}
