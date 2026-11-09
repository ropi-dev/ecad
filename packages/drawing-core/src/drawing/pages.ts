import { z } from "zod";
import type { EditorShape } from "#/drawing/schema.ts";

/**
 * A schematic page. Shapes name their page by ID, and a shape without a page
 * is on the first page, so a drawing saved before pages existed is one page.
 */
export interface DrawingPage {
	readonly id: number;
	readonly name: string;
}

export const PAGE_NAME_LIMIT = 100;

export const pageId = z.number().int().positive().safe();

export const pageNameSchema = z
	.string()
	.trim()
	.min(1, { error: "Enter a page name." })
	.max(PAGE_NAME_LIMIT, {
		error: `Page names can have at most ${PAGE_NAME_LIMIT} characters.`,
	});

export const drawingPageSchema = z.strictObject({
	id: pageId.describe("Page ID. Shapes on this page store it as `page`."),
	name: pageNameSchema.describe("Page name shown in the editor."),
});

export const drawingPagesSchema = z
	.array(drawingPageSchema)
	.min(1, { error: "A drawing needs at least one page." })
	.superRefine((pages, context) => {
		const ids = new Set<number>();
		for (const [index, page] of pages.entries()) {
			if (ids.has(page.id))
				context.addIssue({
					code: "custom",
					message: `Duplicate page ID ${page.id}.`,
					path: [index, "id"],
				});
			ids.add(page.id);
		}
	})
	.describe(
		"Schematic pages in display order. Shapes without `page` are on the first page.",
	);

export const DEFAULT_PAGE_ID = 1;
export const DEFAULT_PAGES: readonly DrawingPage[] = Object.freeze([
	Object.freeze({ id: DEFAULT_PAGE_ID, name: "Page 1" }),
]);

/** The pages of a drawing; an absent list is the single default page. */
export function drawingPages(
	pages: readonly DrawingPage[] | undefined,
): readonly DrawingPage[] {
	return pages?.length ? pages : DEFAULT_PAGES;
}

/** A saved drawing omits the page list when it is the single default page. */
export function savedPages(
	pages: readonly DrawingPage[] | undefined,
): readonly DrawingPage[] | undefined {
	if (!pages?.length) return undefined;
	return pages.length === 1 &&
		pages[0].id === DEFAULT_PAGE_ID &&
		pages[0].name === DEFAULT_PAGES[0].name
		? undefined
		: pages;
}

/**
 * The key of the page a shape is on, comparable between shapes of one
 * drawing: shapes on the first page omit `page`, so their key is 0.
 */
export function pageKey(shape: Pick<EditorShape, "page">): number {
	return shape.page ?? 0;
}

/** The ID of the page a shape is on. */
export function shapePageId(
	shape: Pick<EditorShape, "page">,
	pages: readonly DrawingPage[] | undefined,
): number {
	return shape.page ?? drawingPages(pages)[0].id;
}

/** The `page` field a shape on `page` stores: none on the first page. */
export function pageField(
	page: number,
	pages: readonly DrawingPage[] | undefined,
): { page?: number } {
	return page === drawingPages(pages)[0].id ? {} : { page };
}

/** The shape moved to `page`, or the shape itself when it is already there. */
export function withPage<T extends EditorShape>(
	shape: T,
	page: number,
	pages: readonly DrawingPage[] | undefined,
): T {
	const field = pageField(page, pages);
	if (shape.page === field.page) return shape;
	if (field.page === undefined) {
		const { page: _page, ...rest } = shape;
		return rest as T;
	}
	return { ...shape, page: field.page };
}

/** The listed page `requested` names, or the first page when it is not listed. */
export function resolvePage(
	pages: readonly DrawingPage[] | undefined,
	requested: number | null,
): number {
	const list = drawingPages(pages);
	return list.some((page) => page.id === requested)
		? (requested as number)
		: list[0].id;
}

/** Whether every shape's `page` names a page of the drawing. */
export function pagesReferenced(
	shapes: readonly Pick<EditorShape, "page">[],
	pages: readonly DrawingPage[] | undefined,
): boolean {
	const ids = new Set(drawingPages(pages).map((page) => page.id));
	return shapes.every(
		(shape) => shape.page === undefined || ids.has(shape.page),
	);
}

/**
 * Loaded shapes in canonical form: a shape that names the first page omits
 * `page`, as commits store it. The same array when nothing changes.
 */
export function canonicalShapePages<T extends EditorShape>(
	shapes: T[],
	pages: readonly DrawingPage[] | undefined,
): T[] {
	const first = drawingPages(pages)[0].id;
	if (!shapes.some((shape) => shape.page === first)) return shapes;
	return shapes.map((shape) =>
		shape.page === first ? withPage(shape, first, pages) : shape,
	);
}

/** The shapes on `page`; the same array when every shape is on it. */
export function shapesOnPage<T extends EditorShape>(
	shapes: T[],
	page: number,
	pages: readonly DrawingPage[] | undefined,
): T[] {
	const key = pageField(page, pages).page ?? 0;
	const onPage = shapes.filter((shape) => pageKey(shape) === key);
	return onPage.length === shapes.length ? shapes : onPage;
}

/** The ID for a new page: one more than the highest ID in use. */
export function nextPageId(pages: readonly DrawingPage[] | undefined): number {
	return Math.max(0, ...drawingPages(pages).map((page) => page.id)) + 1;
}

/** "Page N", counting up from the page count to a name no page uses. */
export function nextPageName(
	pages: readonly DrawingPage[] | undefined,
): string {
	const names = new Set(drawingPages(pages).map((page) => page.name));
	let number = drawingPages(pages).length + 1;
	while (names.has(`Page ${number}`)) number++;
	return `Page ${number}`;
}
