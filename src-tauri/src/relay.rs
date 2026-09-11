//! Outbound relay client: the desktop dials a Cloudflare Worker (see
//! `deploy/worker`) and serves the LAN bridge's port through it, so a phone
//! can reach the app from anywhere without the desktop opening an inbound
//! port or configuring router port-forwarding.
//!
//! Wire protocol (one WebSocket to `<worker>/agent?key=<secret>`, JSON text
//! frames, base64 payloads):
//!
//! - worker → desktop: `{"t":"open","id":N,"path":"/…","method":"GET",
//!   "headers":{…}}` for HTTP (`"ws":true` for a socket), then `body` frames
//!   and an `end` for HTTP, or `data` frames for a socket.
//! - desktop → worker: `head` (HTTP status + headers), `data`, `close`, and
//!   `error` when the local hop fails.
//!
//! Every stream is served by a plain request against 127.0.0.1:<bridge port>,
//! so the bridge's token check and the per-device approval stay the only gate;
//! the Worker holds no policy beyond the shared key.

use std::collections::HashMap;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};

use futures_util::{SinkExt, StreamExt};
use serde::{Deserialize, Serialize};
use tokio::sync::{mpsc, watch};
use tokio_tungstenite::tungstenite::client::IntoClientRequest;
use tokio_tungstenite::tungstenite::Message;
use tauri::Manager;

/// Pause before the single redial that follows a dropped socket: long enough
/// for the Worker to finish recycling the old connection, short enough that a
/// phone reload barely notices. A dial that *fails* does not come back on its
/// own — see `run_agent`.
const REDIAL_DELAY_MS: u64 = 1_000;
/// Marks traffic that arrived through the relay: the bridge requires the
/// pairing key for those requests only, so the LAN keeps upstream's model.
pub const VIA_HEADER: &str = "x-ccgui-via";

/// Hop-by-hop headers have no meaning across the relay.
const HOP_HEADERS: [&str; 8] = [
    "host",
    "connection",
    "keep-alive",
    "transfer-encoding",
    "upgrade",
    "content-length",
    "accept-encoding",
    "sec-websocket-extensions",
];

#[derive(Default)]
pub struct RelayState {
    inner: Mutex<Option<Running>>,
}

struct Running {
    info: RelayInfo,
    stop: watch::Sender<bool>,
    /// Identifies the agent task that owns this entry. A superseded task (the
    /// user disconnected and reconnected while it sat in a dial) must neither
    /// write into its successor's state nor tear it down.
    generation: u64,
}

/// Hands every session a distinct id; see `Running::generation`.
static NEXT_GENERATION: AtomicU64 = AtomicU64::new(1);

#[derive(serde::Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct RelayInfo {
    /// Address the phone opens, with the key already in the path.
    pub url: String,
    /// Worker base the desktop dials.
    pub agent_url: String,
    pub connected: bool,
    /// Last failure, for the settings card.
    pub error: Option<String>,
}

#[derive(Deserialize)]
#[serde(tag = "t", rename_all = "lowercase")]
enum AgentFrame {
    Open {
        id: u64,
        #[serde(default)]
        ws: bool,
        #[serde(default)]
        method: String,
        #[serde(default)]
        path: String,
        #[serde(default)]
        headers: HashMap<String, String>,
    },
    Body {
        id: u64,
        b64: String,
    },
    End {
        id: u64,
    },
    /// Socket payload: phone → desktop.
    Data {
        id: u64,
        b64: String,
        /// Lets the Worker hand the phone a text frame instead of bytes: the
        /// app's JS client reads JSON, and a Blob used to be dropped.
        #[serde(skip_serializing_if = "Option::is_none")]
        text: Option<bool>,
    },
    Close {
        id: u64,
    },
}

#[derive(Serialize)]
#[serde(tag = "t", rename_all = "lowercase")]
enum ClientFrame {
    Head {
        id: u64,
        status: u16,
        headers: HashMap<String, String>,
    },
    Data {
        id: u64,
        b64: String,
        /// Worker-side frame type. Absent from older Workers, which sent
        /// everything as bytes; the bridge's protocol is JSON text, so an
        /// absent flag is read as text.
        #[serde(default)]
        text: Option<bool>,
    },
    Close {
        id: u64,
    },
    Error {
        id: u64,
        message: String,
    },
}

/// An HTTP stream that has been announced but not yet fully received.
struct PendingHttp {
    method: String,
    path: String,
    headers: HashMap<String, String>,
    body: Vec<u8>,
}

/// A live socket stream, with the handle needed to drop it on `close`.
struct LiveSocket {
    /// Frame bytes plus whether they are a text frame (see `spawn_socket`).
    frames: mpsc::Sender<(Vec<u8>, bool)>,
    task: tokio::task::AbortHandle,
}

