import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate, useSearchParams } from "react-router-dom";
import Settings from "lucide-react/dist/esm/icons/settings";
import Globe from "lucide-react/dist/esm/icons/globe";
import FolderSymlink from "lucide-react/dist/esm/icons/folder-symlink";
import Info from "lucide-react/dist/esm/icons/info";
import Smartphone from "lucide-react/dist/esm/icons/smartphone";
import { SettingsModal, type SettingsNavItem } from "@/components/application/settings/settings-modal";
import { GeneralSection } from "./GeneralSection";
import { ProxySection } from "./ProxySection";
import { WorkspacesSection } from "./WorkspacesSection";
import { CliConfigSection } from "./CliConfigSection";
import { AboutSection } from "./AboutSection";
import { WebAccessSection } from "./WebAccessSection";
import { EngineIcon } from "@/components/foundations/icons/engine-icon";
import { CLI_DISPLAY_NAMES } from "@/components/foundations/icons/engine-brands";
import { ENGINE_IDS, type EngineId } from "./providers";

/** Nav-rail mark for one CLI engine: the rail passes size classes but the
 *  dsh mark is an <img> with an intrinsic px size, so pin it at the rail's
 *  md size. */
const engineNavIcon = (engine: EngineId): SettingsNavItem["icon"] => {
  const EngineNavIcon = ({ className }: { className?: string }) => (
    <EngineIcon engine={engine} size={20} className={className} />
  );
  return EngineNavIcon;
};

/** Unknown page params fall back to General. */
const renderPage = (key: string) => {
  if (key.startsWith("cli:")) {
    const engine = key.slice(4) as EngineId;
    if ((ENGINE_IDS as readonly string[]).includes(engine)) {
      return <CliConfigSection engine={engine} />;
    }
  }
  if (key === "about") return <AboutSection />;
  if (key === "proxy") return <ProxySection />;
  if (key === "workspaces") return <WorkspacesSection />;
  if (key === "webAccess") return <WebAccessSection />;
  return <GeneralSection />;
};

/**
 * Settings route: overlay for the BoardUI settings modal. ChatPage itself is mounted once
 * by App on every route, so opening and closing settings never rebuilds
 * the chat tree.
 *
 * Nav mirrors the BoardUI "Settings/General" rail: one "Settings" group with
 * General, Mobile Access and About, then a "CLI 管理" group holding one
 * page per CLI (provider channels).
 */
export default function SettingsPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  // Legacy links land on a CLI 管理 page: ?page=cliConfig → first CLI,
  // ?page=dsh → the DSH engine page (its host section merged there).
  const rawPage = searchParams.get("page") ?? "general";
  const pageParam =
    rawPage === "cliConfig" ? `cli:${ENGINE_IDS[0]}` : rawPage === "dsh" ? "cli:dsh" : rawPage;

  const groups = useMemo(
    () => [
      {
        label: t("settings.title"),
        items: [
          { key: "general", label: t("settings.general"), icon: Settings },
          { key: "proxy", label: t("settings.proxy"), icon: Globe },
          { key: "workspaces", label: t("settings.workspaces"), icon: FolderSymlink },
          { key: "webAccess", label: t("settings.webAccess"), icon: Smartphone },
          { key: "about", label: t("settings.about"), icon: Info },
        ],
      },
      {
        label: t("settings.cliManage"),
        items: ENGINE_IDS.map((engine) => ({
          key: `cli:${engine}`,
          label: CLI_DISPLAY_NAMES[engine],
          icon: engineNavIcon(engine),
        })),
      },
    ],
    [t],
  );

  const titles = useMemo(
    () => {
      const map: Record<string, string> = {
        general: t("settings.general"),
        proxy: t("settings.proxy"),
        workspaces: t("settings.workspaces"),
        webAccess: t("settings.webAccess"),
        about: t("settings.about"),
      };
      for (const engine of ENGINE_IDS) map[`cli:${engine}`] = CLI_DISPLAY_NAMES[engine];
      return map;
    },
    [t],
  );

  return (
    <SettingsModal
      isOpen
      onClose={() => navigate("/")}
      defaultPage={pageParam}
      ariaLabel={t("settings.title")}
      groups={groups}
      titles={titles}
      renderPage={renderPage}
    />
  );
}
