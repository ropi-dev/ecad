import { measurePerformanceAsync } from "#/performance/runtime.ts";
import { projectNameSchema } from "#/projects/format.ts";
import type { ProjectContextValue } from "#/projects/ProjectSession.ts";
import type { createProjectAutosave } from "#/projects/project-autosave.ts";
import { projectIndex } from "#/projects/project-index.ts";
import type { ProjectSessionState } from "#/projects/project-session-state.ts";

type FileActions = Pick<
	ProjectContextValue,
	| "importCircuit"
	| "createCircuit"
	| "createDrawing"
	| "importSchematic"
	| "createSymbol"
>;

/**
 * Adds circuits, drawings, KiCad schematics and symbols to the project. Each
 * action runs in the session queue, belongs to the project generation
 * (`epoch`) it was created for, and returns the new file's path.
 */
export function createProjectFileActions(
	state: ProjectSessionState,
	persist: ReturnType<typeof createProjectAutosave>["persist"],
) {
	const { enqueue } = state;
	return (epoch: number): FileActions => ({
		importCircuit: (file) =>
			enqueue(async () => {
				if (!state.active || state.generation !== epoch)
					throw new Error("Open a project before importing a circuit.");
				if (
					state.active.circuits?.some(
						(entry) => entry.circuit.id === file.circuit.id,
					)
				)
					throw new Error(
						"This circuit is already in the project. Open its existing file instead.",
					);
				await persist(undefined, undefined, undefined, [
					...(state.active.circuits ?? []),
					file,
				]);
				const path = projectIndex(state.active).circuitsById.get(
					file.circuit.id,
				)?.path;
				if (!path) throw new Error("Unable to open imported circuit.");
				return path;
			}),
		createCircuit: (name) =>
			enqueue(async () => {
				if (!state.active || state.generation !== epoch)
					throw new Error("Open a project before creating a circuit.");
				const parsed = projectNameSchema.parse(name);
				const { createCircuit } = await import(
					"@ecad/drawing-core/circuit/model.ts"
				);
				const { uniquePcbName } = await import("#/projects/pcb.ts");
				const file = createCircuit(
					uniquePcbName(parsed, state.active, state.active.manifest.name),
				);
				await persist(undefined, undefined, undefined, [
					...(state.active.circuits ?? []),
					file,
				]);
				const path = projectIndex(state.active).circuitsById.get(
					file.circuit.id,
				)?.path;
				if (!path) throw new Error("Unable to open the new circuit file.");
				return path;
			}),
		createDrawing: (name) =>
			enqueue(async () => {
				if (!state.active || state.generation !== epoch)
					throw new Error("Open a project before creating a drawing.");
				return measurePerformanceAsync("project.create-drawing", async () => {
					const parsedName = projectNameSchema.safeParse(name);
					if (!parsedName.success)
						throw new Error(
							"Use a valid drawing name without slashes or reserved filename characters.",
						);
					name = parsedName.data;
					const drawings = state.active?.drawings ?? [];
					const stem =
						name
							.normalize("NFKD")
							.toLowerCase()
							.replace(/[^a-z0-9]+/g, "-")
							.replace(/^-|-$/g, "") || "drawing";
					const base = projectNameSchema.safeParse(stem).success
						? stem
						: `drawing-${stem}`;
					let id = base;
					for (
						let suffix = 2;
						drawings.some((drawing) => drawing.id === id);
						suffix++
					)
						id = `${base}-${suffix}`;
					const { uniquePcbName } = await import("#/projects/pcb.ts");
					const current = state.active;
					if (!current)
						throw new Error("Open a project before creating a drawing.");
					name = uniquePcbName(name, current, current.manifest.name);
					await persist(undefined, undefined, [
						...drawings,
						{ id, name, shapes: [] },
					]);
					const snapshot = state.active;
					const path = snapshot
						? projectIndex(snapshot).drawingsById.get(id)?.path
						: undefined;
					if (!path) throw new Error("Unable to open the new drawing file.");
					return path;
				});
			}),
		importSchematic: (file) =>
			enqueue(async () => {
				if (!state.active || state.generation !== epoch)
					throw new Error("Open a project before importing a schematic.");
				const { parseKiCadFile } = await import("#/formats/parseKiCadFile.ts");
				const result = await measurePerformanceAsync("import.kicad", () =>
					parseKiCadFile(file),
				);
				// Parsing now waits on a worker, so recheck the project it targets.
				if (!state.active || state.generation !== epoch)
					throw new Error(
						"The project changed while the schematic was importing.",
					);
				const drawings = state.active.drawings ?? [];
				let id = "kicad-import";
				for (
					let suffix = 2;
					drawings.some((drawing) => drawing.id === id);
					suffix++
				)
					id = `kicad-import-${suffix}`;
				const name = file.name.replace(/\.kicad_sch$/i, "");
				await persist(undefined, undefined, [
					...drawings,
					{ id, name: projectNameSchema.parse(name), shapes: result.shapes },
				]);
				const path = state.active
					? projectIndex(state.active).drawingsById.get(id)?.path
					: undefined;
				if (!path) throw new Error("Unable to open imported drawing.");
				return { path, report: result.report };
			}),

		createSymbol: (name) =>
			enqueue(async () => {
				if (!state.active || state.generation !== epoch)
					throw new Error("Open a project before creating a symbol.");
				return measurePerformanceAsync("project.create-symbol", async () => {
					const { createEmptySymbolFile } = await import(
						"#/components/editor/symbolFormat.ts"
					);
					const symbol = createEmptySymbolFile(name, state.symbols);
					await persist([...state.symbols, symbol]);
					const snapshot = state.active;
					const path = snapshot
						? projectIndex(snapshot).symbolsById.get(symbol.id)?.path
						: undefined;
					if (!path) throw new Error("Unable to open the new symbol file.");
					return path;
				});
			}),
	});
}
