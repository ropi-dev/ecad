import type { Bounds } from "#/engine/types.ts";

interface Node extends Bounds {
	index?: number;
	left?: Node;
	right?: Node;
}

function buildTree(nodes: Node[]): Node | undefined {
	if (nodes.length < 2) return nodes[0];
	const bounds = {
		minX: Infinity,
		minY: Infinity,
		maxX: -Infinity,
		maxY: -Infinity,
	};
	for (const node of nodes) {
		bounds.minX = Math.min(bounds.minX, node.minX);
		bounds.minY = Math.min(bounds.minY, node.minY);
		bounds.maxX = Math.max(bounds.maxX, node.maxX);
		bounds.maxY = Math.max(bounds.maxY, node.maxY);
	}
	const horizontal = bounds.maxX - bounds.minX >= bounds.maxY - bounds.minY;
	nodes.sort((a, b) =>
		horizontal
			? a.minX + a.maxX - b.minX - b.maxX
			: a.minY + a.maxY - b.minY - b.maxY,
	);
	const middle = Math.floor(nodes.length / 2);
	return {
		...bounds,
		left: buildTree(nodes.slice(0, middle)),
		right: buildTree(nodes.slice(middle)),
	};
}

/** Remove matches so each box is discovered only once, even in dense groups. */
function takeOverlaps(
	node: Node | undefined,
	bounds: Bounds,
	indices: number[],
): Node | undefined {
	if (
		!node ||
		node.maxX < bounds.minX ||
		node.minX > bounds.maxX ||
		node.maxY < bounds.minY ||
		node.minY > bounds.maxY
	)
		return node;
	if (node.index !== undefined) {
		indices.push(node.index);
		return undefined;
	}
	node.left = takeOverlaps(node.left, bounds, indices);
	node.right = takeOverlaps(node.right, bounds, indices);
	if (!node.left) return node.right;
	if (!node.right) return node.left;
	return node;
}

/** Connected groups of touching bounds, with original order inside each group. */
export function partitionOverlaps(bounds: readonly Bounds[]): number[][] {
	let tree = buildTree(bounds.map((box, index) => ({ ...box, index })));
	const visited = new Uint8Array(bounds.length);
	const groups: number[][] = [];
	for (let index = 0; index < bounds.length; index++) {
		if (visited[index]) continue;
		const group: number[] = [];
		tree = takeOverlaps(tree, bounds[index], group);
		for (let cursor = 0; cursor < group.length; cursor++) {
			const member = group[cursor];
			visited[member] = 1;
			tree = takeOverlaps(tree, bounds[member], group);
		}
		groups.push(group.sort((a, b) => a - b));
	}
	return groups;
}