/// `https://host` → `wss://host/agent?key=…`, `http://host` → `ws://…`.
fn agent_url(base: &str, key: &str) -> Result<String, String> {
    let base = base.trim().trim_end_matches('/');
    if base.is_empty() {
        return Err("relay address is empty".into());
    }
    let ws = if let Some(rest) = base.strip_prefix("https://") {
        format!("wss://{rest}")
    } else if let Some(rest) = base.strip_prefix("http://") {
        format!("ws://{rest}")
    } else if base.starts_with("ws://") || base.starts_with("wss://") {
        base.to_string()
    } else {
        format!("wss://{base}")
    };
    Ok(format!("{ws}/agent?key={}", urlencode(key)))
}

/// The address the phone opens. No token: through the relay the pairing key
/// is what authorizes a device, so the bare worker address is enough.
fn phone_url(base: &str) -> String {
    format!("{}/", base.trim().trim_end_matches('/'))
}

fn urlencode(value: &str) -> String {
    value
        .bytes()
        .map(|b| match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                (b as char).to_string()
            }
            other => format!("%{other:02X}"),
        })
        .collect()
}

#[tauri::command]
pub async fn web_relay_start(
    app: tauri::AppHandle,
    url: String,
    key: String,
) -> Result<RelayInfo, String> {
    let state = app.state::<crate::AppState>();
    // The relay forwards every request through the local bridge, so connecting
    // it turns the bridge on rather than bouncing the user back to 内网访问 to
    // hunt for the switch. `web_access_start` is idempotent when it already
    // runs, and a remote device only reaches this command *through* the
    // bridge, so the auto-start can only ever happen on the desktop.
    if state.web.bridge_target().is_none() {
        crate::web::web_access_start(app.clone()).await?;
    }
    let bridge_port = state
        .web
        .bridge_target()
        .map(|(port, _)| port)
        .ok_or("本机服务启动失败：中继无法转发")?;

    let agent = agent_url(&url, &key)?;
    let info = RelayInfo {
        url: phone_url(&url),
        agent_url: agent.clone(),
        connected: false,
        error: None,
    };
    let (stop_tx, stop_rx) = watch::channel(false);
    let generation = NEXT_GENERATION.fetch_add(1, Ordering::Relaxed);
    {
        let mut guard = state.relay.inner.lock().map_err(|e| e.to_string())?;
        if let Some(previous) = guard.take() {
            let _ = previous.stop.send(true);
        }
        *guard = Some(Running {
            info: info.clone(),
            stop: stop_tx,
            generation,
        });
    }

    let handle = app.clone();
    tokio::spawn(async move {
        run_agent(handle, agent, bridge_port, stop_rx, generation).await;
    });
    Ok(info)
}

#[tauri::command]
pub fn web_relay_stop(app: tauri::AppHandle) -> Result<(), String> {
    let state = app.state::<crate::AppState>();
    let mut guard = state.relay.inner.lock().map_err(|e| e.to_string())?;
    if let Some(running) = guard.take() {
        let _ = running.stop.send(true);
    }
    drop(guard);
    broadcast_relay(&app);
    Ok(())
}

#[tauri::command]
pub fn web_relay_status(app: tauri::AppHandle) -> Option<RelayInfo> {
    let state = app.state::<crate::AppState>();
    let guard = state.relay.inner.lock().ok()?;
    guard.as_ref().map(|r| r.info.clone())
}

/// The Cloudflare Worker a user deploys on their own account, embedded at
/// build time so the settings page can hand it over without shipping the
/// repo next to the app (the deploy/ tree is not part of any bundle).
pub const WORKER_SOURCE: &str = include_str!("../../deploy/worker/src/index.js");

/// A fresh relay secret: 32 chars from an unambiguous alphabet. It travels in
/// the agent URL and seeds the Durable Object name, so it stays URL-safe and
/// free of look-alike characters.
fn new_relay_key() -> String {
    const ALPHABET: &[u8] = b"23456789BCDFGHJKLMNPQRSTVWXZ";
    const LEN: usize = 32;
    let mut out = String::with_capacity(LEN);
    while out.len() < LEN {
        for byte in uuid::Uuid::new_v4().as_bytes() {
            if out.len() == LEN {
                break;
            }
            out.push(ALPHABET[*byte as usize % ALPHABET.len()] as char);
        }
    }
    out
}

fn crc32(data: &[u8]) -> u32 {
    let mut crc = 0xFFFF_FFFFu32;
    for &byte in data {
        crc ^= byte as u32;
        for _ in 0..8 {
            let mask = (crc & 1).wrapping_neg();
            crc = (crc >> 1) ^ (0xEDB8_8320 & mask);
        }
    }
    !crc
}

fn push_u16(out: &mut Vec<u8>, value: u16) {
    out.extend_from_slice(&value.to_le_bytes());
}

fn push_u32(out: &mut Vec<u8>, value: u32) {
    out.extend_from_slice(&value.to_le_bytes());
}

