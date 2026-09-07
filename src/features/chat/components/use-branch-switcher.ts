import { useCallback, useEffect, useState } from "react";
import { useGitStore } from "@/features/git/store";
import { errorText } from "@/lib/errors";
import type { ActiveSession } from "../store";

/** Status-bar branch switcher: the active workspace's current branch, its
 * branch list (refreshed on workspace change), and checkout with inline
 * error reporting. */
export function useBranchSwitcher(active: ActiveSession | null) {
  const branch = useGitStore((s) =>
    active ? s.statusByWorkspace[active.workspacePath]?.branch : undefined,
  );
  const branches = useGitStore((s) =>
    active ? s.branchesByWorkspace[active.workspacePath] : undefined,
  );
  // Branch list feeds the status-bar switcher; refresh on workspace change.
  useEffect(() => {
    if (active?.workspacePath) void useGitStore.getState().loadBranches(active.workspacePath);
  }, [active?.workspacePath]);
  const [branchError, setBranchError] = useState<string | null>(null);
  const handleBranchSelect = useCallback(
    (name: string) => {
      if (!active) return;
      setBranchError(null);
      void useGitStore
        .getState()
        .checkout(active.workspacePath, name)
        .catch((err: unknown) => setBranchError(errorText(err)));
    },
    [active],
  );
  return { branch, branches, branchError, handleBranchSelect };
}
