import { circuitSchema } from "@ecad/drawing-core/circuit/model.ts";
import { Predicate } from "effect";
import { z } from "zod";
import { parseSymbolFile } from "#/components/editor/symbolFormat.ts";
import { persistProjectDrawingShapes } from "#/drawing/symbol-persistence.ts";
import { assetFormat, fileSizeProblem } from "#/formats/import-limits.ts";
import { createSerialQueue } from "#/lib/serial-queue.ts";
import {
	InvalidProjectFile,
	ProjectAssetNotFound,
	ProjectAssetTooLarge,
	ProjectClosed,
	ProjectConflict,
	ProjectExists,
	ProjectRollbackFailed,
	schemaReason,
} from "#/projects/errors.ts";
import {
	type AssetKind,
	assetSchema,
	PROJECT_FILE,
	type ProjectDocument,
	type ProjectSnapshot,
	parseProjectManifest,
	parseProjectName,
	parseProjectPath,
	serializeProjectManifest,
	validateProjectDocument,
} from "#/projects/format.ts";
import {
	pairPcbDocuments,
	pcbDocumentName,
	primaryPcbId,
} from "#/projects/pcb.ts";
import {
	type ProjectSettings,
	projectSettingsSchema,
} from "#/settings/schema.ts";

export interface ProjectDirectory {
	name: string;
	exists?(path: string): Promise<boolean>;
	/**
	 * `beforeRead` receives the file's size before its contents are read, so
	 * it can reject a file that is too large by throwing. Implementations that
	 * cannot learn the size cheaply may skip it.
	 */
	read(path: string, beforeRead?: (size: number) => void): Promise<Uint8Array>;
	write(path: string, bytes: Uint8Array): Promise<void>;
	remove(path: string): Promise<void>;
	/**
	 * Runs work while holding a lock on this project that other repositories,
	 * windows and processes also take. Reads ask for a shared lock and writes
	 * for an exclusive one. An implementation may read without the lock when
	 * it cannot take one, for example in a read-only directory, but must
	 * never write without it. Without this method, the lock covers only the
	 * repositories in this JavaScript realm that use a directory of the same
	 * name.
	 */
	lock?<T>(work: () => Promise<T>, mode: ProjectLockMode): Promise<T>;
}

/** Assets over their import limit are neither stored nor read back. */
function assertAssetSize(
	asset: { name: string; kind: AssetKind },
	size: number,
) {
	const reason = fileSizeProblem(assetFormat(asset.name, asset.kind), size);
	if (reason) throw new ProjectAssetTooLarge({ assetName: asset.name, reason });
}

export type ProjectLockMode = "shared" | "exclusive";

const localLocks = new Map<string, Promise<void>>();

/** Runs work after earlier work under the same name in this JavaScript realm. */

export function withLocalLock<T>(
	name: string,
	work: () => Promise<T>,
): Promise<T> {
	const run = (localLocks.get(name) ?? Promise.resolve()).then(work);
	const released = run.then(
		() => {},
		() => {},
	);
	localLocks.set(name, released);
	void released.then(() => {
		if (localLocks.get(name) === released) localLocks.delete(name);
	});
	return run;
}
const encoder = new TextEncoder();
const decoder = new TextDecoder();

function isMissing(cause: unknown) {
	return (
		cause instanceof Error &&
		(cause.name === "NotFoundError" ||
			("code" in cause && cause.code === "ENOENT"))
	);
}

function invalidFile(path: string, cause: unknown): unknown {
	if (cause instanceof InvalidProjectFile) return cause;
	if (isMissing(cause))
		return new InvalidProjectFile({
			path,
			reason: "The project lists this file, but it is missing.",
			cause,
		});
	if (cause instanceof SyntaxError)
		return new InvalidProjectFile({
			path,
			reason: "The file is not valid JSON.",
			cause,
		});
	if (cause instanceof z.ZodError)
		return new InvalidProjectFile({
			path,
			reason: schemaReason(cause.issues),
			cause,
		});
	if (Predicate.isTagged(cause, "SymbolFormatError") && cause instanceof Error)
		return new InvalidProjectFile({ path, reason: cause.message, cause });
	return cause;
}

function sameBytes(left: Uint8Array, right: Uint8Array) {
	if (left.length !== right.length) return false;
	for (let index = 0; index < left.length; index++)
		if (left[index] !== right[index]) return false;
	return true;
}

