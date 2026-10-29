import {
	pairPcbDocuments,
	primaryPcbId,
	pcbDocumentName,
} from "#/projects/pcb.ts";
import {
	parseCircuit,
	serializeCircuit,
} from "@ecad/drawing-core/circuit/model.ts";
import { parseSymbolFile } from "#/components/editor/symbolFormat.ts";
import { persistProjectDrawingShapes } from "#/drawing/symbol-persistence.ts";
import {
	type AssetKind,
	assetSchema,
	drawingFileSchema,
	PROJECT_FILE,
	type ProjectDocument,
	type ProjectSnapshot,
	parseProjectManifest,
	projectNameSchema,
	projectPathSchema,
	serializeProjectManifest,
	validateProjectDocument,
} from "#/projects/format.ts";

export interface ProjectDirectory {
	name: string;
	exists?(path: string): Promise<boolean>;
	read(path: string): Promise<Uint8Array>;
	write(path: string, bytes: Uint8Array): Promise<void>;
	remove(path: string): Promise<void>;
	removeEmptyDirectory?(path: string): Promise<void>;
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
	private operation: Promise<unknown> = Promise.resolve();

	getSymbolLibraries() {
		return this.snapshot?.symbolLibraries ?? [];
	}

	constructor(
		private directory: ProjectDirectory,
		private options: { layout?: "files" | "revisions" } = {},
	) {}

	private sequential<T>(run: () => Promise<T>): Promise<T> {
		const next = this.operation.then(run, run);
		this.operation = next.catch(() => undefined);
		return next;
	}

	private async readManifest() {
		return decoder.decode(await this.directory.read(PROJECT_FILE));
	}

