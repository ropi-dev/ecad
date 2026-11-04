import { expect, test } from "@playwright/test";
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

test("circuit-graph", async ({ page }, testInfo) => {
	const openMs = await openCircuitWorkload(page);
	const times: number[] = [];
	const component = page.getByRole("button", {
		name: "Select component R1",
		exact: true,
	});
	for (let index = 0; index < 3; index++) {
		const before = await component
			.locator("xpath=../..")
			.getAttribute("transform");
		times.push(
			await interaction(page, "circuit-move", async () => {
				await component.focus();
				await component.press("ArrowRight");
				await expect(component.locator("xpath=../..")).not.toHaveAttribute(
					"transform",
					required(before),
				);
			}),
		);
	}
	await expect(page.locator(".circuit-editor")).toHaveAttribute(
		"data-pending-changes",
		"false",
	);
	const value = await report(page);
	await finish(page, testInfo, "circuit-graph", {
		openMs,
		interactionP95Ms: percentile(times),
		graphP95Ms: required(metric(value, "circuit.graph")),
		editP95Ms: required(metric(value, "circuit.edit")),
	});
});
