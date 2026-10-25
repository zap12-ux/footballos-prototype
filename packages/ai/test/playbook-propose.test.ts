import { describe, expect, it } from "vitest";
import { ConceptKindSchema, ModelProvenanceSchema } from "@footballos/contracts";
import {
  AnthropicPageLabeler,
  JobBudget,
  NullLabeler,
  ProviderUnavailableError,
  guessKind,
  loadPrompt,
  proposeFromPages,
  validatePageResponse,
  type LabelPageInput,
  type LabelPageOutput,
  type PageLabeler,
  type ProposalPage,
} from "../src/index.js";
import { FakeTransport, makeMessage } from "./helpers.js";

/** Text in the shape of the Media team's generated fixture PDF (headings, numbered plays, a Terms page). */
const PAGE_1 = `Demo Playbook — Offense
Page 1

Run Game

Inside Zone Right
Zone step playside. Back aims at the playside A gap and reads the first down lineman.

Power
Down block, kick out the end, pull the backside guard.
`;
const PAGE_2 = `Pass Game
1. Smash Right — Hitch outside, corner from the slot.
2. Mesh: two shallow crossers under a dig.
3. Four Verticals
4) Boot Left
`;
const PAGE_3 = `Terms
Alert — A pre-snap check to a second play.
Kill: the quarterback cancels the first play and runs the second.
Bunch — Three receivers aligned within a yard of each other.
`;
const PAGE_4 = `Protections

Slide Left
Line slides to the left; back has the backside linebacker.
`;

const textPages: ProposalPage[] = [
  { pageNumber: 1, text: PAGE_1, textSource: "pdf_text", imagePath: null, width: 1224, height: 1584, ocrConfidence: null },
  { pageNumber: 2, text: PAGE_2, textSource: "pdf_text" },
  { pageNumber: 3, text: PAGE_3, textSource: "pdf_text" },
  { pageNumber: 4, text: PAGE_4, textSource: "pdf_text" },
];

class FakePageLabeler implements PageLabeler {
  readonly provider = "anthropic" as const;
  calls: LabelPageInput[] = [];
  constructor(private readonly respond: (input: LabelPageInput) => Omit<LabelPageOutput, "provenance"> | Error, private readonly available = true) {}
  isAvailable(): boolean {
    return this.available;
  }
  async labelPage(input: LabelPageInput): Promise<LabelPageOutput> {
    this.calls.push(input);
    const r = this.respond(input);
    if (r instanceof Error) throw r;
    return {
      ...r,
      provenance: {
        id: "11111111-1111-4111-8111-111111111111",
        provider: "anthropic",
        model: "claude-opus-5-5",
        modelRevision: null,
        promptId: "playbook-page.v1",
        promptHash: "a".repeat(64),
        preprocessing: { samplingFps: null, frameCount: 1, clipSec: null, resolution: "1224x1584" },
        inspected: { fromSec: 0, toSec: 0, frameTimestampsSec: [] },
        analysisVersion: "0.1.0",
        inputTokens: 1500,
        outputTokens: 120,
        costUsd: 0.0084,
        latencyMs: 900,
        requestedAt: "2026-10-25T15:00:00.000Z",
        completedAt: "2026-10-25T15:00:00.900Z",
      },
    };
  }
}

const fakeImage = async () => ({ base64: Buffer.from("png").toString("base64"), mediaType: "image/png" as const, width: 1224, height: 1584 });

