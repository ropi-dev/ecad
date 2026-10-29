import { FolderOpen, Trash2, Upload } from "lucide-react";
import { useRef, useState } from "react";
import type { useSymbolLibrary } from "#/components/editor/useSymbolLibrary.ts";
import type {
	ConfiguredSymbolLibrary,
	LibraryScope,
} from "#/symbol-library/config.ts";
import exampleSymbolUrl from "#/symbol-library/examples/test-point.ecadsym?url";

const button =
	"flex w-full cursor-pointer items-center justify-center gap-2 rounded-md border border-white/20 px-3 py-2 text-xs hover:bg-white/10 focus-visible:outline-2 focus-visible:outline-[#e8b77e] disabled:opacity-50";
const inputClass =
	"mt-1 block w-full rounded border border-white/20 bg-[#191c22] p-2 text-[#e8edf5]";

export function SymbolLibraryControls({
	library,
	feedback = true,
}: {
	library: ReturnType<typeof useSymbolLibrary>;
	feedback?: boolean;
}) {
	const [scope, setScope] = useState<LibraryScope>(library.defaultScope);
	const [name, setName] = useState("");
	const input = useRef<HTMLInputElement>(null);
	const directoryInput = useRef<HTMLInputElement>(null);
	const {
		loading,
		userLibraries,
		projectLibraries,
		hasProject,
		upload,
		canOpenDirectory,
		openDirectory,
		refresh,
		message,
		error,
	} = library;
	return (
		<div className="space-y-3 text-[#e8edf5]">
			<LibraryList
				title="User libraries"
				scope="user"
				libraries={userLibraries}
				library={library}
			/>
			{hasProject && (
				<LibraryList
					title="Project libraries"
					scope="project"
					libraries={projectLibraries}
					library={library}
				/>
			)}
			<label className="block text-xs text-[#9ba7b8]">
				Add library to
				<select
					aria-label="Library scope"
					value={scope}
					disabled={loading}
					onChange={(event) =>
						setScope(event.currentTarget.value as LibraryScope)
					}
					className={inputClass}
				>
					<option value="user">User libraries</option>
					{hasProject && <option value="project">Project libraries</option>}
				</select>
			</label>
			<label className="block text-xs text-[#9ba7b8]">
				Library name
				<input
					aria-label="Library name"
					value={name}
					disabled={loading}
					maxLength={100}
					placeholder={
						scope === "project" ? "Project symbols" : "Imported symbols"
					}
					onChange={(event) => setName(event.currentTarget.value)}
					className={inputClass}
				/>
			</label>
			<input
				ref={input}
				type="file"
				multiple
				accept=".ecadsym,.json"
				aria-label="Upload symbol files"
				className="hidden"
				disabled={loading}
				onChange={(event) => {
					const files = Array.from(event.currentTarget.files ?? []);
					event.currentTarget.value = "";
					if (files.length) void upload(files, false, scope, name);
				}}
			/>
			<input
				ref={directoryInput}
				type="file"
				multiple
				{...{ webkitdirectory: "" }}
				aria-label="Upload symbol directory"
				className="hidden"
				disabled={loading}
				onChange={(event) => {
					const files = Array.from(event.currentTarget.files ?? []);
					event.currentTarget.value = "";
					if (files.length) void upload(files, true, scope, name);
				}}
			/>
			<button
				type="button"
				disabled={loading}
				onClick={() => input.current?.click()}
				className={button}
			>
				<Upload size={14} aria-hidden="true" />
				Upload symbols
			</button>
			<button
				type="button"
				disabled={loading}
				onClick={() => directoryInput.current?.click()}
				className={button}
			>
				Upload library directory
			</button>
			{canOpenDirectory && (
				<button
					type="button"
					disabled={loading}
					onClick={() => void openDirectory(scope, name)}
					className={button}
				>
					<FolderOpen size={14} aria-hidden="true" />
					Add library directory
				</button>
			)}
			<button
				type="button"
				disabled={loading}
				onClick={() => void refresh()}
				className={button}
			>
				Reload libraries
			</button>
			<p className="m-0 text-xs text-[#9ba7b8]">
				One symbol per .ecadsym or .json file.
			</p>
			<a
				href={exampleSymbolUrl}
				download="test-point.ecadsym"
				className="inline-block text-xs text-[#76c4c0] underline"
			>
				Download example
			</a>
			{feedback && message && (
				<output className="block text-xs text-[#76c4c0]">{message}</output>
			)}
			{feedback && error && (
				<p
					role="alert"
					className="max-h-32 overflow-auto whitespace-pre-wrap break-words text-xs text-[#ffb4ab]"
				>
					{error}
				</p>
			)}
		</div>
	);
}

function LibraryList({
	title,
	scope,
	libraries,
	library,
}: {
	title: string;
	scope: LibraryScope;
	libraries: readonly ConfiguredSymbolLibrary[];
	library: ReturnType<typeof useSymbolLibrary>;
}) {
	return (
		<fieldset aria-label={title} className="min-w-0 border-0 p-0">
			<legend className="mb-1 text-xs font-semibold">{title}</legend>
			{!libraries.length && (
				<p className="my-1 text-xs text-[#9ba7b8]">No libraries configured.</p>
			)}
			{libraries.map((entry) => (
				<div key={entry.id} className="flex items-center gap-2 py-1">
					<label className="flex min-w-0 flex-1 cursor-pointer items-center gap-2 text-xs">
						<input
							type="checkbox"
							checked={entry.enabled}
							disabled={library.loading}
							onChange={() => void library.toggle(entry.id, scope)}
						/>
						<span className="break-words">{entry.name}</span>
					</label>
					{entry.source.kind !== "builtin" &&
						!(scope === "project" && entry.id === "project-symbols") && (
							<button
								type="button"
								aria-label={`Remove ${entry.name}`}
								disabled={library.loading}
								onClick={() => void library.remove(entry.id, scope)}
								className="cursor-pointer rounded p-1 text-[#9ba7b8] hover:bg-white/10 hover:text-[#ffb4ab] disabled:opacity-50"
							>
								<Trash2 size={14} aria-hidden="true" />
							</button>
						)}
				</div>
			))}
		</fieldset>
	);
}
