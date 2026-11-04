import {
	pairPcbDocuments,
	primaryPcbId,
	pcbDocumentName,
} from "#/projects/pcb.ts";
import { circuitSchema } from "@ecad/drawing-core/circuit/model.ts";
import { Predicate } from "effect";
import { z } from "zod";
import { parseSymbolFile } from "#/components/editor/symbolFormat.ts";
import { persistProjectDrawingShapes } from "#/drawing/symbol-persistence.ts";
import { createSerialQueue } from "#/lib/serial-queue.ts";
import {
	InvalidProjectFile,
	ProjectAssetNotFound,
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

export interface ProjectDirectory {
	name: string;
	exists?(path: string): Promise<boolean>;
	read(path: string): Promise<Uint8Array>;
	write(path: string, bytes: Uint8Array): Promise<void>;
	remove(path: string): Promise<void>;
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

/** Rewraps format errors from one listed file so they name that file. */
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
	return (
		left.length === right.length &&
		left.every((byte, index) => byte === right[index])
	);
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

	private async readManifest() {
		return decoder.decode(await this.directory.read(PROJECT_FILE));
	}

	load(): Promise<ProjectSnapshot> {
		return this.sequential(async () => {
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
			/** Reads one listed file; any failure names that file. */
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
			const document = validateProjectDocument(
				{
					shapes: drawing.shapes as ProjectDocument["shapes"],
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
											const circuit = circuitSchema.parse(value.circuit);
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
					symbolLibraries:
						drawing.symbolLibraries as ProjectDocument["symbolLibraries"],
				} as ProjectDocument,
				{
					drawing: manifest.drawing,
					drawings: manifest.drawings,
					circuits: manifest.circuits?.map((paths) => paths.circuit),
				},
			);
			this.snapshot = { directory: this.directory.name, manifest, ...document };
			this.savedManifest = content;
			this.savedFiles = savedFiles;
			return this.snapshot;
		});
	}

	create(name: string): Promise<ProjectSnapshot> {
		return this.sequential(async () => {
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

	private async publish(snapshot: ProjectSnapshot): Promise<ProjectSnapshot> {
		const document = validateProjectDocument(
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
		const drawings: string[] = [];
		try {
			await this.directory.write(
				drawing,
				encoder.encode(
					JSON.stringify({
						shapes: persistProjectDrawingShapes(document),
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
		return this.sequential(async () => {
			const current = await this.assertCurrent();
			const validated = validateProjectDocument(document);
			const drawings =
				validated.drawings ??
				(validated.circuits === undefined
					? current.drawings
					: current.drawings?.filter(
							(drawing) =>
								!drawing.circuitId ||
								validated.circuits!.some(
									(file) => file.circuit.id === drawing.circuitId,
								),
						));
			return this.publish({ ...current, ...validated, drawings });
		});
	}

	importAssets(
		assets: { name: string; kind: AssetKind; bytes: Uint8Array }[],
	): Promise<ProjectSnapshot> {
		return this.sequential(async () => {
			const current = await this.assertCurrent();
			const created: string[] = [];
			const reserved = new Set([
				PROJECT_FILE,
				current.manifest.drawing,
				...(current.manifest.drawings ?? []),
				...current.manifest.symbols,
				...(current.manifest.circuits ?? []).flatMap((paths) => [
					paths.circuit,
				]),
				...current.manifest.assets.map((asset) => asset.path),
			]);
			try {
				const additions = [];
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

	async readAsset(path: string): Promise<Uint8Array> {
		parseProjectPath(path);
		if (!this.snapshot?.manifest.assets.some((asset) => asset.path === path))
			throw new ProjectAssetNotFound({ path });
		return this.directory.read(path);
	}
}
