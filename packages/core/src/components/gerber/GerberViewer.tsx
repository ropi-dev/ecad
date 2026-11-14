import {
	type ReactNode,
	useCallback,
	useEffect,
	useMemo,
	useState,
} from "react";
import { Box3, type Object3D, Vector3 } from "three";
import { TooltipButton } from "#/components/viewer/TooltipButton.tsx";
import { Viewer2D, type Viewer2DProps } from "#/components/viewer/Viewer2D.tsx";
import { viewControlButtonClassName } from "#/components/viewer/viewControlStyles.ts";
import { createHoleMask } from "#/engine/planar-holes.ts";
import {
	getPlanarGeometry,
	stylePlanarObject3D,
} from "#/engine/planar-object.ts";
import type { PlanarObject } from "#/engine/types.ts";
import {
	boardOutline,
	isDrillLayer,
	placeBoardLayers,
} from "#/formats/gerber/board-stack.ts";
import type { ParsedGerberObject } from "#/formats/parseGerberFile.ts";

/** Applies Gerber layer controls to planar objects in the shared viewport. */
export function GerberViewer({
	scene,
	focusedLayerId,
	flat: controlledFlat,
	onFlatChange,
	surfaceZ,
	placeLayers = placeBoardLayers,
	controls,
	...props
}: Omit<
	Viewer2DProps,
	| "scene"
	| "updateScene"
	| "orbit"
	| "gestureOrbit"
	| "onOrbit"
	| "extraControls"
	| "ref"
> & {
	scene: readonly (PlanarObject | ParsedGerberObject)[];
	focusedLayerId?: string;
	flat?: boolean;
	onFlatChange?: (flat: boolean) => void;
	/**
	 * The board height that lies on the grid plane. The board then keeps its
	 * own coordinates instead of centring on the grid origin.
	 */
	surfaceZ?: number;
	placeLayers?: typeof placeBoardLayers;
	controls?: ReactNode;
}) {
	const [ownFlat, setOwnFlat] = useState(true);
	const flat = controlledFlat ?? ownFlat;
	const setFlat = (next: boolean) => {
		setOwnFlat(next);
		onFlatChange?.(next);
	};
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
	const drills = scene.filter(
		(object): object is ParsedGerberObject =>
			object.type === "spatial" && object.visible && isDrillLayer(object),
	);
	const drillKey = drills.map((object) => object.object.uuid).join(",");
	// biome-ignore lint/correctness/useExhaustiveDependencies: the mask follows the visible drill layers, which drillKey names
	const holes = useMemo(
		() =>
			createHoleMask(
				drills.flatMap((object) => getPlanarGeometry(object.object) ?? []),
			),
		[drillKey],
	);
	useEffect(() => () => holes?.dispose(), [holes]);
	const updateScene = useCallback(
		(group: Object3D) => {
			const entries = new Map(
				scene.map((object, index) => [object.id, { object, index }]),
			);
			const focused = scene.some(
				(object) =>
					object.id === focusedLayerId && object.visible && object.opacity > 0,
			);
			const placements = placeLayers(scene);
			const sheet = boardOutline(scene);
			group.children.forEach((mesh, index) => {
				const source = geometryScene[index];
				const entry = source && entries.get(source.id);
				if (!entry) {
					mesh.visible = false;
					return;
				}
				const { object, index: order } = entry;
				const placement = placements[order];
				mesh.visible = object.visible;
				mesh.userData.hoverEnabled = !focused || object.id === focusedLayerId;
				mesh.position.z = placement?.z ?? 0;
				// Draw the focused fill last so other layers' X-ray contours cannot tint it.
				mesh.renderOrder =
					focused && object.id === focusedLayerId
						? 2 * scene.length
						: placement?.through
							? scene.length + order
							: 0;
				stylePlanarObject3D(
					mesh,
					object.color,
					object.opacity,
					focused && object.id !== focusedLayerId,
					placement && { ...placement, sheet, holes },
				);
			});
			group.position.set(0, 0, 0);
			if (surfaceZ !== undefined) {
				group.position.z = -surfaceZ;
				return;
			}
			// Center the displayed board on the grid origin without changing source coordinates.
			// Include every layer so visibility and focus changes cannot move the board.
			const bounds = new Box3().setFromObject(group);
			if (!bounds.isEmpty()) {
				const center = bounds.getCenter(new Vector3());
				group.position.set(-center.x, -center.y, -center.z);
			}
		},
		[scene, geometryScene, focusedLayerId, holes, surfaceZ, placeLayers],
	);
	const toggle = geometryScene.length > 0 && (
		<TooltipButton
			type="button"
			className={`${viewControlButtonClassName} px-2.5`}
			aria-pressed={flat}
			tooltip={flat ? "Show layers in 3D" : "Show the flat top view"}
			onClick={() => setFlat(!flat)}
		>
			2D
		</TooltipButton>
	);
	return (
		<Viewer2D
			ariaLabel="Gerber drawing"
			interactionHint="Drag or swipe to pan, and Shift + drag or Shift + swipe to orbit in 3D. Pinch or Ctrl + scroll to zoom. Arrow keys pan, plus or minus zooms, and F6 fits the scene."
			hoverHighlight={false}
			selectionPosition="top-left"
			scrollableControls={controls === undefined}
			{...props}
			scene={geometryScene}
			updateScene={updateScene}
			orbit={!flat && geometryScene.length > 0}
			gestureOrbit={controlledFlat === undefined && geometryScene.length > 0}
			onOrbit={(orbiting) => setFlat(!orbiting)}
			extraControls={controls ?? toggle}
		/>
	);
}
