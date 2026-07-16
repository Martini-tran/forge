import { app, BrowserWindow } from "electron";
import started from "electron-squirrel-startup";
import { createMainWindow, showMainWindow } from "./windows/mainWindow";
import {
  registerGlobalShortcuts,
  unregisterGlobalShortcuts,
} from "./shortcuts/globalShortcut";
import { registerIpcHandlers } from "./ipc";
import { createTray, destroyTray } from "./tray";
import { initDatabase } from "../core/database";
import { loadPlugins } from "./plugins/runtime";
import { seedBundledPlugins } from "./plugins/install";
import { refreshDevWatchers } from "./plugins/dev";
import {
  registerPluginSchemes,
  registerPluginProtocol,
} from "./plugins/protocol";

// Privileged scheme registration MUST run before `app.ready`.
registerPluginSchemes();

// Handle creating/removing shortcuts on Windows when installing/uninstalling.
if (started) {
  app.quit();
}

// The launcher stays resident (it hides instead of quitting), so a second
// run would spawn a rival process that fights over the same disk/GPU cache
// directory — the source of the "Unable to move the cache: access denied"
// errors. Enforce a single instance and just summon the existing window.
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", () => showMainWindow());
}

// The GPU shader disk cache frequently fails to initialise on Windows
// (antivirus/locked dir), spamming "Gpu Cache Creation failed". We don't need
// it for a tiny launcher UI — disable it to keep the console clean.
app.commandLine.appendSwitch("disable-gpu-shader-disk-cache");

// This method will be called when Electron has finished
// initialization and is ready to create browser windows.
// Some APIs can only be used after this event occurs.
app.on("ready", () => {
  initDatabase();
  registerPluginProtocol();
  registerIpcHandlers();
  // Create the window first so the global shortcut has something to toggle.
  createMainWindow();
  // Tray gives the background-resident launcher a visible home + a way to quit.
  createTray();
  registerGlobalShortcuts();
  // Seed built-in plugins into the user dir (first run / version upgrade), then
  // load them. Done in the background; searches before this resolves return [].
  void seedBundledPlugins()
    .catch((err) => console.error("[plugins] 种子化失败:", err))
    .finally(() => {
      // Watch developer-mode source dirs (repo plugins/ in a dev run + any the
      // user added) so edits hot-reload. No-op when developer mode is off.
      refreshDevWatchers();
      void loadPlugins();
    });
});

// Release global shortcuts and remove the tray icon before exiting.
app.on("will-quit", () => {
  unregisterGlobalShortcuts();
  destroyTray();
});

// Quit when all windows are closed, except on macOS. There, it's common
// for applications and their menu bar to stay active until the user quits
// explicitly with Cmd + Q.
app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("activate", () => {
  // On OS X it's common to re-create a window in the app when the
  // dock icon is clicked and there are no other windows open.
  if (BrowserWindow.getAllWindows().length === 0) {
    createMainWindow();
  }
});

// In this file you can include the rest of your app's specific main process
// code. You can also put them in separate files and import them here.
