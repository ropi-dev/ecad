import { errorMessage } from "@ecad/drawing-core/lib/error-message.ts";
import {
	Box,
	ChevronLeft,
	ChevronRight,
	CircuitBoard,
	Component,
	FileCog,
	FileUp,
	Folder,
	FolderOpen,
	House,
	Layers,
	type LucideIcon,
	PanelLeft,
	PlugZap,
	Plus,
	Search,
	Settings,
	Workflow,
	X,
} from "lucide-react";
import { DropdownMenu, Tooltip } from "radix-ui";
import {
	Fragment,
	lazy,
	type ReactNode,
	Suspense,
	useCallback,
	useEffect,
	useId,
	useMemo,
	useRef,
	useState,
} from "react";
import { useSymbolLibrary } from "#/components/editor/useSymbolLibrary.ts";
import { PinnedNotice } from "#/components/ui/Toaster.tsx";
import { toastManager } from "#/components/ui/toast.ts";
import {
	hasShortcutModifier,
	shortcutModifier,
} from "#/components/viewer/shortcutModifier.ts";
import { TooltipButton } from "#/components/viewer/TooltipButton.tsx";
import {
	scrollFadeClassName,
	useScrollEdges,
} from "#/components/viewer/useScrollEdges.ts";
import type { KiCadImportReport } from "#/formats/kicad/import.ts";
import { addProjectFiles } from "#/projects/add-project-files.ts";
import { isProjectError } from "#/projects/errors.ts";
import {
	type AssetKind,
	PROJECT_FILE,
	type ProjectAsset,
} from "#/projects/format.ts";
import { OpenProjectButton } from "#/projects/OpenProjectButton.tsx";
import { ProjectLink, type ProjectPath } from "#/projects/ProjectLink.tsx";
import { ProjectMenu } from "#/projects/ProjectMenu.tsx";
import { useProjectSelection } from "#/projects/ProjectProvider.tsx";
import { primaryPcbId } from "#/projects/pcb.ts";
import { SaveProjectButton } from "#/projects/SaveProjectButton.tsx";
import {
	sidebarMenuContent,
	sidebarMenuItem,
	sidebarMenuLabel,
	sidebarMenuSeparator,
} from "#/projects/sidebarMenu.ts";
import {
	useWorkspaceControls,
	useWorkspaceRegistration,
	workspaceActionClassName,
} from "#/projects/WorkspaceControls.tsx";
import { LazySettingsDialog } from "#/settings/LazySettingsDialog.tsx";

const SidebarMcpControls = lazy(() =>
	import("#/components/editor/McpControls.tsx").then((module) => ({
		default: module.McpControls,
	})),
);
const CreateFileDialog = lazy(() =>
	import("#/components/editor/CreateFileDialog.tsx").then((module) => ({
		default: module.CreateFileDialog,
	})),
);
const focus =
	"focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent";
const row = `flex h-7 min-w-0 items-center gap-2 rounded-md text-sm no-underline pointer-coarse:h-11 ${focus}`;
// Hovering the window's left edge reveals the sidebar. The pointer has to rest
// there before it opens, and may stray out briefly before it closes.
const hoverOpenDelay = 250;
const hoverCloseDelay = 400;
// The file inputs stay mounted while the menu that opens them is closed.
const importTypes = [
	["kicad", "KiCad schematic", FileUp, ".kicad_sch", "KiCad schematic..."],
	["symbol", "symbol", Component, ".ecadsym,.json", "Symbols..."],
	["gerber", "Gerber", Layers, undefined, "Gerber files..."],
	["step", "STEP", Box, ".step,.stp", "STEP models..."],
] as const;
const newFileTypes = [
	["drawing", CircuitBoard],
	["symbol", Component],
	["circuit", Workflow],
] as const;
const fileIcons: Record<string, LucideIcon> = {
	Drawing: CircuitBoard,
	Circuit: Workflow,
	Symbol: Component,
	Gerber: Layers,
	STEP: Box,
	Project: FileCog,
};
const filters = [
	"All files",
	"Circuit",
	"Drawing",
	"Gerber",
	"STEP",
	"Symbol",
] as const;
const pageSize = 50;
interface ProjectFile {
	path: string;
	name: string;
	type: string;
	href?: ProjectPath;
	asset?: ProjectAsset;
	group?: string;
	circuitPath?: string;
	/** Opens the Gerber viewer with every layer instead of one file. */
	allLayers?: boolean;
}

