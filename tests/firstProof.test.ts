import assert from "node:assert/strict";
import { test } from "node:test";
import { gzipSync } from "node:zlib";
import { buildFirstProof, parseFeed, parseReport, texFromSource, detex, parsePending, PASS_MARK } from "../src/structured/firstProof.js";
import { postprocess } from "../src/postprocess.js";
import { openProblems } from "../src/aggregate.js";

const repo = { owner: "1stproof", name: "batch-2", url: "https://github.com/1stproof/batch-2", defaultBranch: "main", stars: 0, topics: [] };

// Same shapes as arXiv:2606.18119 (First Proof Second Batch), cut down to three problems and three systems
const TEX = String.raw`\documentclass{article}
\newcommand{\editorialdecision}[1]{{Editorial Decision:} #1}
\title{First Proof Second Batch}
\date{June 10, 2026}
\begin{document}
\section{Problems}
\subsection{Problem 1: Aleksa Milojevi\'c and Benny Sudakov (discrete probability)}
Statement.
\subsection{Problem 2:
Oleg Butkovsky,
Jonathan C. Mattingly, and
Lorenzo Zambotti (stochastic PDE)}
\subsection{Problem 3: Sam Payne and Jidong (Jayden) Wang (matroids and tropical geometry)}
\section{AI Systems Tested}
\subsection{System A: IMProofBench ProofCouncil}
The system primarily used \texttt{gpt-5.5 pro} as its base model, though it also called \texttt{claude-opus-4-7}.
Source: \href{https://github.com/1stproof/batch-2/tree/main/batch-2-submissions/improofbench}{\texttt{batch-2-submissions/improofbench}}.
\subsection{System B: OpenAI ChatGPT 5.5 Pro}
A product, prompted by hand.
\subsection{System C: Princeton Momus}
Used \texttt{gemini-3.1-pro-preview}.
\section{Results and Costs}
\begin{tabular}{c ccc}
 & System A & System B & System C \\
P1 & \cell{res:P1A}{\Ess\MinC} & \cell{res:P1B}{\Rej} & \cell{res:P1C}{\Rej} \\
\end{tabular}
\begin{tabular}{l rrr rrr rrr}
 & \multicolumn{3}{c}{System A} & \multicolumn{3}{c}{System B} & \multicolumn{3}{c}{System C} \\
Prob. & In & Out & \$ & In & Out & \$ & In & Out & \$ \\
\midrule
P1 & 0.22 & 0.24 & 49 & 0.11 & 0.05 & 13 & 6.03 & 10.84 & 142 \\
P2 & -- & -- & -- & 0.10 & 0.05 & 12 & 3.37 & 6.54 & 85 \\
P3 & 105.49 & 4.91 & 1712 & 0.15 & 0.06 & 16 & 2.85 & 6.17 & 80 \\
\midrule
\textbf{Total} & 105.71 & 5.15 & 1761 & 0.36 & 0.16 & 41 & 12.25 & 23.55 & 307 \\
\midrule
\textbf{Wall clock} & \multicolumn{3}{c}{22.9\,h} & \multicolumn{3}{c}{5.8\,h\footnotemark} & \multicolumn{3}{c}{7.8\,h} \\
\end{tabular}
\subsection{Problem 1}
\paragraph{Submission A.}\label{res:P1A}
\editorialdecision{Minor Revisions.}
One reviewer felt it was essentially flawless.
\paragraph{Submission B.}\label{res:P1B}
\editorialdecision{Reject.}
\paragraph{Submission C.}\label{res:P1C}\editorialdecision{Reject.}
\subsection{Problem 2}
\paragraph{Submission A.}\label{res:P2A} No submission.
\paragraph{Submission B.}
\editorialdecision{Essentially Flawless.}
\paragraph{Submission C.}
\editorialdecision{Essentially Flawless.}
\subsection{Problem 3}
\paragraph{Submission A.}
\editorialdecision{Reject.}
\paragraph{Submission B.}
\editorialdecision{Major Revisions.}
\paragraph{Submission C.}
\editorialdecision{Reject.}
\section{Supplementary documents}
All files: \href{https://github.com/1stproof/batch-2}{1stproof/batch-2}.
\end{document}`;

const FEED = `<?xml version="1.0"?><feed>
<entry><id>http://arxiv.org/abs/2602.05192v2</id><title>First Proof</title><published>2026-02-05T00:00:00Z</published></entry>
<entry><id>http://arxiv.org/abs/2602.13587v1</id><title>A First Proof Sprint</title></entry>
<entry><id>http://arxiv.org/abs/2606.18119v1</id><title>First Proof
  Second Batch</title><published>2026-06-16T00:00:00Z</published></entry>
<entry><id>http://arxiv.org/abs/2610.00001v1</id><title>First Proof Third Batch</title><published>2026-10-15T00:00:00Z</published></entry>
</feed>`;

