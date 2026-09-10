use serde::Serialize;
use std::collections::HashSet;
use std::path::{Path, PathBuf};
use std::sync::Arc;

/// Custom slash-command discovery for the composer's `/` picker (ported
/// from desktop-cc-gui's claude_commands.rs, trimmed to the two Claude
/// scopes the picker surfaces: the workspace's `.claude/commands` and the
/// CLI's global config home). Command markdown stays on disk — the CLI
/// expands `/name args` itself when the prompt is sent, so only the
/// metadata the menu renders crosses IPC.

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct SlashCommandEntry {
    /// Slash-less command name; directory segments join with `:`
    /// (`.claude/commands/aimax/plan.md` → `aimax:plan`).
    pub name: String,
    pub description: Option<String>,
    pub argument_hint: Option<String>,
    /// "workspace" (project `.claude/commands`) or "global" (CLI home).
    pub source: String,
}

fn sanitize_meta_value(value: &str) -> Option<String> {
    let mut val = value.trim().to_string();
    if val.len() >= 2 {
        let bytes = val.as_bytes();
        let first = bytes[0];
        let last = bytes[bytes.len() - 1];
        if (first == b'"' && last == b'"') || (first == b'\'' && last == b'\'') {
            val = val[1..val.len().saturating_sub(1)].to_string();
        }
    }
    let trimmed = val.trim();
    if trimmed.is_empty() {
        None
    } else {
        Some(trimmed.to_string())
    }
}

fn parse_meta_line(line: &str, description: &mut Option<String>, argument_hint: &mut Option<String>) {
    let Some((key, value)) = line.split_once(':') else {
        return;
    };
    let key = key.trim().to_ascii_lowercase();
    let value = sanitize_meta_value(value);
    match key.as_str() {
        "description" => {
            if let Some(value) = value {
                *description = Some(value);
            }
        }
        "argument-hint" | "argument_hint" | "argumenthint" => {
            if let Some(value) = value {
                *argument_hint = Some(value);
            }
        }
        _ => {}
    }
}

/// YAML-ish frontmatter between `---` fences. Only the fields the menu
/// renders are read; a `name:` override is honored by the caller via
/// `name_override`. Unterminated frontmatter means the file has none.
fn parse_command_frontmatter(
    content: &str,
) -> (Option<String>, Option<String>, Option<String>) {
    let mut segments = content.split_inclusive('\n');
    let Some(first_segment) = segments.next() else {
        return (None, None, None);
    };
    if first_segment.trim_end_matches(['\r', '\n']).trim() != "---" {
        return (None, None, None);
    }
    let mut name: Option<String> = None;
    let mut description: Option<String> = None;
    let mut argument_hint: Option<String> = None;
    for segment in segments {
        let line = segment.trim_end_matches(['\r', '\n']);
        let trimmed = line.trim();
        if trimmed == "---" {
            return (name, description, argument_hint);
        }
        if trimmed.is_empty() || trimmed.starts_with('#') {
            continue;
        }
        // `name` is parsed inline (not via parse_meta_line) so the file can
        // override the path-derived command name.
        if let Some((key, value)) = trimmed.split_once(':') {
            if key.trim().eq_ignore_ascii_case("name") {
                if let Some(value) = sanitize_meta_value(value) {
                    name = Some(value);
                }
                continue;
            }
        }
        parse_meta_line(trimmed, &mut description, &mut argument_hint);
    }
    (None, None, None)
}

/// Path-derived command name: workspace-relative segments join with `:`,
/// the file stem is the last segment, README files are documentation, not
/// commands.
fn derive_command_name(path: &Path, root: &Path) -> Option<String> {
    let relative = path.strip_prefix(root).ok()?;
    let mut parts: Vec<String> = relative
        .components()
        .filter_map(|component| component.as_os_str().to_str().map(|value| value.to_string()))
        .collect();
    if parts.is_empty() {
        return None;
    }
    let file_name = parts.pop()?;
    let stem = Path::new(&file_name).file_stem().and_then(|value| value.to_str())?;
    if stem.eq_ignore_ascii_case("readme") {
        return None;
    }
    parts.push(stem.to_string());
    Some(parts.join(":"))
}

fn discover_commands_in(dir: &Path, root: &Path, source: &str) -> Vec<SlashCommandEntry> {
    let mut out: Vec<SlashCommandEntry> = Vec::new();
    let entries = match std::fs::read_dir(dir) {
        Ok(entries) => entries,
        Err(_) => return out,
    };
    for entry in entries.flatten() {
        let path = entry.path();
        let is_dir = std::fs::metadata(&path).map(|m| m.is_dir()).unwrap_or(false);
        if is_dir {
            out.extend(discover_commands_in(&path, root, source));
            continue;
        }
        let is_md = path
            .extension()
            .and_then(|s| s.to_str())
            .map(|ext| ext.eq_ignore_ascii_case("md"))
            .unwrap_or(false);
        if !is_md {
            continue;
        }
        if path
            .file_stem()
            .and_then(|value| value.to_str())
            .map(|stem| stem.eq_ignore_ascii_case("readme"))
            .unwrap_or(false)
        {
            continue;
        }
        let content = match std::fs::read_to_string(&path) {
            Ok(content) => content,
            Err(_) => continue,
        };
        let (name, description, argument_hint) = parse_command_frontmatter(&content);
        let resolved = name.or_else(|| derive_command_name(&path, root));
        let Some(resolved) = resolved else {
            continue;
        };
        let normalized = resolved.trim().trim_start_matches('/').to_string();
        if normalized.is_empty() {
            continue;
        }
        out.push(SlashCommandEntry {
            name: normalized,
            description,
            argument_hint,
            source: source.to_string(),
        });
    }
    out.sort_by(|a, b| a.name.cmp(&b.name));
    out
}

