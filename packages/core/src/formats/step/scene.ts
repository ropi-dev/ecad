import {
	Box3,
	BufferGeometry,
	Color,
	DoubleSide,
	Float32BufferAttribute,
	Group,
	Mesh,
	MeshStandardMaterial,
	SRGBColorSpace,
} from "three";
import type { StepModel } from "#/formats/step/types/StepModel.ts";

function addMaterialGroup(
	geometry: BufferGeometry,
	start: number,
	count: number,
	materialIndex: number,
) {
	const previous = geometry.groups.at(-1);
	if (
		previous &&
		previous.materialIndex === materialIndex &&
		previous.start + previous.count === start
	)
		previous.count += count;
	else geometry.addGroup(start, count, materialIndex);
}

export function createStepGroup(model: StepModel) {
	const group = new Group();
	try {
		for (const part of model.meshes) {
			const geometry = new BufferGeometry();
			const material = new MeshStandardMaterial({
				color: new Color("#e8b77e"),
				roughness: 0.55,
				metalness: 0.15,
				side: DoubleSide,
			});
			const materials = [material];
			const mesh = new Mesh(geometry, materials);
			group.add(mesh);
			mesh.name = part.name;
			geometry.setAttribute(
				"position",
				new Float32BufferAttribute(part.attributes.position.array, 3),
			);
			geometry.setIndex(part.index.array);
			if (part.attributes.normal)
				geometry.setAttribute(
					"normal",
					new Float32BufferAttribute(part.attributes.normal.array, 3),
				);
			else geometry.computeVertexNormals();
			if (part.color) material.color.setRGB(...part.color, SRGBColorSpace);
			let cursor = 0;
			for (const face of [...(part.brep_faces ?? [])].sort(
				(a, b) => a.first - b.first,
			)) {
				const start = face.first * 3;
				const count = (face.last - face.first + 1) * 3;
				if (start > cursor)
					addMaterialGroup(geometry, cursor, start - cursor, 0);
				let index = 0;
				if (face.color) {
					const color = new Color().setRGB(...face.color, SRGBColorSpace);
					index = materials.findIndex((entry) => entry.color.equals(color));
					if (index < 0) {
						const faceMaterial = material.clone();
						faceMaterial.color.copy(color);
						index = materials.push(faceMaterial) - 1;
					}
				}
				addMaterialGroup(geometry, start, count, index);
				cursor = start + count;
			}
			if (cursor < part.index.array.length)
				addMaterialGroup(geometry, cursor, part.index.array.length - cursor, 0);
		}
		const bounds = new Box3().setFromObject(group);
		if (
			bounds.isEmpty() ||
			![...bounds.min.toArray(), ...bounds.max.toArray()].every(Number.isFinite)
		)
			throw new Error("The STEP model has invalid geometry.");
		bounds.getCenter(group.position).negate();
		// Keep parts independently displayable when scenes are combined.
		for (const part of group.children) part.position.copy(group.position);
		group.position.set(0, 0, 0);
		return group;
	} catch (error) {
		disposeStepGroup(group);
		throw error;
	}
}

export function disposeStepGroup(group: Group) {
	group.traverse((object) => {
		if (object instanceof Mesh) {
			object.geometry.dispose();
			const materials = Array.isArray(object.material)
				? object.material
				: [object.material];
			for (const material of materials) material.dispose();
		}
	});
}
