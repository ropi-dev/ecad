import { mkdir } from "node:fs/promises";
import { pinTerminals } from "@ecad/drawing-core/drawing/shapes.ts";
import { createSymbol, symbolDefinitions } from "#/drawing/symbols.ts";
import { required } from "../helpers/required.ts";
import { closeProjectFiles, openProjectFiles } from "./project-files";
import { expect, test } from "./seeded-project";

test("custom project symbols marked as net symbols share their name across save and reload", async ({
	page,
}) => {
	const { parseSymbolFile } = await import(
		"#/components/editor/symbolFormat.ts"
	);
	const { libraryDefinitions } = await import("#/drawing/symbol-file.ts");
	const { selectDrawingShape } = await import("./symbol-items");
	const custom = parseSymbolFile(
		JSON.stringify({
			format: "ecad-symbol",
			version: 1,
			units: "mm",
			id: "custom-net-point",
			name: "Custom net point",
			description: "",
			prefix: "N",
			value: "",
			shapes: [
				{ kind: "rectangle", x: 0, y: 0, width: 6, height: 4 },
				{ kind: "pin", x: -5, y: 0, name: "Terminal", number: "1" },
			],
		}),
	);
	const definition = {
		...libraryDefinitions([custom])[0],
		library: { scope: "project" as const, id: "project-symbols" },
	};
	const resistor = required(
		symbolDefinitions.find((definition) => definition.id === "resistor"),
	);
	const symbols = [-40, 40].map((x, index) => {
		const symbol = createSymbol(
			index + 1,
			definition,
			{ x, y: 0 },
			`N${index + 1}`,
		);
		return {
			...symbol,
			attributes: { ...symbol.attributes, name: "CUSTOM_BUS" },
		};
	});
	const parts = symbols.map((symbol, index) => {
		const part = createSymbol(
			index + 3,
			resistor,
			{ x: 0, y: 0 },
			`R${index + 1}`,
		);
		const target = pinTerminals(symbol)[0],
			terminal = required(pinTerminals(part).at(-1));
		return { ...part, x: target.x - terminal.x, y: target.y - terminal.y };
	});
	await page.goto("/tests/browser/projects.html");
	await expect(page.locator("#project-document")).toContainText(
		'"name":"Untitled"',
	);
	await page.evaluate(
		async ({ shapes, symbols }) => {
			const path = "/packages/web/src/projects/storage.ts";
			const { createWebProjectStorage } = await import(path);
			const storage = createWebProjectStorage();
			const project = await storage.load();
			await storage.save(project.directory, { shapes, symbols });
		},
		{ shapes: [...symbols, ...parts], symbols: [custom] },
	);
	await page.reload();
	await (await openProjectFiles(page))
		.getByRole("link", { name: "Open Untitled.ecaddraw", exact: true })
		.click();
	await closeProjectFiles(page);
	for (const id of [1, 2]) {
		await selectDrawingShape(page, id);
		await page
			.getByRole("checkbox", { name: "Net symbol", exact: true })
			.check();
		await expect(
			page.getByRole("textbox", { name: "Name", exact: true }),
		).toHaveValue("CUSTOM_BUS");
	}
	await page
		.getByRole("button", { name: "Switch to circuit view", exact: true })
		.click();
	await expect(page.locator(".circuit-net")).toHaveCount(1);
	await expect(
		page.getByRole("button", { name: "Net CUSTOM_BUS", exact: true }),
	).toBeAttached();
	await expect(page.locator(".circuit-edge")).toHaveCount(2);
	await expect(page.locator(".circuit-component")).toHaveCount(2);
	await page
		.getByRole("button", { name: "Switch to schematic view", exact: true })
		.click();
	await page.reload();
	await (await openProjectFiles(page))
		.getByRole("link", {
			name: "Open Untitled.ecaddraw in circuit view",
			exact: true,
		})
		.click();
	await closeProjectFiles(page);
	await expect(page.locator(".circuit-net")).toHaveCount(1);
	await expect(page.locator(".circuit-edge")).toHaveCount(2);
	await mkdir("/tmp/ecad-net-merge", { recursive: true });
	await page.screenshot({ path: "/tmp/ecad-net-merge/custom-symbols.png" });
});
