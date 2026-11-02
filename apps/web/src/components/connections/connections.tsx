"use client";

import type { Health, IntegrationSummary } from "@personalos/contracts";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Ban, Bot, CalendarDays, Check, ExternalLink, FlaskConical, Mic, ShieldCheck, Unplug } from "lucide-react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useState } from "react";
import { Button, buttonClass } from "@/components/ui/button";
import { Dialog } from "@/components/ui/overlay";
import { Badge, Card, ErrorState, LoadingRows, Notice, PageHeader, StatusDot } from "@/components/ui/primitives";
import { api, ApiRequestError } from "@/lib/api";

const RESULT_COPY: Record<string, { ok: boolean; text: string }> = {
  connected: { ok: true, text: "Microsoft 365 Calendar connected. Try asking: “What meetings do I have tomorrow?”" },
  denied: { ok: false, text: "You declined the permission request, so nothing was connected." },
  scope: { ok: false, text: "Microsoft granted different permissions than requested (calendar read-only is required, write access is refused). Nothing was stored." },
  invalid_state: { ok: false, text: "That sign-in link expired or was already used. Please try connecting again." },
  exchange_failed: { ok: false, text: "Microsoft sign-in didn't complete. Please try again." },
  provider_error: { ok: false, text: "Microsoft returned an error during sign-in. Please try again." },
  unavailable: { ok: false, text: "Microsoft 365 isn't configured on the server yet." },
};

export function ConnectionsView() {
  const result = useSearchParams().get("result");
  const integrations = useQuery({ queryKey: ["integrations"], queryFn: api.integrations });
  const health = useQuery({ queryKey: ["health"], queryFn: api.health, refetchInterval: 10_000 });
  const banner = result ? RESULT_COPY[result] : null;

  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <div className="mx-auto w-full max-w-4xl space-y-6 px-4 py-8 sm:px-6 md:py-10">
        <PageHeader
          title="Connections"
          description="What your assistant can reach, and exactly what it's allowed to do there. Every account connection is read-only for now."
          actions={
            <Link href="/demo/connections" className={buttonClass({ variant: "ghost", size: "sm" })}>
              <FlaskConical className="h-4 w-4" aria-hidden /> Demo services
            </Link>
          }
        />

        {banner && (
          <Notice tone={banner.ok ? "ok" : "danger"} role={banner.ok ? "status" : "alert"}>
            {banner.text}
          </Notice>
        )}

        <section aria-labelledby="accounts-h" className="space-y-3">
          <h2 id="accounts-h" className="text-label text-ink-3 uppercase">
            Your accounts
          </h2>
          {integrations.isLoading && <LoadingRows rows={1} label="Loading connections" />}
          {integrations.isError && <ErrorState title="Couldn't load connections" message="The API didn't respond." onRetry={() => void integrations.refetch()} />}
          {integrations.data?.items.map((i) => <CalendarCard key={i.provider} item={i} />)}
        </section>

        <section aria-labelledby="services-h" className="space-y-3">
          <h2 id="services-h" className="text-label text-ink-3 uppercase">
            Services PersonalOS runs on
          </h2>
          <div className="grid gap-3 md:grid-cols-2">
            <ServiceCard
              icon={<Bot className="h-5 w-5" aria-hidden />}
              name="Assistant runtime"
              status={runtimeStatus(health.data)}
              description="Runs your assistant's reasoning on a dedicated, isolated runtime."
              allowed={["Search the web and read web pages", "Read your calendar (only when connected)"]}
              blocked={["Shell, files and browser automation", "Sending messages, payments or purchases"]}
            />
            <ServiceCard
              icon={<Mic className="h-5 w-5" aria-hidden />}
              name="Voice (speech service)"
              status={health.data ? (health.data.voice === "ok" ? { label: "Ready", tone: "ok" } : { label: "Not set up", tone: "neutral" }) : null}
              description="Turns your speech into text for you to review, and reads answers aloud."
              allowed={["Transcribe recordings you start (English, Tamil)", "Speak answers you play"]}
              blocked={["Listening when you haven't pressed the mic", "Keeping your recordings in PersonalOS"]}
            />
          </div>
        </section>
      </div>
    </div>
  );
}

type Status = { label: string; tone: "ok" | "warn" | "danger" | "neutral" } | null;
function runtimeStatus(h: Health | undefined): Status {
  if (!h) return null;
  if (h.gateway === "connected") return { label: "Online", tone: "ok" };
  if (h.gateway === "connecting" || h.gateway === "reconnecting") return { label: "Reconnecting", tone: "warn" };
  return { label: "Offline", tone: "danger" };
}

function ServiceCard({ icon, name, status, description, allowed, blocked }: { icon: React.ReactNode; name: string; status: Status; description: string; allowed: string[]; blocked: string[] }) {
  return (
    <Card className="p-5">
      <div className="flex items-start gap-3">
        <div className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-surface-2 text-ink-2">{icon}</div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-heading">{name}</h3>
            {status && (
              <Badge tone={status.tone === "neutral" ? "neutral" : status.tone} icon={<StatusDot tone={status.tone === "neutral" ? "neutral" : status.tone} />}>
                {status.label}
              </Badge>
            )}
          </div>
          <p className="mt-1 text-caption text-ink-2">{description}</p>
        </div>
      </div>
      <PermissionColumns allowed={allowed.map((a) => ({ text: a }))} never={blocked} allowedTitle="Can" neverTitle="Cannot" />
    </Card>
  );
}

