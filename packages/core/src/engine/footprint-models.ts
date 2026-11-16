import { Group, Matrix4, type Object3D } from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import type { ModelPlacement } from "#/footprint/models.ts";
import { BOARD_COPPER_TOP } from "#/formats/gerber/board-stack.ts";

const templates = new Map<string, Promise<Object3D>>();
let loader: GLTFLoader | undefined;

export function loadModelTemplate(url: string): Promise<Object3D> {
	let template = templates.get(url);
	if (!template) {
		loader ??= new GLTFLoader();
		template = loader.loadAsync(url).then(({ scene }) => scene);
		template.catch(() => templates.delete(url));
		templates.set(url, template);
	}
	return template;
}

const flip = new Matrix4().makeRotationY(Math.PI);
const turn = new Matrix4();

export function modelMatrix(placement: ModelPlacement, target = new Matrix4()) {
	target
		.makeRotationZ(placement.rotation)
		.setPosition(
			placement.x,
			placement.y,
			placement.flipped ? -BOARD_COPPER_TOP : BOARD_COPPER_TOP,
		);
	if (placement.flipped) target.multiply(turn.copy(flip));
	return target;
}

export type ModelPlacer = (
	placements: readonly ModelPlacement[],
	templateFor: (placement: ModelPlacement) => Object3D | undefined,
) => Group;

export function createModelPlacer(): ModelPlacer {
	let copies = new Map<string, { template: Object3D; copy: Object3D }>();
	return (placements, templateFor) => {
		const group = new Group();
		group.name = "Footprint models";
		group.userData.footprintModels = true;
		const kept = new Map<string, { template: Object3D; copy: Object3D }>();
		placements.forEach((placement, index) => {
			const template = templateFor(placement);
			if (!template) return;
			const key = `${index}:${placement.model.library}:${placement.model.id}`;
			let entry = copies.get(key);
			if (entry?.template !== template) {
				const copy = template.clone();
				copy.matrixAutoUpdate = false;
				entry = { template, copy };
			}
			modelMatrix(placement, entry.copy.matrix);
			entry.copy.matrixWorldNeedsUpdate = true;
			kept.set(key, entry);
			group.add(entry.copy);
		});
		copies = kept;
		return group;
	};
}