/// Minimal STORE-only (uncompressed) zip writer. Deliberately not a dependency:
/// the pack is ~9 KB of text, and storing it verbatim means the bytes the user
/// unpacks are exactly the bytes they deploy — nothing hidden in a compressor.
fn zip_store(files: &[(&str, &[u8])]) -> Vec<u8> {
    // Fixed timestamp (2025-01-01 00:00) keeps the pack byte-reproducible.
    const DOS_DATE: u16 = (45 << 9) | (1 << 5) | 1;
    const DOS_TIME: u16 = 0;

    let mut out = Vec::new();
    let mut central = Vec::new();
    for (name, data) in files {
        let offset = out.len() as u32;
        let crc = crc32(data);
        let size = data.len() as u32;
        let name_len = name.len() as u16;

        push_u32(&mut out, 0x0403_4b50);
        push_u16(&mut out, 20); // version needed
        push_u16(&mut out, 0); // flags
        push_u16(&mut out, 0); // method: store
        push_u16(&mut out, DOS_TIME);
        push_u16(&mut out, DOS_DATE);
        push_u32(&mut out, crc);
        push_u32(&mut out, size);
        push_u32(&mut out, size);
        push_u16(&mut out, name_len);
        push_u16(&mut out, 0); // extra field length
        out.extend_from_slice(name.as_bytes());
        out.extend_from_slice(data);

        push_u32(&mut central, 0x0201_4b50);
        push_u16(&mut central, 20); // version made by
        push_u16(&mut central, 20); // version needed
        push_u16(&mut central, 0);
        push_u16(&mut central, 0);
        push_u16(&mut central, DOS_TIME);
        push_u16(&mut central, DOS_DATE);
        push_u32(&mut central, crc);
        push_u32(&mut central, size);
        push_u32(&mut central, size);
        push_u16(&mut central, name_len);
        push_u16(&mut central, 0); // extra
        push_u16(&mut central, 0); // comment
        push_u16(&mut central, 0); // disk number
        push_u16(&mut central, 0); // internal attributes
        push_u32(&mut central, 0); // external attributes
        push_u32(&mut central, offset);
        central.extend_from_slice(name.as_bytes());
    }

    let central_offset = out.len() as u32;
    let central_size = central.len() as u32;
    out.extend_from_slice(&central);
    push_u32(&mut out, 0x0605_4b50);
    push_u16(&mut out, 0); // this disk
    push_u16(&mut out, 0); // disk with central directory
    push_u16(&mut out, files.len() as u16);
    push_u16(&mut out, files.len() as u16);
    push_u32(&mut out, central_size);
    push_u32(&mut out, central_offset);
    push_u16(&mut out, 0); // comment length
    out
}

/// The deploy pack: Worker source + the wrangler project it belongs to, wired
/// to `key`. The user can read every byte before deploying it.
fn deploy_pack(key: &str) -> Vec<u8> {
    let wrangler = format!(
        r#"name = "ccgui-relay"
main = "src/index.js"
compatibility_date = "2025-01-01"

# Durable Object: one instance per relay key owns the desktop's socket.
[[durable_objects.bindings]]
name = "RELAY"
class_name = "Relay"

[[migrations]]
tag = "v1"
new_sqlite_classes = ["Relay"]

[vars]
# 与 CC GUI「中转密钥」保持一致 / must match the key field in CC GUI.
# 部署后也可在控制台 Variables 里修改，改完无需重新部署。
RELAY_KEY = "{key}"
"#
    );
    let readme = r#"CC GUI 外网穿透 · 中继部署包
CC GUI relay deploy pack

【部署步骤 / Steps】
1. 装 Node ≥ 16.17（只为拿 npx wrangler）。
   Install Node ≥ 16.17 (only to get npx wrangler).
2. npx wrangler login      # 浏览器授权一次 / authorize once in the browser
3. npx wrangler deploy     # 输出 https://ccgui-relay.<你的子域>.workers.dev
4. CC GUI → 设置 → 远程访问 → 外网访问：
   中转地址 = 上一步的 URL，中转密钥 = 本包 wrangler.toml 里的 RELAY_KEY。
   CC GUI → Settings → Remote access → Outbound: relay URL = the URL above,
   relay key = RELAY_KEY from this pack's wrangler.toml.
5. 点「连接中转」；手机打开该 URL → 授权页 → 输入 CC GUI 上的 8 位配对密钥。
   Click Connect relay; open that URL on the phone → authorization page →
   enter the 8-character pairing key shown in CC GUI.

【包里有什么 / What's inside】
- src/index.js    Worker 源码 / the Worker source
- wrangler.toml   部署配置：Durable Object 绑定与 RELAY_KEY
                  deploy config: the Durable Object binding and RELAY_KEY

【说明 / Notes】
- RELAY_KEY 是桌面端与 Worker 之间的共享密钥，请勿外传；它同时决定手机访问的
  路径分片，换 key 后手机需重新配对。
  RELAY_KEY is the shared secret between the desktop and the Worker — keep it
  private. It also namespaces the phone's path, so a new key needs re-pairing.
- 部分地区无法直连 *.workers.dev：给这个 Worker 绑定自定义域名
  （Settings → Domains & Routes → Add custom domain），再把该域名填进 CC GUI 的
  「中转地址」—— 地址栏始终可手改。
  If *.workers.dev is unreachable where you are, bind a custom domain to this
  Worker (Settings → Domains & Routes → Add custom domain) and use it as the
  relay URL in CC GUI; that field stays editable.
"#;
    zip_store(&[
        ("ccgui-relay/README.txt", readme.as_bytes()),
        ("ccgui-relay/wrangler.toml", wrangler.as_bytes()),
        ("ccgui-relay/src/index.js", WORKER_SOURCE.as_bytes()),
    ])
}

