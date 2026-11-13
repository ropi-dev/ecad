import type { EditorSymbol, SymbolText } from "#/drawing/schema.ts";
import { moveSymbolChild } from "#/drawing/shape-editing.ts";
import { shapeBounds } from "#/drawing/shape-geometry.ts";
import { symbolShapes } from "#/drawing/symbol-instances.ts";
import type { TextAlignment } from "#/drawing/text-alignment.ts";
import type { Bounds, Point } from "#/drawing/types.ts";
import { SYMBOL_TEXT_SIZE } from "#/drawing/units.ts";

export function moveSymbolText(
	symbol: EditorSymbol,
	index: number,
	delta: Point,
	gridStep = 0,
): EditorSymbol {
	const label = symbol.texts[index];
	return label
		? moveSymbolChild(symbol, `attribute:${label.attribute}`, delta, gridStep)
		: symbol;
}

export type SymbolLabelPosition =
	| "default"
	| "above"
	| "below"
	| "left"
	| "right";

const LABEL_POSITION_EPSILON = 1e-6;

function symbolWorldBounds(symbol: EditorSymbol): Bounds {
	const boxes = symbolShapes(symbol).map(shapeBounds);
	return {
		minX: Math.min(...boxes.map((box) => box.minX)),
		maxX: Math.max(...boxes.map((box) => box.maxX)),
		minY: Math.min(...boxes.map((box) => box.minY)),
		maxY: Math.max(...boxes.map((box) => box.maxY)),
	};
}

const LABEL_DIRECTIONS: Record<
	Exclude<SymbolLabelPosition, "default">,
	Point
> = {
	above: { x: 0, y: 1 },
	below: { x: 0, y: -1 },
	left: { x: -1, y: 0 },
	right: { x: 1, y: 0 },
};

export function symbolLabelAnchor(
	symbol: EditorSymbol,
	attribute: SymbolText["attribute"],
	position: Exclude<SymbolLabelPosition, "default">,
	gap = SYMBOL_TEXT_SIZE / 4,
): Point & Required<TextAlignment> {
	const bounds = symbolWorldBounds(symbol);
	const direction = LABEL_DIRECTIONS[position];
	const centerX = (bounds.minX + bounds.maxX) / 2;
	const centerY = (bounds.minY + bounds.maxY) / 2;
	const anchor = {
		x:
			direction.x === 0
				? centerX
				: direction.x > 0
					? bounds.maxX + gap
					: bounds.minX - gap,
		y:
			direction.y === 0
				? centerY
				: direction.y > 0
					? bounds.maxY + gap
					: bounds.minY - gap,
	};
	const rotation =
		symbol.rotation +
		(symbol.childOverrides?.[`attribute:${attribute}`]?.rotation ?? 0);
	// Components of the direction along the label's local x and y axes.
	const along =
		direction.x * Math.cos(rotation) + direction.y * Math.sin(rotation);
	const across =
		-direction.x * Math.sin(rotation) + direction.y * Math.cos(rotation);
	// Local Y points up: "left" text grows +x, "bottom" text grows +y. Align
	// outward on both axes so a tilted label cannot swing back over the
	// geometry; an axis perpendicular to the direction stays centred.
	return {
		...anchor,
		horizontalAlign:
			Math.abs(along) < LABEL_POSITION_EPSILON
				? "center"
				: along > 0
					? "left"
					: "right",
		verticalAlign:
			Math.abs(across) < LABEL_POSITION_EPSILON
				? "middle"
				: across > 0
					? "bottom"
					: "top",
	};
}

function worldToSymbolLocal(symbol: EditorSymbol, point: Point): Point {
	const dx = point.x - symbol.x;
	const dy = point.y - symbol.y;
	return {
		x: dx * Math.cos(symbol.rotation) + dy * Math.sin(symbol.rotation),
		y: -dx * Math.sin(symbol.rotation) + dy * Math.cos(symbol.rotation),
	};
}

