import { mkdir } from "node:fs/promises";
import { expect, test } from "@playwright/test";
import { required } from "../helpers/required.ts";
import { captureArtifacts } from "./artifacts";
import { closeProjectFiles, openProjectFiles } from "./project-files";
import { toolbarButton } from "./toolbar";

test("one schematic opens both editors and saves edits in both directions", async ({
	page,
}) => {
	const errors: string[] = [];
	page.on("pageerror", (error) => errors.push(error.message));
	await page.goto("/tests/browser/projects.html");
	await openProjectFiles(page);
	await expect(
		page.getByRole("link", { name: "Open Untitled.ecaddraw", exact: true }),
	).toHaveCount(1);
	await expect(
		page.getByText("Untitled.ecadcircuit", { exact: true }),
	).toHaveCount(0);
	await page
		.getByRole("link", {
			name: "Open Untitled.ecaddraw in circuit view",
			exact: true,
		})
		.click();
	await closeProjectFiles(page);
	await page.getByRole("button", { name: "Components", exact: true }).click();
	await page
		.getByRole("searchbox", { name: "Search components", exact: true })
		.fill("Resistor");
	await page
		.getByRole("button", { name: "Place Resistor", exact: true })
		.click();
	await page
		.getByLabel("Circuit connections graph", { exact: true })
		.click({ position: { x: 350, y: 250 } });
	await expect(page.locator(".circuit-editor")).toHaveAttribute(
		"data-pending-changes",
		"false",
	);
	const circuit = JSON.parse(
		required(await page.locator("#circuit-document").textContent()),
	);
	const schematicSwitch = page.getByRole("button", {
		name: "Switch to schematic view",
		exact: true,
	});
	// The switch sits in the document bar, with the open view pressed.
	const views = page.getByRole("group", { name: "Editor view", exact: true });
	await expect(views.getByRole("button")).toHaveCount(2);
	await expect(schematicSwitch).toHaveAttribute("aria-pressed", "false");
	await expect(
		views.getByRole("button", { name: "Circuit view", exact: true }),
	).toHaveAttribute("aria-pressed", "true");
	await schematicSwitch.click();
	await expect
		.poll(
			async () =>
				JSON.parse(
					required(await page.locator("#project-document").textContent()),
				).shapes.filter((s: { kind: string }) => s.kind === "symbol").length,
		)
		.toBe(1);
	await page.getByRole("button", { name: "Symbols", exact: true }).click();
	await page
		.getByRole("searchbox", { name: "Search symbols" })
		.fill("Resistor");
	await page
		.getByRole("button", { name: "Insert Resistor", exact: true })
		.click();
	await page.locator("canvas").click({ position: { x: 650, y: 350 } });
	await expect
		.poll(
			async () =>
				JSON.parse(
					required(await page.locator("#project-document").textContent()),
				).shapes.filter((shape: { kind: string }) => shape.kind === "symbol")
					.length,
		)
		.toBe(2);
	await expect
		.poll(
			async () =>
				JSON.parse(
					required(await page.locator("#project-document").textContent()),
				).dirty,
		)
		.toBe(false);
	await (await toolbarButton(page, "Undo")).click();
	await expect
		.poll(
			async () =>
				JSON.parse(
					required(await page.locator("#project-document").textContent()),
				).shapes.filter((shape: { kind: string }) => shape.kind === "symbol")
					.length,
		)
		.toBe(1);
	await (await toolbarButton(page, "Redo")).click();
	await expect
		.poll(
			async () =>
				JSON.parse(
					required(await page.locator("#project-document").textContent()),
				).shapes.filter((shape: { kind: string }) => shape.kind === "symbol")
					.length,
		)
		.toBe(2);
	await expect
		.poll(
			async () =>
				JSON.parse(
					required(await page.locator("#project-document").textContent()),
				).dirty,
		)
		.toBe(false);
	await openProjectFiles(page);
	if (captureArtifacts) {
		await mkdir("/tmp/ecad-shared-schematic", { recursive: true });
		await page.screenshot({ path: "/tmp/ecad-shared-schematic/schematic.png" });
	}
	await closeProjectFiles(page);
	const circuitSwitch = page.getByRole("button", {
		name: "Switch to circuit view",
		exact: true,
	});
	await expect(circuitSwitch).toHaveAttribute("aria-pressed", "false");
	await expect(
		page.getByRole("button", { name: "Schematic view", exact: true }),
	).toHaveAttribute("aria-pressed", "true");
	if (captureArtifacts)
		await page.screenshot({
			path: "/tmp/ecad-shared-schematic/toolbar-schematic.png",
		});
	await circuitSwitch.click();
	expect(
		JSON.parse(required(await page.locator("#circuit-document").textContent()))
			.circuit.components[0].id,
	).toBe(circuit.circuit.components[0].id);
	await expect(
		page.getByRole("button", { name: "Select component R2", exact: true }),
	).toBeAttached();
	await page.reload();
	await openProjectFiles(page);
	await page
		.getByRole("link", {
			name: "Open Untitled.ecaddraw in circuit view",
			exact: true,
		})
		.click();
	await expect(
		page.getByRole("button", { name: "Select component R1", exact: true }),
	).toBeAttached();
	if (captureArtifacts)
		await page.screenshot({
			path: "/tmp/ecad-shared-schematic/toolbar-circuit.png",
		});
	expect(errors).toEqual([]);
});