export class ProjectRepository {
	private snapshot: ProjectSnapshot | null = null;
	private savedManifest = "";
	private savedFiles = new Map<string, Uint8Array>();
	private readonly sequential = createSerialQueue();

	getSymbolLibraries() {
		return this.snapshot?.symbolLibraries ?? [];
	}

	constructor(
		private directory: ProjectDirectory,
		private options: { layout?: "files" | "revisions" } = {},
	) {}

	// Reading, checking for changes and publishing hold the project lock, so a
	// save from another repository either finishes first and is detected as an
	// external change, or starts after this one finishes.
	private locked<T>(mode: ProjectLockMode, work: () => Promise<T>): Promise<T> {
		return this.sequential(() => this.withLock(mode, work));
	}

	private withLock<T>(mode: ProjectLockMode, work: () => Promise<T>) {
		return this.directory.lock
			? this.directory.lock(work, mode)
			: withLocalLock(this.directory.name, work);
	}

	private async readManifest() {
		return decoder.decode(await this.directory.read(PROJECT_FILE));
	}

	// The read only becomes the repository's state once the lock is released,
	// because a directory may reject a read it cannot verify after it finished.
	load(): Promise<ProjectSnapshot> {
		return this.sequential(async () => {
			const loaded = await this.withLock("shared", () => this.read());
			this.snapshot = loaded.snapshot;
			this.savedManifest = loaded.content;
			this.savedFiles = loaded.savedFiles;
			return loaded.snapshot;
		});
	}

	/** The project files this repository last read or wrote, without the manifest. */
	savedPaths(): string[] {
		return [...this.savedFiles.keys()];
	}

	/**
	 * Lists the manifest and saved files whose bytes on disk differ from
	 * those this repository last read or wrote. It reads without the project
	 * lock, because taking the lock writes into the project directory, so the
	 * result only tells whether a refresh is worth running. It waits for this
	 * repository's own saves, so their files never count as changes.
	 */
	changedPaths(): Promise<string[]> {
		return this.sequential(async () => {
			if (!this.snapshot) return [];
			const changed: string[] = [];
			const differs = async (path: string, saved: Uint8Array) => {
				try {
					return !sameBytes(await this.directory.read(path), saved);
				} catch (cause) {
					if (isMissing(cause)) return true;
					throw cause;
				}
			};
			if (await differs(PROJECT_FILE, encoder.encode(this.savedManifest)))
				changed.push(PROJECT_FILE);
			for (const [path, saved] of this.savedFiles)
				if (await differs(path, saved)) changed.push(path);
			return changed;
		});
	}

	/**
	 * Loads the project like `load` and reports which files changed since this
	 * repository last read or wrote them. Resolves to null, keeping the
	 * current state, when nothing changed.
	 */
	refresh(): Promise<{ snapshot: ProjectSnapshot; changed: string[] } | null> {
		return this.sequential(async () => {
			if (!this.snapshot) throw new ProjectClosed();
			const loaded = await this.withLock("shared", () => this.read());
			const changed =
				loaded.content === this.savedManifest ? [] : [PROJECT_FILE];
			for (const [path, bytes] of loaded.savedFiles) {
				const saved = this.savedFiles.get(path);
				if (!saved || !sameBytes(saved, bytes)) changed.push(path);
			}
			for (const path of this.savedFiles.keys())
				if (!loaded.savedFiles.has(path)) changed.push(path);
			if (!changed.length) return null;
			this.snapshot = loaded.snapshot;
			this.savedManifest = loaded.content;
			this.savedFiles = loaded.savedFiles;
			return { snapshot: loaded.snapshot, changed };
		});
	}

