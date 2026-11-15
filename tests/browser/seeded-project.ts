import { test as base, type Page } from "@playwright/test";

export async function seedDrawingProject(page: Page) {
	await page.goto("/examples/symbols/buffer.ecadsym");
	await page.evaluate(async () => {
		const directory = "Untitled-seeded";
		const root = await navigator.storage.getDirectory();
		const project = await root.getDirectoryHandle(directory, { create: true });
		const write = async (path: string, text: string) => {
			const handle = await project.getFileHandle(path, { create: true });
			const writable = await handle.createWritable();
			await writable.write(text);
			await writable.close();
		};
		await write(
			"Untitled.ecaddraw",
			JSON.stringify({
				shapes: [],
				circuit: {
					format: "ecad-circuit",
					version: 1,
					id: "pcb-main",
					name: "Untitled",
					revision: 0,
					components: [],
					nets: [],
					noConnectPinIds: [],
				},
			}),
		);
		await write(
			".ecadprj",
			[
				'format = "ecad-project"',
				"version = 1",
				'name = "Untitled"',
				'drawing = "Untitled.ecaddraw"',
				"symbols = []",
				"assets = []",
				"",
				"[[circuits]]",
				'circuit = "Untitled.ecaddraw"',
				"",
			].join("\n"),
		);
		localStorage.setItem("ecad.active-project", directory);
	});
}

export const test = base.extend({
	page: async ({ page }, use) => {
		await seedDrawingProject(page);
		await use(page);
	},
});
export { expect } from "@playwright/test";
