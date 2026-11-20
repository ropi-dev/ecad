import { errorMessage } from "@ecad/drawing-core/lib/error-message.ts";
import { Dynamic, type JSX } from "@solidjs/web";
import {
	type Accessor,
	createEffect,
	createMemo,
	createSignal,
	For,
	Loading,
	lazy,
	Match,
	onSettled,
	Show,
	Switch,
} from "solid-js";
import copperE from "#/assets/copper-e.svg?url";
import { useSymbolLibrary } from "#/components/editor/useSymbolLibrary.ts";
import {
	Box,
	ChevronLeft,
	ChevronRight,
	CircuitBoard,
	Component,
	Cpu,
	FileCog,
	FileUp,
	Grid2x2,
	House,
	Layers,
	type LucideIcon,
	PlugZap,
	Plus,
	Save,
	Search,
	Settings,
	Workflow,
	X,
} from "#/components/ui/icons.tsx";
import { DropdownMenu, TooltipProvider } from "#/components/ui/primitives.tsx";
import { PinnedNotice } from "#/components/ui/Toaster.tsx";
import { toastManager } from "#/components/ui/toast.ts";
import {
	hasShortcutModifier,
	shortcutModifier,
} from "#/components/viewer/shortcutModifier.ts";
import { quietFocus } from "#/components/viewer/ToolbarGroup.tsx";
import {
	TooltipButton,
	TooltipTrigger,
} from "#/components/viewer/TooltipButton.tsx";
import {
	scrollFadeClassName,
	useScrollEdges,
} from "#/components/viewer/useScrollEdges.ts";
import type { KiCadImportReport } from "#/formats/kicad/import.ts";
import type { EditorMcpConnector } from "#/mcp/editor-connection.ts";
import { addProjectFiles } from "#/projects/add-project-files.ts";
import { isProjectError } from "#/projects/errors.ts";
import {
	type AssetKind,
	PROJECT_FILE,
	type ProjectAsset,
	type ProjectSnapshot,
} from "#/projects/format.ts";
import { OpenProjectButton } from "#/projects/OpenProjectButton.tsx";
import { ProjectLink, type ProjectPath } from "#/projects/ProjectLink.tsx";
import { ProjectMenu } from "#/projects/ProjectMenu.tsx";
import {
	useLatestProjectSnapshot,
	useProjectSelection,
} from "#/projects/ProjectProvider.tsx";
import { primaryPcbId } from "#/projects/pcb.ts";
import { projectIndex } from "#/projects/project-index.ts";
import {
	sidebarMenuContent,
	sidebarMenuItem,
	sidebarMenuLabel,
	sidebarMenuSeparator,
} from "#/projects/sidebarMenu.ts";
import { useSaveProject } from "#/projects/useSaveProject.ts";
import {
	useWorkspaceControls,
	useWorkspaceRegistration,
} from "#/projects/WorkspaceControls.tsx";
import { LazySettingsDialog } from "#/settings/LazySettingsDialog.tsx";

const SidebarMcpControls = lazy(
	() => import("#/components/editor/McpControls.tsx"),
	{ export: "McpControls" },
);
const CreateFileDialog = lazy(
	() => import("#/components/editor/CreateFileDialog.tsx"),
	{ export: "CreateFileDialog" },
);
const focus =
	"focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent";
const railButton = "ui-button size-9";
const row = `flex h-7 min-w-0 items-center gap-2 rounded-md text-sm no-underline pointer-coarse:h-11 ${focus}`;
// The pointer may stray out of the sidebar briefly before it closes.
const hoverCloseDelay = 400;
// The file inputs stay mounted while the menu that opens them is closed.
const importTypes = [
	["kicad", "KiCad schematic", FileUp, ".kicad_sch", "KiCad schematic..."],
	["symbol", "symbol", Component, ".ecadsym,.json", "Symbols..."],
	["gerber", "Gerber", Layers, undefined, "Gerber files..."],
	["step", "STEP", Box, ".step,.stp", "STEP models..."],
] as const;
const newFileTypes = [
	["circuit", Workflow],
	["symbol", Component],
	["footprint", Cpu],
] as const;
const fileIcons: Record<string, LucideIcon> = {
	Drawing: CircuitBoard,
	Circuit: Workflow,
	Symbol: Component,
	Footprint: Cpu,
	Gerber: Layers,
	STEP: Box,
	Project: FileCog,
};
const filters = [
	"All files",
	"Circuit",
	"Drawing",
	"Footprint",
	"Gerber",
	"PCB",
	"STEP",
	"Symbol",
] as const;
type Filter = (typeof filters)[number];
const pageSize = 50;
interface ProjectFile {
	path: string;
	name: string;
	type: string;
	href?: ProjectPath;
	asset?: ProjectAsset;
	circuitPath?: string;
	boardPath?: string;
	/** Opens the Gerber viewer with every layer instead of one file. */
	allLayers?: boolean;
}

