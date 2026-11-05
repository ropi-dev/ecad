import type { LineStyle } from "@ecad/drawing-core/drawing/line-style.ts";
import {
	boxBorder,
	type EditorShape,
	type EditorSymbol,
	editShapeAttribute,
	isBasicShape,
	isUnsafeMove,
	moveShapes,
	normalizeNetSymbol,
	replaceSymbolChild,
	type ShapeAttribute,
	type SymbolChild,
	type SymbolLabelPosition,
	setSymbolLabelPosition,
	type TextShape,
	UNSAFE_MOVE_MESSAGE,
	withFullRouting,
} from "@ecad/drawing-core/drawing/shapes.ts";
import type { TextAlignment } from "@ecad/drawing-core/drawing/text-alignment.ts";
import type { LabelRole } from "#/drawing/placement.ts";
import { type MeasureText, updateText } from "#/drawing/text.ts";

/** One change made in the Attributes panel. */
export type SelectionEdit =
	| {
			readonly kind: "attribute";
			readonly attribute: ShapeAttribute;
			readonly value: number;
	  }
	| { readonly kind: "line-style"; readonly lineStyle: LineStyle }
	| { readonly kind: "lock"; readonly locked: boolean }
	| { readonly kind: "text"; readonly text: string }
	| { readonly kind: "text-alignment"; readonly alignment: TextAlignment }
	| { readonly kind: "label-role"; readonly role: LabelRole | undefined }
	| {
			readonly kind: "pin";
			readonly attribute: "showName" | "showNumber";
			readonly value: boolean;
	  }
	| {
			readonly kind: "pin";
			readonly attribute: "name" | "number";
			readonly value: string;
	  }
	| {
			readonly kind: "symbol-attribute";
			readonly attribute: keyof EditorSymbol["attributes"];
			readonly value: string;
	  }
	| { readonly kind: "net-symbol"; readonly netSymbol: boolean }
	| {
			readonly kind: "symbol-label-position";
			readonly position: SymbolLabelPosition;
	  };

export interface SelectionEditContext {
	/** The selected top-level shapes. */
	readonly selection: EditorShape[];
	/** A selected symbol child. Edits that apply to a child change it instead. */
	readonly child?: {
		readonly symbol: EditorSymbol;
		readonly child: SymbolChild;
	};
	/** Every shape in the drawing, so position edits keep wires attached. */
	readonly shapes: EditorShape[];
	readonly nextId: number;
	readonly allowLocked: boolean;
	readonly measureText: MeasureText;
}

export interface SelectionEditResult {
	readonly replacements: EditorShape[];
	/** The history label. */
	readonly label: string;
	/** Why the edit was refused; nothing is replaced. */
	readonly error?: string;
}

/** Changing a label away from a net drops its link to a circuit net. */
export function changeLabelRole(
	label: TextShape,
	role: LabelRole | undefined,
): TextShape {
	return {
		...label,
		electrical: role,
		...(role === "net" ? {} : { circuitNet: undefined }),
	};
}

/**
 * Basic shapes take the style directly. A box symbol applies it to its border
 * rectangle. Other shapes have no line style and are left out.
 */
export function applyLineStyle(
	shape: EditorShape,
	lineStyle: LineStyle,
): EditorShape[] {
	if (isBasicShape(shape)) return [{ ...shape, lineStyle }];
	const border = shape.kind === "symbol" ? boxBorder(shape) : undefined;
	return border && shape.kind === "symbol"
		? [replaceSymbolChild(shape, border.key, { ...border.shape, lineStyle })]
		: [];
}

const attributeLabels: Partial<Record<ShapeAttribute, string>> = {
	lineWidth: "line width",
	fontSize: "font size",
};

/**
 * The replacements and history label for an Attributes panel edit, or
 * `undefined` when the edit does not apply to the selection.
 */