describe("proposeFromPages — text heuristics", () => {
  it("turns headings and numbered plays into concepts with guessed kinds and page/excerpt sources", async () => {
    const r = await proposeFromPages(textPages);
    expect(r.basis).toBe("text");
    expect(r.provenance).toEqual([]);
    const byName = Object.fromEntries(r.concepts.map((c) => [c.name, c]));

    expect(byName["Inside Zone Right"]).toMatchObject({ kind: "run", basis: "text", sources: [{ pageNumber: 1, excerpt: "Inside Zone Right" }] });
    expect(byName["Inside Zone Right"]!.description).toContain("reads the first down lineman");
    expect(byName["Power"]).toMatchObject({ kind: "run" });
    expect(byName["Smash Right"]).toMatchObject({ kind: "pass", description: "Hitch outside, corner from the slot.", sources: [{ pageNumber: 2, excerpt: "1. Smash Right — Hitch outside, corner from the slot." }] });
    expect(byName["Mesh"]).toMatchObject({ kind: "pass", description: "two shallow crossers under a dig." });
    expect(byName["Four Verticals"]).toMatchObject({ kind: "pass" });
    // "Boot Left" has no pass keyword of its own; the "Pass Game" section supplies the kind.
    expect(byName["Boot Left"]).toMatchObject({ kind: "pass" });
    expect(byName["Slide Left"]).toMatchObject({ kind: "protection" });
    // Section headings and the document title are not concepts.
    expect(byName["Run Game"]).toBeUndefined();
    expect(byName["Pass Game"]).toBeUndefined();
    expect(byName["Protections"]).toBeUndefined();
    expect(byName["Terms"]).toBeUndefined();
    expect(byName["Page 1"]).toBeUndefined();
    for (const c of r.concepts) {
      expect(ConceptKindSchema.safeParse(c.kind).success).toBe(true);
      expect(c.note).toContain("not by a model");
    }
  });

  it('turns "Term — definition" and "Term: definition" lines into terms', async () => {
    const r = await proposeFromPages(textPages);
    const terms = Object.fromEntries(r.terms.map((t) => [t.term, t]));
    expect(terms["Alert"]).toMatchObject({ definition: "A pre-snap check to a second play.", basis: "text", sources: [{ pageNumber: 3, excerpt: "Alert — A pre-snap check to a second play." }] });
    expect(terms["Kill"]).toMatchObject({ definition: "the quarterback cancels the first play and runs the second." });
    expect(terms["Bunch"]).toMatchObject({ definition: "Three receivers aligned within a yard of each other." });
    // Term lines inside a Terms section never become concepts, even when they match a kind word.
    expect(r.concepts.find((c) => c.name === "Bunch")).toBeUndefined();
    expect(r.pages.find((p) => p.pageNumber === 3)).toMatchObject({ basis: "text", concepts: 0, terms: 3 });
  });

  it("merges the same concept found on two pages and keeps both sources", async () => {
    const r = await proposeFromPages([
      { pageNumber: 1, text: "Run Game\n\nInside Zone Right\nFront side combo.", textSource: "pdf_text" },
      { pageNumber: 5, text: "Install Day 2\n\n1. Inside Zone Right\n2. Counter", textSource: "pdf_text" },
    ]);
    const iz = r.concepts.find((c) => c.name === "Inside Zone Right")!;
    expect(iz.sources.map((s) => s.pageNumber)).toEqual([1, 5]);
    expect(iz.description).toBe("Front side combo.");
    expect(r.concepts.filter((c) => c.name.toLowerCase() === "inside zone right")).toHaveLength(1);
  });

  it("uses the team vocabulary over the defaults and falls back to 'other'", async () => {
    expect(guessKind("Zone Coverage Check")).toBe("coverage");
    expect(guessKind("Inside Zone")).toBe("run");
    expect(guessKind("Thunder")).toBe("other");
    expect(guessKind("Thunder", { custom: { pressure: ["thunder"] } })).toBe("pressure");
    const r = await proposeFromPages([{ pageNumber: 1, text: "Thunder\nSix-man pressure off the edge.", textSource: "pdf_text" }], { vocabulary: { pressure: ["Thunder"] } });
    expect(r.concepts[0]).toMatchObject({ name: "Thunder", kind: "pressure" });
  });

  it("proposes nothing from a page with empty text and says so; OCR text is flagged for verification", async () => {
    const r = await proposeFromPages([
      { pageNumber: 1, text: "", textSource: "pdf_text" },
      { pageNumber: 2, text: "Cover 3 Sky\nStrong safety rolls down.", textSource: "ocr", ocrConfidence: 0.81 },
    ]);
    expect(r.pages[0]).toMatchObject({ pageNumber: 1, basis: "none", concepts: 0, terms: 0 });
    expect(r.pages[0]!.note).toContain("not read");
    expect(r.concepts[0]).toMatchObject({ name: "Cover 3 Sky", kind: "coverage" });
    expect(r.concepts[0]!.note).toContain("OCR text (confidence 0.81)");
    expect(r.basis).toBe("text");
  });

  it("ignores document titles, install-day headings and schedule labels instead of proposing them", async () => {
    const r = await proposeFromPages([
      { pageNumber: 1, text: "Demo Playbook — Offense\nInstall Day 2\nWeek 3: at Demo High\n\nCounter\nBackside guard and tackle pull.", textSource: "pdf_text" },
    ]);
    expect(r.concepts.map((c) => c.name)).toEqual(["Counter"]);
    expect(r.terms).toEqual([]);
  });

  it("rejects malformed pages", async () => {
    await expect(proposeFromPages([{ pageNumber: 0, text: null, textSource: "none" }])).rejects.toThrow(/pageNumber/);
    await expect(proposeFromPages([{ pageNumber: 1, text: null, textSource: "none" }, { pageNumber: 1, text: null, textSource: "none" }])).rejects.toThrow(/duplicate/);
    await expect(proposeFromPages([{ pageNumber: 1, text: null, textSource: "scan" as never }])).rejects.toThrow(/textSource/);
  });
});

