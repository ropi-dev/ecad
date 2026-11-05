import { createCircuit } from "@ecad/drawing-core/circuit/model.ts";
import { expect, test } from "@playwright/test";
import { closeProjectFiles, openProjectFiles } from "../browser/project-files";
import { toolbarButton } from "../browser/toolbar";
import { required } from "../helpers/required.ts";
import { setupAppTests } from "./app-fixture.ts";
import { finish, interaction, metric, ready, report } from "./app-helpers.ts";

setupAppTests();

test(
	"net-symbol-reconcile",
	{ tag: ["@circuit", "@editor"] },
	async ({ page }, testInfo) => {
		const { synchronizePcb } = await import("#/circuit/linked-schematic.ts");
		const { createSymbol, symbolDefinitions } = await import(
			"#/drawing/symbols.ts"
		);
		const { normalizeNetSymbol, pinTerminals } = await import(
			"@ecad/drawing-core/drawing/shapes.ts"
		);
		const original = createCircuit("Reconcile", "pcb-main");
		const resistor = required(
			symbolDefinitions.find((definition) => definition.id === "resistor"),
		);
		const definition = { ...resistor, id: "custom-supply", library: undefined };
		const supplies = Array.from({ length: 32 }, (_, index) => {
			const symbol = createSymbol(
				index + 1,
				definition,
				{ x: (index % 4) * 40, y: Math.floor(index / 4) * 30 },
				`N${index + 1}`,
			);
			return {
				...symbol,
				netSymbol: false,
				attributes: {
					...symbol.attributes,
					name: index % 2 ? "BUS_A" : "BUS_B",
					value: "",
				},
			};
		});
		const parts = supplies.map((symbol, index) => {
			const part = createSymbol(
				index + 33,
				resistor,
				{ x: 0, y: 0 },
				`R${index + 1}`,
			);
			const target = pinTerminals(symbol)[0],
				terminal = required(pinTerminals(part).at(-1));
			return { ...part, x: target.x - terminal.x, y: target.y - terminal.y };
		});
		const stale = synchronizePcb(
			original,
			[...supplies, ...parts],
			original,
			symbolDefinitions,
		);
		expect(stale.file.circuit.nets).toHaveLength(32);
		const shapes = stale.shapes.map((shape) =>
			shape.kind === "symbol" && shape.id <= 32
				? normalizeNetSymbol({ ...shape, netSymbol: true })
				: shape,
		);
		await page.goto("/projects?perf=1");
		await ready(page);
		await page.evaluate(
			async ({ circuit, shapes }) => {
				const root = await navigator.storage.getDirectory();
				const directory = await root.getDirectoryHandle("Reconcile", {
					create: true,
				});
				const write = async (name: string, value: string) => {
					const writable = await (
						await directory.getFileHandle(name, { create: true })
					).createWritable();
					await writable.write(value);
					await writable.close();
				};
				await write("drawing.ecaddraw", JSON.stringify({ shapes, circuit }));
				await write(
					".ecadprj",
					'format = "ecad-project"\nversion = 1\nname = "Reconcile"\ndrawing = "drawing.ecaddraw"\nsymbols = []\nassets = []\n[[circuits]]\ncircuit = "drawing.ecaddraw"\n',
				);
				localStorage.setItem("ecad.active-project", "Reconcile");
			},
			{ circuit: stale.file.circuit, shapes },
		);
		await page.reload();
		await ready(page);
		const sidebar = await openProjectFiles(page);
		const openMs = await interaction(page, "net-symbol.reconcile", async () => {
			await sidebar
				.getByRole("link", {
					name: "Open Reconcile.ecaddraw in circuit view",
					exact: true,
				})
				.click();
			await expect(page.locator(".circuit-net")).toHaveCount(2);
			await expect(page.locator(".circuit-component")).toHaveCount(32);
		});
		await closeProjectFiles(page);
		await finish(page, testInfo, "net-symbol-reconcile", {
			openMs,
			syncP95Ms: required(metric(await report(page), "pcb.synchronize")),
		});
		const circuitUrl = page.url();
		await expect
			.poll(() => new URL(page.url()).searchParams.get("view"))
			.toBe("circuit");
		await page.reload();
		await expect(page.locator(".circuit-component")).toHaveCount(32);
		await expect(page).toHaveURL(circuitUrl);
		await page
			.getByRole("button", { name: "Switch to schematic view", exact: true })
			.click();
		await expect(
			page.getByRole("button", { name: "Symbols", exact: true }),
		).toBeEnabled();
		await expect
			.poll(() => new URL(page.url()).searchParams.get("view"))
			.toBeNull();
		await page
			.getByRole("button", { name: "Switch to circuit view", exact: true })
			.click();
		await expect(page.locator(".circuit-component")).toHaveCount(32);
		await expect(page).toHaveURL(circuitUrl);
		await (await openProjectFiles(page))
			.getByRole("button", { name: "Add file", exact: true })
			.click();
		await page
			.getByRole("menuitem", { name: "New drawing", exact: true })
			.click();
		await page.getByLabel("Drawing name", { exact: true }).fill("Other");
		await page
			.getByRole("button", { name: "Create drawing", exact: true })
			.click();
		await expect(
			page.getByRole("button", { name: "Switch to circuit view", exact: true }),
		).toBeEnabled();
		await page
			.getByRole("button", { name: "Switch to circuit view", exact: true })
			.click();
		await expect
			.poll(() => new URL(page.url()).searchParams.get("view"))
			.toBe("circuit");
		const otherUrl = page.url();
		await (await openProjectFiles(page))
			.getByRole("link", { name: "Open Reconcile.ecaddraw", exact: true })
			.click();
		await closeProjectFiles(page);
		await expect(
			page.getByRole("button", { name: "Switch to circuit view", exact: true }),
		).toBeEnabled();
		await expect
			.poll(() => new URL(page.url()).searchParams.get("view"))
			.toBeNull();
		await page.evaluate(() => {
			const original = FileSystemFileHandle.prototype.createWritable;
			const gate = new Promise<void>((resolve) =>
				window.addEventListener("release-writes", () => resolve(), {
					once: true,
				}),
			);
			FileSystemFileHandle.prototype.createWritable = async function (...args) {
				if (this.name === ".ecadprj") {
					document.documentElement.dataset.waitingForWrite = "true";
					await gate;
				}
				return original.apply(this, args);
			};
		});
		await (await toolbarButton(page, "Rectangle")).click();
		await page.mouse.move(600, 300);
		await page.mouse.down();
		await page.mouse.move(710, 400);
		await page.mouse.up();
		await expect(page.locator("html")).toHaveAttribute(
			"data-waiting-for-write",
			"true",
		);
		await page.goBack();
		await expect(page).toHaveURL(otherUrl);
		await page
			.getByRole("button", { name: "Switch to circuit view", exact: true })
			.click();
		await page.evaluate(() =>
			window.dispatchEvent(new Event("release-writes")),
		);
		await expect(page.locator(".circuit-component")).toHaveCount(32);
		await expect(page).toHaveURL(circuitUrl);
		await page
			.getByRole("button", { name: "Switch to schematic view", exact: true })
			.click();
		await expect
			.poll(() => new URL(page.url()).searchParams.get("view"))
			.toBeNull();
		await page
			.getByRole("button", { name: "Switch to circuit view", exact: true })
			.click();
		await expect(page).toHaveURL(circuitUrl);
	},
);
