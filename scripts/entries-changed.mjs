// Exit 0 when data/competitions.json has new or changed entries compared with HEAD, 1 when only timestamps moved.
// The live refresh commits (and so redeploys) only when there is something new to show.
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";

const strip = (d) => JSON.stringify(d.competitions.map(({ lastUpdated, stats, participants, ...c }) => c));
const now = JSON.parse(readFileSync("data/competitions.json", "utf-8"));
const before = JSON.parse(execFileSync("git", ["show", "HEAD:data/competitions.json"], { encoding: "utf-8", maxBuffer: 64 * 1024 * 1024 }));
process.exit(strip(now) === strip(before) ? 1 : 0);
