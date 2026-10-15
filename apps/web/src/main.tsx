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

const launch = readLaunch(
  window.location,
  window.sessionStorage,
  window.history,
);
setSessionToken(launch.token);

const root = document.getElementById("root");
if (root) createRoot(root).render(<App initialFolder={launch.folder} />);
