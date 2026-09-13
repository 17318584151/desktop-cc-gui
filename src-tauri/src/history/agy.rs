//! Antigravity (`agy`) conversations are sqlite + protobuf, not NDJSON.
//!
//! User text is taken from `~/.gemini/antigravity-cli/history.jsonl` (the
//! CLI's own prompt log). Assistant / tool text is pulled out of
//! length-delimited UTF-8 strings in each `steps.step_payload` blob.

use super::{Message, ParsedSession, ScanSummary};
use serde::Deserialize;
use std::path::Path;

/// `steps.step_type` values observed on agy 1.2.x.
const STEP_USER: i64 = 14;
const STEP_ASSISTANT: i64 = 15;
const STEP_TOOL: i64 = 132;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct HistoryLine {
    display: Option<String>,
    timestamp: Option<i64>,
    conversation_id: Option<String>,
}

struct UserTurn {
    text: String,
    ts_ms: Option<i64>,
}

pub(super) fn parse_agy_session(path: &Path) -> ParsedSession {
    let id = conversation_id(path);
    let mut users = load_user_turns(id.as_deref());
    let mut user_iter = users.drain(..);
    let mut messages = Vec::new();
    let mut seq = 0i64;

    if let Some(steps) = load_steps(path) {
        for (step_type, payload) in steps {
            let strings = proto_strings(&payload);
            match step_type {
                STEP_USER => {
                    if let Some(turn) = user_iter.next() {
                        seq += 1;
                        messages.push(plain_message(seq, "user", turn.text, turn.ts_ms));
                    }
                }
                STEP_ASSISTANT => {
                    if let Some(text) = pick_assistant(&strings) {
                        seq += 1;
                        messages.push(plain_message(seq, "assistant", text, None));
                    } else if let Some(tool) = pick_tool_json(&strings) {
                        seq += 1;
                        messages.push(tool_message(seq, tool));
                    }
                }
                STEP_TOOL => {
                    if let Some(tool) = pick_tool_json(&strings) {
                        seq += 1;
                        messages.push(tool_message(seq, tool));
                    } else if let Some(err) = pick_error(&strings) {
                        seq += 1;
                        messages.push(plain_message(seq, "assistant", err, None));
                    }
                }
                _ => {}
            }
        }
    }

    // Conversation db unreadable / older than the prompt log: still show users.
    for turn in user_iter {
        seq += 1;
        messages.push(plain_message(seq, "user", turn.text, turn.ts_ms));
    }

    ParsedSession { messages }
}

pub(super) fn scan_agy_summary(path: &Path) -> ScanSummary {
    let parsed = parse_agy_session(path);
    let mut first_ts = None;
    let mut last_ts = None;
    let mut title = String::new();
    let mut preview = String::new();
    for msg in &parsed.messages {
        let ts = msg.ts.as_deref().and_then(super::parse_ts_ms_str);
        if first_ts.is_none() {
            first_ts = ts;
        }
        if ts.is_some() {
            last_ts = ts;
        }
        if title.is_empty() && msg.role == "user" && !msg.text.trim().is_empty() {
            title = msg.text.chars().take(80).collect();
        }
        if !msg.text.trim().is_empty() && (msg.role == "assistant" || msg.role == "user") {
            preview = msg.text.chars().take(160).collect();
        }
    }

    if title.is_empty() {
        if let Some((stored, stored_preview, _)) = summary_row(path) {
            title = stored;
            if preview.is_empty() {
                preview = stored_preview;
            }
        }
    }
    if title.trim().is_empty() {
        title = "Antigravity".to_string();
    }

    let message_count = parsed
        .messages
        .iter()
        .filter(|m| m.role == "user" || m.role == "assistant")
        .count() as i64;

    ScanSummary {
        title,
        preview,
        first_ts,
        last_ts,
        message_count,
    }
}

fn conversation_id(path: &Path) -> Option<String> {
    path.file_stem()
        .and_then(|s| s.to_str())
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(str::to_string)
}

fn load_user_turns(conversation_id: Option<&str>) -> Vec<UserTurn> {
    let Some(id) = conversation_id else {
        return Vec::new();
    };
    let path = crate::engine::agy::agy_home().join("history.jsonl");
    let Ok(text) = std::fs::read_to_string(path) else {
        return Vec::new();
    };
    let mut out = Vec::new();
    for line in text.lines() {
        let Ok(row) = serde_json::from_str::<HistoryLine>(line) else {
            continue;
        };
        if row.conversation_id.as_deref() != Some(id) {
            continue;
        }
        let Some(display) = row
            .display
            .as_deref()
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .map(str::to_string)
        else {
            continue;
        };
        out.push(UserTurn {
            text: display,
            ts_ms: row.timestamp,
        });
    }
    out
}

