import { type ComponentType, lazy, Suspense, useState } from "react";
import type {
	Editor2DProps,
	EditorCanvasProps,
} from "#/components/editor/Editor2D.tsx";
import { useDrawingFonts } from "#/components/editor/useDrawingFonts.ts";
import { EditorViewSwitch } from "#/projects/EditorViewSwitch.tsx";
import { useProjectEditor } from "#/projects/ProjectProvider.tsx";

const CircuitEditor = lazy(() =>
	import("#/components/circuit/CircuitEditor.tsx").then((module) => ({
		default: module.CircuitEditor,
	})),
);

export function EditorDocument({
	Canvas,
	...props
}: Editor2DProps & { Canvas: ComponentType<EditorCanvasProps> }) {
	const project = useProjectEditor();
	// A circuit link opens this route while its circuit is still loading.
	// Showing the schematic for that moment would start its viewer, which
	// then keeps that camera, so wait for the circuit that was opening on
	// arrival. A switch from an open schematic keeps it on screen instead.
	const [arrivedOpening] = useState(() => project?.openingCircuit ?? null);
	// Text sizes are measured with the schematic font, so wait for it to load.
	const fontsReady = useDrawingFonts();
	if (!fontsReady) return null;
	const openingCircuit = (
		<output className="block p-6 text-sm text-fg-muted">
			Opening circuit...
		</output>
	);
	if (!props.store && project?.editorCircuit)
		return (
			<Suspense fallback={openingCircuit}>
				<CircuitEditor
					key={`${project.session}:${project.editorCircuit.file.circuit.id}`}
					document={project.editorCircuit}
				/>
			</Suspense>
		);
	if (
		!props.store &&
		arrivedOpening !== null &&
		project?.openingCircuit === arrivedOpening
	)
		return openingCircuit;
	const symbol = props.store ? null : project?.editorSymbol;
	const footprint = props.store ? null : project?.editorFootprint;
	const drawing = props.store ? null : project?.editorDrawing;
	const file = symbol
		? `symbol:${symbol.file.id}`
		: footprint
			? `footprint:${footprint.file.id}`
			: drawing
				? `drawing:${drawing.file.id}`
				: undefined;
	return (
		<Canvas
			key={`${project?.session ?? 0}:${file ?? "schematic"}`}
			{...props}
			store={symbol?.store ?? footprint?.store ?? drawing?.store ?? props.store}
			symbolName={symbol?.file.name}
			footprintName={footprint?.file.name}
			drawingName={drawing?.file.name}
			documentSelection={props.store ? undefined : (file ?? "drawing")}
			viewSwitch={
				!props.store && !symbol && !footprint ? (
					<EditorViewSwitch view="schematic" />
				) : undefined
			}
			syncSelection={!props.store && !symbol && !footprint}
		/>
	);
}
