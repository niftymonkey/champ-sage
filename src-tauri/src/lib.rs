use base64::Engine;
use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use futures_util::{SinkExt, StreamExt};
use rustls::client::danger::{HandshakeSignatureValid, ServerCertVerified, ServerCertVerifier};
use std::sync::{Arc, Mutex};
use tauri::{Emitter, Manager};
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

// ---------------------------------------------------------------------------
// Audio capture for voice input (issue #4)
//
// Uses cpal to capture microphone audio in Rust, independent of the webview.
// This is necessary because:
// 1. WebView getUserMedia has platform bugs (macOS permission issues, Linux
//    denied by default) — see docs/voice-input-research.md
// 2. Recording must work while the game is fullscreen and the app window is
//    unfocused — cpal runs in the Rust process regardless of window state
// 3. Global hotkey fires from Rust, so starting/stopping recording here
//    avoids a round-trip through the webview
//
// Audio format: 16-bit PCM, mono, 16kHz — optimized for speech recognition.
// A 10-second clip at this rate is ~320KB, well within Tauri IPC limits.
// The frontend receives WAV bytes and sends them to the STT API.
// ---------------------------------------------------------------------------

/// Managed state for audio recording.
///
/// cpal::Stream is !Send, so we can't store it in Tauri managed state directly.
/// Instead, we spawn the stream on a dedicated thread and communicate via
/// shared state: the buffer collects samples, and `is_recording` signals
/// the stream thread to stop.
///
/// `sample_rate` is set by the recording thread to whatever rate the device
/// actually supports. We can't hardcode 16kHz because Windows WASAPI devices
/// often only support 44.1kHz or 48kHz. Whisper resamples internally so any
/// standard rate works fine.
struct RecordingState {
    buffer: Arc<Mutex<Vec<i16>>>,
    is_recording: Arc<std::sync::atomic::AtomicBool>,
    sample_rate: Arc<std::sync::atomic::AtomicU32>,
    channels: Arc<std::sync::atomic::AtomicU16>,
}

/// Start capturing audio from the default input device.
///
/// Opens the default microphone, configures it for 16kHz mono 16-bit PCM,
/// and begins accumulating samples in memory. The cpal stream runs on a
/// dedicated thread (since cpal::Stream is !Send and can't live in Tauri
/// managed state).
///
/// Uses a oneshot channel so the command waits for the thread to confirm
/// the stream is actually recording before returning success. This ensures
/// errors (no mic, unsupported format) are reported to the frontend rather
/// than silently failing in the background.
#[tauri::command]
fn start_recording(state: tauri::State<'_, RecordingState>) -> Result<(), String> {
    // If a previous recording is still active (e.g., missed key release event),
    // stop it cleanly before starting a new one rather than erroring out.
    if state
        .is_recording
        .load(std::sync::atomic::Ordering::SeqCst)
    {
        state
            .is_recording
            .store(false, std::sync::atomic::Ordering::SeqCst);
        std::thread::sleep(std::time::Duration::from_millis(100));
    }

    // Clear any previous recording data
    if let Ok(mut buf) = state.buffer.lock() {
        buf.clear();
    }

    let buffer = state.buffer.clone();
    let is_recording = state.is_recording.clone();
    let sample_rate_store = state.sample_rate.clone();
    let channels_store = state.channels.clone();

    // Channel for the thread to report whether recording started successfully.
    // We block the command until we know the stream is actually capturing.
    let (tx, rx) = std::sync::mpsc::channel::<Result<(), String>>();

    // Spawn a dedicated thread for the cpal stream.
    // cpal::Stream is !Send so it must be created and live on the same thread.
    std::thread::spawn(move || {
        let host = cpal::default_host();
        let device = match host.default_input_device() {
            Some(d) => d,
            None => {
                let _ = tx.send(Err("No input device available".to_string()));
                return;
            }
        };

        // Use the device's default input config rather than hardcoding 16kHz mono.
        // Windows WASAPI devices often only support 44.1kHz or 48kHz stereo —
        // forcing 16kHz causes "configuration not supported" errors.
        // Whisper resamples internally, so any standard sample rate works fine.
        let default_config = match device.default_input_config() {
            Ok(c) => c,
            Err(e) => {
                let _ = tx.send(Err(format!("Failed to get default input config: {e}")));
                return;
            }
        };

        let config: cpal::StreamConfig = default_config.into();
        let actual_sample_rate = config.sample_rate.0;
        let actual_channels = config.channels;

        // Store the actual format so stop_recording can encode WAV correctly
        sample_rate_store.store(actual_sample_rate, std::sync::atomic::Ordering::SeqCst);
        channels_store.store(actual_channels, std::sync::atomic::Ordering::SeqCst);

        let buffer_clone = buffer.clone();
        let stream = match device.build_input_stream(
            &config,
            move |data: &[i16], _: &cpal::InputCallbackInfo| {
                if let Ok(mut buf) = buffer_clone.lock() {
                    buf.extend_from_slice(data);
                }
            },
            |err| {
                eprintln!("Audio input error: {err}");
            },
            None,
        ) {
            Ok(s) => s,
            Err(e) => {
                let _ = tx.send(Err(format!("Failed to build input stream: {e}")));
                return;
            }
        };

        if let Err(e) = stream.play() {
            let _ = tx.send(Err(format!("Failed to start recording: {e}")));
            return;
        }

        // Stream is now capturing — signal success and set the flag
        is_recording.store(true, std::sync::atomic::Ordering::SeqCst);
        let _ = tx.send(Ok(()));

        // Keep the stream alive until stop_recording flips the flag
        while is_recording.load(std::sync::atomic::Ordering::SeqCst) {
            std::thread::sleep(std::time::Duration::from_millis(50));
        }

        // Stream is dropped here, stopping capture
    });

    // Wait for the recording thread to report success or failure.
    // Timeout after 5 seconds to avoid hanging if the thread panics.
    rx.recv_timeout(std::time::Duration::from_secs(5))
        .map_err(|_| "Recording thread timed out".to_string())?
}

