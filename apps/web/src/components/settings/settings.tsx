"use client";

import type { SpeechLocale, UpdateVoicePreferences, VoiceLanguage } from "@personalos/contracts";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, LogOut, Monitor, Moon, Square, Sun, Volume2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, fieldClass, LoadingRows, Notice, PageHeader, Segmented } from "@/components/ui/primitives";
import { api, ApiRequestError } from "@/lib/api";
import { type ThemePreference, useTheme } from "@/lib/theme";
import { cn } from "@/lib/utils";
import { useSpeechPlayer } from "@/lib/voice/player";

const LANGUAGES: { value: VoiceLanguage; label: string; hint: string }[] = [
  { value: "auto", label: "Auto", hint: "Detects English or Tamil each time" },
  { value: "en-IN", label: "English", hint: "Best accuracy for English and most Tanglish" },
  { value: "ta-IN", label: "தமிழ் Tamil", hint: "Best accuracy for Tamil" },
];

const SAMPLES: Record<SpeechLocale, string> = {
  "en-IN": "Good morning! Here's a quick look at your day.",
  "ta-IN": "காலை வணக்கம்! இன்றைய உங்கள் நாளைப் பார்ப்போம்.",
};

export function SettingsView() {
  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <div className="mx-auto w-full max-w-3xl space-y-6 px-4 py-8 sm:px-6 md:py-10">
        <PageHeader title="Settings" description="Appearance and voice. Theme is remembered on this device; voice settings are saved to your account." />
        <AppearanceCard />
        <VoiceCard />
        <AccountCard />
      </div>
    </div>
  );
}

function AppearanceCard() {
  const { preference, resolved, setPreference } = useTheme();
  return (
    <Card aria-labelledby="appearance-h">
      <CardHeader id="appearance-h" title="Appearance" description={preference === "system" ? `Following your system (currently ${resolved}).` : `Always ${preference}.`} />
      <div className="px-5 pb-5">
        <Segmented<ThemePreference>
          label="Theme"
          value={preference}
          onChange={setPreference}
          options={[
            { value: "light", label: "Light", icon: <Sun aria-hidden /> },
            { value: "dark", label: "Dark", icon: <Moon aria-hidden /> },
            { value: "system", label: "System", icon: <Monitor aria-hidden /> },
          ]}
        />
      </div>
    </Card>
  );
}

