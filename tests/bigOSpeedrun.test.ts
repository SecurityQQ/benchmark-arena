import assert from "node:assert/strict";
import { test } from "node:test";
import {
  agentFromText, authorsOf, baselineValue, buildBigOSpeedrun, httpsUrl, otherBoundToProblem, parseScore, plainTex, raceToProblem, scoreRule, USER_AGENT,
} from "../src/structured/bigOSpeedrun.js";
import { postprocess } from "../src/postprocess.js";
import { competitionId } from "../src/validation.js";

const repo = { owner: "bigospeedrun", name: "verifier", url: "https://github.com/bigospeedrun/verifier", stars: 6, topics: [], defaultBranch: "main" };
const R = String.raw;

// ─── A trimmed copy of https://bigospeedrun.com/chat-knowledge.json (2026-11-25) ───
const pages: Record<string, string> = {
  "/integer-multiplication": [
    R`Multiply two \(n\) -bit integers on a Turing machine with a fixed finite alphabet and a fixed number of one-dimensional tapes.`,
    R`Classic bound: \(O(n \log n)\) ([Harvey and van der Hoeven 2021](https://annals.math.princeton.edu/2021/193-2/p04)).`,
    R`The bound has the form \(O(n \log^{1-\kappa} n)\) . \(\kappa\) is the saving in the logarithmic exponent; higher is better.`,
    "What counts as Claimed: Published bounds outside [CrocSwap/integer-mult-bounds](https://github.com/CrocSwap/integer-mult-bounds).",
  ].join("\n"),
  "/matrix-multiplication": R`Multiply two \(n\times n\) matrices over \(\mathbb{C}\) exactly.` + "\n" + R`The bound has the form \(O(n^{t+\varepsilon})\) . \(t\) is the arithmetic exponent; lower is better. For every fixed \(\varepsilon>0\) , one positive constant bounds the cost.`,
  "/apsp": R`The bound has the form \(O(n^{\alpha})\) . \(\alpha\) is the time exponent; lower is better.`,
  "/subset-sum": R`The bound has the form \(O(2^{\alpha n})\) . \(\alpha\) is the time exponent; lower is better.`,
  "/3sat": R`The bound has the form \(O^*(2^{n/(\log n)^{\alpha-o(1)}})\) . \(\alpha\) is the exponent of \(\log n\) in the denominator; higher is better. The term \(o(1)\) means that for every fixed \(\varepsilon>0\) the bound holds.`,
  "/integer-factoring": R`The score \(s\) , higher is better:time \(N^{c+o(1)}\) with \(c>0\) scores \(-c\) ;time \(N^{o(1)}=2^{o(b)}\) scores 0.`,
  "/directed-sssp": R`A result says: on graphs with at most \(D(n)\) edges, the time is \(O(T(n))\) .` + "\nClassic bound: " + R`\(O(m + n \log n)\)` + "\n" + R`Lower is better. A result is listed at every density up to its edge bound; the comparison is exact, by the exponents of \(n\) , \(\log n\) and \(\log\log n\) .`,
  "/flipped": "The score, higher is better.",
  "/hostile": "Higher is better here, lower is better there.",
};
const openai = { name: "OpenAI", login: "openai", url: "https://github.com/openai", avatar: "/avatars/openai-115d4c599e.png" };
const imOpenai = {
  id: "openai-multitape-nov24-2026", bound: R`O(n \log^{1-0.5+\varepsilon} n)`, exactScore: "1/2", scoreRelation: "strict-upper-bound", evidence: "Claimed", authors: [openai],
  date: "2026-11-25T00:04:41Z", dateMeaning: "Commit date", assumptions: [],
  method: "The machine treats blocks of digits as polynomial coefficients, with a parity polynomial from OpenAI's companion Fourier paper. We have not rebuilt the Lean proof.",
  credit: "The upper bound uses the short Fourier transforms of OpenAI's companion paper on finite Fourier transforms.",
  sources: [
    { name: "Source", url: "https://github.com/openai/math/blob/92b516ef8e2abf66c3db7aa31438d3010bc7956f/preprints/The-logarithmic-exponent-of-integer-multiplication-on-tapes-November-24-2026/build/intro.tex" },
    { name: "Paper", url: "https://github.com/openai/math/blob/92b516ef8e2abf66c3db7aa31438d3010bc7956f/preprints/The-logarithmic-exponent-of-integer-multiplication-on-tapes-November-24-2026/build/intro.tex" },
    { name: "Commit", url: "https://github.com/openai/math/tree/92b516ef8e2abf66c3db7aa31438d3010bc7956f" },
  ],
};
const imCube = {
  id: "crocswap-pr-7000", bound: R`O(n \log^{1-3.63005817\cdot 10^{\scriptstyle -3}} n)`, exactScore: "363005817/100000000000", scoreRelation: "attained", evidence: "Human Verified",
  authors: [{ name: "Jerry Jiaheng Chen", login: "CubeJerry", url: "https://github.com/CubeJerry" }], date: "2026-11-10T05:39:55Z", dateMeaning: "Source date",
  assumptions: [{ id: "openai-109-transfer", statement: "The OpenAI #109 fixed-tape multiplication reduction holds.", status: "unverified" }],
  credit: "Jerry Jiaheng Chen composes the sixteen shared wires of PR 6937 with the two splits of PR 6936. Its proof is a width-512 replay, not all-width. OpenAI Codex assisted. Doug Colkitt landed it on 2026-11-10.",
  sources: [{ name: "Source", url: "https://github.com/CrocSwap/integer-mult-bounds/pull/7000" }, { name: "Paper", url: "https://github.com/CrocSwap/integer-mult-bounds/pull/7000" }],
};
const imCroc = {
  id: "crocswap-selected-58629850319680ea", bound: imCube.bound, exactScore: "363005817/100000000000", scoreRelation: "attained", evidence: "Human Verified",
  authors: [{ name: "CrocSwap", login: "CrocSwap", url: "https://github.com/CrocSwap", twitterUsername: "CrocSwap" }], date: "2026-11-10T14:54:31Z", assumptions: [{ status: "unverified" }],
  method: "Records from this repository build on OpenAI's multiplication method. The repository's maintainer reviews a submission by merging it.",
  sources: [{ name: "Source", url: "https://github.com/CrocSwap/integer-mult-bounds/blob/e54523517d0f03e58352e647c403a5af3e525a57/certificates/selected-result.json" }],
};
const imSwapnil = {
  id: "swapnil-round-6", bound: R`O(n \log^{1-3.666565558019\cdot 10^{\scriptstyle -5}} n)`, exactScore: "3666565558019/100000000000000000", scoreRelation: "attained", evidence: "Lean Verified",
  authors: [{ name: "Swapnil", login: "Swapnil-jain", url: "https://github.com/Swapnil-jain" }], date: "2026-10-08T14:01:26Z", assumptions: [],
  sources: [{ name: "prove2.me", url: "https://prove2.me/theorems/9963d73f-fab7-44ad-b490-192b4d9f47b1" }],
};
const mmOpenai = {
  id: "openai-matrix-nine-fourths-2026", bound: R`O(n^{2.25+\varepsilon})`, exactScore: "9/4", scoreRelation: "attained", evidence: "Lean Verified", authors: [openai], date: "2026-10-06", dateMeaning: "Source date",
  method: "OpenAI's paper describes matrix multiplication by a tensor, a three-way array of numbers.", sources: [{ name: "Source", url: "https://github.com/openai/math/blob/fd4aeeb2ee4fc729c18d98444fed42fd0529eeeb/preprints/Matrix-Multiplication-Nine-Fourths-October-2-2026/paper.pdf" }],
};
const apspJosh = {
  id: "joshuaqfex-apsp-2026", bound: R`O(n^{2.9929479187094})`, exactScore: "14964739593547/5000000000000", scoreRelation: "attained", evidence: "Claimed",
  authors: [{ name: "Joshua Wharton", login: "JoshuaQFEX", url: "https://github.com/JoshuaQFEX" }], date: "2026-10-20T11:38:02Z", assumptions: [{ status: "unverified" }],
  credit: "Joshua Wharton changes the rational parameters of shresh's Claimed APSP construction and adds a numerical certificate.",
  sources: [{ name: "Source", url: "https://github.com/JoshuaQFEX/apsp-bound/blob/5dafbb186851aa80da58fb40a5e6857f4129b4fc/apsp_refinement.pdf" }],
};
const apspLean = {
  id: "direct-issue-211", bound: R`O(n^{2.99556071322466})`, exactScore: "149778035661233/50000000000000", scoreRelation: "attained", evidence: "Lean Verified", refiledBy: "Ported by floration",
  authors: [{ name: "Hrishik Sai Bojnal", login: "fringewidth", url: "https://github.com/fringewidth" }], date: "2026-11-22T23:59:44Z",
  sources: [{ name: "Issue", url: "https://github.com/bigospeedrun/verifier/issues/211" }],
};
const subsetClaim = {
  id: "jv1000-subset-sum-0-4875755-2026", bound: R`O(2^{0.4875755n})`, exactScore: "975151/2000000", scoreRelation: "attained", evidence: "Claimed",
  authors: [{ name: "Jennifer Voitle", login: "jv1000", url: "https://github.com/jv1000" }], date: "2026-11-04T07:15:59Z",
  credit: "Jennifer Voitle modifies Annanay Kapila's Subset Sum construction, which builds on OpenAI's 0.49 algorithm. The paper credits Claude and Astra as assistants, not as authors.",
  sources: [{ name: "Source", url: "https://github.com/jv1000/subset-sum/tree/6026da70f13d677b630cb1afd8fb10ee7a7f6010" }],
};
const subsetLean = {
  id: "direct-issue-104", bound: R`O(2^{0.5n})`, exactScore: "1/2", scoreRelation: "attained", evidence: "Lean Verified",
  authors: [{ name: "MultiAgency swarm", login: "darkhipo", url: "https://github.com/darkhipo" }], date: "2026-11-02T07:24:11Z",
  sources: [{ name: "Issue", url: "https://github.com/bigospeedrun/verifier/issues/104" }],
};
const satOpenai = { id: "openai-eth-2026", bound: R`O^*(2^{n/(\log n)^{1/2-o(1)}})`, exactScore: "1/2", scoreRelation: "attained", evidence: "Lean Verified", refiledBy: "Ported by Big O Speedrun", authors: [openai], date: "2026-10-26T21:18:03Z", sources: [] };
const satAnthropic = { id: "anthropic-eth-2026", bound: satOpenai.bound, exactScore: "1/2", scoreRelation: "attained", evidence: "Claimed", authors: [{ name: "Anthropic", login: "anthropics", url: "https://github.com/anthropics" }], date: "2026-10-27T03:07:21Z", sources: [{ name: "Source", url: "https://hexagonmath.org/2610.00577v1" }] };
const factoring = {
  id: "1337isnot1337-half-2026", bound: R`N^{1/(\log\log N)^{1/2-o(1)}}`, exactScore: "1/2", scoreRelation: "attained", evidence: "Lean Verified",
  authors: [{ name: "Cinna Davis", login: "1337isnot1337", url: "https://github.com/1337isnot1337" }], date: "2026-10-30T04:31:52Z",
  method: R`A Lean theorem proves that factoring \(b\)-bit numbers takes time \(2^{O(b/\sqrt{\log b})}\). The proof combines Anthropic's clique evaluator (from its Exponential Time Hypothesis work) with their factoring reduction.`,
  sources: [{ name: "Source", url: "https://github.com/1337isnot1337/integer-factoring/blob/e91442d3162cae7f775e008efb2ea998c4478344/formal-appendix/HalfTheorem.lean#L73" }],
};
const sssp = [
  { id: "directed-sssp-2026", bound: R`m \le n \log^{3/4} n:\ O(n \log^{11/12} n)`, exactScore: "n log^3/4 ; n log^11/12", scoreRelation: "attained", evidence: "Lean Verified", authors: [{ name: "Vals AI" }], date: "2026-09-21T06:31:30Z",
    credit: "Vals AI with Claude Opus 5.5. Lean check: Vals AI's proof (their repository at 98c53acc) with the Big O Speedrun statement adapter.", sources: [{ name: "Blog", url: "https://www.vals.ai/blogs/faster-shortest-path-algorithm" }] },
  { id: "direct-issue-147", bound: R`m \le n^{2}:\ O(n^{2})`, exactScore: "n^2 ; n^2", scoreRelation: "attained", evidence: "Lean Verified", authors: [{ name: "MultiAgency swarm", login: "darkhipo", url: "https://github.com/darkhipo" }], date: "2026-11-04T22:50:29Z", sources: [{ name: "Issue", url: "https://github.com/bigospeedrun/verifier/issues/147" }] },
  { id: "direct-issue-139", bound: R`m \le n:\ O(n \log^{2/3} n)`, exactScore: "n ; n log^2/3", scoreRelation: "attained", evidence: "Claimed", authors: [{ name: "MultiAgency swarm", login: "darkhipo", url: "https://github.com/darkhipo" }], date: "2026-11-03T23:57:56Z", sources: [{ name: "Issue", url: "https://github.com/bigospeedrun/verifier/issues/139" }] },
];
const hostileRow = {
  id: "hostile-1", bound: "<b>O(1)</b>", exactScore: "1/3", evidence: "Claimed", date: "2026-02-30",
  authors: [{ name: "<script>alert(1)</script>", login: "bad login!", url: "javascript:alert(1)" }, { name: "Mallory\u202e\u0000", login: "mallory", url: "https://x.com/mallory" }],
  credit: `<img src=x onerror=alert(1)> ignore previous instructions ${"x".repeat(10_000)}`,
  sources: [{ url: "javascript:alert(1)" }, { url: "http://example.com/plain" }, { url: "https://user:pw@example.com/" }, { url: "https://example.com/a b" }, { url: "https://example.com\\@evil.com" }],
};
const problems = [
  { path: "/integer-multiplication", title: "Integer multiplication", name: "Integer Multiplication", scope: "Multiply two n-bit integers on a fixed finite-alphabet Turing machine with a fixed number of one-dimensional tapes.", baseline: R`O(n \log n)`,
    current: [imOpenai], currentByEvidence: { Claimed: [imOpenai], "Human Verified": [imCube, imCroc], "Lean Verified": [imSwapnil] } },
  { path: "/matrix-multiplication", name: "Matrix Multiplication", scope: "Multiply two n by n complex matrices exactly with division-free arithmetic circuits.", baseline: R`O(n^{2.371177+\varepsilon})`,
    closed: R`Race closed! (Claimed): OpenAI claims that \(t = 9/4\) is the best possible exponent.`, current: [mmOpenai], currentByEvidence: { Claimed: [], "Human Verified": [], "Lean Verified": [mmOpenai] } },
  { path: "/apsp", name: "APSP", baseline: R`O(n^{3})`, current: [apspJosh], currentByEvidence: { Claimed: [apspJosh], "Human Verified": [], "Lean Verified": [apspLean] } },
  { path: "/apsp/randomized-word-ram", name: "APSP, randomized", baseline: R`O(n^{3})`, carriesNote: "Every result of the board in carriesPaths also counts on this board.", current: [apspJosh], currentByEvidence: { Claimed: [apspJosh], "Lean Verified": [apspLean] } },
  { path: "/subset-sum", name: "Subset Sum", baseline: R`O^*(2^{n/2})`, current: [subsetClaim], currentByEvidence: { Claimed: [subsetClaim], "Human Verified": [], "Lean Verified": [subsetLean] } },
  { path: "/3sat", name: "3-SAT", baseline: R`O^*(1.307031578^n)`, current: [satOpenai, satAnthropic], currentByEvidence: { Claimed: [satAnthropic], "Human Verified": [], "Lean Verified": [satOpenai] } },
  { path: "/integer-factoring", name: "Integer Factoring", baseline: R`O(N^{1/5}\log^{16/5}N/(\log\log N)^{3/5})`, current: [factoring], currentByEvidence: { Claimed: [], "Human Verified": [], "Lean Verified": [factoring] } },
  { path: "/directed-sssp", name: "Directed Shortest Paths", baseline: R`O(m + n \log n)`, current: sssp.slice(0, 2), currentByEvidence: { Claimed: [sssp[2]], "Human Verified": [], "Lean Verified": sssp.slice(0, 2) } },
  // the page says higher is better, yet the site's leader has the lower score: the direction is not trusted
  { path: "/flipped", name: "Flipped", current: [{ ...apspJosh, id: "low" }], currentByEvidence: { Claimed: [{ ...apspJosh, id: "low" }], "Lean Verified": [{ ...apspLean, id: "high" }] } },
  { path: "/hostile", name: "Hostile <i>race</i>", current: [hostileRow], currentByEvidence: { Claimed: [hostileRow, { ...hostileRow, id: "<img>" }, { ...hostileRow, id: "unknown-level", evidence: "Totally Verified" }] } },
  { path: "/../etc", name: "Escape", current: [], currentByEvidence: {} },
  { path: "/__proto__", name: "Proto", current: [], currentByEvidence: {} },
  { path: "/integer-multiplication", name: "Duplicate", current: [], currentByEvidence: {} },
];
const rows = [
  { path: "/other/quasi-riemann", title: "Quasi-Riemann hypothesis", rankedQuantity: R`\theta`, better: "A lower value is better.",
    statement: R`The quantity is the zero-free half-plane threshold \(\theta\) for Dirichlet \(L\)-functions, which include zeta. A lower threshold is better.`,
    closed: R`Race closed: \(\theta = 1/2\) is the best possible value, and two independent public rebuilds confirm the Lean proof.`,
    baseline: { kind: "OpenAI baseline", bound: R`\theta\le 7/8`, source: "https://github.com/openai/math/blob/adc7f1241b42e322a6451854ab7e4b4c146bf78a/preprints/The-Quasi-Riemann-Hypothesis-September-30-2026/paper.pdf", date: "2026-10-06" },
    reviewRepository: { name: "GTimG/QuasiRiemannTracker", url: "https://github.com/GTimG/QuasiRiemannTracker", rule: "A result is Human Verified when GTimG/QuasiRiemannTracker merges its pull request. A result in an open pull request is Claimed." },
    current: { bound: R`\theta\le 1/2`, exactValue: "1/2", evidence: "Lean Verified", authors: ["Levent Alpöge"], date: "2026-11-20", source: "https://alpo.ge/remark.pdf",
      conditions: `This row is Lean Verified through independent public rebuilds. The author, Levent Alpöge, says in a four-page note: "I believe I have, working with Claude, discovered a proof" of the Riemann Hypothesis.` },
    claimCount: 47 },
  { path: "/other/prime-gaps", title: "Bounded prime gaps", rankedQuantity: R`B\text{ in }H_1\le B`, better: "A lower value is better.", baseline: { kind: "Classic baseline", bound: R`H_1\le 246` },
    current: { bound: R`H_1\le 182`, exactValue: "182", evidence: "Claimed", authors: ["GPT-6 Astra (OpenAI), prompted by Romyar Sharifi"], date: "2026-09-07", source: "https://www.math.ucla.edu/~sharifi/AI/prime_gaps_182_expository_bundle.pdf",
      conditions: "The paper credits the proof to GPT-6 Astra, prompted by Romyar Sharifi." }, claimCount: 5 },
  { path: "/other/heilbronn-triangle", title: "Heilbronn triangle", rankedQuantity: R`\eta\text{ in }\Delta(n)\ge cn^{-2+\eta}`, better: "A higher value is better.", baseline: { kind: "OpenAI baseline", bound: R`\eta>3.17\cdot10^{-236}` },
    current: { bound: R`\eta>1.98\cdot10^{-8}`, exactValue: "2/100866719", evidence: "Claimed", authors: ["Qiuyu Chen (Euler)"], date: "2026-10-19", source: "https://github.com/canghaimeng/openai-math-improvement/blob/b3c7abea0d5e392777498816ca837eded8b85669/problems/bound-191/README.md" } },
  { path: "/other/contingency-tables", title: "Contingency-table sampling", rankedQuantity: "A d^p", better: "A lower value is better.", baseline: { kind: "OpenAI baseline", bound: R`\mathrm{gap}^{-1}\le 98{,}560d^{126}` },
    current: { bound: R`\mathrm{gap}^{-1}\le 80{,}000d^{17}`, exactValue: R`80{,}000d^{17}`, evidence: "Claimed", authors: ["EcoDataLab"], date: "2026-10-08", source: "https://github.com/EcoDataLab/contingency-tables/blob/fe72b20170e7f85e399368e56baf65b8782b4b50/README.md" } },
  { path: "/other/z-diophantine-in-q", title: "Z is Diophantine in Q", rankedQuantity: R`\text{number of variables}`, better: "Results rank by degree, then variables, then terms, then coefficient, each lower is better.", baseline: null,
    current: { bound: R`257\text{ variables}`, exactValue: "257", evidence: "Claimed", authors: ["Jose Brox"], date: "2026-11-16", source: "https://github.com/JoseBrox/diophantine-z-q_improvements" } },
  { path: "/other/catalan", title: "Catalan’s constant", rankedQuantity: R`\mu(G)`, better: "A lower value is better.", baseline: { kind: "OpenAI baseline", bound: R`\mu(G)\le +\infty` },
    current: { bound: R`\mu(G)\le 270`, exactValue: "270", evidence: "Claimed", authors: ["S. Litsey"], date: "2026-11-08", source: "https://github.com/slitsey/catalan-irrationality-measure",
      conditions: "AI disclosure: produced the mathematics, the Lean proofs and the text at the author's request: Claude Opus 5.5, Sonnet 5.5 and Haiku 5.5 (Anthropic) and GPT-6.1 Sol (OpenAI)." } },
  { path: "/other/../escape", title: "Escape", better: "A lower value is better.", current: { exactValue: "1", evidence: "Claimed" } },
  { path: "/3sum", title: "Not an other-bounds path", better: "A lower value is better." },
];
const knowledge = {
  updatedAt: "2026-11-25T00:22:56Z", pages,
  evidence: [
    { id: "claimed", name: "Claimed", definition: "The result is published, but no review repository accepted it and we have not checked a Lean proof." },
    { id: "human-verified", name: "Human Verified", definition: "The result meets the repository review rule stated on the problem page." },
    { id: "lean-verified", name: "Lean Verified", definition: "We rebuild its Lean proof from source and check, with the Lean kernel, that it proves our exact problem statement." },
    { id: "bogus", name: "<b>Bogus</b>", definition: "not a level" },
  ],
  otherBounds: { about: "Other bounds are results that improve a bound.", rows },
  contribute: {
    newResult: "Post a link to the public repository, commit or paper with the result in #submit-a-result on our Discord (https://discord.gg/JEN582WvNv). We list it as Claimed after we check that it states the same problem.",
    prove2me: { problems: ["/integer-multiplication", "/matrix-multiplication", "/3sum", "/apsp"], campaigns: [
      { problem: "/integer-multiplication", url: "https://prove2.me/campaigns/integer-multiplication-kappa" },
      { problem: "/matrix-multiplication", url: "https://prove2.me/campaigns/matmul-omega" },
      { problem: "/apsp", url: "https://evil.example/campaigns/apsp-exponent" },
    ], text: "An additional way for the problems listed here: prove the bound on prove2.me, which checks each proof with Lean on its server, in the campaign of the race." },
    leanProof: { problems: ["/exact-dft", "/3sum", "/apsp", "/subset-sum", "/3sat", "/directed-sssp"], repository: "https://github.com/bigospeedrun/verifier", instructions: "https://github.com/bigospeedrun/verifier#submit",
      text: "Submit the Lean proof to bigospeedrun/verifier as a pull request or an issue. It shows as Lean Verified when it passes." },
    reviewRepositories: "If a problem lists a repository with acceptsSubmissions true, also open a pull request there. Its maintainer reviews it.",
  },
  breakthrough: { name: "Agent breakthrough", definition: "The first result by AI agents that broke the classic bound. It starts the race." },
  problems,
};
const race = (path: string) => raceToProblem(problems.find((p) => p.path === path) as any, pages)!;

