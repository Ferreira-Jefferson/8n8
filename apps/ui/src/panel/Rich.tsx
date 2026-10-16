import { Fragment, type ReactNode } from "react";

/** Renders a piece of text that can point at a line (`L12`): a plain piece, or a button for a line inside the node. */
export type PlainRenderer = (text: string, key: string) => ReactNode;

const INLINE =
  /(`[^`\n]+`)|(\*\*[^*\n]+?\*\*|__[^_\n]+?__)|(\*[^*\s][^*\n]*?\*|(?<![\w])_[^_\s][^_\n]*?_(?![\w]))/;

/** Inline marks: `code`, **bold**, *italic* and _italic_. Anything else stays as written. */
export function inline(
  text: string,
  plain: PlainRenderer = (s) => s,
  prefix = "r",
): ReactNode[] {
  const out: ReactNode[] = [];
  let rest = text;
  let n = 0;
  while (rest.length > 0) {
    const m = INLINE.exec(rest);
    if (!m) {
      out.push(plain(rest, `${prefix}${n++}`));
      break;
    }
    if (m.index > 0) out.push(plain(rest.slice(0, m.index), `${prefix}${n++}`));
    const key = `${prefix}${n++}`;
    const token = m[0];
    if (m[1]) {
      const code = token.slice(1, -1);
      out.push(
        <code key={key} className="md-code">
          {plain(code, `${key}c`)}
        </code>,
      );
    } else if (m[2]) {
      out.push(
        <strong key={key}>
          {inline(token.slice(2, -2), plain, `${key}b`)}
        </strong>,
      );
    } else {
      out.push(
        <em key={key}>{inline(token.slice(1, -1), plain, `${key}i`)}</em>,
      );
    }
    rest = rest.slice(m.index + token.length);
  }
  return out;
}

type Block =
  | { kind: "p"; lines: string[] }
  | { kind: "ul" | "ol"; items: string[] };

const BULLET = /^\s*[-*•]\s+(.*)$/;
const NUMBER = /^\s*\d+[.)]\s+(.*)$/;

/** The text as paragraphs and lists. A list also starts inside a line ("jobs: - a. - b."), as the models often flatten it. */
export function blocksOf(text: string): Block[] {
  const flat = text
    .replace(/\r\n/g, "\n")
    .replace(/([:.;)])[ \t]+(?=[-•][ \t]+\S)/g, "$1\n");
  const blocks: Block[] = [];
  for (const line of flat.split("\n")) {
    if (line.trim() === "") {
      blocks.push({ kind: "p", lines: [] });
      continue;
    }
    const bullet = BULLET.exec(line);
    const number = bullet ? null : NUMBER.exec(line);
    const item = bullet?.[1] ?? number?.[1];
    const kind = bullet ? "ul" : number ? "ol" : null;
    const last = blocks.at(-1);
    if (kind && item !== undefined) {
      if (last && last.kind === kind) last.items.push(item);
      else blocks.push({ kind, items: [item] });
    } else if (last && last.kind === "p") {
      last.lines.push(line.trim());
    } else {
      blocks.push({ kind: "p", lines: [line.trim()] });
    }
  }
  return blocks.filter((b) => b.kind !== "p" || b.lines.length > 0);
}

/** A text with Markdown marks, shaped: paragraphs, lists, bold, italic and code. No HTML ever goes in. */
export function Rich({ text, plain }: { text: string; plain?: PlainRenderer }) {
  return (
    <div className="rich">
      {blocksOf(text).map((b, i) => {
        const key = `b${i}`;
        if (b.kind === "p") {
          return (
            <p key={key}>
              {b.lines.map((l, j) => (
                // biome-ignore lint/suspicious/noArrayIndexKey: the lines never reorder
                <Fragment key={j}>
                  {j > 0 && <br />}
                  {inline(l, plain, `${key}l${j}`)}
                </Fragment>
              ))}
            </p>
          );
        }
        const List = b.kind;
        return (
          <List key={key}>
            {b.items.map((item, j) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: the items never reorder
              <li key={j}>{inline(item, plain, `${key}i${j}`)}</li>
            ))}
          </List>
        );
      })}
    </div>
  );
}

/** A short text on one line (a claim, a command, a reason): the marks, with no blocks. */
export function RichInline({
  text,
  plain,
}: {
  text: string;
  plain?: PlainRenderer;
}) {
  return <>{inline(text, plain)}</>;
}