function VoiceCard() {
  const qc = useQueryClient();
  const settings = useQuery({ queryKey: ["voice-settings"], queryFn: api.voiceSettings });
  const player = useSpeechPlayer();
  const save = useMutation({
    mutationFn: (patch: UpdateVoicePreferences) => api.updateVoicePreferences(patch),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["voice-settings"] }),
  });
  const prefs = settings.data?.preferences;
  const voices = settings.data?.voices ?? [];
  const update = (patch: UpdateVoicePreferences) => save.mutate(patch);

  return (
    <Card aria-labelledby="voice-h" id="voice">
      <CardHeader id="voice-h" title="Voice" description="Hold the mic in the message box to talk. Your words appear as text so you can check them before sending." />
      <div className="space-y-6 px-5 pb-5">
        {settings.isLoading && <LoadingRows rows={2} label="Loading voice settings" />}
        {settings.data && !settings.data.available && <Notice tone="warn">Voice isn&apos;t configured on the server yet (speech service key and region).</Notice>}

        {prefs && (
          <>
            <section aria-labelledby="lang-h">
              <h3 id="lang-h" className="text-caption font-semibold">
                Language you speak
              </h3>
              <div className="mt-2 grid gap-2 sm:grid-cols-3" role="radiogroup" aria-labelledby="lang-h">
                {LANGUAGES.map((l) => (
                  <button
                    key={l.value}
                    type="button"
                    role="radio"
                    aria-checked={prefs.language === l.value}
                    onClick={() => update({ language: l.value })}
                    className={cn(
                      "min-h-11 rounded-lg border px-4 py-3 text-left transition-colors",
                      prefs.language === l.value ? "border-accent bg-accent-soft" : "border-line bg-surface hover:border-line-strong hover:bg-surface-2",
                    )}
                  >
                    <span className="flex items-center justify-between text-caption font-medium text-ink">
                      {l.label} {prefs.language === l.value && <Check className="h-4 w-4 text-accent" aria-hidden />}
                    </span>
                    <span className="mt-0.5 block text-label font-normal text-ink-2">{l.hint}</span>
                  </button>
                ))}
              </div>
            </section>

            <div className="grid gap-4 sm:grid-cols-2">
              {(["en-IN", "ta-IN"] as const).map((locale) => {
                const key = locale === "en-IN" ? "voiceEn" : "voiceTa";
                const sampleKey = `sample:${locale}`;
                return (
                  <section key={locale} aria-labelledby={`${locale}-h`}>
                    <h3 id={`${locale}-h`} className="text-caption font-semibold">
                      {locale === "en-IN" ? "English voice" : "Tamil voice"}
                    </h3>
                    <div className="mt-2 flex items-center gap-2">
                      <select aria-labelledby={`${locale}-h`} value={prefs[key]} onChange={(e) => update({ [key]: e.target.value })} className={cn(fieldClass, "flex-1")}>
                        {voices
                          .filter((v) => v.locale === locale)
                          .map((v) => (
                            <option key={v.id} value={v.id}>
                              {v.label} ({v.gender})
                            </option>
                          ))}
                      </select>
                      {player.key === sampleKey ? (
                        <Button variant="secondary" onClick={player.stop}>
                          <Square className="h-3.5 w-3.5 fill-current" aria-hidden /> Stop
                        </Button>
                      ) : (
                        <Button variant="secondary" onClick={() => void player.speak(SAMPLES[locale], sampleKey)} disabled={!settings.data?.available}>
                          <Volume2 className="h-4 w-4" aria-hidden /> Test
                        </Button>
                      )}
                    </div>
                  </section>
                );
              })}
            </div>

            <section aria-labelledby="rate-h">
              <h3 id="rate-h" className="text-caption font-semibold">
                Speaking speed <span className="font-normal text-ink-2 tabular">· {prefs.speechRate.toFixed(2)}×</span>
              </h3>
              <input
                type="range"
                aria-labelledby="rate-h"
                min={0.75}
                max={1.5}
                step={0.05}
                defaultValue={prefs.speechRate}
                onPointerUp={(e) => update({ speechRate: Number(e.currentTarget.value) })}
                onKeyUp={(e) => update({ speechRate: Number(e.currentTarget.value) })}
                className="mt-3 h-11 w-full accent-[var(--accent)] md:h-6"
              />
            </section>

            <section className="flex items-start justify-between gap-4">
              <div>
                <h3 id="auto-h" className="text-caption font-semibold">
                  Read answers aloud
                </h3>
                <p className="mt-0.5 text-caption text-ink-2">When you ask by voice, the answer is spoken automatically.</p>
              </div>
              <button
                type="button"
                role="switch"
                aria-labelledby="auto-h"
                aria-checked={prefs.autoSpeak}
                onClick={() => update({ autoSpeak: !prefs.autoSpeak })}
                className="grid h-11 w-14 shrink-0 place-items-center rounded-full"
              >
                <span className={cn("relative h-6 w-11 rounded-full transition-colors", prefs.autoSpeak ? "bg-accent" : "bg-line-strong")}>
                  <span className={cn("absolute top-0.5 h-5 w-5 rounded-full bg-surface shadow-e1 transition-[left] duration-150", prefs.autoSpeak ? "left-[22px]" : "left-0.5")} />
                </span>
              </button>
            </section>

            <p aria-live="polite" className="h-5 text-caption">
              {save.isPending && <span className="text-ink-3">Saving…</span>}
              {save.isSuccess && !save.isPending && <span className="text-ok">Saved</span>}
              {save.isError && <span className="text-danger">{save.error instanceof ApiRequestError ? save.error.message : "Couldn't save."}</span>}
            </p>
          </>
        )}
      </div>
    </Card>
  );
}

function AccountCard() {
  const me = useQuery({ queryKey: ["me"], queryFn: api.me });
  const qc = useQueryClient();
  const router = useRouter();
  return (
    <Card aria-labelledby="account-h">
      <CardHeader
        id="account-h"
        title="Account"
        description={me.data ? `Signed in as ${me.data.email} · timezone ${me.data.preference.timezone}` : "Loading…"}
        action={
          <Button
            variant="secondary"
            size="sm"
            onClick={async () => {
              await api.logout().catch(() => undefined);
              qc.clear();
              router.replace("/login");
            }}
          >
            <LogOut className="h-4 w-4" aria-hidden /> Sign out
          </Button>
        }
      />
      <div className="pb-2" />
    </Card>
  );
}