	private async read() {
		const content = await this.readManifest();
		const manifest = parseProjectManifest(content);
		const savedFiles = new Map<string, Uint8Array>();
		const contents = new Map<string, Promise<string>>();
		const read = (path: string): Promise<string> => {
			const existing = contents.get(path);
			if (existing) return existing;
			const pending = readFile(path);
			contents.set(path, pending);
			return pending;
		};
		const readFile = async (path: string) => {
			const bytes = await this.directory.read(path);
			if (this.options.layout === "files") savedFiles.set(path, bytes);
			return decoder.decode(bytes);
		};
		const readJson = async <T = Record<string, unknown>>(
			path: string,
			parse: (value: Record<string, unknown>) => T = (value) => value as T,
		): Promise<T> => {
			try {
				const value: unknown = JSON.parse(await read(path));
				if (!Predicate.isRecord(value))
					throw new InvalidProjectFile({
						path,
						reason: "The file must contain a JSON object.",
					});
				return parse(value);
			} catch (cause) {
				throw invalidFile(path, cause);
			}
		};
		const drawing = await readJson(manifest.drawing);
		const symbols = await Promise.all(
			manifest.symbols.map(async (path) => {
				try {
					return parseSymbolFile(await read(path));
				} catch (cause) {
					throw invalidFile(path, cause);
				}
			}),
		);
		const footprints =
			manifest.footprints &&
			(await Promise.all(manifest.footprints.map((path) => readJson(path))));
		const document = validateProjectDocument(
			{
				shapes: drawing.shapes as ProjectDocument["shapes"],
				...(drawing.pages === undefined
					? {}
					: { pages: drawing.pages as ProjectDocument["pages"] }),
				...(manifest.drawings === undefined
					? {}
					: {
							drawings: await Promise.all(
								manifest.drawings.map((path) =>
									readJson(
										path,
										({ circuit: _circuit, ...drawing }) => drawing,
									),
								),
							),
						}),
				...(manifest.circuits === undefined
					? {}
					: {
							circuits: await Promise.all(
								manifest.circuits.map((paths) =>
									readJson(paths.circuit, (value) => {
										const parsed = circuitSchema.safeParse(value.circuit);
										if (!parsed.success)
											throw new InvalidProjectFile({
												path: paths.circuit,
												reason: schemaReason(
													parsed.error.issues.map((issue) => ({
														...issue,
														path: ["circuit", ...issue.path],
													})),
												),
												cause: parsed.error,
											});
										const circuit = parsed.data;
										if (value.circuitId && value.circuitId !== circuit.id)
											throw new InvalidProjectFile({
												path: paths.circuit,
												reason:
													"The schematic circuit identity does not match its circuit data.",
											});
										return {
											circuit,
											graph: {
												format: "ecad-circuit-graph" as const,
												version: 1 as const,
												circuitId: circuit.id,
												positions: [],
											},
										};
									}),
								),
							),
						}),
				symbols,
				...(footprints === undefined ? {} : { footprints }),
				symbolLibraries:
					drawing.symbolLibraries as ProjectDocument["symbolLibraries"],
			} as ProjectDocument,
			{
				drawing: manifest.drawing,
				drawings: manifest.drawings,
				circuits: manifest.circuits?.map((paths) => paths.circuit),
				footprints: manifest.footprints,
			},
		);
		const snapshot: ProjectSnapshot = {
			directory: this.directory.name,
			manifest,
			...document,
		};
		return { snapshot, content, savedFiles };
	}

	create(name: string): Promise<ProjectSnapshot> {
		return this.locked("exclusive", async () => {
			name = parseProjectName(name);
			try {
				await this.directory.read(PROJECT_FILE);
			} catch (cause) {
				if (!isMissing(cause)) throw cause;
				return this.publish({
					directory: this.directory.name,
					manifest: {
						format: "ecad-project",
						version: 1,
						name,
						drawing: "drawing.ecaddraw",
						symbols: [],
						assets: [],
					},
					shapes: [],
					symbols: [],
				});
			}
			throw new ProjectExists();
		});
	}

	private async assertCurrent() {
		if (!this.snapshot) throw new ProjectClosed();
		let manifest: string;
		try {
			manifest = await this.readManifest();
		} catch (cause) {
			if (!isMissing(cause)) throw cause;
			throw new ProjectConflict({ path: PROJECT_FILE });
		}
		if (manifest !== this.savedManifest)
			throw new ProjectConflict({ path: PROJECT_FILE });
		for (const [path, saved] of this.savedFiles) {
			let current: Uint8Array;
			try {
				current = await this.directory.read(path);
			} catch (cause) {
				if (!isMissing(cause)) throw cause;
				throw new ProjectConflict({ path });
			}
			if (!sameBytes(current, saved)) throw new ProjectConflict({ path });
		}
		return this.snapshot;
	}

