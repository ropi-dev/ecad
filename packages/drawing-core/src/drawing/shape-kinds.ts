/** Kinds that accept `filled` and `lineStyle`. */
export const fillableShapeKinds = [
	"rectangle",
	"circle",
	"triangle",
	"no-connect",
] as const;

/** Every kind except `symbol`. Symbols may contain only these kinds. */
export const shapeKinds = [
	...fillableShapeKinds,
	"line",
	"wire",
	"pin",
	"text",
] as const;

export type FillableShapeKind = (typeof fillableShapeKinds)[number];
export type ShapeKind = (typeof shapeKinds)[number];

export const symbolAttributes = ["name", "reference", "value"] as const;
export type SymbolAttribute = (typeof symbolAttributes)[number];

export const electricalLabelRoles = ["net", "supply"] as const;
