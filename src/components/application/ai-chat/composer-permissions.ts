import {
  RiGitMergeLine,
  RiRouteLine,
  RiShieldCheckLine,
  RiSpeedUpFill,
} from "@remixicon/react";
import type { ComposerPermissionOption } from "./permission-menu";

/** The four permission modes, in menu order. Auto is the default. */
export const COMPOSER_PERMISSIONS: ComposerPermissionOption[] = [
  {
    id: "auto",
    labelKey: "permissionAuto",
    descriptionKey: "permissionAutoDesc",
    icon: RiSpeedUpFill,
  },
  {
    id: "manual",
    labelKey: "permissionManual",
    descriptionKey: "permissionManualDesc",
    icon: RiGitMergeLine,
    flip: true,
  },
  {
    id: "plan",
    labelKey: "permissionPlan",
    descriptionKey: "permissionPlanDesc",
    icon: RiRouteLine,
    flip: true,
  },
  {
    id: "bypass",
    labelKey: "permissionBypass",
    descriptionKey: "permissionBypassDesc",
    icon: RiShieldCheckLine,
  },
];
