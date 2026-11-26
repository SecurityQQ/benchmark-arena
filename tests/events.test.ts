import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { RSVP_SITES, eventWhen, loadEvents, orderedEvents, validEvents, type CommunityEvent } from "../src/events.js";
import { pages } from "../src/prerender.js";

const APP = readFileSync("site/app.js", "utf-8");
const event = (over: Record<string, unknown> = {}) => ({
  url: "https://partiful.com/e/jaeBJVICdYxjFuPF4aXZ", title: "Frontier Formal Verification Brunch", start: "2026-11-07T21:30:00.000Z", end: "2026-11-07T23:00:00.000Z",
  timezone: "America/Los_Angeles", place: "Lower Nob Hill, San Francisco", about: "Builders in formal verification at one table.", topics: ["math", "gpu-kernels"], ...over,
});

test("events: the data file's events are valid and keep their topics", () => {
  const events = loadEvents(process.cwd());
  assert.ok(events.some((e) => e.url === "https://partiful.com/e/jaeBJVICdYxjFuPF4aXZ" && e.topics.includes("math")));
});

test("events: only public RSVP pages, real time zones and well-formed times get through", () => {
  assert.equal(validEvents({ events: [event()] }).length, 1);
  for (const bad of [
    { url: "http://partiful.com/e/x" }, { url: "https://evil.example/e/x" }, { url: "https://partiful.com/e/x?ref=1" }, { url: "javascript:alert(1)" },
    { timezone: "Mars/Olympus" }, { timezone: "America/Los_Angeles\"" }, { start: "Nov 7" }, { end: "2026-11-07T20:00:00Z" },
    { about: "x".repeat(301) }, { title: "" }, { place: undefined },
  ]) assert.equal(validEvents({ events: [event(bad)] }).length, 0, JSON.stringify(bad));
  assert.deepEqual(validEvents({ events: [event({ topics: ["math", "nope", 3] })] })[0].topics, ["math"]);
  assert.deepEqual(validEvents(null), []);
});

test("events: times read in the event's own zone; upcoming ones come first", () => {
  const e = validEvents({ events: [event()] })[0];
  assert.equal(eventWhen(e), "Sat, Nov 7, 2026 · 1:30 PM–3:00 PM PST");
  assert.equal(eventWhen({ ...e, end: undefined }), "Sat, Nov 7, 2026 · 1:30 PM PST");
  const later = { ...e, url: "https://lu.ma/next", start: "2026-12-12T18:00:00Z", end: "2026-12-12T20:00:00Z" };
  const older = { ...e, url: "https://lu.ma/old", start: "2026-10-01T18:00:00Z", end: "2026-10-01T20:00:00Z" };
  assert.deepEqual(orderedEvents([older, e, later], Date.parse("2026-11-26T00:00:00Z")).map((x) => [x.url, x.past]), [[later.url, false], [e.url, true], [older.url, true]]);
});

test("events: the site's twin formats the same way and names the same RSVP sites", () => {
  const src = APP.match(/function eventWhen\(e\) \{[\s\S]*?\n\}\n/)![0];
  const twin = Function(`${src}; return eventWhen;`)() as (e: CommunityEvent) => string;
  const e = validEvents({ events: [event()] })[0];
  assert.equal(twin(e), eventWhen(e));
  assert.equal(twin({ ...e, end: undefined }), eventWhen({ ...e, end: undefined }));
  assert.deepEqual(Function(`return (${APP.match(/const RSVP_SITES = (\{[^}]*\});/)![1]});`)(), RSVP_SITES);
});

test("events: the home page and the related topic pages list them, other topics do not", () => {
  const data = { crawledAt: "2026-11-26T03:00:00Z", competitions: [] };
  const all = pages(data, [], null, validEvents({ events: [event()] }));
  const body = (path: string) => all.find((p) => p.path === path)!.body;
  for (const path of ["/", "/topics/math", "/topics/gpu-kernels"]) {
    assert.ok(body(path).includes(`<a href="https://partiful.com/e/jaeBJVICdYxjFuPF4aXZ" rel="noopener" target="_blank"><b>Frontier Formal Verification Brunch</b></a> <span class="dim small">Past · Sat, Nov 7, 2026 · 1:30 PM–3:00 PM PST · Lower Nob Hill, San Francisco</span>`), path);
  }
  assert.ok(!body("/topics/speedruns").includes('id="events"'));
  assert.ok(!pages(data).find((p) => p.path === "/")!.body.includes('id="events"'));
});
