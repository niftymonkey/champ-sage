use base64::Engine;
use futures_util::{SinkExt, StreamExt};
use rustls::client::danger::{HandshakeSignatureValid, ServerCertVerified, ServerCertVerifier};
use tauri::Emitter;
use tokio_tungstenite::tungstenite;

/// Resolve the League Client lockfile path for the current platform.
/// Honors `LCU_LOCKFILE_PATH` env var as an override.
fn resolve_lockfile_path() -> String {
    if let Ok(path) = std::env::var("LCU_LOCKFILE_PATH") {
        return path;
    }

    // WSL2: /proc/version contains "microsoft" or "WSL"
    if let Ok(version) = std::fs::read_to_string("/proc/version") {
        let lower = version.to_lowercase();
        if lower.contains("microsoft") || lower.contains("wsl") {
            return "/mnt/c/Riot Games/League of Legends/lockfile".to_string();
        }
    }

    if cfg!(target_os = "macos") {
        return "/Applications/League of Legends.app/Contents/LoL/lockfile".to_string();
    }

    // Windows native (or fallback)
    r"C:\Riot Games\League of Legends\lockfile".to_string()
}

#[derive(serde::Serialize, serde::Deserialize, Debug, Clone, PartialEq)]
struct LcuCredentials {
    port: u16,
    token: String,
}

#[derive(serde::Serialize, Clone)]
struct LcuEvent {
    uri: String,
    event_type: String,
    data: serde_json::Value,
}

#[derive(serde::Serialize, Clone)]
struct LcuDisconnect {
    reason: String,
}

/// Parse a League Client lockfile into credentials.
/// Format: `process:pid:port:auth_token:protocol`
fn parse_lockfile(content: &str) -> Result<LcuCredentials, String> {
    let parts: Vec<&str> = content.trim().split(':').collect();
    if parts.len() < 5 {
        return Err(format!(
            "Lockfile has {} fields, expected at least 5",
            parts.len()
        ));
    }
    let port: u16 = parts[2]
        .parse()
        .map_err(|_| format!("Invalid port: '{}'", parts[2]))?;
    let token = parts[3].to_string();
    if token.is_empty() {
        return Err("Auth token is empty".to_string());
    }
    Ok(LcuCredentials { port, token })
}

/// Build the Basic auth header value for LCU requests.
fn lcu_basic_auth(token: &str) -> String {
    let encoded = base64::engine::general_purpose::STANDARD.encode(format!("riot:{token}"));
    format!("Basic {encoded}")
}

/// A TLS certificate verifier that accepts all certificates.
/// Used for localhost connections to the LCU which uses a self-signed cert.
#[derive(Debug)]
struct NoVerifier;

impl ServerCertVerifier for NoVerifier {
    fn verify_server_cert(
        &self,
        _end_entity: &rustls::pki_types::CertificateDer<'_>,
        _intermediates: &[rustls::pki_types::CertificateDer<'_>],
        _server_name: &rustls::pki_types::ServerName<'_>,
        _ocsp_response: &[u8],
        _now: rustls::pki_types::UnixTime,
    ) -> Result<ServerCertVerified, rustls::Error> {
        Ok(ServerCertVerified::assertion())
    }

    fn verify_tls12_signature(
        &self,
        _message: &[u8],
        _cert: &rustls::pki_types::CertificateDer<'_>,
        _dss: &rustls::DigitallySignedStruct,
    ) -> Result<HandshakeSignatureValid, rustls::Error> {
        Ok(HandshakeSignatureValid::assertion())
    }

    fn verify_tls13_signature(
        &self,
        _message: &[u8],
        _cert: &rustls::pki_types::CertificateDer<'_>,
        _dss: &rustls::DigitallySignedStruct,
    ) -> Result<HandshakeSignatureValid, rustls::Error> {
        Ok(HandshakeSignatureValid::assertion())
    }

    fn supported_verify_schemes(&self) -> Vec<rustls::SignatureScheme> {
        vec![
            rustls::SignatureScheme::RSA_PKCS1_SHA256,
            rustls::SignatureScheme::RSA_PKCS1_SHA384,
            rustls::SignatureScheme::RSA_PKCS1_SHA512,
            rustls::SignatureScheme::ECDSA_NISTP256_SHA256,
            rustls::SignatureScheme::ECDSA_NISTP384_SHA384,
            rustls::SignatureScheme::ECDSA_NISTP521_SHA512,
            rustls::SignatureScheme::RSA_PSS_SHA256,
            rustls::SignatureScheme::RSA_PSS_SHA384,
            rustls::SignatureScheme::RSA_PSS_SHA512,
            rustls::SignatureScheme::ED25519,
            rustls::SignatureScheme::ED448,
        ]
    }
}

#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! You've been greeted from Rust!", name)
}

