// The domain list, in one place: the crawler's prompt, validation, the problem.md standard and the MCP tool read it;
// site/app.js keeps a twin of DOMAIN_LABELS (tests/domains.test.ts holds them together).

export const DOMAINS = ["formal-methods", "llm-eval", "coding-agents", "ml-research", "robotics", "cybersecurity", "firmware", "chip-design", "other"] as const;
export type Domain = (typeof DOMAINS)[number];

export const DOMAIN_LABELS: Record<Domain, string> = {
  "formal-methods": "Formal methods", "llm-eval": "LLM eval", "coding-agents": "Coding agents", "ml-research": "ML research", robotics: "Robotics",
  cybersecurity: "Cybersecurity", firmware: "Firmware", "chip-design": "Chip design", other: "Other",
};

// What belongs where; the crawler's prompt quotes these so a re-extraction files a board the same way
export const DOMAIN_SCOPE: Record<Domain, string> = {
  "formal-methods": "machine-checked proofs (Lean, Coq, Isabelle, HOL Light), verified bounds, theorem proving",
  "llm-eval": "evaluating models or agents on knowledge, reasoning, judgement, forecasting or safety",
  "coding-agents": "software engineering: resolve issues, build programs, write or speed up code, GPU kernels and performance patches included",
  "ml-research": "training, fine-tuning, architectures, training speedruns, datasets, ML for science",
  robotics: "embodied control: locomotion, manipulation, navigation, in simulation or on hardware",
  cybersecurity: "CTFs; finding, exploiting or patching vulnerabilities; red-teaming and prompt injection; malware and intrusion detection",
  firmware: "embedded software on microcontrollers and devices: drivers, bootloaders, RTOS, firmware reverse engineering",
  "chip-design": "RTL and HDL (Verilog, VHDL, Chisel), logic synthesis, place and route, FPGA, ASIC and accelerator design",
  other: "anything else",
};

// Retired names that older data, an organizer's PROBLEM.md or a run started before the rename may still carry
const RETIRED: Record<string, (tags: string[]) => Domain> = {
  security: () => "cybersecurity",
  "hardware-efficiency": fromTags,
  "systems-perf": fromTags,
};
function fromTags(tags: string[]): Domain {
  const t = tags.join(" ").toLowerCase();
  if (/\b(rtl|asic|fpga|verilog|vhdl|hdl|eda|silicon|logic-synthesis)\b/.test(t)) return "chip-design";
  if (/\b(firmware|embedded|microcontroller|mcu|rtos|bootloader)\b/.test(t)) return "firmware";
  if (/\b(speedrun|pretraining|llm-training)\b/.test(t)) return "ml-research";
  return "coding-agents"; // kernels, energy-efficient programs, performance patches
}

/** The current name for a domain value; anything that is not a retired name comes back unchanged. */
export function currentDomain(domain: unknown, tags: unknown = []): unknown {
  if (typeof domain !== "string" || !Object.hasOwn(RETIRED, domain)) return domain;
  return RETIRED[domain](Array.isArray(tags) ? tags.filter((t): t is string => typeof t === "string") : []);
}
