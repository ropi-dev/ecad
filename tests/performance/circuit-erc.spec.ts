import { expect, test } from "@playwright/test";
import { closeProjectFiles } from "../browser/project-files";
import { required } from "../helpers/required.ts";
import { setupAppTests } from "./app-fixture.ts";
import {
	finish,
	interaction,
	metric,
	openCircuitWorkload,
	percentile,
	report,
} from "./app-helpers.ts";

setupAppTests();

test("circuit-erc", { tag: ["@circuit"] }, async ({ page }, testInfo) => {
	await openCircuitWorkload(page, false);
	await closeProjectFiles(page);
	await page
		.getByRole("button", { name: "Electrical rules check", exact: true })
		.click();
	const panel = page.getByRole("region", { name: "Electrical rules check" });
	const times: number[] = [];
	for (let repeat = 0; repeat < 3; repeat++) {
		times.push(
			await interaction(page, "erc-run", async () => {
				await panel
					.getByRole("button", { name: "Run ERC", exact: true })
					.click();
				await expect(panel.getByRole("status")).toHaveText(
					"0 errors, 64 warnings",
				);
				await expect(panel.getByRole("listitem")).toHaveCount(50);
			}),
		);
	}
	await panel.getByRole("button", { name: "Next", exact: true }).click();
	await expect(panel.getByRole("listitem")).toHaveCount(14);
	await panel.getByRole("button", { name: "Previous", exact: true }).click();
	const finding = panel.getByRole("listitem").first().getByRole("button");
	const reference = required((await finding.innerText()).match(/R\d+/))[0];
	await page
		.getByRole("button", { name: `Collapse ${reference}`, exact: true })
		.click();
	await expect(panel.getByRole("status")).toHaveText("0 errors, 64 warnings");
	await finding.click();
	await expect(
		page.getByRole("button", { name: `Collapse ${reference}`, exact: true }),
	).toBeVisible();
	await expect(panel.getByRole("status")).toHaveText("0 errors, 64 warnings");
	const component = page.getByRole("button", {
		name: `Select component ${reference}`,
		exact: true,
	});
	await component.focus();
	await component.press("ArrowRight");
	await expect(panel.getByRole("status")).toHaveText("0 errors, 64 warnings");
	await finding.click();
	await expect(page.locator(".circuit-pin.is-selected")).toHaveCount(1);
	await page.screenshot({ path: "/tmp/ecad-erc-results.png" });
	await page
		.locator(".circuit-pin.is-selected button")
		.click({ button: "right" });
	await page.getByRole("menuitem", { name: "No connect", exact: true }).click();
	await expect(panel.getByRole("status")).toContainText("Circuit changed");
	await expect(panel.getByRole("listitem")).toHaveCount(0);
	// The autosave replaces the circuit with its saved copy; run after it lands.
	await expect(page.locator(".circuit-editor")).toHaveAttribute(
		"data-pending-changes",
		"false",
	);
	await panel.getByRole("button", { name: "Run ERC", exact: true }).click();
	await expect(panel.getByRole("status")).toHaveText("0 errors, 63 warnings");
	await panel
		.getByRole("button", { name: "Close electrical rules check" })
		.click();
	await expect(panel).toHaveCount(0);
	const value = await report(page);
	await finish(page, testInfo, "circuit-erc", {
		interactionP95Ms: percentile(times),
		ercP95Ms: required(metric(value, "circuit.erc")),
	});
});
