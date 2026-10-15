import "@fontsource/archivo-black/400.css";
import "@fontsource/space-grotesk/400.css";
import "@fontsource/space-grotesk/500.css";
import "@fontsource/space-grotesk/700.css";
import "@fontsource/dm-mono/400.css";
import "@fontsource/dm-mono/500.css";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { setSessionToken } from "./api";
import { readLaunch } from "./session";
import "./styles.css";
import { vscodeHost } from "./vscode-host";

const launch = readLaunch(
  window.location,
  window.sessionStorage,
  window.history,
  document.querySelector('meta[name="8n8-folder"]')?.getAttribute("content") ??
    null,
);
setSessionToken(launch.token);

const root = document.getElementById("root");
if (root) createRoot(root).render(<App initialFolder={launch.folder} />);
// The extension waits for this before it counts the page as loaded (VSC-08).
vscodeHost()?.postMessage({ type: "ready" });
