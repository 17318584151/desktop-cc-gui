import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeHighlight from "rehype-highlight";
import { createCachedHighlighter } from "../src/features/chat/components/cached-highlight.ts";

function render(text: string, plugin = createCachedHighlighter(), streaming = false) {
  return renderToStaticMarkup(createElement(Markdown, {
    remarkPlugins: [remarkGfm], rehypePlugins: [[plugin, { streaming }]], children: text,
  }));
}
function reference(text: string, highlight = true) {
  return renderToStaticMarkup(createElement(Markdown, {
    remarkPlugins: [remarkGfm], rehypePlugins: highlight ? [rehypeHighlight] : [], children: text,
  }));
}

const fixtures = [
  "```js\nconst x = '<script>alert(1)</script>';\n```",
  "~~~typescript\nconst x: number = 1;\n~~~~",
  "````js\nconst x = `hello`;\n```\n````",
  "```unknown-language\nconst x=1;\n```",
  "```text\n<script>alert('x')</script>\n```",
  "```\n/tmp/file.ts\n```",
  "> ```js\n> const x=1;\n> ```",
  "- list\n\n  ```python\n  print('hi')\n  ```",
  "    const x = 1;\n\nparagraph",
  "```js\r\nconst x=1;\r\n```\r\n",
  "| Name | Value |\n| --- | --- |\n| x | `1` |\n\n[ref][r]\n\n[r]: https://example.com\n\n```js\nx()\n```",
];

test("settled output exactly matches original highlighter across Markdown syntax", () => {
  const plugin = createCachedHighlighter();
  for (const text of fixtures) {
    assert.equal(render(text, plugin), reference(text));
    assert.equal(render(text, plugin), reference(text));
  }
});

test("complete fences highlight during streaming, incomplete fences remain plain and settle correctly", () => {
  for (const complete of fixtures.slice(0, 6)) {
    assert.equal(render(complete, createCachedHighlighter(), true), reference(complete));
  }
  for (const text of ["```js\nconst x=1", "````js\nconst x=1\n```", "~~~js\nconst x=1\n```", "> ```js\n> x()"]) {
    const plugin = createCachedHighlighter();
    assert.equal(render(text, plugin, true), reference(text, false));
    assert.equal(render(text, plugin, false), reference(text));
  }
});

test("later reference definitions and GFM tables still update the whole document", () => {
  const plugin = createCachedHighlighter();
  const prefix = "[reference][r]\n\n```js\nconst x=1;\n```\n\n";
  for (const suffix of ["", "[r]: https://example.com\n", "[r]: https://example.org\n\n|a|b|\n|-|-|\n|1|2|\n"]) {
    assert.equal(render(prefix + suffix, plugin, true), reference(prefix + suffix));
  }
});

test("unchanged blocks reuse highlighting, changed code/language invalidates it", () => {
  let calls = 0;
  const real = rehypeHighlight();
  const plugin = createCachedHighlighter((tree, file) => { calls++; return real(tree, file); });
  const code = "```js\nconst x=1;\n```";
  render(code, plugin, true);
  render(code + "\n\nmore text", plugin, true);
  render(code, plugin, false);
  assert.equal(calls, 1);
  render(code.replace("x=1", "x=2"), plugin, true);
  render(code.replace("js", "python"), plugin, true);
  assert.equal(calls, 3);
});

test("cache eviction and oversized blocks retain identical output", () => {
  let calls = 0;
  const real = rehypeHighlight();
  const plugin = createCachedHighlighter((tree, file) => { calls++; return real(tree, file); }, {entries:1, characters:100});
  const a = "```js\na()\n```", b = "```js\nb()\n```";
  for (const text of [a,b,a,"```js\n" + "const x=1;\n".repeat(100) + "```",a]) {
    assert.equal(render(text, plugin), reference(text));
  }
  assert.equal(calls, 4);
});
