import { connectionTolerance } from "#/drawing/connection-geometry.ts";
import type { EditorShape } from "#/drawing/schema.ts";
import { drawShape, localToWorld } from "#/drawing/shape-geometry.ts";
import { pinTerminals } from "#/drawing/terminals.ts";

interface TerminalSpan {
	vertical: boolean;
	coordinate: number;
	min: number;
	max: number;
}

function terminalSpans(symbol: EditorShape): TerminalSpan[] {
	const spans: TerminalSpan[] = [];
	for (const vertical of [false, true]) {
		const lines: TerminalSpan[] = [];
		for (const terminal of pinTerminals(symbol)) {
			const coordinate = vertical ? terminal.x : terminal.y;
			const along = vertical ? terminal.y : terminal.x;
			const line = lines.find(
				(item) => Math.abs(item.coordinate - coordinate) <= connectionTolerance,
			);
			if (line) {
				line.min = Math.min(line.min, along);
				line.max = Math.max(line.max, along);
			} else lines.push({ vertical, coordinate, min: along, max: along });
		}
		spans.push(
			...lines.filter((line) => line.max - line.min > connectionTolerance),
		);
	}
	return spans;
}

export function cutWiresUnderSymbols(
	shapes: readonly EditorShape[],
	placed: readonly EditorShape[],
	nextShapeId: number,
): { shapes: EditorShape[]; nextShapeId: number } {
	const spans = placed.flatMap((shape) =>
		shape.kind === "symbol" ? terminalSpans(shape) : [],
	);
	if (!spans.length) return { shapes: [...shapes], nextShapeId };
	const result = shapes.flatMap((shape): EditorShape[] => {
		if (
			shape.kind !== "wire" ||
			shape.locked ||
			shape.width <= connectionTolerance
		)
			return [shape];
		const start = localToWorld(shape, -shape.width / 2, 0);
		const end = localToWorld(shape, shape.width / 2, 0);
		const vertical = Math.abs(end.x - start.x) < Math.abs(end.y - start.y);
		const coordinate = vertical ? start.x : start.y;
		const from = vertical ? start.y : start.x;
		const to = vertical ? end.y : end.x;
		let pieces = [{ min: Math.min(from, to), max: Math.max(from, to) }];
		for (const span of spans) {
			if (
				span.vertical !== vertical ||
				Math.abs(span.coordinate - coordinate) > connectionTolerance
			)
				continue;
			pieces = pieces.flatMap((piece) =>
				piece.min < span.max - connectionTolerance &&
				piece.max > span.min + connectionTolerance
					? [
							{ min: piece.min, max: span.min },
							{ min: span.max, max: piece.max },
						].filter((part) => part.max - part.min > connectionTolerance)
					: [piece],
			);
		}
		if (
			pieces.length === 1 &&
			pieces[0].min === Math.min(from, to) &&
			pieces[0].max === Math.max(from, to)
		)
			return [shape];
		const point = (value: number) =>
			vertical ? { x: coordinate, y: value } : { x: value, y: coordinate };
		if (from > to) pieces.reverse();
		return pieces.map((piece, index) => ({
			...drawShape(
				index === 0 ? shape.id : nextShapeId++,
				"wire",
				point(from <= to ? piece.min : piece.max),
				point(from <= to ? piece.max : piece.min),
			),
			lineWidth: shape.lineWidth,
		}));
	});
	return { shapes: result, nextShapeId };
}
