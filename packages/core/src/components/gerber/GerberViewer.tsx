import { useCallback, useState } from "react";
import { Box3, type Object3D, Vector3 } from "three";
import type { PlanarObject } from "#/engine/types.ts";
import { stylePlanarObject3D } from "#/engine/planar-object.ts";
import type { ParsedGerberObject } from "#/formats/parseGerberFile.ts";
import { Viewer2D, type Viewer2DProps } from "../viewer/Viewer2D";

// Display spacing in millimetres, independent of physical PCB thickness.
const LAYER_SPACING = 0.1;

/** Applies Gerber layer controls to planar objects in the shared top-view viewport. */
export function GerberViewer({
	scene,
	focusedLayerId,
	...props
}: Omit<Viewer2DProps, "scene" | "updateScene"> & {
	scene: readonly (PlanarObject | ParsedGerberObject)[];
	focusedLayerId?: string;
}) {
	// Display settings do not rebuild geometry or reset the camera.
	const [geometryScene, setGeometryScene] = useState(scene);
	const current = new Map(scene.map((object) => [object.id, object]));
	if (
		geometryScene.length !== scene.length ||
		geometryScene.some((previous) => {
			const next = current.get(previous.id);
			return (
				!next ||
				next.objects !== previous.objects ||
				next.bounds !== previous.bounds ||
				next.color !== previous.color
			);
		})
	)
		setGeometryScene(scene);
	const updateScene = useCallback(
		(group: Object3D) => {
			const entries = new Map(
				scene.map((object, index) => [object.id, { object, index }]),
			);
			const focused = scene.some(
				(object) =>
					object.id === focusedLayerId && object.visible && object.opacity > 0,
			);
			group.children.forEach((mesh, index) => {
				const source = geometryScene[index];
				const entry = source && entries.get(source.id);
				if (!entry) {
					mesh.visible = false;
					return;
				}
				const { object, index: order } = entry;
				mesh.visible = object.visible;
				mesh.userData.hoverEnabled = !focused || object.id === focusedLayerId;
				mesh.position.z = order * LAYER_SPACING;
				// Draw the focused fill last so other layers' X-ray contours cannot tint it.
				mesh.renderOrder =
					focused && object.id === focusedLayerId ? scene.length : order;
				stylePlanarObject3D(
					mesh,
					object.color,
					object.opacity,
					focused && object.id !== focusedLayerId,
				);
			});
			// Center the displayed board on the grid origin without changing source coordinates.
			// Include every layer so visibility and focus changes cannot move the board.
			group.position.set(0, 0, 0);
			const bounds = new Box3().setFromObject(group);
			if (!bounds.isEmpty()) {
				const center = bounds.getCenter(new Vector3());
				group.position.set(-center.x, -center.y, 0);
			}
		},
		[scene, geometryScene, focusedLayerId],
	);
	return (
		<Viewer2D
			ariaLabel="Gerber drawing"
			{...props}
			scene={geometryScene}
			updateScene={updateScene}
		/>
	);
}