function mockSite(t: any, override?: (url: string) => Response | undefined) {
  const calls: { url: string; ua: string | null }[] = [];
  t.mock.method(globalThis, "fetch", async (input: any, init?: RequestInit) => {
    const url = String(input instanceof Request ? input.url : input);
    calls.push({ url, ua: new Headers(init?.headers).get("user-agent") });
    const o = override?.(url); if (o) return o;
    return url === "https://bigospeedrun.com/chat-knowledge.json" ? Response.json(knowledge) : new Response("not found", { status: 404 });
  });
  return calls;
}

test("exact scores read as numbers only when they are one number; LaTeX reads as plain text", () => {
  assert.equal(parseScore("1/2"), 0.5);
  assert.equal(parseScore("363005817/100000000000"), 0.00363005817);
  assert.equal(parseScore("-1/5"), -0.2);
  assert.equal(parseScore("9/4"), 2.25);
  assert.ok(Math.abs(parseScore("38964865893230436366153658480529544221/9913168046082531583689425721225195775330")! - 0.0039306169039) < 1e-12, "a 38-digit fraction");
  assert.equal(parseScore("2.13981"), 2.13981);
  assert.equal(parseScore(R`\tfrac{19}{27}`), 19 / 27);
  assert.equal(parseScore(R`\ge5.114935688794994675\cdot10^{-10}`), 5.114935688794994675e-10);
  assert.equal(parseScore(R`8\cdot4=32`), 32);
  for (const bad of ["n log^3/4 ; n log^11/12", R`80{,}000d^{17}`, "1/0", "0/0", "", "1e999", "Infinity", R`+\infty`, "1/2; DROP TABLE", 0.5, null]) assert.equal(parseScore(bad), undefined, String(bad));
  assert.equal(plainTex(R`O(n \log^{1-3.63005817\cdot 10^{\scriptstyle -3}} n)`), "O(n log^{1-3.63005817·10^{-3}} n)");
  assert.equal(plainTex(R`m \le n \log^{3/4} n:\ O(n \log^{11/12} n)`), "m ≤ n log^{3/4} n: O(n log^{11/12} n)");
  assert.equal(plainTex(R`B\text{ in }H_1\le B`), "B in H_1≤ B");
  assert.equal(plainTex(R`\mathrm{gap}^{-1}\le 98{,}560d^{126}`), "gap^{-1}≤ 98,560d^{126}");
});

