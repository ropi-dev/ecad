import { expect, type Page, test } from "@playwright/test";
import { openProjectFiles, projectRail } from "../browser/project-files.ts";
import { toolbarButton } from "../browser/toolbar.ts";

// Runs against `vite build` output served by `vite preview`.

const saves = (page: Page) =>
	page.evaluate(
		() =>
			window.__ecadPerformance?.snapshot().metrics["project.save"]?.count ?? 0,
	);

async function editorReady(page: Page) {
	await page.waitForFunction(
		() =>
			document
				.querySelector("h1")
				?.textContent?.startsWith("Schematic editor ·") &&
			document.querySelector<HTMLButtonElement>('button[aria-label="Select"]')
				?.disabled === false &&
			!document.querySelector('[aria-busy="true"]'),
		undefined,
		{ polling: "raf", timeout: 30_000 },
	);
}

test("the built web app opens a drawing, keeps it across a reload and offers no MCP or schematic editor rail button", async ({
	page,
}) => {
	await page.goto("/?perf=1");
	await expect(
		page.getByLabel("Workspace instructions", { exact: true }),
	).toBeVisible();
	await expect(
		projectRail(page).getByRole("link", { name: "Schematic editor" }),
	).toHaveCount(0);

	await (await openProjectFiles(page))
		.getByRole("link", { name: /^Open .+\.ecaddraw$/ })
		.first()
		.click();
	await editorReady(page);

	const before = await saves(page);
	await (await toolbarButton(page, "Rectangle")).click();
	await page.mouse.move(600, 300);
	await page.mouse.down();
	await page.mouse.move(710, 400, { steps: 4 });
	await page.mouse.up();
	await expect.poll(() => saves(page)).toBeGreaterThan(before);

	await page.reload();
	await editorReady(page);
	await page.mouse.move(560, 260);
	await page.mouse.down();
	await page.mouse.move(760, 440, { steps: 4 });
	await page.mouse.up();
	await expect(
		page
			.getByRole("toolbar", { name: /^(Schematic|Symbol) tools$/ })
			.getByRole("button", { name: "Delete", exact: true }),
	).toBeEnabled();

	await expect(
		projectRail(page).getByRole("button", { name: /MCP/ }),
	).toHaveCount(0);
});
