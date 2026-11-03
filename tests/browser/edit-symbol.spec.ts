import { resolve } from "node:path";
import { captureArtifacts } from "./artifacts";
import { openProjectFiles } from "./project-files";
import { expect, test, type Page } from "@playwright/test";
import { toolbarButton } from "./toolbar";

const documentState = async (page: Page) =>
	JSON.parse((await page.locator("#project-document").textContent())!);

test.use({ viewport: { width: 1440, height: 1000 } });

test("attributes open and save the reusable project symbol definition", async ({
	page,
}) => {
	const errors: string[] = [];
	page.on("pageerror", (error) => errors.push(error.message));
	await page.goto("/tests/browser/projects.html");
	await expect(page.getByLabel("Workspace instructions", { exact: true })).toBeVisible();
	const symbol = {
		format: "ecad-symbol",
		version: 1,
		units: "mm",
		id: "editable-part",
		name: "Editable part",
		description: "Preserve library metadata",
		prefix: "TP",
		value: "Signal",
		shapes: [
			{ kind: "rectangle", x: 0, y: 0, width: 10, height: 6 },
			{ kind: "pin", name: "Signal", x: -6, y: 0 },
		],
	};
	await expect(
		(await openProjectFiles(page)).getByLabel("Add symbol files"),
	).toBeEnabled();
	await (await openProjectFiles(page))
		.getByLabel("Add symbol files")
		.setInputFiles({
			name: "part.ecadsym",
			mimeType: "application/json",
			buffer: Buffer.from(JSON.stringify(symbol)),
		});
	await (await openProjectFiles(page))
		.getByRole("link", { name: "Open Untitled.ecaddraw", exact: true })
		.click();
	await expect(
		page.getByRole("button", { name: "Edit symbol", exact: true }),
	).toHaveCount(0);
	await page.getByRole("button", { name: "Symbols", exact: true }).click();
	await page
		.getByRole("button", { name: "Insert Editable part", exact: true })
		.click();
	await page.locator("canvas").click({ position: { x: 600, y: 450 } });
	// The instance name can differ from the definition name.
	await page
		.getByRole("textbox", { name: "Name", exact: true })
		.fill("Renamed instance");
	await page.getByRole("textbox", { name: "Name", exact: true }).press("Tab");
	const schematic = (await documentState(page)).shapes;
	const edit = page.getByRole("button", { name: "Edit symbol", exact: true });
	await expect(edit).toBeEnabled();
	if (captureArtifacts)
		await page.screenshot({ path: test.info().outputPath("attributes.png") });
	await edit.click();
	await expect(page.getByRole("heading", { level: 1 })).toHaveText(
		"Symbol editor · Editable part",
	);
	await expect(page.getByTestId("viewport-grid").locator("mask")).toHaveCount(
		0,
	);
	await expect(
		page.getByRole("button", { name: "Edit symbol", exact: true }),
	).toHaveCount(0);
	await (await toolbarButton(page, "Rectangle")).click();
	// Span several 50 mil grid cells at the definition's fitted zoom.
	await page.mouse.move(450, 350);
	await page.mouse.down();
	await page.mouse.move(650, 550);
	await page.mouse.up();
	await expect
		.poll(async () => (await documentState(page)).symbols[0].shapes.length)
		.toBe(3);
	const saved = (await documentState(page)).symbols[0];
	expect(saved).toMatchObject({ ...symbol, shapes: expect.any(Array) });
	expect(saved.shapes.slice(0, 2)).toMatchObject(symbol.shapes);
	expect((await documentState(page)).shapes).toEqual(schematic);
	await (await openProjectFiles(page))
		.getByRole("link", { name: "Workspace home", exact: true })
		.click();
	await (await openProjectFiles(page))
		.getByRole("link", { name: "Open Untitled.ecaddraw", exact: true })
		.click();
	await page.getByRole("button", { name: "Symbols", exact: true }).click();
	await page
		.getByRole("button", { name: "Insert Editable part", exact: true })
		.click();
	await page.locator("canvas").click({ position: { x: 450, y: 550 } });
	const updated = (await documentState(page)).shapes;
	expect(updated[0]).toEqual(schematic[0]);
	expect(updated[1].children).toHaveLength(3);
	expect(errors).toEqual([]);
});

test("reusable symbol editing excludes net-symbol placement and role changes", async ({ page }) => {
 await page.goto("/tests/browser/projects.html");
 const file = {format:"ecad-symbol",version:1,units:"mm",id:"geometry-only",name:"Geometry only",description:"",prefix:"U",value:"",shapes:[{kind:"rectangle",x:0,y:0,width:10,height:6}]};
 await (await openProjectFiles(page)).getByLabel("Add symbol files").setInputFiles({name:"geometry-only.ecadsym",mimeType:"application/json",buffer:Buffer.from(JSON.stringify(file))});
 await (await openProjectFiles(page)).getByRole("link",{name:"Open geometry-only.ecadsym",exact:true}).click();
 await expect(page.getByRole("heading",{level:1})).toHaveText("Symbol editor · Geometry only");
 await page.getByRole("button",{name:"Symbols",exact:true}).click();
 const search = page.getByRole("searchbox",{name:"Search symbols",exact:true});
 for (const name of ["Ground","VDD","VCC"]) {
  await search.fill(name);
  await expect(page.getByRole("button",{name:`Insert ${name}`,exact:true})).toHaveCount(0);
 }
 await search.fill("Resistor");
 await page.getByRole("button",{name:"Insert Resistor",exact:true}).click();
 await page.locator("canvas").click({position:{x:600,y:450}});
 await expect(page.getByRole("textbox",{name:"Name",exact:true})).toHaveValue("Resistor");
 await expect(page.getByRole("checkbox",{name:"Net symbol",exact:true})).toHaveCount(0);
 if (captureArtifacts) await page.screenshot({path:resolve("/tmp/ecad-browser-artifacts", test.info().testId, "symbol-geometry-only.png")});
});