test("each race page's own sentence gives the score's direction and name; two directions or none give nothing", () => {
  assert.deepEqual(scoreRule(pages["/integer-multiplication"]), { minimize: false, metricName: "saving in the logarithmic exponent κ", rule: "The bound has the form O(n log^{1-κ} n). κ is the saving in the logarithmic exponent; higher is better." });
  assert.equal(scoreRule(pages["/matrix-multiplication"])!.metricName, "arithmetic exponent t");
  assert.equal(scoreRule(pages["/matrix-multiplication"])!.minimize, true);
  assert.equal(scoreRule(pages["/3sat"])!.metricName, "exponent of log n in the denominator α");
  assert.equal(scoreRule(pages["/integer-factoring"])!.metricName, "score s");
  assert.equal(scoreRule(pages["/directed-sssp"])!.minimize, true);
  assert.equal(scoreRule(pages["/hostile"]), undefined, "both directions");
  assert.equal(scoreRule("No direction stated."), undefined);
  assert.equal(scoreRule(undefined), undefined);
});

test("an agent is attributed only where the site's text names one; company names and swarms are not agents", () => {
  const codex = agentFromText([["credit", imCube.credit]])!;
  assert.deepEqual({ ...codex, evidence: undefined }, { family: "openai", tool: "Codex", evidence: undefined, confidence: "high", role: "author" });
  assert.match(codex.evidence!, /^bigospeedrun\.com credit: ".*OpenAI Codex assisted\..*"$/);
  const vals = agentFromText([["authors", "Vals AI"], ["credit", sssp[0].credit]])!;
  assert.deepEqual([vals.family, vals.model, vals.tool, vals.confidence], ["anthropic", "Claude Opus 5.5", undefined, "medium"], "a model named without a tool is medium");
  const assistants = agentFromText([["credit", subsetClaim.credit]])!;
  assert.deepEqual([assistants.family, assistants.model], ["anthropic", undefined], "\"Claude\" alone names the family, not a model");
  const astra = agentFromText([["authors", "GPT-6 Astra (OpenAI), prompted by Romyar Sharifi"]])!;
  assert.deepEqual([astra.family, astra.model, astra.confidence], ["openai", "GPT-6 Astra", "medium"]);
  assert.equal(agentFromText([["credit", "Built with Claude Code and Claude Opus 5.5."]])!.tool, "Claude Code");
  assert.equal(agentFromText([["credit", "Built with Claude Code and Claude Opus 5.5."]])!.model, "Claude Opus 5.5");
  for (const text of [
    imOpenai.credit, imOpenai.method, factoring.method, "OpenAI", "Anthropic", "MultiAgency swarm", "Vals AI keeps the recursion of Ran Duan et al.",
    "Same model as this board.", "Claude Shannon's entropy bound.", "Google's tensor search", "A port of MultiAgency swarm's Lean Verified proof.",
  ]) assert.equal(agentFromText([["credit", text]]), undefined, text);
});

