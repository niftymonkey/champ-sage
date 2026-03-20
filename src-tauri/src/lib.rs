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

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            #[cfg(desktop)]
            app.handle()
                .plugin(tauri_plugin_global_shortcut::Builder::new().build())?;
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![greet, fetch_riot_api])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
