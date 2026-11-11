import { expect, test } from "@playwright/test";

test("schematic ERC checks the drawing and selects a finding", async ({
	page,
}) => {
	await page.goto("/tests/browser/editor.html");
	const toolbar = page.getByRole("toolbar", {
		name: "Schematic tools",
		exact: true,
	});
	const erc = toolbar.getByRole("button", {
		name: "Electrical rules check",
		exact: true,
	});
	await expect(erc).toBeEnabled();
	await expect(
		toolbar.getByRole("button", { name: "Pan view", exact: true }),
	).toHaveCount(0);

	await toolbar.getByRole("button", { name: "Symbols", exact: true }).click();
	await page
		.getByRole("button", { name: "Insert Capacitor", exact: true })
		.click();
	await page.locator("canvas").click({ position: { x: 600, y: 300 } });
	await page.keyboard.press("Escape");
	const deleteButton = page.getByRole("button", {
		name: "Delete",
		exact: true,
	});
	const attributes = page.getByRole("complementary", {
		name: "Selection attributes",
	});

	await erc.click();
	await expect(erc).toHaveAttribute("aria-pressed", "true");
	const panel = page.getByRole("region", { name: "Electrical rules check" });
	await expect(panel.getByRole("status")).toHaveText(
		"Run checks on this schematic's pin types and connections.",
	);
	await panel.getByRole("button", { name: "Run ERC", exact: true }).click();
	await expect(panel.getByRole("status")).toHaveText("0 errors, 2 warnings");
	await page.locator("canvas").click({ position: { x: 200, y: 600 } });
	await expect(deleteButton).toBeDisabled();
	await panel.getByRole("listitem").first().getByRole("button").click();
	await expect(deleteButton).toBeEnabled();
	await expect(attributes).toHaveCount(0);

	// A finding on a locked symbol still selects it, without unlocking it.
	await toolbar
		.getByRole("button", { name: "Lock selection", exact: true })
		.click();
	await expect(panel.getByRole("status")).toContainText("Schematic changed");
	await panel.getByRole("button", { name: "Run ERC", exact: true }).click();
	await expect(panel.getByRole("status")).toHaveText("0 errors, 2 warnings");
	await page.locator("canvas").click({ position: { x: 200, y: 600 } });
	await expect(deleteButton).toBeDisabled();
	const selectLocked = toolbar.getByRole("button", {
		name: "Select locked items",
		exact: true,
	});
	await expect(selectLocked).toHaveAttribute("aria-pressed", "false");
	await panel.getByRole("listitem").first().getByRole("button").click();
	await expect(deleteButton).toBeEnabled();
	await expect(attributes).toHaveCount(0);
	await expect(selectLocked).toHaveAttribute("aria-pressed", "true");
	await expect(
		toolbar.getByRole("button", { name: "Unlock selection", exact: true }),
	).toBeEnabled();
	await selectLocked.click();
	await expect(deleteButton).toBeDisabled();
	await panel.getByRole("listitem").first().getByRole("button").click();
	await toolbar
		.getByRole("button", { name: "Unlock selection", exact: true })
		.click();
	await panel.getByRole("button", { name: "Run ERC", exact: true }).click();
	await expect(panel.getByRole("status")).toHaveText("0 errors, 2 warnings");

	// Keys pressed inside the panel stay out of the canvas.
	await page.keyboard.press("Delete");
	await expect(panel.getByRole("status")).toHaveText("0 errors, 2 warnings");
	await deleteButton.click();
	await expect(panel.getByRole("status")).toContainText("Schematic changed");
	await panel
		.getByRole("button", { name: "Close electrical rules check" })
		.click();
	await expect(panel).toHaveCount(0);
});