fn summary_row(path: &Path) -> Option<(String, String, i64)> {
    let id = conversation_id(path)?;
    let db = crate::engine::agy::agy_home().join("conversation_summaries.db");
    let conn = rusqlite::Connection::open_with_flags(
        db,
        rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY,
    )
    .ok()?;
    conn.query_row(
        "SELECT title, preview, step_count FROM conversation_summaries WHERE conversation_id = ?1",
        rusqlite::params![id],
        |r| {
            Ok((
                r.get::<_, String>(0)?,
                r.get::<_, String>(1)?,
                r.get::<_, i64>(2)?,
            ))
        },
    )
    .ok()
}

fn load_steps(path: &Path) -> Option<Vec<(i64, Vec<u8>)>> {
    let conn = rusqlite::Connection::open_with_flags(
        path,
        rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY,
    )
    .ok()?;
    let mut stmt = conn
        .prepare("SELECT step_type, step_payload FROM steps ORDER BY idx")
        .ok()?;
    let rows = stmt
        .query_map([], |r| Ok((r.get::<_, i64>(0)?, r.get::<_, Vec<u8>>(1)?)))
        .ok()?;
    Some(rows.flatten().collect())
}

fn plain_message(seq: i64, role: &str, text: String, ts_ms: Option<i64>) -> Message {
    Message {
        seq,
        role: role.to_string(),
        text,
        ts: ts_ms.map(|n| n.to_string()),
        path: None,
        args: None,
        result: None,
        todos: None,
        usage: None,
        model: None,
        effort: None,
        duration_ms: None,
        images: Vec::new(),
    }
}

fn tool_message(seq: i64, value: serde_json::Value) -> Message {
    let name = value
        .get("toolSummary")
        .or_else(|| value.get("toolAction"))
        .and_then(|v| v.as_str())
        .unwrap_or("tool")
        .to_string();
    let path = ["DirectoryPath", "path", "file_path", "filePath"]
        .iter()
        .find_map(|k| value.get(*k).and_then(|v| v.as_str()))
        .map(str::to_string);
    Message {
        seq,
        role: "tool".to_string(),
        text: name,
        ts: None,
        path,
        args: Some(value),
        result: None,
        todos: None,
        usage: None,
        model: None,
        effort: None,
        duration_ms: None,
        images: Vec::new(),
    }
}

fn pick_assistant(texts: &[String]) -> Option<String> {
    let mut best: Option<&str> = None;
    for text in texts {
        if !looks_like_assistant(text) {
            continue;
        }
        best = Some(match best {
            None => text,
            Some(prev) => {
                let t_cjk = has_cjk(text);
                let p_cjk = has_cjk(prev);
                if t_cjk && !p_cjk {
                    text
                } else if t_cjk == p_cjk && text.len() > prev.len() {
                    text
                } else {
                    prev
                }
            }
        });
    }
    best.map(str::to_string)
}

fn pick_tool_json(texts: &[String]) -> Option<serde_json::Value> {
    texts
        .iter()
        .filter(|t| t.trim_start().starts_with('{'))
        .filter_map(|t| serde_json::from_str::<serde_json::Value>(t).ok())
        .find(|v| v.get("DirectoryPath").is_some() || v.get("toolSummary").is_some() || v.get("toolAction").is_some())
}

fn pick_error(texts: &[String]) -> Option<String> {
    texts
        .iter()
        .find(|t| t.contains("Permission denied") || t.contains("permission check failed"))
        .cloned()
}

fn looks_like_assistant(text: &str) -> bool {
    let t = text.trim();
    if t.len() < 8 || t.starts_with('{') || t.starts_with("bot-") || t.starts_with("file://") {
        return false;
    }
    if t.contains("command(*)") || t.contains("user_information") || t.contains("sessionID") {
        return false;
    }
    if looks_like_uuid(t) || !is_clean_text(t) || !starts_like_prose(t) {
        return false;
    }
    has_cjk(t) || (t.contains(' ') && t.len() > 24)
}

fn starts_like_prose(text: &str) -> bool {
    text.trim().chars().next().is_some_and(|c| {
        c.is_alphanumeric()
            || has_cjk_char(c)
            || matches!(c, '#' | '*' | '`' | '-' | '>' | '(' | '「' | '【')
    })
}

fn looks_like_uuid(text: &str) -> bool {
    let t = text.trim();
    t.len() == 36
        && t.as_bytes().get(8) == Some(&b'-')
        && t.bytes().filter(|b| *b == b'-').count() == 4
}

fn has_cjk(text: &str) -> bool {
    text.chars().any(has_cjk_char)
}

fn has_cjk_char(c: char) -> bool {
    ('\u{4e00}'..='\u{9fff}').contains(&c)
}

fn is_clean_text(text: &str) -> bool {
    text.chars()
        .all(|c| c == '\n' || c == '\r' || c == '\t' || !c.is_control())
}

