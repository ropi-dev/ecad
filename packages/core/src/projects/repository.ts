import { parseSymbolFile } from "#/components/editor/symbolFormat.ts";
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
	read(path: string): Promise<Uint8Array>;
	write(path: string, bytes: Uint8Array): Promise<void>;
	remove(path: string): Promise<void>;
}
const encoder = new TextEncoder();
const decoder = new TextDecoder();

export class ProjectRepository {
	private snapshot: ProjectSnapshot | null = null;
	private savedManifest = "";
	private operation: Promise<unknown> = Promise.resolve();

	constructor(private directory: ProjectDirectory) {}

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
			const drawing = JSON.parse(
				decoder.decode(await this.directory.read(manifest.drawing)),
			);
			const symbols = await Promise.all(
				manifest.symbols.map(async (path) =>
					parseSymbolFile(decoder.decode(await this.directory.read(path))),
				),
			);
			const document = validateProjectDocument({
				shapes: drawing.shapes,
				symbols,
			});
			this.snapshot = { directory: this.directory.name, manifest, ...document };
			this.savedManifest = content;
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
		return this.snapshot;
	}

	private async publish(snapshot: ProjectSnapshot): Promise<ProjectSnapshot> {
		const document = validateProjectDocument(snapshot);
		const revision = `.ecad/${globalThis.crypto.randomUUID()}`;
		const drawing = `${revision}/drawing.ecaddraw`;
		const symbols: string[] = [];
		try {
			await this.directory.write(
				drawing,
				encoder.encode(JSON.stringify({ shapes: document.shapes })),
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
			try {
				const additions = [];
				for (const input of assets) {
					const name = projectNameSchema.parse(input.name);
					const asset = assetSchema.parse({
						name,
						kind: input.kind,
						path: `assets/${globalThis.crypto.randomUUID()}-${name}`,
					});
					await this.directory.write(asset.path, input.bytes);
					created.push(asset.path);
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
