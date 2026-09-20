import { createHash } from "node:crypto";
import { expect, test, type Page } from "@playwright/test";
import type { Viewer2DSnapshot } from "../../src/components/viewer/types/Viewer2DSnapshot";

const snapshot = async (page: Page): Promise<Viewer2DSnapshot> =>
	JSON.parse((await page.locator("#snapshot").textContent()) || "{}");
const imageHash = (buffer: Buffer) =>
	createHash("sha256").update(buffer).digest("hex");

test("2D hover highlights only the untagged shape under the pointer in either projection", async ({
	page,
}) => {
	await page.goto("/tests/browser/generic-viewers.html");
	const canvas = page.locator("canvas");
	await expect
		.poll(async () => (await snapshot(page)).viewport?.width)
		.toBe(800);
	const bounds = (await canvas.boundingBox())!;
	const moveTo = async (x: number) => {
		const { camera } = await snapshot(page);
		await page.mouse.move(
			bounds.x + bounds.width / 2 + (x - camera.x) * camera.scale,
			bounds.y + bounds.height / 2 + camera.y * camera.scale,
		);
	};
	for (const orthographic of [false, true]) {
		if (orthographic)
			await page.getByRole("button", { name: "Orthographic camera" }).click();
		await page.mouse.move(0, 0);
		await expect.poll(async () => (await snapshot(page)).highlighted).toBe(0);
		const before = imageHash(await canvas.screenshot());
		const otherHalf = {
			x: bounds.x + bounds.width / 2,
			y: bounds.y,
			width: bounds.width / 2,
			height: bounds.height - 100,
		};
		const otherBefore = imageHash(await page.screenshot({ clip: otherHalf }));
		await moveTo(-12);
		await expect.poll(async () => (await snapshot(page)).highlighted).toBe(1);
		expect(imageHash(await canvas.screenshot())).not.toBe(before);
		expect(imageHash(await page.screenshot({ clip: otherHalf }))).toBe(
			otherBefore,
		);
		await moveTo(0);
		await expect.poll(async () => (await snapshot(page)).highlighted).toBe(0);
		expect(imageHash(await canvas.screenshot())).toBe(before);
		await moveTo(12);
		await expect.poll(async () => (await snapshot(page)).highlighted).toBe(1);
		await page.mouse.down();
		await expect.poll(async () => (await snapshot(page)).highlighted).toBe(0);
		await page.mouse.up();
		await page.mouse.move(0, 0);
		await expect.poll(async () => (await snapshot(page)).highlighted).toBe(0);
	}
});

test("3D model hover brightens a part and clears on leave without modifying the source", async ({
	page,
}) => {
	await page.goto("/tests/browser/generic-viewers.html?3d");
	const canvas = page.locator("canvas");
	await expect(
		page.getByRole("button", { name: "Zoom", exact: true }),
	).toBeEnabled();
	await page.mouse.move(0, 0);
	const before = imageHash(await canvas.screenshot());
	const bounds = (await canvas.boundingBox())!;
	await page.mouse.move(
		bounds.x + bounds.width / 2,
		bounds.y + bounds.height / 2,
	);
	await expect
		.poll(async () => imageHash(await canvas.screenshot()))
		.not.toBe(before);
	await page.mouse.move(0, 0);
	await expect
		.poll(async () => imageHash(await canvas.screenshot()))
		.toBe(before);
	await page.getByRole("button", { name: "Mount", exact: true }).click();
	await expect(canvas).toHaveCount(0);
	await page.getByRole("button", { name: "Mount", exact: true }).click();
	await expect(
		page.getByRole("button", { name: "Zoom", exact: true }),
	).toBeEnabled();
	await page.mouse.move(0, 0);
	expect(imageHash(await canvas.screenshot())).toBe(before);
	await expect(page.getByRole("alert")).toHaveCount(0);
});

test("imported Gerber geometry highlights without component or net attributes", async ({
	page,
}) => {
	await page.goto("/tests/browser/viewer.html");
	await page.locator("input[type=file]").setInputFiles({
		name: "shapes.gbr",
		mimeType: "text/plain",
		buffer: Buffer.from("%FSLAX46Y46*%%MOMM*%%ADD10R,4X4*%D10*X0Y0D03*M02*"),
	});
	await expect(
		page.getByRole("button", { name: "Fit drawing", exact: true }),
	).toBeEnabled();
	const canvas = page.locator("canvas");
	await page.mouse.move(0, 0);
	const before = imageHash(await canvas.screenshot());
	const bounds = (await canvas.boundingBox())!;
	await page.mouse.move(
		bounds.x + bounds.width / 2,
		bounds.y + bounds.height / 2,
	);
	await expect
		.poll(async () => imageHash(await canvas.screenshot()))
		.not.toBe(before);
	await page.mouse.move(0, 0);
	await expect
		.poll(async () => imageHash(await canvas.screenshot()))
		.toBe(before);
	await expect(page.locator("[data-testid=viewer-message]")).toHaveCount(0);
});

