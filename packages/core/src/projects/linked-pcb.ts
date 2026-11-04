import type { SymbolLibrary } from "#/components/editor/symbolFormat.ts";
import type { ProjectDocument, ProjectSnapshot } from "#/projects/format.ts";
import { projectIndex } from "#/projects/project-index.ts";
import type { ConfiguredSymbolLibrary } from "#/symbol-library/config.ts";
import type { SymbolLibraryStorage } from "#/symbol-library/storage.tsx";

export async function assembleLinkedPcbs(
	document: ProjectDocument & {
		symbolLibraries: readonly ConfiguredSymbolLibrary[];
	},
	previous: ProjectSnapshot,
	symbolStorage: SymbolLibraryStorage,
	reportLibraryErrors: (errors: readonly string[]) => void,
) {
	const [
		{ pairPcbDocuments, primaryPcbId },
		{ synchronizePcb },
		{ measureLabelText },
		{ symbolDefinitions },
		{ libraryDefinitions },
		{ resolveDrawingSymbols },
		{ symbolReferenceKey },
	] = await Promise.all([
		import("#/projects/pcb.ts"),
		import("#/circuit/linked-schematic.ts"),
		import("#/circuit/label-measure.ts"),
		import("#/drawing/symbols.ts"),
		import("#/drawing/symbol-file.ts"),
		import("#/drawing/symbol-persistence.ts"),
		import("#/drawing/symbol-reference.ts"),
	]);
	const savedSymbols = document.symbols;
	const paired = pairPcbDocuments(document, previous.manifest.name);
	const flatDefinitions = (files: SymbolLibrary, id: string) =>
		libraryDefinitions(files).flatMap((definition, index) =>
			files[index]?.shapes.some((shape) => shape.kind === "symbol")
				? []
				: [{ ...definition, library: { scope: "project" as const, id } }],
		);
	const definitions = [
		...symbolDefinitions,
		...flatDefinitions(savedSymbols, "project-symbols"),
	];
	for (const library of document.symbolLibraries) {
		if (library.enabled && library.source.kind === "embedded")
			definitions.push(...flatDefinitions(library.source.symbols, library.id));
	}
	const { resolveSymbolLibraries, unavailableSymbols } = await import(
		"#/symbol-library/config.ts"
	);
	const userConfig = await symbolStorage.loadConfiguration?.();
	const projectLibraries: readonly ConfiguredSymbolLibrary[] =
		savedSymbols.length &&
		!document.symbolLibraries.some(
			(library) => library.id === "project-symbols",
		)
			? [
					{
						id: "project-symbols",
						name: "Project symbols",
						enabled: true,
						source: { kind: "embedded", symbols: savedSymbols },
					},
					...document.symbolLibraries,
				]
			: document.symbolLibraries;
	const resolvedLibraries = await resolveSymbolLibraries(
		userConfig?.symbolLibraries ?? [],
		projectLibraries,
		symbolStorage.loadDirectory
			? (path, scope) =>
					symbolStorage.loadDirectory!(path, scope, previous.directory)
			: undefined,
	);
	reportLibraryErrors(resolvedLibraries.errors);
	const isUnavailable = unavailableSymbols(resolvedLibraries);
	definitions.push(
		...resolvedLibraries.byReference.values(),
		...resolvedLibraries.definitions,
	);
	const byReference = new Map(
		definitions
			.filter((definition) => definition.library)
			.map((definition) => [
				symbolReferenceKey(definition.library!, definition.id),
				definition,
			]),
	);
	const circuitSources = new Map<string, "circuit" | "schematic">();
	const externalDrawings = new Set<string>();
	const previousIndex = projectIndex(previous);
	const drawingsByCircuit = new Map<
		string,
		NonNullable<ProjectDocument["drawings"]>[number]
	>();
	for (const drawing of paired.drawings ?? []) {
		if (drawing.circuitId && !drawingsByCircuit.has(drawing.circuitId))
			drawingsByCircuit.set(drawing.circuitId, drawing);
	}

	const linkedCircuits = new Map<
		string,
		import("@ecad/drawing-core/circuit/model.ts").CircuitFile
	>();
	for (const file of paired.circuits ?? []) {
		const drawing = drawingsByCircuit.get(file.circuit.id);
		const shapes =
			file.circuit.id === primaryPcbId ? paired.shapes : drawing?.shapes;
		if (!shapes) continue;
		for (const shape of shapes) {
			if (
				shape.kind !== "symbol" ||
				!shape.children.length ||
				!shape.library ||
				byReference.has(symbolReferenceKey(shape.library, shape.definitionId))
			)
				continue;
			byReference.set(symbolReferenceKey(shape.library, shape.definitionId), {
				id: shape.definitionId,
				library: shape.library,
				name: shape.attributes.name,
				prefix: "U",
				value: shape.attributes.value,
				description: "",
				children: shape.children,
				texts: shape.texts,
			});
		}
		const resolved = resolveDrawingSymbols(
			shapes,
			definitions,
			byReference,
		).shapes;
		const cachedSymbols = new Map(
			shapes.flatMap((shape) =>
				shape.kind === "symbol" && shape.children.length
					? [[shape.id, shape] as const]
					: [],
			),
		);
		const linked = synchronizePcb(
			file,
			resolved,
			previousIndex.circuitsById.get(file.circuit.id)?.file,
			definitions,
			{
				measureText: measureLabelText,
				newId: () => globalThis.crypto.randomUUID(),
				isSymbolUnavailable: isUnavailable,
			},
		);
		linked.shapes = linked.shapes.map((shape) => {
			const cached = cachedSymbols.get(shape.id);
			return shape.kind === "symbol" && cached
				? { ...cached, attributes: shape.attributes }
				: shape;
		});
		circuitSources.set(file.circuit.id, linked.source);
		if (linked.source === "circuit")
			externalDrawings.add(drawing?.id ?? primaryPcbId);
		linkedCircuits.set(file.circuit.id, linked.file);
		if (drawing) drawing.shapes = linked.shapes;
		else paired.shapes = linked.shapes;
	}
	paired.circuits = paired.circuits?.map(
		(file) => linkedCircuits.get(file.circuit.id) ?? file,
	);
	document = {
		...document,
		...paired,
		symbolLibraries: document.symbolLibraries,
	};
	return { document, circuitSources, externalDrawings };
}
