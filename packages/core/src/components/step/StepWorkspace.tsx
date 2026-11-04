import { Box, Upload } from "lucide-react";
import { useRef, useState } from "react";
import { formatShortcut } from "#/components/viewer/shortcutModifier.ts";
import { ProjectLink } from "#/projects/ProjectLink.tsx";
import {
	useProjectActions,
	useProjectSelection,
} from "#/projects/ProjectProvider.tsx";
import { useWorkspaceControls } from "#/projects/WorkspaceControls.tsx";
import { StepControls } from "./StepControls";
import { StepParts } from "./StepParts";
import { StepViewer } from "./StepViewer";
import { useStepFile } from "./useStepFile";

export function StepWorkspace() {
	const project = useProjectActions();
	const workspaceControls = useWorkspaceControls();
	const { model, loading, message, openFile, cancel, clear } = useStepFile();
	// Project messages, such as assets a new project left out, show here too.
	const projectError = useProjectSelection((value) => value.error) ?? "";
	const [hidden, setHidden] = useState<Set<number>>(new Set());
	const [wireframe, setWireframe] = useState(false);
	const [ready, setReady] = useState(false);
	const [rendererError, setRendererError] = useState("");
	const notices = [projectError, message || rendererError].filter(Boolean);
	const [dragging, setDragging] = useState(false);
	const dragDepth = useRef(0);
	const load = async (file: File) => {
		if (await openFile(file)) {
			setHidden(new Set());
			setRendererError("");
		}
	};
	const button =
		"inline-flex h-11 items-center gap-2 rounded-lg border border-white/20 bg-slate-900/95 px-3 text-xs text-white/80 shadow-lg hover:bg-slate-800 focus-visible:outline-2 focus-visible:outline-white";
	return (
		<main
			className="relative h-dvh overflow-hidden"
			onDragEnter={(event) => {
				if (project) return;
				if (!event.dataTransfer.types.includes("Files")) return;
				event.preventDefault();
				dragDepth.current++;
				setDragging(true);
			}}
			onDragOver={(event) => {
				if (!project && event.dataTransfer.types.includes("Files"))
					event.preventDefault();
			}}
			onDragLeave={() => {
				dragDepth.current = Math.max(0, dragDepth.current - 1);
				if (!dragDepth.current) setDragging(false);
			}}
			onDrop={(event) => {
				if (project) return;
				event.preventDefault();
				dragDepth.current = 0;
				setDragging(false);
				const file = event.dataTransfer.files[0];
				if (file) void load(file);
			}}
		>
			{!workspaceControls && (
				<header className="absolute left-4 top-4 z-20 flex max-w-[calc(100%-2rem)] flex-wrap gap-2">
					<ProjectLink href="/" className={button}>
						Workspace
					</ProjectLink>
					{!project && (
						<label
							className={`${button} relative cursor-pointer focus-within:outline-2 focus-within:outline-white`}
						>
							<Upload size={16} />
							{loading ? "Reading STEP..." : "Open STEP"}
							<input
								type="file"
								accept=".step,.stp"
								aria-label="Open STEP file"
								className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
								onChange={(event) => {
									const file = event.target.files?.[0];
									if (file) void load(file);
									event.target.value = "";
								}}
							/>
						</label>
					)}
					<ProjectLink href="/gerber" className={button}>
						Gerber viewer
					</ProjectLink>
					<ProjectLink href="/editor" className={button}>
						Schematic editor
					</ProjectLink>
				</header>
			)}
			{notices.length > 0 && (
				<div
					role="alert"
					className="absolute left-4 top-20 z-20 max-h-28 max-w-[calc(100%-2rem)] overflow-auto rounded-lg border border-amber-200/30 bg-slate-900 p-3 text-sm text-amber-200 sm:max-w-sm"
				>
					{notices.map((notice) => (
						<p key={notice} className="m-0">
							{notice}
						</p>
					))}
				</div>
			)}
			{model ? (
				<>
					<StepViewer
						model={model}
						hidden={hidden}
						wireframe={wireframe}
						onReady={setReady}
						onError={setRendererError}
						extraControls={
							<StepControls
								enabled={ready}
								wireframe={wireframe}
								onWireframe={() => setWireframe((value) => !value)}
							/>
						}
					/>
					{!project && (
						<StepParts
							model={model}
							hidden={hidden}
							onToggle={(index) =>
								setHidden((current) => {
									const next = new Set(current);
									if (next.has(index)) next.delete(index);
									else next.add(index);
									return next;
								})
							}
							onClear={() => {
								clear();
								setReady(false);
								setRendererError("");
							}}
						/>
					)}
				</>
			) : (
				<div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-3 px-6 text-center">
					<Box size={40} className="text-slate-500" />
					<h1 className="text-xl font-medium text-slate-200">STEP viewer</h1>
					<p className="text-sm text-slate-400">
						{project
							? "Add a STEP file in the sidebar to explore it in 3D."
							: "Open or drop a .step or .stp file to explore it in 3D."}
					</p>
					<p className="text-xs text-slate-400">Files stay on your device.</p>
				</div>
			)}
			{loading && (
				<output className="absolute left-1/2 top-1/2 z-20 flex -translate-x-1/2 -translate-y-1/2 items-center gap-4 rounded-lg border border-white/20 bg-slate-900 p-4 text-sm shadow-lg">
					<span>Reading STEP file...</span>
					<button type="button" className={button} onClick={cancel}>
						Cancel
					</button>
				</output>
			)}
			{model && (
				<p className="pointer-events-none absolute bottom-20 left-0 w-full px-4 text-center text-xs text-slate-400">
					{formatShortcut(
						"Shift + left-drag to orbit · Ctrl + left-drag to pan · Pinch to zoom · F6 to fit",
					)}
				</p>
			)}
			{dragging && (
				<div className="pointer-events-none absolute inset-2 z-30 grid place-items-center rounded-xl border-2 border-dashed border-amber-200 bg-slate-900/90 text-lg text-amber-200">
					Drop a STEP file to open it
				</div>
			)}
		</main>
	);
}