describe("proposeFromPages — image pages and the model path", () => {
  const imagePage: ProposalPage = { pageNumber: 2, text: null, textSource: "none", imagePath: "/nonexistent/page-2.png", width: 1224, height: 1584 };

  it("without a labeler, an image-only page yields nothing, basis 'none' and a note (never an invented play)", async () => {
    const r = await proposeFromPages([imagePage]);
    expect(r).toMatchObject({ concepts: [], terms: [], basis: "none", provenance: [] });
    expect(r.pages[0]!.note).toContain("no model configured");
  });

  it("with an unavailable labeler the page is skipped with a note and no call is made", async () => {
    const labeler = new FakePageLabeler(() => new Error("must not be called"), false);
    const r = await proposeFromPages([imagePage], { labeler, loadImage: fakeImage });
    expect(labeler.calls).toHaveLength(0);
    expect(r.basis).toBe("none");
    expect(r.pages[0]!.note).toContain("unavailable");
    const r2 = await proposeFromPages([imagePage], { labeler: new NullLabeler() as unknown as PageLabeler, loadImage: fakeImage });
    expect(r2.pages[0]!.basis).toBe("none");
  });

  it("with an available labeler the image is sent, proposals carry basis 'model' and page-only sources, provenance is recorded", async () => {
    const labeler = new FakePageLabeler(() => ({
      abstained: false,
      rationale: "Two play names printed above diagrams.",
      concepts: [{ name: "Counter Trey", kind: "run", description: "", confidence: "high" }, { name: "Y Cross", kind: "pass", description: "Y crosses at 12.", confidence: "medium" }],
      terms: [{ term: "Mike", definition: "The linebacker the protection counts from." }],
    }));
    const budget = new JobBudget(5);
    const r = await proposeFromPages([textPages[0]!, imagePage], { labeler, loadImage: fakeImage, vocabulary: { run: ["Counter Trey"] }, budget });
    expect(labeler.calls).toHaveLength(1);
    expect(labeler.calls[0]).toMatchObject({ pageNumber: 2, vocabulary: { run: ["Counter Trey"] }, budget });
    expect(labeler.calls[0]!.image.mediaType).toBe("image/png");

    const model = r.concepts.filter((c) => c.basis === "model");
    expect(model.map((c) => c.name)).toEqual(["Counter Trey", "Y Cross"]);
    for (const c of model) expect(c.sources).toEqual([{ pageNumber: 2, excerpt: null }]);
    expect(model[1]!.note).toContain("Legibility: medium");
    expect(r.terms.find((t) => t.term === "Mike")).toMatchObject({ basis: "model", sources: [{ pageNumber: 2, excerpt: null }] });
    expect(r.concepts.filter((c) => c.basis === "text").length).toBeGreaterThan(0);
    expect(r.basis).toBe("model");
    expect(r.provenance).toHaveLength(1);
    expect(ModelProvenanceSchema.safeParse(r.provenance[0]).success).toBe(true);
    expect(r.pages.find((p) => p.pageNumber === 2)).toMatchObject({ basis: "model", concepts: 2, terms: 1, abstained: false });
  });

  it("records an abstention as a page outcome with no proposals", async () => {
    const labeler = new FakePageLabeler(() => ({ abstained: true, rationale: "A diagram with no caption.", concepts: [], terms: [] }));
    const r = await proposeFromPages([imagePage], { labeler, loadImage: fakeImage });
    expect(r.concepts).toEqual([]);
    expect(r.basis).toBe("none");
    expect(r.provenance).toHaveLength(1);
    expect(r.pages[0]).toMatchObject({ basis: "model", abstained: true });
    expect(r.pages[0]!.note).toContain("A diagram with no caption.");
  });

  it("a page-local provider error skips that page; a budget error stops further calls", async () => {
    let n = 0;
    const labeler = new FakePageLabeler(() => {
      n++;
      if (n === 1) return new ProviderUnavailableError({ provider: "anthropic", reason: "invalid_model_output", retryable: true, message: "bad json" });
      if (n === 2) return new ProviderUnavailableError({ provider: "anthropic", reason: "budget_exceeded", retryable: false, message: "over budget" });
      return { abstained: false, rationale: "x", concepts: [{ name: "Never", kind: "other", description: "", confidence: "high" }], terms: [] };
    });
    const pages: ProposalPage[] = [2, 3, 4].map((p) => ({ pageNumber: p, text: null, textSource: "none" }));
    const r = await proposeFromPages(pages, { labeler, loadImage: fakeImage });
    expect(labeler.calls.map((c) => c.pageNumber)).toEqual([2, 3]);
    expect(r.concepts).toEqual([]);
    expect(r.pages.map((p) => p.note)).toEqual([expect.stringContaining("invalid_model_output"), expect.stringContaining("budget_exceeded"), expect.stringContaining("not sent to the model")]);
  });

  it("an unreadable page image is reported, not guessed", async () => {
    const labeler = new FakePageLabeler(() => new Error("must not be called"));
    const r = await proposeFromPages([imagePage], { labeler });
    expect(labeler.calls).toHaveLength(0);
    expect(r.pages[0]!.note).toContain("could not be read");
  });
});

