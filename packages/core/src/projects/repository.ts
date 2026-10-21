import { parseSymbolFile } from "#/components/editor/symbolFormat.ts";
import { persistProjectDrawingShapes } from "#/drawing/symbol-persistence.ts";
import {
	type AssetKind,
	assetSchema,
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
		const document = validateProjectDocument(snapshot);
		if (this.options.layout === "files")
			return this.publishFiles({ ...snapshot, ...document });
		const revision = `.ecad/${globalThis.crypto.randomUUID()}`;
		const drawing = `${revision}/drawing.ecaddraw`;
		const symbols: string[] = [];
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
			const manifest = { ...snapshot.manifest, drawing, symbols };
			const content = serializeProjectManifest(manifest);
			await this.directory.write(PROJECT_FILE, encoder.encode(content));
			const previous = this.snapshot;
			this.snapshot = { ...snapshot, ...document, manifest };
			this.savedManifest = content;
			const previousRevision = previous?.manifest.drawing.match(
				/^(\.ecad\/[0-9a-f-]{36})\/drawing\.ecaddraw$/,
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
				: await this.unusedPath("drawing.ecaddraw", reserved);
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
		const manifest = { ...snapshot.manifest, drawing, symbols };
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
				...previous.manifest.symbols,
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
			return this.publish({ ...current, ...validateProjectDocument(document) });
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
				...current.manifest.symbols,
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
