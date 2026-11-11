import { mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import type { EditorShape } from "@ecad/drawing-core/drawing/shapes.ts";
import { expect, test } from "@playwright/test";
import { parseSymbolFile } from "#/components/editor/symbolFormat.ts";
import { ProjectRepository } from "#/projects/repository.ts";
import {
	createDesktopProjectDirectory,
	DesktopProjects,
} from "../../packages/desktop/src/main/projects.ts";
import { DesktopSymbolLibrary } from "../../packages/desktop/src/main/symbol-library.ts";

// This measures native filesystem I/O without browser CPU throttling or rendering.
test(
	"desktop-storage",
	{ tag: ["@storage"] },
	async ({ browserName: _browserName }, testInfo) => {
		const directory = await mkdtemp(join(tmpdir(), "ecad-perf-"));
		const metrics: Record<string, number> = {};
		const measure = async <T>(name: string, run: () => Promise<T>) => {
			const start = performance.now();
			const result = await run();
			metrics[name] = performance.now() - start;
			return result;
		};
		try {
			const disk = await createDesktopProjectDirectory(directory);
			const repository = new ProjectRepository(disk, { layout: "files" });
			await repository.create("Fixture");
			const shapes: EditorShape[] = Array.from({ length: 2000 }, (_, id) => ({
				id: id + 1,
				kind: "rectangle",
				x: id % 100,
				y: Math.floor(id / 100),
				width: 5,
				height: 8,
				rotation: 0,
				lineWidth: 0.2,
			}));
			const symbols = Array.from({ length: 50 }, (_, index) =>
				parseSymbolFile(
					JSON.stringify({
						format: "ecad-symbol",
						version: 1,
						units: "mm",
						id: `point-${index}`,
						name: "Test point",
						description: "",
						prefix: "TP",
						value: "",
						shapes: [{ kind: "pin", name: "Signal", x: 0, y: 0 }],
					}),
				),
			);
			await repository.save({ shapes, symbols });
			expect(await readdir(directory)).not.toContain(".ecad");
			const changed = shapes.map((shape) => ({ ...shape, x: shape.x + 1 }));
			await measure("saveMs", () =>
				repository.save({ shapes: changed, symbols }),
			);
			// The source bytes exercise copying and persistence, not STEP parsing.
			const bytes = new Uint8Array(10 * 1024 * 1024).fill(42);
			const imported = await measure("importAssetsMs", () =>
				repository.importAssets([{ name: "model.step", kind: "step", bytes }]),
			);
			const reopened = await measure("loadMs", () =>
				new ProjectRepository(disk, { layout: "files" }).load(),
			);
			expect(reopened.shapes).toEqual(changed);
			expect(reopened.symbols).toEqual(symbols);
			expect(
				Buffer.from(
					await repository.readAsset(imported.manifest.assets[0].path),
				).equals(Buffer.from(bytes)),
			).toBe(true);
			const config = {
				version: 1 as const,
				symbolLibraries: [
					{
						id: "parts",
						name: "Parts",
						enabled: true,
						source: { kind: "directory" as const, path: "symbols" },
					},
				],
			};
			// Saves accept only directories the user already configured or picked.
			const library = new DesktopSymbolLibrary(undefined, directory);
			await mkdir(dirname(library.configurationPath), { recursive: true });
			await writeFile(library.configurationPath, JSON.stringify(config));
			await measure("symbolConfigSaveMs", () =>
				library.saveConfiguration(config),
			);
			expect(
				await measure("symbolConfigLoadMs", () => library.loadConfiguration()),
			).toEqual(config);
			expect(
				await measure("libraryReadMs", () =>
					library.loadConfiguredDirectory("symbols"),
				),
			).toHaveLength(50);
			await testInfo.attach("performance", {
				body: JSON.stringify({
					scenario: "desktop-storage",
					metrics,
					report: {
						mode: process.env.ECAD_PERF_MODE ?? "production",
						environment: {
							userAgent: `Node/${process.versions.node}`,
							platform: process.platform,
							arch: process.arch,
							cpuThrottle: 1,
						},
						workload: { shapes: 2000, symbols: 50, sourceBytes: bytes.length },
					},
				}),
				contentType: "application/json",
			});
		} finally {
			await rm(directory, { recursive: true, force: true });
		}
	},
);

test(
	"desktop-untitled",
	{ tag: ["@storage"] },
	async ({ browserName: _browserName }, testInfo) => {
		const parent = await mkdtemp(join(tmpdir(), "ecad-memory-perf-"));
		const metrics: Record<string, number> = {};
		const measure = async <T>(name: string, run: () => Promise<T>) => {
			const start = performance.now();
			const result = await run();
			metrics[name] = performance.now() - start;
			return result;
		};
		try {
			const projects = new DesktopProjects();
			const created = await measure("createMs", () =>
				projects.createUntitled(),
			);
			const shapes: EditorShape[] = Array.from({ length: 2000 }, (_, id) => ({
				id: id + 1,
				kind: "rectangle",
				x: id % 100,
				y: Math.floor(id / 100),
				width: 5,
				height: 8,
				rotation: 0,
				lineWidth: 0.2,
			}));
			await measure("saveMemoryMs", () =>
				projects.save(created.directory, { shapes, symbols: [] }),
			);
			const bytes = new Uint8Array(10 * 1024 * 1024).fill(42);
			const imported = await measure("importMemoryMs", () =>
				projects.importAssets(created.directory, [
					{ name: "model.step", kind: "step", bytes },
				]),
			);
			expect(imported.inMemory).toBe(true);
			expect(await readdir(parent)).toEqual([]);
			const saved = await measure("saveToDiskMs", () =>
				projects.saveToDirectory(created.directory, parent),
			);
			const reopened = await measure("reopenMs", () =>
				new DesktopProjects(saved.directory).load(),
			);
			expect(reopened?.shapes).toEqual(shapes);
			expect(reopened?.inMemory).toBeUndefined();
			expect(
				await projects.readAsset(
					saved.directory,
					imported.manifest.assets[0].path,
				),
			).toEqual(bytes);
			await testInfo.attach("performance", {
				body: JSON.stringify({
					scenario: "desktop-untitled",
					metrics,
					report: {
						mode: process.env.ECAD_PERF_MODE ?? "production",
						environment: {
							userAgent: `Node/${process.versions.node}`,
							platform: process.platform,
							arch: process.arch,
							cpuThrottle: 1,
						},
						workload: { shapes: 2000, sourceBytes: bytes.length },
					},
				}),
				contentType: "application/json",
			});
		} finally {
			await rm(parent, { recursive: true, force: true });
		}
	},
);
