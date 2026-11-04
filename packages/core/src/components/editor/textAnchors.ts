import { isNetLabel } from "#/drawing/named-nets.ts";
import {
	type EditorShape,
	symbolShapes,
	symbolTextShapes,
} from "#/drawing/shapes.ts";
import type { Point } from "#/drawing/types.ts";
import { measurePerformance } from "#/performance/runtime.ts";

export interface TextAnchor extends Point {
	key: string;
}

export function createTextAnchorReader() {
	let previous: EditorShape[] | undefined;
	let anchors: TextAnchor[] = [];
	return (shapes: EditorShape[], selected: EditorShape[]) => {
		const sources = [
			...shapes.filter(isNetLabel),
			...selected.filter(
				(shape) =>
					!isNetLabel(shape) &&
					(shape.kind === "text" || shape.kind === "symbol"),
			),
		];
		const cached = previous;
		if (
			cached &&
			sources.length === cached.length &&
			sources.every((shape, index) => shape === cached[index])
		)
			return anchors;
		previous = sources;
		anchors = measurePerformance(
			"editor.text-anchors",
			() =>
				sources.flatMap((shape) => {
					if (shape.kind === "text")
						return [{ key: `${shape.id}`, x: shape.x, y: shape.y }];
					if (shape.kind !== "symbol") return [];
					return [
						...symbolTextShapes(shape).map((text) => ({
							key: `${shape.id}:label:${text.id}`,
							x: text.x,
							y: text.y,
						})),
						...symbolShapes(shape)
							.filter((child) => child.kind === "text")
							.map((text) => ({
								key: `${shape.id}:text:${text.id}`,
								x: text.x,
								y: text.y,
							})),
					];
				}),
			{ sources: sources.length },
		);
		return anchors;
	};
}