function tar(files: Record<string, string>): Buffer {
  const blocks: Buffer[] = [];
  for (const [name, text] of Object.entries(files)) {
    const body = Buffer.from(text), h = Buffer.alloc(512);
    h.write(name, 0); h.write(body.length.toString(8).padStart(11, "0"), 124); h.write("0", 156); h.write("ustar", 257);
    blocks.push(h, body, Buffer.alloc((512 - (body.length % 512)) % 512));
  }
  return Buffer.concat([...blocks, Buffer.alloc(1024)]);
}

const tree = ["batch-2-AI-solutions/problem-01/submission-A.pdf", "batch-2-AI-solutions/problem-01/submission-B.pdf", "batch-2-reviews/problem-01/submission-A/submission-1A-reviews.pdf", "batch-2-AI-solutions/problem-03/submission-B.pdf"];
function mockSources(t: any, opts: { thirdSource?: string; feed?: Response } = {}) {
  const calls: string[] = [];
  t.mock.method(globalThis, "fetch", async (input: any) => {
    const url = String(input instanceof Request ? input.url : input);
    calls.push(url);
    if (url.startsWith("https://export.arxiv.org/api/query")) return opts.feed ?? new Response(FEED, { headers: { "content-type": "application/atom+xml" } });
    if (url === "https://arxiv.org/src/2606.18119") return new Response(gzipSync(tar({ "main.tex": TEX, "notes.txt": "ignored" })));
    if (url === "https://arxiv.org/src/2610.00001") return new Response(gzipSync(opts.thirdSource ?? "\\title{First Proof Third Batch} \\subsection{Problem 1} \\paragraph{Submission A.} \\editorialdecision{Reject.}"));
    if (url.endsWith("/repos/1stproof/batch-2")) return Response.json({ private: false, visibility: "public", default_branch: "main" });
    if (url.includes("/repos/1stproof/batch-2/git/trees/main")) return Response.json({ tree: tree.map((path) => ({ path, type: "blob" })), truncated: false });
    if (url === "https://1stproof.org/") return new Response('<a href="second-batch.html">Second Batch</a> <a href="third-batch.html">Third Batch</a> <a href="first-batch.html">Past</a>');
    if (url === "https://1stproof.org/third-batch.html") return new Response("<p>fill in this <a>form</a> by <strong>September 10, 2026</strong>.</p><p>Results will be published on October 14, 2026.</p>");
    return new Response("not found", { status: 404 });
  });
  return calls;
}

test("parseFeed keeps graded batch reports and the batch 1 paper, nothing that merely mentions First Proof", () => {
  const { reports, paper } = parseFeed(FEED);
  assert.equal(paper, "2602.05192");
  assert.deepEqual(reports.map((r) => [r.batch, r.id]), [[2, "2606.18119"], [3, "2610.00001"]]);
});

test("parseReport reads systems, problems, editorial decisions and the cost table from the LaTeX source", () => {
  const r = parseReport(texFromSource(gzipSync(tar({ "main.tex": TEX }))));
  assert.equal(r.title, "First Proof Second Batch");
  assert.equal(r.date, "2026-06-10");
  assert.deepEqual(r.systems.map((s) => [s.letter, s.name, s.models.join(","), s.cost, s.wallClock]), [
    ["A", "IMProofBench ProofCouncil", "gpt-5.5 pro,claude-opus-4-7", 1761, "22.9 h"],
    ["B", "OpenAI ChatGPT 5.5 Pro", "", 41, "5.8 h"],
    ["C", "Princeton Momus", "gemini-3.1-pro-preview", 307, "7.8 h"],
  ]);
  assert.equal(r.systems[0].url, "https://github.com/1stproof/batch-2/tree/main/batch-2-submissions/improofbench");
  assert.deepEqual(r.problems.map((p) => [p.n, p.field, p.authors]), [
    [1, "Discrete probability", "Aleksa Milojević, Benny Sudakov"],
    [2, "Stochastic PDE", "Oleg Butkovsky, Jonathan C. Mattingly, Lorenzo Zambotti"],
    [3, "Matroids and tropical geometry", "Sam Payne, Jidong (Jayden) Wang"],
  ]);
  assert.deepEqual(r.problems.map((p) => p.decisions), [{ A: "minor", B: "reject", C: "reject" }, { A: undefined, B: "flawless", C: "flawless" }, { A: "reject", B: "major", C: "reject" }]);
  assert.deepEqual(r.problems.map((p) => p.cost), [{ A: 49, B: 13, C: 142 }, { A: undefined, B: 12, C: 85 }, { A: 1712, B: 16, C: 80 }], "the decision grid (also P-rows) is not mistaken for costs");
  assert.equal(texFromSource(gzipSync("plain \\title{x}")), "plain \\title{x}", "a single gzipped .tex works too");
  assert.equal(detex("Milojevi\\'c \\v{S}ar\\'ik --- \\textbf{x}"), "Milojević Šarík — x");
});