	private async publish(
		snapshot: ProjectSnapshot,
		validated?: ProjectDocument,
	): Promise<ProjectSnapshot> {
		const document =
			validated ??
			validateProjectDocument(
				pairPcbDocuments(snapshot, snapshot.manifest.name),
			);
		snapshot = { ...snapshot, ...document };
		if (this.options.layout === "files")
			return this.publishFiles({ ...snapshot, ...document });
		const revision = `.ecad/${globalThis.crypto.randomUUID()}`;
		const mainName = pcbDocumentName(
			document.circuits?.find((file) => file.circuit.id === primaryPcbId)
				?.circuit.name ?? snapshot.manifest.name,
		);
		const drawing = `${revision}/${mainName}/${mainName}.ecaddraw`;
		const symbols: string[] = [];
		const footprints: string[] = [];
		const drawings: string[] = [];
		try {
			await this.directory.write(
				drawing,
				encoder.encode(
					JSON.stringify({
						shapes: persistProjectDrawingShapes(document),
						...(document.pages ? { pages: document.pages } : {}),
						circuit: document.circuits?.find(
							(file) => file.circuit.id === primaryPcbId,
						)?.circuit,
						...(document.symbolLibraries === undefined
							? {}
							: { symbolLibraries: document.symbolLibraries }),
					}),
				),
			);
			for (const symbol of document.symbols) {
				const path = `${revision}/symbols/${symbol.id}.ecadsym`;
				parseProjectPath(path);
				await this.directory.write(
					path,
					encoder.encode(JSON.stringify(symbol)),
				);
				symbols.push(path);
			}
			for (const footprint of document.footprints ?? []) {
				const path = `${revision}/footprints/${footprint.id}.ecadfp`;
				parseProjectPath(path);
				await this.directory.write(
					path,
					encoder.encode(JSON.stringify(footprint)),
				);
				footprints.push(path);
			}
			for (const file of document.drawings ?? []) {
				const path = `${revision}/pcbs/${file.id}/${file.name}.ecaddraw`;
				parseProjectPath(path);
				await this.directory.write(
					path,
					encoder.encode(
						JSON.stringify({
							...file,
							circuit: document.circuits?.find(
								(entry) => entry.circuit.id === file.circuitId,
							)?.circuit,
							shapes: persistProjectDrawingShapes({
								...document,
								shapes: file.shapes,
							}),
						}),
					),
				);
				drawings.push(path);
			}
			const circuits = (document.circuits ?? []).map((file) => ({
				circuit:
					file.circuit.id === primaryPcbId
						? drawing
						: drawings[
								(document.drawings ?? []).findIndex(
									(entry) => entry.circuitId === file.circuit.id,
								)
							],
			}));
			const manifest = {
				...snapshot.manifest,
				...(document.circuits === undefined ? {} : { circuits }),
				drawing,
				symbols,
				...(document.footprints === undefined ? {} : { footprints }),
				...(document.drawings === undefined ? {} : { drawings }),
			};
			const content = serializeProjectManifest(manifest);
			await this.directory.write(PROJECT_FILE, encoder.encode(content));
			const previous = this.snapshot;
			this.snapshot = { ...snapshot, ...document, manifest };
			this.savedManifest = content;
			const previousRevision = previous?.manifest.drawing.match(
				/^(\.ecad\/[0-9a-f-]{36})\//,
			)?.[1];
			if (
				previousRevision &&
				!snapshot.manifest.assets.some((asset) =>
					asset.path.startsWith(`${previousRevision}/`),
				)
			) {
				await this.directory.remove(previousRevision).catch(() => undefined);
			}
			return this.snapshot;
		} catch (cause) {
			await this.directory.remove(revision).catch(() => undefined);
			throw cause;
		}
	}

	private async unusedPath(path: string, reserved: Set<string>) {
		parseProjectPath(path);
		const dot = path.lastIndexOf(".");
		const extension = dot > path.lastIndexOf("/") + 1 ? path.slice(dot) : "";
		const stem = extension ? path.slice(0, dot) : path;
		for (let index = 1; ; index++) {
			const candidate = index === 1 ? path : `${stem}-${index}${extension}`;
			if (reserved.has(candidate)) continue;
			if (this.directory.exists) {
				if (!(await this.directory.exists(candidate))) return candidate;
				continue;
			}
			try {
				await this.directory.read(candidate);
			} catch (cause) {
				if (isMissing(cause)) return candidate;
				throw cause;
			}
		}
	}

