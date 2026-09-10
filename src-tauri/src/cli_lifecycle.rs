//! Managed-CLI lifecycle behind the CLI 管理 settings header: local version
//! probe (`<bin> --version`), npm registry latest probe, and one-click
//! install/update. Generalizes the retired dsh-only dsh_cli_version /
//! dsh_cli_update pair to every engine.
//!
//! Probes run on explicit request only (settings page open, refresh button)
//! — never on a timer: `npm view` is a network call and every probe spawns
//! processes, so polling would keep the machine awake for nothing.

use std::process::Stdio;
use std::time::Duration;

use serde::Serialize;
use tokio::io::{AsyncRead, AsyncReadExt};
use tokio::process::Command;
use tokio::task::JoinHandle;
use tokio::time::timeout;

use crate::engine::{command_for_binary, resolve};

const CLI_VERSION_TIMEOUT: Duration = Duration::from_secs(10);
const NPM_VIEW_TIMEOUT: Duration = Duration::from_secs(15);
const INSTALL_TIMEOUT: Duration = Duration::from_secs(420);
/// Bytes of installer output quoted back in a failure error.
const ERROR_TAIL_CAP: usize = 2048;

/// npm-distributed engines → registry package. Grok CLI ships via its own
/// installer script (no npm distribution), so it gets a local-version probe
/// only — no latest probe and no install/update action.
fn npm_package(engine: &str) -> Option<&'static str> {
    match engine {
        "claude" => Some("@anthropic-ai/claude-code"),
        "kimi" => Some("@moonshot-ai/kimi-code"),
        "codex" => Some("@openai/codex"),
        "pi" => Some("@earendil-works/pi-coding-agent"),
        "omp" => Some("@oh-my-pi/pi-coding-agent"),
        "dsh" => Some("@deepseek-ai/dsh"),
        _ => None,
    }
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct CliVersionStatus {
    pub engine: String,
    pub installed: bool,
    pub local_version: Option<String>,
    pub latest_version: Option<String>,
    pub update_available: bool,
    /// How the install/update button acts: "npm" | "native"; null when the
    /// engine has no lifecycle action (grok).
    pub update_kind: Option<&'static str>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateResult {
    pub ok: bool,
    pub version: Option<String>,
}

/// Claude Code is distributed both as an npm package and as a native
/// installer build; pushing an npm global install onto a native install
/// would shadow it with a second binary. The npm copy lives inside a
/// node_modules tree, so the resolved binary path decides the channel.
/// Not installed → "native" (the official installer is the default path).
fn claude_update_kind(bin: &str) -> &'static str {
    let resolved = std::fs::canonicalize(bin)
        .map(|p| p.to_string_lossy().into_owned())
        .unwrap_or_else(|_| bin.to_string());
    if resolved.contains("node_modules") {
        "npm"
    } else {
        "native"
    }
}

fn update_kind(engine: &str, bin: &str) -> Option<&'static str> {
    if engine == "claude" {
        return Some(claude_update_kind(bin));
    }
    npm_package(engine).map(|_| "npm")
}

pub(crate) struct CliProbe {
    pub(crate) installed: bool,
    pub(crate) version: Option<String>,
}

/// `<bin> --version`: first non-empty stdout line, 10s cap. A spawn failure
/// means not installed; a successful run with no version line still counts
/// as installed (we just have nothing to display).
pub(crate) async fn probe_local_version(bin: &str) -> CliProbe {
    let mut command = command_for_binary(bin);
    command.arg("--version");
    let output = match run_capture(&mut command, CLI_VERSION_TIMEOUT).await {
        Ok(output) => output,
        Err(_) => {
            return CliProbe {
                installed: false,
                version: None,
            }
        }
    };
    let version = output
        .stdout
        .lines()
        .map(str::trim)
        .find(|line| !line.is_empty())
        .map(str::to_string);
    CliProbe {
        installed: true,
        version,
    }
}

/// Latest published version: `npm view <package> version`.
async fn probe_latest_version(package: &str) -> Option<String> {
    let npm = resolve::resolve_launchable_cli_binary("npm");
    let mut command = command_for_binary(&npm);
    command.args(["view", package, "version"]);
    let output = run_capture(&mut command, NPM_VIEW_TIMEOUT).await.ok()?;
    output
        .stdout
        .lines()
        .map(str::trim)
        .find(|line| !line.is_empty())
        .map(str::to_string)
}

