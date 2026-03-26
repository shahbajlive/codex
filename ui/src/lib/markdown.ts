import DOMPurify from "dompurify";
import { marked } from "marked";

marked.setOptions({
  gfm: true,
  breaks: true,
});

export function renderMarkdownHtml(content: string): string {
  const html = renderMarkdownDocument(content);
  return DOMPurify.sanitize(html, {
    ADD_TAGS: ["details", "summary"],
    ADD_ATTR: ["class", "open"],
  });
}

function renderMarkdownDocument(content: string): string {
  const blocks = splitCollapseBlocks(content);
  return blocks
    .map((block) => {
      if (block.kind === "markdown") {
        return parseMarkdown(block.content);
      }

      return [
        `<details class="workspace-chat__details" open>`,
        `<summary>${escapeHtml(block.label)}</summary>`,
        parseMarkdown(block.content),
        "</details>",
      ].join("");
    })
    .join("");
}

function parseMarkdown(content: string): string {
  return marked.parse(content, { async: false }) as string;
}

type RenderBlock =
  | { kind: "markdown"; content: string }
  | { kind: "collapse"; label: string; content: string };

function splitCollapseBlocks(content: string): RenderBlock[] {
  const lines = content.split("\n");
  const blocks: RenderBlock[] = [];
  let markdownBuffer: string[] = [];
  let index = 0;

  function flushMarkdown() {
    if (markdownBuffer.length === 0) {
      return;
    }
    blocks.push({ kind: "markdown", content: markdownBuffer.join("\n") });
    markdownBuffer = [];
  }

  while (index < lines.length) {
    const line = lines[index] ?? "";
    const match = /^:::codex-collapse\[(.+)\]$/.exec(line.trim());
    if (!match) {
      markdownBuffer.push(line);
      index += 1;
      continue;
    }

    flushMarkdown();
    index += 1;
    const collapseLines: string[] = [];
    while (index < lines.length && lines[index]?.trim() !== ":::") {
      collapseLines.push(lines[index] ?? "");
      index += 1;
    }
    if (index < lines.length && lines[index]?.trim() === ":::") {
      index += 1;
    }

    blocks.push({
      kind: "collapse",
      label: match[1],
      content: collapseLines.join("\n").trim(),
    });
  }

  flushMarkdown();
  return blocks;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}
