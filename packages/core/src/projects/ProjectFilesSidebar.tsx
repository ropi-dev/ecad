import {
	Box,
	ChevronLeft,
	ChevronRight,
	CircuitBoard,
	File,
	Folder,
	FolderOpen,
	Layers,
	ListTree,
	PanelLeftClose,
	PlugZap,
	Plus,
	Search,
	X,
} from "lucide-react";
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

const CreateSymbolDialog = lazy(() =>
	import("#/components/editor/CreateSymbolDialog.tsx").then((module) => ({
		default: module.CreateSymbolDialog,
	})),
);
const focus =
	"focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-[#e8b77e]";
const button = `inline-flex h-7 items-center justify-center gap-1.5 rounded text-[11px] text-[#98a4b6] hover:bg-white/10 hover:text-white disabled:opacity-40 ${focus}`;
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
	const toggle = useRef<HTMLButtonElement>(null);
	const [query, setQuery] = useState("");
	const [filter, setFilter] = useState<(typeof filters)[number]>("All files");
	const [page, setPage] = useState(0);
	const [importing, setImporting] = useState(false);
	const [error, setError] = useState("");
	const [newSymbolOpen, setNewSymbolOpen] = useState(false);
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
			className="pointer-events-none absolute inset-y-0 left-0 z-10 m-0 w-74 min-w-0 max-w-full border-0 p-0"
			onPointerLeave={(event) => {
				if (event.pointerType === "touch") return;
				const active = document.activeElement;
				if (
					newSymbolOpen ||
					(active instanceof HTMLElement &&
						active.closest(`#${CSS.escape(panelId)}`) &&
						active.matches(
							"input:not([type=file]), textarea, select, [contenteditable=true], :focus-visible",
						))
				)
					return;
				setCollapsed(true);
			}}
			onBlur={(event) => {
				if (
					!event.currentTarget.contains(event.relatedTarget) &&
					!event.currentTarget.matches(":hover") &&
					!newSymbolOpen
				)
					setCollapsed(true);
			}}
		>
			{!collapsed && (
				<>
					<div
						aria-hidden="true"
						className="pointer-events-auto absolute inset-y-0 left-0 w-10 max-[600px]:w-9"
					/>
					<div
						aria-hidden="true"
						className="pointer-events-auto absolute top-26 bottom-24 left-0 w-full max-[600px]:top-34"
					/>
				</>
			)}
			<button
				ref={toggle}
				type="button"
				aria-label="Show project files"
				aria-expanded={!collapsed}
				aria-controls={panelId}
				title="Show project files"
				onClick={() => setCollapsed(false)}
				onPointerMove={(event) => {
					if (event.pointerType === "mouse" && collapsed) setCollapsed(false);
				}}
				className={`group pointer-events-auto absolute inset-y-0 left-0 grid w-3 place-items-center text-[#c7d0dc] focus-visible:bg-[#191c22f5] pointer-coarse:inset-y-auto pointer-coarse:top-9 pointer-coarse:left-2 pointer-coarse:h-10 pointer-coarse:w-10 pointer-coarse:rounded-lg pointer-coarse:border pointer-coarse:border-[#414955] pointer-coarse:bg-[#191c22f5] ${focus}`}
			>
				<ListTree
					size={17}
					aria-hidden="true"
					className="opacity-0 group-focus-visible:opacity-100 pointer-coarse:opacity-100"
				/>
			</button>
			<aside
				id={panelId}
				aria-label="Project files"
				aria-hidden={collapsed}
				inert={collapsed}
				data-open={!collapsed}
				className={`${collapsed ? "invisible -translate-x-[calc(100%+2.5rem)] opacity-0" : "pointer-events-auto visible translate-x-0 opacity-100"} absolute top-26 bottom-24 left-10 z-10 flex w-64 max-w-[calc(100vw-5rem)] flex-col overflow-hidden rounded-xl border border-[#414955] bg-[#191c22f5] text-[#c7d0dc] shadow-[0_8px_32px_#0003] transition-[translate,opacity,visibility] duration-200 ease-out motion-reduce:transition-none max-[600px]:top-34 max-[600px]:left-9`}
			>
				<header className="flex h-12 shrink-0 items-center gap-2 border-b border-white/10 px-3">
					<ListTree
						size={17}
						aria-hidden="true"
						className="shrink-0 text-[#98a4b6]"
					/>
					<h2 className="m-0 text-[13px] font-semibold">Files</h2>
					<span className="text-[11px] text-[#98a4b6]">{files.length}</span>
					{snapshot && (
						<button
							type="button"
							aria-label="New symbol"
							title="New symbol"
							disabled={busy}
							className={`${button} ml-auto w-7`}
							onClick={() => setNewSymbolOpen(true)}
						>
							<Plus size={16} aria-hidden="true" />
						</button>
					)}
					<button
						type="button"
						aria-label="Hide project files"
						title="Hide project files"
						aria-expanded={true}
						aria-controls={panelId}
						className={`${button} ${snapshot ? "" : "ml-auto"} w-7 shrink-0`}
						onClick={() => {
							setCollapsed(true);
							requestAnimationFrame(() => toggle.current?.focus());
						}}
					>
						<PanelLeftClose size={16} aria-hidden="true" />
					</button>
				</header>
				<nav
					aria-label="Workspaces"
					className="grid shrink-0 grid-cols-4 gap-2 border-b border-white/10 p-3"
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
								<div className="flex h-9 items-center gap-0.5 px-2">
									<ProjectLink
										href="/projects"
										aria-label="Project settings"
										title={snapshot.manifest.name}
										className={`flex min-w-0 flex-1 items-center gap-2 rounded py-1 text-xs hover:text-white ${focus}`}
									>
										<FolderOpen
											size={14}
											className="shrink-0 text-[#98a4b6]"
											aria-hidden="true"
										/>
										<span className="truncate">{snapshot.manifest.name}</span>
									</ProjectLink>
									{(
										[
											["gerber", "Gerber", Layers],
											["step", "STEP", Box],
											["symbol", "Symbols", CircuitBoard],
										] as const
									).map(([kind, label, Icon]) => (
										<label
											key={kind}
											title={`Add ${kind === "symbol" ? "symbol" : label} files`}
											className={`${button} relative w-6 shrink-0 cursor-pointer px-0 focus-within:outline-2 focus-within:outline-[#e8b77e] has-[:disabled]:opacity-40`}
										>
											<Icon className="size-3.5 shrink-0" aria-hidden="true" />
											<input
												type="file"
												multiple
												aria-label={`Add ${kind === "symbol" ? "symbol" : label} files`}
												accept={
													kind === "step"
														? ".step,.stp"
														: kind === "symbol"
															? ".ecadsym,.json"
															: undefined
												}
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
									Adding project files...
								</output>
							)}
							{(error || library.error) && (
								<p
									role="alert"
									className="px-3 py-1 text-[11px] text-[#edc49a]"
								>
									{error || library.error}
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
												<tr key={file.path}>
													<td>
														{file.href ? (
															<ProjectLink
																href={file.href}
																aria-label={`Open ${file.name}`}
																title={file.path}
																className={`flex h-8 min-w-0 items-center gap-2 pr-3 pl-2 text-xs hover:bg-white/5 focus:bg-[#e8b77e1c] focus:text-[#e8b77e] ${focus}`}
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
																title={file.path}
																className="flex h-8 items-center gap-2 pr-3 pl-2 text-xs text-[#98a4b6]"
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
							<footer className="flex h-8 shrink-0 items-center justify-between gap-2 border-t border-white/10 px-3 text-[10px] text-[#98a4b6]">
								<span aria-live="polite">
									{filtered.length
										? `${first + 1}–${Math.min(first + pageSize, filtered.length)} of ${filtered.length} files`
										: "0 files"}
								</span>
								{lastPage > 0 && (
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
								)}
							</footer>
						</>
					) : null}
				</div>
				<ProjectLink href="/editor" ref={editorLink} hidden tabIndex={-1}>
					Open new symbol
				</ProjectLink>
			</aside>
			{newSymbolOpen && (
				<div className="pointer-events-auto">
					<Suspense fallback={null}>
						<CreateSymbolDialog
							description="Create an empty symbol file in this project and open it for editing."
							onClose={() => setNewSymbolOpen(false)}
							onCreate={async (name) => {
								try {
									const path = await project.createSymbol(name);
									project.selectEditorFile(path);
									setNewSymbolOpen(false);
									editorLink.current?.click();
								} catch (cause) {
									return cause instanceof Error
										? cause.message
										: "Unable to create the symbol.";
								}
							}}
						/>
					</Suspense>
				</div>
			)}
		</fieldset>
	);
}
