import { expect, test } from "@playwright/test";

test("X-ray outlines reduce geometry at board scale and restore detail when zoomed in", async ({
	page,
}) => {
	test.setTimeout(120000);
	await page.goto("/tests/browser/renderer.html");
	const result = await page.evaluate(async () => {
		const objectPath = "/packages/core/src/engine/planar-object.ts";
		const scenePath = "/packages/core/src/engine/scene.ts";
		const parserPath = "/packages/core/src/formats/gerber/index.ts";
		const fixturePath = "/tests/fixtures/demo-gerbers.ts";
		const threePath = "/node_modules/three/build/three.module.js";
		const { createSceneDisplay }: typeof import("#/engine/scene.ts") =
			await import(scenePath);
		const {
			createPlanarObject3D,
			stylePlanarObject3D,
			disposePlanarObject3D,
		}: typeof import("#/engine/planar-object.ts") = await import(
			objectPath
		);
		const { parseGerber }: typeof import("#/formats/gerber/index.ts") =
			await import(parserPath);
		const { demoFiles }: typeof import("../fixtures/demo-gerbers") =
			await import(fixturePath);
		const {
			Scene,
			PerspectiveCamera,
			OrthographicCamera,
			WebGLRenderer,
		}: typeof import("three") = await import(threePath);
		const source = demoFiles.map((file, index) => {
			const object = createPlanarObject3D(
				parseGerber(file.source, file.name).object,
			);
			object.position.z = index * 0.1;
			return object;
		});
		const display = createSceneDisplay(
			source.map((object) => ({ type: "spatial", object })),
		);
		const scene = new Scene();
		scene.add(display.object);
		const renderer = new WebGLRenderer({
			alpha: true,
			antialias: true,
			stencil: true,
		});
		renderer.setSize(1200, 800);
		const camera = new PerspectiveCamera(40, 1.5, 0.000001, 1000);
		camera.position.set(32, 24, 85);
		camera.lookAt(32, 24, 0);
		const sync = () => {
			const gl = renderer.getContext();
			gl.readPixels(
				600,
				400,
				1,
				1,
				gl.RGBA,
				gl.UNSIGNED_BYTE,
				new Uint8Array(4),
			);
		};
		const render = () => {
			display.update(renderer, camera);
			renderer.render(scene, camera);
			sync();
		};
		const outlines = (object: import("three").Object3D) => {
			const meshes: import("three").Mesh[] = [];
			object.traverse((part) => {
				if (
					(part as import("three").Mesh).isMesh &&
					part.userData.planarPart === "outline"
				)
					meshes.push(part as import("three").Mesh);
			});
			return meshes;
		};
		const timings = [];
		try {
			for (const xray of [false, true]) {
				display.object.children.forEach((object, index) =>
					stylePlanarObject3D(object, "#e8b77e", 1, xray && index !== 0),
				);
				for (let i = 0; i < 3; i++) render();
				const frames = [];
				for (let i = 0; i < 7; i++) {
					camera.position.x = 32 + i * 0.1;
					const start = performance.now();
					render();
					frames.push(performance.now() - start);
				}
				frames.sort((a, b) => a - b);
				timings.push({
					xray,
					medianMs: frames[3],
					calls: renderer.info.render.calls,
					triangles: renderer.info.render.triangles,
				});
			}
			const original = source
				.slice(1)
				.flatMap(outlines)
				.map((part) => part.geometry);
			const displayed = display.object.children.slice(1).flatMap(outlines);
			const coarse = displayed.map((part) => part.geometry);
			const reduced = coarse.reduce(
				(sum, geometry) => sum + geometry.getAttribute("instanceStart").count,
				0,
			);
			const full = original.reduce(
				(sum, geometry) => sum + geometry.getAttribute("instanceStart").count,
				0,
			);
			camera.position.z = 0.5001;
			display.update(renderer, camera);
			const perspectiveRestored = displayed.every(
				(part, index) => part.geometry === original[index],
			);
			const orthographic = new OrthographicCamera(
				-0.15,
				0.15,
				0.1,
				-0.1,
				0.000001,
				1000,
			);
			orthographic.position.set(32, 24, 85);
			display.update(renderer, orthographic);
			const orthographicRestored = displayed.every(
				(part, index) => part.geometry === original[index],
			);
			camera.position.z = 85;
			display.update(renderer, camera);
			const reused = displayed.every(
				(part, index) => part.geometry === coarse[index],
			);
			display.dispose();
			source.forEach(disposePlanarObject3D);
			return {
				timings,
				reduced,
				full,
				perspectiveRestored,
				orthographicRestored,
				reused,
				geometriesAfterDispose: renderer.info.memory.geometries,
			};
		} finally {
			renderer.dispose();
			renderer.forceContextLoss();
		}
	});
	console.log(JSON.stringify(result.timings));
	expect(result.timings[0].calls).toBe(6);
	expect(result.timings[1].calls).toBe(16);
	expect(result.timings[1].triangles).toBeLessThan(
		result.timings[0].triangles * 3,
	);
	expect(result.reduced).toBeLessThan(result.full / 4);
	expect(result.perspectiveRestored).toBe(true);
	expect(result.orthographicRestored).toBe(true);
	expect(result.reused).toBe(true);
	expect(result.geometriesAfterDispose).toBe(0);
});