/// Write the deploy pack to `path`; returns the relay key baked into it (a
/// fresh one when the caller has none yet, so the pack and the GUI agree).
#[tauri::command]
pub fn relay_deploy_pack(path: String, key: Option<String>) -> Result<String, String> {
    let key = key
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .unwrap_or_else(new_relay_key);
    std::fs::write(&path, deploy_pack(&key))
        .map_err(|error| format!("failed to write {path}: {error}"))?;
    Ok(key)
}

const API_BASE: &str = "https://api.cloudflare.com/client/v4";
const SCRIPT_NAME: &str = "ccgui-relay";

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RelayDeployResult {
    pub url: String,
    pub key: String,
    pub account_id: String,
    pub account_name: String,
}

/// Cloudflare answers every REST call with `{success, errors[], result}`; fold
/// a failure into one readable line instead of leaking a JSON blob.
async fn cf_json(response: reqwest::Response, what: &str) -> Result<serde_json::Value, String> {
    let status = response.status();
    let text = response.text().await.unwrap_or_default();
    let value: serde_json::Value = serde_json::from_str(&text).unwrap_or(serde_json::Value::Null);
    let success = value
        .get("success")
        .and_then(serde_json::Value::as_bool)
        .unwrap_or(status.is_success());
    if success && status.is_success() {
        return Ok(value);
    }
    let detail = value
        .get("errors")
        .and_then(|errors| errors.as_array())
        .map(|errors| {
            errors
                .iter()
                .filter_map(|error| error.get("message").and_then(|m| m.as_str()))
                .collect::<Vec<_>>()
                .join("; ")
        })
        .filter(|joined| !joined.is_empty())
        .unwrap_or_else(|| text.chars().take(200).collect());
    Err(format!("{what}失败（HTTP {status}）：{detail}"))
}

/// Account-owned tokens (`cfat_…`) cannot call user-level endpoints at all, so
/// Cloudflare answers `GET /accounts` with "Invalid access token" — a message
/// that sends people chasing permissions they already granted. Name the real
/// problem instead.
const ACCOUNT_TOKEN_NEEDS_ID: &str =
    "这个 Token 是账户令牌（cfat_ 开头），Cloudflare 不允许它列出账户：请在下方填写 Account ID（在 Cloudflare 控制台右侧栏可复制），或改用用户令牌（My Profile → API Tokens 里创建）";

/// Resolve the account to deploy into. An id the caller typed wins outright:
/// account-owned tokens can only ever address `/accounts/{id}/…`, so there is
/// nothing to discover. Without one we ask Cloudflare which accounts the token
/// can see — the user-token path, one field and zero typing.
async fn cf_account(
    client: &reqwest::Client,
    token: &str,
    account_id: Option<&str>,
) -> Result<(String, String), String> {
    if let Some(id) = account_id.map(str::trim).filter(|id| !id.is_empty()) {
        return Ok((id.to_string(), cf_account_name(client, token, id).await));
    }
    if token.starts_with("cfat_") {
        return Err(ACCOUNT_TOKEN_NEEDS_ID.to_string());
    }
    let response = client
        .get(format!("{API_BASE}/accounts"))
        .bearer_auth(token)
        .send()
        .await
        .map_err(|error| format!("读取账号失败：{error}"))?;
    let value = cf_json(response, "读取账号").await?;
    let account = value
        .get("result")
        .and_then(|result| result.as_array())
        .and_then(|list| list.first())
        .ok_or_else(|| "这个 Token 下没有可用的 Cloudflare 账号".to_string())?;
    let id = account
        .get("id")
        .and_then(|v| v.as_str())
        .unwrap_or_default()
        .to_string();
    if id.is_empty() {
        return Err("账号缺少 id".to_string());
    }
    let name = account
        .get("name")
        .and_then(|v| v.as_str())
        .unwrap_or_default()
        .to_string();
    Ok((id, name))
}

/// Name for the deploy result line. Purely cosmetic: a token scoped to Workers
/// and nothing else may not be allowed to read it, and that must never fail a
/// deploy that would otherwise work.
async fn cf_account_name(client: &reqwest::Client, token: &str, id: &str) -> String {
    let Ok(response) = client
        .get(format!("{API_BASE}/accounts/{id}"))
        .bearer_auth(token)
        .send()
        .await
    else {
        return id.to_string();
    };
    let Ok(value) = cf_json(response, "读取账号").await else {
        return id.to_string();
    };
    value
        .get("result")
        .and_then(|result| result.get("name"))
        .and_then(|v| v.as_str())
        .filter(|name| !name.is_empty())
        .unwrap_or(id)
        .to_string()
}

