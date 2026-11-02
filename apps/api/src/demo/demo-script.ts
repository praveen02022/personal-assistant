import type { DemoAction, DemoSource, TaskEvent } from "@personalos/contracts";
import { inr, SCHEDULE_TODAY, SCHEDULE_TOMORROW, SOURCES } from "./demo-data.js";

/**
 * The demo assistant. Deterministic and scripted: it answers from sample data only and never
 * calls a model, the agent runtime, or any tool that touches a real account. Its output uses
 * the same TaskEvent shapes as a real run, so the UI renders progress and streaming unchanged.
 */
export type Intent = "lunch" | "followups" | "payments" | "tomorrow" | "briefing" | "help";

const INTENT_PATTERNS: Array<[Intent, RegExp]> = [
  ["lunch", /\b(lunch|food|meals?|order|biryani)\b|சாப்பாடு|மதிய|உணவு/i],
  ["followups", /\b(follow[- ]?ups?|remind|reminders?|messages?|whatsapp|office tasks?)\b|நினைவூட்ட|பின்தொடர/i],
  ["payments", /\b(payments?|dues?|overdue|instal?ments?|money|collections?)\b|பணம்|கட்டண/i],
  ["tomorrow", /\btomorrow\b|நாளை/i],
  ["briefing", /\b(brief(ing)?|morning|today|my day|schedule|agenda|meetings?)\b|காலை|இன்று/i],
];

export function detectIntent(text: string): Intent {
  return INTENT_PATTERNS.find(([, re]) => re.test(text))?.[0] ?? "help";
}

export type ScriptedReply = { text: string; tools: string[]; sources: DemoSource[]; actionIds: string[] };

const schedule = (items: typeof SCHEDULE_TODAY) => items.map((i) => `- **${i.time}**: ${i.title} (${i.detail})`).join("\n");

