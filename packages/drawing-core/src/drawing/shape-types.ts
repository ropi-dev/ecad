import type {
	BasicShape,
	EditorShape,
	EditorSymbol,
	FillableShape,
	SymbolShape,
} from "#/drawing/schema.ts";
import { fillableShapeKinds, type ShapeKind } from "#/drawing/shape-kinds.ts";
import { CONNECTION_RADIUS, DEFAULT_STROKE_WIDTH } from "#/drawing/units.ts";

export const A3 = { width: 420, height: 297 } as const;

export const PIN_RADIUS = CONNECTION_RADIUS;

export const DEFAULT_LINE_WIDTH = DEFAULT_STROKE_WIDTH;

export interface SymbolChild {
	key: string;
	shape: SymbolShape;
}

export function isBoxSymbol(
	shape: EditorShape,
): shape is EditorSymbol & { definitionId: "box" } {
	return (
		shape.kind === "symbol" &&
		shape.definitionId === "box" &&
		(!shape.library ||
			(shape.library.scope === "user" && shape.library.id === "builtin"))
	);
}

export function canSelectShape(
	shape: EditorShape,
	allowLocked = false,
): boolean {
	return allowLocked || !shape.locked;
}

const basicShapeKinds: ReadonlySet<EditorShape["kind"]> = new Set<ShapeKind>([
	...fillableShapeKinds,
	"line",
]);

export function isBasicShape(shape: EditorShape): shape is BasicShape {
	return basicShapeKinds.has(shape.kind);
}

const fillableKinds: ReadonlySet<EditorShape["kind"]> = new Set(
	fillableShapeKinds,
);

export function isFillableShape(shape: EditorShape): shape is FillableShape {
	return fillableKinds.has(shape.kind);
}
