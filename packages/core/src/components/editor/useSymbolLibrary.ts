import { useEffect, useRef, useState } from "react";
import {
	importSymbolFiles,
	mergeSymbolLibraries,
	type SymbolFile,
	type SymbolLibrary,
} from "#/components/editor/symbolFormat.ts";
import {
	type SymbolLibraryReference,
	symbolReferenceKey,
} from "#/drawing/symbol-reference.ts";
import { type SymbolDefinition, symbolDefinitions } from "#/drawing/symbols.ts";
import { runEffect } from "#/lib/effect.ts";
import { errorMessage } from "#/lib/error-message.ts";
import { measurePerformanceAsync } from "#/performance/runtime.ts";
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
} from "#/symbol-library/storage.tsx";

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
	const [userConfig, setUserConfig] = useState(defaultSymbolConfig);
	const [projectConfig, setProjectConfig] = useState(emptyConfig);
	const currentUser = useRef(userConfig);
	const currentProject = useRef(projectConfig);
	const [definitions, setDefinitions] = useState(symbolDefinitions);
	const [byReference, setByReference] = useState(
		new Map<string, SymbolDefinition>(),
	);
	const [referenceSources, setReferenceSources] = useState(
		new Map<string, SymbolSource>(),
	);
	const [sources, setSources] = useState(new Map<string, SymbolSource>());
	const [loading, setLoading] = useState(true);
	// The project storage the current definitions were loaded for.
	const [loadedFor, setLoadedFor] = useState<
		SymbolLibraryStorage | null | undefined
	>(undefined);
	const [message, setMessage] = useState("");
	const [error, setError] = useState("");
	const [libraryErrors, setLibraryErrors] = useState<string[]>([]);
	const request = useRef<AbortController | null>(null);

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
										? (await projectStorage?.load())?.directory
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
		currentUser.current = user;
		currentProject.current = project;
		setUserConfig(user);
		setProjectConfig(project);
		setDefinitions(resolved.definitions);
		setSources(resolved.sources);
		setByReference(resolved.byReference);
		setReferenceSources(resolved.referenceSources);
		setLibraryErrors(resolved.errors);
	}
	const acceptRef = useRef(accept);
	acceptRef.current = accept;

	useEffect(() => {
		let active = true;
		async function load() {
			if (request.current) return;
			const controller = new AbortController();
			request.current = controller;
			setLoading(true);
			setError("");
			try {
				const [user, project] = await measurePerformanceAsync(
					"symbol-library.load",
					() =>
						Promise.allSettled([
							loadConfig(storage),
							projectStorage
								? loadConfig(projectStorage, true)
								: Promise.resolve(emptyConfig()),
						]),
				);
				if (!active || controller.signal.aborted) return;
				const failures = [user, project].filter(
					(result) => result.status === "rejected",
				);
				await acceptRef.current(
					user.status === "fulfilled" ? user.value : defaultSymbolConfig(),
					project.status === "fulfilled" ? project.value : emptyConfig(),
					controller.signal,
				);
				if (!controller.signal.aborted) setLoadedFor(projectStorage ?? null);
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
				if (active && request.current === controller) {
					request.current = null;
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
		return () => {
			active = false;
			request.current?.abort();
			request.current = null;
			unsubscribe?.();
			unsubscribeUpdates?.();
		};
	}, [storage, projectStorage, updates]);

	async function perform<T>(work: (signal: AbortSignal) => Promise<T>) {
		let completed = false;
		if (request.current)
			throw new Error("Wait for the symbol library to finish loading.");
		const controller = new AbortController();
		request.current = controller;
		setLoading(true);
		setError("");
		setMessage("");
		try {
			const result = await work(controller.signal);
			completed = true;
			return result;
		} catch (cause) {
			if (!controller.signal.aborted)
				setError(errorMessage(cause, "Unable to update symbols."));
			throw cause;
		} finally {
			if (request.current === controller && !controller.signal.aborted) {
				request.current = null;
				setLoading(false);
				if (completed) updates?.notify();
			}
		}
	}

	const defaultScope: LibraryScope = projectStorage ? "project" : "user";
	function config(scope: LibraryScope) {
		return scope === "user" ? currentUser.current : currentProject.current;
	}

	async function save(
		next: SymbolLibraryConfig,
		scope: LibraryScope,
		additions: SymbolLibrary,
		signal: AbortSignal,
	) {
		next = parseSymbolConfig(serializeSymbolConfig(next));
		const target = scope === "project" ? projectStorage : storage;
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
			scope === "user" ? next : currentUser.current,
			scope === "project" ? next : currentProject.current,
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
		const scope = defaultScope;
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

	async function upload(
		files: readonly File[],
		directoryUpload = false,
		scope = defaultScope,
		name = "",
	) {
		try {
			await perform(async (signal) => {
				const incoming = await runEffect(
					importSymbolFiles(files, directoryUpload),
					signal,
				);
				if (signal.aborted) return;
				const directoryName = directoryUpload
					? files[0]?.webkitRelativePath?.split("/")[0]
					: "";
				const next = addition(incoming, scope, name || directoryName || "");
				await save(next, scope, incoming, signal);
				setMessage("Symbols added.");
			});
		} catch {
			/* perform reports failures. */
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

	async function openDirectory(scope = defaultScope, name = "") {
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
				const [user, project] = await Promise.all([
					loadConfig(storage),
					projectStorage
						? loadConfig(projectStorage, true)
						: Promise.resolve(emptyConfig()),
				]);
				await accept(user, project, signal);
				if (!signal.aborted) setMessage("Libraries reloaded.");
			});
		} catch {
			/* Keep existing libraries on failure. */
		}
	}

	return {
		definitions,
		byReference,
		sources,
		async prepareEdit(id: string, library?: SymbolLibraryReference) {
			const source = library
				? referenceSources.get(symbolReferenceKey(library, id))
				: sources.get(id);
			if (!source) return null;
			const target = await measurePerformanceAsync(
				"symbol-library.prepare-edit",
				() => prepareSymbolEdit(source, storage, projectStorage),
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
		loading,
		/** Loaded for the current project, not one opened before it. */
		ready: !loading && loadedFor === (projectStorage ?? null),
		message,
		error: [error, ...libraryErrors].filter(Boolean).join("\n"),
		upload,
		prepareAddition,
		mode: storage.mode,
		defaultScope,
		hasProject: !!projectStorage,
		canOpenDirectory: !!storage.openLibraryDirectory,
		openDirectory,
		refresh,
		userLibraries: userConfig.symbolLibraries,
		projectLibraries: projectConfig.symbolLibraries,
		toggle: (id: string, scope: LibraryScope) => updateLibrary(id, scope),
		remove: (id: string, scope: LibraryScope) => updateLibrary(id, scope, true),
	};
}
