import { expect, test } from "@playwright/test";

test("hovering a trace highlights its connected pads and segments only on the focused layer", async ({
	page,
}) => {
	await page.goto("/tests/browser/viewer.html");
	const source = `%FSLAX46Y46*%%MOMM*%%ADD10C,1*%%ADD11C,2*%
D10*X-4000000Y0D02*X0Y0D01*X4000000Y0D01*
D11*X-4000000Y0D03*X4000000Y0D03*X9000000Y0D03*M02*`;
	await page.locator("input[type=file]").setInputFiles([
		{ name: "trace.gbr", mimeType: "text/plain", buffer: Buffer.from(source) },
		{
			name: "other.gbr",
			mimeType: "text/plain",
			buffer: Buffer.from("%FSLAX46Y46*%%MOMM*%%ADD10R,20X2*%D10*X0Y0D03*M02*"),
		},
	]);
	await expect(page.locator(".layer-name")).toHaveCount(2);
	await expect(
		page.getByRole("button", { name: "Fit drawing", exact: true }),
	).toBeEnabled();
	await page
		.getByRole("button", { name: "Focus trace.gbr", exact: true })
		.click();
	const state = async () =>
		JSON.parse((await page.locator("#scene-state").textContent()) || "{}");
	await expect
		.poll(async () =>
			(await state()).objects
				?.filter((object: { hoverEnabled: boolean }) => object.hoverEnabled)
				.map((object: { name: string }) => object.name),
		)
		.toEqual(["trace.gbr"]);
	const bounds = (await page.locator("canvas").boundingBox())!;
	const moveTo = async (x: number) => {
		const layer = (await state()).objects.find(
			(object: { name: string }) => object.name === "trace.gbr",
		);
		const xs = layer.corners.map((point: number[]) => point[0]);
		const ys = layer.corners.map((point: number[]) => point[1]);
		// The trace layer spans -5 to 10 mm, with all pad centers on Y=0.
		const screenX =
			Math.min(...xs) + ((x + 5) / 15) * (Math.max(...xs) - Math.min(...xs));
		await page.mouse.move(
			bounds.x + ((screenX + 1) * bounds.width) / 2,
			bounds.y +
				((1 - (Math.min(...ys) + Math.max(...ys)) / 2) * bounds.height) / 2,
		);
	};
	for (const x of [-2, 2, 4]) {
		await moveTo(x);
		await expect.poll(async () => (await state()).highlighted).toBe(1);
		await expect
			.poll(async () => (await state()).highlightBounds?.min[0])
			.toBeCloseTo(-5, 2);
		await expect
			.poll(async () => (await state()).highlightBounds?.max[0])
			.toBeCloseTo(5, 2);
	}
	await moveTo(9);
	await expect
		.poll(async () => (await state()).highlightBounds?.min[0])
		.toBeCloseTo(8, 2);
	await moveTo(6.5);
	await expect.poll(async () => (await state()).highlighted).toBe(0);
	await expect(page.locator(".viewer-message")).toHaveCount(0);
});
