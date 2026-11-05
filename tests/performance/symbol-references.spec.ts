import { expect, test } from "@playwright/test";
import { openProjectFiles } from "../browser/project-files";
import { required } from "../helpers/required.ts";
import { setupAppTests } from "./app-fixture.ts";
import { finish, interaction, metric, ready, report } from "./app-helpers.ts";

setupAppTests();

test(
	"symbol-references",
	{ tag: ["@symbols", "@editor"] },
	async ({ page }, testInfo) => {
		await page.goto("/projects?perf=1");
		await ready(page);
		await expect(
			page.getByLabel("Workspace instructions", { exact: true }),
		).toBeVisible();
		const child = {
			format: "ecad-symbol",
			version: 1,
			units: "mm",
			id: "reference-child",
			name: "Reference child",
			description: "",
			prefix: "U",
			value: "",
			shapes: Array.from({ length: 16 }, (_, index) => ({
				kind: "pin",
				name: `Pin ${index + 1}`,
				x: index < 8 ? -5 : 5,
				y: (index % 8) - 4,
			})),
		};
		const parent = {
			...child,
			id: "reference-parent",
			name: "Reference parent",
			shapes: Array.from({ length: 4 }, (_, index) => ({
				kind: "symbol",
				library: { scope: "project", id: "project-symbols" },
				definitionId: child.id,
				x: index * 15 - 22.5,
				y: 0,
			})),
		};
		await expect(
			(await openProjectFiles(page)).getByLabel("Add symbol files"),
		).toBeEnabled();
		await (await openProjectFiles(page))
			.getByLabel("Add symbol files")
			.setInputFiles(
				[child, parent].map((file) => ({
					name: `${file.id}.ecadsym`,
					mimeType: "application/json",
					buffer: Buffer.from(JSON.stringify(file)),
				})),
			);
		await (await openProjectFiles(page))
			.getByRole("link", {
				name: /^(?:Open Drawing|Open Untitled\.ecaddraw)$/,
				exact: true,
			})
			.click();
		await interaction(page, "reference.place", async () => {
			await page.getByRole("button", { name: "Symbols", exact: true }).click();
			await page
				.getByRole("button", { name: "Insert Reference parent", exact: true })
				.click();
			const bounds = required(await page.locator("canvas").boundingBox());
			await page
				.locator("canvas")
				.click({ position: { x: bounds.width * 0.4, y: bounds.height / 2 } });
			await expect(
				page.getByRole("textbox", { name: "Name", exact: true }),
			).toHaveValue("Reference parent");
		});
		await expect
			.poll(async () =>
				(await report(page)).events.some(
					(event) =>
						event.name === "project.save" &&
						event.status === "ok" &&
						event.data?.shapes === 1,
				),
			)
			.toBe(true);
		await expect
			.poll(async () =>
				page.evaluate(async () => {
					const root = await navigator.storage.getDirectory();
					const directory = await root.getDirectoryHandle(
						localStorage.getItem("ecad.active-project") ??
							(() => {
								throw new Error("Expected a value");
							})(),
					);
					const manifest = await (
						await directory.getFileHandle(".ecadprj")
					).getFile();
					const path = ((await manifest.text()).match(/drawing = "([^"]+)"/) ??
						(() => {
							throw new Error("Expected a value");
						})())[1].split("/");
					const name =
						path.pop() ??
						(() => {
							throw new Error("Expected a value");
						})();
					let folder = directory;
					for (const part of path)
						folder = await folder.getDirectoryHandle(part);
					const drawing = JSON.parse(
						await (await (await folder.getFileHandle(name)).getFile()).text(),
					);
					return (
						drawing.shapes.length === 1 &&
						drawing.shapes[0].library.id === "project-symbols" &&
						!("children" in drawing.shapes[0]) &&
						!("texts" in drawing.shapes[0])
					);
				}),
			)
			.toBe(true);
		await page.goto("/editor?perf=1");
		await ready(page);
		for (let repeat = 0; repeat < 3; repeat++) {
			await (await openProjectFiles(page))
				.getByRole("link", { name: "Workspace home", exact: true })
				.click();
			await interaction(page, "reference.open-nested", async () => {
				await (await openProjectFiles(page))
					.getByRole("link", {
						name: "Open reference-parent.ecadsym",
						exact: true,
					})
					.click();
				await expect(page.getByRole("heading", { level: 1 })).toHaveText(
					"Symbol editor · Reference parent",
				);
				await expect(
					page.getByRole("button", { name: "Select", exact: true }),
				).toBeEnabled();
				await expect(page.getByRole("alert")).toHaveCount(0);
			});
		}
		const value = await report(page);
		await finish(page, testInfo, "symbol-references", {
			interactionP95Ms: required(metric(value, "scenario.interaction")),
			resolveP95Ms: required(metric(value, "drawing.resolve-symbols")),
		});
	},
);
