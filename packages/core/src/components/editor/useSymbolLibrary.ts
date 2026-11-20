import {
	type SymbolLibraryReference,
	symbolReferenceKey,
} from "@ecad/drawing-core/drawing/symbol-reference.ts";
import { runEffect } from "@ecad/drawing-core/lib/effect.ts";
import { errorMessage } from "@ecad/drawing-core/lib/error-message.ts";
import { createEffect, createMemo, createSignal } from "solid-js";
import {
	importSymbolFiles,
	mergeSymbolLibraries,
	parseSymbolFile,
	type SymbolFile,
	type SymbolLibrary,
} from "#/components/editor/symbolFormat.ts";
import {
	builtinSymbolFiles,
	type SymbolDefinition,
	symbolDefinitions,
} from "#/drawing/symbols.ts";
import { measurePerformanceAsync } from "#/performance/runtime.ts";
import { isProjectError } from "#/projects/errors.ts";
import {
	type ConfiguredSymbolLibrary,
	defaultSymbolConfig,
	type LibraryScope,
	parseSymbolConfig,
	resolveSymbolLibraries,
	type SymbolLibraryConfig,
	type SymbolSource,
	serializeSymbolConfig,
} from "#/symbol-library/config.ts";
import { prepareSymbolEdit } from "#/symbol-library/editing.ts";
import {
	type SymbolLibraryStorage,
	useProjectSymbolLibraryStorage,
	useSymbolLibraryStorage,
	useSymbolLibraryUpdates,
} from "#/symbol-library/storage.ts";

const emptyConfig = (): SymbolLibraryConfig => ({
	version: 1,
	symbolLibraries: [],
});
async function loadConfig(
	storage: SymbolLibraryStorage,
	project = false,
): Promise<SymbolLibraryConfig> {
	if (storage.loadConfiguration)
		return parseSymbolConfig(
			serializeSymbolConfig(await storage.loadConfiguration()),
		);
	const snapshot = await storage.load();
	const config = project ? emptyConfig() : defaultSymbolConfig();
	if (!snapshot.symbols.length) return config;
	return {
		...config,
		symbolLibraries: [
			...config.symbolLibraries,
			{
				id: project ? "project-symbols" : "imported",
				name: project ? "Project symbols" : "Imported symbols",
				enabled: true,
				source: {
					kind: "embedded",
					symbols: mergeSymbolLibraries([], snapshot.symbols),
				},
			},
		],
	};
}