function projectFiles(
	snapshot: ProjectSnapshot | null | undefined,
): ProjectFile[] {
	const manifest = snapshot?.manifest;
	return manifest
		? [
				{ path: PROJECT_FILE, name: PROJECT_FILE, type: "Project" },
				...(snapshot?.circuits ?? []).flatMap((file, index) => {
					const paths = manifest.circuits?.[index];
					if (!paths) return [];
					const name = file.circuit.name;
					const drawingIndex =
						snapshot?.drawings?.findIndex(
							(drawing) => drawing.circuitId === file.circuit.id,
						) ?? -1;
					const drawingPath =
						file.circuit.id === primaryPcbId
							? manifest.drawing
							: manifest.drawings?.[drawingIndex];
					return drawingPath
						? [
								{
									path: drawingPath,
									name: `${name}.ecaddraw`,
									type: "Drawing",
									href: "/editor" as const,
									circuitPath: paths.circuit,
									...(snapshot?.boards?.some(
										(board) => board.circuitId === file.circuit.id,
									)
										? { boardPath: paths.circuit }
										: {}),
								},
							]
						: [
								{
									path: paths.circuit,
									name: `${name}.ecaddraw`,
									type: "Circuit",
									href: "/editor" as const,
								},
							];
				}),
				...(manifest.drawing &&
				!snapshot?.circuits?.some(
					(file, index) =>
						file.circuit.id === primaryPcbId && manifest.circuits?.[index],
				)
					? [
							{
								path: manifest.drawing,
								name: "Drawing",
								type: "Drawing",
								href: "/editor" as const,
							},
						]
					: []),
				...(manifest.drawings ?? []).flatMap((path, index) =>
					snapshot?.drawings?.[index]?.circuitId
						? []
						: [
								{
									path,
									name: path.split("/").at(-1) ?? path,
									type: "Drawing",
									href: "/editor" as const,
								},
							],
				),
				...manifest.symbols.map((path) => ({
					path,
					name: path.split("/").at(-1) ?? path,
					type: "Symbol",
					href: "/editor" as const,
				})),
				...(manifest.footprints ?? []).map((path) => ({
					path,
					name: path.split("/").at(-1) ?? path,
					type: "Footprint",
					href: "/editor" as const,
				})),
				...(manifest.assets.some((asset) => asset.kind === "gerber")
					? [
							{
								path: "gerber:all-layers",
								name: "All Gerber layers",
								type: "Gerber",
								href: "/gerber" as const,
								allLayers: true,
							},
						]
					: []),
				...manifest.assets.map((asset) => ({
					path: asset.path,
					name: asset.name,
					type: asset.kind === "step" ? "STEP" : "Gerber",
					href:
						asset.kind === "step" ? ("/step" as const) : ("/gerber" as const),
					asset,
				})),
			]
		: [];
}

const on =
	<K extends keyof HTMLElementEventMap>(
		type: K,
		listener: (event: HTMLElementEventMap[K]) => void,
	) =>
	(element: HTMLElement) =>
		element.addEventListener(type, listener, { capture: true });

