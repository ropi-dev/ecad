import type { Page } from "@playwright/test";
import {
	closeProjectFiles,
	openProjectFiles,
	projectRail,
} from "./project-files";
import { screenPointOfMillimetres } from "./rulers";
import { expect, test } from "./seeded-project";
import { toolbarButton } from "./toolbar";

const padState = async (page: Page) =>
	JSON.parse((await page.locator("#project-document").textContent()) ?? "{}")
		.editorShapes[0];

test("a rectangular pad's corner radius is edited in Attributes and scales with the pad", async ({
	page,
}) => {
	await page.goto("/tests/browser/projects.html");
	await (await openProjectFiles(page))
		.getByRole("link", { name: "Workspace home", exact: true })
		.click();
	await closeProjectFiles(page);
	await projectRail(page)
		.getByRole("button", { name: "Add file", exact: true })
		.click();
	await page
		.getByRole("menuitem", { name: "New footprint", exact: true })
		.click();
	await page.getByRole("dialog").getByRole("textbox").fill("Rounded");
	await page
		.getByRole("button", { name: "Create footprint", exact: true })
		.click();

	await (await toolbarButton(page, "Surface mount pad")).click();
	const pad = await screenPointOfMillimetres(page, 0, 0);
	await page.mouse.move(pad.x, pad.y);
	await page.mouse.click(pad.x, pad.y);
	await page.keyboard.press("Escape");
	await page.mouse.dblclick(pad.x, pad.y);

	const attributes = page.getByRole("complementary", {
		name: "Selection attributes",
	});
	const radius = attributes.getByLabel("Corner radius");
	await expect(radius).toHaveValue("0");
	await radius.fill("0.25");
	await radius.press("Enter");
	await expect
		.poll(async () => (await padState(page)).pad.cornerRatio)
		.toBe(0.25);

	const width = attributes.getByLabel("Width");
	await width.fill("2");
	await width.press("Enter");
	await expect(radius).toHaveValue("0.375");
	expect((await padState(page)).pad.cornerRatio).toBe(0.25);

	await attributes.getByLabel("Pad shape").selectOption("circle");
	await expect(radius).toHaveCount(0);
	await expect
		.poll(async () => (await padState(page)).pad.cornerRatio)
		.toBeUndefined();
});
