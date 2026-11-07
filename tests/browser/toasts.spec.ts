import { expect, test } from "@playwright/test";

/** Stops time once the fixture is ready, so only `clock.runFor` moves it. */
async function pauseClock(page: import("@playwright/test").Page) {
	await page.clock.pauseAt((await page.evaluate(() => Date.now())) + 1000);
}

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

test("replacing a timed toast restarts its lifetime and announcement", async ({
	page,
}) => {
	await page.clock.install();
	await page.goto("/tests/browser/toasts.html");
	await expect(
		page.getByRole("textbox", { name: "Drawing name" }),
	).toBeVisible();
	await pauseClock(page);
	await notify(page, {
		id: "save",
		type: "success",
		title: "First save",
		duration: 1500,
	});
	await page.clock.runFor(1000);
	await notify(page, {
		id: "save",
		type: "success",
		title: "Second save",
		duration: 1500,
	});
	// Radix announces a toast on a later animation frame.
	await page.clock.runFor(50);
	await expect(
		page
			.locator('[role="status"][aria-live="polite"]')
			.filter({ hasText: "Second save" }),
	).toContainText("Second save");
	// 1,800 ms after the first toast, but only 800 ms into the second's lifetime.
	await page.clock.runFor(750);
	await expect(page.getByText("Second save", { exact: true })).toBeVisible();
	await page.clock.runFor(800);
	await expect(page.getByText("Second save", { exact: true })).not.toBeVisible();
});

test("a persistent error replacing a timed success survives the original timeout", async ({
	page,
}) => {
	await page.clock.install();
	await page.goto("/tests/browser/toasts.html");
	await expect(
		page.getByRole("textbox", { name: "Drawing name" }),
	).toBeVisible();
	await pauseClock(page);
	await notify(page, {
		id: "save",
		type: "success",
		title: "Saved",
		duration: 1500,
	});
	await page.clock.runFor(1000);
	await notify(page, { id: "save", type: "error", title: "Save failed" });
	await page.clock.runFor(50);
	await expect(
		page.locator('[role="status"][aria-live="assertive"]'),
	).toContainText("Save failed");
	await page.clock.runFor(1550);
	await expect(page.getByText("Save failed", { exact: true })).toBeVisible();
});

test("all-invalid imports persist as errors and mixed imports report a warning", async ({
	page,
}) => {
	await page.clock.install();
	await page.goto("/tests/browser/toasts.html");
	const input = page.getByLabel("Import test files");
	await input.setInputFiles({
		name: "invalid.bad",
		mimeType: "text/plain",
		buffer: Buffer.from("invalid"),
	});
	const failed = page.locator('.app-toast[data-type="error"]');
	await expect(failed).toContainText("Import failed");
	await page.clock.runFor(5200);
	await expect(failed).toBeVisible();
	await page
		.getByRole("button", { name: "Dismiss Import failed", exact: true })
		.click();
	await input.setInputFiles([
		{
			name: "invalid.bad",
			mimeType: "text/plain",
			buffer: Buffer.from("invalid"),
		},
		{
			name: "valid.good",
			mimeType: "text/plain",
			buffer: Buffer.from("valid"),
		},
	]);
	await expect(page.locator('.app-toast[data-type="warning"]')).toContainText(
		"Import completed with issues",
	);
	await expect(page.getByLabel("Imported count")).toHaveText("1");
});

test("tabbing into a toast restores the previous control after dismissal", async ({
	page,
}) => {
	await page.goto("/tests/browser/toasts.html");
	await page
		.getByRole("button", { name: "Dismiss Ready before mount", exact: true })
		.click();
	await notify(page, { type: "error", title: "Save failed" });
	const input = page.getByLabel("Import test files");
	await input.focus();
	await page.keyboard.press("Tab");
	await expect(page.locator(".app-toast")).toBeFocused();
	await page.keyboard.press("Tab");
	await expect(
		page.getByRole("button", { name: "Dismiss Save failed", exact: true }),
	).toBeFocused();
	await page.keyboard.press("Enter");
	await expect(input).toBeFocused();
});