function withoutKey<T extends object>(record: T | undefined, key: string) {
	if (!record) return undefined;
	const rest = Object.fromEntries(
		Object.entries(record).filter(([name]) => name !== key),
	) as T;
	return Object.keys(rest).length ? rest : undefined;
}

export function setSymbolLabelPosition(
	symbol: EditorSymbol,
	attribute: SymbolText["attribute"],
	position: SymbolLabelPosition,
): EditorSymbol {
	if (position === "default")
		return {
			...symbol,
			textAlignments: withoutKey(symbol.textAlignments, attribute),
			textPositions: withoutKey(symbol.textPositions, attribute),
		};
	// Unresolved symbols have no geometry to place the label beside.
	if (!symbol.children.length) return symbol;
	const { horizontalAlign, verticalAlign, ...anchor } = symbolLabelAnchor(
		symbol,
		attribute,
		position,
	);
	return {
		...symbol,
		textPositions: {
			...symbol.textPositions,
			[attribute]: worldToSymbolLocal(symbol, anchor),
		},
		textAlignments: {
			...symbol.textAlignments,
			[attribute]: { horizontalAlign, verticalAlign },
		},
	};
}

export function symbolLabelPosition(
	symbol: EditorSymbol,
	attribute: SymbolText["attribute"],
): SymbolLabelPosition | "custom" {
	if (
		symbol.textPositions?.[attribute] === undefined &&
		symbol.textAlignments?.[attribute] === undefined
	)
		return "default";
	// A label is "default" while its stored anchor still matches the symbol's
	// own text definition (createSymbol copies it into textPositions; user
	// moves write an override).
	const label = symbol.texts.find((text) => text.attribute === attribute);
	const stored = symbol.textPositions?.[attribute];
	const alignment = symbol.textAlignments?.[attribute];
	if (
		!alignment &&
		stored !== undefined &&
		stored.x === label?.x &&
		stored.y === label?.y
	)
		return "default";
	const local = stored ?? label ?? { x: 0, y: 0 };
	const matches = (candidate: Exclude<SymbolLabelPosition, "default">) => {
		const anchor = symbolLabelAnchor(symbol, attribute, candidate);
		const expected = worldToSymbolLocal(symbol, anchor);
		return (
			Math.abs(local.x - expected.x) < LABEL_POSITION_EPSILON &&
			Math.abs(local.y - expected.y) < LABEL_POSITION_EPSILON &&
			alignment?.horizontalAlign === anchor.horizontalAlign &&
			alignment?.verticalAlign === anchor.verticalAlign
		);
	};
	return (
		(["above", "below", "left", "right"] as const).find(matches) ?? "custom"
	);
}

const placementFields: readonly string[] = [
	"x",
	"y",
	"rotation",
	"horizontalAlign",
	"verticalAlign",
];

function textAttribute(key: string) {
	return key.startsWith("attribute:")
		? (key.slice(10) as SymbolText["attribute"])
		: undefined;
}

export function symbolTextMoved(symbol: EditorSymbol, key: string): boolean {
	const override: Record<string, unknown> = symbol.childOverrides?.[key] ?? {};
	const attribute = textAttribute(key);
	return (
		placementFields.some((field) => override[field] !== undefined) ||
		(attribute !== undefined &&
			symbolLabelPosition(symbol, attribute) !== "default")
	);
}

export function resetSymbolText(
	symbol: EditorSymbol,
	key: string,
): EditorSymbol {
	if (!symbolTextMoved(symbol, key)) return symbol;
	const override = Object.fromEntries(
		Object.entries(symbol.childOverrides?.[key] ?? {}).filter(
			([field]) => !placementFields.includes(field),
		),
	);
	const reset = {
		...symbol,
		childOverrides: Object.keys(override).length
			? { ...symbol.childOverrides, [key]: override }
			: withoutKey(symbol.childOverrides, key),
	};
	const attribute = textAttribute(key);
	return attribute
		? setSymbolLabelPosition(reset, attribute, "default")
		: reset;
}
