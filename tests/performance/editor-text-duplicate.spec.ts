import { expect, test } from "@playwright/test";
import { toolbarButton } from "../browser/toolbar";
import { setupAppTests } from "./app-fixture.ts";
import { finish, interaction, metric, ready, report } from "./app-helpers.ts";

setupAppTests();

test("editor-text-duplicate", async ({ page }, testInfo) => {
	await page.goto("/editor?perf=1");
	await ready(page);
	await expect(
		page.getByRole("button", { name: "Select", exact: true }),
	).toBeEnabled();
	await page.getByRole("button", { name: "Snap to grid", exact: true }).click();
	const bounds = (await page.locator("canvas").boundingBox())!;
	const sources = [
		{
			kind: "Net label",
			field: "Net name",
			text: "SIGNAL",
			x: bounds.x + bounds.width * 0.3,
			y: bounds.y + bounds.height * 0.45,
		},
		{
			kind: "Text",
			field: "Text content",
			text: "Board notes",
			x: bounds.x + bounds.width * 0.5,
			y: bounds.y + bounds.height * 0.45,
		},
	];
	for (const source of sources) {
		await (await toolbarButton(page, source.kind)).click();
		await page.mouse.click(source.x, source.y);
		const field = page.getByRole("textbox", {
			name: source.field,
			exact: true,
		});
		await field.fill(source.text);
		await field.press("Tab");
	}
	let expectedId = 3;
	for (const source of sources) {
		for (let repeat = 0; repeat < 3; repeat++) {
			await interaction(page, "text.duplicate", async () => {
				await page.keyboard.down("Alt");
				await page.mouse.move(source.x, source.y);
				await page.mouse.down();
				await page.mouse.move(source.x + 80 + repeat * 40, source.y + 60, {
					steps: 4,
				});
				await page.mouse.up();
				await page.keyboard.up("Alt");
				await page.waitForFunction(
					({ field, text, id }) => {
						const label = Array.from(document.querySelectorAll("dt")).find(
							(item) => item.textContent === "ID",
						);
						return (
							document.querySelector<HTMLTextAreaElement>(
								`textarea[aria-label="${field}"]`,
							)?.value === text &&
							label?.parentElement?.querySelector("dd")?.textContent ===
								String(id)
						);
					},
					{ field: source.field, text: source.text, id: expectedId++ },
				);
			});
		}
	}
	const value = await report(page);
	await finish(page, testInfo, "editor-text-duplicate", {
		interactionP95Ms: metric(value, "scenario.interaction")!,
	});
});
