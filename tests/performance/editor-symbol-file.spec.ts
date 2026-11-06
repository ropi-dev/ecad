import { expect, test } from "@playwright/test";
import { closeProjectFiles, openProjectFiles } from "../browser/project-files";
import { toolbarButton } from "../browser/toolbar";
import { setupAppTests } from "./app-fixture.ts";
import {
	finish,
	interaction,
	percentile,
	ready,
	report,
} from "./app-helpers.ts";

setupAppTests();

test(
	"editor-symbol-file",
	{ tag: ["@editor", "@symbols"] },
	async ({ page }, testInfo) => {
		await page.goto("/projects?perf=1");
		await ready(page);
		await expect(
			page.getByLabel("Workspace instructions", { exact: true }),
		).toBeVisible();
		const symbol = {
			format: "ecad-symbol",
			version: 1,
			units: "mm",
			id: "editable-package",
			name: "Editable package",
			description: "",
			prefix: "U",
			value: "",
			shapes: Array.from({ length: 128 }, (_, index) => ({
				kind: "pin",
				name: `Pin ${index + 1}`,
				x: index < 64 ? -10 : 10,
				y: (index % 64) - 32,
			})),
		};
		await expect(
			(await openProjectFiles(page)).getByLabel("Add symbol files"),
		).toBeEnabled();
		await (await openProjectFiles(page))
			.getByLabel("Add symbol files")
			.setInputFiles({
				name: "package.ecadsym",
				mimeType: "application/json",
				buffer: Buffer.from(JSON.stringify(symbol)),
			});
		const coldOpenMs = await interaction(
			page,
			"editor.open-symbol-cold",
			async () => {
				await (await openProjectFiles(page))
					.getByRole("link", {
						name: "Open editable-package.ecadsym",
						exact: true,
					})
					.click();
				await expect(page.getByRole("heading", { level: 1 })).toHaveText(
					"Symbol editor · Editable package",
				);
				await expect(
					page.getByRole("button", { name: "Select", exact: true }),
				).toBeEnabled();
				await expect(page.getByTestId("viewport-paper")).toHaveCount(0);
			},
		);
		await (await openProjectFiles(page))
			.getByRole("link", { name: "Workspace home", exact: true })
			.click();
		const timings: number[] = [];
		for (let repeat = 0; repeat < 3; repeat++) {
			timings.push(
				await interaction(page, "editor.open-symbol", async () => {
					await (await openProjectFiles(page))
						.getByRole("link", {
							name: "Open editable-package.ecadsym",
							exact: true,
						})
						.click();
					await expect(page.getByRole("heading", { level: 1 })).toHaveText(
						"Symbol editor · Editable package",
					);
					await expect(
						page.getByRole("button", { name: "Select", exact: true }),
					).toBeEnabled();
					await expect(page.getByTestId("viewport-paper")).toHaveCount(0);
				}),
			);
			await (await openProjectFiles(page))
				.getByRole("link", { name: "Workspace home", exact: true })
				.click();
			timings.push(
				await interaction(page, "editor.open-schematic", async () => {
					await (await openProjectFiles(page))
						.getByRole("link", {
							name: /^(?:Open Drawing|Open Untitled\.ecaddraw)$/,
							exact: true,
						})
						.click();
					await expect(
						page.getByRole("button", { name: "Select", exact: true }),
					).toBeEnabled();
					await expect(page.getByTestId("viewport-paper")).toHaveCount(1);
				}),
			);
			if (repeat < 2)
				await (await openProjectFiles(page))
					.getByRole("link", { name: "Workspace home", exact: true })
					.click();
		}
		await finish(page, testInfo, "editor-symbol-file", {
			coldOpenMs,
			interactionP95Ms: percentile(timings),
		});
		const drawingUrl = page.url();
		await expect
			.poll(() => new URL(page.url()).searchParams.get("file"))
			.toMatch(/\.ecaddraw$/);
		await (await openProjectFiles(page))
			.getByRole("link", { name: "Open editable-package.ecadsym", exact: true })
			.click();
		await expect
			.poll(() => new URL(page.url()).searchParams.get("file"))
			.toMatch(/editable-package\.ecadsym$/);
		const symbolUrl = page.url();
		const historyLength = await page.evaluate(() => history.length);
		const saves = (await report(page)).metrics["project.save"]?.count ?? 0;
		await closeProjectFiles(page);
		await (await toolbarButton(page, "Rectangle")).click();
		await page.mouse.move(600, 300);
		await page.mouse.down();
		await page.mouse.move(710, 400);
		await page.mouse.up();
		await expect
			.poll(
				async () => (await report(page)).metrics["project.save"]?.count ?? 0,
			)
			.toBeGreaterThan(saves);
		await expect(page).toHaveURL(symbolUrl);
		await expect
			.poll(() => page.evaluate(() => history.length))
			.toBe(historyLength);
		await page.goBack();
		await expect(page).toHaveURL(drawingUrl);
		await expect(page.getByTestId("viewport-paper")).toHaveCount(1);
		await page.goForward();
		await expect(page).toHaveURL(symbolUrl);
		await expect(page.getByRole("heading", { level: 1 })).toHaveText(
			"Symbol editor · Editable package",
		);
		await page.reload();
		await expect(page).toHaveURL(symbolUrl);
		await expect(page.getByRole("heading", { level: 1 })).toHaveText(
			"Symbol editor · Editable package",
		);
		await page.evaluate(() => {
			const original = FileSystemFileHandle.prototype.createWritable;
			FileSystemFileHandle.prototype.createWritable = function (...args) {
				if (this.name === ".ecadprj")
					throw new DOMException("Quota exceeded", "QuotaExceededError");
				return original.apply(this, args);
			};
			window.addEventListener(
				"restore-writes",
				() => {
					FileSystemFileHandle.prototype.createWritable = original;
				},
				{ once: true },
			);
		});
		await closeProjectFiles(page);
		await (await toolbarButton(page, "Rectangle")).click();
		await page.mouse.move(650, 350);
		await page.mouse.down();
		await page.mouse.move(760, 450);
		await page.mouse.up();
		await expect(page.getByRole("alert")).toContainText("Quota exceeded");
		await page.goBack();
		await expect(page).toHaveURL(symbolUrl);
		await expect(page.getByRole("heading", { level: 1 })).toHaveText(
			"Symbol editor · Editable package",
		);
		await page.evaluate(() =>
			window.dispatchEvent(new Event("restore-writes")),
		);
		await (await toolbarButton(page, "Undo")).click();
		await expect(page.getByRole("alert")).toHaveCount(0);
		await (await openProjectFiles(page))
			.getByRole("link", {
				name: /^(?:Open Drawing|Open Untitled\.ecaddraw)$/,
				exact: true,
			})
			.click();
		await expect(page).toHaveURL(drawingUrl);
		await expect(page.getByTestId("viewport-paper")).toHaveCount(1);
	},
);
