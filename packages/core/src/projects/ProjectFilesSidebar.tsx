import {
	AlertCircle,
	Box,
	ChevronLeft,
	ChevronRight,
	CircuitBoard,
	File,
	Folder,
	FolderOpen,
	Layers,
	ListTree,
	LoaderCircle,
	PanelLeftClose,
	PanelLeftOpen,
	PlugZap,
	Plus,
	Search,
	X,
} from "lucide-react";
import { DropdownMenu } from "radix-ui";
import { lazy, Suspense, useId, useMemo, useRef, useState } from "react";
import { useSymbolLibrary } from "#/components/editor/useSymbolLibrary.ts";
import {
	type AssetKind,
	PROJECT_FILE,
	type ProjectAsset,
} from "#/projects/format.ts";
import { ProjectLink, type ProjectPath } from "#/projects/ProjectLink.tsx";
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
	["symbol", "symbol", CircuitBoard, ".ecadsym,.json"],
	["gerber", "Gerber", Layers, undefined],
	["step", "STEP", Box, ".step,.stp"],
] as const;
const filters = ["All files", "Drawing", "Gerber", "STEP", "Symbol"] as const;
const pageSize = 50;
interface ProjectFile {
	path: string;
	name: string;
	type: string;
	href?: ProjectPath;
	asset?: ProjectAsset;
}

