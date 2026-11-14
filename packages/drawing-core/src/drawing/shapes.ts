export {
	connectTransformedTerminals,
	isUnsafeMove,
	moveShapes,
	prepareMove,
	snappedMoveDelta,
	UNSAFE_MOVE_MESSAGE,
	withFullRouting,
} from "#/drawing/connected-wire-transforms.ts";
export { connectionTolerance } from "#/drawing/connection-geometry.ts";
export { normalizeNetSymbol } from "#/drawing/net-symbol.ts";
export type {
	BasicShape,
	EditorShape,
	EditorSymbol,
	FillableShape,
	LineShape,
	PinShape,
	PrimitiveShape,
	SymbolChildOverride,
	SymbolShape,
	SymbolText,
	TextShape,
	WireShape,
} from "#/drawing/schema.ts";
export {
	editShapeAttribute,
	moveSymbolChild,
	type ResizeHandle,
	resizeHandles,
	resizeShape,
	resizeSymbolChild,
	type ShapeAttribute,
} from "#/drawing/shape-editing.ts";
export {
	constrainWireEndpoint,
	drawShape,
	expandBounds,
	mergeBounds,
	pinLeadShape,
	shapeBounds,
	shapeCenter,
	snapCoordinate,
	snapPoint,
} from "#/drawing/shape-geometry.ts";
export type { ShapeKind } from "#/drawing/shape-kinds.ts";
export {
	containsSelection,
	hitShape,
	insideHollowBoardShape,
	intersectsSelection,
	selectionSize,
	shapeAt,
	symbolChildAt,
	symbolSelectionFrame,
} from "#/drawing/shape-selection.ts";
export {
	A3,
	canSelectShape,
	DEFAULT_LINE_WIDTH,
	isBasicShape,
	isBoxSymbol,
	isFillableShape,
	PIN_RADIUS,
	type SymbolChild,
} from "#/drawing/shape-types.ts";
export {
	boxBorder,
	boxText,
	canInspectSymbolChild,
	canSelectSymbolChild,
	fitBoxToBorder,
	replaceSymbolChild,
	symbolChildren,
	symbolChildWorld,
	symbolShapes,
	symbolTextPosition,
	symbolTextShapes,
} from "#/drawing/symbol-instances.ts";
export {
	moveSymbolText,
	resetSymbolText,
	type SymbolLabelPosition,
	setSymbolLabelPosition,
	symbolLabelAnchor,
	symbolLabelPosition,
	symbolTextMoved,
} from "#/drawing/symbol-labels.ts";
export { cutWiresUnderSymbols } from "#/drawing/symbol-wire-cuts.ts";
export {
	findWireConnection,
	netLabelAnchors,
	openPins,
	openWireEnds,
	pinTerminals,
	routeWire,
	wireConnectionPoints,
	wireJunctions,
} from "#/drawing/terminals.ts";
export { normalizeWireSegments } from "#/drawing/wire-normalization.ts";
