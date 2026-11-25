import * as vscode from "vscode";

interface GitRepo { rootUri: vscode.Uri; state: { HEAD?: { name?: string } } }
interface GitApi { repositories: GitRepo[] }

function gitApi(): GitApi | undefined {
  try {
    const ext = vscode.extensions.getExtension<{ getAPI(v: 1): GitApi }>("vscode.git");
    return ext?.isActive ? ext.exports.getAPI(1) : undefined;
  } catch { return undefined; }
}

/** Workspace folder of the active editor (or the first folder). */
export function currentFolder(): vscode.WorkspaceFolder | undefined {
  const uri = vscode.window.activeTextEditor?.document.uri;
  return (uri && vscode.workspace.getWorkspaceFolder(uri)) || vscode.workspace.workspaceFolders?.[0];
}

/** Project (workspace folder name) and current git branch, best effort. */
export function currentContext(): { project: string; branch: string } {
  const folder = currentFolder();
  const project = folder?.name ?? "";
  let branch = "";
  const api = gitApi();
  if (api && folder) {
    const repo = api.repositories
      .filter((r) => folder.uri.fsPath.startsWith(r.rootUri.fsPath) || r.rootUri.fsPath.startsWith(folder.uri.fsPath))
      .sort((a, b) => b.rootUri.fsPath.length - a.rootUri.fsPath.length)[0];
    branch = repo?.state.HEAD?.name ?? "";
  }
  return { project, branch };
}

export function workspaceDirs(): string[] {
  return (vscode.workspace.workspaceFolders ?? []).filter((f) => f.uri.scheme === "file").map((f) => f.uri.fsPath);
}