test("parsePending reads the application deadline and the results date from a batch page", () => {
  assert.deepEqual(parsePending("by <b>September 10, 2026</b>. Results will be published on October 14, 2026.", 3, "u"), { batch: 3, url: "u", deadline: "2026-09-10", results: "2026-10-14" });
});

test("buildFirstProof assembles every graded batch from arXiv + GitHub + 1stproof.org, and skips reports that are not the project's", async (t) => {
  t.mock.method(console, "log", () => {});
  mockSources(t);
  const c = postprocess(await buildFirstProof(), repo);
  assert.equal(c.host, "website");
  assert.equal(c.status, "active");
  assert.deepEqual(c.problems.map((p) => p.id), ["b2-p03", "b2-systems", "b2-p01", "b2-p02"], "open tracks lead; a major-revisions proof does not close a problem");
  assert.ok(c.problems.filter((p) => p.id !== "b2-systems").every((p) => p.passMark === PASS_MARK));
  const systems = c.problems.find((p) => p.id === "b2-systems")!;
  assert.deepEqual(systems.records.map((r) => [r.contributor, r.value]), [["IMProofBench ProofCouncil", 2], ["OpenAI ChatGPT 5.5 Pro", 4], ["Princeton Momus", 3]]);
  assert.deepEqual(systems.records.filter((r) => r.isCurrentBest).map((r) => r.contributor), ["OpenAI ChatGPT 5.5 Pro"]);
  assert.equal(systems.records[0].description, "System A · 1/3 passed (1 minor, 1 reject, 1 missing) · $1,761 API, 22.9 h · gpt-5.5 pro, claude-opus-4-7");

  const p1 = c.problems.find((p) => p.id === "b2-p01")!;
  assert.deepEqual(p1.records.find((r) => r.contributor === "IMProofBench ProofCouncil")!.submissionUrls, [
    "https://github.com/1stproof/batch-2/blob/main/batch-2-AI-solutions/problem-01/submission-A.pdf",
    "https://github.com/1stproof/batch-2/blob/main/batch-2-reviews/problem-01/submission-A/submission-1A-reviews.pdf",
  ]);
  assert.deepEqual(p1.records.find((r) => r.contributor === "Princeton Momus")!.submissionUrls, ["https://arxiv.org/abs/2606.18119"], "a file missing from the repo tree is never guessed");
  assert.equal(c.problems.find((p) => p.id === "b2-p02")!.records.some((r) => r.contributor === "IMProofBench ProofCouncil"), false, "no solution, no row");
  assert.match(c.problems.find((p) => p.id === "b2-p02")!.description!, /System A: no solution/);

  assert.ok(c.problems.every((p) => p.records.every((r) => r.agent?.role === "subject")));
  assert.deepEqual(c.problems[0].records.map((r) => r.agent!.family), ["openai", "openai", "google"]);
  assert.deepEqual(c.agentStats, []);
  assert.equal(openProblems([c]).find((o) => o.problemId === "b2-p03")?.passMark, PASS_MARK);
  assert.match(c.participation.deadline!, /Batch 3: applications until 2026-09-10; results 2026-10-14/);
  assert.ok(c.links.some((l) => l.url === "https://arxiv.org/abs/2602.05192"));
});

test("a new batch report on arXiv appears as its own group, newest first, with no code change", async (t) => {
  t.mock.method(console, "log", () => {});
  const third = TEX.replace("Second Batch", "Third Batch").replace("June 10, 2026", "October 14, 2026");
  mockSources(t, { thirdSource: third });
  const c = postprocess(await buildFirstProof(), repo);
  assert.deepEqual([...new Set(c.problems.map((p) => p.group))], ["batch-3", "batch-2"]);
  assert.ok(c.problems.some((p) => p.id === "b3-systems"));
  assert.ok(c.problems.filter((p) => p.group === "batch-3").every((p) => p.records.every((r) => r.date === "2026-10-14")));
  assert.match(c.description, /Batch 3 \(2026-10-14\)/);
});

test("arXiv unavailable: the build fails with a generic error, so the crawler keeps the previous entry", async (t) => {
  t.mock.method(console, "log", () => {});
  mockSources(t, { feed: new Response("SECRET upstream", { status: 503 }) });
  await assert.rejects(buildFirstProof(), /^Error: First Proof download failed$/);
});