	private async publishFiles(
		snapshot: ProjectSnapshot,
	): Promise<ProjectSnapshot> {
		const previous = this.snapshot;
		const reserved = new Set([
			PROJECT_FILE,
			...snapshot.manifest.assets.map((asset) => asset.path),
		]);
		const drawing =
			previous && !reserved.has(previous.manifest.drawing)
				? previous.manifest.drawing
				: await this.unusedPath(
						`${snapshot.manifest.name}/${snapshot.manifest.name}.ecaddraw`,
						reserved,
					);
		reserved.add(drawing);
		const files = new Map<string, Uint8Array>([
			[
				drawing,
				encoder.encode(
					JSON.stringify({
						shapes: persistProjectDrawingShapes(snapshot),
						...(snapshot.pages ? { pages: snapshot.pages } : {}),
						circuit: snapshot.circuits?.find(
							(file) => file.circuit.id === primaryPcbId,
						)?.circuit,
						...(snapshot.symbolLibraries === undefined
							? {}
							: { symbolLibraries: snapshot.symbolLibraries }),
					}),
				),
			],
		]);
		const previousSymbols = new Map(
			previous?.symbols.map((symbol, index) => [
				symbol.id,
				previous.manifest.symbols[index],
			]),
		);
		const previousDrawings = new Map(
			previous?.drawings?.map((file, index) => [
				file.id,
				previous.manifest.drawings?.[index],
			]),
		);
		const drawings: string[] = [];
		for (const file of snapshot.drawings ?? []) {
			const existing = previousDrawings.get(file.id);
			const path =
				existing && !reserved.has(existing)
					? existing
					: await this.unusedPath(
							`${file.name}/${file.name}.ecaddraw`,
							reserved,
						);
			reserved.add(path);
			drawings.push(path);
			files.set(
				path,
				encoder.encode(
					JSON.stringify({
						...file,
						circuit: snapshot.circuits?.find(
							(entry) => entry.circuit.id === file.circuitId,
						)?.circuit,
						shapes: persistProjectDrawingShapes({
							...snapshot,
							shapes: file.shapes,
						}),
					}),
				),
			);
		}
		const symbols: string[] = [];
		for (const symbol of snapshot.symbols) {
			const existing = previousSymbols.get(symbol.id);
			const path =
				existing && !reserved.has(existing)
					? existing
					: await this.unusedPath(`symbols/${symbol.id}.ecadsym`, reserved);
			reserved.add(path);
			symbols.push(path);
			files.set(path, encoder.encode(JSON.stringify(symbol)));
		}
		const previousFootprints = new Map(
			previous?.footprints?.map((footprint, index) => [
				footprint.id,
				previous.manifest.footprints?.[index],
			]),
		);
		const footprints: string[] = [];
		for (const footprint of snapshot.footprints ?? []) {
			const existing = previousFootprints.get(footprint.id);
			const path =
				existing && !reserved.has(existing)
					? existing
					: await this.unusedPath(
							`footprints/${footprint.id}.ecadfp`,
							reserved,
						);
			reserved.add(path);
			footprints.push(path);
			files.set(path, encoder.encode(JSON.stringify(footprint)));
		}
		const circuits = (snapshot.circuits ?? []).map((file) => ({
			circuit:
				file.circuit.id === primaryPcbId
					? drawing
					: drawings[
							(snapshot.drawings ?? []).findIndex(
								(entry) => entry.circuitId === file.circuit.id,
							)
						],
		}));
		const manifest = {
			...snapshot.manifest,
			...(snapshot.circuits === undefined ? {} : { circuits }),
			drawing,
			symbols,
			...(snapshot.footprints === undefined ? {} : { footprints }),
			...(snapshot.drawings === undefined ? {} : { drawings }),
		};
		const content = serializeProjectManifest(manifest);
		files.set(PROJECT_FILE, encoder.encode(content));
		const changes: { path: string; before: Uint8Array | null }[] = [];
		try {
			for (const [path, bytes] of files) {
				let before: Uint8Array | null = null;
				try {
					before = await this.directory.read(path);
				} catch (cause) {
					if (!isMissing(cause)) throw cause;
				}
				if (path !== PROJECT_FILE && before && sameBytes(before, bytes))
					continue;
				// Each desktop write replaces one file atomically. Keep the old bytes
				// until the manifest commits so a later write failure can be undone.
				await this.directory.write(path, bytes);
				changes.push({ path, before });
			}
		} catch (cause) {
			const failures: unknown[] = [];
			for (const { path, before } of changes.reverse()) {
				try {
					if (before) await this.directory.write(path, before);
					else await this.directory.remove(path);
				} catch (failure) {
					failures.push(failure);
				}
			}
			if (failures.length)
				throw new ProjectRollbackFailed({
					cause: new AggregateError([cause, ...failures]),
				});
			throw cause;
		}
		this.snapshot = { ...snapshot, manifest };
		this.savedManifest = content;
		files.delete(PROJECT_FILE);
		this.savedFiles = files;
		if (previous) {
			const obsolete = [
				previous.manifest.drawing,
				...(previous.manifest.drawings ?? []),
				...previous.manifest.symbols,
				...(previous.manifest.footprints ?? []),
				...(previous.manifest.circuits ?? []).flatMap((paths) => [
					paths.circuit,
				]),
			].filter((path) => !reserved.has(path));
			for (const path of obsolete)
				await this.directory.remove(path).catch(() => undefined);
		}
		return this.snapshot;
	}

