use super::{
    command_for_binary, images, push_session_id, safe_prompt_arg, BuiltCommand, Engine,
    EngineEvent, SendRequest,
};
use serde_json::Value;

/// pi and omp are the same CLI protocol (omp is a fork of pi): identical
/// spawn args and NDJSON event stream, different binary + home dir.
pub struct PiFamilyEngine {
    pub id: &'static str,
    pub home_dir_name: &'static str, // ".pi" | ".omp"
}

pub fn pi() -> PiFamilyEngine {
    PiFamilyEngine {
        id: "pi",
        home_dir_name: ".pi",
    }
}

pub fn omp() -> PiFamilyEngine {
    PiFamilyEngine {
        id: "omp",
        home_dir_name: ".omp",
    }
}

impl Engine for PiFamilyEngine {
    fn id(&self) -> &'static str {
        self.id
    }

    fn supports_images(&self) -> bool {
        // Images go out as `@<path>` argv entries (the pi/omp print-mode file
        // reference contract); whether the configured provider admits image
        // content is provider-dependent, but the transport is supported.
        true
    }
    // Print mode runs tools without prompting and exposes no permission
    // flags: only "auto" is honest (the trait default).

    fn build_command(&self, req: &SendRequest, bin: &str) -> Result<BuiltCommand, String> {
        let mut cmd = command_for_binary(bin);
        cmd.arg("--print");
        cmd.arg("--mode");
        cmd.arg("json");
        if let Some(model) = req.model.as_deref() {
            cmd.arg("--model");
            cmd.arg(model);
        }
        // Both accept the full level vocabulary: low…max.
        if let Some(effort) = req.effort.as_deref() {
            cmd.arg("--thinking");
            cmd.arg(effort);
        }
        if let Some(session_id) = req.session_id.as_deref() {
            if !session_id.starts_with('-') {
                // pi supports `--session-id <id>`; omp dropped it, resume goes
                // through `-r/--resume` (accepts an ID prefix).
                if self.id == "omp" {
                    cmd.arg("--resume");
                } else {
                    cmd.arg("--session-id");
                }
                cmd.arg(session_id);
            }
        }
        // Image attachments as `@<abs path>` file references ahead of the
        // prompt. data: URLs can't be file-referenced; the frontend's paste
        // flow already materializes blobs to files, so anything left is
        // skipped here rather than breaking argv.
        for raw in &req.images {
            if let Some(absolute) = images::absolutize_image_path(raw, &req.workspace) {
                cmd.arg(format!("@{}", absolute.display()));
            }
        }
        cmd.arg(safe_prompt_arg(&req.prompt));
        Ok(BuiltCommand {
            command: cmd,
            stdin_payload: None,
            cleanup_files: Vec::new(),
            preassigned_session_id: None,
        })
    }

    fn parse_line(&self, line: &str, out: &mut Vec<EngineEvent>) {
        parse_pi_family_line(line, out);
    }
}

