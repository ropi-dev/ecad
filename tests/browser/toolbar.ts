import type { Page } from "@playwright/test";

const groups: Record<string, string> = {
	Rectangle: "Shapes",
	Circle: "Shapes",
	Triangle: "Shapes",
	Line: "Shapes",
	Text: "Shapes",
	Wire: "Connections",
	"Net label": "Connections",
	"Supply label": "Connections",
	Pin: "Connections",
	"No connect": "Connections",
	"Surface mount pad": "Pads and vias",
	"Through-hole pad": "Pads and vias",
	Via: "Pads and vias",
	"Unplated hole": "Pads and vias",
	Track: "Routing",
	"Copper zone": "Routing",
	"Polygon copper zone": "Routing",
	"Export drawing": "Export",
	"Export PNG": "Export",
};

/** Open a tool's group when testing the schematic editor. Viewer controls stay direct. */
export async function toolbarButton(page: Page, name: string) {
	await page
		.getByRole("toolbar", {
			name: /^(View controls|3D view controls|Circuit tools|Schematic tools|Symbol tools|Footprint tools|PCB tools)$/,
		})
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