describe("validatePageResponse", () => {
  it("rejects an abstention with proposals, an empty name, a term without definition, and silence without abstention", () => {
    expect(() => validatePageResponse({ abstained: true, rationale: "", concepts: [{ name: "X", kind: "run", description: "", confidence: "high" }], terms: [] }, "anthropic")).toThrow(/abstained/);
    expect(() => validatePageResponse({ abstained: false, rationale: "", concepts: [{ name: "  ", kind: "run", description: "", confidence: "high" }], terms: [] }, "anthropic")).toThrow(/length 0/);
    expect(() => validatePageResponse({ abstained: false, rationale: "", concepts: [], terms: [{ term: "Mike", definition: "" }] }, "anthropic")).toThrow(/without a definition/);
    expect(() => validatePageResponse({ abstained: false, rationale: "", concepts: [], terms: [] }, "anthropic")).toThrow(/without marking/);
    expect(() => validatePageResponse({ abstained: false, rationale: "", concepts: [{ name: "X", kind: "screen", description: "", confidence: "high" }], terms: [] }, "anthropic")).toThrow(/schema/);
  });
});

describe("AnthropicPageLabeler with a fake transport", () => {
  const input: LabelPageInput = { pageNumber: 7, image: { base64: Buffer.from("png").toString("base64"), mediaType: "image/png", width: 1224, height: 1584 }, vocabulary: { run: ["Counter Trey"] } };

  it("sends one image with the versioned prompt and schema, returns proposals and provenance from real usage", async () => {
    const transport = new FakeTransport(() => makeMessage({ abstained: false, rationale: "Legible.", concepts: [{ name: "Counter Trey", kind: "run", description: "", confidence: "high" }], terms: [] }));
    let tick = 0;
    const labeler = new AnthropicPageLabeler({ transport, now: () => new Date(1_700_000_000_000 + 400 * tick++) });
    expect(labeler.isAvailable()).toBe(true);
    const out = await labeler.labelPage(input);

    const params = transport.calls[0]!;
    expect(params.output_config?.format).toEqual({ type: "json_schema", schema: expect.objectContaining({ required: ["abstained", "rationale", "concepts", "terms"] }) });
    const system = params.system as { text: string }[];
    expect(system[0]!.text).toBe(loadPrompt("playbook-page", 1).text);
    const content = params.messages[0]!.content as { type: string; text?: string }[];
    expect(content.filter((b) => b.type === "image")).toHaveLength(1);
    expect(content.at(-1)!.text).toContain('<team_vocabulary untrusted="true">');
    expect(content.at(-1)!.text).toContain('"Counter Trey"');

    expect(out.abstained).toBe(false);
    expect(out.concepts).toEqual([{ name: "Counter Trey", kind: "run", description: "", confidence: "high" }]);
    expect(out.provenance.promptId).toBe("playbook-page.v1");
    expect(out.provenance.promptHash).toBe(loadPrompt("playbook-page", 1).hash);
    expect(out.provenance.preprocessing).toEqual({ samplingFps: null, frameCount: 1, clipSec: null, resolution: "1224x1584" });
    expect(out.provenance.inputTokens).toBe(9500);
    expect(out.provenance.costUsd).toBeCloseTo(0.0445, 6);
    expect(out.provenance.latencyMs).toBe(400);
    expect(ModelProvenanceSchema.safeParse(out.provenance).success).toBe(true);
    expect(labeler.jobBudget.callCount).toBe(1);
  });

  it("without a key it is unavailable and throws provider_unavailable(no_api_key) without calling anything", async () => {
    const labeler = new AnthropicPageLabeler({ apiKey: null, env: {} });
    expect(labeler.isAvailable()).toBe(false);
    await expect(labeler.labelPage(input)).rejects.toMatchObject({ code: "provider_unavailable", reason: "no_api_key" });
  });

  it("maps refusal, invalid JSON and an over-budget estimate to provider_unavailable", async () => {
    await expect(new AnthropicPageLabeler({ transport: new FakeTransport(() => makeMessage("{}", { stop_reason: "refusal" })) }).labelPage(input)).rejects.toMatchObject({ reason: "refusal" });
    await expect(new AnthropicPageLabeler({ transport: new FakeTransport(() => makeMessage("not json")) }).labelPage(input)).rejects.toMatchObject({ reason: "invalid_model_output" });
    const transport = new FakeTransport(() => makeMessage("{}"));
    await expect(new AnthropicPageLabeler({ transport, budget: new JobBudget(0.0001) }).labelPage(input)).rejects.toMatchObject({ reason: "budget_exceeded" });
    expect(transport.calls).toHaveLength(0);
  });
});
