import {
	drawShape,
	type EditorShape,
	type TextShape,
} from "@ecad/drawing-core/drawing/shapes.ts";
import type { Point } from "@ecad/drawing-core/drawing/types.ts";
import { NET_LABEL_SIZE } from "@ecad/drawing-core/drawing/units.ts";
import {
	createTextShape,
	type MeasureText,
	updateText,
} from "#/drawing/text.ts";

/** Tools that place one item per click instead of dragging out a shape. */
export type PlacementTool = "pin" | "no-connect" | "text" | "net" | "supply";
export type LabelRole = "net" | "supply";

const placementTools: ReadonlySet<string> = new Set<PlacementTool>([
	"pin",
	"no-connect",
	"text",
	"net",
	"supply",
]);

export const isPlacementTool = (tool: string): tool is PlacementTool =>
	placementTools.has(tool);

/** The net name a new label starts with, before the user edits it. */
export const defaultLabelText = (role: LabelRole) =>
	role === "supply" ? "GND" : "NET";

/**
 * Labels and no-connect markers attach to a nearby wire end or pin. Pins and
 * plain text stay at the snapped pointer.
 */
export const placementSnapsToConnection = (tool: PlacementTool) =>
	tool === "net" || tool === "supply" || tool === "no-connect";

/** A net or supply label whose electrical anchor sits at `anchor`. */
export function createLabelShape(
	id: number,
	anchor: Point,
	role: LabelRole,
	measureText: MeasureText,
): TextShape {
	return updateText(
		{
			...createTextShape(id, anchor, measureText),
			electrical: role,
			...(role === "net" ? { fontSize: NET_LABEL_SIZE } : {}),
			horizontalAlign: "left",
			verticalAlign: "bottom",
		},
		defaultLabelText(role),
		measureText,
	);
}

/** The item a placement tool creates, for both the hover guide and the click. */
export function createPlacementShape(
	tool: PlacementTool,
	id: number,
	anchor: Point,
	measureText: MeasureText,
): EditorShape {
	if (tool === "pin" || tool === "no-connect")
		return drawShape(id, tool, anchor, anchor);
	if (tool === "text") return createTextShape(id, anchor, measureText);
	return createLabelShape(id, anchor, tool, measureText);
}

/** The history label for a click with a placement tool. */
export function placementLabel(tool: PlacementTool) {
	switch (tool) {
		case "text":
			return "Draw text";
		case "pin":
			return "Place pin";
		case "no-connect":
			return "Place no connect";
		default:
			return "Place net label";
	}
}
