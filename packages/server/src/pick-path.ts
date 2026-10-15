import { execFile } from "node:child_process";

export type PickKind = "folder" | "file";

/** Opens the system's own chooser and returns the path, or null when the person cancels. */
export type PickPath = (
  kind: PickKind,
  extensions: string[],
) => Promise<string | null>;

/** How a chooser program is run: its output, or `cancelled` when it exits with 1 (the person closed it). */
export type RunPicker = (
  command: string,
  args: string[],
) => Promise<{ kind: "ok"; stdout: string } | { kind: "cancelled" }>;

/** Windows: `*.py;*.ts` style filter; only plain extensions get in, so the text is never code. */
function winFilter(extensions: string[]): string {
  const globs = extensions
    .filter((e) => /^\.[a-z0-9]+$/i.test(e))
    .map((e) => `*${e}`)
    .join(";");
  return `Código|${globs}|Todos os arquivos|*.*`;
}

function windows(kind: PickKind, extensions: string[]): [string, string[]] {
  const dialog =
    kind === "folder"
      ? "$d = New-Object System.Windows.Forms.FolderBrowserDialog"
      : `$d = New-Object System.Windows.Forms.OpenFileDialog; $d.Filter = '${winFilter(extensions)}'`;
  const result = kind === "folder" ? "$d.SelectedPath" : "$d.FileName";
  // A hidden top-most owner keeps the dialog in front of the browser or editor.
  const script = [
    "[Console]::OutputEncoding = [Text.Encoding]::UTF8",
    "Add-Type -AssemblyName System.Windows.Forms",
    "$f = New-Object System.Windows.Forms.Form; $f.TopMost = $true",
    dialog,
    `if ($d.ShowDialog($f) -eq 'OK') { ${result} } else { exit 1 }`,
  ].join("; ");
  return ["powershell.exe", ["-NoProfile", "-STA", "-Command", script]];
}

function mac(kind: PickKind): [string, string[]] {
  const what = kind === "folder" ? "folder" : "file";
  return ["osascript", ["-e", `POSIX path of (choose ${what})`]];
}

function linux(kind: PickKind): [string, string[]] {
  const args = ["--file-selection"];
  if (kind === "folder") args.push("--directory");
  return ["zenity", args];
}

const run: RunPicker = (command, args) =>
  new Promise((resolve, reject) => {
    execFile(command, args, { windowsHide: false }, (err, stdout) => {
      if (!err) return resolve({ kind: "ok", stdout });
      if ((err as { code?: unknown }).code === 1) {
        return resolve({ kind: "cancelled" });
      }
      reject(err);
    });
  });

/** The chooser of this machine. One module for the browser, the CLI and the VS Code extension. */
export function createPicker(
  platform: NodeJS.Platform = process.platform,
  runPicker: RunPicker = run,
): PickPath {
  return async (kind, extensions) => {
    const [command, args] =
      platform === "win32"
        ? windows(kind, extensions)
        : platform === "darwin"
          ? mac(kind)
          : linux(kind);
    const answer = await runPicker(command, args);
    if (answer.kind === "cancelled") return null;
    const path = answer.stdout.trim();
    return path === "" ? null : path;
  };
}
