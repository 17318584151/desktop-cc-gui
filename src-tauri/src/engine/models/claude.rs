//! Claude's catalog comes from the CLI's own configuration, not the app's
//! provider channels: `claude --model` resolves the built-in aliases the
//! /model menu lists, and the CLI's configured default lives in
//! ~/.claude/settings.json (settings.local.json overrides it). No relay
//! probe: the /model menu is built into the CLI binary, so a channel's
//! /v1/models would list ids the CLI never offers.

use std::path::PathBuf;

use super::EngineModel;

/// Selectors `claude --model` accepts out of the box — exactly the five rows
/// the CLI's own /model menu lists, in menu order (no [1m] variants, no
/// extra "configured" row). "fable" only exists on newer CLI builds — the
/// catalog is advisory, an unresolvable pick fails at launch with the CLI's
/// own error.
const CLI_ALIASES: &[(&str, &str)] = &[
    ("default", "Default"),
    ("opus", "Opus"),
    ("fable", "Fable"),
    ("sonnet", "Sonnet"),
    ("haiku", "Haiku"),
];

/// The CLI's config root: $CLAUDE_CONFIG_DIR when set, else ~/.claude.
fn claude_config_dir() -> PathBuf {
    if let Some(dir) = std::env::var_os("CLAUDE_CONFIG_DIR") {
        if !dir.is_empty() {
            return PathBuf::from(dir);
        }
    }
    dirs::home_dir().expect("no home directory").join(".claude")
}

/// env keys that remap a built-in alias family to a custom model id,
/// mirroring the CLI's own /model menu ("Custom Opus model" rows).
const FAMILY_ENV_KEYS: &[(&str, &str, &str)] = &[
    // (alias family, env key, display name)
    ("opus", "ANTHROPIC_DEFAULT_OPUS_MODEL", "Opus"),
    ("sonnet", "ANTHROPIC_DEFAULT_SONNET_MODEL", "Sonnet"),
    ("haiku", "ANTHROPIC_DEFAULT_HAIKU_MODEL", "Haiku"),
    ("fable", "ANTHROPIC_DEFAULT_FABLE_MODEL", "Fable"),
];

/// The CLI's model configuration from ~/.claude/settings.json, merged per
/// field with settings.local.json winning (the CLI's own precedence).
#[derive(Default)]
struct CliModelConfig {
    /// env.ANTHROPIC_MODEL — the CLI's effective default model id.
    env_model: Option<String>,
    /// Top-level `model` key (an alias like "opus" or a raw id).
    model_key: Option<String>,
    /// env.ANTHROPIC_DEFAULT_<FAMILY>_MODEL overrides, keyed by family.
    overrides: std::collections::HashMap<String, String>,
}

impl CliModelConfig {
    /// The custom id a family alias resolves to, when overridden.
    fn override_for(&self, family: &str) -> Option<&str> {
        self.overrides.get(family).map(String::as_str)
    }

    /// The CLI's effective default model id: env.ANTHROPIC_MODEL beats the
    /// `model` key (the CLI applies settings env as real environment
    /// variables); a bare family alias there resolves through its override.
    fn resolved_default(&self) -> Option<String> {
        let raw = self.env_model.as_deref().or(self.model_key.as_deref())?;
        let family = raw.strip_suffix("[1m]").unwrap_or(raw);
        Some(self.override_for(family).unwrap_or(raw).to_string())
    }
}

fn read_cli_config() -> CliModelConfig {
    read_cli_config_from(&claude_config_dir())
}

fn read_cli_config_from(dir: &std::path::Path) -> CliModelConfig {
    let pick = |value: Option<&serde_json::Value>| {
        value
            .and_then(|m| m.as_str())
            .map(str::trim)
            .filter(|m| !m.is_empty())
            .map(str::to_string)
    };
    let mut config = CliModelConfig::default();
    // User settings first so the local file overrides per field.
    for name in ["settings.json", "settings.local.json"] {
        let Ok(content) = std::fs::read_to_string(dir.join(name)) else {
            continue;
        };
        let Ok(v) = serde_json::from_str::<serde_json::Value>(&content) else {
            continue;
        };
        let env = v.get("env");
        if let Some(m) = pick(env.and_then(|e| e.get("ANTHROPIC_MODEL"))) {
            config.env_model = Some(m);
        }
        if let Some(m) = pick(v.get("model")) {
            config.model_key = Some(m);
        }
        for (family, key, _) in FAMILY_ENV_KEYS {
            if let Some(m) = pick(env.and_then(|e| e.get(key))) {
                config.overrides.insert(family.to_string(), m);
            }
        }
    }
    config
}

/// Claude's picker catalog: the CLI's built-in aliases, default row first.
/// Aliases remapped via ANTHROPIC_DEFAULT_<FAMILY>_MODEL display the custom
/// id as the name with the CLI menu's "Custom <Family> model" subtitle —
/// the same rows the CLI's own /model menu renders.
pub(super) fn claude_models() -> Vec<EngineModel> {
    claude_models_from(read_cli_config())
}

