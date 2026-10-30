import {
	Box,
	ChevronLeft,
	ChevronRight,
	CircuitBoard,
	File,
	FolderOpen,
	Layers,
	ListTree,
	Pin,
	PinOff,
	PlugZap,
	Plus,
	Search,
	X,
} from "lucide-react";
import { DropdownMenu } from "radix-ui";
import {
	Fragment,
	lazy,
	Suspense,
	useCallback,
	useEffect,
	useId,
	useMemo,
	useRef,
	useState,
} from "react";
import { useSymbolLibrary } from "#/components/editor/useSymbolLibrary.ts";
import {
	type AssetKind,
	PROJECT_FILE,
	type ProjectAsset,
} from "#/projects/format.ts";
import { ProjectLink, type ProjectPath } from "#/projects/ProjectLink.tsx";
import { ProjectMenu } from "#/projects/ProjectMenu.tsx";
import { useProject } from "#/projects/ProjectProvider.tsx";
import {
	useWorkspaceControls,
	workspaceActionClassName,
} from "#/projects/WorkspaceControls.tsx";

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
	"focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-[#e8b77e]";
const button = `inline-flex h-7 items-center justify-center gap-1.5 rounded text-[11px] text-[#98a4b6] hover:bg-white/10 hover:text-white disabled:opacity-40 ${focus}`;
const menuItem =
	"flex cursor-pointer items-center gap-2 rounded px-2 py-2 text-xs outline-none data-[highlighted]:bg-white/10 data-[highlighted]:text-white data-[disabled]:pointer-events-none data-[disabled]:opacity-40";
const importTypes = [
	["kicad", "KiCad schematic", CircuitBoard, ".kicad_sch"],
	["symbol", "symbol", CircuitBoard, ".ecadsym,.json"],
	["gerber", "Gerber", Layers, undefined],
	["step", "STEP", Box, ".step,.stp"],
] as const;
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
}

