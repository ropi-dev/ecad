export type SExpr = (string | SExpr)[];

export function parseSExpr(source: string): SExpr {
	const stack: SExpr[] = [];
	let root: SExpr | undefined;
	const tokens = /\s+|\(|\)|"(?:\\.|[^"\\])*"|[^\s()"]+/gy;
	let offset = 0;
	while (offset < source.length) {
		tokens.lastIndex = offset;
		const match = tokens.exec(source);
		if (!match) throw new Error(`Invalid KiCad syntax at offset ${offset}.`);
		const token = match[0];
		offset = tokens.lastIndex;
		if (/^\s/.test(token)) continue;
		if (token === "(") {
			if (stack.length > 256) throw new Error("KiCad nesting limit exceeded.");
			const next: SExpr = [];
			if (stack.length) stack.at(-1)?.push(next);
			else if (root) throw new Error("Expected one KiCad document.");
			else root = next;
			stack.push(next);
		} else if (token === ")") {
			if (!stack.pop()) throw new Error("Unexpected closing parenthesis.");
		} else {
			if (!stack.length) throw new Error("Expected a KiCad expression.");
			stack
				.at(-1)
				?.push(
					token.startsWith('"')
						? token
								.slice(1, -1)
								.replace(
									/\\([\\"nrt])/g,
									(_, c: string) => ({ n: "\n", r: "\r", t: "\t" })[c] ?? c,
								)
						: token,
				);
		}
	}
	if (!root || stack.length) throw new Error("Incomplete KiCad document.");
	return root;
}
export const nodes = (n: SExpr, key: string): SExpr[] =>
	n.filter((v): v is SExpr => Array.isArray(v) && v[0] === key);
export const node = (n: SExpr, key: string): SExpr => nodes(n, key)[0] ?? [key];
export const value = (n: SExpr, key: string, fallback = ""): string =>
	String(node(n, key)[1] ?? fallback);
export function numbers(n: SExpr, key: string): number[] {
	const result = node(n, key).slice(1).map(Number);
	if (result.some((v) => !Number.isFinite(v)))
		throw new Error(`Invalid ${key} coordinates.`);
	return result;
}
