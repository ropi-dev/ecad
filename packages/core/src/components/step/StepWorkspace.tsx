import { createMemo, createSignal, For, Show } from "solid-js";
import { StepControls } from "#/components/step/StepControls.tsx";
import { StepParts } from "#/components/step/StepParts.tsx";
import { StepViewer } from "#/components/step/StepViewer.tsx";
import { useStepFile } from "#/components/step/useStepFile.ts";
import { Box, Upload } from "#/components/ui/icons.tsx";
import { formatShortcut } from "#/components/viewer/shortcutModifier.ts";
import { DocumentBar } from "#/projects/DocumentBar.tsx";
import { workspaceLinkClassName } from "#/projects/EditorHeader.tsx";
import { ProjectLink } from "#/projects/ProjectLink.tsx";
import {
	useProjectActions,
	useProjectSelection,
} from "#/projects/ProjectProvider.tsx";
import { useWorkspaceControls } from "#/projects/WorkspaceControls.tsx";

const link = {
	class: workspaceLinkClassName,
	"data-variant": "secondary",
	"data-size": "md",
} as const;

export function StepWorkspace() {
	const project = useProjectActions();
	const workspaceControls = useWorkspaceControls();
	const step = useStepFile();
	// Project messages, such as assets a new project left out, show here too.
	const projectError = useProjectSelection((value) => value.error);
	const selectedAsset = useProjectSelection((value) => value.selectedAsset);
	const [hidden, setHidden] = createSignal<Set<number>>(new Set());
	const [wireframe, setWireframe] = createSignal(false);
	const [ready, setReady] = createSignal(false);
	const [rendererError, setRendererError] = createSignal("");
	const notices = createMemo(() =>
		[projectError() ?? "", step.message || rendererError()].filter(Boolean),
	);
	const [dragging, setDragging] = createSignal(false);
	let dragDepth = 0;
	const load = async (file: File) => {
		if (await step.openFile(file)) {
			setHidden(new Set<number>());
			setRendererError("");
		}
	};
	return (
		<main
			class="workspace-plain @container relative h-dvh overflow-hidden"
			onDragEnter={(event) => {
				if (project()) return;
				if (!event.dataTransfer?.types.includes("Files")) return;
				event.preventDefault();
				dragDepth++;
				setDragging(true);
			}}
			onDragOver={(event) => {
				if (!project() && event.dataTransfer?.types.includes("Files"))
					event.preventDefault();
			}}
			onDragLeave={() => {
				dragDepth = Math.max(0, dragDepth - 1);
				if (!dragDepth) setDragging(false);
			}}
			onDrop={(event) => {
				if (project()) return;
				event.preventDefault();
				dragDepth = 0;
				setDragging(false);
				const file = event.dataTransfer?.files[0];
				if (file) void load(file);
			}}
		>
			<DocumentBar
				icon={Box}
				title={step.model?.name ?? selectedAsset()?.name ?? "STEP viewer"}
				selection={
					selectedAsset()?.kind === "step"
						? `asset:${selectedAsset()?.path}`
						: undefined
				}
			/>
			{!workspaceControls && (
				<header class="absolute top-[var(--chrome-top)] left-[var(--chrome-gap)] z-20 flex max-w-[calc(100%-2*var(--chrome-gap))] flex-wrap gap-2">
					<ProjectLink href="/" {...link}>
						Workspace
					</ProjectLink>
					{!project() && (
						<label
							class={`${workspaceLinkClassName} relative focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-accent`}
							data-variant="primary"
							data-size="md"
						>
							<Upload size={15} aria-hidden="true" />
							{step.loading ? "Reading STEP..." : "Open STEP"}
							<input
								type="file"
								accept=".step,.stp"
								aria-label="Open STEP file"
								class="absolute inset-0 h-full w-full cursor-pointer opacity-0"
								onChange={(event) => {
									const file = event.currentTarget.files?.[0];
									if (file) void load(file);
									event.currentTarget.value = "";
								}}
							/>
						</label>
					)}
					<ProjectLink href="/gerber" {...link}>
						Gerber viewer
					</ProjectLink>
					<ProjectLink href="/editor" {...link}>
						Schematic editor
					</ProjectLink>
				</header>
			)}
			{notices().length > 0 && (
				<div
					role="alert"
					class="ui-notice absolute top-[calc(var(--chrome-top)+var(--chrome-bar))] left-[var(--chrome-gap)] z-20 max-h-28 max-w-[calc(100%-2*var(--chrome-gap))] overflow-auto px-3 py-2 sm:max-w-sm"
				>
					<For each={notices()}>{(notice) => <p class="m-0">{notice}</p>}</For>
				</div>
			)}
			<Show
				when={step.model}
				fallback={
					<div class="pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-2 px-6 text-center">
						<span class="mb-2 grid size-14 place-items-center rounded-2xl border border-line bg-panel text-fg-faint">
							<Box size={26} aria-hidden="true" />
						</span>
						<h1 class="m-0 text-xl font-semibold text-fg">STEP viewer</h1>
						<p class="m-0 max-w-sm text-sm text-fg-muted">
							{project()
								? "Add a STEP model from the sidebar's + menu to explore it in 3D."
								: "Open or drop a .step or .stp file to explore it in 3D."}
						</p>
						<p class="m-0 text-xs text-fg-faint">Files stay on your device.</p>
					</div>
				}
			>
				{(model) => (
					<>
						<StepViewer
							model={model()}
							hidden={hidden()}
							wireframe={wireframe()}
							onReady={setReady}
							onError={setRendererError}
							extraControls={
								<StepControls
									enabled={ready()}
									wireframe={wireframe()}
									onWireframe={() => setWireframe((value) => !value)}
								/>
							}
						/>
						<Show when={!project()}>
							<StepParts
								model={model()}
								hidden={hidden()}
								onToggle={(index) =>
									setHidden((current) => {
										const next = new Set(current);
										if (next.has(index)) next.delete(index);
										else next.add(index);
										return next;
									})
								}
								onClear={() => {
									step.clear();
									setReady(false);
									setRendererError("");
								}}
							/>
						</Show>
					</>
				)}
			</Show>
			{step.loading && (
				<output class="ui-panel absolute top-1/2 left-1/2 z-20 flex -translate-x-1/2 -translate-y-1/2 items-center gap-4 py-3 pr-3 pl-4 text-sm shadow-pop">
					<span>Reading STEP file...</span>
					<button
						type="button"
						class="ui-button"
						data-variant="secondary"
						onClick={() => step.cancel()}
					>
						Cancel
					</button>
				</output>
			)}
			{step.model && (
				<p class="pointer-events-none absolute bottom-[calc(var(--chrome-dock)+env(safe-area-inset-bottom))] left-0 m-0 flex w-full justify-center px-4">
					<span class="rounded-md border border-line-subtle bg-panel px-2.5 py-1 text-center text-2xs text-fg-muted">
						{formatShortcut(
							"Scroll or middle-drag to pan · Shift + scroll or drag to orbit · Wheel or pinch to zoom · F6 to fit",
						)}
					</span>
				</p>
			)}
			{dragging() && (
				<div class="pointer-events-none absolute inset-2 z-30 grid place-items-center rounded-2xl border-2 border-dashed border-accent bg-scrim text-lg font-medium text-accent">
					Drop a STEP file to open it
				</div>
			)}
		</main>
	);
}