export function replyFor(intent: Intent, actions: DemoAction[]): ScriptedReply {
  const byId = new Map(actions.map((a) => [a.id, a]));
  const pending = actions.filter((a) => a.status === "proposed");
  switch (intent) {
    case "briefing":
      return {
        tools: ["Reading sample calendar", "Checking sample CRM", "Reviewing sample payments"],
        sources: [SOURCES.calendar, SOURCES.crm, SOURCES.payments, SOURCES.approvals],
        actionIds: [],
        text: [
          "Good morning. Here's your day at Sunrise Realty.",
          "",
          "**Schedule**",
          schedule(SCHEDULE_TODAY),
          "",
          "**Needs your attention**",
          "- The ₹2,00,000 token advance from R. Krishnan is due today.",
          "- 3 new leads came in overnight. Divya Raman (Velachery 3BHK) looks the most ready to visit.",
          pending.length > 0
            ? `- ${pending.length} ${pending.length === 1 ? "action is" : "actions are"} waiting for your approval in Approvals.`
            : "- Nothing is waiting for your approval.",
          "",
          "Want me to go through the office follow-ups?",
        ].join("\n"),
      };
    case "tomorrow":
      return {
        tools: ["Reading sample calendar"],
        sources: [SOURCES.calendarTomorrow],
        actionIds: [],
        text: ["You have 3 appointments tomorrow:", "", schedule(SCHEDULE_TOMORROW), "", "The first one is the Anna Nagar site visit at 10 AM."].join("\n"),
      };
    case "followups": {
      const ids = ["msg-divya", "msg-karthik", "msg-suresh"];
      const line = (id: string, text: string) => {
        const a = byId.get(id);
        const state = a?.status === "completed" ? " *(sent in the demo, simulated)*" : a?.status === "rejected" ? " *(you declined this)*" : "";
        return `${text}${state}`;
      };
      return {
        tools: ["Checking sample CRM", "Drafting follow-up messages"],
        sources: [SOURCES.crm, SOURCES.tasks, SOURCES.payments],
        actionIds: ids,
        text: [
          "I found three office follow-ups:",
          "",
          line("msg-divya", "1. **Divya Raman**, new lead for the Velachery 3BHK: a WhatsApp with the brochure and a Saturday 11 AM visit slot."),
          line("msg-karthik", "2. **Karthik S.**: a reminder to upload the Anna Nagar 2BHK photos before the 4 PM listing review."),
          "3. **Suresh Kumar**: yesterday's payment reminder **failed** because his number isn't verified in the CRM. Verify it before trying again.",
          "",
          "Review the drafts below. Nothing is sent until you approve, and in this demo nothing is sent at all.",
        ].join("\n"),
      };
    }
    case "lunch": {
      const lunch = byId.get("lunch-team");
      const order = lunch?.order;
      if (!lunch || !order) return replyFor("help", actions);
      if (lunch.status !== "proposed") {
        return {
          tools: ["Checking demo approvals"],
          sources: [SOURCES.approvals],
          actionIds: [lunch.id],
          text:
            lunch.status === "completed"
              ? "You've already approved today's team lunch. That was simulated: no real order was placed."
              : "You declined today's team lunch order, so nothing was placed. Reset the demo to try again.",
        };
      }
      return {
        tools: ["Checking sample attendance", "Preparing order from sample vendor menu"],
        sources: [SOURCES.attendance, SOURCES.menu],
        actionIds: [lunch.id],
        text: [
          `8 of 9 team members are in the office today, so I've prepared a lunch order from Green Leaf Kitchen for delivery by ${order.deliverBy.replace(" today", "")}:`,
          "",
          ...order.items.map((i) => `- ${i.quantity} × ${i.name}`),
          "",
          `**Total: ${inr(order.total)}**, including GST and delivery. It won't be placed until you approve it, and in this demo no real order is placed.`,
        ].join("\n"),
      };
    }
    case "payments":
      return {
        tools: ["Reviewing sample payments"],
        sources: [SOURCES.payments],
        actionIds: ["msg-suresh"],
        text: [
          "Two payments need attention:",
          "",
          "- **R. Krishnan**: ₹2,00,000 token advance, **due today**.",
          "- **Suresh Kumar**: ₹1,50,000 second instalment, **3 days overdue**. The reminder failed because his number isn't verified.",
        ].join("\n"),
      };
    case "help":
      return {
        tools: [],
        sources: [],
        actionIds: [],
        text: [
          "This demo runs on sample data for a real-estate office, so I can show you a few things. Try asking:",
          "",
          "- “Give me my morning briefing”",
          "- “What follow-ups are pending?”",
          "- “Order lunch for the team”",
          "- “Which payments are due?”",
          "",
          "For your own questions, exit the demo and use your connected assistant.",
        ].join("\n"),
      };
  }
}

export type TimedEvent = { atMs: number; event: TaskEvent };

/** Turns a reply into a timeline of TaskEvents (progress, tool steps, streamed text, final). */
export function scriptEvents(turnId: string, reply: ScriptedReply): TimedEvent[] {
  const events: TimedEvent[] = [
    { atMs: 0, event: { type: "task.status", status: "RUNNING" } },
    { atMs: 150, event: { type: "task.progress", phase: "thinking" } },
  ];
  let t = 450;
  reply.tools.forEach((label, i) => {
    const toolCallId = `${turnId}:${i}`;
    events.push({ atMs: t, event: { type: "tool.started", toolCallId, tool: "demo_sample_data", label } });
    events.push({ atMs: t + 550, event: { type: "tool.finished", toolCallId, ok: true } });
    t += 700;
  });
  // Stream the answer in word-boundary chunks (cumulative snapshots, like real runs).
  const words = reply.text.split(/(?<=\s)/);
  const chunk = Math.max(4, Math.ceil(words.length / 12));
  for (let i = chunk; i < words.length + chunk; i += chunk) {
    events.push({ atMs: t, event: { type: "assistant.text", text: words.slice(0, i).join("") } });
    t += 80;
  }
  events.push({ atMs: t, event: { type: "assistant.final", text: reply.text } });
  events.push({ atMs: t + 20, event: { type: "task.status", status: "SUCCEEDED" } });
  return events;
}
