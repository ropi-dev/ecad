import type { StepModel } from "../../formats/step/types/StepModel";

export function StepParts({
	model,
	hidden,
	onToggle,
	onClear,
}: {
	model: StepModel;
	hidden: Set<number>;
	onToggle: (index: number) => void;
	onClear: () => void;
}) {
	return (
		<aside
			aria-label="Model parts"
			className="absolute right-4 top-20 z-10 flex max-h-[40%] w-60 flex-col rounded-lg border border-white/20 bg-slate-900/95 p-3 text-sm shadow-lg sm:top-4 sm:max-h-[calc(100%-7rem)] sm:w-72"
		>
			<div className="flex min-w-0 items-center justify-between gap-2">
				<h2 className="truncate font-medium" title={model.name}>
					{model.name}
				</h2>
				<button
					type="button"
					className="h-10 shrink-0 rounded border border-white/20 px-2 text-xs text-white/80 hover:bg-white/10 focus-visible:outline-2 focus-visible:outline-white"
					onClick={onClear}
				>
					Close
				</button>
			</div>
			<p className="mb-2 text-xs text-slate-400">
				{model.meshes.length} {model.meshes.length === 1 ? "part" : "parts"} ·{" "}
				{model.meshes
					.reduce((count, mesh) => count + mesh.index.array.length / 3, 0)
					.toLocaleString()}{" "}
				triangles · mm
			</p>
			<ul className="min-h-0 overflow-y-auto">
				{model.meshes.map((part, index) => (
					<li key={part.id}>
						<label className="flex min-h-11 cursor-pointer items-center gap-3 rounded px-2 hover:bg-white/10">
							<input
								type="checkbox"
								checked={!hidden.has(index)}
								onChange={() => onToggle(index)}
								className="size-4 shrink-0 accent-amber-200 focus-visible:outline-2 focus-visible:outline-white"
							/>
							<span
								className="truncate"
								title={part.name || `Part ${index + 1}`}
							>
								{part.name || `Part ${index + 1}`}
							</span>
						</label>
					</li>
				))}
			</ul>
		</aside>
	);
}
