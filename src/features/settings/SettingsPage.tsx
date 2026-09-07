import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate, useSearchParams } from "react-router-dom";
import Settings from "lucide-react/dist/esm/icons/settings";
import Info from "lucide-react/dist/esm/icons/info";
import Smartphone from "lucide-react/dist/esm/icons/smartphone";
import SquareTerminal from "lucide-react/dist/esm/icons/square-terminal";
import { SettingsModal } from "@/components/application/settings/settings-modal";
import { GeneralSection } from "./GeneralSection";
import { CliConfigSection } from "./CliConfigSection";
import { AboutSection } from "./AboutSection";
import { WebAccessSection } from "./WebAccessSection";

/**
 * Settings route: overlay for the BoardUI settings modal. ChatPage itself is mounted once
 * by App on every route, so opening and closing settings never rebuilds
 * the chat tree.
 *
 * Nav mirrors the BoardUI "Settings/General" rail: one "Settings" group with
 * General, Mobile Access, CLI 配置 (provider channels) and About.
 */
export default function SettingsPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const pageParam = searchParams.get("page") ?? "general";

  const groups = useMemo(
    () => [
      {
        label: t("settings.title"),
        items: [
          { key: "general", label: t("settings.general"), icon: Settings },
          { key: "cliConfig", label: t("settings.cliConfig"), icon: SquareTerminal },
          { key: "webAccess", label: t("settings.webAccess"), icon: Smartphone },
          { key: "about", label: t("settings.about"), icon: Info },
        ],
      },
    ],
    [t],
  );

  const titles = useMemo(
    () => ({
      general: t("settings.general"),
      webAccess: t("settings.webAccess"),
      cliConfig: t("settings.cliConfig"),
      about: t("settings.about"),
    }),
    [t],
  );

  // Unknown page params fall back to General.
  const renderPage = (key: string) => {
    if (key === "about") return <AboutSection />;
    if (key === "webAccess") return <WebAccessSection />;
    if (key === "cliConfig") return <CliConfigSection />;
    return <GeneralSection />;
  };

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
