import { describe, expect, it } from "vitest";
import { DescriptionEngine, type ModelProvider, type PromptPart } from "../src/ai/engine";
import { SensitiveMasker } from "../src/ai/sensitive";
import type { CuePlan, SceneNote } from "../src/core/types";

const RECORD = "FICTIONAL TEST RECORD Patient: Jane Example Date of birth: 01/02/1980 Account 0000-1111";

describe("masking personal-looking data", () => {
  it("masks a labelled name, a date and an account number, and restores them", () => {
    const m = new SensitiveMasker();
    const masked = m.mask(RECORD);
    for (const s of ["Jane Example", "01/02/1980", "0000-1111"]) expect(masked).not.toContain(s);
    expect(masked).toContain("Patient: [[NAME_");
    expect(m.count).toBe(3);
    expect(m.restore(masked)).toBe(RECORD);
  });

  it("masks e-mails and phone numbers", () => {
    const m = new SensitiveMasker();
    const masked = m.mask("Write to ana.diaz@example.org or call +34 600 123 456.");
    expect(masked).not.toMatch(/example\.org|600 123 456/);
    expect(m.count).toBe(2);
  });

  it("keeps the numbers a description needs", () => {
    const m = new SensitiveMasker();
    const text = "TOTAL 9.00 GiB, context = 32,768 tokens, sales up 42 percent in 2026, 6.18 GiB";
    expect(m.mask(text)).toBe(text);
    expect(m.count).toBe(0);
  });

  it("reuses one token for a repeated value and leaves unknown tokens alone", () => {
    const m = new SensitiveMasker();
    expect(m.mask("01/02/1980 and 01/02/1980")).toBe("[[DATE_1]] and [[DATE_1]]");
    expect(m.restore("[[DATE_1]] [[NAME_9]]")).toBe("01/02/1980 [[NAME_9]]");
  });
});

describe("hybrid requests that may reach the cloud", () => {
  const sent: string[] = [];
  const provider: ModelProvider = {
    model: (task) => ({
      generate: async (parts: PromptPart[]) => {
        const text = parts.map((p) => (p.type === "text" ? p.text : "")).join(" ");
        sent.push(text);
        if (task === "script") {
          const tokens = text.match(/\[\[(NAME|DATE|NUMBER)_\d\]\]/g) ?? [];
          return { text: JSON.stringify({ cues: [{ id: "s1", text: `A record for ${[...new Set(tokens)].join(", ")}.` }] }), source: "in_cloud" as const };
        }
        return { text: "{\"text\":\"A record.\"}", source: "on_device" as const };
      },
    }),
    deviceAvailability: async () => "available",
    prepareDevice: async () => {},
  };
  const plans: CuePlan[] = [{ sceneId: "s1", start: 0, end: 8, budgetWords: 20, extended: false }];
  const notes = new Map<string, SceneNote>([["s1", { sceneId: "s1", visual: "A cream document.", onScreenText: RECORD, source: "on_device" }]]);

  it("sends no personal-looking value in the script request and restores it in the line", async () => {
    sent.length = 0;
    const e = new DescriptionEngine(provider, { mode: "hybrid", language: "en", frameMaxWords: 30 });
    await e.startVideo();
    const cues = await e.writeTrack(plans, notes);
    for (const s of ["Jane Example", "01/02/1980", "0000-1111"]) {
      expect(sent.join(" ")).not.toContain(s);
      expect(cues[0].text).toContain(s);
    }
    expect(e.ledger.masked).toBe(3);
  });

  it("masks nothing in private mode, where no request leaves the device", async () => {
    const e = new DescriptionEngine(provider, { mode: "private", language: "en", frameMaxWords: 30 });
    await e.startVideo();
    await e.writeTrack(plans, notes);
    expect(e.ledger.masked).toBe(0);
  });
});
