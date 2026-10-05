import { type ReactNode, type Ref, useCallback } from "react";
import { Mesh, type Object3D } from "three";
import type { ParsedStepFile } from "#/formats/parseStepFile.ts";
import type { Viewer3DHandle } from "../viewer/types/Viewer3DHandle";
import { Viewer3D } from "../viewer/Viewer3D";

/** Applies part controls to the scene returned by the STEP parser. */
export function StepViewer({
	model,
	hidden,
	wireframe,
	ref,
	onReady,
	onError,
	extraControls,
}: {
	model: ParsedStepFile;
	hidden: Set<number>;
	wireframe: boolean;
	ref?: Ref<Viewer3DHandle>;
	onReady: (ready: boolean) => void;
	onError: (message: string) => void;
	extraControls?: ReactNode;
}) {
	const updateScene = useCallback(
		(group: Object3D) => {
			group.children.forEach((object, index) => {
				object.visible = !hidden.has(index);
				if (object instanceof Mesh) {
					const materials = Array.isArray(object.material)
						? object.material
						: [object.material];
					for (const material of materials) material.wireframe = wireframe;
				}
			});
		},
		[hidden, wireframe],
	);
	return (
		<Viewer3D
			ref={ref}
			scene={model.scene}
			updateScene={updateScene}
			onReady={onReady}
			onError={onError}
			extraControls={extraControls}
			ariaLabel="3D STEP model"
		/>
	);
}
