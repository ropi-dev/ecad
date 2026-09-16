import { expect, test } from "@playwright/test";

test("mesh X-ray surfaces preserve holes, brighten overlaps and combine camera-relative and scene-relative outlines", async ({
	page,
}) => {
	await page.goto("/tests/browser/renderer.html");
	const result = await page.evaluate(async () => {
		const stylePath = "/src/engine/layer-style.ts";
		const {
			UNFOCUSED_CAMERA_OUTLINE_OPACITY,
			UNFOCUSED_OUTLINE_OPACITY,
			UNFOCUSED_OUTLINE_WIDTH,
			UNFOCUSED_OUTLINE_WIDTH_MM,
		} = await import(stylePath);
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
			const widths: number[][] = [];
			for (const [distance, z] of [
				[6, 0],
				[24, 0],
				[24, 18],
				[48, 0],
			])
				for (const ratio of [1, 2]) {
					renderer.setPixelRatio(ratio);
					renderer.setSize(1024, 1024);
					for (const mesh of meshes) mesh.position.z = z;
					camera.position.set(3, 0, distance);
					camera.lookAt(3, 0, 0);
					camera.updateMatrixWorld();
					const width = renderer.domElement.width;
					const projectX = (x: number) =>
						((new Vector3(x, 0, z).project(camera).x + 1) * width) / 2;
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
						display.update(renderer, camera);
						renderer.render(scene, camera);
						check(
							renderer.info.memory.textures === 0,
							"mesh display allocates no image textures",
						);
					};
					stylePlanarObject3D(meshes[0], drawing.color, 1, false);
					render();
					const normal = sample(projectX(3));
					stylePlanarObject3D(meshes[0], drawing.color, 1, true);
					render();
					const fill = sample(projectX(3));
					const outline = sample(projectX(4 - 0.025));
					const holeOutline = sample(projectX(2 + 0.025));
					check(
						Math.abs(
							sample(projectX(4) - 2 * ratio)[3] -
								255 * UNFOCUSED_CAMERA_OUTLINE_OPACITY,
						) <= 1,
						"camera-relative contour retains its stronger opacity where contours overlap",
					);
					if (
						projectX(4) - projectX(4 - 0.04) >
						(UNFOCUSED_OUTLINE_WIDTH + 1) * ratio
					)
						check(
							Math.abs(
								sample(projectX(4 - 0.04))[3] - 255 * UNFOCUSED_OUTLINE_OPACITY,
							) <= 1,
							"scene-relative contour retains its opacity beyond the camera-relative contour",
						);
					check(
						sample(projectX(4) + 2 * ratio)[3] === 0 &&
							sample(projectX(2) - 2 * ratio)[3] === 0,
						"both contours stay inside the filled surface",
					);
					check(
						outline[3] > fill[3] && fill[3] > 0,
						`outline brighter than interior at ${distance}/${z}/${ratio}: ${outline} ${fill}`,
					);
					check(
						holeOutline[3] > fill[3],
						`hole outline at ${distance}/${z}/${ratio}`,
					);
					let outlinePixels = 0;
					for (let x = Math.floor(projectX(3)); x < projectX(4.1); x++) {
						if (sample(x)[3] > fill[3]) outlinePixels++;
					}
					const expectedWidth = Math.max(
						UNFOCUSED_OUTLINE_WIDTH * ratio,
						projectX(4) - projectX(4 - UNFOCUSED_OUTLINE_WIDTH_MM),
					);
					check(
						Math.abs(outlinePixels - expectedWidth) < 1.5,
						`combined outline width at ${distance}/${z}/${ratio}: ${outlinePixels}, expected ${expectedWidth}`,
					);
					widths.push([distance, z, ratio, outlinePixels / ratio]);
					check(
						fill[2] > fill[0],
						`cool X-ray tint at ${distance}/${z}/${ratio}`,
					);
					check(sample(projectX(1.5))[3] === 0, "clear hole stays empty");
					stylePlanarObject3D(meshes[1], drawing.color, 1, true);
					meshes[1].visible = true;
					render();
					const overlap = sample(projectX(3));
					check(overlap[2] > fill[2], "overlaps accumulate light");
					check(sample(projectX(1.5))[3] === 0, "overlapping holes stay empty");
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
			for (const ratio of [1, 2]) {
				const [near, far, raised, distant] = widths.filter(
					(entry) => entry[2] === ratio,
				);
				check(
					Math.abs(far[3] - UNFOCUSED_OUTLINE_WIDTH) < 1 &&
						Math.abs(distant[3] - UNFOCUSED_OUTLINE_WIDTH) < 1,
					"camera-relative outline keeps its CSS width across zoom levels",
				);
				check(
					near[3] > far[3] * 1.5,
					"zoom changes the apparent outline width",
				);
				check(
					raised[3] > far[3] * 1.5,
					"closer object edges have thicker outlines at the same camera position",
				);
				check(raised[3] === near[3], "equal edge depths have equal widths");
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