export function ProjectFilesSidebar() {
	const project = useProject();
	const workspaceControls = useWorkspaceControls();
	const library = useSymbolLibrary();
	const [pinned, setPinned] = useState(false);
	const [hovered, setHovered] = useState(false);
	const [focused, setFocused] = useState(false);
	const [touchOpen, setTouchOpen] = useState(false);
	const sidebarRef = useRef<HTMLFieldSetElement>(null);
	const panelId = useId();
	const [query, setQuery] = useState("");
	const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());
	const [filter, setFilter] = useState<(typeof filters)[number]>("All files");
	const [page, setPage] = useState(0);
	const [importing, setImporting] = useState(false);
	const [error, setError] = useState("");
	const [importReport, setImportReport] = useState("");
	const [creatingFile, setCreatingFile] = useState<
		"drawing" | "symbol" | "circuit" | null
	>(null);
	const [addMenuOpen, setAddMenuOpen] = useState(false);
	const open =
		pinned ||
		hovered ||
		focused ||
		touchOpen ||
		addMenuOpen ||
		creatingFile !== null;
	const togglePin = useCallback(() => {
		if (
			document.activeElement instanceof HTMLElement &&
			sidebarRef.current?.contains(document.activeElement)
		)
			document.activeElement.blur();
		setFocused(false);
		setHovered(false);
		setTouchOpen(false);
		setPinned((current) => !current);
	}, []);
	useEffect(() => {
		const onKeyDown = (event: KeyboardEvent) => {
			if (
				!event.ctrlKey ||
				!event.altKey ||
				event.metaKey ||
				event.shiftKey ||
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
		if (!touchOpen || pinned || addMenuOpen || creatingFile) return;
		const dismiss = (event: PointerEvent) => {
			if (
				!(event.target instanceof Node) ||
				sidebarRef.current?.contains(event.target)
			)
				return;
			if (
				document.activeElement instanceof HTMLElement &&
				sidebarRef.current?.contains(document.activeElement)
			)
				document.activeElement.blur();
			setTouchOpen(false);
			setFocused(false);
			setHovered(false);
		};
		document.addEventListener("pointerdown", dismiss, true);
		return () => document.removeEventListener("pointerdown", dismiss, true);
	}, [touchOpen, pinned, addMenuOpen, creatingFile]);
	const editorLink = useRef<HTMLAnchorElement>(null);
	const snapshot = project?.project;
	const manifest = snapshot?.manifest;
	const files = useMemo<ProjectFile[]>(
		() =>
			manifest
				? [
						{ path: PROJECT_FILE, name: PROJECT_FILE, type: "Project" },
						...((snapshot?.circuits?.length ?? 0)
							? snapshot!.circuits!.flatMap((file, index) => {
									const paths = manifest.circuits?.[index];
									if (!paths) return [];
									const name = file.circuit.name;
									const drawingIndex =
										snapshot!.drawings?.findIndex(
											(drawing) => drawing.circuitId === file.circuit.id,
										) ?? -1;
									const drawingPath =
										file.circuit.id === "pcb-main"
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
								file.circuit.id === "pcb-main" && manifest.circuits?.[index],
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
	async function upload(files: File[], kind: AssetKind) {
		if (!project || !files.length) return;
		setImporting(true);
		setError("");
		try {
			await project.importAssets(files, kind);
		} catch (cause) {
			setError(
				cause instanceof Error ? cause.message : "Unable to add project files.",
			);
		} finally {
			setImporting(false);
		}
	}
	async function uploadSchematic(file: File) {
		if (!project) return;
		setImporting(true);
		setError("");
		setImportReport("");
		try {
			const { path, report } = await project.importSchematic(file);
			setImportReport(JSON.stringify(report, null, 2));
			project.selectEditorFile(path);
			editorLink.current?.click();
		} catch (cause) {
			setError(
				cause instanceof Error ? cause.message : "Unable to import schematic.",
			);
		} finally {
			setImporting(false);
		}
	}

	return (
		<fieldset
			ref={sidebarRef}
			aria-label="File sidebar"
			className={`relative z-30 m-0 h-full min-w-0 shrink-0 border-0 p-0 text-[#c7d0dc] ${pinned ? "w-64 max-w-[calc(100vw-4rem)]" : "w-0"}`}
			onPointerEnter={(event) => {
				if (
					event.pointerType === "mouse" &&
					window.matchMedia("(hover: hover)").matches
				)
					setHovered(true);
			}}
			onPointerLeave={(event) => {
				if (event.pointerType === "mouse") setHovered(false);
			}}
			onMouseDownCapture={() => setFocused(false)}
			onFocusCapture={(event) => {
				if (event.target.matches(":focus-visible")) setFocused(true);
			}}
			onBlurCapture={(event) => {
				if (!event.currentTarget.contains(event.relatedTarget))
					setFocused(false);
			}}
			onKeyDown={(event) => {
				if (event.key === "Escape" && !addMenuOpen && !creatingFile) {
					(document.activeElement as HTMLElement)?.blur();
					setFocused(false);
					setHovered(false);
					setTouchOpen(false);
				}
			}}
		>
			<button
				type="button"
				aria-label="Show project files"
				aria-expanded={open}
				aria-controls={panelId}
				tabIndex={open ? -1 : 0}
				className={`absolute inset-y-0 left-0 z-10 w-2 border-0 bg-transparent p-0 ${focus}`}
				onClick={() => setTouchOpen(true)}
			/>
			{importReport && (
				<output className="fixed bottom-4 right-4 z-50 max-w-sm rounded border border-white/20 bg-[#191c22] p-3 text-xs shadow-lg">
					<span className="block">
						Imported KiCad drawing with electrical net and supply names. Review
						conversion limits and source metadata in the report.
					</span>
					<button
						type="button"
						className={button}
						onClick={() => {
							const url = URL.createObjectURL(
								new Blob([importReport], { type: "application/json" }),
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
					<button
						type="button"
						aria-label="Dismiss import report"
						className={button}
						onClick={() => setImportReport("")}
					>
						Dismiss
					</button>
				</output>
			)}

			<aside
				id={panelId}
				aria-label="Project files"
				data-open={open}
				data-pinned={pinned}
				aria-hidden={!open}
				inert={!open}
				className={`absolute inset-y-0 left-0 flex h-full w-64 max-w-[calc(100vw-4rem)] min-h-0 flex-col overflow-hidden border-r border-[#343b46] bg-[#191c22] transition-transform duration-200 ease-in-out motion-reduce:transition-none ${open ? "translate-x-0" : "-translate-x-full"} ${open && !pinned ? "shadow-xl" : ""}`}
			>
				<header className="flex shrink-0 items-center gap-2 border-b border-white/10 h-12 px-3">
					<ListTree
						size={17}
						aria-hidden="true"
						className="shrink-0 text-[#98a4b6]"
					/>
					<h2 className="m-0 text-[13px] font-semibold">Files</h2>
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
									title="Add file"
									disabled={busy}
									className={`${button} ml-auto w-7 data-[state=open]:bg-white/10 data-[state=open]:text-white`}
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
									className="pointer-events-auto z-50 min-w-48 max-h-[var(--radix-dropdown-menu-content-available-height)] overflow-y-auto rounded-lg border border-[#414955] bg-[#191c22] p-1 text-[#c7d0dc] shadow-[0_8px_32px_#0008]"
								>
									{(["drawing", "symbol", "circuit"] as const).map((kind) => (
										<DropdownMenu.Item
											key={kind}
											className={menuItem}
											disabled={busy}
											onSelect={() => setCreatingFile(kind)}
										>
											{kind === "drawing" ? (
												<File size={14} aria-hidden="true" />
											) : (
												<CircuitBoard size={14} aria-hidden="true" />
											)}
											New {kind}
										</DropdownMenu.Item>
									))}
								</DropdownMenu.Content>
							</DropdownMenu.Portal>
						</DropdownMenu.Root>
					)}
				</header>
				<nav
					aria-label="Workspaces"
					className="grid shrink-0 grid-cols-4 gap-2 border-b border-white/10 p-3"
				>
					<ProjectLink
						href="/gerber"
						aria-label="Gerber viewer"
						title="Gerber viewer"
						className={`${workspaceActionClassName} text-[#90c8bc]`}
					>
						<Layers size={20} aria-hidden="true" />
					</ProjectLink>
					<ProjectLink
						href="/step"
						aria-label="STEP viewer"
						title="STEP viewer"
						className={`${workspaceActionClassName} text-[#a2b9e4]`}
					>
						<Box size={20} aria-hidden="true" />
					</ProjectLink>
					<ProjectMenu />
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
										<PlugZap size={20} aria-hidden="true" />
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
								title="MCP is unavailable in this editor"
								disabled
								className={workspaceActionClassName}
							>
								<PlugZap size={20} aria-hidden="true" />
							</button>
						)
					) : (
						<ProjectLink
							href="/editor"
							aria-label="Schematic editor"
							title="Schematic editor"
							onClick={() => project.selectEditorFile()}
							className={`${workspaceActionClassName} text-[#c3abd8]`}
						>
							<CircuitBoard size={20} aria-hidden="true" />
						</ProjectLink>
					)}
				</nav>
				<div className="flex min-h-0 flex-1 flex-col overflow-hidden">
					{snapshot ? (
						<>
							<div className="shrink-0 border-b border-white/10 pb-1">
								<div className="flex items-center h-9 gap-0.5 px-2">
									<ProjectLink
										href="/"
										aria-label="Workspace home"
										title={snapshot.manifest.name}
										className={`flex min-w-0 items-center rounded text-xs hover:bg-white/10 hover:text-white flex-1 gap-2 py-1 ${focus}`}
									>
										<FolderOpen
											size={14}
											className="shrink-0 text-[#98a4b6]"
											aria-hidden="true"
										/>
										<span className="truncate">{snapshot.manifest.name}</span>
									</ProjectLink>
									{importTypes.map(([kind, label, Icon, accept]) => (
										<label
											key={kind}
											title={`Add ${label} files`}
											className={`${button} relative w-6 shrink-0 cursor-pointer px-0 focus-within:outline-2 focus-within:outline-[#e8b77e] has-[:disabled]:opacity-40`}
										>
											<Icon className="size-3.5 shrink-0" aria-hidden="true" />
											<input
												type="file"
												multiple={kind !== "kicad"}
												aria-label={`Add ${label} files`}
												accept={accept}
												disabled={
													busy || (kind === "symbol" && library.loading)
												}
												className="absolute inset-0 size-full cursor-pointer opacity-0"
												onChange={(event) => {
													const files = Array.from(event.target.files ?? []);
													if (kind === "kicad") {
														if (files[0]) void uploadSchematic(files[0]);
													} else if (kind === "symbol")
														void library.upload(files);
													else void upload(files, kind);
													event.target.value = "";
												}}
											/>
										</label>
									))}
								</div>
								<div className="mx-2 flex items-center gap-2 rounded border border-white/10 bg-[#111318] px-2 focus-within:border-[#e8b77e80]">
									<Search
										className="size-3.5 shrink-0 text-[#98a4b6]"
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
										className="h-7 min-w-0 flex-1 bg-transparent text-xs outline-none [&::-webkit-search-cancel-button]:hidden"
									/>
									{query && (
										<button
											type="button"
											aria-label="Clear file search"
											className={`rounded p-1 ${focus}`}
											onClick={() => {
												setQuery("");
												setPage(0);
											}}
										>
											<X className="size-3.5" />
										</button>
									)}
								</div>
								<fieldset
									aria-label="File types"
									className="mt-1 flex flex-wrap gap-0.5 px-2"
								>
									{filters.map((type) => (
										<button
											key={type}
											type="button"
											aria-label={
												type === "Symbol" ? "Symbol files" : undefined
											}
											aria-pressed={filter === type}
											className={`rounded px-1 py-1 text-[10px] text-[#98a4b6] hover:bg-white/5 aria-pressed:bg-[#e8b77e1c] aria-pressed:text-[#e8b77e] ${focus}`}
											onClick={() => {
												setFilter(type);
												setPage(0);
											}}
										>
											{type === "Symbol" ? "Symbols" : type}
										</button>
									))}
								</fieldset>
							</div>
							{importing && (
								<output
									className="px-3 py-1 text-[11px] text-[#98a4b6]"
									aria-live="polite"
								>
									<span>Adding project files...</span>
								</output>
							)}
							{(error || library.error) && (
								<p
									role="alert"
									title={error || library.error || undefined}
									className="px-3 py-1 text-[11px] text-[#edc49a]"
								>
									<span>{error || library.error}</span>
								</p>
							)}
							{library.message && (
								<output className="sr-only" aria-live="polite">
									{library.message}
								</output>
							)}
							<div className="min-h-0 flex-1 overflow-auto overscroll-contain py-1">
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
												const Icon =
													file.type === "Drawing" ||
													file.type === "Symbol" ||
													file.type === "Circuit"
														? CircuitBoard
														: file.type === "Gerber"
															? Layers
															: file.type === "STEP"
																? Box
																: File;
												const content = (
													<>
														<span className="w-5 shrink-0" aria-hidden="true" />
														<Icon
															size={14}
															className="shrink-0 opacity-70"
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
																	<td>
																		<button
																			type="button"
																			aria-expanded={!collapsed.has(file.group)}
																			className={`flex h-8 w-full items-center gap-2 px-3 text-xs ${focus}`}
																			onClick={() =>
																				setCollapsed((current) => {
																					const next = new Set(current);
																					if (next.has(file.group!))
																						next.delete(file.group!);
																					else next.add(file.group!);
																					return next;
																				})
																			}
																		>
																			<ChevronRight
																				size={12}
																				className={
																					collapsed.has(file.group)
																						? ""
																						: "rotate-90"
																				}
																			/>
																			<FolderOpen size={14} />
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
															<td>
																{file.href ? (
																	<ProjectLink
																		href={file.href}
																		aria-label={`Open ${file.name}${file.type === "Circuit" ? " in circuit view" : ""}`}
																		title={`${file.name} · ${file.type}`}
																		className={`flex h-8 min-w-0 items-center gap-2 pr-3 pl-2 text-xs hover:bg-white/5 focus:bg-[#e8b77e1c] focus:text-[#e8b77e] ${focus}`}
																		onClick={() => {
																			if (file.href === "/editor") {
																				if (file.type === "Circuit")
																					void project
																						.openCircuit(file.path)
																						.catch((cause) =>
																							setError(
																								cause instanceof Error
																									? cause.message
																									: "Unable to open circuit.",
																							),
																						);
																				else
																					project.selectEditorFile(file.path);
																			}
																			if (file.asset)
																				project.selectAsset(file.asset);
																		}}
																	>
																		{content}
																	</ProjectLink>
																) : (
																	<div
																		title={`${file.name} · ${file.type}`}
																		className="flex h-8 items-center text-xs text-[#98a4b6] gap-2 pr-3 pl-2"
																	>
																		{content}
																	</div>
																)}
																{file.circuitPath && (
																	<ProjectLink
																		href="/editor"
																		aria-label={`Open ${file.name} in circuit view`}
																		className={`${button} ml-9 px-2`}
																		onClick={() => {
																			void project
																				.openCircuit(
																					file.circuitPath ?? file.path,
																				)
																				.catch((cause) =>
																					setError(
																						cause instanceof Error
																							? cause.message
																							: "Unable to open circuit.",
																					),
																				);
																		}}
																	>
																		<ListTree size={12} /> Circuit view
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
									<div className="px-4 py-3 text-xs text-[#98a4b6]">
										<p>No matching files</p>
										<button
											type="button"
											className={`${button} mt-1 px-2`}
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
								<footer className="flex shrink-0 items-center justify-end gap-2 border-t border-white/10 text-[10px] text-[#98a4b6] h-8 px-3">
									<nav aria-label="Project file pages" className="flex gap-1">
										<button
											type="button"
											aria-label="Previous files"
											disabled={!currentPage}
											className={`${button} w-7`}
											onClick={() => setPage(currentPage - 1)}
										>
											<ChevronLeft className="size-3.5" />
										</button>
										<button
											type="button"
											aria-label="Next files"
											disabled={currentPage === lastPage}
											className={`${button} w-7`}
											onClick={() => setPage(currentPage + 1)}
										>
											<ChevronRight className="size-3.5" />
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
				<footer className="shrink-0 border-t border-white/10 p-1.5">
					<button
						type="button"
						aria-label={pinned ? "Compact sidebar" : "Pin sidebar"}
						aria-pressed={pinned}
						aria-keyshortcuts="Control+Alt+S"
						title={`${pinned ? "Compact sidebar" : "Pin sidebar"} · Ctrl+Alt+S`}
						aria-controls={panelId}
						className={`${button} h-9 w-full justify-start px-2`}
						onClick={togglePin}
					>
						{pinned ? (
							<PinOff size={18} aria-hidden="true" />
						) : (
							<Pin size={18} aria-hidden="true" />
						)}
						<span>{pinned ? "Pinned" : "Compact"}</span>
						<kbd className="ml-auto text-[10px] text-[#98a4b6]">Ctrl+Alt+S</kbd>
					</button>
				</footer>
			</aside>
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
									return cause instanceof Error
										? cause.message
										: `Unable to create the ${creatingFile}.`;
								}
							}}
						/>
					</Suspense>
				</div>
			)}
		</fieldset>
	);
}
