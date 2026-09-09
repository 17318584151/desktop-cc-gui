use super::{
    command_for_binary, images, push_session_id, BuiltCommand, Engine,
    EngineEvent, SendRequest,
};
use serde_json::Value;

/// Codex one-shot: `codex exec --json` (verified against codex CLI live).
/// The legacy app used the persistent app-server JSON-RPC; exec mode gives
/// the same session files and item.completed messages without a daemon.
pub struct CodexEngine;

impl Engine for CodexEngine {
    fn id(&self) -> &'static str {
        "codex"
    }

    fn supports_images(&self) -> bool {
        true // -i/--image FILE
    }
    fn supported_permissions(&self) -> &'static [&'static str] {
        &["auto", "manual", "bypass"]
    }

    fn build_command(&self, req: &SendRequest, bin: &str) -> Result<BuiltCommand, String> {
        let mut cmd = command_for_binary(bin);
        cmd.arg("exec");
        let mut preassigned = None;
        if let Some(session_id) = req.session_id.as_deref() {
            // `codex exec resume [OPTIONS] [SESSION_ID] [PROMPT]`
            cmd.arg("resume");
            cmd.arg("--json");
            cmd.arg(session_id);
            preassigned = Some(session_id.to_string());
        } else {
            cmd.arg("--json");
        }
        cmd.arg("--skip-git-repo-check");
        // exec auto-declines approval prompts, so "manual" is enforced by the
        // sandbox instead: read-only means nothing can change without the
        // user re-sending in a writable mode. codex exec has no plan mode.
        // Sandbox goes through -c sandbox_mode (not --sandbox): `exec resume`
        // dropped the --sandbox flag, while -c works on both subcommands.
        match self.resolve_permission(req.permission.as_deref()) {
            "bypass" => {
                cmd.arg("--dangerously-bypass-approvals-and-sandbox");
            }
            "manual" => {
                cmd.arg("-c");
                cmd.arg("sandbox_mode=\"read-only\"");
            }
            _ => {
                cmd.arg("-c");
                cmd.arg("sandbox_mode=\"workspace-write\"");
            }
        }
        if let Some(model) = req.model.as_deref() {
            cmd.arg("-m");
            cmd.arg(model);
        }
        // Reasoning effort maps onto codex's config key (TOML value, so the string needs
        // quotes). Codex tops out at "xhigh"; clamp "max" onto it.
        if let Some(effort) = req.effort.as_deref() {
            let effort = if effort == "max" { "xhigh" } else { effort };
            cmd.arg("-c");
            cmd.arg(format!("model_reasoning_effort=\"{effort}\""));
        }
        for raw in &req.images {
            if let Some(path) = images::absolutize_image_path(raw, &req.workspace) {
                cmd.arg("-i");
                cmd.arg(path);
            }
        }
        // Prompt travels through stdin (`-`), never argv: on Windows the codex
        // shim is a `.cmd` batch file and cmd.exe cuts a multiline argument at
        // the first newline — every line after the first was dropped (or worse,
        // executed as a command). stdin also dodges cmd's `%VAR%` expansion of
        // quoted args. `codex exec [resume] -` reads the prompt from stdin.
        cmd.arg("-");
        Ok(BuiltCommand {
            command: cmd,
            stdin_payload: Some(req.prompt.clone()),
            cleanup_files: Vec::new(),
            preassigned_session_id: preassigned,
        })
    }

    fn parse_line(&self, line: &str, out: &mut Vec<EngineEvent>) {
        let Ok(value) = serde_json::from_str::<Value>(line) else {
            return;
        };
        let event_type = value.get("type").and_then(Value::as_str).unwrap_or("");
        match event_type {
            "thread.started" => {
                push_session_id(&value, "thread_id", out);
            }
            "item.completed" => {
                let Some(item) = value.get("item") else {
                    return;
                };
                match item.get("type").and_then(Value::as_str) {
                    Some("agent_message") => {
                        if let Some(text) = item.get("text").and_then(Value::as_str) {
                            if !text.is_empty() {
                                out.push(EngineEvent::Message {
                                    role: "assistant".to_string(),
                                    text: text.to_string(),
                                    path: None,
                                    todos: None,
                                });
                            }
                        }
                    }
                    Some("reasoning") => {
                        if let Some(text) = item.get("text").and_then(Value::as_str) {
                            if !text.is_empty() {
                                out.push(EngineEvent::Thinking(text.to_string()));
                            }
                        }
                    }
                    // codex exec has no delta events; tool calls surface as
                    // command_execution items.
                    Some("command_execution") => {
                        let name = item
                            .get("command")
                            .and_then(Value::as_str)
                            .unwrap_or("tool");
                        out.push(EngineEvent::Message {
                            role: "tool".to_string(),
                            text: name.chars().take(120).collect(),
                            path: None,
                            todos: None,
                        });
                    }
                    _ => {}
                }
            }
            "turn.completed" => {
                let usage = value.get("usage").cloned();
                out.push(EngineEvent::Done {
                    session_id: None,
                    usage,
                });
            }
            "turn.failed" | "error" => {
                let message = value
                    .get("error")
                    .and_then(|e| e.get("message").or(Some(e)).and_then(Value::as_str))
                    .or_else(|| value.get("message").and_then(Value::as_str))
                    .unwrap_or("codex turn failed")
                    .to_string();
                out.push(EngineEvent::Error(message));
            }
            _ => {}
        }
    }
}