/// Stop recording and return the captured audio as WAV bytes.
///
/// Signals the recording thread to stop, then encodes the buffered PCM
/// samples into a WAV file in memory using hound. Returns the complete
/// WAV file as a byte vector for the frontend to send to the STT API.
#[tauri::command]
fn stop_recording(state: tauri::State<'_, RecordingState>) -> Result<Vec<u8>, String> {
    if !state
        .is_recording
        .load(std::sync::atomic::Ordering::SeqCst)
    {
        return Err("Not currently recording".to_string());
    }

    // Signal the recording thread to stop
    state
        .is_recording
        .store(false, std::sync::atomic::Ordering::SeqCst);

    // Brief pause to let the recording thread finish and drop the stream
    std::thread::sleep(std::time::Duration::from_millis(100));

    let samples = state
        .buffer
        .lock()
        .map_err(|e| format!("Buffer lock error: {e}"))?;

    if samples.is_empty() {
        return Err("No audio captured".to_string());
    }

    // Read the actual sample rate and channel count from the recording thread.
    // These were stored when the device's default config was queried.
    let sample_rate = state
        .sample_rate
        .load(std::sync::atomic::Ordering::SeqCst);
    let channels = state.channels.load(std::sync::atomic::Ordering::SeqCst);

    // Encode PCM samples as WAV in memory.
    // WAV is universally accepted by STT APIs (Whisper, Deepgram, local whisper.cpp).
    // We use whatever sample rate/channels the device actually captured at —
    // Whisper resamples internally so this doesn't affect transcription quality.
    let mut wav_buffer = std::io::Cursor::new(Vec::new());
    let spec = hound::WavSpec {
        channels,
        sample_rate,
        bits_per_sample: 16,
        sample_format: hound::SampleFormat::Int,
    };

    let mut writer = hound::WavWriter::new(&mut wav_buffer, spec)
        .map_err(|e| format!("Failed to create WAV writer: {e}"))?;

    for &sample in samples.iter() {
        writer
            .write_sample(sample)
            .map_err(|e| format!("Failed to write sample: {e}"))?;
    }

    writer
        .finalize()
        .map_err(|e| format!("Failed to finalize WAV: {e}"))?;

    Ok(wav_buffer.into_inner())
}