async fn cf_subdomain(
    client: &reqwest::Client,
    token: &str,
    account_id: &str,
) -> Result<String, String> {
    let response = client
        .get(format!("{API_BASE}/accounts/{account_id}/workers/subdomain"))
        .bearer_auth(token)
        .send()
        .await
        .map_err(|error| format!("读取 workers.dev 子域失败：{error}"))?;
    let value = cf_json(response, "读取 workers.dev 子域").await?;
    let subdomain = value
        .get("result")
        .and_then(|result| result.get("subdomain"))
        .and_then(|v| v.as_str())
        .unwrap_or_default()
        .to_string();
    if subdomain.is_empty() {
        return Err(
            "这个账号还没有设置 workers.dev 子域：先到 Cloudflare 控制台 Workers & Pages 页面设置一次，再回来部署"
                .to_string(),
        );
    }
    Ok(subdomain)
}

/// Ship the Worker into the user's own account in one call: the Durable Object
/// class (via `migrations`), its binding, and the relay key all ride along in
/// the upload metadata, which is why nobody has to run wrangler. The relay URL
/// is only reported back — the settings page decides whether to fill it.
///
/// `account_id` is optional: user tokens can list their accounts, account-owned
/// ones (which Cloudflare now hands out as `cfat_…`) cannot, so for those the
/// page asks for the id instead.
#[tauri::command]
pub async fn relay_deploy(
    token: String,
    account_id: Option<String>,
    key: Option<String>,
) -> Result<RelayDeployResult, String> {
    let token = token.trim().to_string();
    if token.is_empty() {
        return Err("缺少 Cloudflare API Token".to_string());
    }
    let account_id = account_id
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty());
    let key = key
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .unwrap_or_else(new_relay_key);

    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(60))
        .build()
        .map_err(|error| error.to_string())?;

    let (account_id, account_name) = cf_account(&client, &token, account_id.as_deref()).await?;
    let subdomain = cf_subdomain(&client, &token, &account_id).await?;

    // A fresh script needs the Durable Object class declared in the upload's
    // migrations; an existing one already owns it, and Cloudflare rejects a
    // migration tag it has seen (old_tag verifies the live tag, and we do not
    // track it here). So: declare only when creating.
    let exists = client
        .get(format!(
            "{API_BASE}/accounts/{account_id}/workers/scripts/{SCRIPT_NAME}"
        ))
        .bearer_auth(&token)
        .send()
        .await
        .map(|response| response.status().is_success())
        .unwrap_or(false);

    let mut metadata = serde_json::json!({
        "main_module": "index.js",
        "compatibility_date": "2025-01-01",
        "bindings": [
            { "type": "durable_object_namespace", "name": "RELAY", "class_name": "Relay" },
            // secret_text: the dashboard never shows the value back.
            { "type": "secret_text", "name": "RELAY_KEY", "text": key.clone() },
        ],
    });
    if !exists {
        // An object, not the array wrangler.toml shows: the API unmarshals it
        // into ActorMigrations ({new_tag, old_tag?, steps[]}).
        metadata["migrations"] = serde_json::json!({
            "new_tag": "v1",
            "steps": [{ "new_sqlite_classes": ["Relay"] }],
        });
    }
    let form = reqwest::multipart::Form::new()
        .part(
            "metadata",
            reqwest::multipart::Part::text(metadata.to_string())
                .mime_str("application/json")
                .map_err(|error| error.to_string())?,
        )
        .part(
            "index.js",
            // Cloudflare matches the part by filename as well as field name;
            // a filename-less part reads as "No such module: index.js".
            reqwest::multipart::Part::text(WORKER_SOURCE)
                .file_name("index.js")
                .mime_str("application/javascript+module")
                .map_err(|error| error.to_string())?,
        );
    let response = client
        .put(format!(
            "{API_BASE}/accounts/{account_id}/workers/scripts/{SCRIPT_NAME}"
        ))
        .bearer_auth(&token)
        .multipart(form)
        .send()
        .await
        .map_err(|error| format!("上传 Worker 失败：{error}"))?;
    cf_json(response, "上传 Worker").await?;

    // Make it reachable at <script>.<subdomain>.workers.dev. A failure here is
    // not fatal: an existing route may already be enabled, and the user can
    // always bind a custom domain instead.
    let _ = client
        .post(format!(
            "{API_BASE}/accounts/{account_id}/workers/scripts/{SCRIPT_NAME}/subdomain"
        ))
        .bearer_auth(&token)
        .json(&serde_json::json!({ "enabled": true }))
        .send()
        .await;

    Ok(RelayDeployResult {
        url: format!("https://{SCRIPT_NAME}.{subdomain}.workers.dev"),
        key,
        account_id,
        account_name,
    })
}

