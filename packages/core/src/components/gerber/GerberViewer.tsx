import { Sparkles } from "lucide-react";
import {
	type ReactNode,
	useCallback,
	useEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import { Box3, Matrix4, Mesh, type Object3D, Vector3 } from "three";
import { TooltipButton } from "#/components/viewer/TooltipButton.tsx";
import { Viewer2D, type Viewer2DProps } from "#/components/viewer/Viewer2D.tsx";
import { viewControlButtonClassName } from "#/components/viewer/viewControlStyles.ts";
import type { OrbitGesture } from "#/engine/controls3d.ts";
import type { PlanarGeometry } from "#/engine/planar-geometry.ts";
import { createHoleMask, cutHoles } from "#/engine/planar-holes.ts";
import {
	getPlanarGeometry,
	stylePlanarObject3D,
} from "#/engine/planar-object.ts";
import {
	type BoardShape,
	boundsPolygon,
	realisticLayerStyle,
	ringGeometry,
} from "#/engine/realistic-board.ts";
import type { createRealisticBoard } from "#/engine/realistic-board-mesh.ts";
import type { PlanarObject } from "#/engine/types.ts";
import {
	type BoardLayerRole,
	boardLayerRole,
	boardOutline,
	isDrillLayer,
	isUnplatedDrillLayer,
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

const roleObjects = (
	scene: readonly (PlanarObject | ParsedGerberObject)[],
	role: BoardLayerRole,
	side?: -1 | 1,
) =>
	scene.filter((object): object is ParsedGerberObject => {
		if (object.type !== "spatial") return false;
		const layer = boardLayerRole(object);
		return layer.role === role && (side === undefined || layer.side === side);
	});

const SIDES = ["top", "bottom"] as const;
const IDENTITY = new Matrix4();

const tintParts = (object: Object3D, color: string | undefined) =>
	object.traverse((part) => {
		if (!(part instanceof Mesh) || part.userData.planarPart !== undefined)
			return;
		for (const material of Array.isArray(part.material)
			? part.material
			: [part.material]) {
			if (!("color" in material)) continue;
			if (color) {
				material.userData.untinted ??= material.color.getHex();
				material.color.set(color);
			} else if (material.userData.untinted !== undefined) {
				material.color.setHex(material.userData.untinted);
				delete material.userData.untinted;
			}
		}
	});

function useOpeningMask(sources: readonly PlanarGeometry[] | undefined) {
	const layout = sources?.map((source) => source.edges.length).join(",");
	const [epoch, setEpoch] = useState(0);
	// biome-ignore lint/correctness/useExhaustiveDependencies: a mask follows its openings' layout, which layout names, and repaints moved openings in place; epoch replaces a mask its openings outgrew
	const mask = useMemo(
		() => sources && createHoleMask(sources),
		[layout, epoch],
	);
	useEffect(() => () => mask?.dispose(), [mask]);
	const outgrow = useCallback(() => setEpoch((next) => next + 1), []);
	return [mask, outgrow] as const;
}

/** Applies Gerber layer controls to planar objects in the shared viewport. */
export function GerberViewer({
	scene,
	focusedLayerIds,
	flat: controlledFlat,
	onFlatChange,
	surfaceZ,
	placeLayers = placeBoardLayers,
	orbitGesture = "shift",
	updateFlatScene,
	controls,
	realistic: controlledRealistic,
	boardShape,
	models,
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
	focusedLayerIds?: ReadonlySet<string>;
	flat?: boolean;
	onFlatChange?: (flat: boolean) => void;
	surfaceZ?: number;
	placeLayers?: typeof placeBoardLayers;
	orbitGesture?: OrbitGesture;
	updateFlatScene?: (object: Object3D) => void;
	controls?: ReactNode;
	realistic?: boolean;
	/** The board's shape for the realistic view; the profile layer's bounds otherwise. */
	boardShape?: BoardShape;
	models?: { readonly object: Object3D };
}) {
	const [ownFlat, setOwnFlat] = useState(true);
	const flat = controlledFlat ?? ownFlat;
	const [ownRealistic, setOwnRealistic] = useState(false);
	const realistic = controlledRealistic ?? ownRealistic;
	const [orbiting, setOrbiting] = useState(false);
	const layersShown = !updateFlatScene || orbiting || realistic;
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
	const openings = boardShape?.openings;
	const openingSources = useMemo(
		() =>
			realistic
				? Object.fromEntries(
						SIDES.map((side): [string, PlanarGeometry[]] => [
							side,
							[
								...drillGeometry(
									roleObjects(scene, "mask", side === "top" ? 1 : -1),
								),
								ringGeometry(openings?.[side] ?? []),
							],
						]),
					)
				: undefined,
		[realistic, scene, openings],
	);
	const [topOpenings, outgrowTop] = useOpeningMask(openingSources?.top);
	const [bottomOpenings, outgrowBottom] = useOpeningMask(
		openingSources?.bottom,
	);
	const profile =
		realistic && !boardShape?.outline.length ? boardOutline(scene) : undefined;
	const profileKey = profile
		? `${profile.minX},${profile.minY},${profile.maxX},${profile.maxY}`
		: "";
	const [buildRealistic, setBuildRealistic] =
		useState<typeof createRealisticBoard>();
	const reportError = props.onError;
	useEffect(() => {
		if (!realistic || buildRealistic) return;
		let current = true;
		import("#/engine/realistic-board-mesh.ts").then(
			(module) => {
				if (current) setBuildRealistic(() => module.createRealisticBoard);
			},
			() => {
				if (current) reportError?.("Unable to load the realistic board view.");
			},
		);
		return () => {
			current = false;
		};
	}, [realistic, buildRealistic, reportError]);
	const outline = boardShape?.outline;
	// biome-ignore lint/correctness/useExhaustiveDependencies: profileKey names the fallback outline
	const realisticBoard = useMemo(() => {
		if (!realistic || !buildRealistic) return undefined;
		const shape = outline?.length ? outline : profile && boundsPolygon(profile);
		return shape ? buildRealistic(shape) : undefined;
	}, [realistic, buildRealistic, outline, profileKey]);
	useEffect(() => () => realisticBoard?.dispose(), [realisticBoard]);
	const shownModels = realistic ? models : undefined;
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
					focusedLayerIds?.has(object.id) &&
					object.visible &&
					object.opacity > 0,
			);
			const inFocus = (id: string) =>
				realistic || !focused || !!focusedLayerIds?.has(id);
			const placements = placeLayers(scene);
			const sheet = realistic ? undefined : boardOutline(scene);
			const finish = 2 * scene.length + 1;
			meshes.forEach((mesh, index) => {
				const source = geometryScene[index];
				const entry = source && entries.get(source.id);
				if (!entry) {
					mesh.visible = false;
					return;
				}
				const { object, index: order } = entry;
				const placement = placements[order];
				const role = boardLayerRole(object).role;
				const look = realistic
					? realisticLayerStyle(role, isUnplatedDrillLayer(object))
					: undefined;
				mesh.visible = object.visible && (look?.visible ?? true);
				mesh.userData.hoverEnabled = inFocus(object.id);
				mesh.position.z = placement?.z ?? 0;
				// Draw the focused fill last so other layers' X-ray contours cannot tint it.
				mesh.renderOrder =
					focused && inFocus(object.id) && !realistic
						? 2 * scene.length
						: placement?.through
							? scene.length + order
							: realistic && role === "legend"
								? finish + 1
								: 0;
				stylePlanarObject3D(
					mesh,
					look?.color ?? object.color,
					realistic ? 1 : object.opacity,
					!inFocus(object.id),
					placement && { ...placement, sheet, holes },
					film,
				);
				tintParts(mesh, look?.color);
			});
		},
		[
			scene,
			geometryScene,
			focusedLayerIds,
			holes,
			placeLayers,
			drillKey,
			drillRevision,
			maskEpoch,
			film,
			realistic,
		],
	);
	const updateScene = useCallback(
		(group: Object3D) => {
			const layers = group.children.slice(0, geometryScene.length);
			if (layersShown) styleLayers(layers);
			else for (const mesh of layers) mesh.visible = false;
			for (const child of group.children.slice(geometryScene.length))
				if (
					(child.userData.realisticBoard && child !== realisticBoard?.object) ||
					(child.userData.footprintModels && child !== shownModels?.object)
				)
					group.remove(child);
			updateFlatScene?.(group);
			for (const flatObject of group.children.slice(geometryScene.length))
				flatObject.visible = !layersShown;
			if (realisticBoard) {
				const board = realisticBoard.object;
				if (board.parent !== group) group.add(board);
				board.visible = layersShown;
				board.renderOrder = 2 * scene.length + 1;
				for (const side of SIDES) {
					const mask = side === "top" ? topOpenings : bottomOpenings;
					const sources = openingSources?.[side];
					if (mask && sources && !mask.repaint(sources))
						(side === "top" ? outgrowTop : outgrowBottom)();
				}
				for (const part of board.children) {
					if (!(part instanceof Mesh)) continue;
					const side: (typeof SIDES)[number] | undefined =
						part.userData.realisticMask;
					if (side) {
						part.visible = roleObjects(
							scene,
							"mask",
							side === "top" ? 1 : -1,
						).every((mask) => mask.visible);
						cutHoles(
							part.material,
							IDENTITY,
							side === "top" ? topOpenings : bottomOpenings,
						);
					} else if (part.userData.realisticPart === "laminate")
						cutHoles(part.material, IDENTITY, holes);
				}
			}
			if (shownModels) {
				const models = shownModels.object;
				if (models.parent !== group) group.add(models);
				models.visible = layersShown;
			}
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
		[
			scene,
			geometryScene,
			layersShown,
			styleLayers,
			updateFlatScene,
			surfaceZ,
			realisticBoard,
			shownModels,
			topOpenings,
			bottomOpenings,
			outgrowTop,
			outgrowBottom,
			openingSources,
			holes,
		],
	);
	const toggle = geometryScene.length > 0 && (
		<>
			<TooltipButton
				type="button"
				className={`${viewControlButtonClassName} px-2.5`}
				aria-pressed={flat}
				tooltip={flat ? "Show layers in 3D" : "Show the flat top view"}
				onClick={() => setFlat(!flat)}
			>
				2D
			</TooltipButton>
			<RealisticToggle
				realistic={realistic}
				onToggle={() => setOwnRealistic(!realistic)}
			/>
		</>
	);
	return (
		<Viewer2D
			ariaLabel="Gerber drawing"
			interactionHint="Drag or swipe to pan, and Shift + drag or Shift + swipe to orbit in 3D. Pinch or Ctrl + scroll to zoom. Arrow keys pan, plus or minus zooms, and F6 fits the scene."
			hoverHighlight={false}
			selectionPosition="top-left"
			scrollableControls={controls === undefined}
			{...props}
			showGrid={!realistic}
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

function RealisticToggle({
	realistic,
	onToggle,
	disabled,
}: {
	realistic: boolean;
	onToggle: () => void;
	disabled?: boolean;
}) {
	return (
		<TooltipButton
			type="button"
			className={viewControlButtonClassName}
			aria-label="Realistic board"
			aria-pressed={realistic}
			disabled={disabled}
			tooltip={
				realistic ? "Show the layer colors" : "Show the board as manufactured"
			}
			onClick={onToggle}
		>
			<Sparkles size={18} aria-hidden="true" />
		</TooltipButton>
	);
}