export function applySelectionEdit(
	edit: SelectionEdit,
	context: SelectionEditContext,
): SelectionEditResult | undefined {
	if (context.child) {
		const { symbol, child } = context.child;
		const edited = editSymbolChild(edit, child.shape, context.measureText);
		if (edited !== null) {
			if (!edited || edited.kind === "symbol") return undefined;
			return {
				replacements: [replaceSymbolChild(symbol, child.key, edited)],
				label: "Edit symbol child",
			};
		}
	}
	const { selection } = context;
	const single = selection.length === 1 ? selection[0] : undefined;
	switch (edit.kind) {
		case "attribute": {
			const { attribute, value } = edit;
			if (!Number.isFinite(value)) return undefined;
			if (attribute === "x" || attribute === "y") {
				const moved = withFullRouting(() =>
					moveShapes(
						selection,
						{
							x: attribute === "x" ? value - selection[0].x : 0,
							y: attribute === "y" ? value - selection[0].y : 0,
						},
						0,
						selection[0],
						context.shapes,
						context.nextId,
						context.allowLocked,
					),
				);
				// Refuse a position whose wires could only reach it through other nets.
				if (isUnsafeMove(moved))
					return {
						replacements: [],
						label: "",
						error: UNSAFE_MOVE_MESSAGE,
					};
				return {
					replacements: moved,
					label: `Change ${attributeLabels[attribute] ?? attribute}`,
				};
			}
			return {
				replacements: selection.map((shape) =>
					editShapeAttribute(shape, attribute, value),
				),
				label: `Change ${attributeLabels[attribute] ?? attribute}`,
			};
		}
		case "line-style":
			return {
				replacements: selection.flatMap((shape) =>
					applyLineStyle(shape, edit.lineStyle),
				),
				label: "Change line style",
			};
		case "lock":
			return {
				replacements: selection.map((shape) => ({
					...shape,
					locked: edit.locked,
				})),
				label: edit.locked ? "Lock selection" : "Unlock selection",
			};
		case "text":
			return single?.kind === "text"
				? {
						replacements: [updateText(single, edit.text, context.measureText)],
						label: "Edit text",
					}
				: undefined;
		case "text-alignment":
			return {
				replacements: selection
					.filter((shape) => shape.kind === "text")
					.map((shape) => ({ ...shape, ...edit.alignment })),
				label: "Align text",
			};
		case "label-role":
			return single?.kind === "text"
				? {
						replacements: [changeLabelRole(single, edit.role)],
						label: "Change label role",
					}
				: undefined;
		case "pin":
			return single?.kind === "pin"
				? {
						replacements: [{ ...single, [edit.attribute]: edit.value }],
						label: `Change pin ${edit.attribute}`,
					}
				: undefined;
		case "symbol-attribute":
			return {
				replacements: selection.map((shape) =>
					shape.kind === "symbol"
						? {
								...shape,
								attributes: {
									...shape.attributes,
									[edit.attribute]: edit.value,
								},
							}
						: shape,
				),
				label: `Change symbol ${edit.attribute}`,
			};
		case "net-symbol":
			return {
				replacements: selection
					.filter((shape) => shape.kind === "symbol")
					.map((shape) =>
						normalizeNetSymbol({ ...shape, netSymbol: edit.netSymbol }),
					),
				label: "Change net symbol",
			};
		case "symbol-label-position":
			return {
				replacements: selection
					.filter((shape) => shape.kind === "symbol")
					.map((shape) => setSymbolLabelPosition(shape, "name", edit.position)),
				label: "Position label",
			};
	}
}

/**
 * The edited child, `undefined` when the edit does not fit the child, or
 * `null` when the edit belongs to the parent symbol instead.
 */
function editSymbolChild(
	edit: SelectionEdit,
	shape: SymbolChild["shape"],
	measureText: MeasureText,
): EditorShape | undefined | null {
	switch (edit.kind) {
		case "attribute":
			return editShapeAttribute(shape, edit.attribute, edit.value);
		case "line-style":
			return isBasicShape(shape)
				? { ...shape, lineStyle: edit.lineStyle }
				: undefined;
		case "lock":
			return { ...shape, locked: edit.locked };
		case "text":
			return shape.kind === "text"
				? updateText(shape, edit.text, measureText)
				: undefined;
		case "text-alignment":
			return shape.kind === "text"
				? { ...shape, ...edit.alignment }
				: undefined;
		case "pin":
			return shape.kind === "pin"
				? { ...shape, [edit.attribute]: edit.value }
				: undefined;
		default:
			return null;
	}
}
