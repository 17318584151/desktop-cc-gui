import test from "node:test";
import assert from "node:assert/strict";
import { StreamReveal, visiblePrefix, visibleWindow, type RevealClock } from "../src/features/chat/components/stream-reveal.ts";
function clock() {
  let now = 0, id = 0;
  const frames = new Map<number, () => void>();
  const timers = new Map<number, { time: number; callback: () => void }>();
  const api: RevealClock = {
    now: () => now,
    frame: cb => { frames.set(++id, cb); return id; },
    cancelFrame: id => { frames.delete(id); },
    timeout: (callback, ms) => { timers.set(++id, {time:now+ms,callback}); return id as unknown as ReturnType<typeof setTimeout>; },
    clearTimeout: id => { timers.delete(id as unknown as number); },
  };
  return {api, pending: () => frames.size + timers.size, advance(ms: number, raf = true) {
    now += ms;
    if (raf) { const callbacks = [...frames.values()]; frames.clear(); callbacks.forEach(cb=>cb()); }
    for (const [id, timer] of [...timers]) if (timer.time <= now) { timers.delete(id); timer.callback(); }
  }};
}
test("one burst becomes multiple monotonic frames and catches up within 80ms", () => {
  const c=clock(), reveal=new StreamReveal(true,c.api);
  reveal.update("x".repeat(100), true);
  const sizes=[];
  for(let i=0;i<5;i++){c.advance(16); sizes.push(reveal.read(0,100));}
  assert.deepEqual(sizes,[20,40,60,80,100]);
  assert.equal(c.pending(),0);
});
test("continuous arrivals do not reset visible text or delay earlier content", () => {
  const c=clock(), reveal=new StreamReveal(true,c.api);
  reveal.update("x".repeat(100),true); c.advance(32);
  assert.equal(reveal.read(0,100),40);
  reveal.update("x".repeat(200),true); c.advance(32);
  assert.ok(reveal.read(0,200)>=100);
  c.advance(48); assert.equal(reveal.read(0,200),200);
});
test("finish, hidden/reduced-motion, replacement and truncation reveal exact content immediately", () => {
  const c=clock(), reveal=new StreamReveal(true,c.api);
  reveal.update("original text",true); c.advance(16);
  reveal.update("replacement",true); assert.equal(reveal.read(0,100),11);
  reveal.update("rep",true); assert.equal(reveal.read(0,100),3);
  reveal.update("replacement",false); assert.equal(reveal.read(0,100),11);
  reveal.update("replacement append",true); reveal.finish();
  assert.equal(reveal.read(0,100),18); assert.equal(c.pending(),0);
});
test("history shows instantly; suspended frames catch up via fallback; disposal cancels work", () => {
  const c=clock(), history=new StreamReveal(false,c.api);
  assert.equal(history.read(0,10),10);
  history.update("history",false); assert.equal(history.read(0,100),7);
  const live=new StreamReveal(true,c.api);
  live.update("stream",true); c.advance(100,false); assert.equal(live.read(0,100),6);
  live.update("stream more",true); live.cancel(); assert.equal(c.pending(),0);
});
test("completed text runs are not notified on subsequent reveal frames", () => {
  const c=clock(), reveal=new StreamReveal(true,c.api); let first=0,last=0;
  reveal.subscribe(0,10,()=>first++); const off=reveal.subscribe(10,90,()=>last++);
  reveal.update("x".repeat(100),true);
  for(let i=0;i<5;i++)c.advance(16);
  assert.equal(first,1); assert.equal(last,5); off();
});
test("no intermediate prefix splits CJK, emoji, flags or combining characters", () => {
  for(const text of ["你好世界","A🙂B","👩‍💻完成","🇨🇳🇸🇬","e\u0301clair"]){
    const boundaries=new Set([0,...[...new Intl.Segmenter(undefined,{granularity:'grapheme'}).segment(text)].map(s=>s.index+s.segment.length)]);
    for(let n=0;n<=text.length;n++){
      const part=visiblePrefix(text,n);assert.ok(boundaries.has(part.length));assert.ok(text.startsWith(part));assert.ok(part.length<=n);
    }
    assert.equal(visiblePrefix(text,text.length),text);
  }
});

test("continuous arrivals cannot postpone the stalled-frame watchdog forever", () => {
  const c=clock(), reveal=new StreamReveal(true,c.api);
  reveal.update("x",true);
  for(let i=2;i<=5;i++) {c.advance(24,false);reveal.update("x".repeat(i),true);}
  c.advance(4,false);
  assert.equal(reveal.read(0,100),5);
  assert.equal(c.pending(),0);
});

test("thinking window follows revealed text and preserves grapheme boundaries", () => {
  const text="x".repeat(2100)+"👩‍💻"+"y".repeat(2100);
  assert.equal(visibleWindow(text,100,2000),"x".repeat(100));
  assert.equal(visibleWindow(text,3000,2000).length,2000);
  const count=2100+2+2000;
  const window=visibleWindow(text,count,2000);
  assert.ok(window.startsWith("👩‍💻"));
  assert.equal(visibleWindow(text,text.length,2000),"y".repeat(2000));
});

test("virtualized remount shows received text immediately and smooths only new arrivals", () => {
  const c=clock(), reveal=new StreamReveal(false,c.api);
  const received="x".repeat(3000);
  assert.equal(reveal.read(0,received.length),received.length);
  reveal.update(received,true);
  assert.equal(c.pending(),0);
  reveal.update(received+"y".repeat(100),true);
  c.advance(16);
  assert.equal(reveal.read(0,3100),3020);
});
