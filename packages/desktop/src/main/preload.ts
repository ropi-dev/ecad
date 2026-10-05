import { contextBridge, ipcRenderer } from "electron";
import { type DesktopSymbolLibraryBridge, libraryChannels } from "#/bridge.ts";

const bridge: DesktopSymbolLibraryBridge = {
	load: () => ipcRenderer.invoke(libraryChannels.load),
	save: (symbols, additions) =>
		ipcRenderer.invoke(libraryChannels.save, symbols, additions),
	openDirectory: () => ipcRenderer.invoke(libraryChannels.openDirectory),
};

contextBridge.exposeInMainWorld("ecadSymbolLibrary", bridge);
