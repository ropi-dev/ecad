import { type ComponentType, lazy, Suspense } from "react";
import type {
	Editor2DProps,
	EditorCanvasProps,
} from "#/components/editor/Editor2D.tsx";
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
		/>
	);
}
