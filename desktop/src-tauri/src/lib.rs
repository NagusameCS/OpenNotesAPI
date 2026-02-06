use reqwest::header::{HeaderMap, HeaderValue, ORIGIN, REFERER, CONTENT_TYPE};
use serde::{Deserialize, Serialize};

#[derive(Debug, Serialize, Deserialize)]
pub struct HttpResponse {
    pub status: u16,
    pub body: String,
    pub ok: bool,
}

#[tauri::command]
async fn api_fetch(url: String, method: Option<String>) -> Result<HttpResponse, String> {
    let client = reqwest::Client::new();
    
    let mut headers = HeaderMap::new();
    headers.insert(CONTENT_TYPE, HeaderValue::from_static("application/json"));
    headers.insert(ORIGIN, HeaderValue::from_static("https://nagusamecs.github.io"));
    headers.insert(REFERER, HeaderValue::from_static("https://nagusamecs.github.io/OpenNotesAPI/"));
    
    let method_str = method.unwrap_or_else(|| "GET".to_string());
    
    let request_builder = match method_str.to_uppercase().as_str() {
        "POST" => client.post(&url),
        "PUT" => client.put(&url),
        "DELETE" => client.delete(&url),
        _ => client.get(&url),
    };
    
    let response = request_builder
        .headers(headers)
        .send()
        .await
        .map_err(|e| format!("Request failed: {}", e))?;
    
    let status = response.status().as_u16();
    let ok = response.status().is_success();
    let body = response.text().await.map_err(|e| format!("Failed to read body: {}", e))?;
    
    Ok(HttpResponse { status, body, ok })
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  tauri::Builder::default()
    .plugin(tauri_plugin_fs::init())
    .plugin(tauri_plugin_store::Builder::new().build())
    .plugin(tauri_plugin_shell::init())
    .plugin(tauri_plugin_http::init())
    .invoke_handler(tauri::generate_handler![api_fetch])
    .setup(|app| {
      if cfg!(debug_assertions) {
        app.handle().plugin(
          tauri_plugin_log::Builder::default()
            .level(log::LevelFilter::Info)
            .build(),
        )?;
      }
      Ok(())
    })
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}