export function ProjectFilesSidebar({
	onExit,
	footerActions,
}: {
	/** Quits the app. The Exit button shows only when it is given. */
	onExit?: () => void;
	footerActions?: ReactNode;
} = {}) {
	const project = useProjectSelection(
		({
			busy,
			createCircuit,
			createDrawing,
			createSymbol,
			importAssets,
			importSchematic,
			openCircuit,
			project,
			selectAsset,
			selectEditorFile,
		}) => ({
			busy,
			createCircuit,
			createDrawing,
			createSymbol,
			importAssets,
			importSchematic,
			openCircuit,
			project,
			selectAsset,
			selectEditorFile,
		}),
	);
	const workspaceControls = useWorkspaceControls();
	const registration = useWorkspaceRegistration();
	const setSidebarPinned = registration?.setSidebarPinned;
	const registerSidebar = registration?.registerSidebar;
	const library = useSymbolLibrary();
	const [pinned, setPinned] = useState(false);
	useEffect(() => {
		setSidebarPinned?.(pinned);
		return () => setSidebarPinned?.(false);
	}, [pinned, setSidebarPinned]);
	const fileInputs = useRef<Record<string, HTMLInputElement | null>>({});
	const [filterRow, setFilterRow] = useState<HTMLFieldSetElement | null>(null);
	useScrollEdges(filterRow);
	const [hovered, setHovered] = useState(false);
	const [focused, setFocused] = useState(false);
	const [touchOpen, setTouchOpen] = useState(false);
	const sidebarRef = useRef<HTMLFieldSetElement>(null);
	const panelRef = useRef<HTMLElement>(null);
	const hoverTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
	const hoverSoon = useCallback((next: boolean, delay: number) => {
		clearTimeout(hoverTimer.current);
		hoverTimer.current = setTimeout(() => setHovered(next), delay);
	}, []);
	const setHoveredNow = useCallback((next: boolean) => {
		clearTimeout(hoverTimer.current);
		setHovered(next);
	}, []);
	useEffect(() => () => clearTimeout(hoverTimer.current), []);
	const panelId = useId();
	const [query, setQuery] = useState("");
	const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());
	const [filter, setFilter] = useState<(typeof filters)[number]>("All files");
	const [page, setPage] = useState(0);
	const [importing, setImporting] = useState(false);
	const [error, setError] = useState("");
	const [importReport, setImportReport] = useState<KiCadImportReport>();
	const [creatingFile, setCreatingFile] = useState<
		"drawing" | "symbol" | "circuit" | null
	>(null);
	const [addMenuOpen, setAddMenuOpen] = useState(false);
	const [openMenuActive, setOpenMenuActive] = useState(false);
	const [projectMenuActive, setProjectMenuActive] = useState(false);
	const [settingsOpen, setSettingsOpen] = useState(false);
	// Menus and dialogs opened from the sidebar are portaled outside of it.
	const overlayOpen =
		addMenuOpen ||
		creatingFile !== null ||
		openMenuActive ||
		projectMenuActive ||
		settingsOpen;
	const open = pinned || hovered || focused || touchOpen || overlayOpen;
	useEffect(() => {
		if (overlayOpen) return;
		// A menu or dialog closing under the pointer leaves no pointerleave
		// behind, so the next mouse move decides whether the sidebar is hovered.
		const sync = (event: PointerEvent) => {
			if (event.pointerType !== "mouse") return;
			document.removeEventListener("pointermove", sync, true);
			setHoveredNow(
				event.target instanceof Node &&
					!!panelRef.current?.contains(event.target),
			);
		};
		document.addEventListener("pointermove", sync, true);
		return () => document.removeEventListener("pointermove", sync, true);
	}, [overlayOpen, setHoveredNow]);
	const togglePin = useCallback(() => {
		if (
			document.activeElement instanceof HTMLElement &&
			sidebarRef.current?.contains(document.activeElement)
		)
			document.activeElement.blur();
		setFocused(false);
		setHoveredNow(false);
		setTouchOpen(false);
		setPinned((current) => !current);
	}, [setHoveredNow]);
	const sidebarActions = useMemo(
		() => ({
			open: () => setTouchOpen(true),
			openAddMenu: () => {
				setTouchOpen(true);
				setAddMenuOpen(true);
			},
			openSettings: () => setSettingsOpen(true),
		}),
		[],
	);
	useEffect(
		() => registerSidebar?.(sidebarActions),
		[registerSidebar, sidebarActions],
	);
	const canAddFile = !!project?.project && !project.busy && !importing;
	useEffect(() => {
		const onKeyDown = (event: KeyboardEvent) => {
			if (
				!hasShortcutModifier(event) ||
				event.altKey ||
				!event.shiftKey ||
				event.code !== "KeyN" ||
				event.isComposing
			)
				return;
			event.preventDefault();
			event.stopImmediatePropagation();
			if (!event.repeat && canAddFile) sidebarActions.openAddMenu();
		};
		window.addEventListener("keydown", onKeyDown, true);
		return () => window.removeEventListener("keydown", onKeyDown, true);
	}, [canAddFile, sidebarActions]);
	useEffect(() => {
		const onKeyDown = (event: KeyboardEvent) => {
			if (
				!hasShortcutModifier(event) ||
				event.altKey ||
				!event.shiftKey ||
				event.code !== "KeyS" ||
				event.isComposing
			)
				return;
			event.preventDefault();
			event.stopPropagation();
			if (!event.repeat) togglePin();
		};
		window.addEventListener("keydown", onKeyDown, true);
		return () => window.removeEventListener("keydown", onKeyDown, true);
	}, [togglePin]);
	useEffect(() => {
		const onKeyDown = (event: KeyboardEvent) => {
			if (
				!hasShortcutModifier(event) ||
				event.altKey ||
				event.shiftKey ||
				event.key !== "," ||
				event.isComposing
			)
				return;
			event.preventDefault();
			event.stopPropagation();
			setSettingsOpen(true);
		};
		window.addEventListener("keydown", onKeyDown, true);
		return () => window.removeEventListener("keydown", onKeyDown, true);
	}, []);
	useEffect(() => {
		if (!onExit) return;
		const onKeyDown = (event: KeyboardEvent) => {
			if (
				!hasShortcutModifier(event) ||
				event.altKey ||
				event.shiftKey ||
				event.code !== "KeyQ" ||
				event.isComposing
			)
				return;
			event.preventDefault();
			event.stopPropagation();
			if (!event.repeat) onExit();
		};
		window.addEventListener("keydown", onKeyDown, true);
		return () => window.removeEventListener("keydown", onKeyDown, true);
	}, [onExit]);
	const closeDrawer = useCallback(() => {
		if (
			document.activeElement instanceof HTMLElement &&
			sidebarRef.current?.contains(document.activeElement)
		)
			document.activeElement.blur();
		setTouchOpen(false);
		setFocused(false);
		setHoveredNow(false);
	}, [setHoveredNow]);
	useEffect(() => {
		if (!touchOpen || pinned || overlayOpen) return;
		// The backdrop takes taps on the workspace. This covers what is drawn
		// above it, such as a toast.
		const dismiss = (event: PointerEvent) => {
			if (
				event.target instanceof Node &&
				!sidebarRef.current?.contains(event.target)
			)
				closeDrawer();
		};
		document.addEventListener("pointerdown", dismiss, true);
		return () => document.removeEventListener("pointerdown", dismiss, true);
	}, [touchOpen, pinned, overlayOpen, closeDrawer]);
	const editorLink = useRef<HTMLAnchorElement>(null);
	const snapshot = project?.project;
	const manifest = snapshot?.manifest;
	const files = useMemo<ProjectFile[]>(
		() =>
			manifest
				? [
						{ path: PROJECT_FILE, name: PROJECT_FILE, type: "Project" },
						...(snapshot?.circuits?.length
							? snapshot.circuits.flatMap((file, index) => {
									const paths = manifest.circuits?.[index];
									if (!paths) return [];
									const name = file.circuit.name;
									const drawingIndex =
										snapshot.drawings?.findIndex(
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
													group: name,
													circuitPath: paths.circuit,
												},
											]
										: [
												{
													path: paths.circuit,
													name: `${name}.ecaddraw`,
													type: "Circuit",
													href: "/editor" as const,
													group: name,
												},
											];
								})
							: [
									{
										path: manifest.drawing,
										name: "Drawing",
										type: "Drawing",
										href: "/editor" as const,
									},
								]),
						...(snapshot?.circuits?.length &&
						!snapshot.circuits.some(
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
								asset.kind === "step"
									? ("/step" as const)
									: ("/gerber" as const),
							asset,
						})),
					]
				: [],
		[manifest, snapshot?.circuits, snapshot?.drawings],
	);
	const filtered = useMemo(() => {
		const search = query.trim().toLowerCase();
		return files.filter(
			(file) =>
				(filter === "All files" ||
					file.type === filter ||
					(filter === "Circuit" && !!file.circuitPath)) &&
				(!search ||
					file.name.toLowerCase().includes(search) ||
					file.path.toLowerCase().includes(search)),
		);
	}, [files, filter, query]);
	const lastPage = Math.max(0, Math.ceil(filtered.length / pageSize) - 1);
	const currentPage = Math.min(page, lastPage);
	const first = currentPage * pageSize;
	if (!project) return null;
	const busy = project.busy || importing;
	function showError(cause: unknown, fallback: string) {
		if (!isProjectError(cause, "ProjectConflict")) {
			const description = errorMessage(cause, fallback);
			setError(description);
			toastManager.add({ type: "error", title: fallback, description });
		}
	}
	async function upload(files: File[], kind: AssetKind) {
		if (!project || !files.length) return;
		setImporting(true);
		setError("");
		try {
			setError(
				(await addProjectFiles(project.importAssets, files, kind)).problems,
			);
		} catch (cause) {
			showError(cause, "Unable to add project files.");
		} finally {
			setImporting(false);
		}
	}
	async function uploadSchematic(file: File) {
		if (!project) return;
		setImporting(true);
		setError("");
		setImportReport(undefined);
		try {
			const { path, report } = await project.importSchematic(file);
			setImportReport(report);
			toastManager.add({ type: "success", title: "Schematic imported" });
			project.selectEditorFile(path);
			editorLink.current?.click();
		} catch (cause) {
			showError(cause, "Unable to import schematic.");
		} finally {
			setImporting(false);
		}
	}

	const activePath = workspaceControls?.document?.path;
	const circuitOpen = workspaceControls?.document?.circuit ?? false;
	const plain = workspaceControls?.document?.plain ?? true;
	const report = importReport && (
		<output className="ui-panel block bg-raised p-3 text-xs shadow-pop">
			<span className="block font-semibold">KiCad schematic imported</span>
			<span className="mt-1 block text-fg-muted">
				Imported KiCad drawing with electrical net and supply names. Review
				conversion limits and source metadata in the report.
			</span>
			{importReport.skipped.length > 0 && (
				<>
					<span className="mt-2 block font-medium text-warning">
						Skipped {importReport.skipped.length}{" "}
						{importReport.skipped.length === 1 ? "item" : "items"} that could
						not be converted:
					</span>
					<ul
						aria-label="Skipped KiCad items"
						className="m-0 mt-1 max-h-32 list-disc overflow-y-auto pl-4 text-fg-muted"
					>
						{importReport.skipped
							.slice(0, 20)
							.map(({ item, reason }, index) => (
								// Units of one multi-unit part share a name and reason.
								// biome-ignore lint/suspicious/noArrayIndexKey: see above
								<li key={index}>
									{item.charAt(0).toUpperCase() + item.slice(1)}: {reason}
								</li>
							))}
					</ul>
					{importReport.skipped.length > 20 && (
						<span className="mt-1 block text-fg-muted">
							Showing the first 20. The report lists all{" "}
							{importReport.skipped.length}.
						</span>
					)}
				</>
			)}
			<span className="mt-3 flex justify-end gap-2">
				<button
					type="button"
					aria-label="Dismiss import report"
					className="ui-button"
					data-variant="ghost"
					onClick={() => setImportReport(undefined)}
				>
					Dismiss
				</button>
				<button
					type="button"
					className="ui-button"
					data-variant="secondary"
					onClick={() => {
						const url = URL.createObjectURL(
							new Blob([JSON.stringify(importReport, null, 2)], {
								type: "application/json",
							}),
						);
						const link = document.createElement("a");
						link.href = url;
						link.download = "kicad-import-report.json";
						link.click();
						setTimeout(() => URL.revokeObjectURL(url), 1000);
					}}
				>
					Download import report
				</button>
			</span>
		</output>
	);

	return (
		<fieldset
			ref={sidebarRef}
			aria-label="File sidebar"
			data-shortcut-scope="sidebar"
			className={`relative z-30 m-0 h-full min-w-0 shrink-0 border-0 p-0 text-fg ${pinned ? "w-64 max-w-[calc(100vw-4rem)]" : "w-0"}`}
			onMouseDownCapture={() => setFocused(false)}
			onFocusCapture={(event) => {
				if (event.target.matches(":focus-visible")) setFocused(true);
			}}
			onBlurCapture={(event) => {
				if (!event.currentTarget.contains(event.relatedTarget))
					setFocused(false);
			}}
			onKeyDown={(event) => {
				if (
					event.key === "Escape" &&
					!overlayOpen &&
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
			{touchOpen && !pinned && !overlayOpen && (
				<div
					aria-hidden="true"
					data-testid="sidebar-backdrop"
					className="fixed inset-0 animate-fade-in bg-scrim/50 motion-reduce:animate-none"
					onClick={closeDrawer}
				/>
			)}
			{/* Resting the mouse on the left edge reveals the sidebar. */}
			<div
				aria-hidden="true"
				data-testid="sidebar-edge"
				className="absolute inset-y-0 left-0 z-10 w-2"
				onPointerEnter={(event) => {
					if (
						event.pointerType === "mouse" &&
						window.matchMedia("(hover: hover)").matches
					)
						hoverSoon(true, hoverOpenDelay);
				}}
				onPointerLeave={(event) => {
					if (event.pointerType === "mouse") hoverSoon(false, hoverCloseDelay);
				}}
				onClick={() => setTouchOpen(true)}
			/>
			{/* Opens the sidebar on a click, never on hover. The open panel
			    covers it. */}
			<button
				type="button"
				aria-label="Show project files"
				aria-expanded={open}
				aria-controls={panelId}
				tabIndex={open ? -1 : 0}
				data-shortcut-scope={open ? "none" : undefined}
				className={`ui-panel absolute top-[var(--chrome-top)] left-[var(--chrome-gap)] z-10 grid size-[var(--chrome-control)] cursor-pointer place-items-center text-fg-muted hover:text-fg ${focus} ${plain ? "workspace-plain" : ""}`}
				onClick={() => setTouchOpen(true)}
			>
				<PanelLeft size={18} aria-hidden="true" />
			</button>
			{report && (
				<PinnedNotice fallbackClassName="fixed right-4 bottom-4 z-50 w-[min(360px,calc(100vw-2rem))]">
					{report}
				</PinnedNotice>
			)}

			<aside
				ref={panelRef}
				id={panelId}
				aria-label="Project files"
				data-open={open}
				data-pinned={pinned}
				aria-hidden={!open}
				inert={!open}
				onPointerEnter={(event) => {
					if (
						event.pointerType === "mouse" &&
						window.matchMedia("(hover: hover)").matches
					)
						setHoveredNow(true);
				}}
				onPointerLeave={(event) => {
					if (event.pointerType === "mouse") hoverSoon(false, hoverCloseDelay);
				}}
				className={`absolute inset-y-0 left-0 z-20 flex h-full w-64 max-w-[calc(100vw-4rem)] min-h-0 flex-col overflow-hidden border-r border-line bg-panel transition-transform duration-200 ease-in-out motion-reduce:transition-none ${open ? "translate-x-0" : "-translate-x-full"} ${open && !pinned ? "shadow-pop" : ""}`}
			>
				<header className="flex h-12 shrink-0 items-center gap-1 pr-2 pl-2">
					<ProjectLink
						href="/"
						aria-label="Workspace home"
						title={snapshot?.manifest.name}
						className={`flex h-8 min-w-0 flex-1 items-center gap-2 rounded-md px-1.5 text-fg no-underline hover:bg-hover pointer-coarse:h-11 ${focus}`}
					>
						<House
							size={16}
							className="shrink-0 text-fg-faint"
							aria-hidden="true"
						/>
						<span className="truncate text-sm font-semibold">
							{snapshot?.manifest.name ?? "ECAD"}
						</span>
					</ProjectLink>
					{snapshot && (
						<DropdownMenu.Root
							open={addMenuOpen}
							onOpenChange={setAddMenuOpen}
							modal={false}
						>
							<DropdownMenu.Trigger asChild>
								<button
									type="button"
									aria-label="Add file"
									disabled={busy}
									className="ui-button"
									data-variant="ghost"
									data-icon
								>
									<Plus size={16} aria-hidden="true" />
								</button>
							</DropdownMenu.Trigger>
							<DropdownMenu.Portal>
								<DropdownMenu.Content
									aria-label="Add file"
									align="end"
									sideOffset={6}
									collisionPadding={12}
									onCloseAutoFocus={(event) => {
										if (creatingFile) event.preventDefault();
									}}
									className={sidebarMenuContent}
								>
									<DropdownMenu.Label className={sidebarMenuLabel}>
										New
									</DropdownMenu.Label>
									{newFileTypes.map(([kind, Icon]) => (
										<DropdownMenu.Item
											key={kind}
											className={sidebarMenuItem}
											disabled={busy}
											onSelect={() => setCreatingFile(kind)}
										>
											<Icon size={14} aria-hidden="true" />
											New {kind}
										</DropdownMenu.Item>
									))}
									<DropdownMenu.Separator className={sidebarMenuSeparator} />
									<DropdownMenu.Label className={sidebarMenuLabel}>
										Import
									</DropdownMenu.Label>
									{importTypes.map(([kind, , Icon, , item]) => (
										<DropdownMenu.Item
											key={kind}
											className={sidebarMenuItem}
											disabled={busy || (kind === "symbol" && library.loading)}
											onSelect={() => fileInputs.current[kind]?.click()}
										>
											<Icon size={14} aria-hidden="true" />
											{item}
										</DropdownMenu.Item>
									))}
								</DropdownMenu.Content>
							</DropdownMenu.Portal>
						</DropdownMenu.Root>
					)}
				</header>
				{importTypes.map(([kind, label, , accept]) => (
					<input
						key={kind}
						ref={(node) => {
							fileInputs.current[kind] = node;
						}}
						type="file"
						hidden
						multiple={kind !== "kicad"}
						aria-label={`Add ${label} files`}
						accept={accept}
						disabled={
							!snapshot || busy || (kind === "symbol" && library.loading)
						}
						onChange={(event) => {
							const files = Array.from(event.target.files ?? []);
							if (kind === "kicad") {
								if (files[0]) void uploadSchematic(files[0]);
							} else if (kind === "symbol") void library.upload(files);
							else void upload(files, kind);
							event.target.value = "";
						}}
					/>
				))}
				<nav
					aria-label="Workspaces"
					className="grid shrink-0 grid-cols-4 gap-1.5 px-3 pb-3"
				>
					<OpenProjectButton onActiveChange={setOpenMenuActive} />
					<SaveProjectButton />
					<ProjectMenu onActiveChange={setProjectMenuActive} />
					{workspaceControls?.editor ? (
						workspaceControls.editor.enableMcp ? (
							<Suspense
								fallback={
									<button
										type="button"
										aria-label="Enable MCP"
										disabled
										className={workspaceActionClassName}
									>
										<PlugZap size={18} aria-hidden="true" />
										MCP
									</button>
								}
							>
								<SidebarMcpControls
									store={workspaceControls.editor.store}
									compact
								/>
							</Suspense>
						) : (
							<button
								type="button"
								aria-label="MCP unavailable"
								disabled
								className={workspaceActionClassName}
							>
								<PlugZap size={18} aria-hidden="true" />
								MCP
							</button>
						)
					) : (
						<ProjectLink
							href="/editor"
							aria-label="Schematic editor"
							onClick={() => project.selectEditorFile()}
							className={workspaceActionClassName}
						>
							<CircuitBoard size={18} aria-hidden="true" />
							Editor
						</ProjectLink>
					)}
				</nav>
				<div className="flex min-h-0 flex-1 flex-col overflow-hidden border-t border-line-subtle">
					{snapshot ? (
						<>
							<div className="shrink-0 pt-3 pb-2">
								<div className="mx-3 flex h-7 items-center gap-2 rounded-md border border-line bg-field px-2 focus-within:border-accent hover:border-line-strong pointer-coarse:h-11">
									<Search
										className="size-3.5 shrink-0 text-fg-faint"
										aria-hidden="true"
									/>
									<input
										type="search"
										aria-label="Search project files"
										placeholder="Find a file..."
										value={query}
										onChange={(event) => {
											setQuery(event.target.value);
											setPage(0);
										}}
										className="h-full min-w-0 flex-1 bg-transparent text-xs text-fg outline-none placeholder:text-fg-faint pointer-coarse:text-lg [&::-webkit-search-cancel-button]:hidden"
									/>
									{query && (
										<button
											type="button"
											aria-label="Clear file search"
											className={`-mr-1 grid size-5 cursor-pointer place-items-center rounded-sm text-fg-faint hover:bg-hover hover:text-fg pointer-coarse:size-11 ${focus}`}
											onClick={() => {
												setQuery("");
												setPage(0);
											}}
										>
											<X className="size-3.5" aria-hidden="true" />
										</button>
									)}
								</div>
								<div className="group relative mt-2">
									<fieldset
										ref={setFilterRow}
										aria-label="File types"
										className={`m-0 flex min-w-0 gap-1 overflow-x-auto border-0 px-3 py-0 [scrollbar-width:none] ${scrollFadeClassName}`}
										onWheel={(event) => {
											// A mouse wheel scrolls the one-line row sideways.
											if (Math.abs(event.deltaY) > Math.abs(event.deltaX))
												event.currentTarget.scrollLeft += event.deltaY;
										}}
									>
										{filters.map((type) => (
											<button
												key={type}
												type="button"
												aria-label={
													type === "Symbol" ? "Symbol files" : undefined
												}
												aria-pressed={filter === type}
												className={`ui-toggle h-6 shrink-0 cursor-pointer rounded-full border px-2.5 text-2xs font-medium [--toggle-line:var(--color-line-subtle)] [--toggle-on-line:var(--color-accent-line)] hover:[--toggle-bg:transparent] hover:[--toggle-line:var(--color-line)] pointer-coarse:h-11 pointer-coarse:px-3.5 ${focus}`}
												onClick={(event) => {
													setFilter(type);
													setPage(0);
													event.currentTarget.scrollIntoView({
														block: "nearest",
														inline: "nearest",
													});
												}}
											>
												{type === "Symbol" ? "Symbols" : type}
											</button>
										))}
									</fieldset>
									{/* More file types lie to this side. */}
									<ChevronLeft
										size={13}
										strokeWidth={2.5}
										aria-hidden="true"
										className="pointer-events-none absolute top-1/2 left-0.5 hidden -translate-y-1/2 text-fg group-data-[fade=both]:block group-data-[fade=start]:block"
									/>
									<ChevronRight
										size={13}
										strokeWidth={2.5}
										aria-hidden="true"
										className="pointer-events-none absolute top-1/2 right-0.5 hidden -translate-y-1/2 text-fg group-data-[fade=both]:block group-data-[fade=end]:block"
									/>
								</div>
							</div>
							{importing && (
								<output
									className="px-3 py-1 text-xs text-fg-muted"
									aria-live="polite"
								>
									<span>Adding project files...</span>
								</output>
							)}
							{(error || library.error) && (
								<p
									role="alert"
									title={error || library.error || undefined}
									className="m-0 line-clamp-3 px-3 py-1 text-xs text-warning"
								>
									<span>{error || library.error}</span>
								</p>
							)}
							{library.message && (
								<output className="sr-only" aria-live="polite">
									{library.message}
								</output>
							)}
							<div className="min-h-0 flex-1 overflow-auto overscroll-contain px-2 pb-2">
								<table className="w-full table-fixed border-collapse text-left">
									<caption className="sr-only">
										Files in the current project
									</caption>
									<thead className="sr-only">
										<tr>
											<th scope="col">Name</th>
										</tr>
									</thead>
									<tbody>
										{filtered
											.slice(first, first + pageSize)
											.map((file, index) => {
												const Icon = fileIcons[file.type] ?? FileCog;
												const circuitActive =
													circuitOpen &&
													activePath === (file.circuitPath ?? file.path);
												const active =
													file.type === "Circuit"
														? circuitActive
														: !circuitOpen && activePath === file.path;
												const content = (
													<>
														<Icon
															size={15}
															className="ui-toggle-faint shrink-0"
															aria-hidden="true"
														/>
														<span className="truncate">{file.name}</span>
													</>
												);
												return (
													<Fragment key={file.path}>
														{file.group &&
															(index === 0 ||
																filtered[first + index - 1]?.group !==
																	file.group) && (
																<tr>
																	<td className="p-0">
																		<button
																			type="button"
																			aria-expanded={!collapsed.has(file.group)}
																			className={`${row} w-full cursor-pointer px-1.5 font-medium text-fg hover:bg-hover`}
																			onClick={() =>
																				setCollapsed((current) => {
																					const next = new Set(current);
																					const group = file.group;
																					if (group === undefined) return next;
																					if (next.has(group))
																						next.delete(group);
																					else next.add(group);
																					return next;
																				})
																			}
																		>
																			<ChevronRight
																				size={14}
																				aria-hidden="true"
																				className={`shrink-0 text-fg-faint transition-transform duration-100 ${
																					collapsed.has(file.group)
																						? ""
																						: "rotate-90"
																				}`}
																			/>
																			{collapsed.has(file.group) ? (
																				<Folder
																					size={15}
																					aria-hidden="true"
																					className="shrink-0 text-fg-faint"
																				/>
																			) : (
																				<FolderOpen
																					size={15}
																					aria-hidden="true"
																					className="shrink-0 text-fg-faint"
																				/>
																			)}
																			<span className="truncate">
																				{file.group}
																			</span>
																		</button>
																	</td>
																</tr>
															)}
														<tr
															hidden={!!file.group && collapsed.has(file.group)}
														>
															<td
																className={`p-0 ${file.group ? "pl-[22px]" : ""}`}
															>
																{file.href ? (
																	<ProjectLink
																		href={file.href}
																		file={
																			file.allLayers ? undefined : file.path
																		}
																		view={
																			file.type === "Circuit"
																				? "circuit"
																				: undefined
																		}
																		aria-label={
																			file.allLayers
																				? "Open all Gerber layers"
																				: `Open ${file.name}${file.type === "Circuit" ? " in circuit view" : ""}`
																		}
																		aria-current={active ? "page" : undefined}
																		title={`${file.name} · ${file.type}`}
																		className={`ui-toggle ${row} px-1.5 aria-[current=page]:font-medium`}
																		onClick={() => {
																			if (!pinned) closeDrawer();
																			if (file.href === "/editor") {
																				if (file.type === "Circuit")
																					void project
																						.openCircuit(file.path)
																						.catch((cause) =>
																							showError(
																								cause,
																								"Unable to open circuit.",
																							),
																						);
																				else
																					project.selectEditorFile(file.path);
																			}
																			if (file.asset)
																				project.selectAsset(file.asset);
																			else if (file.allLayers)
																				project.selectAsset(null);
																		}}
																	>
																		{content}
																	</ProjectLink>
																) : (
																	<div
																		title={`${file.name} · ${file.type}`}
																		className={`${row} px-1.5 text-fg-faint`}
																	>
																		{content}
																	</div>
																)}
																{file.circuitPath && (
																	<ProjectLink
																		href="/editor"
																		file={file.circuitPath ?? file.path}
																		view="circuit"
																		aria-label={`Open ${file.name} in circuit view`}
																		aria-current={
																			circuitActive ? "page" : undefined
																		}
																		className={`ui-toggle ${row} ml-[11px] border-l pr-1.5 pl-[11px] [--toggle-line:var(--color-line)] [--toggle-on-line:var(--color-line)] aria-[current=page]:font-medium`}
																		onClick={() => {
																			if (!pinned) closeDrawer();
																			void project
																				.openCircuit(
																					file.circuitPath ?? file.path,
																				)
																				.catch((cause) =>
																					showError(
																						cause,
																						"Unable to open circuit.",
																					),
																				);
																		}}
																	>
																		<Workflow
																			size={15}
																			aria-hidden="true"
																			className="ui-toggle-faint shrink-0"
																		/>
																		<span className="truncate">
																			Circuit view
																		</span>
																	</ProjectLink>
																)}
															</td>
														</tr>
													</Fragment>
												);
											})}
									</tbody>
								</table>
								{!filtered.length && (
									<div className="px-1.5 py-3 text-xs text-fg-muted">
										<p className="m-0">No matching files</p>
										<button
											type="button"
											className="ui-button mt-2"
											data-variant="secondary"
											onClick={() => {
												setQuery("");
												setFilter("All files");
												setPage(0);
											}}
										>
											Clear filters
										</button>
									</div>
								)}
							</div>
							{lastPage > 0 && (
								<footer className="flex h-9 shrink-0 items-center justify-between gap-2 border-t border-line-subtle pr-2 pl-3 text-2xs text-fg-faint tabular-nums">
									<span>
										{first + 1}–{Math.min(first + pageSize, filtered.length)} of{" "}
										{filtered.length}
									</span>
									<nav aria-label="Project file pages" className="flex gap-1">
										<button
											type="button"
											aria-label="Previous files"
											disabled={!currentPage}
											className="ui-button"
											data-variant="ghost"
											data-icon
											onClick={() => setPage(currentPage - 1)}
										>
											<ChevronLeft className="size-3.5" aria-hidden="true" />
										</button>
										<button
											type="button"
											aria-label="Next files"
											disabled={currentPage === lastPage}
											className="ui-button"
											data-variant="ghost"
											data-icon
											onClick={() => setPage(currentPage + 1)}
										>
											<ChevronRight className="size-3.5" aria-hidden="true" />
										</button>
									</nav>
								</footer>
							)}
						</>
					) : null}
				</div>
				<ProjectLink href="/editor" ref={editorLink} hidden tabIndex={-1}>
					Open new file
				</ProjectLink>
				<Tooltip.Provider delayDuration={350} skipDelayDuration={150}>
					<footer className="flex shrink-0 items-center gap-1 border-t border-line-subtle p-2">
						{onExit && (
							<TooltipButton
								aria-label="Exit"
								aria-keyshortcuts={`${shortcutModifier().key}+Q`}
								tooltip="Exit"
								shortcut="Ctrl+Q"
								// Only Ctrl+Q quits. The held-modifier hints skip this button,
								// so another chord cannot quit by accident.
								data-shortcut-scope="none"
								className="ui-button"
								data-variant="ghost"
								data-icon
								onClick={onExit}
							>
								<X size={15} aria-hidden="true" />
							</TooltipButton>
						)}
						<TooltipButton
							aria-label="Settings"
							aria-keyshortcuts={`${shortcutModifier().key}+,`}
							tooltip="Settings"
							shortcut="Ctrl+,"
							data-shortcut-scope="none"
							className="ui-button"
							data-variant="ghost"
							data-icon
							onClick={() => setSettingsOpen(true)}
						>
							<Settings size={15} aria-hidden="true" />
						</TooltipButton>
						{footerActions}
						{/* Lit while the sidebar is pinned beside the workspace. */}
						<TooltipButton
							aria-label={pinned ? "Compact sidebar" : "Pin sidebar"}
							aria-pressed={pinned}
							aria-keyshortcuts={`${shortcutModifier().key}+Shift+S`}
							aria-controls={panelId}
							tooltip={pinned ? "Compact sidebar" : "Pin sidebar"}
							shortcut="Ctrl+Shift+S"
							className="ui-button ui-toggle ml-auto"
							data-icon
							onClick={togglePin}
						>
							<PanelLeft size={16} aria-hidden="true" />
						</TooltipButton>
					</footer>
				</Tooltip.Provider>
			</aside>
			<LazySettingsDialog open={settingsOpen} onOpenChange={setSettingsOpen} />
			{creatingFile && (
				<div className="pointer-events-auto">
					<Suspense fallback={null}>
						<CreateFileDialog
							kind={creatingFile}
							description={`Create an empty ${creatingFile} file in this project and open it for editing.`}
							onClose={() => setCreatingFile(null)}
							onCreate={async (name) => {
								try {
									const path = await (creatingFile === "circuit"
										? project.createCircuit(name)
										: creatingFile === "drawing"
											? project.createDrawing(name)
											: project.createSymbol(name));
									if (creatingFile === "circuit")
										await project.openCircuit(path);
									else project.selectEditorFile(path);
									setCreatingFile(null);
									editorLink.current?.click();
								} catch (cause) {
									return errorMessage(
										cause,
										`Unable to create the ${creatingFile}.`,
									);
								}
							}}
						/>
					</Suspense>
				</div>
			)}
		</fieldset>
	);
}
