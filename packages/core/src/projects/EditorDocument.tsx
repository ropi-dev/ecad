import { type ComponentType, lazy, Suspense } from "react";
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
	// Text sizes are measured with the schematic font, so wait for it to load.
	const fontsReady = useDrawingFonts();
	if (!fontsReady) return null;
	// The first project replaces the provider's empty document. An editor
	// mounted before then would build a canvas and renderer only to drop them.
	if (!props.store && project?.restoring) return null;
	if (!props.store && project?.editorCircuit)
		return (
			<Suspense
				fallback={<output className="block p-6">Opening circuit...</output>}
			>
				<CircuitEditor
					key={`${project.session}:${project.editorCircuit.file.circuit.id}`}
					document={project.editorCircuit}
				/>
			</Suspense>
		);
	const symbol = props.store ? null : project?.editorSymbol;
	const drawing = props.store ? null : project?.editorDrawing;
	return (
		<Canvas
			key={`${project?.session ?? 0}:${
				symbol
					? `symbol:${symbol.file.id}`
					: drawing
						? `drawing:${drawing.file.id}`
						: "schematic"
			}`}
			{...props}
			store={symbol?.store ?? drawing?.store ?? props.store}
			symbolName={symbol?.file.name}
			drawingName={drawing?.file.name}
			viewSwitch={
				!props.store && !symbol ? (
					<EditorViewSwitch view="schematic" />
				) : undefined
			}
			syncSelection={!props.store && !symbol}
		/>
	);
}