test("toolbar switches keep an additional schematic selected with pending edits", async ({
	page,
}) => {
	await page.goto("/tests/browser/projects.html");
	const sidebar = await openProjectFiles(page);
	await sidebar.getByRole("button", { name: "Add file", exact: true }).click();
	await page
		.getByRole("menuitem", { name: "New circuit", exact: true })
		.click();
	await page.getByLabel("Circuit name", { exact: true }).fill("Power stage");
	await page
		.getByRole("button", { name: "Create circuit", exact: true })
		.click();
	await closeProjectFiles(page);
	await page.getByRole("button", { name: "Components", exact: true }).click();
	await page
		.getByRole("searchbox", { name: "Search components", exact: true })
		.fill("Resistor");
	await page
		.getByRole("button", { name: "Place Resistor", exact: true })
		.click();
	await page
		.getByLabel("Circuit connections graph", { exact: true })
		.click({ position: { x: 350, y: 250 } });
	const component = JSON.parse(
		required(await page.locator("#circuit-document").textContent()),
	).circuit.components[0];
	await page
		.getByRole("button", { name: "Switch to schematic view", exact: true })
		.click();
	await expect(page.getByRole("heading", { level: 1 })).toContainText(
		"Power stage",
	);
	await expect
		.poll(
			async () =>
				JSON.parse(
					required(await page.locator("#project-document").textContent()),
				).editorShapes.filter(
					(shape: { kind: string }) => shape.kind === "symbol",
				).length,
		)
		.toBe(1);
	await page
		.getByRole("button", { name: "Switch to circuit view", exact: true })
		.click();
	await expect(page.getByRole("heading", { level: 1 })).toHaveText(
		"Power stage",
	);
	expect(
		JSON.parse(required(await page.locator("#circuit-document").textContent()))
			.circuit.components[0].id,
	).toBe(component.id);
});

test("view switches carry the selected component between circuit and schematic", async ({
	page,
}) => {
	await page.goto("/tests/browser/projects.html");
	await openProjectFiles(page);
	await page
		.getByRole("link", {
			name: "Open Untitled.ecaddraw in circuit view",
			exact: true,
		})
		.click();
	await closeProjectFiles(page);
	await page.getByRole("button", { name: "Components", exact: true }).click();
	await page
		.getByRole("searchbox", { name: "Search components", exact: true })
		.fill("Resistor");
	await page
		.getByRole("button", { name: "Place Resistor", exact: true })
		.click();
	await page
		.getByLabel("Circuit connections graph", { exact: true })
		.click({ position: { x: 350, y: 250 } });
	await page
		.getByRole("button", { name: "Select component R1", exact: true })
		.click();
	const selectedComponent = page.locator(".circuit-component.is-selected");
	await expect(selectedComponent).toHaveCount(1);
	await page
		.getByRole("button", { name: "Switch to schematic view", exact: true })
		.click();
	const panel = page.getByRole("complementary", {
		name: "Selection attributes",
	});
	await expect(panel.getByText("Resistor · R1", { exact: true })).toBeVisible();
	if (captureArtifacts) {
		await mkdir("/tmp/ecad-selection-sync", { recursive: true });
		await page.screenshot({ path: "/tmp/ecad-selection-sync/schematic.png" });
	}
	await page.getByRole("button", { name: "Symbols", exact: true }).click();
	await page
		.getByRole("searchbox", { name: "Search symbols" })
		.fill("Resistor");
	await page
		.getByRole("button", { name: "Insert Resistor", exact: true })
		.click();
	await page.locator("canvas").click({ position: { x: 650, y: 350 } });
	await expect(panel.getByText("Resistor · R2", { exact: true })).toBeVisible();
	await page
		.getByRole("button", { name: "Switch to circuit view", exact: true })
		.click();
	await expect(
		selectedComponent.getByRole("button", {
			name: "Select component R2",
			exact: true,
		}),
	).toBeAttached();
	if (captureArtifacts)
		await page.screenshot({ path: "/tmp/ecad-selection-sync/circuit.png" });
	await page
		.getByRole("button", { name: "Switch to schematic view", exact: true })
		.click();
	await expect(panel.getByText("Resistor · R2", { exact: true })).toBeVisible();
	// The view fits both resistors tightly; zoom out so the marquee encloses
	// them with their labels.
	const zoomOut = page.getByRole("button", { name: "Zoom out", exact: true });
	await zoomOut.click();
	await zoomOut.click();
	const canvas = required(await page.locator("canvas").boundingBox());
	await page.mouse.move(canvas.x + 230, canvas.y + 90);
	await page.mouse.down();
	await page.mouse.move(canvas.x + 900, canvas.y + 620, { steps: 6 });
	await page.mouse.up();
	await expect(
		panel.getByText("Selected shapes", { exact: true }),
	).toBeVisible();
	await page
		.getByRole("button", { name: "Switch to circuit view", exact: true })
		.click();
	await expect(
		page.getByRole("button", { name: "Select component R1", exact: true }),
	).toBeAttached();
	await expect(selectedComponent).toHaveCount(0);
	await page
		.getByRole("button", { name: "Switch to schematic view", exact: true })
		.click();
	await expect(
		panel.getByText("Selected shapes", { exact: true }),
	).toBeVisible();
	await page
		.getByRole("button", { name: "Switch to circuit view", exact: true })
		.click();
	await page
		.getByRole("button", { name: "Select component R1", exact: true })
		.click();
	await expect(selectedComponent).toHaveCount(1);
	await page.keyboard.press("Escape");
	await expect(selectedComponent).toHaveCount(0);
	await page
		.getByRole("button", { name: "Switch to schematic view", exact: true })
		.click();
	await expect(page.locator("canvas")).toBeVisible();
	await expect(panel).toBeHidden();
});