export function PermissionColumns({ allowed, never, allowedTitle = "What you'll allow", neverTitle = "What PersonalOS will never do" }: { allowed: { text: string; code?: string }[]; never: string[]; allowedTitle?: string; neverTitle?: string }) {
  return (
    <div className="mt-4 grid gap-4 border-t border-line pt-4 sm:grid-cols-2">
      <div>
        <h4 className="flex items-center gap-1.5 text-caption font-semibold text-ink">
          <ShieldCheck className="h-4 w-4 text-ok" aria-hidden /> {allowedTitle}
        </h4>
        <ul className="mt-2 space-y-2 text-caption text-ink-2">
          {allowed.map((p) => (
            <li key={p.text} className="flex gap-2">
              <Check className="mt-0.5 h-4 w-4 shrink-0 text-ok" aria-hidden />
              <span>
                {p.code && <code className="mr-1 rounded bg-surface-2 px-1 text-label text-ink">{p.code}</code>}
                {p.text}
              </span>
            </li>
          ))}
        </ul>
      </div>
      <div>
        <h4 className="flex items-center gap-1.5 text-caption font-semibold text-ink">
          <Ban className="h-4 w-4 text-danger" aria-hidden /> {neverTitle}
        </h4>
        <ul className="mt-2 space-y-2 text-caption text-ink-2">
          {never.map((n) => (
            <li key={n} className="flex gap-2">
              <Ban className="mt-0.5 h-4 w-4 shrink-0 text-ink-3" aria-hidden />
              <span>{n}</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

function CalendarCard({ item }: { item: IntegrationSummary }) {
  const qc = useQueryClient();
  const [confirmDisconnect, setConfirmDisconnect] = useState(false);
  const connect = useMutation({
    mutationFn: api.connectMicrosoftCalendar,
    onSuccess: ({ authorizeUrl }) => window.location.assign(authorizeUrl), // leaves the app for Microsoft sign-in
  });
  const disconnect = useMutation({
    mutationFn: api.disconnectMicrosoftCalendar,
    onSuccess: () => {
      setConfirmDisconnect(false);
      void qc.invalidateQueries({ queryKey: ["integrations"] });
    },
  });
  const error = connect.error ?? disconnect.error;
  const status =
    item.status === "connected"
      ? { label: "Connected", tone: "ok" as const }
      : item.status === "needs_reconnect"
        ? { label: "Needs reconnect", tone: "warn" as const }
        : item.available
          ? { label: "Not connected", tone: "neutral" as const }
          : { label: "Not set up", tone: "neutral" as const };

  return (
    <Card aria-labelledby={`${item.provider}-h`} className="p-5">
      <div className="flex flex-wrap items-start gap-3">
        <div className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-accent-soft text-accent-soft-ink">
          <CalendarDays className="h-5 w-5" aria-hidden />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 id={`${item.provider}-h`} className="text-heading">
              {item.label}
            </h3>
            <Badge tone={status.tone} icon={<StatusDot tone={status.tone} />}>
              {status.label}
            </Badge>
            <Badge tone="neutral">Read-only</Badge>
          </div>
          <p className="mt-1 text-caption text-ink-2">
            {item.status === "connected" && `Signed in as ${item.accountEmail ?? "your Microsoft account"}. Your assistant can look up your meetings when you ask.`}
            {item.status === "needs_reconnect" && "Microsoft access expired or was revoked. Reconnect to keep calendar answers working."}
            {item.status === "not_connected" &&
              (item.available ? "Lets your assistant answer questions like “What meetings do I have tomorrow?”" : "The server needs a Microsoft app registration before you can connect. Nothing is shared until then.")}
          </p>
        </div>
        <div className="flex w-full gap-2 sm:w-auto">
          {item.status === "connected" ? (
            <Button variant="danger" onClick={() => setConfirmDisconnect(true)} className="flex-1 sm:flex-none">
              <Unplug className="h-4 w-4" aria-hidden /> Disconnect
            </Button>
          ) : (
            <Button onClick={() => connect.mutate()} disabled={!item.available || connect.isPending} className="flex-1 sm:flex-none">
              <ExternalLink className="h-4 w-4" aria-hidden /> {connect.isPending ? "Opening Microsoft…" : item.status === "needs_reconnect" ? "Reconnect" : "Connect"}
            </Button>
          )}
        </div>
      </div>

      <PermissionColumns allowed={item.permissions.map((p) => ({ text: p.description, code: p.scope }))} never={item.never} />

      {item.status === "connected" && (
        <p className="mt-4 text-label font-normal text-ink-3">
          Connected {item.connectedAt ? new Date(item.connectedAt).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" }) : ""}
          {item.lastUsedAt ? ` · last used ${new Date(item.lastUsedAt).toLocaleString("en-IN")}` : " · not used yet"}
        </p>
      )}
      {error && (
        <p role="alert" className="mt-4 text-caption text-danger">
          {error instanceof ApiRequestError ? error.message : "Something went wrong."}
        </p>
      )}

      <Dialog
        open={confirmDisconnect}
        onClose={() => setConfirmDisconnect(false)}
        title="Disconnect Microsoft 365 Calendar?"
        description="PersonalOS deletes its stored access right away. Your assistant will stop answering calendar questions until you reconnect."
        footer={
          <>
            <Button variant="secondary" onClick={() => setConfirmDisconnect(false)}>
              Keep connected
            </Button>
            <Button variant="danger" onClick={() => disconnect.mutate()} disabled={disconnect.isPending}>
              {disconnect.isPending ? "Disconnecting…" : "Disconnect"}
            </Button>
          </>
        }
      >
        <p className="text-caption text-ink-2">To also remove the app from your Microsoft account, visit myapps.microsoft.com after disconnecting.</p>
      </Dialog>
    </Card>
  );
}
