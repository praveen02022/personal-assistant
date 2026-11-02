import type { DemoAction, DemoHighlight, DemoScheduleItem, DemoSource, DemoWorkspace } from "@personalos/contracts";

/**
 * Sample workspace for the customer demo: a fictional real-estate office in Chennai.
 * Every person, vendor, amount and event here is invented. Nothing in this file is ever
 * sent anywhere; the DemoModule has no outbound network access (see demo.isolation.spec.ts).
 */
export const DEMO_TIMEZONE = "Asia/Kolkata";

export const BUSINESS = { name: "Sunrise Realty (sample)", owner: "Owner", city: "Chennai" } as const;

export const SOURCES = {
  calendar: { label: "Sample calendar", detail: "5 appointments today" },
  calendarTomorrow: { label: "Sample calendar", detail: "3 appointments tomorrow" },
  crm: { label: "Sample CRM", detail: "3 new leads since 6 PM yesterday" },
  payments: { label: "Sample payments ledger", detail: "1 due today, 1 overdue" },
  attendance: { label: "Sample attendance", detail: "8 of 9 team members in the office today" },
  menu: { label: "Sample vendor menu", detail: "Green Leaf Kitchen, today's prices" },
  tasks: { label: "Sample task list", detail: "“Upload Anna Nagar photos”, due 4 PM today" },
  approvals: { label: "Demo approvals", detail: "Actions waiting for you" },
} satisfies Record<string, DemoSource>;

export const SCHEDULE_TODAY: DemoScheduleItem[] = [
  { time: "9:30 AM", title: "Team huddle", detail: "Office, T. Nagar", kind: "team" },
  { time: "11:00 AM", title: "Site visit: Velachery 3BHK", detail: "With the Iyer family", kind: "visit" },
  { time: "1:00 PM", title: "Team lunch", detail: "8 people · order waiting for approval", kind: "team" },
  { time: "3:00 PM", title: "Sale agreement registration", detail: "Plot 14, Adyar · Sub-registrar office", kind: "registration" },
  { time: "5:30 PM", title: "Call: home-loan partner", detail: "About the Krishnan file", kind: "call" },
];

export const SCHEDULE_TOMORROW: DemoScheduleItem[] = [
  { time: "10:00 AM", title: "Site visit: Anna Nagar 2BHK", detail: "With Rahul Verma", kind: "visit" },
  { time: "12:30 PM", title: "Bank visit", detail: "Loan disbursement for Plot 14, Adyar", kind: "registration" },
  { time: "4:00 PM", title: "Weekly listings review", detail: "Sales team", kind: "team" },
];

export function highlights(pendingApprovals: number): DemoHighlight[] {
  return [
    { label: "Payments due today", value: "₹2,00,000", detail: "Token advance from R. Krishnan", tone: "attention" },
    { label: "New leads overnight", value: "3", detail: "2 from the website, 1 referral", tone: "neutral" },
    { label: "Waiting for approval", value: String(pendingApprovals), detail: pendingApprovals === 1 ? "1 action needs you" : `${pendingApprovals} actions need you`, tone: pendingApprovals > 0 ? "attention" : "good" },
    { label: "Site visits this week", value: "6", detail: "2 more than last week", tone: "good" },
  ];
}

export const SERVICES: DemoWorkspace["services"] = [
  { id: "calendar", name: "Calendar", purpose: "Appointments, site visits and registrations", access: ["Read events (read-only)"], status: "simulated" },
  { id: "crm", name: "CRM", purpose: "Leads, buyers and follow-up history", access: ["Read leads and contact names", "Read follow-up notes"], status: "simulated" },
  { id: "payments", name: "Payments ledger", purpose: "Amounts due and received", access: ["Read dues and receipts (read-only)"], status: "simulated" },
  { id: "messaging", name: "Messaging (WhatsApp, SMS, team chat)", purpose: "Sends follow-ups you approve", access: ["Send a message only after you approve it", "Never reads your personal chats"], status: "simulated" },
  { id: "ordering", name: "Food ordering", purpose: "Places orders you approve", access: ["Place an order only after you approve the total", "Stays within a spending limit you set"], status: "simulated" },
];

const LUNCH_ITEMS = [
  { name: "South Indian meals", quantity: 6, unitPrice: 160 },
  { name: "Paneer biryani", quantity: 2, unitPrice: 220 },
  { name: "Buttermilk", quantity: 8, unitPrice: 30 },
];
const subtotal = LUNCH_ITEMS.reduce((sum, i) => sum + i.quantity * i.unitPrice, 0);
const taxes = Math.round(subtotal * 0.05); // GST 5% on restaurant food
const deliveryFee = 40;

