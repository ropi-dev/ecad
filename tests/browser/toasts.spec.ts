import { expect, test } from "@playwright/test";

async function notify(
	page: import("@playwright/test").Page,
	options: {
		title: string;
		type: "success" | "error";
		duration?: number;
		id?: string;
	},
) {
	await page.evaluate(async (options) => {
		const url = "/tests/browser/toasts.tsx";
		const { toastManager } = (await import(
			url
		)) as typeof import("./toasts.tsx");
		toastManager.add(options);
	}, options);
}

test("notifications buffer, preserve focus, pause on hover, and dismiss with the keyboard", async ({
	page,
}) => {
	await page.goto("/tests/browser/toasts.html");
	await expect(
		page.getByText("Ready before mount", { exact: true }),
	).toBeVisible();
	await page
		.getByRole("button", { name: "Dismiss Ready before mount", exact: true })
		.click();
	const input = page.getByRole("textbox", { name: "Drawing name" });
	await input.focus();
	await notify(page, {
		type: "success",
		title: "Project saved",
		duration: 1000,
	});
	await expect(input).toBeFocused();
	const card = page.locator(".app-toast").filter({ hasText: "Project saved" });
	await card.hover();
	await page.waitForTimeout(1300);
	await expect(card).toBeVisible();
	await page.mouse.move(10, 10);
	await expect(card).not.toBeVisible({ timeout: 3000 });
	await notify(page, { type: "error", title: "Project save failed" });
	await page.keyboard.press("F8");
	await expect(page.locator(".app-toast-viewport")).toBeFocused();
	await page.keyboard.press("Tab");
	await page.keyboard.press("Tab");
	await expect(
		page.getByRole("button", {
			name: "Dismiss Project save failed",
			exact: true,
		}),
	).toBeFocused();
	await page.keyboard.press("Enter");
	await expect(
		page.getByText("Project save failed", { exact: true }),
	).not.toBeVisible();
	await expect(input).toBeFocused();
});

test("errors persist and the stack stays bounded on narrow screens", async ({
	page,
}) => {
	await page.setViewportSize({ width: 375, height: 812 });
	await page.clock.install();
	await page.goto("/tests/browser/toasts.html");
	await expect(
		page.getByRole("textbox", { name: "Drawing name" }),
	).toBeVisible();
	await notify(page, { id: "save", type: "error", title: "Save failed" });
	await page.clock.runFor(5200);
	await expect(page.getByText("Save failed", { exact: true })).toBeVisible();
	await notify(page, { id: "save", type: "error", title: "Retry failed" });
	await expect(
		page.getByText("Save failed", { exact: true }),
	).not.toBeVisible();
	for (let index = 0; index < 7; index++)
		await notify(page, { type: "error", title: `Failure ${index}` });
	await expect(page.locator(".app-toast")).toHaveCount(5);
	const bounds = await page.locator(".app-toast-viewport").boundingBox();
	expect(bounds?.x).toBeGreaterThanOrEqual(0);
	expect((bounds?.x ?? 0) + (bounds?.width ?? 0)).toBeLessThanOrEqual(375);
});