export function useSymbolLibrary() {
	const updates = useSymbolLibraryUpdates();
	const storage = useSymbolLibraryStorage();
	const projectStorage = useProjectSymbolLibraryStorage();
	const [userConfig, setUserConfig] = createSignal(defaultSymbolConfig());
	const [projectConfig, setProjectConfig] = createSignal(emptyConfig());
	let currentUser = defaultSymbolConfig();
	let currentProject = emptyConfig();
	const [definitions, setDefinitions] = createSignal(symbolDefinitions);
	const [byReference, setByReference] = createSignal(
		new Map<string, SymbolDefinition>(),
	);
	const [referenceSources, setReferenceSources] = createSignal(
		new Map<string, SymbolSource>(),
	);
	const [sources, setSources] = createSignal(new Map<string, SymbolSource>());
	const [loading, setLoading] = createSignal(true);
	// The project storage the current definitions were loaded for.
	const [loadedFor, setLoadedFor] = createSignal<
		SymbolLibraryStorage | null | undefined
	>(undefined);
	const [message, setMessage] = createSignal("");
	const [error, setError] = createSignal("");
	const [libraryErrors, setLibraryErrors] = createSignal<string[]>([]);
	let request: AbortController | null = null;

	async function accept(
		user: SymbolLibraryConfig,
		project: SymbolLibraryConfig,
		signal: AbortSignal,
	) {
		const loadDirectory = storage.loadDirectory;
		const resolved = await measurePerformanceAsync(
			"symbol-library.resolve",
			() =>
				resolveSymbolLibraries(
					user.symbolLibraries,
					project.symbolLibraries,
					loadDirectory
						? async (path, scope) => {
								const directory =
									scope === "project"
										? (await projectStorage()?.load())?.directory
										: undefined;
								return loadDirectory(path, scope, directory);
							}
						: undefined,
				),
			{
				libraries: user.symbolLibraries.length + project.symbolLibraries.length,
			},
		);
		if (signal.aborted) return;
		currentUser = user;
		currentProject = project;
		setUserConfig(user);
		setProjectConfig(project);
		setDefinitions(resolved.definitions);
		setSources(resolved.sources);
		setByReference(resolved.byReference);
		setReferenceSources(resolved.referenceSources);
		setLibraryErrors(resolved.errors);
	}

	createEffect(
		() => projectStorage(),
		(project) => {
			let active = true;
			async function load() {
				if (request) return;
				const controller = new AbortController();
				request = controller;
				setLoading(true);
				setError("");
				try {
					const [user, projectResult] = await measurePerformanceAsync(
						"symbol-library.load",
						() =>
							Promise.allSettled([
								loadConfig(storage),
								project
									? loadConfig(project, true)
									: Promise.resolve(emptyConfig()),
							]),
					);
					if (!active || controller.signal.aborted) return;
					const failures = [user, projectResult].filter(
						(result) => result.status === "rejected",
					);
					await accept(
						user.status === "fulfilled" ? user.value : defaultSymbolConfig(),
						projectResult.status === "fulfilled"
							? projectResult.value
							: emptyConfig(),
						controller.signal,
					);
					if (!controller.signal.aborted) setLoadedFor(project ?? null);
					setError(
						failures
							.map((result) =>
								result.status === "rejected"
									? errorMessage(
											result.reason,
											"Unable to load symbol libraries.",
										)
									: "",
							)
							.join("\n"),
					);
				} catch (cause) {
					if (active)
						setError(errorMessage(cause, "Unable to load symbol libraries."));
				} finally {
					if (active && request === controller) {
						request = null;
						setLoading(false);
					}
				}
			}
			void load();
			const unsubscribeUpdates = updates?.subscribe(() => {
				if (active) void load();
			});
			const unsubscribe = storage.subscribe?.(() => {
				if (active) void load();
			});
			const unsubscribeProject = project?.subscribe?.(() => {
				if (active) void load();
			});
			return () => {
				active = false;
				request?.abort();
				request = null;
				unsubscribe?.();
				unsubscribeProject?.();
				unsubscribeUpdates?.();
			};
		},
	);

	async function perform<T>(work: (signal: AbortSignal) => Promise<T>) {
		let completed = false;
		if (request)
			throw new Error("Wait for the symbol library to finish loading.");
		const controller = new AbortController();
		request = controller;
		setLoading(true);
		setError("");
		setMessage("");
		try {
			const result = await work(controller.signal);
			completed = true;
			return result;
		} catch (cause) {
			if (
				!controller.signal.aborted &&
				!isProjectError(cause, "ProjectConflict")
			)
				setError(errorMessage(cause, "Unable to update symbols."));
			throw cause;
		} finally {
			if (request === controller && !controller.signal.aborted) {
				request = null;
				setLoading(false);
				if (completed) updates?.notify();
			}
		}
	}

	const defaultScope = (): LibraryScope =>
		projectStorage() ? "project" : "user";
	function config(scope: LibraryScope) {
		return scope === "user" ? currentUser : currentProject;
	}

	async function save(
		next: SymbolLibraryConfig,
		scope: LibraryScope,
		additions: SymbolLibrary,
		signal: AbortSignal,
	) {
		next = parseSymbolConfig(serializeSymbolConfig(next));
		const target = scope === "project" ? projectStorage() : storage;
		if (!target)
			throw new Error("Open a project before adding project libraries.");
		await measurePerformanceAsync(
			"symbol-library.save",
			() =>
				target.saveConfiguration
					? target.saveConfiguration(next)
					: target.save(
							next.symbolLibraries.flatMap((library) =>
								library.source.kind === "embedded"
									? [...library.source.symbols]
									: [],
							),
							additions,
						),
			{ libraries: next.symbolLibraries.length },
		);
		if (signal.aborted) throw new Error("Symbol operation was cancelled.");
		await accept(
			scope === "user" ? next : currentUser,
			scope === "project" ? next : currentProject,
			signal,
		);
	}

	function addition(
		incoming: SymbolLibrary,
		scope: LibraryScope,
		name: string,
	): SymbolLibraryConfig {
		const current = config(scope);
		const libraryName =
			name.trim() ||
			(scope === "project" ? "Project symbols" : "Imported symbols");
		const existing = current.symbolLibraries.find(
			(library) =>
				library.name === libraryName && library.source.kind === "embedded",
		);
		const symbols = mergeSymbolLibraries(
			existing?.source.kind === "embedded" ? existing.source.symbols : [],
			incoming,
		);
		const entry: ConfiguredSymbolLibrary = {
			id:
				existing?.id ??
				(libraryName === "Project symbols"
					? "project-symbols"
					: libraryName === "Imported symbols"
						? "imported"
						: crypto.randomUUID()),
			name: libraryName,
			enabled: true,
			source: { kind: "embedded", symbols },
		};
		return {
			...current,
			symbolLibraries: existing
				? current.symbolLibraries.map((library) =>
						library.id === existing.id ? entry : library,
					)
				: [...current.symbolLibraries, entry],
		};
	}

	function prepareAddition(symbol: SymbolFile) {
		const scope = defaultScope();
		const current = config(scope);
		const next = addition([symbol], scope, "");
		const added = next.symbolLibraries.find(
			(entry) =>
				entry.source.kind === "embedded" &&
				entry.source.symbols.some((file) => file.id === symbol.id),
		);
		if (!added)
			throw new Error("The symbol library destination is unavailable.");
		return () =>
			perform(async (signal) => {
				if (current !== config(scope))
					throw new Error(
						"The symbol library changed. Try creating the symbol again.",
					);
				await save(next, scope, [symbol], signal);
				setMessage("Symbol added.");
				return { scope, id: added.id };
			});
	}

	/** Resolves to the IDs of the symbols added, or none when the upload fails. */
	async function upload(
		files: readonly File[],
		directoryUpload = false,
		scope = defaultScope(),
		name = "",
	): Promise<string[]> {
		try {
			return await perform(async (signal) => {
				const incoming = await runEffect(
					importSymbolFiles(files, directoryUpload),
					signal,
				);
				if (signal.aborted) return [];
				const directoryName = directoryUpload
					? files[0]?.webkitRelativePath?.split("/")[0]
					: "";
				const next = addition(incoming, scope, name || directoryName || "");
				await save(next, scope, incoming, signal);
				setMessage("Symbols added.");
				return incoming.map((symbol) => symbol.id);
			});
		} catch {
			/* perform reports failures. */
			return [];
		}
	}

	async function updateLibrary(
		id: string,
		scope: LibraryScope,
		remove = false,
	) {
		try {
			await perform(async (signal) => {
				const current = config(scope);
				const libraries = remove
					? current.symbolLibraries.filter((library) => library.id !== id)
					: current.symbolLibraries.map((library) =>
							library.id === id
								? { ...library, enabled: !library.enabled }
								: library,
						);
				const next = { ...current, symbolLibraries: libraries };
				const showConfig = scope === "user" ? setUserConfig : setProjectConfig;
				if (!remove) showConfig(next);
				try {
					await save(next, scope, [], signal);
				} catch (cause) {
					if (!signal.aborted) showConfig(current);
					throw cause;
				}
			});
		} catch {
			/* perform reports failures. */
		}
	}

	async function openDirectory(scope = defaultScope(), name = "") {
		const openLibraryDirectory = storage.openLibraryDirectory;
		if (!openLibraryDirectory) return;
		try {
			await perform(async (signal) => {
				const library = await openLibraryDirectory(name);
				if (!library || signal.aborted) return;
				await save(
					{
						version: 1,
						symbolLibraries: [...config(scope).symbolLibraries, library],
					},
					scope,
					[],
					signal,
				);
			});
		} catch {
			/* Keep existing libraries on failure or cancellation. */
		}
	}

	async function refresh() {
		try {
			await perform(async (signal) => {
				const project = projectStorage();
				const [userResult, projectResult] = await Promise.all([
					loadConfig(storage),
					project ? loadConfig(project, true) : Promise.resolve(emptyConfig()),
				]);
				await accept(userResult, projectResult, signal);
				if (!signal.aborted) setMessage("Libraries reloaded.");
			});
		} catch {
			/* Keep existing libraries on failure. */
		}
	}

	function copySource(id: string, library?: SymbolLibraryReference) {
		const source = library
			? referenceSources().get(symbolReferenceKey(library, id))
			: sources().get(id);
		if (!source) return undefined;
		return (
			source.file ??
			(source.library.source.kind === "builtin"
				? builtinSymbolFiles.get(id)
				: undefined)
		);
	}

	async function copyToProject(id: string, library?: SymbolLibraryReference) {
		const file = copySource(id, library);
		if (!file || !projectStorage())
			throw new Error("This symbol cannot be copied to the project.");
		const taken = new Set([
			...[...byReference().values()].map((definition) => definition.id),
			...config("project").symbolLibraries.flatMap((entry) =>
				entry.source.kind === "embedded"
					? entry.source.symbols.map((symbol) => symbol.id)
					: [],
			),
		]);
		const base = `${file.id.slice(0, 54).replace(/[-.]+$/, "")}-copy`;
		let copyId = base;
		for (let suffix = 2; taken.has(copyId); suffix++)
			copyId = `${base}-${suffix}`;
		const copy = parseSymbolFile(JSON.stringify({ ...file, id: copyId }));
		const next = addition([copy], "project", "");
		const added = next.symbolLibraries.find(
			(entry) =>
				entry.source.kind === "embedded" &&
				entry.source.symbols.some((symbol) => symbol.id === copyId),
		);
		if (!added) throw new Error("The project symbol library is unavailable.");
		return perform(async (signal) => {
			await save(next, "project", [copy], signal);
			setMessage("Symbol copied to the project.");
			return {
				definitionId: copyId,
				library: { scope: "project", id: added.id } as const,
			};
		});
	}

	const ready = createMemo(
		() => loadedFor() === (projectStorage() ?? null) && !loading(),
	);
	const combinedError = createMemo(() =>
		[error(), ...libraryErrors()].filter(Boolean).join("\n"),
	);

	return {
		get definitions() {
			return definitions();
		},
		get byReference() {
			return byReference();
		},
		get sources() {
			return sources();
		},
		canCopyToProject: (id: string, library?: SymbolLibraryReference) =>
			!!projectStorage() && !!copySource(id, library),
		async canWriteProject() {
			const project = projectStorage();
			if (!project) return false;
			return (await project.canWriteConfiguration?.()) ?? true;
		},
		copyToProject,
		async prepareEdit(id: string, library?: SymbolLibraryReference) {
			const source = library
				? referenceSources().get(symbolReferenceKey(library, id))
				: sources().get(id);
			if (!source) return null;
			const project = projectStorage();
			const target = await measurePerformanceAsync(
				"symbol-library.prepare-edit",
				() => prepareSymbolEdit(source, storage, project),
			);
			return target
				? {
						...target,
						async save(file: SymbolFile) {
							await measurePerformanceAsync(
								"symbol-library.update",
								() => target.save(file),
								{ shapes: file.shapes.length },
							);
							await refresh();
						},
					}
				: null;
		},
		get loading() {
			return loading();
		},
		/** Loaded for the current project, not one opened before it. */
		get ready() {
			return ready();
		},
		get message() {
			return message();
		},
		get error() {
			return combinedError();
		},
		upload,
		prepareAddition,
		mode: storage.mode,
		get defaultScope() {
			return defaultScope();
		},
		get hasProject() {
			return !!projectStorage();
		},
		canOpenDirectory: !!storage.openLibraryDirectory,
		openDirectory,
		refresh,
		get userLibraries() {
			return userConfig().symbolLibraries;
		},
		get projectLibraries() {
			return projectConfig().symbolLibraries;
		},
		toggle: (id: string, scope: LibraryScope) => updateLibrary(id, scope),
		remove: (id: string, scope: LibraryScope) => updateLibrary(id, scope, true),
	};
}
