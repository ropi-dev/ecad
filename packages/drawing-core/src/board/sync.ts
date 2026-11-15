import { boardOutlineSegments, outlineBounds } from "#/board/drc.ts";
import {
	type BoardFootprint,
	createBoardFootprint,
	type FootprintSource,
	isBoardFootprint,
	replaceBoardFootprintSource,
} from "#/board/footprints.ts";
import type { Circuit, CircuitComponent } from "#/circuit/model.ts";
import type { EditorShape } from "#/drawing/schema.ts";
import { mergeBounds, shapeBounds } from "#/drawing/shape-geometry.ts";
import { symbolShapes } from "#/drawing/symbol-instances.ts";
import {
	type FootprintReference,
	sameFootprint,
} from "#/footprint/reference.ts";

export interface BoardSyncInput {
	shapes: readonly EditorShape[];
	circuit: Circuit;
	footprintOf(component: CircuitComponent): FootprintReference | undefined;
	source(reference: FootprintReference): FootprintSource | undefined;
	nextId: number;
}

export interface BoardSyncResult {
	place: EditorShape[];
	replace: EditorShape[];
	remove: number[];
	/** Components without a footprint, or whose footprint is not available. */
	missing: { reference: string; footprint?: FootprintReference }[];
}

const naturalOrder = new Intl.Collator("en", { numeric: true }).compare;
const gap = 1.5;

/**
 * Brings a board up to date with its circuit: places a footprint for each new
 * component, swaps footprints the schematic changed, updates references and
 * values, and removes footprints whose component is gone. Placed footprints
 * keep their position, rotation and side. A footprint whose component has
 * another footprint loses its component instead of being removed.
 */
export function synchronizeBoard(input: BoardSyncInput): BoardSyncResult {
	const result: BoardSyncResult = {
		place: [],
		replace: [],
		remove: [],
		missing: [],
	};
	const placed = new Map<string, BoardFootprint>();
	for (const shape of input.shapes)
		if (isBoardFootprint(shape) && shape.component) {
			if (placed.has(shape.component)) {
				const { component: _component, ...detached } = shape;
				result.replace.push(detached);
			} else placed.set(shape.component, shape);
		}
	const components = new Map(
		input.circuit.components.map((component) => [component.id, component]),
	);
	for (const [id, footprint] of placed)
		if (!components.has(id)) result.remove.push(footprint.id);
	const added: { component: CircuitComponent; source: FootprintSource }[] = [];
	for (const component of input.circuit.components) {
		const reference = input.footprintOf(component);
		const source = reference ? input.source(reference) : undefined;
		const existing = placed.get(component.id);
		if (!reference || !source) {
			result.missing.push({
				reference: component.reference,
				...(reference ? { footprint: reference } : {}),
			});
			continue;
		}
		if (!existing) {
			added.push({ component, source });
			continue;
		}
		let next: BoardFootprint = existing;
		if (!sameFootprint(existing.footprint, reference))
			next = replaceBoardFootprintSource(existing, source);
		if (
			next.attributes.reference !== component.reference ||
			next.attributes.value !== component.value
		)
			next = {
				...next,
				attributes: {
					...next.attributes,
					reference: component.reference,
					value: component.value,
				},
			};
		if (next !== existing) result.replace.push(next);
	}
	if (!added.length) return result;
	added.sort((a, b) =>
		naturalOrder(a.component.reference, b.component.reference),
	);
	const kept = input.shapes.filter(
		(shape) => !result.remove.includes(shape.id),
	);
	const outline = outlineBounds(boardOutlineSegments(kept));
	const startX = outline ? outline.maxX + 5 : 0;
	let x = startX;
	let y = outline ? outline.maxY : 0;
	let rowHeight = 0;
	const rowWidth = Math.max(60, outline ? outline.maxX - outline.minX : 60);
	let id = input.nextId;
	const snap = (value: number) => Math.round(value / 0.05) * 0.05;
	for (const { component, source } of added) {
		const footprint = createBoardFootprint(
			id++,
			source,
			{
				component: component.id,
				reference: component.reference,
				value: component.value,
			},
			{ x: 0, y: 0 },
		);
		const local = mergeBounds(symbolShapes(footprint).map(shapeBounds));
		const width = local.maxX - local.minX;
		const height = local.maxY - local.minY + 2;
		if (x > startX && x + width > startX + rowWidth) {
			x = startX;
			y -= rowHeight + gap;
			rowHeight = 0;
		}
		result.place.push({
			...footprint,
			x: snap(x - local.minX),
			y: snap(y - local.maxY - 2),
		});
		x += width + gap;
		rowHeight = Math.max(rowHeight, height);
	}
	return result;
}
