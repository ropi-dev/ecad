/** Keeps returned scene resources alive through React's asynchronous commit. */
export class ImportOwnership {
	private readonly owned = new Set<() => void>();
	private pending = new Set<() => void>();

	stage(disposers: readonly (() => void)[]) {
		this.pending = new Set(disposers);
		for (const dispose of disposers) this.owned.add(dispose);
	}

	commit(disposers: readonly (() => void)[]) {
		const displayed = new Set(disposers);
		for (const dispose of this.owned) {
			if (displayed.has(dispose) || this.pending.has(dispose)) continue;
			this.owned.delete(dispose);
			dispose();
		}
	}

	dispose() {
		for (const dispose of this.owned) dispose();
		this.owned.clear();
		this.pending.clear();
	}
}