/// Keeps the agent socket up. A socket that lived and then died is redialed —
/// a blip on the desktop's uplink should not cost the phone its link. A dial
/// that *cannot be established* ends the session instead: retrying forever
/// leaves the relay switch reading 断开中转 for a Worker that is not answering,
/// and only the user knows when the address/key deserves another try.
async fn run_agent(
    app: tauri::AppHandle,
    agent: String,
    port: u16,
    mut stop: watch::Receiver<bool>,
    generation: u64,
) {
    loop {
        if *stop.borrow() {
            return;
        }
        let request = match agent.clone().into_client_request() {
            Ok(r) => r,
            Err(e) => {
                give_up(&app, generation, format!("中继地址无效：{e}"));
                return;
            }
        };
        match tokio_tungstenite::connect_async(request).await {
            Ok((socket, _)) => {
                set_error(&app, generation, String::new());
                set_connected(&app, generation, true);
                serve(socket, port, &mut stop).await;
                set_connected(&app, generation, false);
            }
            Err(e) => {
                give_up(&app, generation, format!("连接中继失败：{e}"));
                return;
            }
        }
        if *stop.borrow() {
            return;
        }
        // The pause is what keeps a Worker that accepts and immediately closes
        // from turning this into a hot loop.
        tokio::select! {
            _ = tokio::time::sleep(std::time::Duration::from_millis(REDIAL_DELAY_MS)) => {}
            _ = stop.changed() => return,
        }
    }
}

/// One connected agent socket: dispatch streams, pump frames until it dies.
async fn serve(
    socket: tokio_tungstenite::WebSocketStream<
        tokio_tungstenite::MaybeTlsStream<tokio::net::TcpStream>,
    >,
    port: u16,
    stop: &mut watch::Receiver<bool>,
) {
    let (mut tx, mut rx) = socket.split();
    let (out_tx, mut out_rx) = mpsc::channel::<String>(256);
    let writer = tokio::spawn(async move {
        while let Some(text) = out_rx.recv().await {
            if tx.send(Message::Text(text.into())).await.is_err() {
                break;
            }
        }
    });

    let http: Arc<Mutex<HashMap<u64, PendingHttp>>> = Arc::new(Mutex::new(HashMap::new()));
    let sockets: Arc<Mutex<HashMap<u64, LiveSocket>>> = Arc::new(Mutex::new(HashMap::new()));
    // One client: keep-alive to the local bridge is worth reusing, and the
    // pool dies with the connection.
    let client = reqwest::Client::builder()
        // A pipe, not a browser: following a redirect would swallow the
        // status and any Set-Cookie the phone needs to see.
        .redirect(reqwest::redirect::Policy::none())
        .build()
        .unwrap_or_else(|_| reqwest::Client::new());

    loop {
        let frame = tokio::select! {
            _ = stop.changed() => break,
            next = rx.next() => match next {
                Some(Ok(Message::Text(text))) => text.to_string(),
                Some(Ok(Message::Binary(bytes))) => match String::from_utf8(bytes.to_vec()) {
                    Ok(text) => text,
                    Err(_) => continue,
                },
                Some(Ok(_)) => continue,
                Some(Err(_)) | None => break,
            },
        };
        let Ok(frame) = serde_json::from_str::<AgentFrame>(&frame) else {
            continue;
        };
        match frame {
            AgentFrame::Open {
                id,
                ws,
                method,
                path,
                headers,
            } => {
                if ws {
                    let live = spawn_socket(id, path, headers, port, out_tx.clone());
                    sockets.lock().unwrap().insert(id, live);
                } else {
                    http.lock().unwrap().insert(
                        id,
                        PendingHttp {
                            method,
                            path,
                            headers,
                            body: Vec::new(),
                        },
                    );
                }
            }
            AgentFrame::Body { id, b64 } => {
                if let Some(pending) = http.lock().unwrap().get_mut(&id) {
                    pending.body.extend(b64_to_bytes(&b64));
                }
            }
            AgentFrame::End { id } => {
                let pending = http.lock().unwrap().remove(&id);
                if let Some(pending) = pending {
                    spawn_http(id, pending, port, out_tx.clone(), client.clone());
                }
            }
            AgentFrame::Data { id, b64, text } => {
                let sender = sockets.lock().unwrap().get(&id).map(|s| s.frames.clone());
                if let Some(sender) = sender {
                    let _ = sender.send((b64_to_bytes(&b64), text.unwrap_or(true))).await;
                }
            }
            AgentFrame::Close { id } => {
                if let Some(live) = sockets.lock().unwrap().remove(&id) {
                    live.task.abort();
                }
                http.lock().unwrap().remove(&id);
            }
        }
    }

    for (_, live) in sockets.lock().unwrap().drain() {
        live.task.abort();
    }
    http.lock().unwrap().clear();
    drop(out_tx);
    let _ = writer.await;
}