fn claude_models_from(config: CliModelConfig) -> Vec<EngineModel> {
    let resolved_default = config.resolved_default();
    CLI_ALIASES
        .iter()
        .map(|(id, name)| {
            let display = FAMILY_ENV_KEYS
                .iter()
                .find(|(f, _, _)| *f == *id)
                .map(|(_, _, d)| *d);
            let custom = config.override_for(id);
            let (name, description) = match (display, custom) {
                (Some(display), Some(custom)) => (
                    Some(custom.to_string()),
                    Some(format!("Custom {display} model")),
                ),
                _ if *id == "default" => (
                    Some(name.to_string()),
                    resolved_default
                        .as_ref()
                        .map(|d| format!("Use the default model (currently {d})")),
                ),
                _ => (Some(name.to_string()), None),
            };
            EngineModel {
                id: id.to_string(),
                name,
                description,
                provider: "claude".to_string(),
                context_window: None,
            }
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn aliases_cover_the_cli_model_menu() {
        let ids: Vec<&str> = CLI_ALIASES.iter().map(|(id, _)| *id).collect();
        assert_eq!(ids, vec!["default", "opus", "fable", "sonnet", "haiku"]);
    }

    #[test]
    fn cli_config_local_overrides_user_per_field() {
        let dir = std::env::temp_dir().join(format!("ccgui-claude-test-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(
            dir.join("settings.json"),
            r#"{"model":"opus","env":{"ANTHROPIC_MODEL":"sonnet","ANTHROPIC_DEFAULT_OPUS_MODEL":"grok-4.5"}}"#,
        )
        .unwrap();
        std::fs::write(dir.join("settings.local.json"), r#"{"model":"haiku"}"#).unwrap();
        let config = read_cli_config_from(&dir);
        std::fs::remove_dir_all(&dir).ok();
        // Local `model` wins its field; the user file's env fields survive.
        assert_eq!(config.model_key.as_deref(), Some("haiku"));
        assert_eq!(config.env_model.as_deref(), Some("sonnet"));
        assert_eq!(config.override_for("opus"), Some("grok-4.5"));
        assert_eq!(config.override_for("sonnet"), None);
    }

    #[test]
    fn cli_config_reads_env_when_no_local_file() {
        let dir = std::env::temp_dir().join(format!("ccgui-claude-test2-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(
            dir.join("settings.json"),
            r#"{"model":"opus","env":{"ANTHROPIC_MODEL":"k3"}}"#,
        )
        .unwrap();
        let config = read_cli_config_from(&dir);
        std::fs::remove_dir_all(&dir).ok();
        // env.ANTHROPIC_MODEL outranks the `model` key within one file.
        assert_eq!(config.resolved_default().as_deref(), Some("k3"));
    }

    #[test]
    fn catalog_labels_overridden_aliases_like_the_cli_menu() {
        let dir = std::env::temp_dir().join(format!("ccgui-claude-test3-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(
            dir.join("settings.json"),
            r#"{"model":"opus","env":{
                "ANTHROPIC_MODEL":"grok-4.5",
                "ANTHROPIC_DEFAULT_OPUS_MODEL":"grok-4.5",
                "ANTHROPIC_DEFAULT_SONNET_MODEL":"grok-4.5",
                "ANTHROPIC_DEFAULT_HAIKU_MODEL":"grok-4.5",
                "ANTHROPIC_DEFAULT_FABLE_MODEL":"grok-4.5"
            }}"#,
        )
        .unwrap();
        let config = read_cli_config_from(&dir);
        std::fs::remove_dir_all(&dir).ok();
        // The /model menu's main label is the resolved custom id, with the
        // "Custom <Family> model" subtitle the CLI shows.
        let models = claude_models_from(config);
        let by_id = |id: &str| models.iter().find(|m| m.id == id).unwrap();
        let opus = by_id("opus");
        assert_eq!(opus.name.as_deref(), Some("grok-4.5"));
        assert_eq!(opus.description.as_deref(), Some("Custom Opus model"));
        assert_eq!(
            by_id("fable").description.as_deref(),
            Some("Custom Fable model")
        );
        let default = by_id("default");
        assert_eq!(default.name.as_deref(), Some("Default"));
        assert_eq!(
            default.description.as_deref(),
            Some("Use the default model (currently grok-4.5)")
        );
        // Exactly the CLI menu's five rows, "default" first — no extra
        // "configured" row, no [1m] variants.
        assert_eq!(models.len(), 5);
        assert_eq!(models[0].id, "default");
    }

    #[test]
    fn resolved_default_maps_alias_through_override() {
        let config = CliModelConfig {
            env_model: None,
            model_key: Some("opus[1m]".to_string()),
            overrides: [("opus".to_string(), "grok-4.5".to_string())]
                .into_iter()
                .collect(),
        };
        assert_eq!(config.resolved_default().as_deref(), Some("grok-4.5"));
        // A raw id passes through untouched.
        let config = CliModelConfig {
            env_model: Some("k3".to_string()),
            ..CliModelConfig::default()
        };
        assert_eq!(config.resolved_default().as_deref(), Some("k3"));
    }
}
