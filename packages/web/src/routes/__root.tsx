import appCss from "@ecad/core/styles.css?url";
import { SymbolLibraryProvider } from "@ecad/core/symbol-library/storage.tsx";
import type { QueryClient } from "@tanstack/react-query";
import {
	createRootRouteWithContext,
	HeadContent,
	Scripts,
} from "@tanstack/react-router";
import type { TRPCOptionsProxy } from "@trpc/tanstack-react-query";
import type { TRPCRouter } from "#/integrations/trpc/router.ts";
import { createWebSymbolLibraryStorage } from "#/symbol-library/storage.ts";

const symbolLibraryStorage = createWebSymbolLibraryStorage();

interface MyRouterContext {
	queryClient: QueryClient;
	trpc: TRPCOptionsProxy<TRPCRouter>;
}

export const Route = createRootRouteWithContext<MyRouterContext>()({
	head: () => ({
		meta: [
			{ charSet: "utf-8" },
			{ name: "viewport", content: "width=device-width, initial-scale=1" },
			{ title: "Gerber viewer" },
			{
				name: "description",
				content: "Display a Gerber file with WebGPU rendering.",
			},
		],
		links: [{ rel: "stylesheet", href: appCss }],
	}),
	shellComponent: RootDocument,
});

function RootDocument({ children }: { children: React.ReactNode }) {
	return (
		<html lang="en" className="dark">
			<head>
				<HeadContent />
			</head>
			<body>
				<SymbolLibraryProvider storage={symbolLibraryStorage}>
					{children}
				</SymbolLibraryProvider>
				<Scripts />
			</body>
		</html>
	);
}
