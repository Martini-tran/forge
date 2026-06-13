import type { AppEntry, CustomApp } from "../shared/AppEntry";
import type { SettingsSnapshot } from "../shared/Settings";
import type { PluginInfo } from "../shared/PluginInfo";
import type { PluginConfigValues } from "../shared/PluginConfig";
import type { SearchResult } from "../shared/SearchResult";

type NewCustomApp = Omit<CustomApp, "id" | "createdAt">;

declare global {
  interface Window {
    /** API exposed by the preload script (see src/preload/index.ts). */
    launcher: {
      // apps
      listApps(): Promise<AppEntry[]>;
      listRecents(): Promise<AppEntry[]>;
      launchApp(id: string): Promise<void>;
      hide(): Promise<void>;
      openExternal(url: string): Promise<void>;
      resize(height: number): void;
      onAppsUpdated(cb: (apps: AppEntry[]) => void): () => void;
      onShown(cb: () => void): () => void;

      // settings
      openSettings(): Promise<void>;
      getSettings(): Promise<SettingsSnapshot>;
      setSetting(key: string, value: string): Promise<void>;
      setHotkey(accel: string): Promise<boolean>;
      setOpenAtLogin(enabled: boolean): Promise<void>;
      onSettingsChanged(cb: (s: SettingsSnapshot) => void): () => void;

      // quick open
      pickPath(): Promise<string>;
      listCustom(): Promise<CustomApp[]>;
      addCustom(entry: NewCustomApp): Promise<CustomApp>;
      updateCustom(entry: CustomApp): Promise<void>;
      deleteCustom(id: string): Promise<void>;
      listScanned(): Promise<AppEntry[]>;
      setAlias(appId: string, keywords: string): Promise<void>;
      hideScanned(appId: string, hidden: boolean): Promise<void>;
      syncQuickOpen(): Promise<{ removedCustom: number }>;

      // plugins
      listPlugins(): Promise<PluginInfo[]>;
      usePlugin(id: string): Promise<void>;
      detachPlugin(id: string): Promise<void>;
      getPluginWindowState(): Promise<{ alwaysOnTop: boolean }>;
      setPluginWindowAlwaysOnTop(on: boolean): Promise<void>;
      setPluginKeywords(id: string, keywords: string): Promise<void>;
      setPluginEnabled(id: string, enabled: boolean): Promise<void>;
      setPluginOpenInWindow(id: string, on: boolean): Promise<void>;
      setPluginConfig(
        id: string,
        values: PluginConfigValues,
      ): Promise<PluginConfigValues>;
      searchPlugins(query: string): Promise<SearchResult[]>;
      executePlugin(pluginId: string, action: string): Promise<void>;
      setMode(mode: "root" | "plugin"): void;
      onPluginExit(cb: () => void): () => void;
    };
  }
}

// The <webview> tag isn't in React's JSX types; declare the attributes we use.
declare module "react" {
  namespace JSX {
    interface IntrinsicElements {
      webview: React.DetailedHTMLProps<
        React.HTMLAttributes<HTMLElement>,
        HTMLElement
      > & {
        src?: string;
        partition?: string;
        allowpopups?: string;
        webpreferences?: string;
        nodeintegration?: string;
      };
    }
  }
}

export {};
