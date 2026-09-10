import { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import X from "lucide-react/dist/esm/icons/x";
import { Button } from "@/components/base/buttons/button";
import { ModalShell } from "@/components/dialogs";
import type { EngineId } from "./providers";
import type { CliUpdateFlow } from "./useCliUpdateFlow";

/**
 * One-click CLI install/update dialog (CLI 一键安装): shows the exact
 * execution plan (将执行 + 手动命令) for confirmation, then streams the
 * installer output live while the run is active. All state lives in
 * useCliUpdateFlow; this component is pure rendering.
 *
 * While a run is active the dialog can't be dismissed (no X, Escape and
 * outside-press are swallowed by flow.close) — closing mid-run would
 * suggest the install stopped when it didn't.
 */
export function CliUpdateDialog({ engine, flow }: { engine: EngineId; flow: CliUpdateFlow }) {
  const { t } = useTranslation();
  const { state } = flow;
  const logRef = useRef<HTMLPreElement>(null);

  // Keep the log pinned to the newest line.
  useEffect(() => {
    const el = logRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [state.logs]);

  if (state.status === "idle") return null;

  const running = state.status === "running";
  const plan = state.plan;
  const showLog = running || state.status === "done" || (state.status === "error" && plan);

  return (
    <ModalShell
      onClose={flow.close}
      className="max-h-[calc(100vh-48px)] w-[560px] max-w-[calc(100vw-32px)] overflow-y-auto p-6"
    >
      <div className="flex items-start justify-between gap-4">
        <p className="text-title-3-medium text-text-primary">{t("settings.cliUpdateTitle")}</p>
        {!running && (
          <button
            type="button"
            aria-label={t("common.cancel")}
            onClick={flow.close}
            className="flex size-7 shrink-0 items-center justify-center rounded-lg text-foreground-icon-secondary hover:bg-background-secondary-hover hover:text-foreground-icon-primary"
          >
            <X className="size-4" aria-hidden />
          </button>
        )}
      </div>
      <p className="mt-1.5 text-body-2-regular text-text-secondary">
        {t("settings.cliUpdateDialogDesc")}
      </p>

      <div className="mt-4 flex flex-col gap-3">
        {state.status === "planning" && (
          <p className="text-body-2-regular text-text-secondary">
            {t("settings.cliUpdatePlanning")}
          </p>
        )}

        {plan && (
          <>
            <div className="flex flex-wrap items-center gap-1.5">
              <PlanPill label={t("settings.cliUpdateEngine", { engine: t(`settings.engines.${engine}`) })} />
              <PlanPill
                label={
                  plan.action === "update"
                    ? t("settings.cliUpdateActionUpdate")
                    : t("settings.cliUpdateActionInstall")
                }
              />
              <PlanPill label={t("settings.cliUpdateKind", { kind: plan.kind })} />
              <PlanPill label={t("settings.cliUpdatePlatform", { platform: plan.platform })} />
            </div>

            {plan.blockers.length > 0 && (
              <div className="flex flex-col gap-1">
                {plan.blockers.map((blocker) => (
                  <p key={blocker} className="text-body-2-regular text-text-error-primary">
                    {blocker}
                  </p>
                ))}
              </div>
            )}

            {plan.command.length > 0 && (
              <PlanCommand
                label={t("settings.cliUpdatePlanCommand")}
                command={plan.command.join(" ")}
              />
            )}
            {plan.manualCommand && (
              <PlanCommand
                label={t("settings.cliUpdateManualCommand")}
                command={plan.manualCommand}
              />
            )}
          </>
        )}

        {showLog && (
          <div className="flex flex-col gap-1">
            <p className="text-body-2-medium text-text-secondary">
              {t("settings.cliUpdateLiveLog")}
            </p>
            <pre
              ref={logRef}
              className="max-h-56 overflow-y-auto rounded-lg bg-background-secondary-default p-2 font-mono text-xs whitespace-pre-wrap break-all text-text-primary"
            >
              {state.logs.length > 0
                ? state.logs.map((line) => `[${line.stream}] ${line.text}`).join("\n")
                : t("settings.cliUpdateWaitingOutput")}
            </pre>
          </div>
        )}

        {state.status === "done" && (
          <p className="text-body-2-medium text-state-success-text">
            {t("settings.cliUpdateSucceeded")}
          </p>
        )}
        {state.status === "error" && state.error && (
          <p role="alert" className="text-body-2-regular text-text-error-primary">
            {state.error}
          </p>
        )}
      </div>

      <div className="mt-5 flex justify-end gap-2">
        {running ? (
          <Button size="small" disabled>
            {t("settings.cliUpdateRunning")}
          </Button>
        ) : state.status === "done" ? (
          <Button size="small" autoFocus onClick={flow.close}>
            {t("settings.cliUpdateClose")}
          </Button>
        ) : (
          <>
            <Button variant="secondary" size="small" onClick={flow.close}>
              {t("common.cancel")}
            </Button>
            {state.status === "error" ? (
              <Button
                size="small"
                autoFocus
                onClick={() => void (plan ? flow.confirm() : flow.begin())}
              >
                {t("settings.cliUpdateRetry")}
              </Button>
            ) : (
              <Button
                size="small"
                autoFocus
                disabled={state.status !== "ready" || !plan?.canRun}
                onClick={() => void flow.confirm()}
              >
                {t("settings.cliUpdateConfirm")}
              </Button>
            )}
          </>
        )}
      </div>
    </ModalShell>
  );
}

function PlanPill({ label }: { label: string }) {
  return (
    <span className="rounded-full bg-background-tertiary-default px-2 py-0.5 text-caption-1-medium text-text-secondary">
      {label}
    </span>
  );
}

function PlanCommand({ label, command }: { label: string; command: string }) {
  return (
    <div className="flex flex-col gap-1">
      <p className="text-body-2-medium text-text-secondary">{label}</p>
      <pre className="rounded-lg bg-background-secondary-default p-2 font-mono text-xs whitespace-pre-wrap break-all text-text-primary">
        {command}
      </pre>
    </div>
  );
}