// ---------------------------------------------------------------------------
// Low-level keyboard hook for push-to-talk (Windows only)
//
// The Tauri global-shortcut plugin uses RegisterHotKey, which doesn't work
// when a DirectInput game (League of Legends) has focus. WH_KEYBOARD_LL
// hooks intercept keys at the OS level before any application sees them —
// the same mechanism Discord and OBS use for in-game hotkeys.
// ---------------------------------------------------------------------------

#[cfg(windows)]
mod keyboard_hook {
    use std::sync::atomic::{AtomicBool, Ordering};
    use std::sync::OnceLock;
    use tauri::Emitter;
    use windows::Win32::Foundation::{LPARAM, LRESULT, WPARAM};
    use windows::Win32::UI::WindowsAndMessaging::{
        CallNextHookEx, SetWindowsHookExW, HHOOK, KBDLLHOOKSTRUCT, WH_KEYBOARD_LL,
        WM_KEYDOWN, WM_KEYUP, WM_SYSKEYDOWN, WM_SYSKEYUP,
    };
    use windows::Win32::UI::Input::KeyboardAndMouse::VK_SUBTRACT;

    static APP_HANDLE: OnceLock<tauri::AppHandle> = OnceLock::new();
    static KEY_IS_DOWN: AtomicBool = AtomicBool::new(false);

    #[derive(serde::Serialize, Clone)]
    pub struct HotkeyEvent {
        pub state: String, // "Pressed" or "Released"
    }

    unsafe extern "system" fn hook_proc(
        n_code: i32,
        w_param: WPARAM,
        l_param: LPARAM,
    ) -> LRESULT {
        if n_code >= 0 {
            let kb = unsafe { &*(l_param.0 as *const KBDLLHOOKSTRUCT) };

            // NumpadSubtract = VK_SUBTRACT (0x6D)
            if kb.vkCode == VK_SUBTRACT.0 as u32 {
                let msg = w_param.0 as u32;
                let is_down = msg == WM_KEYDOWN || msg == WM_SYSKEYDOWN;
                let is_up = msg == WM_KEYUP || msg == WM_SYSKEYUP;

                if is_down && !KEY_IS_DOWN.load(Ordering::SeqCst) {
                    KEY_IS_DOWN.store(true, Ordering::SeqCst);
                    if let Some(handle) = APP_HANDLE.get() {
                        let _ = handle.emit("hotkey-event", HotkeyEvent {
                            state: "Pressed".to_string(),
                        });
                    }
                } else if is_up && KEY_IS_DOWN.load(Ordering::SeqCst) {
                    KEY_IS_DOWN.store(false, Ordering::SeqCst);
                    if let Some(handle) = APP_HANDLE.get() {
                        let _ = handle.emit("hotkey-event", HotkeyEvent {
                            state: "Released".to_string(),
                        });
                    }
                }
            }
        }
        unsafe { CallNextHookEx(HHOOK::default(), n_code, w_param, l_param) }
    }

    pub fn start(app_handle: tauri::AppHandle) {
        let _ = APP_HANDLE.set(app_handle);

        // The hook must run on a thread with a message pump
        std::thread::spawn(|| {
            unsafe {
                let hook = SetWindowsHookExW(WH_KEYBOARD_LL, Some(hook_proc), None, 0);
                if hook.is_err() {
                    eprintln!("Failed to install keyboard hook");
                    return;
                }

                // Message pump — required for WH_KEYBOARD_LL to work
                let mut msg = windows::Win32::UI::WindowsAndMessaging::MSG::default();
                while windows::Win32::UI::WindowsAndMessaging::GetMessageW(
                    &mut msg,
                    None,
                    0,
                    0,
                ).as_bool() {
                    let _ = windows::Win32::UI::WindowsAndMessaging::TranslateMessage(&msg);
                    windows::Win32::UI::WindowsAndMessaging::DispatchMessageW(&msg);
                }
            }
        });
    }
}

/// Append a line to a per-session coaching log file.
/// Log files are stored in the Tauri app data directory (platform-specific):
/// - Windows: %APPDATA%/com.champ-sage.app/coaching-logs/
/// - macOS: ~/Library/Application Support/com.champ-sage.app/coaching-logs/
/// - Linux: ~/.local/share/com.champ-sage.app/coaching-logs/
///
/// The path is initialized in setup() via `init_coaching_log_dir()`.
/// Falls back to a relative `data-dump/` if not initialized (e.g., tests).
static COACHING_LOG_PATH: std::sync::OnceLock<std::path::PathBuf> = std::sync::OnceLock::new();