export function ProjectFilesSidebar() {
	const project = useProject();
	const workspaceControls = useWorkspaceControls();
	const library = useSymbolLibrary();
	const [collapsed, setCollapsed] = useState(true);
	const panelId = useId();
	const [query, setQuery] = useState("");
	const [filter, setFilter] = useState<(typeof filters)[number]>("All files");
	const [page, setPage] = useState(0);
	const [importing, setImporting] = useState(false);
	const [error, setError] = useState("");
	const [creatingFile, setCreatingFile] = useState<"drawing" | "symbol" | null>(
		null,
	);
	const [addMenuOpen, setAddMenuOpen] = useState(false);
	const editorLink = useRef<HTMLAnchorElement>(null);
	const snapshot = project?.project;
	const manifest = snapshot?.manifest;
	const files = useMemo<ProjectFile[]>(
		() =>
			manifest
				? [
						{ path: PROJECT_FILE, name: PROJECT_FILE, type: "Project" },
						{
							path: manifest.drawing,
							name: "Drawing",
							type: "Drawing",
							href: "/editor",
						},
						...(manifest.drawings ?? []).map((path) => ({
							path,
							name: path.split("/").at(-1) ?? path,
							type: "Drawing",
							href: "/editor" as const,
						})),
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
							href: asset.kind === "step" ? ("/step" as const) : ("/" as const),
							asset,
						})),
					]
				: [],
		[manifest],
	);
	const filtered = useMemo(() => {
		const search = query.trim().toLowerCase();
		return files.filter(
			(file) =>
				(filter === "All files" || file.type === filter) &&
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
	return (
		<fieldset
			aria-label="File sidebar"
			className={`relative m-0 h-full min-w-0 shrink-0 border-0 border-r border-[#343b46] bg-[#191c22] p-0 text-[#c7d0dc] transition-[width] duration-200 ease-in-out motion-reduce:transition-none ${collapsed ? "w-12" : "w-64 max-w-[calc(100vw-4rem)]"}`}
		>
			<aside
				id={panelId}
				aria-label="Project files"
				data-open={!collapsed}
				className="flex h-full min-h-0 flex-col overflow-hidden"
			>
				<header
					className={`flex shrink-0 items-center gap-2 border-b border-white/10 ${collapsed ? "flex-col px-1.5 py-3" : "h-12 px-3"}`}
				>
					<ListTree
						size={17}
						aria-hidden="true"
						className="shrink-0 text-[#98a4b6]"
					/>
					<h2
						className={collapsed ? "sr-only" : "m-0 text-[13px] font-semibold"}
					>
						Files
					</h2>
					{!collapsed && (
						<span className="text-[11px] text-[#98a4b6]">{files.length}</span>
					)}
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
									className={`${button} ${collapsed ? "w-full" : "ml-auto w-7"} data-[state=open]:bg-white/10 data-[state=open]:text-white`}
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
									{(["drawing", "symbol"] as const).map((kind) => (
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
					className={`grid shrink-0 gap-1 border-b border-white/10 ${collapsed ? "grid-cols-1 p-1.5 [&>a]:h-9 [&>a]:rounded-md [&>button]:h-9 [&>button]:rounded-md" : "grid-cols-4 gap-2 p-3"}`}
				>
					<ProjectLink
						href="/"
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
					<ProjectLink
						href="/projects"
						aria-label="Projects"
						title="Projects"
						className={`${workspaceActionClassName} text-[#e8b77e]`}
					>
						<Folder size={20} aria-hidden="true" />
					</ProjectLink>
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
								<div
									className={`flex items-center ${collapsed ? "flex-col gap-1 p-1.5" : "h-9 gap-0.5 px-2"}`}
								>
									<ProjectLink
										href="/projects"
										aria-label="Project settings"
										title={snapshot.manifest.name}
										className={`flex min-w-0 items-center rounded text-xs hover:bg-white/10 hover:text-white ${collapsed ? "h-8 w-full justify-center" : "flex-1 gap-2 py-1"} ${focus}`}
									>
										<FolderOpen
											size={14}
											className="shrink-0 text-[#98a4b6]"
											aria-hidden="true"
										/>
										{!collapsed && (
											<span className="truncate">{snapshot.manifest.name}</span>
										)}
									</ProjectLink>
									{importTypes.map(([kind, label, Icon, accept]) => (
										<label
											key={kind}
											title={`Add ${label} files`}
											className={`${button} relative ${collapsed ? "h-8 w-full" : "w-6"} shrink-0 cursor-pointer px-0 focus-within:outline-2 focus-within:outline-[#e8b77e] has-[:disabled]:opacity-40`}
										>
											<Icon className="size-3.5 shrink-0" aria-hidden="true" />
											<input
												type="file"
												multiple
												aria-label={`Add ${label} files`}
												accept={accept}
												disabled={
													busy || (kind === "symbol" && library.loading)
												}
												className="absolute inset-0 size-full cursor-pointer opacity-0"
												onChange={(event) => {
													const files = Array.from(event.target.files ?? []);
													if (kind === "symbol") void library.upload(files);
													else void upload(files, kind);
													event.target.value = "";
												}}
											/>
										</label>
									))}
								</div>
								<div
									hidden={collapsed}
									className="mx-2 flex items-center gap-2 rounded border border-white/10 bg-[#111318] px-2 focus-within:border-[#e8b77e80]"
								>
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
									hidden={collapsed}
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
									className={
										collapsed
											? "flex justify-center py-2 text-[#98a4b6]"
											: "px-3 py-1 text-[11px] text-[#98a4b6]"
									}
									aria-live="polite"
								>
									{collapsed && (
										<LoaderCircle
											size={16}
											className="animate-spin"
											aria-hidden="true"
										/>
									)}
									<span className={collapsed ? "sr-only" : undefined}>
										Adding project files...
									</span>
								</output>
							)}
							{(error || library.error) && (
								<p
									role="alert"
									title={error || library.error || undefined}
									className={
										collapsed
											? "flex justify-center py-2 text-[#edc49a]"
											: "px-3 py-1 text-[11px] text-[#edc49a]"
									}
								>
									{collapsed && <AlertCircle size={16} aria-hidden="true" />}
									<span className={collapsed ? "sr-only" : undefined}>
										{error || library.error}
									</span>
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
										{filtered.slice(first, first + pageSize).map((file) => {
											const Icon =
												file.type === "Drawing" || file.type === "Symbol"
													? CircuitBoard
													: file.type === "Gerber"
														? Layers
														: file.type === "STEP"
															? Box
															: File;
											const content = (
												<>
													{!collapsed && (
														<span className="w-5 shrink-0" aria-hidden="true" />
													)}
													<Icon
														size={14}
														className="shrink-0 opacity-70"
														aria-hidden="true"
													/>
													{!collapsed && (
														<span className="truncate">{file.name}</span>
													)}
												</>
											);
											return (
												<tr key={file.path}>
													<td>
														{file.href ? (
															<ProjectLink
																href={file.href}
																aria-label={`Open ${file.name}`}
																title={`${file.name} · ${file.type}`}
																className={`flex h-8 min-w-0 items-center ${collapsed ? "justify-center" : "gap-2 pr-3 pl-2"} text-xs hover:bg-white/5 focus:bg-[#e8b77e1c] focus:text-[#e8b77e] ${focus}`}
																onClick={() => {
																	if (file.href === "/editor")
																		project.selectEditorFile(file.path);
																	if (file.asset)
																		project.selectAsset(file.asset);
																}}
															>
																{content}
															</ProjectLink>
														) : (
															<div
																title={`${file.name} · ${file.type}`}
																className={`flex h-8 items-center text-xs text-[#98a4b6] ${collapsed ? "justify-center" : "gap-2 pr-3 pl-2"}`}
															>
																{content}
															</div>
														)}
													</td>
												</tr>
											);
										})}
									</tbody>
								</table>
								{!filtered.length && !collapsed && (
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
							<footer
								className={`flex shrink-0 items-center justify-between gap-2 border-t border-white/10 text-[10px] text-[#98a4b6] ${collapsed ? "flex-col p-1" : "h-8 px-3"}`}
							>
								<span
									aria-live="polite"
									className={collapsed ? "sr-only" : undefined}
								>
									{filtered.length
										? `${first + 1}–${Math.min(first + pageSize, filtered.length)} of ${filtered.length} files`
										: "0 files"}
								</span>
								{lastPage > 0 && (
									<nav
										aria-label="Project file pages"
										className={`flex gap-1 ${collapsed ? "flex-col" : ""}`}
									>
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
								)}
							</footer>
						</>
					) : null}
				</div>
				<ProjectLink href="/editor" ref={editorLink} hidden tabIndex={-1}>
					Open new file
				</ProjectLink>
				<footer className="shrink-0 border-t border-white/10 p-1.5">
					<button
						type="button"
						aria-label={collapsed ? "Show project files" : "Hide project files"}
						title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
						aria-expanded={!collapsed}
						aria-controls={panelId}
						className={`${button} h-9 w-full ${collapsed ? "" : "justify-start px-2"}`}
						onClick={() => setCollapsed(!collapsed)}
					>
						{collapsed ? (
							<PanelLeftOpen size={18} aria-hidden="true" />
						) : (
							<>
								<PanelLeftClose size={18} aria-hidden="true" />
								<span>Collapse sidebar</span>
							</>
						)}
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
									const path = await (creatingFile === "drawing"
										? project.createDrawing(name)
										: project.createSymbol(name));
									project.selectEditorFile(path);
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
