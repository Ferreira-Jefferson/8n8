import type { SourceFile } from "@8n8/model";

/** `count` contiguous slices of `files`, balanced by source size; none is empty. */
export function split(files: SourceFile[], count: number): SourceFile[][] {
  const total = files.reduce((sum, f) => sum + f.source.length + 1, 0);
  const slices: SourceFile[][] = Array.from({ length: count }, () => []);
  let before = 0;
  for (const file of files) {
    const size = file.source.length + 1;
    const at = Math.floor(((before + size / 2) * count) / total);
    slices[Math.min(count - 1, at)]?.push(file);
    before += size;
  }
  return slices.filter((slice) => slice.length > 0);
}
