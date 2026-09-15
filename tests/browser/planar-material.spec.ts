import { expect, test } from "@playwright/test";

test("mesh X-ray surfaces preserve holes, brighten overlaps and keep screen-sized outlines", async ({
	page,
}) => {
	await page.goto("/tests/browser/renderer.html");
	const result = await page.evaluate(async () => {
		const scenePath = "/src/engine/scene.ts";
		const { createSceneDisplay }: typeof import("../../src/engine/scene") =
			await import(scenePath);
		const objectPath = "/src/engine/planar-object.ts";
		const {
			stylePlanarObject3D,
		}: typeof import("../../src/engine/planar-object") = await import(
			objectPath
		);
		const threePath = "/node_modules/three/build/three.module.js";
		const {
			Scene,
			PerspectiveCamera,
			WebGLRenderer,
			Vector3,
		}: typeof import("three") = await import(threePath);
		const drawing: import("../../src/engine/types").PlanarObject = {
			type: "planar",
			id: "drawing",
			name: "drawing",
			color: "#ff8000",
			visible: true,
			opacity: 1,
			metadata: {},
			bounds: { minX: -4, minY: -4, maxX: 4, maxY: 4 },
			objects: [
				{
					id: "outer",
					geometry: { type: "rect", x: 0, y: 0, width: 8, height: 8 },
					bounds: { minX: -4, minY: -4, maxX: 4, maxY: 4 },
					polarity: "dark",
					attributes: {},
				},
				{
					id: "hole",
					geometry: { type: "rect", x: 0, y: 0, width: 4, height: 4 },
					bounds: { minX: -2, minY: -2, maxX: 2, maxY: 2 },
					polarity: "clear",
					attributes: {},
				},
			],
		};
		const display = createSceneDisplay([drawing, { ...drawing, id: "second" }]);
		const scene = new Scene();
		scene.add(display.object);
		const meshes = display.object.children;
		meshes[1].visible = false;
		const camera = new PerspectiveCamera(40, 1, 0.01, 1000);
		camera.up.set(0, 1, 0);
		const renderer = new WebGLRenderer({
			alpha: true,
			antialias: false,
			stencil: true,
		});
		document.body.append(renderer.domElement);
		const failures: string[] = [];
		display.object.traverse((part) => {
			if ((part as import("three").Mesh).isMesh) {
				const material = (part as import("three").Mesh).material;
				if (!Array.isArray(material) && "map" in material && material.map)
					failures.push("Unexpected image texture");
			}
		});
		const check = (condition: boolean, message: string) => {
			if (!condition) failures.push(message);
		};
		try {
			for (const distance of [20, 30])
				for (const ratio of [1, 2]) {
					renderer.setPixelRatio(ratio);
					renderer.setSize(256, 256);
					camera.position.set(0, 0, distance);
					camera.lookAt(0, 0, 0);
					camera.updateMatrixWorld();
					const width = renderer.domElement.width;
					const projectX = (x: number) =>
						((new Vector3(x, 0, 0).project(camera).x + 1) * width) / 2;
					const sample = (x: number) => {
						const pixel = new Uint8Array(4);
						const gl = renderer.getContext();
						gl.readPixels(
							Math.floor(x),
							width / 2,
							1,
							1,
							gl.RGBA,
							gl.UNSIGNED_BYTE,
							pixel,
						);
						return [...pixel];
					};
					const render = () => {
						renderer.render(scene, camera);
						check(
							renderer.info.memory.textures === 0,
							"mesh display allocates no image textures",
						);
					};
					const outerEdge = projectX(4);
					const innerEdge = projectX(2);
					stylePlanarObject3D(meshes[0], drawing.color, 1, false);
					render();
					const normal = sample(projectX(3));
					stylePlanarObject3D(meshes[0], drawing.color, 1, true);
					render();
					const fill = sample(outerEdge - 10 * ratio);
					const outline = sample(outerEdge - 3 * ratio);
					const holeOutline = sample(innerEdge + 3 * ratio);
					check(
						outline[3] > fill[3] && fill[3] > 0,
						`outline brighter than interior at ${distance}/${ratio}: ${outline} ${fill}`,
					);
					check(
						holeOutline[3] > fill[3],
						`hole outline at ${distance}/${ratio}`,
					);
					check(fill[2] > fill[0], `cool X-ray tint at ${distance}/${ratio}`);
					check(sample(projectX(0))[3] === 0, "clear hole stays empty");
					stylePlanarObject3D(meshes[1], drawing.color, 1, true);
					meshes[1].visible = true;
					render();
					const overlap = sample(outerEdge - 10 * ratio);
					check(overlap[2] > fill[2], "overlaps accumulate light");
					check(sample(projectX(0))[3] === 0, "overlapping holes stay empty");
					meshes[1].visible = false;
					stylePlanarObject3D(meshes[0], drawing.color, 1, false);
					render();
					check(
						sample(projectX(3)).every(
							(value, index) => value === normal[index],
						),
						"clearing focus restores original appearance",
					);
				}
		} finally {
			display.dispose();
			renderer.dispose();
			renderer.forceContextLoss();
		}
		return failures;
	});
	expect(result).toEqual([]);
});