export function ProjectFilesSidebar(
	props: {
		/** Quits the app. The Exit button shows only when it is given. */
		onExit?: () => void;
		footerActions?: JSX.Element;
		/** Only the desktop app passes this; the web app shows no MCP controls. */
		mcp?: EditorMcpConnector;
	} = {},
) {
	const project = useProjectSelection(
		({
			busy,
			createCircuit,
			createFootprint,
			createSymbol,
			importAssets,
			importExample,
			importSchematic,
			openBoard,
			openCircuit,
			project,
			selectAsset,
			selectEditorFile,
		}) => ({
			busy,
			createCircuit,
			createFootprint,
			createSymbol,
			importAssets,
			importExample,
			importSchematic,
			openBoard,
			openCircuit,
			project,
			selectAsset,
			selectEditorFile,
		}),
	);
	const workspaceControls = useWorkspaceControls();
	const registration = useWorkspaceRegistration();
	const library = useSymbolLibrary();
	const saveProject = useSaveProject();
	onSettled(() => {
		registration?.setSidebarDocked(true);
		return () => registration?.setSidebarDocked(false);
	});
	let rail!: HTMLElement;
	let sidebar!: HTMLFieldSetElement;
	let panel!: HTMLElement;
	let editorLink: HTMLAnchorElement | undefined;
	const fileInputs: Record<string, HTMLInputElement | undefined> = {};
	const viewerLinks: Record<AssetKind, HTMLAnchorElement | undefined> = {
		gerber: undefined,
		step: undefined,
	};
	const [hovered, setHovered] = createSignal(false);
	const [focused, setFocused] = createSignal(false);
	const [touchOpen, setTouchOpen] = createSignal(false);
	let hoverTimer: ReturnType<typeof setTimeout> | undefined;
	const hoverSoon = (next: boolean, delay: number) => {
		clearTimeout(hoverTimer);
		hoverTimer = setTimeout(() => setHovered(next), delay);
	};
	const setHoveredNow = (next: boolean) => {
		clearTimeout(hoverTimer);
		setHovered(next);
	};
	onSettled(() => () => clearTimeout(hoverTimer));
	const [query, setQuery] = createSignal("");
	const [filter, setFilter] = createSignal<Filter>("All files");
	const [page, setPage] = createSignal(0);
	const [importing, setImporting] = createSignal(false);
	const [error, setError] = createSignal("");
	const [importReport, setImportReport] = createSignal<KiCadImportReport>();
	const [creatingFile, setCreatingFile] = createSignal<
		"symbol" | "footprint" | "circuit" | null
	>(null);
	const [settingsOpen, setSettingsOpen] = createSignal(false);
	const [railAddMenuOpen, setRailAddMenuOpen] = createSignal(false);
	const [railOpenActive, setRailOpenActive] = createSignal<Accessor<boolean>>();
	const [railProjectActive, setRailProjectActive] =
		createSignal<Accessor<boolean>>();
	const [railMcpActive, setRailMcpActive] = createSignal<Accessor<boolean>>();
	const [mcpRequested, setMcpRequested] = createSignal(false);
	const editorOpen = createMemo(() => Boolean(workspaceControls?.editor));
	createEffect(editorOpen, (open) => {
		if (!open) return;
		return () => setMcpRequested(false);
	});
	// Menus and dialogs opened from the rail leave the sidebar closed.
	const overlayOpen = createMemo(
		() =>
			railAddMenuOpen() ||
			railOpenActive()?.() ||
			railProjectActive()?.() ||
			railMcpActive()?.() ||
			creatingFile() !== null ||
			settingsOpen(),
	);
	const open = () => hovered() || focused() || touchOpen();
	createEffect(overlayOpen, (overlay) => {
		if (overlay) {
			setHoveredNow(false);
			return;
		}
		// A menu or dialog closing under the pointer leaves no pointerleave
		// behind, so the next mouse move decides whether the sidebar is hovered.
		const sync = (event: PointerEvent) => {
			if (event.pointerType !== "mouse") return;
			document.removeEventListener("pointermove", sync, true);
			setHoveredNow(
				event.target instanceof Node && panel.contains(event.target),
			);
		};
		document.addEventListener("pointermove", sync, true);
		return () => document.removeEventListener("pointermove", sync, true);
	});
	const sidebarActions = {
		open: () => setTouchOpen(true),
		openAddMenu: () => setRailAddMenuOpen(true),
		openSettings: () => setSettingsOpen(true),
	};
	onSettled(() => registration?.registerSidebar(sidebarActions));
	const canAddFile = () =>
		!!project()?.project && !project()?.busy && !importing();
	onSettled(() => {
		const onKeyDown = (event: KeyboardEvent) => {
			if (!hasShortcutModifier(event) || event.altKey || event.isComposing)
				return;
			if (event.shiftKey && event.code === "KeyN") {
				event.preventDefault();
				event.stopImmediatePropagation();
				if (!event.repeat && canAddFile()) sidebarActions.openAddMenu();
				return;
			}
			if (event.shiftKey) return;
			if (event.key === ",") {
				event.preventDefault();
				event.stopPropagation();
				setSettingsOpen(true);
				return;
			}
			const onExit = props.onExit;
			if (event.code !== "KeyQ" || !onExit) return;
			event.preventDefault();
			event.stopPropagation();
			if (!event.repeat) onExit();
		};
		window.addEventListener("keydown", onKeyDown, true);
		return () => window.removeEventListener("keydown", onKeyDown, true);
	});
	const closeDrawer = () => {
		if (
			document.activeElement instanceof HTMLElement &&
			sidebar.contains(document.activeElement)
		)
			document.activeElement.blur();
		setTouchOpen(false);
		setFocused(false);
		setHoveredNow(false);
	};
	const drawerOpen = createMemo(() => touchOpen() && !overlayOpen());
	createEffect(drawerOpen, (active) => {
		if (!active) return;
		// The backdrop takes taps on the workspace. This covers what is drawn
		// above it, such as a toast.
		const dismiss = (event: PointerEvent) => {
			if (event.target instanceof Node && !sidebar.contains(event.target))
				closeDrawer();
		};
		document.addEventListener("pointerdown", dismiss, true);
		return () => document.removeEventListener("pointerdown", dismiss, true);
	});
	const latestProject = useLatestProjectSnapshot();
	let navigations = 0;
	const snapshot = () => project()?.project;
	const firstDrawing = () => {
		const manifest = snapshot()?.manifest;
		return manifest?.drawing ?? manifest?.drawings?.[0];
	};
	const files = createMemo(() => projectFiles(snapshot()));
	const filtered = createMemo(() => {
		const search = query().trim().toLowerCase();
		const type = filter();
		return files().filter(
			(file) =>
				(type === "All files" ||
					file.type === type ||
					(type === "Circuit" && !!file.circuitPath) ||
					(type === "PCB" && !!file.boardPath)) &&
				(!search ||
					file.name.toLowerCase().includes(search) ||
					file.path.toLowerCase().includes(search)),
		);
	});
	const lastPage = () =>
		Math.max(0, Math.ceil(filtered().length / pageSize) - 1);
	const currentPage = () => Math.min(page(), lastPage());
	const first = () => currentPage() * pageSize;
	const shownFiles = createMemo(() =>
		filtered().slice(first(), first() + pageSize),
	);
	const busy = () => !!project()?.busy || importing();
	function showError(cause: unknown, fallback: string) {
		if (!isProjectError(cause, "ProjectConflict")) {
			const description = errorMessage(cause, fallback);
			setError(description);
			toastManager.add({ type: "error", title: fallback, description });
		}
	}
	function stayedPut() {
		const count = navigations;
		const href = globalThis.location?.href;
		return () => count === navigations && href === globalThis.location?.href;
	}
	async function upload(files: File[], kind: AssetKind) {
		const current = project();
		if (!current || !files.length) return;
		const unmoved = stayedPut();
		setImporting(true);
		setError("");
		try {
			const { assets, problems } = await addProjectFiles(
				current.importAssets,
				files,
				kind,
			);
			setError(problems);
			if (assets.length && unmoved()) {
				current.selectAsset(assets.length === 1 ? assets[0] : null, {
					reload: true,
				});
				viewerLinks[kind]?.click();
			}
		} catch (cause) {
			showError(cause, "Unable to add project files.");
		} finally {
			setImporting(false);
		}
	}
	async function uploadSymbols(files: File[]) {
		const current = project();
		const unmoved = stayedPut();
		const [id] = await library.upload(files);
		const latest = latestProject();
		const path =
			id && latest ? projectIndex(latest).symbolsById.get(id)?.path : undefined;
		if (!current || !path || !unmoved()) return;
		current.selectEditorFile(path);
		editorLink?.click();
	}
	async function openExample() {
		const current = project();
		if (!current) return;
		setImporting(true);
		setError("");
		try {
			const path = await current.importExample("rp2350a");
			await current.openBoard(path);
			editorLink?.click();
		} catch (cause) {
			showError(cause, "Unable to add the example.");
		} finally {
			setImporting(false);
		}
	}
	async function uploadSchematic(file: File) {
		const current = project();
		if (!current) return;
		setImporting(true);
		setError("");
		setImportReport(undefined);
		try {
			const { path, report } = await current.importSchematic(file);
			setImportReport(report);
			toastManager.add({ type: "success", title: "Schematic imported" });
			current.selectEditorFile(path);
			editorLink?.click();
		} catch (cause) {
			showError(cause, "Unable to import schematic.");
		} finally {
			setImporting(false);
		}
	}

	const activePath = () => workspaceControls?.document?.path;
	const openView = () => workspaceControls?.document?.view;
	const returnToRail = (label: string) =>
		quietFocus(
			rail.querySelector<HTMLElement>(`button[aria-label="${label}"]`),
		);
	const isActive = (file: ProjectFile) =>
		file.type === "Circuit"
			? openView() === "circuit" && activePath() === file.path
			: openView() === undefined && activePath() === file.path;
	function openFile(file: ProjectFile) {
		const current = project();
		if (!current) return;
		navigations++;
		closeDrawer();
		if (file.href === "/editor") {
			if (file.type === "Circuit")
				void current
					.openCircuit(file.path)
					.catch((cause) => showError(cause, "Unable to open circuit."));
			else current.selectEditorFile(file.path);
		}
		if (file.asset) current.selectAsset(file.asset);
		else if (file.allLayers) current.selectAsset(null);
	}
	function openCircuitView(path: string) {
		closeDrawer();
		void project()
			?.openCircuit(path)
			.catch((cause) => showError(cause, "Unable to open circuit."));
	}
	function openBoardView(path: string | undefined) {
		closeDrawer();
		const current = project();
		if (!path || !current) return;
		void Promise.resolve(current.openBoard(path)).catch((cause) =>
			showError(cause, "Unable to open the PCB."),
		);
	}
	function downloadReport(report: KiCadImportReport) {
		const url = URL.createObjectURL(
			new Blob([JSON.stringify(report, null, 2)], {
				type: "application/json",
			}),
		);
		const link = document.createElement("a");
		link.href = url;
		link.download = "kicad-import-report.json";
		link.click();
		setTimeout(() => URL.revokeObjectURL(url), 1000);
	}
	async function createFile(
		kind: "symbol" | "footprint" | "circuit",
		name: string,
	) {
		const current = project();
		if (!current) return;
		try {
			const path = await (kind === "circuit"
				? current.createCircuit(name)
				: kind === "footprint"
					? current.createFootprint(name)
					: current.createSymbol(name));
			if (kind === "circuit") await current.openCircuit(path);
			else current.selectEditorFile(path);
			setCreatingFile(null);
			editorLink?.click();
		} catch (cause) {
			return errorMessage(cause, `Unable to create the ${kind}.`);
		}
	}
	function clearFilters() {
		setQuery("");
		setFilter("All files");
		setPage(0);
	}

	return (
		<Show when={project()}>
			<fieldset
				ref={[
					(element) => {
						sidebar = element;
					},
					on("mousedown", () => setFocused(false)),
					on("focusin", (event) => {
						const target = event.target;
						// Focus in a portaled menu, or returned quietly to the rail, does not
						// reveal the sidebar.
						if (
							!(target instanceof HTMLElement) ||
							!sidebar.contains(target) ||
							target.dataset.quietFocus === "true"
						)
							return;
						if (target.matches(":focus-visible")) setFocused(true);
					}),
					on("focusout", (event) => {
						if (
							!(event.relatedTarget instanceof Node) ||
							!sidebar.contains(event.relatedTarget)
						)
							setFocused(false);
					}),
				]}
				aria-label="File sidebar"
				data-shortcut-scope="sidebar"
				class="relative z-30 m-0 h-full min-w-0 shrink-0 border-0 p-0 text-fg w-12"
				onKeyDown={(event) => {
					if (
						event.key === "Escape" &&
						!overlayOpen() &&
						event.currentTarget.contains(event.target as Node)
					) {
						(document.activeElement as HTMLElement)?.blur();
						setFocused(false);
						setHoveredNow(false);
						setTouchOpen(false);
					}
				}}
			>
				{/* Opened by a tap or click, the sidebar is a drawer: a tap outside
				    closes it without also pressing whatever lies under it. */}
				{drawerOpen() && (
					<div
						aria-hidden="true"
						data-testid="sidebar-backdrop"
						class="fixed inset-0 animate-fade-in bg-scrim/50 motion-reduce:animate-none"
						onClick={() => closeDrawer()}
					/>
				)}
				<TooltipProvider delayDuration={350} skipDelayDuration={150}>
					{/* biome-ignore lint/a11y/useKeyWithClickEvents: a tap on the rail's empty space opens the sidebar on touch screens, which cannot hover */}
					<nav
						ref={rail}
						aria-label="Sidebar shortcuts"
						data-shortcut-keeps-focus
						class="absolute inset-y-0 left-0 z-30 flex w-12 flex-col items-center gap-1 border-r border-line bg-panel py-2"
						onPointerEnter={(event) => {
							if (
								event.pointerType === "mouse" &&
								!overlayOpen() &&
								window.matchMedia("(hover: hover)").matches
							)
								setHoveredNow(true);
						}}
						onPointerLeave={(event) => {
							if (event.pointerType === "mouse")
								hoverSoon(false, hoverCloseDelay);
						}}
						onPointerDown={(event) => {
							if (
								event.target instanceof Element &&
								event.target.closest("a, button")
							)
								setHoveredNow(false);
						}}
						onClick={(event) => {
							if (
								event.target instanceof Element &&
								event.currentTarget.contains(event.target) &&
								!event.target.closest("a, button")
							)
								setTouchOpen(true);
						}}
					>
						<img
							src={copperE}
							alt="ECAD"
							width={28}
							height={28}
							class="my-1 size-7 shrink-0 object-contain"
						/>
						{snapshot() && (
							<DropdownMenu.Root
								open={railAddMenuOpen()}
								onOpenChange={setRailAddMenuOpen}
							>
								<TooltipTrigger
									tooltip="Add file"
									shortcut="Ctrl+Shift+N"
									side="right"
								>
									<DropdownMenu.Trigger>
										<button
											type="button"
											aria-label="Add file"
											disabled={busy()}
											class={railButton}
											data-variant="ghost"
											data-icon
										>
											<Plus size={18} aria-hidden="true" />
										</button>
									</DropdownMenu.Trigger>
								</TooltipTrigger>
								<DropdownMenu.Content
									aria-label="Add file"
									side="right"
									align="start"
									sideOffset={12}
									collisionPadding={12}
									onCloseAutoFocus={(event) => {
										event.preventDefault();
										if (!creatingFile()) returnToRail("Add file");
									}}
									class={sidebarMenuContent}
								>
									<div class={sidebarMenuLabel}>New</div>
									<For each={newFileTypes}>
										{([kind, Icon]) => (
											<DropdownMenu.Item
												class={sidebarMenuItem}
												disabled={busy()}
												onSelect={() => setCreatingFile(kind)}
											>
												<Icon size={14} aria-hidden="true" />
												New {kind}
											</DropdownMenu.Item>
										)}
									</For>
									<DropdownMenu.Separator class={sidebarMenuSeparator} />
									<div class={sidebarMenuLabel}>Import</div>
									<For each={importTypes}>
										{([kind, , Icon, , item]) => (
											<DropdownMenu.Item
												class={sidebarMenuItem}
												disabled={
													busy() || (kind === "symbol" && library.loading)
												}
												onSelect={() => fileInputs[kind]?.click()}
											>
												<Icon size={14} aria-hidden="true" />
												{item}
											</DropdownMenu.Item>
										)}
									</For>
									<DropdownMenu.Separator class={sidebarMenuSeparator} />
									<div class={sidebarMenuLabel}>Examples</div>
									<DropdownMenu.Item
										class={sidebarMenuItem}
										disabled={busy()}
										onSelect={() => void openExample()}
									>
										<Grid2x2 size={14} aria-hidden="true" />
										RP2350A reference design
									</DropdownMenu.Item>
								</DropdownMenu.Content>
							</DropdownMenu.Root>
						)}
						<OpenProjectButton
							registerActive={(active) => setRailOpenActive(() => active)}
							onCloseAutoFocus={(event) => {
								event.preventDefault();
								returnToRail("Open project");
							}}
							class={railButton}
						/>
						<ProjectMenu
							registerActive={(active) => setRailProjectActive(() => active)}
							onCloseAutoFocus={(event) => {
								event.preventDefault();
								returnToRail("Project actions");
							}}
							class={railButton}
						/>
						<Show when={props.mcp}>
							{(mcp) => (
								<Switch
									fallback={
										<TooltipButton
											aria-label="Enable MCP"
											tooltip="Create a drawing to use MCP"
											side="right"
											disabled
											class={railButton}
											data-variant="ghost"
											data-icon
										>
											<PlugZap size={18} aria-hidden="true" />
										</TooltipButton>
									}
								>
									<Match when={workspaceControls?.editor}>
										{(editor) => (
											<Show
												when={editor().enableMcp}
												fallback={
													<TooltipButton
														aria-label="MCP unavailable"
														tooltip="MCP is unavailable in this editor"
														side="right"
														disabled
														class={railButton}
														data-variant="ghost"
														data-icon
													>
														<PlugZap size={18} aria-hidden="true" />
													</TooltipButton>
												}
											>
												<Loading
													fallback={
														<button
															type="button"
															aria-label="Enable MCP"
															disabled
															class={railButton}
															data-variant="ghost"
															data-icon
														>
															<PlugZap size={18} aria-hidden="true" />
														</button>
													}
												>
													<SidebarMcpControls
														store={editor().store}
														connect={mcp()}
														autoEnable={mcpRequested()}
														registerActive={(active) =>
															setRailMcpActive(() => active)
														}
													/>
												</Loading>
											</Show>
										)}
									</Match>
									<Match when={firstDrawing()}>
										{(drawing) => (
											<TooltipTrigger tooltip="Enable MCP" side="right">
												<ProjectLink
													href="/editor"
													aria-label="Enable MCP"
													onClick={() => {
														setMcpRequested(true);
														project()?.selectEditorFile(drawing());
													}}
													class={railButton}
													data-variant="ghost"
													data-icon
												>
													<PlugZap size={18} aria-hidden="true" />
												</ProjectLink>
											</TooltipTrigger>
										)}
									</Match>
								</Switch>
							)}
						</Show>
						<div class="flex-1" />
						<Show when={saveProject()}>
							{(save) => (
								<TooltipButton
									aria-label="Save project"
									tooltip={
										save().unsaved
											? "Save project (unsaved changes)"
											: "Save project"
									}
									side="right"
									disabled={save().busy}
									data-unsaved={save().unsaved ? "true" : "false"}
									class={[
										railButton,
										"relative data-[unsaved=true]:text-accent",
									]}
									data-variant="ghost"
									data-icon
									onClick={() => save().save()}
								>
									<Save size={18} aria-hidden="true" />
									<Show when={save().unsaved}>
										<span
											aria-hidden="true"
											class="absolute top-1 right-1 size-1.5 rounded-full bg-accent"
										/>
									</Show>
								</TooltipButton>
							)}
						</Show>
						<TooltipButton
							aria-label="Settings"
							aria-keyshortcuts={`${shortcutModifier().key}+,`}
							tooltip="Settings"
							shortcut="Ctrl+,"
							side="right"
							data-shortcut-scope="none"
							class={railButton}
							data-variant="ghost"
							data-icon
							onClick={() => setSettingsOpen(true)}
						>
							<Settings size={18} aria-hidden="true" />
						</TooltipButton>
						{props.footerActions}
						{props.onExit && (
							<TooltipButton
								aria-label="Exit"
								aria-keyshortcuts={`${shortcutModifier().key}+Q`}
								tooltip="Exit"
								shortcut="Ctrl+Q"
								side="right"
								// Only Ctrl+Q quits. The held-modifier hints skip this button,
								// so another chord cannot quit by accident.
								data-shortcut-scope="none"
								class={railButton}
								data-variant="ghost"
								data-icon
								onClick={() => props.onExit?.()}
							>
								<X size={18} aria-hidden="true" />
							</TooltipButton>
						)}
					</nav>
				</TooltipProvider>
				<Show when={importReport()}>
					{(report) => (
						<PinnedNotice fallbackClassName="fixed right-4 bottom-4 z-50 w-[min(360px,calc(100vw-2rem))]">
							<ImportReport
								report={report()}
								onDismiss={() => setImportReport(undefined)}
								onDownload={() => downloadReport(report())}
							/>
						</PinnedNotice>
					)}
				</Show>

				<aside
					ref={panel}
					aria-label="Project files"
					data-open={open() ? "true" : "false"}
					aria-hidden={open() ? "false" : "true"}
					inert={!open()}
					onPointerEnter={(event) => {
						if (
							event.pointerType === "mouse" &&
							window.matchMedia("(hover: hover)").matches
						)
							setHoveredNow(true);
					}}
					onPointerLeave={(event) => {
						if (event.pointerType === "mouse")
							hoverSoon(false, hoverCloseDelay);
					}}
					class={[
						"absolute inset-y-0 z-20 flex h-full w-64 left-12 max-w-[calc(100vw-4rem)] min-h-0 flex-col overflow-hidden border-r border-line bg-panel transition-transform duration-120 ease-out motion-reduce:transition-none",
						{
							"translate-x-0": open(),
							"shadow-pop": open(),
							"-translate-x-full": !open(),
						},
					]}
				>
					<header class="flex h-12 shrink-0 items-center gap-1 pr-2 pl-2">
						<ProjectLink
							href="/"
							aria-label="Workspace home"
							title={snapshot()?.manifest.name}
							class={`flex h-8 min-w-0 flex-1 items-center gap-2 rounded-md px-1.5 text-fg no-underline hover:bg-hover pointer-coarse:h-11 ${focus}`}
						>
							<House
								size={16}
								class="shrink-0 text-fg-faint"
								aria-hidden="true"
							/>
							<span class="truncate text-sm font-semibold">
								{snapshot()?.manifest.name ?? "ECAD"}
							</span>
						</ProjectLink>
					</header>
					<For each={importTypes}>
						{([kind, label, , accept]) => (
							<input
								ref={(node) => {
									fileInputs[kind] = node;
								}}
								type="file"
								hidden
								multiple={kind !== "kicad"}
								aria-label={`Add ${label} files`}
								accept={accept}
								disabled={
									!snapshot() ||
									busy() ||
									(kind === "symbol" && library.loading)
								}
								onChange={(event) => {
									const files = Array.from(event.currentTarget.files ?? []);
									if (kind === "kicad") {
										if (files[0]) void uploadSchematic(files[0]);
									} else if (kind === "symbol") void uploadSymbols(files);
									else void upload(files, kind);
									event.currentTarget.value = "";
								}}
							/>
						)}
					</For>
					<div class="flex min-h-0 flex-1 flex-col overflow-hidden border-t border-line-subtle">
						{snapshot() && (
							<>
								<div class="shrink-0 pt-3 pb-2">
									<div class="mx-3 flex h-7 items-center gap-2 rounded-md border border-line bg-field px-2 focus-within:border-accent hover:border-line-strong pointer-coarse:h-11">
										<Search
											class="size-3.5 shrink-0 text-fg-faint"
											aria-hidden="true"
										/>
										<input
											type="search"
											aria-label="Search project files"
											placeholder="Find a file..."
											value={query()}
											onInput={(event) => {
												setQuery(event.currentTarget.value);
												setPage(0);
											}}
											class="h-full min-w-0 flex-1 bg-transparent text-xs text-fg outline-none placeholder:text-fg-faint pointer-coarse:text-lg [&::-webkit-search-cancel-button]:hidden"
										/>
										<Show when={query()}>
											<button
												type="button"
												aria-label="Clear file search"
												class={`-mr-1 grid size-5 cursor-pointer place-items-center rounded-sm text-fg-faint hover:bg-hover hover:text-fg pointer-coarse:size-11 ${focus}`}
												onClick={() => {
													setQuery("");
													setPage(0);
												}}
											>
												<X class="size-3.5" aria-hidden="true" />
											</button>
										</Show>
									</div>
									<FileTypeFilters
										filter={filter()}
										onFilter={(type) => {
											setFilter(type);
											setPage(0);
										}}
									/>
								</div>
								<Show when={importing()}>
									<output
										class="px-3 py-1 text-xs text-fg-muted"
										aria-live="polite"
									>
										<span>Adding project files...</span>
									</output>
								</Show>
								<Show when={error() || library.error}>
									<p
										role="alert"
										title={error() || library.error || undefined}
										class="m-0 line-clamp-3 px-3 py-1 text-xs text-warning"
									>
										<span>{error() || library.error}</span>
									</p>
								</Show>
								<Show when={library.message}>
									<output class="sr-only" aria-live="polite">
										{library.message}
									</output>
								</Show>
								<div class="min-h-0 flex-1 overflow-auto overscroll-contain px-2 pb-2">
									<table class="w-full table-fixed border-collapse text-left">
										<caption class="sr-only">
											Files in the current project
										</caption>
										<thead class="sr-only">
											<tr>
												<th scope="col">Name</th>
											</tr>
										</thead>
										<tbody>
											<For each={shownFiles()} keyed={(file) => file.path}>
												{(file) => (
													<FileRow
														file={file()}
														active={isActive(file())}
														circuitActive={
															openView() === "circuit" &&
															activePath() ===
																(file().circuitPath ?? file().path)
														}
														boardActive={
															openView() === "pcb" &&
															activePath() === file().boardPath
														}
														onOpen={() => openFile(file())}
														onOpenCircuit={() =>
															openCircuitView(file().circuitPath ?? file().path)
														}
														onOpenBoard={() => openBoardView(file().boardPath)}
													/>
												)}
											</For>
										</tbody>
									</table>
									{!filtered().length && (
										<div class="px-1.5 py-3 text-xs text-fg-muted">
											<p class="m-0">No matching files</p>
											<button
												type="button"
												class="ui-button mt-2"
												data-variant="secondary"
												onClick={clearFilters}
											>
												Clear filters
											</button>
										</div>
									)}
								</div>
								<Show when={lastPage() > 0}>
									<footer class="flex h-9 shrink-0 items-center justify-between gap-2 border-t border-line-subtle pr-2 pl-3 text-2xs text-fg-faint tabular-nums">
										<span>
											{first() + 1}–
											{Math.min(first() + pageSize, filtered().length)} of{" "}
											{filtered().length}
										</span>
										<nav aria-label="Project file pages" class="flex gap-1">
											<button
												type="button"
												aria-label="Previous files"
												disabled={!currentPage()}
												class="ui-button"
												data-variant="ghost"
												data-icon
												onClick={() => setPage(currentPage() - 1)}
											>
												<ChevronLeft class="size-3.5" aria-hidden="true" />
											</button>
											<button
												type="button"
												aria-label="Next files"
												disabled={currentPage() === lastPage()}
												class="ui-button"
												data-variant="ghost"
												data-icon
												onClick={() => setPage(currentPage() + 1)}
											>
												<ChevronRight class="size-3.5" aria-hidden="true" />
											</button>
										</nav>
									</footer>
								</Show>
							</>
						)}
					</div>
					<ProjectLink
						href="/editor"
						ref={(node) => {
							editorLink = node;
						}}
						hidden
						tabindex={-1}
					>
						Open new file
					</ProjectLink>
					<For each={["gerber", "step"] as const}>
						{(kind) => (
							<ProjectLink
								href={`/${kind}`}
								ref={(node) => {
									viewerLinks[kind] = node;
								}}
								hidden
								tabindex={-1}
							>
								Open new {kind} file
							</ProjectLink>
						)}
					</For>
				</aside>
				<LazySettingsDialog
					open={settingsOpen()}
					onOpenChange={setSettingsOpen}
				/>
				<Show when={creatingFile()}>
					{(kind) => (
						<div class="pointer-events-auto">
							<Loading fallback={null}>
								<CreateFileDialog
									kind={kind()}
									description={`Create an empty ${kind()} file in this project and open it for editing.`}
									onClose={() => setCreatingFile(null)}
									onCreate={(name) => createFile(kind(), name)}
								/>
							</Loading>
						</div>
					)}
				</Show>
			</fieldset>
		</Show>
	);
}