	save(document: ProjectDocument): Promise<ProjectSnapshot> {
		return this.locked("exclusive", async () => {
			const current = await this.assertCurrent();
			const validated = validateProjectDocument(document);
			const circuits = validated.circuits;
			const drawings =
				validated.drawings ??
				(circuits === undefined
					? current.drawings
					: current.drawings?.filter(
							(drawing) =>
								!drawing.circuitId ||
								circuits.some((file) => file.circuit.id === drawing.circuitId),
						));
			const snapshot = { ...current, ...validated, drawings };
			return this.publish(
				snapshot,
				pairPcbDocuments(snapshot, current.manifest.name),
			);
		});
	}

	importAssets(
		assets: { name: string; kind: AssetKind; bytes: Uint8Array }[],
	): Promise<ProjectSnapshot> {
		return this.locked("exclusive", async () => {
			const current = await this.assertCurrent();
			const created: string[] = [];
			const reserved = new Set([
				PROJECT_FILE,
				current.manifest.drawing,
				...(current.manifest.drawings ?? []),
				...current.manifest.symbols,
				...(current.manifest.footprints ?? []),
				...(current.manifest.circuits ?? []).flatMap((paths) => [
					paths.circuit,
				]),
				...current.manifest.assets.map((asset) => asset.path),
			]);
			try {
				const additions = [];
				for (const input of assets)
					assertAssetSize(input, input.bytes.byteLength);
				for (const input of assets) {
					const name = parseProjectName(input.name);
					const asset = assetSchema.parse({
						name,
						kind: input.kind,
						path:
							this.options.layout === "files"
								? await this.unusedPath(`assets/${name}`, reserved)
								: `assets/${globalThis.crypto.randomUUID()}-${name}`,
					});
					await this.directory.write(asset.path, input.bytes);
					created.push(asset.path);
					reserved.add(asset.path);
					additions.push(asset);
				}
				const manifest = {
					...current.manifest,
					assets: [...current.manifest.assets, ...additions],
				};
				const content = serializeProjectManifest(manifest);
				await this.directory.write(PROJECT_FILE, encoder.encode(content));
				this.snapshot = { ...current, manifest };
				this.savedManifest = content;
				return this.snapshot;
			} catch (cause) {
				await Promise.all(
					created.map((path) =>
						this.directory.remove(path).catch(() => undefined),
					),
				);
				throw cause;
			}
		});
	}

	saveSettings(settings: ProjectSettings): Promise<ProjectSnapshot> {
		return this.locked("exclusive", async () => {
			const current = await this.assertCurrent();
			const parsed = projectSettingsSchema.parse(settings);
			const { settings: _previous, ...rest } = current.manifest;
			const manifest = Object.keys(parsed).length
				? { ...rest, settings: parsed }
				: rest;
			const content = serializeProjectManifest(manifest);
			await this.directory.write(PROJECT_FILE, encoder.encode(content));
			this.snapshot = { ...current, manifest };
			this.savedManifest = content;
			return this.snapshot;
		});
	}

	async readAsset(path: string): Promise<Uint8Array> {
		parseProjectPath(path);
		const asset = this.snapshot?.manifest.assets.find(
			(entry) => entry.path === path,
		);
		if (!asset) throw new ProjectAssetNotFound({ path });
		const check = (size: number) => assertAssetSize(asset, size);
		const bytes = await this.directory.read(path, check);
		// Directories that cannot report the size first are checked afterwards.
		check(bytes.byteLength);
		return bytes;
	}
}
