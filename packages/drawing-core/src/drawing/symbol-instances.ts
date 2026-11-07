import type {
	BasicShape,
	EditorSymbol,
	SymbolShape,
	SymbolText,
	TextShape,
} from "#/drawing/schema.ts";
import { localToWorld } from "#/drawing/shape-geometry.ts";
import {
	canSelectShape,
	isBoxSymbol,
	type SymbolChild,
} from "#/drawing/shape-types.ts";
import type { Point } from "#/drawing/types.ts";

export function boxBorder(
	symbol: EditorSymbol,
): { key: string; shape: BasicShape } | undefined {
	if (!isBoxSymbol(symbol)) return;
	const original = symbol.children.find((child) => child.kind === "rectangle");
	if (!original || original.kind !== "rectangle") return;
	const key = `shape:${original.id}`;
	return { key, shape: { ...original, ...symbol.childOverrides?.[key] } };
}

export function boxText(
	symbol: EditorSymbol,
): { key: string; shape: TextShape } | undefined {
	if (!isBoxSymbol(symbol)) return;
	const child = symbolChildren(symbol).find(
		(item) => item.shape.kind === "text",
	);
	return child?.shape.kind === "text"
		? { key: child.key, shape: child.shape }
		: undefined;
}

export function fitBoxToBorder(
	symbol: EditorSymbol,
	{
		preserveChildWorldPositions = false,
	}: { preserveChildWorldPositions?: boolean } = {},
): EditorSymbol {
	const border = boxBorder(symbol);
	if (!border) return symbol;
	const { width, height } = border.shape;
	const dx = border.shape.x - width / 2;
	const dy = border.shape.y + height / 2;
	if (Math.abs(dx) < 1e-9 && Math.abs(dy) < 1e-9 && border.shape.rotation === 0)
		return symbol.width === width && symbol.height === height
			? symbol
			: { ...symbol, width, height };
	const childOverrides = { ...symbol.childOverrides };
	for (const child of symbolChildren(symbol)) {
		if (child.key === border.key) {
			childOverrides[child.key] = {
				...childOverrides[child.key],
				x: width / 2,
				y: -height / 2,
				rotation: 0,
			};
		} else if (preserveChildWorldPositions && child.key.startsWith("shape:")) {
			childOverrides[child.key] = {
				...childOverrides[child.key],
				x: child.shape.x - dx,
				y: child.shape.y - dy,
			};
		}
	}
	return {
		...symbol,
		...localToWorld(symbol, dx, dy),
		width,
		height,
		childOverrides,
	};
}

export function canSelectSymbolChild(
	symbol: EditorSymbol,
	child: SymbolChild,
	allowLocked = false,
): boolean {
	if (boxBorder(symbol)?.key === child.key) return false;
	return (
		canSelectShape(symbol, allowLocked) &&
		!(child.shape.locked ?? child.shape.kind !== "text")
	);
}

/**
 * Pins stay fixed to their symbol definition, but they can still be selected
 * on the schematic so their attributes are visible. Editing goes through
 * {@link canSelectSymbolChild}.
 */
export function canInspectSymbolChild(
	symbol: EditorSymbol,
	child: SymbolChild,
	allowLocked = false,
): boolean {
	return (
		canSelectSymbolChild(symbol, child, allowLocked) ||
		(child.shape.kind === "pin" && canSelectShape(symbol, allowLocked))
	);
}

export function symbolChildren(symbol: EditorSymbol): SymbolChild[] {
	return [
		...symbol.children.map((shape) => ({
			key: `shape:${shape.id}`,
			shape: {
				...shape,
				...symbol.childOverrides?.[`shape:${shape.id}`],
				locked:
					symbol.childOverrides?.[`shape:${shape.id}`]?.locked ??
					shape.locked ??
					shape.kind !== "text",
			} as SymbolShape,
		})),
		...symbolTextShapes({ ...symbol, x: 0, y: 0, rotation: 0 }).map(
			(shape) => ({
				key: `attribute:${symbol.texts[shape.id].attribute}`,
				shape,
			}),
		),
	];
}

export function symbolChildWorld(
	symbol: EditorSymbol,
	child: SymbolShape,
): SymbolShape {
	return {
		...child,
		...localToWorld(symbol, child.x, child.y),
		rotation: child.rotation + symbol.rotation,
	};
}