/// Serve one HTTP stream against the local bridge and stream it back.
fn spawn_http(
    id: u64,
    pending: PendingHttp,
    port: u16,
    out: mpsc::Sender<String>,
    client: reqwest::Client,
) {
    tokio::spawn(async move {
        let url = format!("http://127.0.0.1:{port}{}", pending.path);
        let method = reqwest::Method::from_bytes(pending.method.as_bytes())
            .unwrap_or(reqwest::Method::GET);
        let mut request = client.request(method, &url).header(VIA_HEADER, "relay");
        for (name, value) in &pending.headers {
            if HOP_HEADERS.contains(&name.to_ascii_lowercase().as_str()) {
                continue;
            }
            request = request.header(name, value);
        }
        let response = match request.body(pending.body).send().await {
            Ok(response) => response,
            Err(e) => {
                let _ = send(
                    &out,
                    &ClientFrame::Error {
                        id,
                        message: format!("本机请求失败：{e}"),
                    },
                )
                .await;
                return;
            }
        };

        let status = response.status().as_u16();
        let mut headers = HashMap::new();
        for (name, value) in response.headers() {
            let name = name.as_str().to_ascii_lowercase();
            if HOP_HEADERS.contains(&name.as_str()) {
                continue;
            }
            if let Ok(value) = value.to_str() {
                headers.insert(name, value.to_string());
            }
        }
        if send(&out, &ClientFrame::Head { id, status, headers })
            .await
            .is_err()
        {
            return;
        }

        let mut stream = response.bytes_stream();
        while let Some(chunk) = stream.next().await {
            match chunk {
                Ok(bytes) => {
                    if send(
                        &out,
                        &ClientFrame::Data {
                            id,
                            b64: bytes_to_b64(&bytes),
                            text: None,
                        },
                    )
                    .await
                    .is_err()
                    {
                        return;
                    }
                }
                Err(e) => {
                    let _ = send(
                        &out,
                        &ClientFrame::Error {
                            id,
                            message: format!("读取响应失败：{e}"),
                        },
                    )
                    .await;
                    return;
                }
            }
        }
        let _ = send(&out, &ClientFrame::Close { id }).await;
    });
}

/// Dial the bridge's socket route and pipe payloads both ways.
fn spawn_socket(
    id: u64,
    path: String,
    headers: HashMap<String, String>,
    port: u16,
    out: mpsc::Sender<String>,
) -> LiveSocket {
    let (frames_tx, mut frames_rx) = mpsc::channel::<(Vec<u8>, bool)>(256);
    let handle = tokio::spawn(async move {
        let target = format!("ws://127.0.0.1:{port}{path}");
        let Ok(mut request) = target.into_client_request() else {
            let _ = send(
                &out,
                &ClientFrame::Error {
                    id,
                    message: "socket path is invalid".into(),
                },
            )
            .await;
            return;
        };
        request.headers_mut().insert(
            tokio_tungstenite::tungstenite::http::HeaderName::from_static(VIA_HEADER),
            tokio_tungstenite::tungstenite::http::HeaderValue::from_static("relay"),
        );
        for (name, value) in &headers {
            if name.to_ascii_lowercase().starts_with("sec-websocket")
                || name.eq_ignore_ascii_case("host")
                || name.eq_ignore_ascii_case("connection")
                || name.eq_ignore_ascii_case("upgrade")
                || name.eq_ignore_ascii_case("origin")
            {
                continue;
            }
            if let (Ok(name), Ok(value)) = (
                name.parse::<tokio_tungstenite::tungstenite::http::HeaderName>(),
                value.parse::<tokio_tungstenite::tungstenite::http::HeaderValue>(),
            ) {
                request.headers_mut().insert(name, value);
            }
        }

        let socket = match tokio_tungstenite::connect_async(request).await {
            Ok((socket, _)) => socket,
            Err(e) => {
                let _ = send(
                    &out,
                    &ClientFrame::Error {
                        id,
                        message: format!("本机 socket 连接失败：{e}"),
                    },
                )
                .await;
                return;
            }
        };
        let (mut ws_tx, mut ws_rx) = socket.split();

        loop {
            tokio::select! {
                frame = frames_rx.recv() => match frame {
                    Some((bytes, as_text)) => {
                        // The bridge speaks JSON text; sending the phone's
                        // frames as binary made its handler ignore every one of
                        // them, which is why the web UI stayed empty.
                        let message = if as_text {
                            Message::Text(String::from_utf8_lossy(&bytes).into_owned().into())
                        } else {
                            Message::Binary(bytes.into())
                        };
                        if ws_tx.send(message).await.is_err() {
                            break;
                        }
                    }
                    None => {
                        let _ = ws_tx.send(Message::Close(None)).await;
                        break;
                    }
                },
                message = ws_rx.next() => match message {
                    Some(Ok(Message::Binary(bytes))) => {
                        if send(
                            &out,
                            &ClientFrame::Data { id, b64: bytes_to_b64(&bytes), text: Some(false) },
                        )
                        .await
                        .is_err()
                        {
                            break;
                        }
                    }
                    Some(Ok(Message::Text(text))) => {
                        if send(
                            &out,
                            &ClientFrame::Data { id, b64: bytes_to_b64(text.as_bytes()), text: Some(true) },
                        )
                        .await
                        .is_err()
                        {
                            break;
                        }
                    }
                    Some(Ok(Message::Close(_))) | Some(Err(_)) | None => break,
                    Some(Ok(_)) => continue,
                },
            }
        }
        let _ = send(&out, &ClientFrame::Close { id }).await;
    });
    LiveSocket {
        frames: frames_tx,
        task: handle.abort_handle(),
    }
}

