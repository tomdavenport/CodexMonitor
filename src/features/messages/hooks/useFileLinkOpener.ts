import { useCallback } from "react";
import type { MouseEvent } from "react";
import { Menu, MenuItem, PredefinedMenuItem } from "@tauri-apps/api/menu";
import { LogicalPosition } from "@tauri-apps/api/dpi";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { revealItemInDir } from "@tauri-apps/plugin-opener";
import { openWorkspaceIn } from "../../../services/tauri";
import { getRevealLabel } from "../../../utils/platform";
import { getStoredOpenAppId } from "../../app/utils/openApp";
import type { OpenAppId } from "../../app/constants";

type OpenTarget = {
  id: OpenAppId;
  appName?: string;
};

const OPEN_TARGETS: Record<OpenTarget["id"], OpenTarget> = {
  vscode: { id: "vscode", appName: "Visual Studio Code" },
  cursor: { id: "cursor", appName: "Cursor" },
  zed: { id: "zed", appName: "Zed" },
  ghostty: { id: "ghostty", appName: "Ghostty" },
  antigravity: { id: "antigravity", appName: "Antigravity" },
  finder: { id: "finder" },
};

function resolveFilePath(path: string, workspacePath?: string | null) {
  const trimmed = path.trim();
  if (!workspacePath) {
    return trimmed;
  }
  if (trimmed.startsWith("/") || trimmed.startsWith("~/")) {
    return trimmed;
  }
  const base = workspacePath.replace(/\/+$/, "");
  return `${base}/${trimmed}`;
}

function stripLineSuffix(path: string) {
  const match = path.match(/^(.*?)(?::\d+(?::\d+)?)?$/);
  return match ? match[1] : path;
}

export function useFileLinkOpener(workspacePath?: string | null) {
  const openFileLink = useCallback(
    async (rawPath: string) => {
      const openAppId = getStoredOpenAppId();
      const target = OPEN_TARGETS[openAppId] ?? OPEN_TARGETS.vscode;
      const resolvedPath = resolveFilePath(stripLineSuffix(rawPath), workspacePath);

      if (target.id === "finder") {
        await revealItemInDir(resolvedPath);
        return;
      }

      if (target.appName) {
        await openWorkspaceIn(resolvedPath, target.appName);
      }
    },
    [workspacePath],
  );

  const showFileLinkMenu = useCallback(
    async (event: MouseEvent, rawPath: string) => {
      event.preventDefault();
      event.stopPropagation();
      const openAppId = getStoredOpenAppId();
      const target = OPEN_TARGETS[openAppId] ?? OPEN_TARGETS.vscode;
      const resolvedPath = resolveFilePath(stripLineSuffix(rawPath), workspacePath);
      const openLabel =
        target.id === "finder"
          ? getRevealLabel()
          : target.appName
            ? `Open in ${target.appName}`
            : "Open Link";
      const items = [
        await MenuItem.new({
          text: openLabel,
          action: async () => {
            await openFileLink(rawPath);
          },
        }),
        ...(target.id === "finder"
          ? []
          : [
              await MenuItem.new({
                text: getRevealLabel(),
                action: async () => {
                  await revealItemInDir(resolvedPath);
                },
              }),
            ]),
        await MenuItem.new({
          text: "Download Linked File",
          enabled: false,
        }),
        await MenuItem.new({
          text: "Copy Link",
          action: async () => {
            const link =
              resolvedPath.startsWith("/") ? `file://${resolvedPath}` : resolvedPath;
            try {
              await navigator.clipboard.writeText(link);
            } catch {
              // Clipboard failures are non-fatal here.
            }
          },
        }),
        await PredefinedMenuItem.new({ item: "Separator" }),
        await PredefinedMenuItem.new({ item: "Services" }),
      ];

      const menu = await Menu.new({ items });
      const window = getCurrentWindow();
      const position = new LogicalPosition(event.clientX, event.clientY);
      await menu.popup(position, window);
    },
    [openFileLink, workspacePath],
  );

  return { openFileLink, showFileLinkMenu };
}
