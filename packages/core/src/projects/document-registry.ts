export function createDocumentRegistry<
	Documents extends { [Kind in keyof Documents]: { unsubscribe(): void } },
>() {
	const entries = new Map<
		keyof Documents,
		Map<string, Documents[keyof Documents]>
	>();
	const collection = <Kind extends keyof Documents>(kind: Kind) => {
		let documents = entries.get(kind);
		if (!documents) {
			documents = new Map();
			entries.set(kind, documents);
		}
		return documents as Map<string, Documents[Kind]>;
	};
	return {
		collection,
		openDocument<Kind extends keyof Documents>(
			kind: Kind,
			id: string,
			create: () => Documents[Kind],
		): Documents[Kind] {
			const documents = collection(kind);
			const existing = documents.get(id);
			if (existing) return existing;
			const document = create();
			documents.set(id, document);
			return document;
		},
		clear() {
			for (const documents of entries.values()) {
				for (const document of documents.values()) document.unsubscribe();
				documents.clear();
			}
		},
	};
}