	load(): Promise<ProjectSnapshot> {
		return this.sequential(async () => {
			const content = await this.readManifest();
			const manifest = parseProjectManifest(content);
			const savedFiles = new Map<string, Uint8Array>();
			const read = async (path: string) => {
				const bytes = await this.directory.read(path);
				if (this.options.layout === "files") savedFiles.set(path, bytes);
				return decoder.decode(bytes);
			};
			const drawing = JSON.parse(await read(manifest.drawing));
			const symbols = await Promise.all(
				manifest.symbols.map(async (path) => parseSymbolFile(await read(path))),
			);
			const document = validateProjectDocument({
				shapes: drawing.shapes,
				...(manifest.drawings === undefined
					? {}
					: {
							drawings: await Promise.all(
								manifest.drawings.map(async (path) =>
									drawingFileSchema.parse(JSON.parse(await read(path))),
								),
							),
						}),
				...(manifest.circuits === undefined
					? {}
					: {
							circuits: await Promise.all(
								manifest.circuits.map(async (paths) => {
									if (paths.graph && this.options.layout === "files") {
										try {
											await read(paths.graph);
										} catch (cause) {
											if (!isMissing(cause)) throw cause;
										}
									}
									const circuit = parseCircuit(await read(paths.circuit));
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
						}),
				symbols,
				symbolLibraries: drawing.symbolLibraries,
			});
			this.snapshot = { directory: this.directory.name, manifest, ...document };
			this.savedManifest = content;
			this.savedFiles = savedFiles;
			return this.snapshot;
		});
	}

	create(name: string): Promise<ProjectSnapshot> {
		return this.sequential(async () => {
			name = projectNameSchema.parse(name);
			try {
				await this.directory.read(PROJECT_FILE);
			} catch (cause) {
				if (
					!(cause instanceof Error) ||
					(cause.name !== "NotFoundError" &&
						!("code" in cause && cause.code === "ENOENT"))
				)
					throw cause;
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
			throw new Error("This directory already contains an ECAD project.");
		});
	}

	private async assertCurrent() {
		if (!this.snapshot) throw new Error("Open a project before saving.");
		if ((await this.readManifest()) !== this.savedManifest)
			throw new Error("The project changed on disk. Reopen it before saving.");
		for (const [path, saved] of this.savedFiles) {
			let current: Uint8Array;
			try {
				current = await this.directory.read(path);
			} catch (cause) {
				if (!isMissing(cause)) throw cause;
				throw new Error(
					"The project changed on disk. Reopen it before saving.",
				);
			}
			if (!sameBytes(current, saved))
				throw new Error(
					"The project changed on disk. Reopen it before saving.",
				);
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
						...(document.symbolLibraries === undefined
							? {}
							: { symbolLibraries: document.symbolLibraries }),
					}),
				),
			);
			for (const symbol of document.symbols) {
				const path = `${revision}/symbols/${symbol.id}.ecadsym`;
				projectPathSchema.parse(path);
				await this.directory.write(
					path,
					encoder.encode(JSON.stringify(symbol)),
				);
				symbols.push(path);
			}
			for (const file of document.drawings ?? []) {
				const path = `${revision}/pcbs/${file.id}/${file.name}.ecaddraw`;
				projectPathSchema.parse(path);
				await this.directory.write(
					path,
					encoder.encode(
						JSON.stringify({
							...file,
							shapes: persistProjectDrawingShapes({
								...document,
								shapes: file.shapes,
							}),
						}),
					),
				);
				drawings.push(path);
			}
			const circuits: { circuit: string }[] = [];
			for (const file of document.circuits ?? []) {
				const pairedDrawing = document.drawings?.find(
					(drawing) => drawing.circuitId === file.circuit.id,
				);
				const name = pairedDrawing?.name ?? pcbDocumentName(file.circuit.name);
				const stem =
					file.circuit.id === primaryPcbId
						? `${revision}/${mainName}/${mainName}`
						: `${revision}/pcbs/${pairedDrawing!.id}/${name}`;
				const paths = {
					circuit: `${stem}.ecadcircuit`,
				};
				projectPathSchema.parse(paths.circuit);
				await this.directory.write(
					paths.circuit,
					encoder.encode(serializeCircuit(file.circuit)),
				);
				circuits.push(paths);
			}
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
		projectPathSchema.parse(path);
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
		const visible = (path: string) => !path.startsWith(".ecad/");
		const drawing =
			previous &&
			visible(previous.manifest.drawing) &&
			!reserved.has(previous.manifest.drawing)
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
				existing && visible(existing) && !reserved.has(existing)
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
				existing && visible(existing) && !reserved.has(existing)
					? existing
					: await this.unusedPath(`symbols/${symbol.id}.ecadsym`, reserved);
			reserved.add(path);
			symbols.push(path);
			files.set(path, encoder.encode(JSON.stringify(symbol)));
		}
		const previousCircuits = new Map(
			previous?.circuits?.map((file, index) => [
				file.circuit.id,
				previous.manifest.circuits?.[index],
			]),
		);
		const circuits: { circuit: string }[] = [];
		for (const file of snapshot.circuits ?? []) {
			const existing = previousCircuits.get(file.circuit.id);
			const name =
				snapshot.drawings?.find(
					(drawing) => drawing.circuitId === file.circuit.id,
				)?.name ?? pcbDocumentName(file.circuit.name);
			const stem = `${name}/${name}`;
			const circuit =
				existing && visible(existing.circuit) && !reserved.has(existing.circuit)
					? existing.circuit
					: await this.unusedPath(`${stem}.ecadcircuit`, reserved);
			reserved.add(circuit);
			files.set(circuit, encoder.encode(serializeCircuit(file.circuit)));
			circuits.push({ circuit });
		}
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
				throw new AggregateError(
					[cause, ...failures],
					"Save failed and some project files could not be restored.",
				);
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
				...(previous.manifest.circuits ?? []).flatMap((paths) =>
					paths.graph ? [paths.circuit, paths.graph] : [paths.circuit],
				),
			].filter((path) => !reserved.has(path));
			for (const path of obsolete) {
				await this.directory.remove(path).catch(() => undefined);
				if (path.startsWith(".ecad/")) {
					const parts = path.split("/");
					for (let length = parts.length - 1; length > 0; length--)
						await this.directory
							.removeEmptyDirectory?.(parts.slice(0, length).join("/"))
							.catch(() => undefined);
				}
			}
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
				...(current.manifest.circuits ?? []).flatMap((paths) =>
					paths.graph ? [paths.circuit, paths.graph] : [paths.circuit],
				),
				...current.manifest.assets.map((asset) => asset.path),
			]);
			try {
				const additions = [];
				for (const input of assets) {
					const name = projectNameSchema.parse(input.name);
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

	readAsset(path: string): Promise<Uint8Array> {
		projectPathSchema.parse(path);
		if (!this.snapshot?.manifest.assets.some((asset) => asset.path === path))
			throw new Error("This asset does not belong to the open project.");
		return this.directory.read(path);
	}
}
