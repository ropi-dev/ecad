import type { Page } from "@playwright/test";

const groups: Record<string, string> = {
	Rectangle: "Shapes",
	Circle: "Shapes",
	Triangle: "Shapes",
	Line: "Shapes",
	Text: "Shapes",
	Wire: "Connections",
	Pin: "Connections",
	Undo: "History tools",
	Redo: "History tools",
	History: "History tools",
	"Export PNG": "View tools",
};

/** Open a tool's group when testing the schematic editor. Viewer controls stay direct. */
export async function toolbarButton(page: Page, name: string) {
	await page
		.getByRole("toolbar", { name: /^(View controls|3D view controls)$/ })
		.waitFor();
	const group = groups[name];
	if (group) {
		const toggle = page.getByRole("button", { name: group, exact: true });
		if (
			(await toggle.count()) &&
			(await toggle.getAttribute("aria-expanded")) !== "true"
		)
			await toggle.click();
	}
	return page.getByRole("button", { name, exact: true });
}

export async function toolbarTooltip(page: Page, name: string) {
	await (await toolbarButton(page, name)).hover();
	const tooltip = page.getByRole("tooltip");
	await tooltip.waitFor();
	return tooltip;
}