fn proto_strings(buf: &[u8]) -> Vec<String> {
    let mut out = Vec::new();
    walk_proto(buf, 0, &mut out);
    out
}

fn walk_proto(buf: &[u8], depth: u8, out: &mut Vec<String>) {
    if depth > 8 {
        return;
    }
    let mut i = 0;
    while i < buf.len() {
        let Some((tag, i2)) = read_varint(buf, i) else {
            break;
        };
        match (tag & 7) as u32 {
            0 => match read_varint(buf, i2) {
                Some((_, n)) => i = n,
                None => break,
            },
            1 if i2 + 8 <= buf.len() => i = i2 + 8,
            5 if i2 + 4 <= buf.len() => i = i2 + 4,
            2 => {
                let Some((len, i3)) = read_varint(buf, i2) else {
                    break;
                };
                let end = i3.saturating_add(len as usize);
                if end > buf.len() {
                    i += 1;
                    continue;
                }
                let chunk = &buf[i3..end];
                if let Ok(s) = std::str::from_utf8(chunk) {
                    if is_clean_text(s) && !s.trim().is_empty() {
                        out.push(s.to_string());
                    }
                }
                if chunk.len() > 8 {
                    walk_proto(chunk, depth + 1, out);
                }
                i = end;
            }
            _ => i += 1,
        }
    }
}

fn read_varint(buf: &[u8], mut i: usize) -> Option<(u64, usize)> {
    let mut x = 0u64;
    let mut shift = 0;
    while i < buf.len() {
        let b = buf[i];
        i += 1;
        x |= u64::from(b & 0x7f) << shift;
        if b < 0x80 {
            return Some((x, i));
        }
        shift += 7;
        if shift > 63 {
            return None;
        }
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    fn encode_string_field(field: u64, text: &str) -> Vec<u8> {
        let mut out = Vec::new();
        let tag = (field << 3) | 2;
        write_varint(&mut out, tag);
        write_varint(&mut out, text.len() as u64);
        out.extend_from_slice(text.as_bytes());
        out
    }

    fn write_varint(out: &mut Vec<u8>, mut value: u64) {
        loop {
            let mut b = (value & 0x7f) as u8;
            value >>= 7;
            if value != 0 {
                b |= 0x80;
            }
            out.push(b);
            if value == 0 {
                break;
            }
        }
    }

    #[test]
    fn proto_walk_finds_nested_utf8() {
        // field 20 { field 1 = "你好世界 assistant reply here" }
        let inner = encode_string_field(1, "你好世界 assistant reply here");
        let outer = {
            let mut out = Vec::new();
            write_varint(&mut out, (20 << 3) | 2);
            write_varint(&mut out, inner.len() as u64);
            out.extend(inner);
            out
        };
        let texts = proto_strings(&outer);
        assert!(texts.iter().any(|t| t.contains("你好世界")), "{texts:?}");
        assert_eq!(
            pick_assistant(&texts).as_deref(),
            Some("你好世界 assistant reply here")
        );
    }

    #[test]
    fn assistant_prefers_cjk_over_english_summary() {
        let texts = vec![
            "The user asked about storage plans in general terms.".to_string(),
            "拥有 5TB 空间说明您使用的是高阶方案。".to_string(),
            "bot-539ad780-ed98-4a4c-af66-3f984f586b5c".to_string(),
        ];
        assert_eq!(
            pick_assistant(&texts).as_deref(),
            Some("拥有 5TB 空间说明您使用的是高阶方案。")
        );
    }

    #[test]
    fn parses_live_agy_conversation_if_present() {
        let path = crate::engine::agy::agy_home()
            .join("conversations")
            .join("b2b77a93-3b8a-4adc-b4c9-662b3259b760.db");
        if !path.is_file() {
            return;
        }
        let parsed = parse_agy_session(&path);
        assert!(
            parsed
                .messages
                .iter()
                .any(|m| m.role == "user" && m.text.contains("gemini")),
            "users: {:?}",
            parsed
                .messages
                .iter()
                .filter(|m| m.role == "user")
                .map(|m| &m.text)
                .collect::<Vec<_>>()
        );
        assert!(
            parsed
                .messages
                .iter()
                .any(|m| m.role == "assistant" && m.text.contains("套餐")),
            "roles: {:?}",
            parsed
                .messages
                .iter()
                .map(|m| (&m.role, m.text.chars().take(40).collect::<String>()))
                .collect::<Vec<_>>()
        );
    }

    #[test]
    fn tool_json_is_not_treated_as_assistant() {
        let json = r#"{"DirectoryPath":"/tmp","toolAction":"Checking","toolSummary":"Check config"}"#;
        assert!(pick_assistant(&[json.to_string()]).is_none());
        let value = pick_tool_json(&[json.to_string()]).unwrap();
        assert_eq!(value["toolSummary"], "Check config");
    }
}
