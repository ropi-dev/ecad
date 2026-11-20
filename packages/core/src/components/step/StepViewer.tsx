import type { JSX } from "@solidjs/web";
import { createMemo } from "solid-js";
import { Mesh, type Object3D } from "three";
import type { Viewer3DHandle } from "#/components/viewer/types/Viewer3DHandle.ts";
import { Viewer3D } from "#/components/viewer/Viewer3D.tsx";
import type { ParsedStepFile } from "#/formats/parseStepFile.ts";

/** Applies part controls to the scene returned by the STEP parser. */
export function StepViewer(props: {
	model: ParsedStepFile;
	hidden: Set<number>;
	wireframe: boolean;
	ref?: (handle: Viewer3DHandle) => void;
	onReady: (ready: boolean) => void;
	onError: (message: string) => void;
	extraControls?: JSX.Element;
}) {
	const updateScene = createMemo(() => {
		const hidden = props.hidden;
		const wireframe = props.wireframe;
		return (group: Object3D) => {
			group.children.forEach((object, index) => {
				object.visible = !hidden.has(index);
				if (object instanceof Mesh) {
					const materials = Array.isArray(object.material)
						? object.material
						: [object.material];
					for (const material of materials) material.wireframe = wireframe;
				}
			});
		};
	});
	return (
		<Viewer3D
			ref={(handle: Viewer3DHandle) => props.ref?.(handle)}
			scene={props.model.scene}
			updateScene={updateScene()}
			onReady={(ready: boolean) => props.onReady(ready)}
			onError={(message: string) => props.onError(message)}
			extraControls={props.extraControls}
			ariaLabel="3D STEP model"
		/>
	);
}
