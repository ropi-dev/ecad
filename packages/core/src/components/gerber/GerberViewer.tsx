import {
	type ReactNode,
	useCallback,
	useEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import { Box3, type Object3D, Vector3 } from "three";
import { TooltipButton } from "#/components/viewer/TooltipButton.tsx";
import { Viewer2D, type Viewer2DProps } from "#/components/viewer/Viewer2D.tsx";
import { viewControlButtonClassName } from "#/components/viewer/viewControlStyles.ts";
import type { OrbitGesture } from "#/engine/controls3d.ts";
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
import { useViewerTheme } from "#/settings/theme.ts";

const visibleDrills = (scene: readonly (PlanarObject | ParsedGerberObject)[]) =>
	scene.filter(
		(object): object is ParsedGerberObject =>
			object.type === "spatial" && object.visible && isDrillLayer(object),
	);

const drillGeometry = (drills: readonly ParsedGerberObject[]) =>
	drills.flatMap((object) => getPlanarGeometry(object.object) ?? []);

/** Applies Gerber layer controls to planar objects in the shared viewport. */
export function GerberViewer({
	scene,
	focusedLayerId,
	flat: controlledFlat,
	onFlatChange,
	surfaceZ,
	placeLayers = placeBoardLayers,
	orbitGesture = "shift",
	updateFlatScene,
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
	surfaceZ?: number;
	placeLayers?: typeof placeBoardLayers;
	orbitGesture?: OrbitGesture;
	updateFlatScene?: (object: Object3D) => void;
	controls?: ReactNode;
}) {
	const [ownFlat, setOwnFlat] = useState(true);
	const flat = controlledFlat ?? ownFlat;
	const [orbiting, setOrbiting] = useState(false);
	const layersShown = !updateFlatScene || orbiting;
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
			if (!next) return true;
			return next.type === "spatial" && previous.type === "spatial"
				? next.object !== previous.object
				: next.objects !== previous.objects || next.bounds !== previous.bounds;
		})
	)
		setGeometryScene(scene);
	const drills = visibleDrills(scene);
	const drillKey = drills.map((object) => object.object.uuid).join(",");
	const drillRevision = drills.map((object) => object.revision ?? 0).join(",");
	const [maskEpoch, setMaskEpoch] = useState(0);
	// biome-ignore lint/correctness/useExhaustiveDependencies: the mask follows the visible drill layers, which drillKey names; maskEpoch replaces a mask its holes outgrew
	const holes = useMemo(
		() => createHoleMask(drillGeometry(visibleDrills(scene))),
		[drillKey, maskEpoch],
	);
	const repainted = useRef("");
	useEffect(() => () => holes?.dispose(), [holes]);
	const film = useViewerTheme();
	const styleLayers = useCallback(
		(meshes: readonly Object3D[]) => {
			const drilled = `${drillKey}:${maskEpoch}:${drillRevision}`;
			if (holes && repainted.current !== drilled) {
				repainted.current = drilled;
				if (!holes.repaint(drillGeometry(visibleDrills(scene))))
					setMaskEpoch((epoch) => epoch + 1);
			}
			const entries = new Map(
				scene.map((object, index) => [object.id, { object, index }]),
			);
			const focused = scene.some(
				(object) =>
					object.id === focusedLayerId && object.visible && object.opacity > 0,
			);
			const placements = placeLayers(scene);
			const sheet = boardOutline(scene);
			meshes.forEach((mesh, index) => {
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
					film,
				);
			});
		},
		[
			scene,
			geometryScene,
			focusedLayerId,
			holes,
			placeLayers,
			drillKey,
			drillRevision,
			maskEpoch,
			film,
		],
	);
	const updateScene = useCallback(
		(group: Object3D) => {
			const layers = group.children.slice(0, geometryScene.length);
			if (layersShown) styleLayers(layers);
			else for (const mesh of layers) mesh.visible = false;
			updateFlatScene?.(group);
			for (const flatObject of group.children.slice(geometryScene.length))
				flatObject.visible = !layersShown;
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
		[geometryScene, layersShown, styleLayers, updateFlatScene, surfaceZ],
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
			gestureOrbit={
				(controlledFlat === undefined || onFlatChange) &&
				geometryScene.length > 0
					? orbitGesture
					: undefined
			}
			onOrbit={(next) => {
				setOrbiting(next);
				setFlat(!next);
			}}
			extraControls={controls ?? toggle}
		/>
	);
}
