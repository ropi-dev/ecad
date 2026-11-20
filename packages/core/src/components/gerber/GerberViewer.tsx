import type { JSX } from "@solidjs/web";
import {
	type Accessor,
	createEffect,
	createMemo,
	createSignal,
	omit,
	Show,
	untrack,
} from "solid-js";
import { Box3, Matrix4, Mesh, type Object3D, Vector3 } from "three";
import { Sparkles } from "#/components/ui/icons.tsx";
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

const layoutOf = (sources: readonly PlanarGeometry[] | undefined) =>
	sources?.map((source) => source.edges.length).join(",");

function useOpeningMask(
	sources: Accessor<readonly PlanarGeometry[] | undefined>,
) {
	const layout = createMemo(() => layoutOf(sources()));
	const [epoch, setEpoch] = createSignal(0);
	// A mask follows its openings' layout and repaints moved openings in place;
	// epoch replaces a mask its openings outgrew.
	const mask = createMemo(() => {
		layout();
		epoch();
		const current = untrack(sources);
		return current && createHoleMask(current);
	});
	createEffect(mask, (shown) => () => shown?.dispose());
	const outgrow = () => setEpoch((next) => next + 1);
	return [mask, outgrow] as const;
}

const drillKeyOf = (drills: readonly ParsedGerberObject[]) =>
	drills.map((object) => object.object.uuid).join(",");

const profileKeyOf = (profile: ReturnType<typeof boardOutline> | undefined) =>
	profile
		? `${profile.minX},${profile.minY},${profile.maxX},${profile.maxY}`
		: "";

type GerberViewerProps = Omit<
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
	focusedLayerIds?: ReadonlySet<string> | undefined;
	flat?: boolean | undefined;
	onFlatChange?: ((flat: boolean) => void) | undefined;
	surfaceZ?: number | undefined;
	placeLayers?: typeof placeBoardLayers;
	orbitGesture?: OrbitGesture;
	updateFlatScene?: ((object: Object3D) => void) | undefined;
	controls?: JSX.Element;
	realistic?: boolean | undefined;
	/** The board's shape for the realistic view; the profile layer's bounds otherwise. */
	boardShape?: BoardShape | undefined;
	models?: { readonly object: Object3D } | undefined;
};

