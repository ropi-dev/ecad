import type { FootprintSource } from "@ecad/drawing-core/board/footprints.ts";
import {
	schematicFootprints,
	synchronizeBoard,
} from "@ecad/drawing-core/board/sync.ts";
import type { Circuit } from "@ecad/drawing-core/circuit/model.ts";
import { updateShapesEffect } from "@ecad/drawing-core/commands/drawing-commands.ts";
import {
	type createDrawingStore,
	DrawingStore,
} from "@ecad/drawing-core/commands/drawing-store.ts";
import type { FootprintReference } from "@ecad/drawing-core/footprint/reference.ts";
import { Effect, Either } from "effect";
import { toastManager } from "#/components/ui/toast.ts";
import type { FootprintFile } from "#/footprint/format.ts";
import { loadBuiltinFootprints } from "#/footprint/library.ts";
import type { ProjectSnapshot } from "#/projects/format.ts";
import { primaryPcbId } from "#/projects/pcb.ts";
import { projectIndex } from "#/projects/project-index.ts";

export interface BoardContext {
	circuit?: Circuit;
	/** Each circuit component's schematic footprint. */
	footprintOf(componentId: string): FootprintReference | undefined;
	projectFootprints: readonly FootprintFile[];
}

export function boardContext(
	snapshot: ProjectSnapshot | null | undefined,
	circuitId: string | undefined,
): BoardContext {
	if (!snapshot || !circuitId)
		return { footprintOf: () => undefined, projectFootprints: [] };
	const index = projectIndex(snapshot);
	const circuit = index.circuitsById.get(circuitId)?.file.circuit;
	const schematic =
		circuitId === primaryPcbId
			? snapshot.shapes
			: (index.drawingsByCircuit.get(circuitId)?.file.shapes ?? []);
	const footprintOf = schematicFootprints(schematic);
	const components = new Map(
		circuit?.components.map((component) => [component.id, component]),
	);
	return {
		circuit,
		footprintOf(componentId) {
			const component = components.get(componentId);
			return component && footprintOf(component);
		},
		projectFootprints: snapshot.footprints ?? [],
	};
}

async function footprintSources(projectFootprints: readonly FootprintFile[]) {
	const builtin = await loadBuiltinFootprints();
	return (reference: FootprintReference): FootprintSource | undefined => {
		const file =
			reference.library === "project"
				? projectFootprints.find((footprint) => footprint.id === reference.id)
				: builtin.byId.get(reference.id)?.file;
		return file
			? { reference, name: file.name, shapes: file.shapes }
			: undefined;
	};
}

export interface BoardSyncReport {
	placed: number;
	updated: number;
	removed: number;
	missing: string[];
	stale: number;
}

export function announceBoardSync(report: BoardSyncReport | null) {
	if (!report) return;
	const changes = [
		report.placed && `placed ${report.placed}`,
		report.updated && `updated ${report.updated}`,
		report.removed && `removed ${report.removed}`,
	].filter(Boolean);
	const warning = report.missing.length > 0 || report.stale > 0;
	if (!changes.length && !warning) return;
	toastManager.add({
		id: "board-sync",
		type: warning ? "warning" : "success",
		title: "Updated from schematic",
		description: [
			changes.length ? `Footprints ${changes.join(", ")}.` : "",
			report.missing.length
				? `No footprint for ${report.missing.slice(0, 8).join(", ")}${report.missing.length > 8 ? ` and ${report.missing.length - 8} more` : ""}.`
				: "",
			report.stale
				? `${report.stale} ${report.stale === 1 ? "track, via or zone is" : "tracks, vias or zones are"} on a net the circuit no longer has. Choose a net for them in Attributes.`
				: "",
		]
			.filter(Boolean)
			.join(" "),
	});
}

/**
 * Brings a board's store up to date with its circuit and schematic as one
 * undo step, "Update from schematic". Nothing is committed when the board
 * already matches.
 */
export async function synchronizeBoardStore(
	store: ReturnType<typeof createDrawingStore>,
	context: BoardContext,
): Promise<BoardSyncReport | null> {
	const { circuit } = context;
	if (!circuit) return null;
	const source = await footprintSources(context.projectFootprints);
	const current = store.getSnapshot();
	const result = synchronizeBoard({
		shapes: current.shapes,
		circuit,
		footprintOf: (component) => context.footprintOf(component.id),
		source,
		nextId: current.nextShapeId,
	});
	if (store.getSnapshot() !== current) return null;
	if (result.place.length || result.replace.length || result.remove.length) {
		const outcome = Effect.runSync(
			Effect.either(
				updateShapesEffect(
					{
						place: result.place.map(({ id: _id, ...shape }) => shape),
						replace: result.replace,
						remove: result.remove,
					},
					"Update from schematic",
				).pipe(Effect.provideService(DrawingStore, store)),
			),
		);
		if (Either.isLeft(outcome)) throw new Error(outcome.left.message);
	}
	return {
		placed: result.place.length,
		updated: result.replace.length,
		removed: result.remove.length,
		missing: result.missing,
		stale: result.stale,
	};
}