fn checked_engine(engine: &str) -> Result<String, String> {
    let trimmed = engine.trim();
    if crate::config::ENGINES.contains(&trimmed) {
        Ok(trimmed.to_string())
    } else {
        Err(format!("未知引擎：{engine}"))
    }
}

#[tauri::command]
pub async fn cli_version_status(engine: String) -> Result<CliVersionStatus, String> {
    let engine = checked_engine(&engine)?;
    let settings = crate::settings::read_settings().unwrap_or_default();
    let bin = crate::engine::engine_bin(&settings, &engine);
    let package = npm_package(&engine);
    // Local probe and registry probe are independent — run them concurrently
    // so the header waits on the slower of the two, not the sum.
    let (local, latest) = tokio::join!(probe_local_version(&bin), async move {
        match package {
            Some(package) => probe_latest_version(package).await,
            None => None,
        }
    });
    let update_available = match (
        local.version.as_deref().and_then(parse_version),
        latest.as_deref().and_then(parse_version),
    ) {
        (Some(local), Some(latest)) => latest > local,
        _ => false,
    };
    Ok(CliVersionStatus {
        update_kind: update_kind(&engine, &bin),
        engine,
        installed: local.installed,
        local_version: local.version,
        latest_version: latest,
        update_available,
    })
}

#[tauri::command]
pub async fn cli_update(engine: String) -> Result<UpdateResult, String> {
    let engine = checked_engine(&engine)?;
    let settings = crate::settings::read_settings().unwrap_or_default();
    let bin = crate::engine::engine_bin(&settings, &engine);
    match update_kind(&engine, &bin) {
        Some("npm") => {
            let package = npm_package(&engine).expect("npm kind implies package");
            run_npm_install(package).await?;
        }
        Some("native") => run_claude_native_install().await?,
        _ => return Err(format!("{engine} 不支持一键安装/更新。")),
    }
    // Fresh local version after the install.
    let probe = probe_local_version(&bin).await;
    Ok(UpdateResult {
        ok: true,
        version: probe.version,
    })
}

async fn run_npm_install(package: &str) -> Result<(), String> {
    let npm = resolve::resolve_launchable_cli_binary("npm");
    let mut command = command_for_binary(&npm);
    command.args([
        "install",
        "-g",
        "--maxsockets=1",
        "--fetch-retries=5",
        "--no-audit",
        "--no-fund",
        &format!("{package}@latest"),
    ]);
    let output = run_capture(&mut command, INSTALL_TIMEOUT)
        .await
        .map_err(|e| format!("无法运行 npm（{npm}）：{e}"))?;
    if output.timed_out {
        return Err("npm 安装超时（420 秒），请检查网络后重试。".to_string());
    }
    if !output.status.map(|s| s.success()).unwrap_or(false) {
        let combined = format!("{}\n{}", output.stdout, output.stderr);
        let tail = tail(&combined, ERROR_TAIL_CAP);
        return Err(format!(
            "npm 安装失败。{}",
            if tail.is_empty() {
                "无输出。".to_string()
            } else {
                format!("输出末尾：{tail}")
            }
        ));
    }
    Ok(())
}

/// Claude native channel: the official install script handles both fresh
/// installs and in-place updates.
async fn run_claude_native_install() -> Result<(), String> {
    let mut command = if cfg!(target_os = "windows") {
        let mut c = Command::new("powershell");
        c.args([
            "-NoProfile",
            "-ExecutionPolicy",
            "Bypass",
            "-Command",
            "irm https://claude.ai/install.ps1 | iex",
        ]);
        c
    } else {
        let mut c = Command::new("bash");
        c.args(["-lc", "curl -fsSL https://claude.ai/install.sh | bash"]);
        c
    };
    let output = run_capture(&mut command, INSTALL_TIMEOUT)
        .await
        .map_err(|e| format!("无法运行官方安装脚本：{e}"))?;
    if output.timed_out {
        return Err("安装脚本超时（420 秒），请检查网络后重试。".to_string());
    }
    if !output.status.map(|s| s.success()).unwrap_or(false) {
        let combined = format!("{}\n{}", output.stdout, output.stderr);
        let tail = tail(&combined, ERROR_TAIL_CAP);
        return Err(format!(
            "官方安装脚本执行失败。{}",
            if tail.is_empty() {
                "无输出。".to_string()
            } else {
                format!("输出末尾：{tail}")
            }
        ));
    }
    Ok(())
}