test("a race lists the leader at each evidence level, ranked by its exact score in the page's direction", () => {
  const im = race("/integer-multiplication");
  assert.equal(im.id, "integer-multiplication");
  assert.equal(im.group, "Races");
  assert.equal(im.metricName, "saving in the logarithmic exponent κ");
  assert.equal(im.metricDirection, "maximize");
  assert.equal(im.baseline, 0, "κ = 0 for the classic O(n log n)");
  assert.match(im.description!, /Classic bound: O\(n log n\)\. Ranked by the site's exact score: .*higher is better\..*current leader at each evidence level/);
  assert.deepEqual(im.records.map((r) => [r.contributor, r.value, r.isCurrentBest]), [["openai", 0.5, true], ["CubeJerry", 0.00363005817, false], ["CrocSwap", 0.00363005817, false], ["Swapnil-jain", 0.00003666565558019, false]]);
  const [lead, cube, , lean] = im.records;
  assert.equal(lead.date, "2026-11-25");
  assert.equal(lead.contributorUrl, "https://github.com/openai");
  assert.equal(lead.contributorKind, "person");
  assert.equal(lead.agent, undefined, "OpenAI's own paper names no agent");
  assert.match(lead.description!, /^Claimed · O\(n log\^\{1-0\.5\+ε\} n\) · exact score 1\/2 \(strict endpoint: the bound holds for every ε > 0, not at the endpoint\)/);
  assert.equal(lead.submissionUrls!.length, 2, "duplicate source URLs collapse");
  assert.match(cube.description!, /^Human Verified · .* · exact score 363005817\/100000000000 · 1 stated assumption · Jerry Jiaheng Chen composes/);
  assert.equal(cube.agent!.tool, "Codex");
  assert.match(lean.description!, /^Lean Verified/);
  assert.deepEqual(lean.submissionUrls, ["https://prove2.me/theorems/9963d73f-fab7-44ad-b490-192b4d9f47b1"]);

  const apsp = race("/apsp");
  assert.equal(apsp.metricDirection, "minimize");
  assert.equal(apsp.baseline, 3);
  assert.deepEqual(apsp.records.map((r) => [r.contributor, r.value, r.isCurrentBest]), [["JoshuaQFEX", 2.9929479187094, true], ["fringewidth", 2.99556071322466, false]], "a Claimed result can lead a Lean Verified one");
  assert.match(apsp.records[1].description!, /Ported by floration/);
  assert.match(race("/apsp/randomized-word-ram").description!, /also counts on this board/);

  const subset = race("/subset-sum");
  assert.equal(subset.baseline, 0.5);
  assert.equal(subset.records[1].value, 0.5);
  assert.equal(subset.records[1].isBaseline, false, "a Lean proof of the classic bound is still a result, not the baseline row");
  assert.equal(subset.records[0].agent!.family, "anthropic");
  assert.equal(subset.records[1].agent, undefined, "MultiAgency swarm names no model");

  const sat = race("/3sat");
  assert.deepEqual(sat.records.map((r) => [r.contributor, r.isCurrentBest]), [["openai", true], ["anthropics", true]], "a tie: both are the site's leaders, Lean Verified first");
  assert.equal(sat.baseline, 0);
  const fact = race("/integer-factoring");
  assert.equal(fact.baseline, -0.2, "time N^{1/5+o(1)} scores −1/5");
  assert.equal(fact.records[0].agent, undefined, "\"Anthropic's clique evaluator\" cites earlier work");
  assert.match(fact.records[0].description!, /factoring b-bit numbers takes time 2\^\{O\(b\/√\(log b\)\)\}/, "inline LaTeX reads as text");

  const mm = race("/matrix-multiplication");
  assert.equal(mm.metricDirection, "minimize");
  assert.equal(mm.baseline, 2.371177);
  assert.equal(mm.isOpen, false);
  assert.match(mm.description!, /^Race closed! \(Claimed\): OpenAI claims that t = 9\/4 is the best possible exponent\./);
  assert.equal(mm.records[0].date, "2026-10-06");
});

test("a race with no single number to rank shows the evidence level, and says so", () => {
  const p = race("/directed-sssp");
  assert.equal(p.metricName, "evidence level");
  assert.equal(p.metricDirection, "maximize");
  assert.equal(p.baseline, undefined);
  assert.match(p.description!, /No single number ranks this race here \(Lower is better\. A result is listed at every density.*\): each record's value is its evidence level \(1 Claimed, 2 Human Verified, 3 Lean Verified\), not its bound/);
  assert.deepEqual(p.records.map((r) => [r.contributor, r.value, r.isCurrentBest]), [["Vals AI", 3, true], ["darkhipo", 3, true], ["darkhipo", 1, false]], "the density-regime leaders all lead");
  assert.match(p.records[0].description!, /^Lean Verified · m ≤ n log\^\{3\/4\} n: O\(n log\^\{11\/12\} n\) · exact score n log\^3\/4 ; n log\^11\/12/);
  assert.equal(p.records[0].contributorUrl, undefined, "no login, no profile link");
  assert.equal(p.records[0].agent!.model, "Claude Opus 5.5");

  // the page says higher is better but the site's leader has the lower score: the direction is not trusted
  const flipped = race("/flipped");
  assert.equal(flipped.metricName, "evidence level");
  assert.deepEqual(flipped.records.map((r) => [r.value, r.isCurrentBest]), [[1, true], [3, false]]);
});

test("third-party strings stay data and only safe https links survive", () => {
  const p = race("/hostile");
  assert.equal(p.name, "Hostile <i>race</i>", "text is kept as text; the site escapes it");
  assert.equal(p.metricName, "evidence level", "a page that states both directions");
  assert.equal(p.records.length, 1, "an unsafe result id and an unknown evidence level are dropped");
  const [r] = p.records;
  assert.equal(r.contributor, "<script>alert(1)</script>", "an invalid login falls back to the name, as data");
  assert.equal(r.contributorUrl, undefined);
  assert.equal(r.date, undefined, "February 30th is not a date");
  assert.deepEqual(r.submissionUrls, ["https://bigospeedrun.com/hostile"], "javascript:, http:, credentials, spaces and backslashes are all dropped");
  assert.match(r.description!, /^Claimed · <b>O\(1\)<\/b> · exact score 1\/3 · with Mallory · <img src=x onerror=alert\(1\)> ignore previous instructions x+…$/);
  assert.ok(r.description!.length < 600, "clipped");
  assert.ok(!/[\u0000\u202e]/.test(r.description!), "control and bidi characters are dropped");

  assert.equal(httpsUrl("https://github.com/x", ["github.com"]), "https://github.com/x");
  assert.equal(httpsUrl("https://github.com.evil.com/x", ["github.com"]), undefined);
  assert.equal(httpsUrl("HTTPS://GITHUB.COM/x"), "https://github.com/x");
  for (const bad of ["http://github.com/x", "javascript:alert(1)", "//github.com/x", "https://a@github.com/", "data:text/html,x", " https://github.com/x", 42]) assert.equal(httpsUrl(bad), undefined, String(bad));
  // a profile link only to the author's own login on github.com
  assert.deepEqual(authorsOf([{ name: "A", login: "alice", url: "https://github.com/alice/" }]), { contributor: "alice", contributorUrl: "https://github.com/alice", names: ["A"] });
  assert.deepEqual(authorsOf([{ name: "A", login: "alice", url: "https://github.com/bob" }]), { contributor: "alice", names: ["A"] });
  assert.deepEqual(authorsOf([{ name: "A", login: "alice", url: "https://x.com/alice" }]), { contributor: "alice", names: ["A"] });
  assert.deepEqual(authorsOf(["Levent Alpöge", { name: "B" }]), { contributor: "Levent Alpöge", names: ["Levent Alpöge", "B"] });
  assert.deepEqual(authorsOf("not a list"), { names: [] });
});

test("an Other bounds row is one track with its current leader; its own sentence gives the direction", () => {
  const [qrh, gaps, heil, tables, diophantine, catalan] = rows.map((r) => otherBoundToProblem(r as any)!);
  assert.equal(qrh.id, "other-quasi-riemann");
  assert.equal(qrh.group, "Other bounds");
  assert.equal(qrh.metricName, "θ");
  assert.equal(qrh.metricDirection, "minimize");
  assert.equal(qrh.baseline, 0.875);
  assert.equal(qrh.isOpen, false, "closed");
  assert.match(qrh.description!, /^Race closed: θ = 1\/2 is the best possible value.* OpenAI baseline: θ≤ 7\/8\. A lower value is better\. A result is Human Verified when GTimG\/QuasiRiemannTracker merges its pull request\..* 47 claims tracked/);
  const [q] = qrh.records;
  assert.deepEqual([q.value, q.date, q.contributor, q.contributorUrl, q.isCurrentBest], [0.5, "2026-11-20", "Levent Alpöge", undefined, true]);
  assert.match(q.description!, /^Lean Verified · θ≤ 1\/2 · exact value 1\/2 · This row is Lean Verified/);
  assert.deepEqual(q.submissionUrls, ["https://alpo.ge/remark.pdf"]);
  assert.deepEqual([q.agent!.family, q.agent!.model, q.agent!.confidence], ["anthropic", undefined, "medium"]);
  assert.match(q.agent!.evidence!, /conditions: ".*working with Claude, discovered a proof/);

  assert.equal(gaps.baseline, 246);
  assert.equal(gaps.metricName, "B in H_1≤ B");
  assert.deepEqual([gaps.records[0].value, gaps.records[0].agent!.model, gaps.records[0].agent!.role], [182, "GPT-6 Astra", "author"]);
  assert.equal(heil.metricDirection, "maximize");
  assert.equal(heil.baseline, 3.17e-236);
  assert.equal(heil.records[0].value, 1.98281456939231e-8);
  assert.equal(heil.records[0].agent, undefined);
  for (const p of [tables, diophantine]) {
    assert.equal(p.metricName, "evidence level", p.id);
    assert.equal(p.baseline, undefined);
    assert.equal(p.records[0].value, 1);
    assert.match(p.description!, /No single number ranks this row here/);
  }
  assert.equal(catalan.baseline, undefined, "an infinite baseline is no number");
  assert.equal(catalan.records[0].agent!.model, "Claude Opus 5.5");
  assert.equal(otherBoundToProblem(rows[6] as any), undefined, "a path that escapes /other/");
  assert.equal(otherBoundToProblem(rows[7] as any), undefined, "a race path is not an Other bounds row");
  // a baseline is read only as "quantity ≤ number" for a lower-is-better row ("≥ / >" for higher), and never past the leader
  assert.equal(baselineValue(R`\theta\le 7/8`, true), 0.875);
  assert.equal(baselineValue(R`\theta\le 7/8`, false), undefined);
  assert.equal(baselineValue(R`\mathbb{E}[R]\ge 2^{-310}\mathbb{E}[\mathrm{OPT}]`, false), undefined);
  assert.equal(baselineValue(R`3n-o(n)`, false), undefined);
  assert.equal(otherBoundToProblem({ ...rows[1], baseline: { bound: R`H_1\le 100` } } as any)!.baseline, undefined, "a baseline better than the leader is a misread");
});

test("buildBigOSpeedrun reads the site's one JSON file and survives postprocess under the verifier's stable id", async (t) => {
  t.mock.method(console, "log", () => {});
  const calls = mockSite(t);
  const built = await buildBigOSpeedrun();
  assert.deepEqual(calls, [{ url: "https://bigospeedrun.com/chat-knowledge.json", ua: USER_AGENT }]);
  assert.deepEqual(built.problems.map((p) => p.id), [
    "integer-multiplication", "matrix-multiplication", "apsp", "apsp-randomized-word-ram", "subset-sum", "3sat", "integer-factoring", "directed-sssp", "flipped", "hostile",
    "other-quasi-riemann", "other-prime-gaps", "other-heilbronn-triangle", "other-contingency-tables", "other-z-diophantine-in-q", "other-catalan",
  ], "unsafe and duplicate paths are skipped");
  assert.match(built.description, /10 races \(Integer Multiplication, Matrix Multiplication, .*\) and 6 "Other bounds" rows\..*and 2 races also take proofs from prove2\.me campaigns\..*\(updated 2026-11-25\)/);
  const p = built.participation;
  assert.equal(p.compute, "cpu");
  assert.match(p.howToSubmit!, /^New results: Post a link .* #submit-a-result .* Lean proofs \(APSP, Subset Sum, 3-SAT, Directed Shortest Paths\): Submit the Lean proof .* when it passes \(instructions: https:\/\/github\.com\/bigospeedrun\/verifier#submit\)\. prove2\.me \(Integer Multiplication, Matrix Multiplication, APSP\): /);
  assert.match(p.verification!, /^Claimed: The result is published.* Human Verified: .* Lean Verified: We rebuild its Lean proof/);
  assert.doesNotMatch(p.verification!, /Bogus/);
  const links = Object.fromEntries(built.links.map((l) => [l.label, l.url]));
  assert.equal(links["Discord (#submit-a-result)"], "https://discord.gg/JEN582WvNv");
  assert.equal(links["Lean verifier (bigospeedrun/verifier)"], "https://github.com/bigospeedrun/verifier");
  assert.equal(links["prove2.me campaign: Matrix Multiplication"], "https://prove2.me/campaigns/matmul-omega");
  assert.equal(links["prove2.me campaign: APSP"], undefined, "a campaign link off prove2.me is dropped");

  const c = postprocess(built, repo);
  assert.equal(c.id, "bigospeedrun-verifier-d059f6016f1c0796", "the id the LLM entry was published under");
  assert.equal(c.id, competitionId(repo));
  assert.deepEqual(c.repo, { owner: "bigospeedrun", name: "verifier", branch: "main" });
  assert.equal(c.host, "website");
  assert.equal(c.domain, "formal-methods");
  const openaiRows = c.problems.flatMap((x) => x.records).filter((r) => r.contributor === "openai");
  assert.ok(openaiRows.length >= 3);
  assert.ok(openaiRows.every((r) => !r.agent), "an OpenAI account is a contributor, not a benchmarked model");
  assert.deepEqual(c.agentStats.map((a) => a.family).sort(), ["anthropic", "openai"]);
  assert.ok(c.agentStats.every((a) => a.records > 0));
  assert.equal(c.problems.find((x) => x.id === "matrix-multiplication")!.isOpen, false);
  assert.equal(c.problems.find((x) => x.id === "3sat")!.contested, true);
  assert.ok(c.participants.some((x) => x.name === "openai" && x.url === "https://github.com/openai"));
  assert.ok(c.problems.flatMap((x) => x.records).every((r) => !r.contributorUrl || /^https:\/\/github\.com\/[A-Za-z0-9-]+$/.test(r.contributorUrl)));
  assert.equal(c.status, "active");
});

test("buildBigOSpeedrun retries once, then fails with a generic error so the crawler keeps the previous entry", async (t) => {
  t.mock.method(console, "log", () => {});
  let n = 0;
  mockSite(t, () => (n++ === 0 ? new Response("SECRET busy", { status: 503 }) : undefined));
  assert.equal((await buildBigOSpeedrun()).problems.length, 16);
  mockSite(t, () => new Response("SECRET down", { status: 502 }));
  await assert.rejects(buildBigOSpeedrun(), (e: Error) => e.message === "Big O Speedrun download failed");
  mockSite(t, () => Response.json({ ...knowledge, problems: "none" }));
  await assert.rejects(buildBigOSpeedrun(), (e: Error) => e.message === "Big O Speedrun download failed");
  mockSite(t, () => Response.json({ ...knowledge, problems: [{ path: "/../x", name: "x" }] }));
  await assert.rejects(buildBigOSpeedrun(), (e: Error) => e.message === "Big O Speedrun download failed", "no valid race");
  // the file is ~170 KB: a body that keeps streaming past 4 MiB is cancelled, on both attempts
  let cancelled = 0;
  mockSite(t, () => new Response(new ReadableStream({ pull(c) { c.enqueue(new Uint8Array(1024 * 1024)); }, cancel() { cancelled++; } })));
  await assert.rejects(buildBigOSpeedrun(), (e: Error) => e.message === "Big O Speedrun download failed");
  assert.equal(cancelled, 2);
});

test("a row declared a person is not taken for a benchmarked model; an undeclared model name still is", () => {
  const base = { name: "x", problems: [{ id: "t", name: "t", metricName: "m", metricDirection: "maximize", records: [
    { value: 1, contributor: "openai", contributorKind: "person" },
    { value: 2, contributor: "econman-aristotle", contributorKind: "person" },
    { value: 3, contributor: "GPT-5 Pro" },
  ] }] };
  const [org, person, model] = postprocess(base, repo).problems[0].records.sort((a, b) => a.value - b.value);
  assert.equal(org.agent, undefined);
  assert.equal(person.agent, undefined);
  assert.deepEqual([model.contributorKind, model.agent!.family, model.agent!.role], ["model", "openai", "subject"]);
});
