import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import type { Key } from "react";
import { useShallow } from "zustand/react/shallow";
import GripVertical from "lucide-react/dist/esm/icons/grip-vertical";
import Pencil from "lucide-react/dist/esm/icons/pencil";
import Plus from "lucide-react/dist/esm/icons/plus";
import Trash2 from "lucide-react/dist/esm/icons/trash-2";
import {
  SettingsCard,
  SettingsRow,
  SettingsSectionLabel,
} from "@/components/application/settings/settings-rows";
import {
  WorkspaceSortableList,
  type RepoDragChrome,
} from "@/components/application/ai-chat/workspace-sortable-list";
import { Input } from "@/components/base/input/input";
import { Button } from "@/components/base/buttons/button";
import { Select, SelectItem } from "@/components/base/select/select";
import { ConfirmDialog } from "@/components/dialogs";
import { ipc, type WorkspaceGroup } from "@/lib/ipc";
import { isWeb } from "@/lib/transport";
import { useChatStore, sortedWorkspaceGroups } from "@/features/chat/store";
import { Badge, ROW } from "./CliChannelRow";

/** Compact select trigger (h 32, radius/lg), matching GeneralSection rows. */
const SELECT_TRIGGER = "h-8 w-auto gap-1 rounded-lg px-2 py-1.5";
/** Ghost icon action button, same chrome as CliChannelRow's edit/delete. */
const ROW_ACTION =
  "flex size-7 shrink-0 items-center justify-center rounded-lg text-foreground-icon-secondary hover:bg-background-secondary-hover hover:text-foreground-icon-primary disabled:opacity-40";

/**
 * Inline name field for both create and rename. Enter / the confirm button
 * commits — validation errors stay inline in the field and keep it open;
 * Escape or leaving the field cancels. The confirm button prevents default
 * on pointer-down so its click isn't pre-empted by the input's blur-cancel.
 */
function GroupNameEditor({
  initial = "",
  placeholder,
  submitLabel,
  onCommit,
  onCancel,
}: {
  initial?: string;
  placeholder?: string;
  submitLabel: string;
  /** Returns a localized validation error, or null when the name was accepted. */
  onCommit: (name: string) => string | null;
  onCancel: () => void;
}) {
  const [value, setValue] = useState(initial);
  const [hint, setHint] = useState<string | null>(null);
  const commit = () => setHint(onCommit(value));
  return (
    <>
      <Input
        autoFocus
        size="small"
        className="min-w-0 flex-1"
        placeholder={placeholder}
        isInvalid={Boolean(hint)}
        hint={hint ?? undefined}
        value={value}
        onChange={(v) => {
          setValue(v);
          if (hint) setHint(null);
        }}
        onKeyDown={(e) => {
          // Enter/Escape during IME composition (e.g. picking a Chinese
          // candidate) belong to the IME — never submit or cancel.
          if (e.nativeEvent.isComposing) return;
          if (e.key === "Enter") {
            e.preventDefault();
            commit();
          } else if (e.key === "Escape") {
            e.preventDefault();
            onCancel();
          }
        }}
        onBlur={onCancel}
      />
      <Button
        variant="primary"
        size="small"
        className="shrink-0"
        disabled={!value.trim()}
        onPointerDown={(e) => e.preventDefault()}
        onClick={commit}
      >
        {submitLabel}
      </Button>
    </>
  );
}

/**
 * 工作区二级分类 settings: group CRUD (create / rename / drag-reorder /
 * delete) plus per-project group assignment. State lives in the chat store
 * so the sidebar tree reflects edits immediately. Rows reuse the CLI config
 * page's chrome: drag grip (WorkspaceSortableList), inline name editing,
 * ghost icon actions.
 */
