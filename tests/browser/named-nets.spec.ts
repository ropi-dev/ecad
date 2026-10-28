import { expect, test } from "@playwright/test";
import { toolbarButton } from "./toolbar";

test.use({ viewport: { width: 1440, height: 900 } });

test("place and edit electrical labels without changing ordinary text", async ({ page }) => {
	await page.goto("/tests/browser/editor.html");
	const document = async () => JSON.parse(await page.locator("#editor-document").textContent() || "{}");
	const clickAt = async (x: number, y: number) => {
		const view = JSON.parse(await page.locator("#editor-scene").textContent() || "{}");
		const box = (await page.locator("canvas").boundingBox())!;
		await page.mouse.click(box.x + (1 + view.origin[0] + (view.corner[0] - view.origin[0]) * x / 420) * box.width / 2,
			box.y + (1 - view.origin[1] - (view.corner[1] - view.origin[1]) * y / 297) * box.height / 2);
	};
	await (await toolbarButton(page, "Net label")).click();
	await clickAt(-80, 40);
	await page.getByRole("textbox", { name: "Net name", exact: true }).fill("+3V3");
	await page.getByRole("textbox", { name: "Net name", exact: true }).press("Tab");
	await expect.poll(async () => (await document()).shapes[0]?.text).toBe("+3V3");
	await expect(page.getByLabel("Label role", { exact: true })).toHaveValue("net");
	await page.getByLabel("Label role", { exact: true }).selectOption("supply");
	await expect.poll(async () => (await document()).shapes[0]?.electrical).toBe("supply");
	await expect(page.getByTestId("text-anchor")).toHaveCount(1);
	await (await toolbarButton(page, "Supply label")).click();
	await clickAt(0, 40);
	await expect(page.getByRole("textbox", { name: "Net name", exact: true })).toHaveValue("GND");
	await page.getByRole("textbox", { name: "Net name", exact: true }).fill("+3V3");
	await page.getByRole("textbox", { name: "Net name", exact: true }).press("Tab");
	await expect.poll(async () => (await document()).shapes[1]?.text).toBe("+3V3");
	await page.screenshot({ path: "artifacts/named-nets-editor.png", fullPage: true });
	await page.getByLabel("Label role", { exact: true }).selectOption("text");
	await expect(page.getByRole("textbox", { name: "Text content", exact: true })).toHaveValue("+3V3");
	await expect.poll(async () => (await document()).shapes[1]?.electrical).toBeUndefined();
	await (await toolbarButton(page, "Undo")).click();
	await expect.poll(async () => (await document()).shapes[1]?.electrical).toBe("supply");
	await (await toolbarButton(page, "Wire")).click();
	await clickAt(-80, 40);
	await clickAt(-40, 40);
	await page.keyboard.press("Enter");
	await expect.poll(async () => (await document()).shapes.filter((shape: { kind: string }) => shape.kind === "wire").length).toBe(1);
});
