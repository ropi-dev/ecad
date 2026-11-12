import { expect, test } from "@playwright/test";
import { closeProjectFiles, openProjectFiles } from "../browser/project-files";
import { required } from "../helpers/required.ts";
import { setupAppTests } from "./app-fixture.ts";
import {
	editorReady,
	finish,
	interaction,
	metric,
	percentile,
	ready,
	report,
} from "./app-helpers.ts";

setupAppTests();

test(
	"project-file-sidebar",
	{ tag: ["@projects"] },
	async ({ page }, testInfo) => {
		await page.goto("/projects?perf=1");
		await ready(page);
		await expect(
			(await openProjectFiles(page)).getByRole("button", {
				name: "Add file",
				exact: true,
			}),
		).toBeEnabled();
		await page.evaluate(async () => {
			const directory = await (
				await navigator.storage.getDirectory()
			).getDirectoryHandle(
				localStorage.getItem("ecad.active-project") ??
					(() => {
						throw new Error("Expected a value");
					})(),
			);
			const handle = await directory.getFileHandle(".ecadprj");
			const manifest = (await (await handle.getFile()).text()).replace(
				/^assets\s*=\s*\[\s*\]\s*$/m,
				"",
			);
			const writer = await handle.createWritable();
			await writer.write(
				manifest +
					Array.from(
						{ length: 10000 },
						(_, index) =>
							`\n[[assets]]\npath = "assets/file-${index}.gbr"\nname = "file-${index}.gbr"\nkind = "gerber"\n`,
					).join(""),
			);
			await writer.close();
		});
		await page.reload();
		await ready(page);
		expect(await page.getByRole("alert").count()).toBe(0);
		const sidebar = await openProjectFiles(page);
		await expect(sidebar.getByLabel("Add symbol files")).toBeEnabled();
		await sidebar.getByLabel("Add symbol files").setInputFiles({
			name: "package.ecadsym",
			mimeType: "application/json",
			buffer: Buffer.from(
				JSON.stringify({
					format: "ecad-symbol",
					version: 1,
					units: "mm",
					id: "sidebar-package",
					name: "Sidebar package",
					description: "",
					prefix: "U",
					value: "",
					shapes: Array.from({ length: 128 }, (_, index) => ({
						kind: "pin",
						name: `Pin ${index + 1}`,
						x: index < 64 ? -10 : 10,
						y: (index % 64) - 32,
					})),
				}),
			),
		});
		await sidebar.evaluate((element) => {
			element.setAttribute("data-test-identity", "persistent");
		});
		for (let repeat = 0; repeat < 3; repeat++) {
			await openProjectFiles(page);
			await sidebar.getByLabel("Search project files").fill("sidebar-package");
			await interaction(page, "sidebar.open-symbol", async () => {
				await sidebar
					.getByRole("link", {
						name: "Open sidebar-package.ecadsym",
						exact: true,
					})
					.click();
				await editorReady(page, "Symbol editor · Sidebar package");
			});
			await expect(sidebar).toHaveAttribute("data-test-identity", "persistent");
			await expect(sidebar.getByLabel("Search project files")).toHaveValue(
				"sidebar-package",
			);
			await openProjectFiles(page);
			await sidebar.getByRole("button", { name: "Clear file search" }).click();
			await interaction(page, "sidebar.open-drawing", async () => {
				await sidebar
					.getByRole("link", {
						name: /^(?:Open Drawing|Open Untitled\.ecaddraw)$/,
						exact: true,
					})
					.click();
				await page.waitForFunction(
					() =>
						document
							.querySelector("h1")
							?.textContent?.startsWith("Schematic editor") &&
						document.querySelector<HTMLButtonElement>(
							'button[aria-label="Select"]',
						)?.disabled === false,
					undefined,
					{ polling: "raf" },
				);
			});
			await expect(
				page.getByRole("tree", { name: "Drawing items" }),
			).toHaveCount(0);
		}
		await closeProjectFiles(page);
		await page.mouse.move(900, 400);
		const railNavigationTimes: number[] = [];
		for (let repeat = 0; repeat < 3; repeat++) {
			await openProjectFiles(page);
			await sidebar
				.getByRole("link", { name: "Workspace home", exact: true })
				.click();
			railNavigationTimes.push(
				await interaction(page, "sidebar.rail-navigation", async () => {
					await sidebar
						.getByRole("link", {
							name: /^(?:Open Drawing|Open Untitled\.ecaddraw)$/,
							exact: true,
						})
						.click();
					await page.waitForFunction(
						() =>
							document.querySelector<HTMLButtonElement>(
								'button[aria-label="Select"]',
							)?.disabled === false,
						undefined,
						{ polling: "raf" },
					);
				}),
			);
			await page.mouse.move(900, 400);
			await expect(sidebar).toHaveAttribute("data-open", "false");
			expect(required(await page.locator("canvas").boundingBox()).x).toBe(0);
		}
		const hoverRevealMs = await interaction(
			page,
			"sidebar.reveal",
			async () => {
				await openProjectFiles(page);
			},
		);
		const menuOpenTimes: number[] = [];
		for (let repeat = 0; repeat < 3; repeat++) {
			menuOpenTimes.push(
				await interaction(page, "sidebar.add-file-menu", async () => {
					await sidebar
						.getByRole("button", { name: "Add file", exact: true })
						.click();
					await page.waitForFunction(
						() =>
							document.querySelectorAll('[role="menu"] [role="menuitem"]')
								.length >= 3,
						undefined,
						{ polling: "raf" },
					);
				}),
			);
			await page.keyboard.press("Escape");
			await expect(
				sidebar.getByRole("button", { name: "Add file", exact: true }),
			).toBeFocused();
		}
		const pinTimes: number[] = [];
		for (let repeat = 0; repeat < 3; repeat++) {
			// Closing the menu lets the compact sidebar collapse, so hover it open again.
			await openProjectFiles(page);
			pinTimes.push(
				await interaction(page, "sidebar.pin", async () => {
					await sidebar
						.getByRole("button", { name: "Pin sidebar", exact: true })
						.click();
					await page.waitForFunction(
						() =>
							document.querySelector("canvas")?.getBoundingClientRect().x ===
							256,
						undefined,
						{ polling: "raf" },
					);
				}),
			);
			await page.mouse.move(900, 400);
			await expect(sidebar).toHaveAttribute("data-open", "true");
			if (repeat === 2)
				await page.screenshot({
					path: "perf-artifacts/sidebar-pinned-performance.png",
				});
			await sidebar
				.getByRole("button", { name: "Compact sidebar", exact: true })
				.click();
			await page.waitForFunction(
				() => document.querySelector("canvas")?.getBoundingClientRect().x === 0,
				undefined,
				{ polling: "raf" },
			);
		}
		await page.screenshot({
			path: "perf-artifacts/sidebar-layout-performance.png",
		});
		await page.setViewportSize({ width: 390, height: 844 });
		await closeProjectFiles(page);
		await expect(
			page.getByRole("button", { name: "Select", exact: true }),
		).toBeEnabled();
		await page.getByRole("button", { name: "Show project files" }).click();
		await page.screenshot({
			path: "perf-artifacts/sidebar-layout-performance-mobile.png",
		});
		await closeProjectFiles(page);
		await page.setViewportSize({ width: 1280, height: 800 });
		await page.getByRole("button", { name: "Show project files" }).click();
		const value = await report(page);
		await finish(page, testInfo, "project-file-sidebar", {
			pinMs: percentile(pinTimes),
			hoverRevealMs,
			railNavigationMs: percentile(railNavigationTimes),
			menuOpenMs: percentile(menuOpenTimes),
			interactionP95Ms: required(metric(value, "scenario.interaction")),
		});
	},
);