export function replaceSymbolChild(
	symbol: EditorSymbol,
	key: string,
	child: SymbolShape,
): EditorSymbol {
	const original = symbolChildren(symbol).find(
		(item) => item.key === key,
	)?.shape;
	if (!original || child.kind !== original.kind) return symbol;
	if (
		boxBorder(symbol)?.key === key &&
		child.width === original.width &&
		child.height === original.height
	) {
		const dx = child.x - original.x;
		const dy = child.y - original.y;
		if (dx || dy) {
			symbol = { ...symbol, ...localToWorld(symbol, dx, dy) };
			child = { ...child, x: original.x, y: original.y };
		}
	}
	const { id: _id, kind: _kind, ...values } = child;
	if (
		key.startsWith("attribute:") &&
		child.kind === "text" &&
		original.kind === "text"
	) {
		const attribute = key.slice(10) as SymbolText["attribute"];
		const { x, y, text, horizontalAlign, verticalAlign, ...appearance } =
			values as Omit<TextShape, "id" | "kind">;
		const changes = Object.fromEntries(
			Object.entries(appearance).filter(
				([field, value]) => value !== original[field as keyof TextShape],
			),
		);
		return {
			...symbol,
			...(text === original.text
				? {}
				: { attributes: { ...symbol.attributes, [attribute]: text } }),
			textPositions: { ...symbol.textPositions, [attribute]: { x, y } },
			...(horizontalAlign === original.horizontalAlign &&
			verticalAlign === original.verticalAlign
				? {}
				: {
						textAlignments: {
							...symbol.textAlignments,
							[attribute]: { horizontalAlign, verticalAlign },
						},
					}),
			...(Object.keys(changes).length
				? {
						childOverrides: {
							...symbol.childOverrides,
							[key]: { ...symbol.childOverrides?.[key], ...changes },
						},
					}
				: {}),
		};
	}

	const changes = Object.fromEntries(
		Object.entries(values).filter(
			([field, value]) => value !== original[field as keyof SymbolShape],
		),
	);
	return fitBoxToBorder({
		...symbol,
		childOverrides: {
			...symbol.childOverrides,
			[key]: { ...symbol.childOverrides?.[key], ...changes },
		},
	});
}

export function symbolTextPosition(
	symbol: EditorSymbol,
	label: SymbolText,
): Point {
	return symbol.textPositions?.[label.attribute] ?? label;
}

const resolvedChildren = new WeakMap<EditorSymbol, readonly SymbolShape[]>();

export function symbolShapes(symbol: EditorSymbol): readonly SymbolShape[] {
	const cached = resolvedChildren.get(symbol);
	if (cached) return cached;
	const resolved = Object.freeze(
		resolveSymbolShapes(symbol).map((child) => Object.freeze(child)),
	);
	resolvedChildren.set(symbol, resolved);
	return resolved;
}

function resolveSymbolShapes(symbol: EditorSymbol): SymbolShape[] {
	return symbol.children.map((original) => {
		const child = {
			...original,
			...symbol.childOverrides?.[`shape:${original.id}`],
		} as SymbolShape;
		return {
			...child,
			...(symbol.locked ? { locked: true } : {}),
			...localToWorld(symbol, child.x, child.y),
			rotation: child.rotation + symbol.rotation,
		};
	});
}

const resolvedTexts = new WeakMap<EditorSymbol, readonly TextShape[]>();

export function symbolTextShapes(symbol: EditorSymbol): readonly TextShape[] {
	const cached = resolvedTexts.get(symbol);
	if (cached) return cached;
	const resolved = Object.freeze(
		resolveSymbolTextShapes(symbol).map((text) => Object.freeze(text)),
	);
	resolvedTexts.set(symbol, resolved);
	return resolved;
}

function resolveSymbolTextShapes(symbol: EditorSymbol): TextShape[] {
	return symbol.texts.flatMap((label, index) => {
		const override = symbol.childOverrides?.[`attribute:${label.attribute}`];
		const fontSize = override?.fontSize ?? label.fontSize;
		const text = symbol.attributes[label.attribute];
		if (!text) return [];
		const position = symbolTextPosition(symbol, label);
		const lines = text
			.replace(/\r\n?/g, "\n")
			.replace(/\t/g, "    ")
			.split("\n");
		const width = Math.max(
			fontSize / 2,
			...lines.map((line) => line.length * fontSize * 0.6),
		);
		return [
			{
				id: index,
				kind: "text",
				...((override?.locked ?? label.locked) === undefined
					? {}
					: { locked: override?.locked ?? label.locked }),
				...localToWorld(symbol, position.x, position.y),
				width,
				height: lines.length * fontSize * 1.5,
				rotation: symbol.rotation + (override?.rotation ?? 0),
				lineWidth: 0,
				fontSize: fontSize,
				horizontalAlign:
					symbol.textAlignments?.[label.attribute]?.horizontalAlign ??
					label.horizontalAlign,
				verticalAlign:
					symbol.textAlignments?.[label.attribute]?.verticalAlign ??
					label.verticalAlign,
				text,
			},
		];
	});
}
