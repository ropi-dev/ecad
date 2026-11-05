import { createCircuit } from "@ecad/drawing-core/circuit/model.ts";
import { instantiateCircuitPart } from "@ecad/drawing-core/circuit/parts.ts";
import { expect, test } from "@playwright/test";
import { closeProjectFiles } from "../browser/project-files";
import { createTestComponent } from "../fixtures/circuit.ts";
import { required } from "../helpers/required.ts";
import { setupAppTests } from "./app-fixture.ts";
import {
	finish,
	interaction,
	metric,
	openComponentWorkload,
	percentile,
	report,
} from "./app-helpers.ts";

setupAppTests();

test("circuit-collapse", async ({ page }, testInfo) => {
	const file = createCircuit("Component workload");
	const device = instantiateCircuitPart(
		{
			id: "device",
			name: "128-pin device",
			prefix: "U",
			value: "",
			pins: Array.from({ length: 128 }, (_, index) => ({
				number: String(index + 1),
				name: `P${index + 1}`,
			})),
		},
		[],
	);
	file.circuit.components.push(device);
	for (let index = 0; index < 2; index++)
		file.circuit.components.push(
			createTestComponent("resistor", file.circuit.components),
		);
	file.circuit.nets.push(
		{
			id: "signal-a",
			names: ["SIGNAL_A"],
			pinIds: [device.pins[0].id, file.circuit.components[1].pins[0].id],
		},
		{
			id: "signal-b",
			names: ["SIGNAL_B"],
			pinIds: [device.pins[99].id, file.circuit.components[2].pins[0].id],
		},
	);
	await openComponentWorkload(page, file);
	await closeProjectFiles(page);
	const times: number[] = [];
	for (let index = 0; index < 3; index++) {
		times.push(
			await interaction(page, "circuit.collapse", async () => {
				await page
					.getByRole("button", { name: "Collapse U1", exact: true })
					.click();
				await page.waitForFunction(
					() =>
						document.querySelectorAll(".circuit-pin").length === 4 &&
						document.querySelectorAll(".circuit-collapsed-anchor").length > 0,
					undefined,
					{ polling: "raf" },
				);
			}),
		);
		times.push(
			await interaction(page, "circuit.expand", async () => {
				await page
					.getByRole("button", { name: "Expand U1", exact: true })
					.click();
				await page.waitForFunction(
					() => document.querySelectorAll(".circuit-pin").length === 132,
					undefined,
					{ polling: "raf" },
				);
			}),
		);
	}
	await expect(page.locator(".circuit-connection")).toHaveCount(4);
	await expect(page.locator(".circuit-editor")).toHaveAttribute(
		"data-pending-changes",
		"false",
	);
	const value = await report(page);
	await finish(page, testInfo, "circuit-collapse", {
		interactionP95Ms: percentile(times),
		graphP95Ms: required(metric(value, "circuit.graph")),
		editP95Ms: required(metric(value, "circuit.edit")),
	});
});
