import { expect, type Locator } from "@playwright/test";

export async function expectKeyboardNavigation(
	items: Locator,
	forward: "ArrowDown" | "ArrowRight",
	backward: "ArrowUp" | "ArrowLeft",
) {
	const first = items.first();
	await expect(first).toBeFocused();
	const count = await items.count();
	expect(count).toBeGreaterThan(1);
	for (let index = 1; index < count; index++) {
		await items.nth(index - 1).press(forward);
		await expect(items.nth(index)).toBeFocused();
	}
	await items.last().press(backward);
	await expect(items.nth(count - 2)).toBeFocused();
	await items.nth(count - 2).press("End");
	await expect(items.last()).toBeFocused();
	await items.last().press("Home");
	await expect(first).toBeFocused();
}
