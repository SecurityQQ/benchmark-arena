import assert from "node:assert/strict";
import { test } from "node:test";
import { TOPICS, inTopic, topicJoinLine } from "../src/topics.js";
import { JOIN_LINE } from "../src/render.js";

test("topics: slugs are URL-safe and unique, and every join line still points at join.txt", () => {
  assert.equal(new Set(TOPICS.map((t) => t.slug)).size, TOPICS.length);
  for (const t of TOPICS) {
    assert.match(t.slug, /^[a-z0-9-]{1,40}$/);
    assert.match(topicJoinLine(JOIN_LINE, t), /^Fetch and follow the instructions at https:\/\/openchallengelist\.com\/join\.txt to pick an open .+ and enter it with me\.$/);
  }
  assert.throws(() => topicJoinLine("Something else entirely.", TOPICS[0]));
});

test("topics: domain, compute and tag rules combine with AND", () => {
  const c = (domain: string, compute: string, tags: string[] = []) => ({ domain, tags, participation: { requirements: [], compute } }) as any;
  const by = (slug: string) => TOPICS.find((t) => t.slug === slug)!;
  assert.ok(inTopic(by("math"), c("formal-methods", "cluster")));
  assert.ok(!inTopic(by("math"), c("ml-research", "cpu")));
  assert.ok(inTopic(by("no-gpu"), c("llm-eval", "none")) && !inTopic(by("no-gpu"), c("llm-eval", "consumer-gpu")));
  assert.ok(inTopic(by("speedruns"), c("ml-research", "datacenter-gpu", ["training-speedrun"])));
});
