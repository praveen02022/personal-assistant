import { describe, expect, it } from "vitest";
import { buildSsml, escapeXml } from "../src/voice/providers/azure-speech.js";
import { detectSpeechLocale, toSpeakableText } from "../src/voice/speech-text.js";

describe("toSpeakableText", () => {
  it("strips Markdown so nothing is read out as symbols", () => {
    const md = "# Today\n\n- **Standup** at 10\n- Review [the PR](https://github.com/x/y/pull/1)\n\nRun `pnpm test` first.";
    expect(toSpeakableText(md, 1000)).toBe("Today. Standup at 10. Review the PR. Run pnpm test first.");
  });

  it("summarises code blocks and bare URLs instead of reading them", () => {
    const out = toSpeakableText("Use this:\n```ts\nconst x = 1;\n```\nDocs: https://example.com/a?b=c", 1000);
    expect(out).toContain("(code shown on screen)");
    expect(out).toContain("the link on screen");
    expect(out).not.toMatch(/const x|https?:/);
  });

  it("cuts long answers at a sentence boundary and says the rest is on screen", () => {
    const long = Array.from({ length: 50 }, (_, i) => `Sentence number ${i} is here.`).join(" ");
    const out = toSpeakableText(long, 200);
    expect(out.length).toBeLessThan(240);
    expect(out).toMatch(/is here\. The rest is on screen\.$/);
  });
});

describe("detectSpeechLocale", () => {
  it("routes Tamil script to the Tamil voice and everything else to English", () => {
    expect(detectSpeechLocale("காலை வணக்கம். இன்று என்ன?")).toBe("ta-IN");
    expect(detectSpeechLocale("Good morning, what's on today?")).toBe("en-IN");
    expect(detectSpeechLocale("Naalaikku meeting irukka?")).toBe("en-IN"); // Tanglish is Latin script
    expect(detectSpeechLocale("Meeting at 10: காலை கூட்டம் உள்ளது")).toBe("ta-IN"); // mostly Tamil
  });
});

describe("SSML", () => {
  it("escapes text so model output cannot inject SSML", () => {
    const ssml = buildSsml({ text: `Tom & "Jerry" <break time="10s"/>`, locale: "en-IN", voice: "en-IN-NeerjaNeural", rate: 1 });
    expect(ssml).toContain("Tom &amp; &quot;Jerry&quot; &lt;break time=&quot;10s&quot;/&gt;");
    expect(ssml).not.toContain("<break");
    expect(escapeXml("'")).toBe("&apos;");
  });

  it("maps speech rate to a clamped prosody percentage", () => {
    expect(buildSsml({ text: "x", locale: "en-IN", voice: "v", rate: 1.25 })).toContain('rate="+25%"');
    expect(buildSsml({ text: "x", locale: "en-IN", voice: "v", rate: 0.1 })).toContain('rate="-50%"');
  });
});
