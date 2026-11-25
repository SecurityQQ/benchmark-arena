// Checked corrections: facts verified against an organizer's own rules, applied over the crawled data at build time.
// The LLM extraction defaults an unknown deadline to "rolling"; a competition that closed months ago then reads as
// "active" and agents get sent to it. Each correction names its source and the day it was checked, and lives outside
// data/competitions.json so the next crawl cannot quietly undo it.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { Competition } from "./types.js";

export interface Correction {
  id: string;                     // a listed competition
  status?: Competition["status"];
  deadline?: string;
  delist?: string;                // reason it is not a challenge anyone can enter; the listing is dropped
  source: string;                 // https URL of the organizer's page that states it
  checked: string;                // YYYY-MM-DD
}

const STATUSES = new Set(["active", "upcoming", "ended", "unknown"]);

export function validCorrections(raw: unknown, competitionIds: Set<string>): Correction[] {
  const list = Array.isArray((raw as { corrections?: unknown })?.corrections) ? (raw as { corrections: unknown[] }).corrections : [];
  const out: Correction[] = [];
  for (const c of list as Record<string, unknown>[]) {
    if (typeof c?.id !== "string" || !competitionIds.has(c.id)) continue;
    if (typeof c.source !== "string" || !/^https:\/\/\S+$/.test(c.source)) continue;
    if (typeof c.checked !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(c.checked)) continue;
    const status = typeof c.status === "string" && STATUSES.has(c.status) ? (c.status as Competition["status"]) : undefined;
    const deadline = typeof c.deadline === "string" && c.deadline.trim() ? c.deadline.trim().slice(0, 200) : undefined;
    const delist = typeof c.delist === "string" && c.delist.trim() ? c.delist.trim().slice(0, 200) : undefined;
    if (!status && !deadline && !delist) continue;
    out.push({ id: c.id, source: c.source, checked: c.checked, ...(status ? { status } : {}), ...(deadline ? { deadline } : {}), ...(delist ? { delist } : {}) });
  }
  return out;
}

export function loadCorrections(root: string, competitionIds: Set<string>): Correction[] {
  const path = join(root, "data", "corrections.json");
  return existsSync(path) ? validCorrections(JSON.parse(readFileSync(path, "utf-8")), competitionIds) : [];
}

export function applyCorrections(comps: Competition[], corrections: Correction[]): Competition[] {
  const byId = new Map(corrections.map((c) => [c.id, c]));
  return comps.filter((c) => !byId.get(c.id)?.delist).map((c) => {
    const fix = byId.get(c.id);
    if (!fix) return c;
    return {
      ...c,
      ...(fix.status ? { status: fix.status } : {}),
      participation: { ...c.participation, ...(fix.deadline ? { deadline: fix.deadline } : {}) },
      links: [...c.links, { label: `Checked ${fix.checked}: ${[fix.status, fix.deadline].filter(Boolean).join(", ")}`, url: fix.source }],
    };
  });
}
