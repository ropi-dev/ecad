import { expect, type Page, test } from "@playwright/test";
import type { EditorShape } from "#/drawing/shapes.ts";

test.use({
	viewport: { width: 1440, height: 900 },
	permissions: ["clipboard-read", "clipboard-write"],
});

const wireError = "Wire segments must be horizontal or vertical.";
const libraryError = 'Symbol "resistor" is unavailable in library "missing".';

const documentShapes = async (page: Page): Promise<EditorShape[]> =>
	JSON.parse((await page.locator("#editor-document").textContent())!).shapes;

// The clipboard schema accepts this wire, but the drawing command rejects it.
const diagonalWire = JSON.stringify({
	format: "ecad-selection",
	version: 1,
	shapes: [
		{
			id: 1,
			kind: "wire",
			x: 0,
			y: 0,
			width: 10,
			height: 0.25,
			rotation: 0.5,
			lineWidth: 0.25,
		},
	],
});

async function pasteDiagonalWire(page: Page) {
	await page.evaluate(
		(text) => navigator.clipboard.writeText(text),
		diagonalWire,
	);
	await page.locator("canvas").focus();
	await page.keyboard.press("Control+v");
}

async function setResistorLibrary(page: Page, id: string) {
	await page.evaluate(async (id) => {
		const fixturePath = "/tests/browser/editor.tsx";
		const { drawingStore, replaceShapes } = await import(fixturePath);
		const [resistor] = drawingStore.getSnapshot().shapes;
		replaceShapes([{ ...resistor, library: { scope: "user", id } }]);
	}, id);
}

test.beforeEach(async ({ page }) => {
	await page.goto("/tests/browser/editor.html");
	await expect(
		page.getByRole("button", { name: "Select", exact: true }),
	).toBeEnabled();
	await page.getByRole("button", { name: "Symbols", exact: true }).click();
	await page
		.getByRole("button", { name: "Insert Resistor", exact: true })
		.click();
	const box = (await page.locator("canvas").boundingBox())!;
	await page
		.locator("canvas")
		.click({ position: { x: box.width / 2, y: box.height / 2 } });
	await expect(
		page.getByRole("textbox", { name: "Reference", exact: true }),
	).toHaveValue("R1");
});

test("a later command or clipboard action clears a command error, and dismiss hides it", async ({
	page,
}) => {
	const alert = page.getByRole("alert");
	await pasteDiagonalWire(page);
	await expect(alert).toHaveText(wireError);
	expect(await documentShapes(page)).toHaveLength(1);

	await page.keyboard.press("r");
	await expect
		.poll(async () => (await documentShapes(page))[0].rotation)
		.not.toBe(0);
	await expect(alert).toHaveCount(0);

	await pasteDiagonalWire(page);
	await expect(alert).toHaveText(wireError);
	await page.keyboard.press("Control+c");
	await expect(alert).toHaveCount(0);
	// Let the asynchronous image write finish before replacing the clipboard.
	await expect
		.poll(() =>
			page.evaluate(async () =>
				(await navigator.clipboard.read())[0]?.types.includes("image/png"),
			),
		)
		.toBe(true);

	await pasteDiagonalWire(page);
	await expect(alert).toHaveText(wireError);
	await page.screenshot({ path: "/tmp/ecad-editor-command-error.png" });
	const dismiss = page.getByRole("button", {
		name: "Dismiss editor messages",
		exact: true,
	});
	await dismiss.focus();
	await page.keyboard.press("Enter");
	await expect(alert).toHaveCount(0);
	await expect(dismiss).toHaveCount(0);
	await expect(page.locator("canvas")).toBeFocused();
});

test("dismissed library issues stay available until they are resolved", async ({
	page,
}) => {
	const alert = page.getByRole("alert");
	const dismiss = page.getByRole("button", {
		name: "Dismiss editor messages",
		exact: true,
	});
	const showIssues = page.getByRole("button", {
		name: "Show 1 issue",
		exact: true,
	});
	await setResistorLibrary(page, "missing");
	await expect(alert).toHaveText(libraryError);

	await pasteDiagonalWire(page);
	await expect(alert.getByText(wireError, { exact: true })).toBeVisible();
	await expect(alert.getByText(libraryError, { exact: true })).toBeVisible();
	await page.screenshot({ path: "/tmp/ecad-editor-messages.png" });

	await dismiss.click();
	await expect(alert).toHaveCount(0);
	await expect(showIssues).toBeFocused();
	await page.screenshot({ path: "/tmp/ecad-editor-issues-collapsed.png" });

	await page.keyboard.press("Enter");
	await expect(alert).toHaveText(libraryError);
	await expect(dismiss).toBeFocused();
	await dismiss.click();
	await expect(showIssues).toBeVisible();

	// A new message appears without reopening the issue the user dismissed.
	await pasteDiagonalWire(page);
	await expect(alert).toHaveText(wireError);
	await expect(showIssues).toBeVisible();
	await dismiss.click();

	// A resolved issue is forgotten, so its recurrence is announced again.
	await setResistorLibrary(page, "builtin");
	await expect(showIssues).toHaveCount(0);
	await setResistorLibrary(page, "missing");
	await expect(alert).toHaveText(libraryError);
});