function FileTypeFilters(props: {
	filter: Filter;
	onFilter: (filter: Filter) => void;
}) {
	let row!: HTMLFieldSetElement;
	const [element, setElement] = createSignal<HTMLFieldSetElement | null>(null);
	onSettled(() => {
		setElement(row);
	});
	useScrollEdges(element);
	return (
		<div class="group relative mt-2">
			<fieldset
				ref={row}
				aria-label="File types"
				class={[
					"m-0 flex min-w-0 gap-1 overflow-x-auto border-0 px-3 py-0 [scrollbar-width:none]",
					scrollFadeClassName,
				]}
				onWheel={(event) => {
					// A mouse wheel scrolls the one-line row sideways.
					if (Math.abs(event.deltaY) > Math.abs(event.deltaX))
						event.currentTarget.scrollLeft += event.deltaY;
				}}
			>
				<For each={filters}>
					{(type) => (
						<button
							type="button"
							aria-label={type === "Symbol" ? "Symbol files" : undefined}
							aria-pressed={props.filter === type ? "true" : "false"}
							class={`ui-toggle h-6 shrink-0 cursor-pointer rounded-full border px-2.5 text-2xs font-medium [--toggle-line:var(--color-line-subtle)] [--toggle-on-line:var(--color-accent-line)] hover:[--toggle-bg:transparent] hover:[--toggle-line:var(--color-line)] pointer-coarse:h-11 pointer-coarse:px-3.5 ${focus}`}
							onClick={(event) => {
								props.onFilter(type);
								event.currentTarget.scrollIntoView({
									block: "nearest",
									inline: "nearest",
								});
							}}
						>
							{type === "Symbol" ? "Symbols" : type}
						</button>
					)}
				</For>
			</fieldset>
			{/* More file types lie to this side. */}
			<ChevronLeft
				size={13}
				strokeWidth={2.5}
				aria-hidden="true"
				class="pointer-events-none absolute top-1/2 left-0.5 hidden -translate-y-1/2 text-fg group-data-[fade=both]:block group-data-[fade=start]:block"
			/>
			<ChevronRight
				size={13}
				strokeWidth={2.5}
				aria-hidden="true"
				class="pointer-events-none absolute top-1/2 right-0.5 hidden -translate-y-1/2 text-fg group-data-[fade=both]:block group-data-[fade=end]:block"
			/>
		</div>
	);
}

