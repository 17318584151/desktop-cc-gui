# Chat streaming regression

With the Vite development server running, open
`http://localhost:1420/tests/browser/stream-throttle.html`.
The page reports `PASS` after exercising actual React StrictMode commits:
completion, replacement, truncation, pending-timer cleanup, continuous Unicode
appends, coalescing and unmount. It needs no model, account or saved conversation.
The visible update count depends on browser scheduling; it is not a model-speed
or frame-rate benchmark.

Run the deterministic timing, grapheme, Markdown and store regressions with:

```sh
node --experimental-strip-types --test tests/*.test.ts
```

The presentation cursor still reveals text per frame. Markdown parses are
budgeted separately: 32ms up to 4,000 UTF-16 units, 64ms up to 16,000, and 128ms
above that. Completion bypasses the budget. These limits trade parser work
against arrival latency; they do not guarantee a frame-time bound for very
large Markdown documents.