// ==================== Shared process helpers ====================

/// Run a short-lived command to completion with a timeout, capturing all of
/// stdout/stderr. The child gets its own process group (unix) so a timeout
/// kill takes grandchildren (npm's cmd/node chain) down too.
struct ProcOutput {
    status: Option<std::process::ExitStatus>,
    stdout: String,
    stderr: String,
    timed_out: bool,
}

async fn run_capture(command: &mut Command, limit: Duration) -> Result<ProcOutput, String> {
    command
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    #[cfg(unix)]
    command.process_group(0);
    #[cfg(windows)]
    crate::engine::hide_console(command);
    let mut child = command.spawn().map_err(|e| e.to_string())?;
    let pid = child.id();
    let stdout = child.stdout.take().map(spawn_read_all);
    let stderr = child.stderr.take().map(spawn_read_all);
    let (status, timed_out) = match timeout(limit, child.wait()).await {
        Ok(Ok(status)) => (Some(status), false),
        Ok(Err(e)) => return Err(e.to_string()),
        Err(_) => {
            if let Some(pid) = pid {
                crate::engine::kill_process_group(pid);
            }
            let _ = child.start_kill();
            let _ = child.wait().await;
            (None, true)
        }
    };
    let stdout = match stdout {
        Some(handle) => handle.await.unwrap_or_default(),
        None => String::new(),
    };
    let stderr = match stderr {
        Some(handle) => handle.await.unwrap_or_default(),
        None => String::new(),
    };
    Ok(ProcOutput {
        status,
        stdout,
        stderr,
        timed_out,
    })
}

fn spawn_read_all<R: AsyncRead + Unpin + Send + 'static>(pipe: R) -> JoinHandle<String> {
    tokio::spawn(async move {
        let mut bytes = Vec::new();
        let mut pipe = pipe;
        let _ = pipe.read_to_end(&mut bytes).await;
        String::from_utf8_lossy(&bytes).into_owned()
    })
}

/// Last `cap` bytes of `text`, on a char boundary.
fn tail(text: &str, cap: usize) -> &str {
    if text.len() <= cap {
        return text.trim();
    }
    let mut start = text.len() - cap;
    while !text.is_char_boundary(start) {
        start += 1;
    }
    text[start..].trim()
}

// ==================== Version compare ====================

/// Semver-ish tuple from the first digit-run in the text: "v1.2.3",
/// "2.1.228 (Claude Code)", "1.2" all parse; anything without digits → None.
fn parse_version(text: &str) -> Option<(u64, u64, u64)> {
    let text = text.trim();
    let start = text.find(|c: char| c.is_ascii_digit())?;
    let mut parts = text[start..].split('.');
    let major = leading_number(parts.next()?)?;
    let minor = parts.next().and_then(leading_number).unwrap_or(0);
    let patch = parts.next().and_then(leading_number).unwrap_or(0);
    Some((major, minor, patch))
}

fn leading_number(text: &str) -> Option<u64> {
    let digits: String = text.chars().take_while(|c| c.is_ascii_digit()).collect();
    digits.parse().ok()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_version_extracts_first_digit_run() {
        assert_eq!(parse_version("2.1.228 (Claude Code)"), Some((2, 1, 228)));
        assert_eq!(parse_version("v1.2.3"), Some((1, 2, 3)));
        assert_eq!(parse_version("1.2"), Some((1, 2, 0)));
        assert_eq!(parse_version("no digits"), None);
    }

    #[test]
    fn npm_package_covers_every_npm_engine() {
        for engine in ["claude", "kimi", "codex", "pi", "omp", "dsh"] {
            assert!(npm_package(engine).is_some(), "{engine} missing package");
        }
        assert_eq!(npm_package("grok"), None);
    }

    #[test]
    fn update_kind_matches_distribution_channel() {
        // npm engines always update through npm, regardless of binary path.
        assert_eq!(update_kind("dsh", "/usr/local/bin/dsh"), Some("npm"));
        // grok has no lifecycle action.
        assert_eq!(update_kind("grok", "/usr/local/bin/grok"), None);
        // claude: a node_modules path means the npm distribution.
        assert_eq!(
            update_kind("claude", "/usr/local/lib/node_modules/@anthropic-ai/claude-code/cli.js"),
            Some("npm")
        );
    }
}
