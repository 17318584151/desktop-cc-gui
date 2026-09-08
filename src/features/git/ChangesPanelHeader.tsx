import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import Plus from "lucide-react/dist/esm/icons/plus";
import Search from "lucide-react/dist/esm/icons/search";
import ChevronDown from "lucide-react/dist/esm/icons/chevron-down";
import CloudDownload from "lucide-react/dist/esm/icons/cloud-download";
import GitBranch from "lucide-react/dist/esm/icons/git-branch";
import RefreshCw from "lucide-react/dist/esm/icons/refresh-cw";
import CloudUpload from "lucide-react/dist/esm/icons/cloud-upload";
import { Button } from "@/components/base/buttons/button";
import { IconButton } from "@/components/base/buttons/icon-button";
import {
  Dropdown,
  DropdownDivider,
  DropdownItem,
  DropdownPopover,
  DropdownTrigger,
} from "@/components/base/dropdown/dropdown";
import { type BranchInfo } from "@/lib/ipc";
import { cx } from "@/utils/cx";
import { useGitStore } from "./store";

interface ChangesPanelHeaderProps {
  workspacePath: string;
  notRepo: boolean;
  branch: string | undefined;
  branches: BranchInfo[] | undefined;
  pending: Record<string, true>;
  /** First error to surface: a failed action, else the last refresh failure. */
  error: string | null;
  run: (key: string, action: () => Promise<unknown>) => void;
}

/** Title row with refresh/pull/push, the branch picker, and the new-branch form. */
export function ChangesPanelHeader({
  workspacePath,
  notRepo,
  branch,
  branches,
  pending,
  error,
  run,
}: ChangesPanelHeaderProps) {
  const { t } = useTranslation();
  const [branchOpen, setBranchOpen] = useState(false);
  const [creatingBranch, setCreatingBranch] = useState(false);
  const [newBranchName, setNewBranchName] = useState("");
  const [branchQuery, setBranchQuery] = useState("");

  // Stale filter text must not survive into the next open.
  useEffect(() => {
    if (!branchOpen) setBranchQuery("");
  }, [branchOpen]);

  const filteredBranches = useMemo(() => {
    const q = branchQuery.trim().toLowerCase();
    return (branches ?? []).filter(
      (b) => q.length === 0 || b.name.toLowerCase().includes(q),
    );
  }, [branches, branchQuery]);

  return (
    <div className="flex flex-col gap-2 border-b border-separator-border px-3 py-2.5">
      <div className="flex items-center gap-1.5">
        <span className="text-body-medium text-text-primary">{t("git.changes")}</span>
        <div className="ml-auto flex items-center gap-1">
          <IconButton
            icon={RefreshCw}
            size="small"
            aria-label={t("common.refresh")}
            disabled={pending.refresh === true}
            onClick={() =>
              run("refresh", () => useGitStore.getState().refresh(workspacePath, true))
            }
          />
          <IconButton
            icon={CloudDownload}
            size="small"
            aria-label={t("git.pull")}
            disabled={notRepo || pending.pull === true}
            onClick={() => run("pull", () => useGitStore.getState().pull(workspacePath))}
          />
          <IconButton
            icon={CloudUpload}
            size="small"
            aria-label={t("git.push")}
            disabled={notRepo || pending.push === true}
            onClick={() => run("push", () => useGitStore.getState().push(workspacePath))}
          />
        </div>
      </div>
      {!notRepo && (
        <div className="flex items-center gap-1">
          <Dropdown isOpen={branchOpen} onOpenChange={setBranchOpen}>
            <DropdownTrigger
              className={cx(
                "flex h-8 min-w-0 flex-1 items-center gap-1.5 rounded-lg border border-border-button-default",
                "px-2 text-body-medium text-text-primary shadow-xs",
                "hover:bg-background-secondary-hover",
              )}
            >
              <GitBranch
                aria-hidden
                className="size-4 shrink-0 text-foreground-icon-secondary"
              />
              <span className="truncate">{branch ?? "…"}</span>
              <ChevronDown
                aria-hidden
                className="ml-auto size-4 shrink-0 text-foreground-icon-tertiary"
              />
            </DropdownTrigger>
            <DropdownPopover aria-label={t("git.branch")} placement="bottom start">
              <div className="flex h-8 items-center gap-1.5 rounded-lg border border-border-button-default px-2">
                <Search
                  aria-hidden
                  className="size-4 shrink-0 text-foreground-icon-secondary"
                />
                <input
                  autoFocus
                  value={branchQuery}
                  onChange={(e) => setBranchQuery(e.target.value)}
                  placeholder={t("git.searchBranches")}
                  className="min-w-0 flex-1 bg-transparent text-body-medium text-text-primary outline-none placeholder:text-text-placeholder"
                />
              </div>
              <div className="flex max-h-64 flex-col gap-1 overflow-y-auto">
                {filteredBranches.map((b) => (
                  <DropdownItem
                    key={b.name}
                    selected={b.isCurrent}
                    className="px-2 py-1.5"
                    onSelect={() => {
                      setBranchOpen(false);
                      if (!b.isCurrent) {
                        run("checkout", () =>
                          useGitStore.getState().checkout(workspacePath, b.name),
                        );
                      }
                    }}
                  >
                    <span className="truncate text-body-medium text-text-primary">
                      {b.name}
                    </span>
                  </DropdownItem>
                ))}
                {filteredBranches.length === 0 && (
                  <span className="px-2 py-1.5 text-body-medium text-text-tertiary">
                    {t("git.noMatchingBranches")}
                  </span>
                )}
              </div>
              <DropdownDivider />
              <DropdownItem
                className="px-2 py-1.5"
                onSelect={() => {
                  setBranchOpen(false);
                  setCreatingBranch(true);
                }}
              >
                <Plus aria-hidden className="size-4 text-foreground-icon-secondary" />
                <span className="text-body-medium text-text-primary">
                  {t("git.newBranch")}
                </span>
              </DropdownItem>
            </DropdownPopover>
          </Dropdown>
        </div>
      )}
      {creatingBranch && (
        <form
          className="flex items-center gap-1"
          onSubmit={(e) => {
            e.preventDefault();
            const name = newBranchName.trim();
            if (name.length === 0 || pending.createBranch === true) return;
            run("createBranch", async () => {
              await useGitStore.getState().createBranch(workspacePath, name);
              setCreatingBranch(false);
              setNewBranchName("");
            });
          }}
        >
          <input
            autoFocus
            value={newBranchName}
            onChange={(e) => setNewBranchName(e.target.value)}
            placeholder={t("git.branchNamePlaceholder")}
            className={cx(
              "h-8 min-w-0 flex-1 rounded-lg border border-border-button-default px-2",
              "text-body-medium text-text-primary placeholder:text-text-placeholder",
              "outline-none focus:border-border-focus-ring",
            )}
          />
          <Button
            size="small"
            type="submit"
            disabled={newBranchName.trim().length === 0 || pending.createBranch === true}
          >
            {t("common.confirm")}
          </Button>
          <Button
            size="small"
            variant="ghost"
            onClick={() => {
              setCreatingBranch(false);
              setNewBranchName("");
            }}
          >
            {t("common.cancel")}
          </Button>
        </form>
      )}
      {error && (
        <p className="break-words text-xs text-text-error-primary">{error}</p>
      )}
    </div>
  );
}