/// Merge source lists in priority order: the first source defining a
/// (lowercase) name wins, so workspace commands shadow global ones.
fn merge_commands_by_priority(sources: Vec<Vec<SlashCommandEntry>>) -> Vec<SlashCommandEntry> {
    let mut merged: Vec<SlashCommandEntry> = Vec::new();
    let mut seen_names: HashSet<String> = HashSet::new();
    for source in sources {
        for entry in source {
            if seen_names.insert(entry.name.to_ascii_lowercase()) {
                merged.push(entry);
            }
        }
    }
    merged.sort_by(|a, b| a.name.cmp(&b.name));
    merged
}

/// Command directories in priority order: the workspace's `.claude/commands`
/// first, then the CLI config home's `commands` (honors CLAUDE_CONFIG_DIR —
/// the same root the history scanner reads).
fn commands_dirs(workspace_root: &Path) -> Vec<(PathBuf, &'static str)> {
    let mut dirs: Vec<(PathBuf, &'static str)> = Vec::new();
    let workspace_dir = workspace_root.join(".claude").join("commands");
    if workspace_dir.is_dir() {
        dirs.push((workspace_dir, "workspace"));
    }
    let global_dir = crate::engine::engine_home(Some("CLAUDE_CONFIG_DIR"), ".claude").join("commands");
    if global_dir.is_dir() {
        dirs.push((global_dir, "global"));
    }
    dirs
}

fn list_slash_commands_blocking(
    db: &crate::db::Db,
    path: &str,
) -> Result<Vec<SlashCommandEntry>, String> {
    let root = crate::files::ensure_allowed(path, db)?;
    let sources = commands_dirs(&root)
        .iter()
        .map(|(dir, source)| discover_commands_in(dir, dir, source))
        .collect();
    Ok(merge_commands_by_priority(sources))
}

#[tauri::command]
pub async fn list_slash_commands(
    db: tauri::State<'_, Arc<crate::db::Db>>,
    path: String,
) -> Result<Vec<SlashCommandEntry>, String> {
    let db = Arc::clone(db.inner());
    tauri::async_runtime::spawn_blocking(move || list_slash_commands_blocking(&db, &path))
        .await
        .map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    fn scratch_dir(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("ccgui-slash-{name}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn derives_namespaced_names_from_directories() {
        let root = scratch_dir("derive");
        let nested = root.join("aimax");
        fs::create_dir_all(&nested).unwrap();
        fs::write(nested.join("plan.md"), "# Plan\n").unwrap();
        fs::write(root.join("commit.md"), "# Commit\n").unwrap();
        fs::write(root.join("README.md"), "docs, not a command").unwrap();
        fs::write(root.join("notes.txt"), "not markdown").unwrap();

        let entries = discover_commands_in(&root, &root, "workspace");
        let names: Vec<&str> = entries.iter().map(|e| e.name.as_str()).collect();
        assert_eq!(names, vec!["aimax:plan", "commit"]);
    }

    #[test]
    fn frontmatter_overrides_name_and_carries_description() {
        let root = scratch_dir("frontmatter");
        fs::write(
            root.join("x.md"),
            "---\nname: custom:run\ndescription: \"运行流程\"\nargument-hint: [target]\n---\nbody\n",
        )
        .unwrap();
        let entries = discover_commands_in(&root, &root, "global");
        assert_eq!(entries.len(), 1);
        assert_eq!(entries[0].name, "custom:run");
        assert_eq!(entries[0].description.as_deref(), Some("运行流程"));
        assert_eq!(entries[0].argument_hint.as_deref(), Some("[target]"));
    }

    #[test]
    fn workspace_shadows_global_on_name_collision() {
        let merged = merge_commands_by_priority(vec![
            vec![SlashCommandEntry {
                name: "plan".into(),
                description: Some("workspace".into()),
                argument_hint: None,
                source: "workspace".into(),
            }],
            vec![SlashCommandEntry {
                name: "Plan".into(),
                description: Some("global".into()),
                argument_hint: None,
                source: "global".into(),
            }],
        ]);
        assert_eq!(merged.len(), 1);
        assert_eq!(merged[0].description.as_deref(), Some("workspace"));
    }
}