/** Fresh copy of the seed actions. `now` anchors the sample timeline. */
export function seedActions(now: Date): DemoAction[] {
  const at = (minutesAgo: number) => new Date(now.getTime() - minutesAgo * 60_000).toISOString();
  const message = (a: Pick<DemoAction, "id" | "title" | "summary" | "recipient" | "messagePreview" | "sources"> & Partial<DemoAction>): DemoAction => ({
    kind: "message",
    status: "proposed",
    simulated: true,
    order: null,
    resultNote: null,
    timeline: [{ status: "proposed", at: at(25), note: null }],
    ...a,
  });
  return [
    {
      id: "lunch-team",
      kind: "lunch_order",
      title: "Team lunch for 8",
      summary: "Order from Green Leaf Kitchen, delivered by 12:45 PM",
      status: "proposed",
      simulated: true,
      recipient: null,
      messagePreview: null,
      order: {
        vendor: "Green Leaf Kitchen (sample vendor)",
        deliverTo: "Sunrise Realty office, 2nd floor, T. Nagar",
        deliverBy: "12:45 PM today",
        items: LUNCH_ITEMS,
        subtotal,
        taxes,
        deliveryFee,
        total: subtotal + taxes + deliveryFee,
        currency: "INR",
      },
      resultNote: null,
      timeline: [{ status: "proposed", at: at(20), note: null }],
      sources: [SOURCES.attendance, SOURCES.menu],
    },
    message({
      id: "msg-divya",
      title: "Send brochure to Divya Raman",
      summary: "New lead for the Velachery 3BHK",
      recipient: { name: "Divya Raman", role: "New lead · Velachery 3BHK", channel: "WhatsApp" },
      messagePreview:
        "Hi Divya, thanks for your interest in the Velachery 3BHK. I've attached the brochure and floor plan. Would Saturday at 11 AM work for a site visit? – Sunrise Realty",
      sources: [{ label: "Sample CRM", detail: "Lead created yesterday, 8:42 PM, via website form" }],
    }),
    message({
      id: "msg-karthik",
      title: "Remind Karthik about listing photos",
      summary: "Photos are needed before the 4 PM listing review",
      recipient: { name: "Karthik S.", role: "Sales executive (your team)", channel: "Team chat" },
      messagePreview: "Hi Karthik, a reminder to upload the Anna Nagar 2BHK photos before today's 4 PM listing review. Thanks!",
      sources: [SOURCES.tasks],
    }),
    message({
      id: "msg-suresh",
      title: "Payment reminder to Suresh Kumar",
      summary: "Second instalment is 3 days overdue",
      recipient: { name: "Suresh Kumar", role: "Buyer · Plot 7, Porur", channel: "SMS" },
      messagePreview: "Dear Mr. Kumar, a gentle reminder that the second instalment of ₹1,50,000 for Plot 7, Porur was due on Friday. – Sunrise Realty",
      status: "failed",
      resultNote: "Not sent: this buyer's number isn't verified in the CRM. Verify it, then draft a new reminder.",
      timeline: [
        { status: "proposed", at: at(60 * 20), note: null },
        { status: "approved", at: at(60 * 19), note: null },
        { status: "failed", at: at(60 * 19 - 1), note: "Sample failure: number not verified" },
      ],
      sources: [{ label: "Sample payments ledger", detail: "₹1,50,000 instalment, 3 days overdue" }],
    }),
    message({
      id: "msg-iyer",
      title: "Thank-you note to the Iyer family",
      summary: "After yesterday's first call",
      recipient: { name: "Iyer family", role: "Prospect · Velachery 3BHK", channel: "WhatsApp" },
      messagePreview: "Thank you for speaking with us today. We look forward to showing you the Velachery 3BHK tomorrow at 11 AM. – Sunrise Realty",
      status: "completed",
      resultNote: "No real message sent.",
      timeline: [
        { status: "proposed", at: at(60 * 18), note: null },
        { status: "approved", at: at(60 * 17), note: null },
        { status: "completed", at: at(60 * 17 - 1), note: "Simulated · No real message sent." },
      ],
      sources: [{ label: "Sample CRM", detail: "First call logged yesterday, 4:10 PM" }],
    }),
  ];
}

/** "Monday, 2 November" in the sample business's timezone. */
export function dateLabel(now: Date, offsetDays = 0): string {
  return new Intl.DateTimeFormat("en-IN", { timeZone: DEMO_TIMEZONE, weekday: "long", day: "numeric", month: "long" }).format(new Date(now.getTime() + offsetDays * 86_400_000));
}

export const inr = (n: number) => `₹${n.toLocaleString("en-IN")}`;
