import { type ElectricalNet, electricalNets } from "#/drawing/named-nets.ts";
import { pageKey } from "#/drawing/pages.ts";
import type { EditorShape, EditorSymbol } from "#/drawing/schema.ts";

export interface ErcSchematic {
	readonly shapes: readonly EditorShape[];
	readonly nets: readonly ElectricalNet[];
	readonly pages: ReadonlyMap<number, readonly EditorShape[]>;
}

export function schematicErcInput(
	shapes: readonly EditorShape[],
): ErcSchematic {
	const pages = new Map<number, EditorShape[]>();
	for (const shape of shapes) {
		const page = pageKey(shape);
		const list = pages.get(page);
		if (list) list.push(shape);
		else pages.set(page, [shape]);
	}
	return { shapes, nets: electricalNets(shapes), pages };
}

export const isComponentSymbol = (shape: EditorShape): shape is EditorSymbol =>
	shape.kind === "symbol" &&
	!shape.netSymbol &&
	shape.children.some((child) => child.kind === "pin");

export const isAnnotated = (reference: string) =>
	reference.trim().length > 0 && !reference.includes("?");

export function symbolUnitGroups(shapes: readonly EditorShape[]): {
	groups: EditorSymbol[][];
	duplicates: Map<EditorSymbol, EditorSymbol[]>;
} {
	const groups: EditorSymbol[][] = [];
	const byReference = new Map<string, EditorSymbol[]>();
	const duplicates = new Map<EditorSymbol, EditorSymbol[]>();
	for (const shape of shapes) {
		if (!isComponentSymbol(shape)) continue;
		const reference = shape.attributes.reference.trim();
		if (!isAnnotated(reference)) {
			groups.push([shape]);
			continue;
		}
		const group = byReference.get(reference);
		const unit = shape.kicad;
		if (!group) {
			const created = [shape];
			groups.push(created);
			byReference.set(reference, created);
		} else if (
			unit &&
			group.every(
				(member) =>
					member.kicad?.libraryId === unit.libraryId &&
					member.kicad.unit !== unit.unit,
			)
		)
			group.push(shape);
		else duplicates.set(shape, group);
	}
	return { groups, duplicates };
}
