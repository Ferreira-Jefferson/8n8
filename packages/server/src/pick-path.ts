import { execFile } from "node:child_process";
import { DEFAULT_LOCALE, type Locale } from "@8n8/model";

/** "any": one window where the person chooses a file or a folder. */
export type PickKind = "folder" | "file" | "any";

/** Opens the system's own chooser and returns the path, or null when the person cancels. */
export type PickPath = (
  kind: PickKind,
  extensions: string[],
  /** The name of the filter on Windows; code files by default. */
  label?: string,
  /** The language of the system, for the words of the filter. */
  locale?: Locale,
) => Promise<string | null>;

/** How a chooser program is run: its output, or `cancelled` when it exits with 1 (the person closed it). */
export type RunPicker = (
  command: string,
  args: string[],
) => Promise<{ kind: "ok"; stdout: string } | { kind: "cancelled" }>;

const WORDS: Record<Locale, { code: string; all: string; here: string }> = {
  "pt-BR": {
    code: "Código",
    all: "Todos os arquivos",
    here: "Abrir esta pasta",
  },
  en: { code: "Code", all: "All files", here: "Open this folder" },
};

/** Windows: `*.py;*.ts` style filter; only plain extensions get in, so the text is never code. */
function winFilter(extensions: string[], label: string, all: string): string {
  const globs = extensions
    .filter((e) => /^\.[a-z0-9]+$/i.test(e))
    .map((e) => `*${e}`)
    .join(";");
  return `${label}|${globs}|${all}|*.*`;
}

function windows(
  kind: PickKind,
  extensions: string[],
  label: string,
  all: string,
  here: string,
): [string, string[]] {
  // Windows has no window for "file or folder". "any" uses the file window with a
  // placeholder name: opening a folder with it returns `folder\placeholder`, whose parent is the choice.
  const dialog =
    kind === "folder"
      ? "$d = New-Object System.Windows.Forms.FolderBrowserDialog"
      : kind === "any"
        ? `$d = New-Object System.Windows.Forms.OpenFileDialog; $d.CheckFileExists = $false; $d.ValidateNames = $false; $d.FileName = '${here}'; $d.Filter = '${winFilter(extensions, label, all)}'`
        : `$d = New-Object System.Windows.Forms.OpenFileDialog; $d.Filter = '${winFilter(extensions, label, all)}'`;
  const result =
    kind === "folder"
      ? "$d.SelectedPath"
      : kind === "any"
        ? "if (Test-Path -LiteralPath $d.FileName) { $d.FileName } else { Split-Path -Parent $d.FileName }"
        : "$d.FileName";
  // The server runs in the background, so Windows keeps its new windows behind the browser.
  // An Alt key press lets this process take the front; the invisible top-most owner then keeps the dialog there.
  const script = [
    "[Console]::OutputEncoding = [Text.Encoding]::UTF8",
    "Add-Type -AssemblyName System.Windows.Forms",
    "(New-Object -ComObject WScript.Shell).SendKeys('%')",
    "$f = New-Object System.Windows.Forms.Form; $f.TopMost = $true; $f.Opacity = 0; $f.ShowInTaskbar = $false; $f.Show(); $f.Activate()",
    dialog,
    `if ($d.ShowDialog($f) -eq 'OK') { ${result} } else { exit 1 }`,
  ].join("; ");
  return ["powershell.exe", ["-NoProfile", "-STA", "-Command", script]];
}

function mac(kind: PickKind): [string, string[]] {
  if (kind === "any") {
    // NSOpenPanel takes files and folders in the same window; exit 1 means cancelled.
    const script =
      "ObjC.import('AppKit'); ObjC.import('stdlib'); const p = $.NSOpenPanel.openPanel; p.canChooseFiles = true; p.canChooseDirectories = true; if (p.runModal === 1) { p.URL.path.js } else { $.exit(1) }";
    return ["osascript", ["-l", "JavaScript", "-e", script]];
  }
  const what = kind === "folder" ? "folder" : "file";
  return ["osascript", ["-e", `POSIX path of (choose ${what})`]];
}

function linux(kind: PickKind): [string, string[]] {
  // zenity cannot take both in one window: "any" opens the file one.
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
  return async (kind, extensions, label, locale = DEFAULT_LOCALE) => {
    const words = WORDS[locale];
    const [command, args] =
      platform === "win32"
        ? windows(
            kind,
            extensions,
            (label ?? words.code).replace(/[^\p{L}\p{N} ]/gu, ""),
            words.all,
            words.here,
          )
        : platform === "darwin"
          ? mac(kind)
          : linux(kind);
    const answer = await runPicker(command, args);
    if (answer.kind === "cancelled") return null;
    const path = answer.stdout.trim();
    return path === "" ? null : path;
  };
}
