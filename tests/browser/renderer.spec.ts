import { expect, test } from "@playwright/test";

for (const mode of ["webgpu", "webgl", "canvas"] as const) {
	test(`preserves Gerber compositing and selection on ${mode}`, async ({
		page,
	}) => {
		const errors: string[] = [];
		page.on("pageerror", (error) => errors.push(error.message));
		await page.goto("/tests/browser/renderer.html");
		const result = await page.evaluate(async (mode) => {
			const path = "/src/engine/three.ts";
			const { ThreeRenderer }: typeof import("../../src/engine/three") =
				await import(path);
			const canvas = document.createElement("canvas");
			document.body.append(canvas);
			const canvasPath = "/src/engine/canvas.ts";
			const { CanvasRenderer }: typeof import("../../src/engine/canvas") =
				await import(canvasPath);
			const engine =
				mode === "canvas"
					? new CanvasRenderer(canvas)
					: await ThreeRenderer.create(canvas, mode === "webgl");
			const backend = "backend" in engine ? engine.backend : "Canvas 2D";
			const failures: string[] = [];
			canvas.addEventListener("renderererror", (event) =>
				failures.push((event as CustomEvent<string>).detail),
			);
			const rect = (
				id: string,
				width: number,
				polarity: "dark" | "clear" = "dark",
				x = 0,
			): import("../../src/engine/types").SceneObject => ({
				id,
				geometry: { type: "rect", x, y: 0, width, height: width },
				polarity,
				attributes: {},
				bounds: {
					minX: x - width / 2,
					maxX: x + width / 2,
					minY: -width / 2,
					maxY: width / 2,
				},
			});
			const layer = (
				id: string,
				color: string,
				objects: import("../../src/engine/types").SceneObject[],
			): import("../../src/engine/types").SceneLayer => ({
				id,
				name: id,
				color,
				objects,
				opacity: 1,
				visible: true,
				metadata: {},
				bounds: { minX: -5, minY: -5, maxX: 5, maxY: 5 },
			});
			const layers = [
				layer("lower", "#0000ff", [rect("base", 10)]),
				layer("upper", "#ff0000", [
					rect("outer", 8),
					rect("hole", 4, "clear"),
					rect("island", 1, "dark", 1),
				]),
			];
			const options: import("../../src/engine/types").RenderOptions = {
				width: 128,
				height: 128,
				pixelRatio: 1,
				camera: { x: 0, y: 0, scale: 8 },
				grid: false,
				background: "#111318",
			};
			const ready = new Promise<void>((resolve) => {
				let count = 0;
				const accept = () => {
					if (++count === 2) {
						canvas.removeEventListener("renderinvalidated", accept);
						resolve();
					}
				};
				canvas.addEventListener("renderinvalidated", accept);
			});
			engine.render(canvas, layers, options);
			if (mode !== "canvas") await ready;
			async function capture(
				next: import("../../src/engine/types").RenderOptions,
			) {
				engine.render(canvas, layers, next);
				const width = canvas.width,
					height = canvas.height;
				if (mode === "canvas")
					return new Uint8Array(
						canvas.getContext("2d")!.getImageData(0, 0, width, height).data,
					);
				if (backend === "WebGPU") {
					const context = canvas.getContext("webgpu")!;
					const { device, format } = context.getConfiguration()!;
					const bytesPerRow = Math.ceil((width * 4) / 256) * 256;
					const buffer = device.createBuffer({
						size: bytesPerRow * height,
						usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
					});
					const encoder = device.createCommandEncoder();
					encoder.copyTextureToBuffer(
						{ texture: context.getCurrentTexture() },
						{ buffer, bytesPerRow },
						{ width, height },
					);
					device.queue.submit([encoder.finish()]);
					await buffer.mapAsync(GPUMapMode.READ);
					const source = new Uint8Array(buffer.getMappedRange());
					const pixels = new Uint8Array(width * height * 4);
					for (let y = 0; y < height; y++)
						pixels.set(
							source.subarray(y * bytesPerRow, y * bytesPerRow + width * 4),
							y * width * 4,
						);
					if (format.startsWith("bgra"))
						for (let i = 0; i < pixels.length; i += 4)
							[pixels[i], pixels[i + 2]] = [pixels[i + 2], pixels[i]];
					buffer.unmap();
					buffer.destroy();
					return pixels;
				}
				const context = canvas.getContext("webgl2")!;
				const source = new Uint8Array(width * height * 4),
					pixels = new Uint8Array(source.length);
				context.readPixels(
					0,
					0,
					width,
					height,
					context.RGBA,
					context.UNSIGNED_BYTE,
					source,
				);
				for (let y = 0; y < height; y++)
					pixels.set(
						source.subarray(
							(height - y - 1) * width * 4,
							(height - y) * width * 4,
						),
						y * width * 4,
					);
				return pixels;
			}
			const pixel = (data: Uint8Array, x: number, y = 64, width = 128) =>
				Array.from(data.slice((y * width + x) * 4, (y * width + x) * 4 + 3));
			const normal = await capture(options);
			const focused = await capture({ ...options, focusedLayerId: "lower" });
			layers[1].opacity = 0.5;
			const dimmed = await capture({ ...options, focusedLayerId: "lower" });
			layers[1].opacity = 1;
			const clipped = await capture({
				...options,
				focusedLayerId: "lower",
				camera: { x: -3, y: 0, scale: 128 },
			});
			const restored = await capture(options);
			layers.reverse();
			const reordered = await capture(options);
			layers.reverse();
			const selected = await capture({
				...options,
				selectedIds: new Set(["outer"]),
			});
			const unselected = await capture(options);
			const mirrored = await capture({ ...options, mirrored: true });
			const panned = await capture({
				...options,
				camera: { ...options.camera, x: 2 },
			});
			layers[1].opacity = 0.5;
			const translucent = await capture(options);
			layers[1].visible = false;
			const hidden = await capture({ ...options, focusedLayerId: "upper" });
			layers[1].visible = true;
			layers[1].opacity = 1;
			const resized = await capture({
				...options,
				width: 192,
				height: 96,
				pixelRatio: 2,
			});
			const dimensions = [canvas.width, canvas.height];
			const resizedIsland = pixel(resized, 208, 96, 384);
			const stats =
				"getDiagnostics" in engine ? engine.getDiagnostics() : undefined;
			engine.dispose();
			engine.dispose();
			canvas.remove();
			return {
				backend,
				dimmed: pixel(dimmed, 32),
				dimmedFill: pixel(dimmed, 40),
				focused: [
					pixel(focused, 32),
					pixel(focused, 40),
					pixel(focused, 47),
					pixel(focused, 52),
					pixel(focused, 68),
					pixel(focused, 72),
				],
				clipped: [pixel(clipped, 0), pixel(clipped, 64), pixel(clipped, 127)],
				restored: pixel(restored, 40),
				reordered: pixel(reordered, 40),
				failures,
				stats,
				dimensions,
				resizedIsland,
				normal: [
					pixel(normal, 8),
					pixel(normal, 28),
					pixel(normal, 40),
					pixel(normal, 52),
					pixel(normal, 72),
				],
				selected: [
					pixel(selected, 40),
					pixel(selected, 52),
					pixel(selected, 72),
				],
				unselected: pixel(unselected, 40),
				mirrored: [pixel(mirrored, 56), pixel(mirrored, 72)],
				panned: [pixel(panned, 56), pixel(panned, 72)],
				translucent: pixel(translucent, 40),
				hidden: pixel(hidden, 40),
			};
		}, mode);
		expect(result.backend).toBe(
			mode === "canvas" ? "Canvas 2D" : mode === "webgl" ? "WebGL 2" : "WebGPU",
		);
		// The red fill is muted to rgb(142, 84, 94) before compositing.
		// GPU blending uses linear color; Canvas blends in sRGB.
		const expectedFill = (opacity: number) =>
			[142, 84, 94].map((value, index) => {
				const srgb = value / 255;
				const channel =
					mode === "canvas" ? srgb : ((srgb + 0.055) / 1.055) ** 2.4;
				const blended = channel * opacity + (index === 2 ? 1 - opacity : 0);
				return Math.round(
					255 *
						(mode === "canvas"
							? blended
							: 1.055 * blended ** (1 / 2.4) - 0.055),
				);
			});
		// A four-pixel outline covers the entire eight-pixel island.
		for (const index of [0, 2, 4, 5]) {
			const fill = result.focused[index];
			expectedFill(0.20).forEach((value, channel) =>
				expect(Math.abs(fill[channel] - value)).toBeLessThanOrEqual(1),
			);
		}
		for (const index of [1]) {
			expectedFill(0.15).forEach((value, channel) =>
				expect(
					Math.abs(result.focused[index][channel] - value),
				).toBeLessThanOrEqual(1),
			);
		}
		expectedFill(0.075).forEach((value, channel) =>
			expect(Math.abs(result.dimmedFill[channel] - value)).toBeLessThanOrEqual(
				1,
			),
		);
		expect(result.focused[3]).toEqual([0, 0, 255]);
		expectedFill(0.10).forEach((value, channel) =>
			expect(Math.abs(result.dimmed[channel] - value)).toBeLessThanOrEqual(1),
		);
		for (const fill of result.clipped) {
			expectedFill(0.15).forEach((value, channel) =>
				expect(Math.abs(fill[channel] - value)).toBeLessThanOrEqual(1),
			);
		}
		expect(result.restored).toEqual([255, 0, 0]);
		expect(result.reordered).toEqual([0, 0, 255]);
		expect(result.failures).toEqual([]);
		expect(errors).toEqual([]);
		expect(result.normal).toEqual([
			[17, 19, 24],
			[0, 0, 255],
			[255, 0, 0],
			[0, 0, 255],
			[255, 0, 0],
		]);
		expect(result.selected).toEqual([
			[255, 255, 255],
			[0, 0, 255],
			[255, 0, 0],
		]);
		expect(result.unselected).toEqual([255, 0, 0]);
		expect(result.mirrored).toEqual([
			[255, 0, 0],
			[0, 0, 255],
		]);
		expect(result.panned).toEqual([
			[255, 0, 0],
			[255, 0, 0],
		]);
		expect(result.translucent[0]).toBeGreaterThan(
			mode === "canvas" ? 120 : 150,
		);
		expect(result.translucent[1]).toBe(0);
		expect(result.translucent[2]).toBeGreaterThan(
			mode === "canvas" ? 120 : 150,
		);
		expect(result.hidden).toEqual([0, 0, 255]);
		expect(result.dimensions).toEqual([384, 192]);
		expect(result.resizedIsland).toEqual([255, 0, 0]);
		if (mode !== "canvas") expect(result.stats?.drawCalls).toBeGreaterThan(2);
	});
}