function FileRow(props: {
	file: ProjectFile;
	active: boolean;
	circuitActive: boolean;
	boardActive: boolean;
	onOpen: () => void;
	onOpenCircuit: () => void;
	onOpenBoard: () => void;
}) {
	const Icon = createMemo(() => fileIcons[props.file.type] ?? FileCog);
	const content = () => (
		<>
			<Dynamic
				component={Icon()}
				size={15}
				class="ui-toggle-faint shrink-0"
				aria-hidden="true"
			/>
			<span class="truncate">{props.file.name}</span>
		</>
	);
	return (
		<tr>
			<td class="p-0">
				<Show
					when={props.file.href}
					fallback={
						<div
							title={`${props.file.name} · ${props.file.type}`}
							class={`${row} px-1.5 text-fg-faint`}
						>
							{content()}
						</div>
					}
				>
					{(href) => (
						<ProjectLink
							href={href()}
							file={props.file.allLayers ? undefined : props.file.path}
							view={props.file.type === "Circuit" ? "circuit" : undefined}
							aria-label={
								props.file.allLayers
									? "Open all Gerber layers"
									: `Open ${props.file.name}${props.file.type === "Circuit" ? " in circuit view" : ""}`
							}
							aria-current={props.active ? "page" : undefined}
							title={`${props.file.name} · ${props.file.type}`}
							class={`ui-toggle ${row} px-1.5 aria-[current=page]:font-medium`}
							onClick={() => props.onOpen()}
						>
							{content()}
						</ProjectLink>
					)}
				</Show>
				<Show when={props.file.circuitPath}>
					{(circuitPath) => (
						<ProjectLink
							href="/editor"
							file={circuitPath()}
							view="circuit"
							aria-label={`Open ${props.file.name} in circuit view`}
							aria-current={props.circuitActive ? "page" : undefined}
							class={`ui-toggle ${row} ml-[11px] border-l pr-1.5 pl-[11px] [--toggle-line:var(--color-line)] [--toggle-on-line:var(--color-line)] aria-[current=page]:font-medium`}
							onClick={() => props.onOpenCircuit()}
						>
							<Workflow
								size={15}
								aria-hidden="true"
								class="ui-toggle-faint shrink-0"
							/>
							<span class="truncate">Circuit view</span>
						</ProjectLink>
					)}
				</Show>
				<Show when={props.file.boardPath}>
					{(boardPath) => (
						<ProjectLink
							href="/editor"
							file={boardPath()}
							view="pcb"
							aria-label={`Open ${props.file.name} in PCB view`}
							aria-current={props.boardActive ? "page" : undefined}
							class={`ui-toggle ${row} ml-[11px] border-l pr-1.5 pl-[11px] [--toggle-line:var(--color-line)] [--toggle-on-line:var(--color-line)] aria-[current=page]:font-medium`}
							onClick={() => props.onOpenBoard()}
						>
							<Grid2x2
								size={15}
								aria-hidden="true"
								class="ui-toggle-faint shrink-0"
							/>
							<span class="truncate">PCB view</span>
						</ProjectLink>
					)}
				</Show>
			</td>
		</tr>
	);
}