export function WorkspacesSection() {
  const { t } = useTranslation();
  const { workspaces, workspaceGroups } = useChatStore(
    useShallow((s) => ({
      workspaces: s.workspaces,
      workspaceGroups: s.workspaceGroups,
    })),
  );
  const {
    createWorkspaceGroup,
    renameWorkspaceGroup,
    reorderWorkspaceGroups,
    deleteWorkspaceGroup,
    assignWorkspaceGroup,
  } = useChatStore(
    useShallow((s) => ({
      createWorkspaceGroup: s.createWorkspaceGroup,
      renameWorkspaceGroup: s.renameWorkspaceGroup,
      reorderWorkspaceGroups: s.reorderWorkspaceGroups,
      deleteWorkspaceGroup: s.deleteWorkspaceGroup,
      assignWorkspaceGroup: s.assignWorkspaceGroup,
    })),
  );

  const [adding, setAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<WorkspaceGroup | null>(null);
  // On-demand directory grants (lib/grant.ts flow); desktop-only commands,
  // so the card stays hidden for web-access clients.
  const [grantedRoots, setGrantedRoots] = useState<string[] | null>(null);
  const [revoking, setRevoking] = useState<string | null>(null);

  useEffect(() => {
    if (isWeb) return;
    let cancelled = false;
    ipc
      .listGrantedRoots()
      .then((roots) => {
        if (!cancelled) setGrantedRoots(roots);
      })
      // A load failure here must not block group editing; same surface.
      .catch((e) => setError(e instanceof Error ? e.message : String(e)));
    return () => {
      cancelled = true;
    };
  }, []);

  const orderedGroups = sortedWorkspaceGroups(workspaceGroups);
  const memberCount = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const w of workspaces) {
      if (w.groupId) counts[w.groupId] = (counts[w.groupId] ?? 0) + 1;
    }
    return counts;
  }, [workspaces]);

  /** Localized pre-validation; the store re-checks as the source of truth. */
  const validateName = (name: string, excludeId?: string): string | null => {
    const trimmed = name.trim();
    if (!trimmed) return t("settings.groupNameRequired");
    if (orderedGroups.some((g) => g.id !== excludeId && g.name === trimmed)) {
      return t("settings.groupNameDuplicate");
    }
    return null;
  };

  const reportFailure = (e: unknown) => setError(e instanceof Error ? e.message : String(e));

  const commitCreate = (name: string): string | null => {
    const invalid = validateName(name);
    if (invalid) return invalid;
    setAdding(false);
    setError(null);
    void createWorkspaceGroup(name).catch(reportFailure);
    return null;
  };

  const commitRename = (id: string, name: string): string | null => {
    const invalid = validateName(name, id);
    if (invalid) return invalid;
    setRenamingId(null);
    setError(null);
    const group = orderedGroups.find((g) => g.id === id);
    if (group && name.trim() !== group.name) {
      void renameWorkspaceGroup(id, name).catch(reportFailure);
    }
    return null;
  };

  const handleAssign = (workspaceId: string, key: Key | null) => {
    if (key == null) return;
    const groupId = String(key);
    setError(null);
    void assignWorkspaceGroup(workspaceId, groupId || null).catch(reportFailure);
  };

  const renderGroup = (group: WorkspaceGroup, drag: RepoDragChrome | null) => {
    if (renamingId === group.id) {
      return (
        <div className={ROW}>
          <GroupNameEditor
            initial={group.name}
            submitLabel={t("common.save")}
            onCommit={(name) => commitRename(group.id, name)}
            onCancel={() => setRenamingId(null)}
          />
        </div>
      );
    }
    return (
      <div className={ROW}>
        {drag && (
          <button
            type="button"
            aria-label={t("settings.dragGroup")}
            title={t("settings.dragGroup")}
            {...(drag.dragHandleProps ?? {})}
            onClick={(e) => e.stopPropagation()}
            className={`${ROW_ACTION} cursor-grab touch-none`}
          >
            <GripVertical className="size-4" aria-hidden />
          </button>
        )}
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <p className="truncate text-body-regular text-text-primary">{group.name}</p>
          <Badge>
            {t("settings.groupProjectCount", { count: memberCount[group.id] ?? 0 })}
          </Badge>
        </div>
        <button
          type="button"
          aria-label={t("settings.renameGroup")}
          title={t("settings.renameGroup")}
          onClick={() => setRenamingId(group.id)}
          className={ROW_ACTION}
        >
          <Pencil className="size-4" aria-hidden />
        </button>
        <button
          type="button"
          aria-label={t("common.delete")}
          title={t("common.delete")}
          onClick={() => setDeleting(group)}
          className={`${ROW_ACTION} hover:text-text-error-primary`}
        >
          <Trash2 className="size-4" aria-hidden />
        </button>
      </div>
    );
  };

  return (
    <div className="flex w-full flex-col gap-6">
      {error && (
        <p role="alert" className="text-body-regular text-text-error-primary">
          {t("common.error")}: {error}
        </p>
      )}

      <div className="flex w-full flex-col gap-2">
        <div className="flex items-center justify-between gap-3">
          <SettingsSectionLabel>
            {t("settings.workspaceGroups")}
            <span className="ml-2 text-body-2-regular font-normal text-text-tertiary">
              {t("settings.workspaceGroupsDesc")}
            </span>
          </SettingsSectionLabel>
          <Button
            size="small"
            leadingIcon={Plus}
            disabled={adding}
            onClick={() => {
              setRenamingId(null);
              setAdding(true);
            }}
            className="shrink-0"
          >
            {t("settings.addGroup")}
          </Button>
        </div>

        {orderedGroups.length === 0 && !adding ? (
          <div className="rounded-2xl border border-dashed border-border-button-default px-4 py-6 text-center">
            <p className="text-body-medium text-text-primary">{t("settings.noGroupsYet")}</p>
            <p className="mt-1 text-body-2-regular text-text-secondary">
              {t("settings.noGroupsDesc")}
            </p>
          </div>
        ) : (
          <SettingsCard>
            <WorkspaceSortableList
              items={orderedGroups}
              onReorder={(ids) => {
                setError(null);
                void reorderWorkspaceGroups(ids).catch(reportFailure);
              }}
              renderItem={renderGroup}
            />
            {adding && (
              <div className={ROW}>
                <GroupNameEditor
                  placeholder={t("settings.newGroupPlaceholder")}
                  submitLabel={t("common.create")}
                  onCommit={commitCreate}
                  onCancel={() => setAdding(false)}
                />
              </div>
            )}
          </SettingsCard>
        )}
      </div>

      {/* A group dropdown with only "未分组" is noise: the assignment list
          only makes sense once at least one group exists. */}
      {orderedGroups.length > 0 && workspaces.length > 0 && (
        <div className="flex w-full flex-col gap-2">
          <SettingsSectionLabel>
            {t("settings.projects")}
            <span className="ml-2 text-body-2-regular font-normal text-text-tertiary">
              {t("settings.projectsDesc")}
            </span>
          </SettingsSectionLabel>
          <SettingsCard>
            {workspaces.map((workspace) => (
              <SettingsRow
                key={workspace.id}
                label={workspace.name}
                description={workspace.path}
              >
                <Select
                  aria-label={t("settings.projects")}
                  selectedKey={workspace.groupId ?? ""}
                  onSelectionChange={(key) => handleAssign(workspace.id, key)}
                  triggerClassName={SELECT_TRIGGER}
                >
                  <SelectItem id="">{t("settings.ungrouped")}</SelectItem>
                  {orderedGroups.map((group) => (
                    <SelectItem key={group.id} id={group.id}>
                      {group.name}
                    </SelectItem>
                  ))}
                </Select>
              </SettingsRow>
            ))}
          </SettingsCard>
        </div>
      )}

      {deleting && (
        <ConfirmDialog
          danger
          message={t("settings.deleteGroupConfirm", { name: deleting.name })}
          onCancel={() => setDeleting(null)}
          onConfirm={() => {
            const id = deleting.id;
            setDeleting(null);
            setRenamingId((current) => (current === id ? null : current));
            setError(null);
            void deleteWorkspaceGroup(id).catch(reportFailure);
          }}
        />
      )}

      {!isWeb && grantedRoots && grantedRoots.length > 0 && (
        <div className="flex w-full flex-col gap-2">
          <SettingsSectionLabel>
            {t("settings.grantedRoots")}
            <span className="ml-2 text-body-2-regular font-normal text-text-tertiary">
              {t("settings.grantedRootsDesc")}
            </span>
          </SettingsSectionLabel>
          <SettingsCard>
            {grantedRoots.map((dir) => (
              <SettingsRow key={dir} label={dir}>
                <button
                  type="button"
                  aria-label={t("settings.revokeAccess")}
                  title={t("settings.revokeAccess")}
                  onClick={() => setRevoking(dir)}
                  className={`${ROW_ACTION} hover:text-text-error-primary`}
                >
                  <Trash2 className="size-4" aria-hidden />
                </button>
              </SettingsRow>
            ))}
          </SettingsCard>
        </div>
      )}

      {revoking && (
        <ConfirmDialog
          danger
          message={t("settings.revokeAccessConfirm", { dir: revoking })}
          onCancel={() => setRevoking(null)}
          onConfirm={() => {
            const dir = revoking;
            setRevoking(null);
            setError(null);
            void ipc
              .revokeGrantedRoot(dir)
              .then(() =>
                setGrantedRoots((roots) => roots?.filter((r) => r !== dir) ?? roots),
              )
              .catch(reportFailure);
          }}
        />
      )}
    </div>
  );
}
