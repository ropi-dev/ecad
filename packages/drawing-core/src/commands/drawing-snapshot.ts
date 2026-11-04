import { z } from "zod";
import { legacyDrawingShapeSchema, shapeId } from "#/drawing/schema.ts";

const historyId = z.number().int().nonnegative().safe();
const nodeSchema = z.strictObject({
	id: historyId,
	parentId: historyId.nullable(),
	childIds: z.array(historyId),
	preferredChildId: historyId.nullable(),
	label: z.string(),
	state: z.strictObject({ shapes: z.array(legacyDrawingShapeSchema) }),
});

export const drawingSnapshotSchema = z
	.strictObject({
		shapes: z.array(legacyDrawingShapeSchema),
		nextShapeId: shapeId,
		history: z.strictObject({
			nodes: z.record(z.string(), nodeSchema),
			currentId: historyId,
			nextId: historyId,
		}),
	})
	.superRefine((snapshot, context) => {
		const { nodes, currentId, nextId } = snapshot.history;
		const fail = () =>
			context.addIssue({
				code: "custom",
				message: "Invalid drawing history or shape ID allocation.",
			});
		if (!nodes[0] || nodes[0].parentId !== null || !nodes[currentId])
			return fail();
		const visited = new Set<number>();
		const pending = [0];
		while (pending.length) {
			const id = pending.pop();
			if (id === undefined) break;
			const node = nodes[id];
			if (!node || visited.has(id) || node.id !== id || id >= nextId)
				return fail();
			visited.add(id);
			if (
				node.preferredChildId !== null &&
				!node.childIds.includes(node.preferredChildId)
			)
				return fail();
			if (new Set(node.childIds).size !== node.childIds.length) return fail();
			for (const child of node.childIds) {
				if (nodes[child]?.parentId !== id) return fail();
				pending.push(child);
			}
			const ids = node.state.shapes.map((shape) => shape.id);
			if (
				new Set(ids).size !== ids.length ||
				ids.some((shapeId) => shapeId >= snapshot.nextShapeId)
			)
				return fail();
		}
		if (visited.size !== Object.keys(nodes).length) return fail();
		if (
			JSON.stringify(snapshot.shapes) !==
			JSON.stringify(nodes[currentId].state.shapes)
		)
			return fail();
	});
