import fs from "node:fs";
import path from "node:path";
import { type Page, expect, test } from "@playwright/test";

/**
 * Live UI checks against the running web + API: demo flow and its isolation, themes,
 * keyboard navigation, WCAG contrast (axe-core), mobile layout and touch targets.
 * Also writes the screenshots in docs/demo/screenshots.
 */
const ORIGIN = "http://localhost:3000";
const SHOTS = path.resolve(import.meta.dirname, "../../../docs/demo/screenshots");
const AXE = path.join(import.meta.dirname, "../node_modules/axe-core/axe.min.js");
type Theme = "light" | "dark";

async function useTheme(page: Page, theme: Theme) {
  await page.addInitScript((t) => window.localStorage.setItem("pos.theme", t), theme);
}
async function resetDemo(page: Page) {
  const res = await page.request.post("/api/demo/reset", { headers: { Origin: ORIGIN } });
  expect(res.status()).toBe(204);
}
/** Waits for fonts, data and animations to settle before measuring or capturing. */
async function settle(page: Page) {
  await page.waitForLoadState("networkidle");
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(400);
}
async function shot(page: Page, name: string) {
  fs.mkdirSync(SHOTS, { recursive: true });
  await page.screenshot({ path: path.join(SHOTS, `${name}.png`) });
}
async function axe(page: Page) {
  await page.addScriptTag({ path: AXE });
  return page.evaluate(async () => {
    const w = window as unknown as { axe: { run: (ctx: unknown, opts: unknown) => Promise<{ violations: Array<{ id: string; impact: string; nodes: Array<{ target: string[]; failureSummary: string }> }> }> } };
    const r = await w.axe.run(document, { runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21aa"] } });
    return r.violations.map((v) => ({ id: v.id, impact: v.impact, nodes: v.nodes.slice(0, 5).map((n) => `${n.target.join(" ")} :: ${n.failureSummary.split("\n")[1]?.trim()}`) }));
  });
}

const PAGES: Array<{ name: string; url: string; ready: (p: Page) => Promise<void> }> = [
  { name: "welcome", url: "/welcome", ready: (p) => expect(p.getByRole("heading", { name: "Welcome to PersonalOS" })).toBeVisible() },
  { name: "home", url: "/", ready: (p) => expect(p.getByRole("heading", { name: "Next actions" })).toBeVisible() },
  { name: "assistant", url: "/assistant", ready: (p) => expect(p.locator("#composer")).toBeVisible() },
  { name: "connections", url: "/connections", ready: (p) => expect(p.getByRole("heading", { name: "Microsoft 365 Calendar" })).toBeVisible() },
  { name: "settings", url: "/settings", ready: (p) => expect(p.getByRole("radiogroup", { name: "Theme" })).toBeVisible() },
  { name: "demo-briefing", url: "/demo", ready: (p) => expect(p.getByRole("heading", { name: "Today's schedule" })).toBeVisible() },
  { name: "demo-approvals", url: "/demo/approvals", ready: (p) => expect(p.getByRole("heading", { name: "Team lunch for 8" })).toBeVisible() },
  { name: "demo-connections", url: "/demo/connections", ready: (p) => expect(p.getByRole("heading", { name: "Food ordering" })).toBeVisible() },
];

test.describe("Customer demo @ui", () => {
  test.beforeEach(async ({ page }) => resetDemo(page));

  test("briefing → assistant (lunch) → approve: ends with 'No real order placed.' and never touches real services", async ({ page }) => {
    const realCalls: string[] = [];
    page.on("request", (r) => {
      const u = new URL(r.url());
      if (u.pathname.startsWith("/api/") && !/^\/api\/(demo|health|auth\/me|voice\/settings)\b/.test(u.pathname)) realCalls.push(`${r.method()} ${u.pathname}`);
    });

    await page.goto("/demo");
    await expect(page.getByRole("note", { name: "Demo mode" })).toContainText("Actions are simulated");
    await expect(page.getByText("Sample data", { exact: true })).toBeVisible();
    await page.getByRole("link", { name: "Order lunch for the team" }).click();

    await expect(page).toHaveURL(/\/demo\/assistant$/);
    await expect(page.getByRole("list", { name: "Progress" })).toContainText("Checking sample attendance");
    const answer = page.getByRole("list", { name: "Conversation" });
    await expect(answer).toContainText("Total: ₹1,762", { timeout: 15_000 });
    await expect(answer.getByRole("list", { name: "Sources" }).last()).toContainText("Sample vendor menu");
    await expect(answer.getByRole("article").filter({ hasText: "Team lunch for 8" })).toContainText("Needs approval");

    await page.getByRole("link", { name: /^Approvals/ }).click();
    const card = page.getByRole("article").filter({ has: page.getByRole("heading", { name: "Team lunch for 8" }) });
    await expect(card).toContainText("Green Leaf Kitchen");
    await expect(card).toContainText("₹1,762");
    await card.getByRole("button", { name: "Review & approve ₹1,762" }).click();

    const dialog = page.getByRole("dialog", { name: "Approve this lunch order?" });
    await expect(dialog).toContainText("Total amount");
    await expect(dialog).toContainText("no real order will be placed");
    await dialog.getByRole("button", { name: "Approve order · ₹1,762" }).click();
    await expect(dialog).toBeHidden();
    await expect(card).toContainText("Completed");
    await expect(card).toContainText("No real order placed.");
    await expect(card.getByRole("list", { name: "Status history" })).toContainText(/Proposed.*Approved.*Completed/);

    expect(realCalls).toEqual([]); // only /api/demo/* (plus health, me, voice settings) was called
  });

  test("follow-ups: proposed, completed, declined and failed are all distinguishable", async ({ page }) => {
    await page.goto("/demo/approvals");
    const byTitle = (t: string) => page.getByRole("article").filter({ has: page.getByRole("heading", { name: t }) });
    await expect(byTitle("Payment reminder to Suresh Kumar")).toContainText("Failed");
    await expect(byTitle("Thank-you note to the Iyer family")).toContainText("No real message sent.");
    await byTitle("Remind Karthik about listing photos").getByRole("button", { name: "Decline" }).click();
    await expect(byTitle("Remind Karthik about listing photos")).toContainText("Declined");
    const divya = byTitle("Send brochure to Divya Raman");
    await expect(divya).toContainText("WhatsApp (simulated)");
    await divya.getByRole("button", { name: "Review & approve" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Approve & send" }).click();
    await expect(divya).toContainText("No real message sent.");
  });

  test("Stop cancels a demo answer", async ({ page }) => {
    await page.goto("/demo/assistant");
    await page.locator("#composer").fill("Give me my morning briefing");
    await page.locator("#composer").press("Enter");
    await expect(page.getByRole("list", { name: "Progress" })).toBeVisible();
    await page.getByRole("button", { name: "Stop generating" }).click();
    await expect(page.getByRole("button", { name: "Send message" })).toBeVisible();
    await page.waitForTimeout(3_000); // longer than the scripted answer would have taken
    const items = page.getByRole("list", { name: "Conversation" }).locator(":scope > li");
    await expect(items).toHaveCount(1); // the question stays; no answer was produced
    expect((await (await page.request.get("/api/demo/workspace")).json()).messages.map((m: { role: string }) => m.role)).toEqual(["user"]);
  });
});

test.describe("Themes and keyboard @ui", () => {
  test("Light / Dark / System: applied before paint, remembered across reloads, System follows the OS", async ({ page }) => {
    await page.emulateMedia({ colorScheme: "light" });
    await page.goto("/settings");
    const html = page.locator("html");
    await expect(html).toHaveAttribute("data-theme", "light");
    await page.getByRole("radio", { name: "Dark" }).click();
    await expect(html).toHaveAttribute("data-theme", "dark");
    await page.reload();
    await expect(html).toHaveAttribute("data-theme", "dark");
    await expect(page.getByRole("radio", { name: "Dark" })).toHaveAttribute("aria-checked", "true");

    await page.getByRole("radio", { name: "System" }).click();
    await expect(html).toHaveAttribute("data-theme", "light");
    await page.emulateMedia({ colorScheme: "dark" });
    await expect(html).toHaveAttribute("data-theme", "dark");

    // The account menu offers the same choice, by keyboard.
    await page.getByRole("button", { name: "Account menu" }).focus();
    await page.keyboard.press("Enter");
    await expect(page.getByRole("menuitemradio", { name: "System" })).toHaveAttribute("aria-checked", "true");
    await page.keyboard.press("ArrowDown"); // Light → Dark
    await page.keyboard.press("Enter");
    await expect(html).toHaveAttribute("data-theme", "dark");
    await expect(page.getByRole("button", { name: "Account menu" })).toBeFocused(); // focus returns to the trigger
  });

  test("keyboard: skip link, navigation, menu Escape, dialog Escape", async ({ page }) => {
    await resetDemo(page);
    await page.goto("/demo/approvals");
    await page.keyboard.press("Tab");
    await expect(page.getByRole("link", { name: "Skip to content" })).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(page.locator("#main")).toBeFocused();

    const approve = page.getByRole("button", { name: "Review & approve ₹1,762" });
    await approve.focus();
    await page.keyboard.press("Enter");
    const dialog = page.getByRole("dialog", { name: "Approve this lunch order?" });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole("button", { name: "Close" })).toBeFocused(); // focus moves into the dialog
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();

    await page.getByRole("button", { name: "Account menu" }).focus();
    await page.keyboard.press("ArrowDown");
    await expect(page.getByRole("menu", { name: "Account menu" })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("menu")).toHaveCount(0);

    // Nav links are reachable and announce the current page.
    await expect(page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: /^Approvals/ })).toHaveAttribute("aria-current", "page");
  });
});

for (const theme of ["light", "dark"] as const) {
  test.describe(`Contrast and screenshots, ${theme} @ui`, () => {
    test.beforeEach(async ({ page }) => {
      await useTheme(page, theme);
      await resetDemo(page);
    });

    for (const p of PAGES) {
      test(`${p.name}: no WCAG 2.1 AA violations`, async ({ page }) => {
        await page.goto(p.url);
        await p.ready(page);
        await settle(page);
        await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
        await shot(page, `${p.name}-${theme}`);
        expect(await axe(page)).toEqual([]);
      });
    }

    test("demo assistant with an answer and the approval dialog", async ({ page }) => {
      await page.goto("/demo/assistant");
      await page.getByRole("button", { name: "Order lunch for the team" }).click();
      await expect(page.getByRole("list", { name: "Conversation" })).toContainText("Total: ₹1,762", { timeout: 15_000 });
      await settle(page);
      await shot(page, `demo-assistant-${theme}`);
      expect(await axe(page)).toEqual([]);
      await page.getByRole("list", { name: "Conversation" }).getByRole("button", { name: /Review & approve/ }).click();
      await expect(page.getByRole("dialog")).toBeVisible();
      await settle(page);
      await shot(page, `demo-approval-dialog-${theme}`);
      expect(await axe(page)).toEqual([]);
    });
  });
}

test.describe("Phone layout @mobile", () => {
  for (const theme of ["light", "dark"] as const) {
    for (const p of PAGES) {
      test(`${p.name} (${theme}): fits the screen, 44px touch targets`, async ({ page }) => {
        await useTheme(page, theme);
        await resetDemo(page);
        await page.goto(p.url);
        await p.ready(page);
        await settle(page);
        const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
        expect(overflow).toBeLessThanOrEqual(0);
        const small = await page.evaluate(() =>
          Array.from(document.querySelectorAll<HTMLElement>('button, a[href], select, input:not([type=hidden]), [role="radio"], [role="switch"]'))
            .filter((el) => {
              const r = el.getBoundingClientRect();
              if (r.width <= 1 || r.height <= 1) return false; // hidden / screen-reader only
              if (el.classList.contains("sr-only")) return false; // skip link until focused
              if (el.closest("p")) return false; // inline text links are exempt (WCAG 2.5.8)
              const style = getComputedStyle(el);
              if (style.visibility === "hidden" || style.display === "none") return false;
              return r.height < 44 || (r.width < 44 && !(el.textContent ?? "").trim());
            })
            .map((el) => `${el.tagName.toLowerCase()} "${(el.getAttribute("aria-label") ?? el.textContent ?? "").trim().slice(0, 40)}" ${Math.round(el.getBoundingClientRect().width)}x${Math.round(el.getBoundingClientRect().height)}`),
        );
        expect(small).toEqual([]);
        if (["home", "assistant", "demo-briefing", "demo-approvals", "connections"].includes(p.name)) await shot(page, `mobile-${p.name}-${theme}`);
        expect(await axe(page)).toEqual([]);
      });
    }
  }
});
