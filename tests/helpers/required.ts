export function required<T>(value: T | null | undefined): T {
	if (value === null || value === undefined)
		throw new Error("Expected a value");
	return value;
}
