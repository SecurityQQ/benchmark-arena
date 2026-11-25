import assert from "node:assert/strict";
import { test } from "node:test";
import { validSocial } from "../src/social.js";

const ok = { url: "https://x.com/someone/status/2125252787235901885", author: "someone", name: "Some One", date: "2026-11-24", text: "New record: 9.85 s", competition: "noise", likes: 152 };

test("community posts: only x.com status links by their own author, about a listed competition, short", () => {
  const ids = new Set(["noise"]);
  const posts = validSocial({ posts: [
    ok,
    { ...ok, url: "https://x.com.evil.example/someone/status/1" },
    { ...ok, url: "javascript:alert(1)//x.com/someone/status/1" },
    { ...ok, url: "https://x.com/other/status/1" },               // handle in the link must be the author
    { ...ok, competition: "not-listed" },
    { ...ok, text: "x".repeat(281) },
    { ...ok, date: "yesterday" },
    { ...ok, url: "https://x.com/someone/status/3", date: "2026-11-25", likes: -1, name: "  " },
  ] }, ids);
  assert.deepEqual(posts.map((p) => p.url), ["https://x.com/someone/status/3", ok.url], "newest first, the rest rejected");
  assert.equal(posts[0].likes, undefined);
  assert.equal(posts[0].name, undefined);
  assert.deepEqual(validSocial(null, ids), []);
  assert.deepEqual(validSocial({ posts: "nope" }, ids), []);
});
