/** The only module in this package that touches the disk. Read-only calls only. */
export { lstat, readdir, readFile, realpath, stat } from "node:fs/promises";