/// Proxy fetch to the Riot Live Client Data API.
/// The API uses a self-signed certificate on localhost:2999 that browsers
/// reject, so we proxy through Rust where we can accept invalid certs.
///
/// Returns the raw JSON string on success, or an error with a status code hint.
#[tauri::command]
async fn fetch_riot_api(endpoint: String) -> Result<String, String> {
    let url = format!("https://localhost:2999{endpoint}");

    let client = reqwest::Client::builder()
        .danger_accept_invalid_certs(true)
        .build()
        .map_err(|e| format!("Failed to build HTTP client: {e}"))?;

    let response = client
        .get(&url)
        .send()
        .await
        .map_err(|e| format!("CONNECTION_FAILED:{e}"))?;

    let status = response.status().as_u16();
    if status == 404 {
        return Err("LOADING".to_string());
    }
    if !response.status().is_success() {
        return Err(format!("HTTP_{status}"));
    }

    response
        .text()
        .await
        .map_err(|e| format!("Failed to read response: {e}"))
}

/// Read the League Client lockfile and return connection credentials.
#[tauri::command]
async fn discover_lcu() -> Result<LcuCredentials, String> {
    let lockfile_path = resolve_lockfile_path();
    let content = tokio::fs::read_to_string(&lockfile_path)
        .await
        .map_err(|e| format!("Lockfile not found (client not running?): {e}"))?;
    parse_lockfile(&content)
}

/// Proxy fetch to the LCU REST API with Basic auth and self-signed cert handling.
#[tauri::command]
async fn fetch_lcu(port: u16, token: String, endpoint: String) -> Result<String, String> {
    let url = format!("https://127.0.0.1:{port}{endpoint}");

    let client = reqwest::Client::builder()
        .danger_accept_invalid_certs(true)
        .build()
        .map_err(|e| format!("Failed to build HTTP client: {e}"))?;

    let response = client
        .get(&url)
        .header("Authorization", lcu_basic_auth(&token))
        .send()
        .await
        .map_err(|e| format!("CONNECTION_FAILED:{e}"))?;

    let status = response.status().as_u16();
    if !response.status().is_success() {
        return Err(format!("HTTP_{status}"));
    }

    response
        .text()
        .await
        .map_err(|e| format!("Failed to read response: {e}"))
}