fn init_coaching_log_dir(app_data_dir: std::path::PathBuf) -> Result<(), String> {
    let dir = app_data_dir.join("coaching-logs");
    std::fs::create_dir_all(&dir)
        .map_err(|e| format!("Failed to create coaching log directory '{}': {e}", dir.display()))?;
    let timestamp = chrono::Local::now().format("%Y-%m-%d_%H-%M-%S");
    let path = dir.join(format!("coaching-{timestamp}.log"));
    println!("[champ-sage] Coaching log path: {}", path.display());
    let _ = COACHING_LOG_PATH.set(path);
    println!("[champ-sage] Coaching log directory initialized");
    Ok(())
}

fn coaching_log_fallback_path() -> std::path::PathBuf {
    let dir = std::path::PathBuf::from("data-dump");
    let _ = std::fs::create_dir_all(&dir);
    let timestamp = chrono::Local::now().format("%Y-%m-%d_%H-%M-%S");
    dir.join(format!("coaching-{timestamp}.log"))
}

fn get_coaching_log_path() -> &'static std::path::PathBuf {
    COACHING_LOG_PATH.get_or_init(coaching_log_fallback_path)
}

#[tauri::command]
async fn append_coaching_log(text: String) -> Result<(), String> {
    use std::io::Write;
    let path = get_coaching_log_path();
    let mut file = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(path)
        .map_err(|e| format!("Failed to open log file: {e}"))?;
    writeln!(file, "{text}").map_err(|e| format!("Failed to write log: {e}"))?;
    Ok(())
}

#[tauri::command]
fn get_coaching_log_location() -> String {
    get_coaching_log_path().display().to_string()
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
        .manage(RecordingState {
            buffer: Arc::new(Mutex::new(Vec::new())),
            is_recording: Arc::new(std::sync::atomic::AtomicBool::new(false)),
            sample_rate: Arc::new(std::sync::atomic::AtomicU32::new(16000)),
            channels: Arc::new(std::sync::atomic::AtomicU16::new(1)),
        })
        .setup(|app| {
            #[cfg(desktop)]
            app.handle()
                .plugin(tauri_plugin_global_shortcut::Builder::new().build())?;

            match app.path().app_data_dir() {
                Ok(data_dir) => {
                    println!("[champ-sage] App data dir: {}", data_dir.display());
                    if let Err(e) = init_coaching_log_dir(data_dir) {
                        eprintln!("[champ-sage] ERROR: {e}");
                    }
                }
                Err(e) => {
                    eprintln!("[champ-sage] ERROR: Failed to get app data dir: {e}");
                }
            }

            #[cfg(windows)]
            keyboard_hook::start(app.handle().clone());

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            greet,
            fetch_riot_api,
            discover_lcu,
            fetch_lcu,
            connect_lcu_websocket,
            start_recording,
            stop_recording,
            append_coaching_log,
            get_coaching_log_location
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

    #[test]
    fn coaching_log_dir_created_in_app_data() {
        let tmp = std::env::temp_dir().join("champ-sage-test-log-dir");
        let _ = std::fs::remove_dir_all(&tmp);

        let result = init_coaching_log_dir(tmp.clone());
        assert!(result.is_ok(), "init_coaching_log_dir should succeed");

        let log_dir = tmp.join("coaching-logs");
        assert!(log_dir.exists(), "coaching-logs directory should be created");

        let _ = std::fs::remove_dir_all(&tmp);
    }

    #[test]
    fn coaching_log_fallback_path_uses_data_dump() {
        let path = coaching_log_fallback_path();
        assert!(
            path.starts_with("data-dump"),
            "fallback path should be in data-dump/, got: {}",
            path.display()
        );
        let filename = path.file_name().unwrap().to_str().unwrap();
        assert!(
            filename.starts_with("coaching-") && filename.ends_with(".log"),
            "fallback filename should be coaching-{{timestamp}}.log, got: {filename}"
        );
    }
}
