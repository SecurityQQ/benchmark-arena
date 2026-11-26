import assert from "node:assert/strict";
import { test } from "node:test";
import { PRIZES, USER_AGENT, buildVesuvius, isoDay, plainText, prizeFacts, statusOf } from "../src/structured/vesuvius.js";
import { postprocess } from "../src/postprocess.js";

// The prizes page as scrollprize.org serves it (Docusaurus), cut to the parts the builder reads
const html = `<script>gtag("config","G-X")</script><div><span>Open prize pool</span><span>$2,140,000</span><a>Grand Prize deadline June 25th, 2027 →</a></div>
<h2>2027 Grand Prize</h2><p>Deadline: June 25th, 2027 (11:59pm Pacific)</p><p><strong>$800,000</strong> to the first team ... third place (<strong>$50,000</strong>) — <strong>$1,000,000</strong> in total. Prizes are awarded according to the rules listed below.</p>
<p>First Letters: <strong>$50,000</strong> per scroll, for any of the eligible scroll volumes.</p><p>PHerc. Paris. 4’s Title: <strong>$50,000</strong> to the first team to discover the title of PHerc. Paris. 4</p>
<p>Submissions are evaluated monthly. The next deadline is 11:59pm Pacific, November 30th, 2026!</p><p>Best Submission of the Month: <strong>$20,000</strong>, guaranteed every month</p>`;

test("vesuvius: reads the pool, the prizes and both deadlines from the prizes page", () => {
  assert.deepEqual(prizeFacts(plainText(html)), { pool: 2140000, grandDeadline: "2027-06-25", monthlyDeadline: "2026-11-30", grandPrize: 1000000, firstLetters: 50000, title: 50000, monthly: 20000 });
  assert.equal(isoDay("February", "30", "2027"), undefined);
  assert.equal(isoDay("Smarch", "1", "2027"), undefined);
  assert.deepEqual(prizeFacts("nothing here"), { pool: undefined, grandDeadline: undefined, monthlyDeadline: undefined, grandPrize: undefined, firstLetters: undefined, title: undefined, monthly: undefined });
});

test("vesuvius: open until the Grand Prize deadline, then ended", () => {
  assert.equal(statusOf({ grandDeadline: "2027-06-25" }, "2026-11-26"), "active");
  assert.equal(statusOf({ grandDeadline: "2027-06-25" }, "2027-06-26"), "ended");
  assert.equal(statusOf({}, "2026-11-26"), "unknown");
});

test("vesuvius: builds a valid board with one open track per prize, and fails loudly on a page it cannot read", async (t) => {
  t.mock.method(globalThis, "fetch", async (input: any, init?: RequestInit) => {
    assert.equal(String(input instanceof Request ? input.url : input), PRIZES);
    assert.equal(new Headers(init?.headers).get("user-agent"), USER_AGENT);
    return new Response(html, { headers: { "content-type": "text/html" } });
  });
  const c = postprocess(await buildVesuvius("2026-11-26"), { site: "vesuvius-challenge", url: PRIZES } as any);
  assert.equal(c.id, "vesuvius-challenge");
  assert.equal(c.status, "active");
  assert.equal(c.participation.deadline, "2027-06-25");
  assert.deepEqual(c.problems.map((p) => [p.id, p.isOpen, p.records.length]), [["grand-prize-2027", true, 0], ["first-letters", true, 0], ["title-pherc-paris-4", true, 0], ["monthly-progress", true, 0]]);
  assert.ok(c.problems[0].name.includes("$1,000,000"));
  t.mock.restoreAll();
  t.mock.method(globalThis, "fetch", async () => new Response("<html>moved</html>"));
  await assert.rejects(buildVesuvius("2026-11-26"), /Vesuvius Challenge download failed/);
});