/// Connect to the LCU WebSocket (WAMP 1.0) and bridge events to the frontend.
///
/// Subscribes to `OnJsonApiEvent` and emits each event on the `lcu-event` channel.
/// On disconnect or error, emits on the `lcu-disconnect` channel.
#[tauri::command]
async fn connect_lcu_websocket(
    port: u16,
    token: String,
    app_handle: tauri::AppHandle,
) -> Result<(), String> {
    let url = format!("wss://127.0.0.1:{port}/");
    let auth = lcu_basic_auth(&token);

    // Build a TLS connector that skips cert verification (localhost self-signed)
    let tls_config = rustls::ClientConfig::builder()
        .dangerous()
        .with_custom_certificate_verifier(std::sync::Arc::new(NoVerifier))
        .with_no_client_auth();
    let connector =
        tokio_tungstenite::Connector::Rustls(std::sync::Arc::new(tls_config));

    let request = tungstenite::http::Request::builder()
        .uri(&url)
        .header("Authorization", &auth)
        .header("Sec-WebSocket-Version", "13")
        .header("Sec-WebSocket-Key", tungstenite::handshake::client::generate_key())
        .header("Host", format!("127.0.0.1:{port}"))
        .header("Connection", "Upgrade")
        .header("Upgrade", "websocket")
        .body(())
        .map_err(|e| format!("Failed to build WebSocket request: {e}"))?;

    let (ws_stream, _) = tokio_tungstenite::connect_async_tls_with_config(
        request,
        None,
        false,
        Some(connector),
    )
    .await
    .map_err(|e| format!("WebSocket connection failed: {e}"))?;

    let (mut write, mut read) = ws_stream.split();

    // Subscribe to all LCU JSON API events (WAMP 1.0 subscribe = opcode 5)
    let subscribe_msg = serde_json::json!([5, "OnJsonApiEvent"]).to_string();
    write
        .send(tungstenite::Message::Text(subscribe_msg.into()))
        .await
        .map_err(|e| format!("Failed to send subscribe message: {e}"))?;

    // Spawn a task to read messages — the command returns immediately
    let handle = app_handle.clone();
    tokio::spawn(async move {
        while let Some(msg_result) = read.next().await {
            match msg_result {
                Ok(tungstenite::Message::Text(text)) => {
                    if let Ok(arr) = serde_json::from_str::<Vec<serde_json::Value>>(&text) {
                        // WAMP event: [8, topic, payload]
                        if arr.len() >= 3 && arr[0] == 8 {
                            if let Some(payload) = arr[2].as_object() {
                                let event = LcuEvent {
                                    uri: payload
                                        .get("uri")
                                        .and_then(|v| v.as_str())
                                        .unwrap_or("")
                                        .to_string(),
                                    event_type: payload
                                        .get("eventType")
                                        .and_then(|v| v.as_str())
                                        .unwrap_or("")
                                        .to_string(),
                                    data: payload
                                        .get("data")
                                        .cloned()
                                        .unwrap_or(serde_json::Value::Null),
                                };
                                let _ = handle.emit("lcu-event", event);
                            }
                        }
                    }
                }
                Ok(tungstenite::Message::Close(_)) => {
                    let _ = handle.emit(
                        "lcu-disconnect",
                        LcuDisconnect {
                            reason: "Server closed connection".to_string(),
                        },
                    );
                    break;
                }
                Err(e) => {
                    let _ = handle.emit(
                        "lcu-disconnect",
                        LcuDisconnect {
                            reason: format!("WebSocket error: {e}"),
                        },
                    );
                    break;
                }
                _ => {} // Ping/Pong/Binary — ignore
            }
        }
    });

    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // Install ring as the default crypto provider for rustls.
    // Both ring and aws-lc-rs are pulled in transitively (reqwest uses ring,
    // tokio-tungstenite uses aws-lc-rs), so rustls can't auto-detect.
    rustls::crypto::ring::default_provider()
        .install_default()
        .expect("Failed to install rustls crypto provider");

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            #[cfg(desktop)]
            app.handle()
                .plugin(tauri_plugin_global_shortcut::Builder::new().build())?;
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            greet,
            fetch_riot_api,
            discover_lcu,
            fetch_lcu,
            connect_lcu_websocket
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_valid_lockfile() {
        let result = parse_lockfile("LeagueClient:12345:54321:abc123token:https").unwrap();
        assert_eq!(result.port, 54321);
        assert_eq!(result.token, "abc123token");
    }

    #[test]
    fn parse_lockfile_with_trailing_newline() {
        let result = parse_lockfile("LeagueClient:12345:54321:abc123token:https\n").unwrap();
        assert_eq!(result.port, 54321);
        assert_eq!(result.token, "abc123token");
    }

    #[test]
    fn parse_lockfile_too_few_fields() {
        let result = parse_lockfile("LeagueClient:12345");
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("fields"));
    }

    #[test]
    fn parse_lockfile_invalid_port() {
        let result = parse_lockfile("LeagueClient:12345:notaport:token:https");
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("Invalid port"));
    }

    #[test]
    fn parse_lockfile_empty() {
        let result = parse_lockfile("");
        assert!(result.is_err());
    }

    #[test]
    fn parse_lockfile_port_overflow() {
        let result = parse_lockfile("LeagueClient:12345:99999:token:https");
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("Invalid port"));
    }

    #[test]
    fn basic_auth_format() {
        let auth = lcu_basic_auth("mytoken");
        // riot:mytoken base64-encoded
        let expected_encoded =
            base64::engine::general_purpose::STANDARD.encode("riot:mytoken");
        assert_eq!(auth, format!("Basic {expected_encoded}"));
    }
}