test("focused Gerber layers restrict hover and restore other layers when focus clears", async ({
	page,
}) => {
	await page.goto("/tests/browser/viewer.html");
	await page.locator("input[type=file]").setInputFiles(
		[-6, 6].map((x, index) => ({
			name: `${index === 0 ? "lower" : "upper"}.gbr`,
			mimeType: "text/plain",
			buffer: Buffer.from(
				`%FSLAX46Y46*%%MOMM*%%ADD10R,4X4*%D10*X${x * 1e6}Y0D03*M02*`,
			),
		})),
	);
	await expect(page.locator("[data-testid=layer-name]")).toHaveCount(2);
	await expect(
		page.getByRole("button", { name: "Fit drawing", exact: true }),
	).toBeEnabled();
	const canvas = page.locator("canvas");
	const bounds = (await canvas.boundingBox())!;
	const moveTo = async (name: string) => {
		const state = JSON.parse(
			(await page.locator("#scene-state").textContent()) || "{}",
		);
		const layer = state.objects.find(
			(object: { name: string }) => object.name === name,
		);
		const xs = layer.corners.map((point: number[]) => point[0]);
		const ys = layer.corners.map((point: number[]) => point[1]);
		const x = (Math.min(...xs) + Math.max(...xs)) / 2;
		const y = (Math.min(...ys) + Math.max(...ys)) / 2;
		await page.mouse.move(
			bounds.x + ((x + 1) * bounds.width) / 2,
			bounds.y + ((1 - y) * bounds.height) / 2,
		);
	};
	for (const [focused, other] of [
		["lower.gbr", "upper.gbr"],
		["upper.gbr", "lower.gbr"],
	]) {
		await page
			.getByRole("button", { name: `Focus ${focused}`, exact: true })
			.click();
		await expect
			.poll(async () => {
				const state = JSON.parse(
					(await page.locator("#scene-state").textContent()) || "{}",
				);
				return state.objects
					?.filter((object: { hoverEnabled: boolean }) => object.hoverEnabled)
					.map((object: { name: string }) => object.name);
			})
			.toEqual([focused]);
		await page.mouse.move(0, 0);
		const before = imageHash(
			await canvas.screenshot({ animations: "disabled" }),
		);
		await moveTo(other);
		await expect
			.poll(
				async () =>
					JSON.parse((await page.locator("#scene-state").textContent()) || "{}")
						.highlighted,
			)
			.toBe(0);
		expect(imageHash(await canvas.screenshot({ animations: "disabled" }))).toBe(
			before,
		);
		await moveTo(focused);
		await expect
			.poll(async () =>
				imageHash(await canvas.screenshot({ animations: "disabled" })),
			)
			.not.toBe(before);
	}
	await page
		.getByRole("button", { name: "Focus upper.gbr", exact: true })
		.click();
	await expect
		.poll(async () => {
			const state = JSON.parse(
				(await page.locator("#scene-state").textContent()) || "{}",
			);
			return state.objects?.every(
				(object: { hoverEnabled: boolean }) => object.hoverEnabled,
			);
		})
		.toBe(true);
	await page.mouse.move(0, 0);
	const before = imageHash(await canvas.screenshot({ animations: "disabled" }));
	await moveTo("lower.gbr");
	await expect
		.poll(async () =>
			imageHash(await canvas.screenshot({ animations: "disabled" })),
		)
		.not.toBe(before);
	await page.mouse.move(0, 0);
	await expect
		.poll(async () =>
			imageHash(await canvas.screenshot({ animations: "disabled" })),
		)
		.toBe(before);
	await moveTo("upper.gbr");
	await expect
		.poll(async () =>
			imageHash(await canvas.screenshot({ animations: "disabled" })),
		)
		.not.toBe(before);
	await expect(page.locator("[data-testid=viewer-message]")).toHaveCount(0);
});