/** Applies Gerber layer controls to planar objects in the shared viewport. */
export function GerberViewer(props: GerberViewerProps) {
	const rest = omit(
		props,
		"scene",
		"focusedLayerIds",
		"flat",
		"onFlatChange",
		"surfaceZ",
		"placeLayers",
		"orbitGesture",
		"updateFlatScene",
		"controls",
		"realistic",
		"boardShape",
		"models",
	);
	const [ownFlat, setOwnFlat] = createSignal(true);
	const flat = () => props.flat ?? ownFlat();
	const [ownRealistic, setOwnRealistic] = createSignal(false);
	const realistic = createMemo(() => props.realistic ?? ownRealistic());
	const [orbiting, setOrbiting] = createSignal(false);
	const layersShown = createMemo(
		() => !props.updateFlatScene || orbiting() || realistic(),
	);
	const setFlat = (next: boolean) => {
		setOwnFlat(next);
		props.onFlatChange?.(next);
	};
	// Display settings do not rebuild geometry or reset the camera.
	const geometryScene = createMemo(() => props.scene, {
		equals: (previous, scene) => {
			const current = new Map(scene.map((object) => [object.id, object]));
			return (
				previous.length === scene.length &&
				!previous.some((shown) => {
					const next = current.get(shown.id);
					if (!next) return true;
					return next.type === "spatial" && shown.type === "spatial"
						? next.object !== shown.object
						: next.objects !== shown.objects || next.bounds !== shown.bounds;
				})
			);
		},
	});
	// The mask follows the visible drill layers, which drillKey names; maskEpoch
	// replaces a mask its holes outgrew.
	const drills = createMemo(() => visibleDrills(props.scene), {
		equals: (a, b) => drillKeyOf(a) === drillKeyOf(b),
	});
	const drillKey = () => drillKeyOf(drills());
	const [maskEpoch, setMaskEpoch] = createSignal(0);
	const holes = createMemo(() => {
		maskEpoch();
		return createHoleMask(drillGeometry(drills()));
	});
	let repainted = "";
	createEffect(holes, (shown) => () => shown?.dispose());
	const openingSources = createMemo(() => {
		if (!realistic()) return undefined;
		const scene = props.scene;
		const openings = props.boardShape?.openings;
		return Object.fromEntries(
			SIDES.map((side): [string, PlanarGeometry[]] => [
				side,
				[
					...drillGeometry(roleObjects(scene, "mask", side === "top" ? 1 : -1)),
					ringGeometry(openings?.[side] ?? []),
				],
			]),
		);
	});
	const [topOpenings, outgrowTop] = useOpeningMask(() => openingSources()?.top);
	const [bottomOpenings, outgrowBottom] = useOpeningMask(
		() => openingSources()?.bottom,
	);
	const profile = createMemo(
		() =>
			realistic() && !props.boardShape?.outline.length
				? boardOutline(props.scene)
				: undefined,
		{ equals: (a, b) => profileKeyOf(a) === profileKeyOf(b) },
	);
	const [buildRealistic, setBuildRealistic] =
		createSignal<typeof createRealisticBoard>();
	const needsRealistic = createMemo(() => realistic() && !buildRealistic());
	createEffect(needsRealistic, (needed) => {
		if (!needed) return;
		let current = true;
		import("#/engine/realistic-board-mesh.ts").then(
			(module) => {
				if (current) setBuildRealistic(() => module.createRealisticBoard);
			},
			() => {
				if (current)
					props.onError?.("Unable to load the realistic board view.");
			},
		);
		return () => {
			current = false;
		};
	});
	const realisticBoard = createMemo(() => {
		const build = buildRealistic();
		if (!realistic() || !build) return undefined;
		const outline = props.boardShape?.outline;
		const fallback = profile();
		const shape = outline?.length
			? outline
			: fallback && boundsPolygon(fallback);
		return shape ? build(shape) : undefined;
	});
	createEffect(realisticBoard, (board) => () => board?.dispose());
	const film = useViewerTheme();
	const updateScene = createMemo(() => {
		const scene = props.scene;
		const shownGeometry = geometryScene();
		const focusedLayerIds = props.focusedLayerIds;
		const mask = holes();
		const placeLayers = props.placeLayers ?? placeBoardLayers;
		const drilledKey = drillKey();
		const drillRevision = visibleDrills(scene)
			.map((object) => object.revision ?? 0)
			.join(",");
		const epoch = maskEpoch();
		const theme = film();
		const isRealistic = realistic();
		const shown = layersShown();
		const updateFlatScene = props.updateFlatScene;
		const surfaceZ = props.surfaceZ;
		const board = realisticBoard();
		const shownModels = isRealistic ? props.models : undefined;
		const top = topOpenings();
		const bottom = bottomOpenings();
		const sources = openingSources();
		const styleLayers = (meshes: readonly Object3D[]) => {
			const drilled = `${drilledKey}:${epoch}:${drillRevision}`;
			if (mask && repainted !== drilled) {
				repainted = drilled;
				if (!mask.repaint(drillGeometry(visibleDrills(scene))))
					setMaskEpoch((next) => next + 1);
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
				isRealistic || !focused || !!focusedLayerIds?.has(id);
			const placements = placeLayers(scene);
			const sheet = isRealistic ? undefined : boardOutline(scene);
			const finish = 2 * scene.length + 1;
			meshes.forEach((mesh, index) => {
				const source = shownGeometry[index];
				const entry = source && entries.get(source.id);
				if (!entry) {
					mesh.visible = false;
					return;
				}
				const { object, index: order } = entry;
				const placement = placements[order];
				const role = boardLayerRole(object).role;
				const look = isRealistic
					? realisticLayerStyle(role, isUnplatedDrillLayer(object))
					: undefined;
				mesh.visible = object.visible && (look?.visible ?? true);
				mesh.userData.hoverEnabled = inFocus(object.id);
				mesh.position.z = placement?.z ?? 0;
				// Draw the focused fill last so other layers' X-ray contours cannot tint it.
				mesh.renderOrder =
					focused && inFocus(object.id) && !isRealistic
						? 2 * scene.length
						: placement?.through
							? scene.length + order
							: isRealistic && role === "legend"
								? finish + 1
								: 0;
				stylePlanarObject3D(
					mesh,
					look?.color ?? object.color,
					isRealistic ? 1 : object.opacity,
					!inFocus(object.id),
					placement && { ...placement, sheet, holes: mask },
					theme,
				);
				tintParts(mesh, look?.color);
			});
		};
		return (group: Object3D) => {
			const layers = group.children.slice(0, shownGeometry.length);
			if (shown) styleLayers(layers);
			else for (const mesh of layers) mesh.visible = false;
			for (const child of group.children.slice(shownGeometry.length))
				if (
					(child.userData.realisticBoard && child !== board?.object) ||
					(child.userData.footprintModels && child !== shownModels?.object)
				)
					group.remove(child);
			updateFlatScene?.(group);
			for (const flatObject of group.children.slice(shownGeometry.length))
				flatObject.visible = !shown;
			if (board) {
				const boardObject = board.object;
				if (boardObject.parent !== group) group.add(boardObject);
				boardObject.visible = shown;
				boardObject.renderOrder = 2 * scene.length + 1;
				for (const side of SIDES) {
					const openingMask = side === "top" ? top : bottom;
					const openingGeometry = sources?.[side];
					if (
						openingMask &&
						openingGeometry &&
						!openingMask.repaint(openingGeometry)
					)
						(side === "top" ? outgrowTop : outgrowBottom)();
				}
				for (const part of boardObject.children) {
					if (!(part instanceof Mesh)) continue;
					const side: (typeof SIDES)[number] | undefined =
						part.userData.realisticMask;
					if (side) {
						part.visible = roleObjects(
							scene,
							"mask",
							side === "top" ? 1 : -1,
						).every((layer) => layer.visible);
						cutHoles(part.material, IDENTITY, side === "top" ? top : bottom);
					} else if (part.userData.realisticPart === "laminate")
						cutHoles(part.material, IDENTITY, mask);
				}
			}
			if (shownModels) {
				const models = shownModels.object;
				if (models.parent !== group) group.add(models);
				models.visible = shown;
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
		};
	});
	const hasGeometry = createMemo(() => geometryScene().length > 0);
	const suppliedControls = () => "controls" in props;
	const defaultControls = () => (
		<Show when={hasGeometry()}>
			<TooltipButton
				type="button"
				class={`${viewControlButtonClassName} px-2.5`}
				aria-pressed={flat() ? "true" : "false"}
				tooltip={flat() ? "Show layers in 3D" : "Show the flat top view"}
				onClick={() => setFlat(!flat())}
			>
				2D
			</TooltipButton>
			<RealisticToggle
				realistic={realistic()}
				onToggle={() => setOwnRealistic(!realistic())}
			/>
		</Show>
	);
	return (
		<Viewer2D
			ariaLabel="Gerber drawing"
			interactionHint="Drag or swipe to pan, and Shift + drag or Shift + swipe to orbit in 3D. Pinch or Ctrl + scroll to zoom. Arrow keys pan, plus or minus zooms, and F6 fits the scene."
			hoverHighlight={false}
			selectionPosition="top-left"
			scrollableControls={!suppliedControls()}
			{...rest}
			showGrid={!realistic()}
			scene={geometryScene()}
			updateScene={updateScene()}
			orbit={!flat() && hasGeometry()}
			gestureOrbit={
				(props.flat === undefined || props.onFlatChange) && hasGeometry()
					? (props.orbitGesture ?? "shift")
					: undefined
			}
			onOrbit={(next: boolean) => {
				setOrbiting(next);
				setFlat(!next);
			}}
			extraControls={suppliedControls() ? props.controls : defaultControls()}
		/>
	);
}

function RealisticToggle(props: {
	realistic: boolean;
	onToggle: () => void;
	disabled?: boolean;
}) {
	return (
		<TooltipButton
			type="button"
			class={viewControlButtonClassName}
			aria-label="Realistic board"
			aria-pressed={props.realistic ? "true" : "false"}
			disabled={props.disabled}
			tooltip={
				props.realistic
					? "Show the layer colors"
					: "Show the board as manufactured"
			}
			onClick={() => props.onToggle()}
		>
			<Sparkles size={18} aria-hidden="true" />
		</TooltipButton>
	);
}
