import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { Effect } from "effect";
import { runEffect } from "@ecad/core/lib/effect.ts";

export const Route = createFileRoute("/demo/tanstack-query")({
	component: TanStackQueryDemo,
});

function TanStackQueryDemo() {
	const { data } = useQuery({
		queryKey: ["todos"],
		queryFn: ({ signal }) =>
			runEffect(
				Effect.succeed([
					{ id: 1, name: "Alice" },
					{ id: 2, name: "Bob" },
					{ id: 3, name: "Charlie" },
				]),
				signal,
			),
		initialData: [],
	});

	return (
		<main className="demo-page demo-center">
			<section className="demo-panel w-full max-w-2xl">
				<p className="island-kicker mb-2">TanStack Query</p>
				<h1 className="demo-title mb-6">TanStack Query</h1>
				<ul className="mb-4 space-y-2">
					{data.map((todo) => (
						<li key={todo.id} className="demo-list-item">
							<span className="text-base font-medium">{todo.name}</span>
						</li>
					))}
				</ul>
			</section>
		</main>
	);
}