function ImportReport(props: {
	report: KiCadImportReport;
	onDismiss: () => void;
	onDownload: () => void;
}) {
	return (
		<output class="ui-panel block bg-raised p-3 text-xs shadow-pop">
			<span class="block font-semibold">KiCad schematic imported</span>
			<span class="mt-1 block text-fg-muted">
				Imported KiCad drawing with electrical net and supply names. Review
				conversion limits and source metadata in the report.
			</span>
			{props.report.skipped.length > 0 && (
				<>
					<span class="mt-2 block font-medium text-warning">
						Skipped {props.report.skipped.length}{" "}
						{props.report.skipped.length === 1 ? "item" : "items"} that could
						not be converted:
					</span>
					<ul
						aria-label="Skipped KiCad items"
						class="m-0 mt-1 max-h-32 list-disc overflow-y-auto pl-4 text-fg-muted"
					>
						{/* Units of one multi-unit part share a name and reason. */}
						<For each={props.report.skipped.slice(0, 20)} keyed={false}>
							{(skipped) => (
								<li>
									{skipped().item.charAt(0).toUpperCase() +
										skipped().item.slice(1)}
									: {skipped().reason}
								</li>
							)}
						</For>
					</ul>
					<Show when={props.report.skipped.length > 20}>
						<span class="mt-1 block text-fg-muted">
							Showing the first 20. The report lists all{" "}
							{props.report.skipped.length}.
						</span>
					</Show>
				</>
			)}
			<span class="mt-3 flex justify-end gap-2">
				<button
					type="button"
					aria-label="Dismiss import report"
					class="ui-button"
					data-variant="ghost"
					onClick={() => props.onDismiss()}
				>
					Dismiss
				</button>
				<button
					type="button"
					class="ui-button"
					data-variant="secondary"
					onClick={() => props.onDownload()}
				>
					Download import report
				</button>
			</span>
		</output>
	);
}
