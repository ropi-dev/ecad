import type { CircuitFile } from "@ecad/drawing-core/circuit/model.ts";
import type { SymbolFile } from "#/components/editor/symbolFormat.ts";
import type { FootprintFile } from "#/footprint/format.ts";
import type { ProjectDrawing, ProjectSnapshot } from "#/projects/format.ts";

interface Entry<File> {
	file: File;
	path: string | undefined;
}
const indexes = new WeakMap<
	ProjectSnapshot,
	ReturnType<typeof createProjectIndex>
>();
export function projectIndex(snapshot: ProjectSnapshot) {
	let index = indexes.get(snapshot);
	if (!index) {
		index = createProjectIndex(snapshot);
		indexes.set(snapshot, index);
	}
	return index;
}
export function createProjectIndex(snapshot: ProjectSnapshot) {
	const symbolsById = new Map<string, Entry<SymbolFile>>();
	const symbolsByPath = new Map<string, SymbolFile>();
	const drawingsById = new Map<string, Entry<ProjectDrawing>>();
	const drawingsByPath = new Map<string, ProjectDrawing>();
	const drawingsByCircuit = new Map<string, Entry<ProjectDrawing>>();
	const circuitsById = new Map<string, Entry<CircuitFile>>();
	const circuitsByPath = new Map<string, CircuitFile>();
	const footprintsById = new Map<string, Entry<FootprintFile>>();
	const footprintsByPath = new Map<string, FootprintFile>();
	for (const [i, file] of (snapshot.footprints ?? []).entries()) {
		const path = snapshot.manifest.footprints?.[i];
		footprintsById.set(file.id, { file, path });
		if (path) footprintsByPath.set(path, file);
	}
	for (const [i, file] of snapshot.symbols.entries()) {
		const path = snapshot.manifest.symbols[i];
		symbolsById.set(file.id, { file, path });
		if (path) symbolsByPath.set(path, file);
	}
	for (const [i, file] of (snapshot.drawings ?? []).entries()) {
		const path = snapshot.manifest.drawings?.[i];
		const entry = { file, path };
		drawingsById.set(file.id, entry);
		if (path) drawingsByPath.set(path, file);
		if (file.circuitId && !drawingsByCircuit.has(file.circuitId))
			drawingsByCircuit.set(file.circuitId, entry);
	}
	for (const [i, file] of (snapshot.circuits ?? []).entries()) {
		const path = snapshot.manifest.circuits?.[i]?.circuit;
		circuitsById.set(file.circuit.id, { file, path });
		if (path) circuitsByPath.set(path, file);
	}
	return {
		symbolsById,
		symbolsByPath,
		drawingsById,
		drawingsByPath,
		drawingsByCircuit,
		circuitsById,
		circuitsByPath,
		footprintsById,
		footprintsByPath,
	};
}