/// Shared NDJSON parser for pi and omp (`--mode json`).
fn parse_pi_family_line(line: &str, out: &mut Vec<EngineEvent>) {
    // Stream updates can include the entire growing message twice (message
    // and assistantMessageEvent.partial). Skip those snapshots without
    // allocating a JSON object tree for every token.
    #[derive(serde::Deserialize)]
    struct Envelope {
        #[serde(rename = "type")]
        kind: String,
        #[serde(rename = "assistantMessageEvent")]
        event: Option<Delta>,
    }
    #[derive(serde::Deserialize)]
    struct Delta {
        #[serde(rename = "type")]
        kind: String,
        delta: Option<String>,
    }
    let Ok(envelope) = serde_json::from_str::<Envelope>(line) else {
        return;
    };
    if envelope.kind == "message_update" {
        if let Some(delta) = envelope.event {
            if let Some(text) = delta.delta.filter(|text| !text.is_empty()) {
                match delta.kind.as_str() {
                    "text_delta" => out.push(EngineEvent::Delta(text)),
                    "thinking_delta" => out.push(EngineEvent::Thinking(text)),
                    _ => {}
                }
            }
        }
        return;
    }
    let event_type = envelope.kind.as_str();
    if !matches!(
        event_type,
        "session" | "tool_execution_start" | "message_end" | "turn_end" | "agent_end"
    ) {
        return;
    }
    let Ok(value) = serde_json::from_str::<Value>(line) else {
        return;
    };
    match event_type {
        "session" => {
            push_session_id(&value, "id", out);
        }
        "tool_execution_start" => {
            let name = value
                .get("toolName")
                .and_then(Value::as_str)
                .unwrap_or("tool");
            let intent = value.get("intent").and_then(Value::as_str);
            let path = value.get("args").and_then(super::tool_path_arg);
            out.push(EngineEvent::Message {
                role: "tool".to_string(),
                text: tool_label(name, intent),
                path,
            });
        }
        "message_end" => {
            if let Some(usage) = value
                .get("message")
                .and_then(|m| m.get("usage"))
                .filter(|u| !u.is_null())
            {
                out.push(EngineEvent::Usage(usage.clone()));
            }
            // A message-level error is one failed model call (e.g. an
            // upstream 429): the CLI retries and the turn continues, so this
            // is only a notice. turn_end/agent_end errors stay terminal.
            if let Some(error) = value
                .get("message")
                .and_then(|m| m.get("errorMessage"))
                .and_then(Value::as_str)
                .or_else(|| value.get("errorMessage").and_then(Value::as_str))
            {
                if !error.trim().is_empty() {
                    out.push(EngineEvent::Warn(error.trim().to_string()));
                }
            }
        }
        "turn_end" | "agent_end" => {
            if let Some(error) = value.get("errorMessage").and_then(Value::as_str) {
                if !error.trim().is_empty() {
                    out.push(EngineEvent::Error(error.trim().to_string()));
                }
            }
            // No terminal result event exists in this protocol; the runner
            // emits Done on clean EOF. agent_end still settles the turn.
            if event_type == "agent_end" {
                out.push(EngineEvent::Done {
                    session_id: None,
                    usage: None,
                });
            }
        }
        _ => {}
    }
}
/// Display label for a tool call: the human-readable intent when the CLI
/// provides one, prefixed with the tool name so the frontend's type
/// classification still sees the raw name token.
pub fn tool_label(name: &str, intent: Option<&str>) -> String {
    match intent {
        Some(intent) if !intent.trim().is_empty() && intent.trim() != name => {
            format!("{} · {}", name, intent.trim())
                .chars()
                .take(120)
                .collect()
        }
        _ => name.to_string(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn stream_updates_skip_snapshots_and_preserve_delta_order() {
        let mut out = Vec::new();
        for (kind, text) in [("thinking_delta", "思考\n"), ("text_delta", "答案\"你好\"")] {
            let snapshot =
                serde_json::json!({"content": [{"type": "text", "text": "长文本".repeat(20000)}]});
            let line = serde_json::json!({
                "type": "message_update", "message": snapshot,
                "assistantMessageEvent": {"type": kind, "delta": text, "partial": snapshot}
            })
            .to_string();
            parse_pi_family_line(&line, &mut out);
        }
        assert_eq!(out.len(), 2);
        assert!(matches!(&out[0], EngineEvent::Thinking(t) if t == "思考\n"));
        assert!(matches!(&out[1], EngineEvent::Delta(t) if t == "答案\"你好\""));
        for line in [
            r#"{"type":"message_update"}"#,
            r#"{"type":"message_update","assistantMessageEvent":{"type":"text_delta","delta":""}}"#,
            r#"{"type":"message_update","assistantMessageEvent":{"type":"toolcall_delta","delta":"ignored"}}"#,
            "{incomplete",
        ] {
            parse_pi_family_line(line, &mut out);
        }
        assert_eq!(out.len(), 2);
    }

    #[test]
    #[ignore = "manual parser throughput benchmark"]
    fn benchmark_snapshot_updates() {
        let snapshot = serde_json::json!({"content": (0..200).map(|_| serde_json::json!({"type":"text", "text":"x".repeat(320)})).collect::<Vec<_>>()});
        let line = serde_json::json!({"type":"message_update", "message":snapshot, "assistantMessageEvent":{"type":"text_delta", "delta":"token", "partial":snapshot}}).to_string();
        let start = std::time::Instant::now();
        for _ in 0..1000 {
            std::hint::black_box(serde_json::from_str::<Value>(&line).unwrap());
        }
        let full = start.elapsed();
        let start = std::time::Instant::now();
        let mut out = Vec::new();
        for _ in 0..1000 {
            out.clear();
            parse_pi_family_line(&line, &mut out);
            std::hint::black_box(&out);
        }
        eprintln!(
            "1000 snapshot updates ({} bytes): full JSON {:?}, delta parser {:?}",
            line.len(),
            full,
            start.elapsed()
        );
    }

    #[test]
    fn tool_execution_start_carries_args_path() {
        let line = serde_json::json!({
            "type": "tool_execution_start",
            "toolCallId": "tool_1",
            "toolName": "edit",
            "args": { "path": "src/app.tsx", "input": {} },
            "intent": "Adding chrome token"
        })
        .to_string();
        let mut out = Vec::new();
        parse_pi_family_line(&line, &mut out);
        match &out[0] {
            EngineEvent::Message { role, text, path } => {
                assert_eq!(role, "tool");
                assert_eq!(text, "edit · Adding chrome token");
                assert_eq!(path.as_deref(), Some("src/app.tsx"));
            }
            _ => panic!("expected tool message"),
        }

        // bash-style args carry no path key -> None.
        let line = serde_json::json!({
            "type": "tool_execution_start",
            "toolCallId": "tool_2",
            "toolName": "bash",
            "args": { "command": "ls" }
        })
        .to_string();
        let mut out = Vec::new();
        parse_pi_family_line(&line, &mut out);
        match &out[0] {
            EngineEvent::Message { path, .. } => assert_eq!(*path, None),
            _ => panic!("expected tool message"),
        }
    }
}
