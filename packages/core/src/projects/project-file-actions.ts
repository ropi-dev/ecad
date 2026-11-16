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
	| "saveSymbolAttributes"
	| "createFootprint"
	| "saveFootprintModel"
	| "importExample"
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

		importExample: (example) =>
			enqueue(async () => {
				if (!state.active || state.generation !== epoch)
					throw new Error("Open a project before adding an example.");
				const [
					{ exampleDesigns },
					{ uniquePcbName },
					format,
					{ savedDrawingShapesSchema },
					{ sheetSettingsSchema },
				] = await Promise.all([
					import("#/examples/designs.ts"),
					import("#/projects/pcb.ts"),
					import("#/board/format.ts"),
					import("@ecad/drawing-core/drawing/schema.ts"),
					import("@ecad/drawing-core/drawing/sheet.ts"),
				]);
				const design = await exampleDesigns[example].load();
				const current = state.active;
				if (!current || state.generation !== epoch)
					throw new Error("The project changed while the example was loading.");
				const circuits = current.circuits ?? [];
				const drawings = current.drawings ?? [];
				let circuitId = design.circuit.id;
				for (
					let suffix = 2;
					circuits.some((file) => file.circuit.id === circuitId);
					suffix++
				)
					circuitId = `${design.circuit.id}-${suffix}`;
				let drawingId: string = example;
				for (
					let suffix = 2;
					drawings.some((drawing) => drawing.id === drawingId);
					suffix++
				)
					drawingId = `${example}-${suffix}`;
				const name = uniquePcbName(design.name, current, current.manifest.name);
				const board = format.boardFileSchema.parse({
					...format.createBoardFile(name, circuitId),
					rules: design.rules,
					shapes: design.board,
				});
				await persist(
					undefined,
					undefined,
					[
						...drawings,
						{
							id: drawingId,
							name,
							circuitId,
							shapes: savedDrawingShapesSchema.parse(design.schematic),
							...(design.sheet
								? { sheet: sheetSettingsSchema.parse(design.sheet) }
								: {}),
						},
					],
					[
						...circuits,
						{
							circuit: { ...design.circuit, id: circuitId, name },
							graph: {
								format: "ecad-circuit-graph",
								version: 1,
								circuitId,
								positions: [],
							},
						},
					],
					undefined,
					[...(current.boards ?? []), board],
				);
				const path = state.active
					? projectIndex(state.active).boardsByCircuit.get(circuitId)?.path
					: undefined;
				if (!path) throw new Error("Unable to open the example board.");
				return path;
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

		saveSymbolAttributes: (id, attributes) =>
			enqueue(async () => {
				if (!state.active || state.generation !== epoch)
					throw new Error("Open a project before editing a symbol.");
				const { parseSymbolFile } = await import(
					"#/components/editor/symbolFormat.ts"
				);
				const current = state.symbols.find((symbol) => symbol.id === id);
				if (!current)
					throw new Error("This symbol is no longer in the project.");
				const { attributes: _attributes, ...rest } = current;
				const file = parseSymbolFile(
					JSON.stringify(
						Object.keys(attributes).length ? { ...rest, attributes } : rest,
					),
				);
				await persist(
					state.symbols.map((symbol) => (symbol.id === id ? file : symbol)),
				);
				const document = state.symbolDocuments.get(id);
				if (!document) return;
				const replaced = { ...document, file };
				state.symbolDocuments.set(id, replaced);
				if (state.editorSymbol === document) state.setEditorSymbol(replaced);
			}),

		createFootprint: (name, from) =>
			enqueue(async () => {
				if (!state.active || state.generation !== epoch)
					throw new Error("Open a project before creating a footprint.");
				return measurePerformanceAsync("project.create-footprint", async () => {
					const { createEmptyFootprintFile, footprintFileWithShapes } =
						await import("#/footprint/format.ts");
					const footprints = state.active?.footprints ?? [];
					const empty = createEmptyFootprintFile(name, footprints);
					const footprint = from
						? footprintFileWithShapes(
								{
									...empty,
									description: from.description,
									...(from.model ? { model: { ...from.model } } : {}),
								},
								structuredClone([...from.shapes]),
							)
						: empty;
					await persist(undefined, undefined, undefined, undefined, [
						...footprints,
						footprint,
					]);
					const snapshot = state.active;
					const path = snapshot
						? projectIndex(snapshot).footprintsById.get(footprint.id)?.path
						: undefined;
					if (!path) throw new Error("Unable to open the new footprint file.");
					return path;
				});
			}),

		saveFootprintModel: (id, model) =>
			enqueue(async () => {
				if (!state.active || state.generation !== epoch)
					throw new Error("Open a project before editing a footprint.");
				const footprints = state.active.footprints ?? [];
				const current = footprints.find((footprint) => footprint.id === id);
				if (!current)
					throw new Error("This footprint is no longer in the project.");
				const { model: _model, ...rest } = current;
				const file = model ? { ...rest, model: { ...model } } : rest;
				await persist(
					undefined,
					undefined,
					undefined,
					undefined,
					footprints.map((footprint) =>
						footprint.id === id ? file : footprint,
					),
				);
				const document = state.footprintDocuments.get(id);
				if (!document) return;
				const replaced = { ...document, file };
				state.footprintDocuments.set(id, replaced);
				if (state.editorFootprint === document)
					state.setEditorFootprint(replaced);
			}),
	});
}