async fn send(out: &mpsc::Sender<String>, frame: &ClientFrame) -> Result<(), ()> {
    let Ok(text) = serde_json::to_string(frame) else {
        return Err(());
    };
    out.send(text).await.map_err(|_| ())
}

fn b64_to_bytes(text: &str) -> Vec<u8> {
    use base64::Engine;
    base64::engine::general_purpose::STANDARD
        .decode(text)
        .unwrap_or_default()
}

fn bytes_to_b64(bytes: &[u8]) -> String {
    use base64::Engine;
    base64::engine::general_purpose::STANDARD.encode(bytes)
}

fn set_connected(app: &tauri::AppHandle, generation: u64, connected: bool) {
    let state = app.state::<crate::AppState>();
    if let Ok(mut guard) = state.relay.inner.lock() {
        if let Some(running) = guard.as_mut().filter(|r| r.generation == generation) {
            running.info.connected = connected;
        }
    }
    broadcast_relay(app);
}

fn set_error(app: &tauri::AppHandle, generation: u64, message: String) {
    let state = app.state::<crate::AppState>();
    if let Ok(mut guard) = state.relay.inner.lock() {
        if let Some(running) = guard.as_mut().filter(|r| r.generation == generation) {
            running.info.error = (!message.is_empty()).then_some(message);
        }
    }
    broadcast_relay(app);
}

/// Ends the session on a dial that will not come up and hands the reason to the
/// UI. The entry is dropped, so the page's next status read returns null and the
/// switch flips back to 连接中转; the message therefore has to ride the event —
/// the state it would otherwise be read from no longer exists.
fn give_up(app: &tauri::AppHandle, generation: u64, message: String) {
    let state = app.state::<crate::AppState>();
    match state.relay.inner.lock() {
        Ok(mut guard) => {
            match guard.as_ref() {
                // Superseded: a newer session owns the switch, leave it alone.
                Some(running) if running.generation != generation => return,
                Some(_) => {
                    guard.take();
                }
                None => return,
            }
        }
        Err(_) => return,
    }
    use crate::event_sink::Emit;
    let payload = serde_json::json!({ "error": message }).to_string();
    let _ = state.emitters.emit_json("web://relay", &payload);
}

fn broadcast_relay(app: &tauri::AppHandle) {
    // Through the sink: the bridge forwards sink events to phones, plain
    // `app.emit` would stop at the webview.
    use crate::event_sink::Emit;
    app.state::<crate::AppState>()
        .emitters
        .emit_json("web://relay", "null");
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The pack must be a zip any unzipper accepts: correct per-entry CRC and
    /// sizes are exactly what a wrong hand-rolled header gets wrong, and the
    /// key has to be baked in or the deployed Worker rejects every agent.
    #[test]
    fn deploy_pack_is_a_valid_store_zip() {
        let key = "TESTKEY23456789BCDFGHJKLMNPQRST";
        let pack = deploy_pack(key);
        assert_eq!(&pack[0..4], b"PK\x03\x04", "local file header");
        let eocd = pack.len() - 22;
        assert_eq!(&pack[eocd..eocd + 4], b"PK\x05\x06", "end of central directory");
        assert_eq!(
            u16::from_le_bytes([pack[eocd + 10], pack[eocd + 11]]),
            3,
            "entry count"
        );

        let mut offset = 0usize;
        let mut names = Vec::new();
        for _ in 0..3 {
            let crc = u32::from_le_bytes(pack[offset + 14..offset + 18].try_into().unwrap());
            let size =
                u32::from_le_bytes(pack[offset + 18..offset + 22].try_into().unwrap()) as usize;
            assert_eq!(
                u16::from_le_bytes(pack[offset + 8..offset + 10].try_into().unwrap()),
                0,
                "method must be store"
            );
            let name_len =
                u16::from_le_bytes(pack[offset + 26..offset + 28].try_into().unwrap()) as usize;
            let data_start = offset + 30 + name_len;
            let name = String::from_utf8_lossy(&pack[offset + 30..data_start]).to_string();
            let data = &pack[data_start..data_start + size];
            assert_eq!(crc32(data), crc, "crc mismatch for {name}");
            names.push(name);
            offset = data_start + size;
        }
        assert_eq!(
            names,
            [
                "ccgui-relay/README.txt",
                "ccgui-relay/wrangler.toml",
                "ccgui-relay/src/index.js",
            ]
        );
        assert!(String::from_utf8_lossy(&pack).contains(key), "key baked in");
    }

    #[test]
    fn relay_key_is_url_safe_and_long() {
        let key = new_relay_key();
        assert_eq!(key.len(), 32);
        assert!(key.chars().all(|c| c.is_ascii_alphanumeric()));
    }
}
