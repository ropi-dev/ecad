import type { CircuitFile } from "@ecad/drawing-core/circuit/model.ts";
import type { EditorShape } from "@ecad/drawing-core/drawing/shapes.ts";
import type { SymbolLibrary } from "#/components/editor/symbolFormat.ts";
import type { SymbolDefinition } from "#/drawing/symbols.ts";
import type { ProjectDocument, ProjectSnapshot } from "#/projects/format.ts";
import { projectIndex } from "#/projects/project-index.ts";
import type { ConfiguredSymbolLibrary } from "#/symbol-library/config.ts";
import type { SymbolLibraryStorage } from "#/symbol-library/storage.tsx";

type Resolution = Awaited<
	ReturnType<
		typeof import("#/symbol-library/config.ts")["resolveSymbolLibraries"]
	>
>;
type LinkedEntry = {
	inputs: Set<EditorShape[]>;
	circuits: Set<CircuitFile["circuit"]>;
	shapes: EditorShape[];
	file: CircuitFile;
	committed: boolean;
	source: "circuit" | "schematic";
};
type AssemblyCache = {
	resolution?: Promise<Resolution>;
	definitions?: SymbolDefinition[];
	symbols?: SymbolLibrary;
	libraries?: readonly ConfiguredSymbolLibrary[];
	directory?: string;
	entries: Map<string, LinkedEntry>;
};

export function createLinkedPcbAssembler() {
	const cache: AssemblyCache = { entries: new Map() };
	return {
		invalidate() {
			cache.resolution = undefined;
			cache.definitions = undefined;
			cache.symbols = undefined;
			cache.libraries = undefined;
			cache.directory = undefined;
			cache.entries.clear();
		},
		accept(
			snapshot: ProjectSnapshot,
			circuits?: ReadonlyMap<string, CircuitFile>,
		) {
			const index = projectIndex(snapshot);
			for (const [id, entry] of cache.entries) {
				const file = index.circuitsById.get(id)?.file;
				const shapes =
					id === "pcb-main"
						? snapshot.shapes
						: index.drawingsByCircuit.get(id)?.file.shapes;
				entry.committed = true;
				entry.circuits = new Set([entry.file.circuit]);
				entry.inputs = new Set([entry.shapes]);
				if (file) entry.circuits.add(file.circuit);
				const circuit = circuits?.get(id);
				if (circuit) entry.circuits.add(circuit.circuit);
				if (shapes) entry.inputs.add(shapes);
			}
		},
		assemble(
			document: ProjectDocument & {
				symbolLibraries: readonly ConfiguredSymbolLibrary[];
			},
			previous: ProjectSnapshot,
			storage: SymbolLibraryStorage,
			report: (errors: readonly string[]) => void,
		) {
			return assembleLinkedPcbs(document, previous, storage, report, cache);
		},
	};
}

export async function assembleLinkedPcbs(
	document: ProjectDocument & {
		symbolLibraries: readonly ConfiguredSymbolLibrary[];
	},
	previous: ProjectSnapshot,
	symbolStorage: SymbolLibraryStorage,
	reportLibraryErrors: (errors: readonly string[]) => void,
	cache?: AssemblyCache,
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
		import("@ecad/drawing-core/drawing/symbol-reference.ts"),
	]);
	const savedSymbols = document.symbols;
	const paired = pairPcbDocuments(document, previous.manifest.name);
	const flatDefinitions = (files: SymbolLibrary, id: string) =>
		libraryDefinitions(files).flatMap((definition, index) =>
			files[index]?.shapes.some((shape) => shape.kind === "symbol")
				? []
				: [{ ...definition, library: { scope: "project" as const, id } }],
		);
	const { resolveSymbolLibraries, unavailableSymbols } = await import(
		"#/symbol-library/config.ts"
	);
	const sameLibraries =
		cache?.libraries?.length === document.symbolLibraries.length &&
		document.symbolLibraries.every(
			(library, index) => cache?.libraries?.[index] === library,
		);
	if (
		cache &&
		(cache.directory !== previous.directory ||
			cache.symbols !== savedSymbols ||
			!sameLibraries)
	) {
		cache.resolution = undefined;
		cache.definitions = undefined;
		cache.entries.clear();
	}
	if (cache) {
		cache.directory = previous.directory;
		cache.symbols = savedSymbols;
		cache.libraries = document.symbolLibraries;
	}
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
	const loadDirectory = symbolStorage.loadDirectory?.bind(symbolStorage);
	const resolve = async () => {
		const userConfig = await symbolStorage.loadConfiguration?.();
		return resolveSymbolLibraries(
			userConfig?.symbolLibraries ?? [],
			projectLibraries,
			loadDirectory
				? (path, scope) => loadDirectory(path, scope, previous.directory)
				: undefined,
		);
	};
	const resolution = cache?.resolution ?? resolve();
	if (cache) cache.resolution = resolution;
	let resolvedLibraries: Resolution;
	try {
		resolvedLibraries = await resolution;
	} catch (cause) {
		if (cache?.resolution === resolution) {
			cache.resolution = undefined;
			cache.definitions = undefined;
			cache.entries.clear();
		}
		throw cause;
	}
	if (resolvedLibraries.errors.length && cache?.resolution === resolution) {
		cache.resolution = undefined;
		cache.definitions = undefined;
		cache.entries.clear();
	}
	reportLibraryErrors(resolvedLibraries.errors);
	const isUnavailable = unavailableSymbols(resolvedLibraries);
	const definitions =
		cache?.definitions ??
		(() => {
			const definitions = [
				...symbolDefinitions,
				...flatDefinitions(savedSymbols, "project-symbols"),
			];
			for (const library of document.symbolLibraries) {
				if (library.enabled && library.source.kind === "embedded")
					definitions.push(
						...flatDefinitions(library.source.symbols, library.id),
					);
			}
			definitions.push(
				...resolvedLibraries.byReference.values(),
				...resolvedLibraries.definitions,
			);
			return definitions;
		})();
	if (cache && cache.resolution === resolution) cache.definitions = definitions;
	const byReference = new Map(
		definitions.flatMap((definition) =>
			definition.library
				? [
						[
							symbolReferenceKey(definition.library, definition.id),
							definition,
						] as const,
					]
				: [],
		),
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
	const retained = new Map<string, LinkedEntry>();
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
		const cached = cache?.entries.get(file.circuit.id);
		if (cached?.inputs.has(shapes) && cached.circuits.has(file.circuit)) {
			linkedCircuits.set(
				file.circuit.id,
				cached.committed ? file : cached.file,
			);
			const savedShapes = cached.committed ? shapes : cached.shapes;
			if (drawing) drawing.shapes = savedShapes;
			else paired.shapes = savedShapes;
			circuitSources.set(file.circuit.id, cached.source);
			if (!cached.committed && cached.source === "circuit")
				externalDrawings.add(drawing?.id ?? primaryPcbId);
			retained.set(file.circuit.id, cached);
			continue;
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
		if (
			linked.source === "schematic" &&
			linked.file.circuit.revision === file.circuit.revision
		)
			linked.file = { ...linked.file, circuit: file.circuit };
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
		retained.set(file.circuit.id, {
			inputs: new Set([shapes, linked.shapes]),
			circuits: new Set([file.circuit, linked.file.circuit]),
			shapes: linked.shapes,
			file: linked.file,
			committed: false,
			source: linked.source,
		});
		if (drawing) drawing.shapes = linked.shapes;
		else paired.shapes = linked.shapes;
	}
	if (cache && cache.resolution === resolution) cache.entries = retained;
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
