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
use std::sync::{Arc, Mutex};

use futures_util::{SinkExt, StreamExt};
use serde::{Deserialize, Serialize};
use tokio::sync::{mpsc, watch};
use tokio_tungstenite::tungstenite::client::IntoClientRequest;
use tokio_tungstenite::tungstenite::Message;
use tauri::Manager;

/// Reconnect delays, doubling up to a minute: the relay is expected to be
/// long-lived, so a dropped link must come back on its own.
const BACKOFF_MS: [u64; 6] = [1_000, 2_000, 5_000, 10_000, 30_000, 60_000];
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
}

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
    frames: mpsc::Sender<Vec<u8>>,
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
    let bridge_port = state
        .web
        .bridge_target()
        .map(|(port, _)| port)
        .ok_or("先打开上面的「访问开关」：中继要经过本机服务，它没在运行")?;

    let agent = agent_url(&url, &key)?;
    let info = RelayInfo {
        url: phone_url(&url),
        agent_url: agent.clone(),
        connected: false,
        error: None,
    };
    let (stop_tx, stop_rx) = watch::channel(false);
    {
        let mut guard = state.relay.inner.lock().map_err(|e| e.to_string())?;
        if let Some(previous) = guard.take() {
            let _ = previous.stop.send(true);
        }
        *guard = Some(Running {
            info: info.clone(),
            stop: stop_tx,
        });
    }

    let handle = app.clone();
    tokio::spawn(async move {
        run_agent(handle, agent, bridge_port, stop_rx).await;
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

/// Keeps one agent socket alive: reconnect with backoff until stopped.
async fn run_agent(app: tauri::AppHandle, agent: String, port: u16, mut stop: watch::Receiver<bool>) {
    let mut attempt = 0usize;
    loop {
        if *stop.borrow() {
            return;
        }
        let request = match agent.clone().into_client_request() {
            Ok(r) => r,
            Err(e) => {
                set_error(&app, format!("中继地址无效：{e}"));
                return;
            }
        };
        match tokio_tungstenite::connect_async(request).await {
            Ok((socket, _)) => {
                attempt = 0;
                set_error(&app, String::new());
                set_connected(&app, true);
                serve(socket, port, &mut stop).await;
                set_connected(&app, false);
            }
            Err(e) => set_error(&app, format!("连接中继失败：{e}")),
        }
        if *stop.borrow() {
            return;
        }
        let delay = BACKOFF_MS[attempt.min(BACKOFF_MS.len() - 1)];
        attempt += 1;
        tokio::select! {
            _ = tokio::time::sleep(std::time::Duration::from_millis(delay)) => {}
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
            AgentFrame::Data { id, b64 } => {
                let sender = sockets.lock().unwrap().get(&id).map(|s| s.frames.clone());
                if let Some(sender) = sender {
                    let _ = sender.send(b64_to_bytes(&b64)).await;
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
    let (frames_tx, mut frames_rx) = mpsc::channel::<Vec<u8>>(256);
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
                    Some(bytes) => {
                        if ws_tx.send(Message::Binary(bytes.into())).await.is_err() {
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
                            &ClientFrame::Data { id, b64: bytes_to_b64(&bytes) },
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
                            &ClientFrame::Data { id, b64: bytes_to_b64(text.as_bytes()) },
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

fn set_connected(app: &tauri::AppHandle, connected: bool) {
    let state = app.state::<crate::AppState>();
    if let Ok(mut guard) = state.relay.inner.lock() {
        if let Some(running) = guard.as_mut() {
            running.info.connected = connected;
        }
    }
    broadcast_relay(app);
}

fn set_error(app: &tauri::AppHandle, message: String) {
    let state = app.state::<crate::AppState>();
    if let Ok(mut guard) = state.relay.inner.lock() {
        if let Some(running) = guard.as_mut() {
            running.info.error = (!message.is_empty()).then_some(message);
        }
    }
    broadcast_relay(app);
}

fn broadcast_relay(app: &tauri::AppHandle) {
    // Through the sink: the bridge forwards sink events to phones, plain
    // `app.emit` would stop at the webview.
    use crate::event_sink::Emit;
    app.state::<crate::AppState>()
        .emitters
        .emit_json("web://relay", "null");
}
