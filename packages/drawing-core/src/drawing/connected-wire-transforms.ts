import {
	connectionTolerance,
	pointOnWire,
} from "#/drawing/connection-geometry.ts";
import { electricalNets } from "#/drawing/named-nets.ts";
import type { EditorShape } from "#/drawing/schema.ts";
import {
	drawShape,
	localToWorld,
	snapPoint,
} from "#/drawing/shape-geometry.ts";
import { symbolShapes } from "#/drawing/symbol-instances.ts";
import { pinTerminals, routeWire } from "#/drawing/terminals.ts";
import type { Point } from "#/drawing/types.ts";

function moveConnectedWires(
	selected: EditorShape[],
	delta: Point,
	allShapes: EditorShape[],
): EditorShape[] {
	const selectedIds = new Set(selected.map((shape) => shape.id));
	const originals = new Map(allShapes.map((shape) => [shape.id, shape]));
	for (const shape of selected) originals.set(shape.id, shape);
	const wires = [...originals.values()]
		.filter((shape) => shape.kind === "wire")
		.map((shape) => ({
			shape,
			start: localToWorld(shape, -shape.width / 2, 0),
			end: localToWorld(shape, shape.width / 2, 0),
		}));
	const points = wires.flatMap(({ start, end }) => [start, end]);
	const connections = {
		x: points.map(() => new Set<number>()),
		y: points.map(() => new Set<number>()),
	};
	const connect = (axis: "x" | "y", first: number, second: number) => {
		connections[axis][first].add(second);
		connections[axis][second].add(first);
	};
	const seeds = new Set<number>();
	const attachments: { point: number; wire: number }[] = [];
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
	for (const [index, wire] of wires.entries()) {
		const first = index * 2;
		const second = first + 1;
		const axis =
			Math.abs(wire.end.x - wire.start.x) < Math.abs(wire.end.y - wire.start.y)
				? "x"
				: "y";
		connect(axis, first, second);
		const selectedWire = selectedIds.has(wire.shape.id);
		if (selectedWire) {
			seeds.add(first);
			seeds.add(second);
		}
		for (const [pointIndex, point] of points.entries()) {
			if (Math.floor(pointIndex / 2) === index) continue;
			if (!pointOnWire(point, wire.start, wire.end)) continue;
			attachments.push({ point: pointIndex, wire: index });
			// A T junction shares the coordinate perpendicular to the wire.
			connect(axis, first, pointIndex);
			connect(axis, second, pointIndex);
			// Attachments on a translated selected segment follow it in both axes.
			if (selectedWire) seeds.add(pointIndex);
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
	const affected = wires.filter((_, index) =>
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
			({ point, wire }) =>
				!pointOnWire(moved[point], moved[wire * 2], moved[wire * 2 + 1]),
		)
	)
		return replacements;
	const updated = new Map<number, EditorShape>();
	for (const [index, wire] of wires.entries()) {
		const start = moved[index * 2];
		const end = moved[index * 2 + 1];
		if (
			start.x === wire.start.x &&
			start.y === wire.start.y &&
			end.x === wire.end.x &&
			end.y === wire.end.y
		)
			continue;
		updated.set(wire.shape.id, {
			...drawShape(wire.shape.id, "wire", start, end),
			lineWidth: wire.shape.lineWidth,
		});
	}
	return replacements.map((shape) =>
		shape.kind === "wire"
			? (updated.get(shape.id) ?? shape)
			: { ...shape, x: shape.x + delta.x, y: shape.y + delta.y },
	);
}

function movementTerminals(shape: EditorShape): readonly Point[] {
	if (shape.kind === "text" && shape.electrical && shape.text.trim())
		return [{ x: shape.x, y: shape.y }];
	return pinTerminals(shape);
}

export function moveShapes(
	shapes: EditorShape[],
	delta: Point,
	gridStep = 0,
	anchorShape = shapes[0],
	allShapes = shapes,
	nextShapeId = [...allShapes, ...shapes].reduce(
		(maximum, shape) => Math.max(maximum, shape.id),
		0,
	) + 1,
	allowLocked = false,
): EditorShape[] {
	if (!allowLocked && shapes.some((shape) => shape.locked)) return shapes;
	if (gridStep > 0 && anchorShape) {
		// Keep corners on the grid even when the center lies halfway between grid lines.
		const anchor =
			anchorShape.kind === "circle" ||
			anchorShape.kind === "symbol" ||
			anchorShape.kind === "pin" ||
			anchorShape.kind === "no-connect" ||
			anchorShape.kind === "text"
				? anchorShape
				: localToWorld(
						anchorShape,
						-anchorShape.width / 2,
						anchorShape.kind === "wire" || anchorShape.kind === "line"
							? 0
							: -anchorShape.height / 2,
					);
		const target = snapPoint(
			{ x: anchor.x + delta.x, y: anchor.y + delta.y },
			gridStep,
		);
		delta = { x: target.x - anchor.x, y: target.y - anchor.y };
	}
	const moved = shapes.some((shape) => shape.kind === "wire")
		? moveConnectedWires(shapes, delta, allShapes)
		: shapes.map((shape) => ({
				...shape,
				x: shape.x + delta.x,
				y: shape.y + delta.y,
			}));
	if (!allowLocked && allShapes.some((shape) => shape.locked)) {
		const originals = new Map(allShapes.map((shape) => [shape.id, shape]));
		if (
			moved.some((shape) => {
				const original = originals.get(shape.id);
				return (
					original?.locked &&
					["x", "y", "width", "height", "rotation"].some(
						(key) =>
							original[key as keyof EditorShape] !==
							shape[key as keyof EditorShape],
					)
				);
			})
		)
			return moved.map((shape) => originals.get(shape.id) ?? shape);
	}

	if (delta.x === 0 && delta.y === 0) return moved;
	return connectTransformedTerminals(shapes, moved, allShapes, nextShapeId);
}

export function connectTransformedTerminals(
	shapes: EditorShape[],
	replacements: EditorShape[],
	allShapes: EditorShape[],
	nextShapeId: number,
	{ rerouteWireEnds = false }: { rerouteWireEnds?: boolean } = {},
): EditorShape[] {
	const moved = [...replacements];
	const terminals = shapes.flatMap((shape) =>
		movementTerminals(shape).map((point) => ({ shape, point })),
	);
	if (terminals.length === 0) return moved;
	const selectedIds = new Set(shapes.map((shape) => shape.id));
	const byId = new Map(moved.map((shape) => [shape.id, shape]));
	const stationaryTerminals = allShapes
		.filter((shape) => !selectedIds.has(shape.id))
		.flatMap((shape) =>
			movementTerminals(shape).map((point) => ({ shape, point })),
		);
	const stationaryPins = stationaryTerminals.map(({ point }) => point);
	const wires = allShapes.filter((shape) => shape.kind === "wire");
	const targets = shapes.flatMap((shape) =>
		movementTerminals(byId.get(shape.id) ?? shape),
	);
	const wireJunctions = rerouteWireEnds
		? wires.flatMap((wire) => [
				localToWorld(wire, -wire.width / 2, 0),
				localToWorld(wire, wire.width / 2, 0),
			])
		: [];
	const connections: {
		shape: EditorShape;
		terminal: Point;
		target: Point;
		anchor: Point;
	}[] = [];
	for (const [index, { shape, point: terminal }] of terminals.entries()) {
		const target = targets[index];
		if (
			Math.hypot(target.x - terminal.x, target.y - terminal.y) <=
			connectionTolerance
		)
			continue;
		const anchors: Point[] = [];
		if (
			stationaryPins.some(
				(pin) =>
					Math.hypot(pin.x - terminal.x, pin.y - terminal.y) <=
					connectionTolerance,
			)
		)
			anchors.push(terminal);
		for (const original of wires) {
			const wire = rerouteWireEnds
				? (byId.get(original.id) ?? original)
				: original;
			if (wire.width <= connectionTolerance) continue;
			const start = localToWorld(wire, -wire.width / 2, 0);
			const end = localToWorld(wire, wire.width / 2, 0);
			if (!pointOnWire(terminal, start, end)) continue;
			if (
				rerouteWireEnds &&
				!wire.locked &&
				!selectedIds.has(wire.id) &&
				[start, end].some(
					(point) =>
						Math.hypot(point.x - terminal.x, point.y - terminal.y) <=
						connectionTolerance,
				)
			) {
				const endpoint =
					Math.hypot(start.x - terminal.x, start.y - terminal.y) <=
					connectionTolerance
						? end
						: start;
				const junction = [
					...stationaryPins,
					...terminals.map(({ point }) => point),
					...wireJunctions,
				].reduce((nearest, point) => {
					const distance = Math.hypot(
						point.x - terminal.x,
						point.y - terminal.y,
					);
					return distance > connectionTolerance &&
						distance <
							Math.hypot(nearest.x - terminal.x, nearest.y - terminal.y) &&
						pointOnWire(point, start, end)
						? point
						: nearest;
				}, endpoint);
				const other = terminals.findIndex(
					({ point }) =>
						Math.hypot(point.x - junction.x, point.y - junction.y) <=
						connectionTolerance,
				);
				const anchor = other < 0 ? junction : targets[other];
				const retained = {
					...wire,
					...drawShape(wire.id, "wire", junction, endpoint),
					lineWidth: wire.lineWidth,
				};
				const index = moved.findIndex((shape) => shape.id === wire.id);
				if (index < 0) moved.push(retained);
				else moved[index] = retained;
				byId.set(wire.id, retained);
				anchors.push(anchor);
				continue;
			}
			const replacement = byId.get(wire.id) ?? wire;
			const movedStart = localToWorld(replacement, -replacement.width / 2, 0);
			const movedEnd = localToWorld(replacement, replacement.width / 2, 0);
			if (pointOnWire(target, movedStart, movedEnd)) continue;
			const vertical = Math.abs(end.x - start.x) < Math.abs(end.y - start.y);
			const across = vertical ? "x" : "y";
			const along = vertical ? "y" : "x";
			const anchor = { ...terminal };
			anchor[across] = replacement[across];
			anchor[along] = Math.max(
				Math.min(movedStart[along], movedEnd[along]),
				Math.min(terminal[along], Math.max(movedStart[along], movedEnd[along])),
			);
			anchors.push(anchor);
		}
		const unique = anchors.filter(
			(anchor, index) =>
				!anchors
					.slice(0, index)
					.some(
						(other) =>
							Math.hypot(anchor.x - other.x, anchor.y - other.y) <=
							connectionTolerance,
					),
		);
		for (const anchor of unique) {
			if (
				Math.hypot(target.x - anchor.x, target.y - anchor.y) >
				connectionTolerance
			)
				connections.push({ shape, terminal, target, anchor });
		}
	}
	const obstacles = wires
		.map((wire) => byId.get(wire.id) ?? wire)
		.filter((wire) => wire.width > connectionTolerance);
	const nets =
		connections.length &&
		(rerouteWireEnds ||
			allShapes.some(
				(shape) =>
					(shape.kind === "text" && shape.electrical) ||
					(shape.kind === "symbol" && shape.netSymbol),
			))
			? electricalNets(allShapes)
			: [];
	const wireNets = new Map(
		nets.flatMap((net) => net.wires.map((id) => [id, net] as const)),
	);
	const labelNets = new Map(
		nets.flatMap((net) => net.labels.map((id) => [id, net] as const)),
	);
	const pinNets = new Map(
		nets.flatMap((net) =>
			net.pins.map((pin) => [`${pin.shapeId}:${pin.pinId}`, net] as const),
		),
	);
	const symbolPins = new Map(
		allShapes.flatMap((shape) =>
			shape.kind === "symbol"
				? [
						[
							shape.id,
							symbolShapes(shape).filter((child) => child.kind === "pin"),
						] as const,
					]
				: [],
		),
	);
	const memberships = new Map(
		[...terminals, ...stationaryTerminals].map(({ shape, point }) => {
			if (shape.kind === "text")
				return [point, labelNets.get(shape.id)] as const;
			const pinId =
				shape.kind === "pin"
					? shape.id
					: symbolPins
							.get(shape.id)
							?.find(
								(pin) =>
									Math.hypot(pin.x - point.x, pin.y - point.y) <=
									connectionTolerance,
							)?.id;
			return [
				point,
				pinId === undefined ? undefined : pinNets.get(`${shape.id}:${pinId}`),
			] as const;
		}),
	);
	const preserveLabeledNets = connections.some(
		({ terminal }) => memberships.get(terminal)?.names.length,
	);
	for (const { shape, terminal, target, anchor } of connections) {
		const net = memberships.get(terminal);
		const horizontalFirst =
			shape.kind !== "symbol"
				? undefined
				: Math.abs(terminal.x - shape.x) >= Math.abs(terminal.y - shape.y)
					? (terminal.x - shape.x) * (target.x - terminal.x) >= 0
					: (terminal.y - shape.y) * (target.y - terminal.y) < 0;
		const segments =
			rerouteWireEnds || preserveLabeledNets
				? routeTransformedConnection(
						nextShapeId,
						anchor,
						target,
						Math.max(shape.width, shape.height) + 1,
						horizontalFirst,
						[
							...stationaryPins.filter(
								(point) => !net || memberships.get(point) !== net,
							),
							...targets.filter(
								(_, index) =>
									!net || memberships.get(terminals[index].point) !== net,
							),
						],
						obstacles.filter((wire) => !net || wireNets.get(wire.id) !== net),
					)
				: routeWire(nextShapeId, anchor, target, horizontalFirst);
		if (!segments) return shapes;
		obstacles.push(...segments);
		if (net) for (const segment of segments) wireNets.set(segment.id, net);

		moved.push(...segments);
		nextShapeId += segments.length;
	}
	return moved;
}

function routeTransformedConnection(
	id: number,
	anchor: Point,
	target: Point,
	spacing: number,
	horizontalFirst: boolean | undefined,
	terminals: Point[],
	obstacles: EditorShape[],
): EditorShape[] | undefined {
	const allowed = (point: Point) =>
		[anchor, target].some(
			(end) =>
				Math.hypot(point.x - end.x, point.y - end.y) <= connectionTolerance,
		);
	const endpoints = (wire: EditorShape) => [
		localToWorld(wire, -wire.width / 2, 0),
		localToWorld(wire, wire.width / 2, 0),
	];
	const edges = obstacles.map(endpoints);
	const clear = (segments: EditorShape[]) =>
		segments.every((segment) => {
			const [start, end] = endpoints(segment);
			if (
				terminals.some(
					(point) => !allowed(point) && pointOnWire(point, start, end),
				)
			)
				return false;
			return edges.every(([a, b]) => {
				if (
					[a, b].some(
						(point) => !allowed(point) && pointOnWire(point, start, end),
					)
				)
					return false;
				if (
					[start, end].some(
						(point) => !allowed(point) && pointOnWire(point, a, b),
					)
				)
					return false;
				const vertical = Math.abs(end.x - start.x) < Math.abs(end.y - start.y);
				const across = vertical ? "x" : "y",
					along = vertical ? "y" : "x";
				return (
					Math.abs(a[across] - start[across]) > connectionTolerance ||
					Math.abs(b[across] - start[across]) > connectionTolerance ||
					Math.min(
						Math.max(start[along], end[along]),
						Math.max(a[along], b[along]),
					) -
						Math.max(
							Math.min(start[along], end[along]),
							Math.min(a[along], b[along]),
						) <=
						connectionTolerance
				);
			});
		});
	for (const horizontal of [horizontalFirst, !horizontalFirst]) {
		const direct = routeWire(id, anchor, target, horizontal);
		if (clear(direct)) return direct;
	}
	for (let lane = 1; lane <= 32; lane++)
		for (const sign of [1, -1]) {
			const y = target.y + sign * spacing * lane;
			const x = target.x + sign * spacing * lane;
			for (const points of [
				[anchor, { x: anchor.x, y }, { x: target.x, y }, target],
				[anchor, { x, y: anchor.y }, { x, y: target.y }, target],
			]) {
				const segments = points
					.slice(1)
					.map((point, index) =>
						drawShape(id + index, "wire", points[index], point),
					)
					.filter((wire) => wire.width > connectionTolerance);
				if (clear(segments))
					return segments.map((segment, index) => ({
						...segment,
						id: id + index,
					}));
			}
		}
}
