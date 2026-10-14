import type {
  NodeTitle,
  TitleItem,
  TitleRequest,
  TitlesResponse,
} from "@code2n8n/model";
import {
  diffReasons,
  type Fingerprint,
  fingerprintOf,
  normalizeCode,
} from "./fingerprint";
import type { LlmClient } from "./openrouter";
import { jsonMode } from "./review";
import { parseVerdicts } from "./reviewer";
import type { TitleCache } from "./title-cache";
import { parseTitles, titleMessage } from "./title-prompt";
import {
  applyTitleVerdicts,
  type TitleBlock,
  titleLayerOne,
  titleReviewerMessage,
} from "./title-reviewer";

export interface TitleDeps {
  /** Absent when OPENROUTER_API_KEY is not set. */
  llm?: LlmClient | undefined;
  cache: TitleCache;
  model: string;
  reviewModel: string;
  prompt: { text: string; version: string };
  reviewer: { text: string; version: string };
}

const sorted = (names: string[]) =>
  [...names].sort((a, b) => a.localeCompare(b));

/** Titles of one level: cache by node, then at most 1 title request and 1 review request for the rest (VID-14, VID-16, VID-17). */
export async function titleNodes(
  req: TitleRequest,
  deps: TitleDeps,
): Promise<TitlesResponse> {
  const { llm, cache } = deps;
  // The prompt gets exactly what the fingerprint covers (L-004).
  const items: TitleItem[] = req.items.map((item) => ({
    ...item,
    code: normalizeCode(item.code),
    calls: sorted(item.calls),
    calledBy: sorted(item.calledBy),
  }));
  const fps = items.map((item) => fingerprintOf(item, deps));
  const titles = new Map<number, NodeTitle>();
  const toTitle = (
    i: number,
    title: { text: string; lines: number[] },
    fromCache: boolean,
  ): NodeTitle => {
    const item = items[i] as TitleItem;
    return {
      nodeId: item.nodeId,
      text: title.text,
      lines: title.lines.map((n) => n + item.range.start - 1),
      fromCache,
    };
  };
  const inOrder = () => items.flatMap((_, i) => titles.get(i) ?? []);

  const missing: number[] = [];
  for (const [i, item] of items.entries()) {
    const prev = await cache.get(item.cacheKey);
    if (
      prev &&
      diffReasons(prev.fingerprint, fps[i] as Fingerprint).length === 0
    ) {
      titles.set(i, toTitle(i, prev.title, true));
    } else {
      missing.push(i);
    }
  }
  if (missing.length === 0) return { status: "ok", titles: inOrder() };
  if (!llm) return { status: "no-key", titles: inOrder() };

  const approved: { index: number; text: string; lines: number[] }[] = [];
  try {
    const raw = await llm.complete({
      model: deps.model,
      messages: [
        { role: "system", content: deps.prompt.text },
        {
          role: "user",
          content: titleMessage(missing.map((i) => items[i] as TitleItem)),
        },
      ],
      json: jsonMode(deps.model),
    });
    // n1..nk point into `missing`; an id that was not sent is ignored (VID-14).
    const blocks: (TitleBlock & { index: number })[] = [];
    for (const draft of parseTitles(raw)) {
      const k = /^n(\d+)$/.exec(draft.id)?.[1];
      const index = k === undefined ? undefined : missing[Number(k) - 1];
      if (index === undefined || blocks.some((b) => b.index === index)) {
        continue;
      }
      const item = items[index] as TitleItem;
      const neighbours = [...item.calls, ...item.calledBy];
      if (titleLayerOne(draft.title, { code: item.code, neighbours })) {
        continue;
      }
      blocks.push({
        id: draft.id,
        title: draft.title,
        code: item.code,
        neighbours,
        index,
      });
    }
    if (blocks.length > 0) {
      const answer = await llm.complete({
        model: deps.reviewModel,
        messages: [
          { role: "system", content: deps.reviewer.text },
          { role: "user", content: titleReviewerMessage(blocks) },
        ],
        json: jsonMode(deps.reviewModel),
      });
      for (const kept of applyTitleVerdicts(blocks, parseVerdicts(answer))) {
        const block = blocks.find(
          (b) => b.id === kept.id,
        ) as (typeof blocks)[0];
        approved.push({
          index: block.index,
          text: kept.text,
          lines: kept.lines,
        });
      }
    }
  } catch (err) {
    return {
      status: "error",
      message: err instanceof Error ? err.message : String(err),
      titles: inOrder(),
    };
  }

  for (const { index, text, lines } of approved) {
    const item = items[index] as TitleItem;
    try {
      await cache.set({
        schemaVersion: 1,
        cacheKey: item.cacheKey,
        fingerprint: fps[index] as Fingerprint,
        createdAt: new Date().toISOString(),
        title: { text, lines },
      });
    } catch (err) {
      console.error("titles: failed to write cache", err);
    }
    titles.set(index, toTitle(index, { text, lines }, false));
  }
  return { status: "ok", titles: inOrder() };
}
