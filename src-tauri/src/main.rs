#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod document;
mod spec;

use document::Document;
use serde::Serialize;
use spec::{Format, Spec};
use std::{
    path::PathBuf,
    sync::{
        Mutex,
        atomic::{AtomicBool, Ordering},
    },
};
use tauri::{
    Emitter, Manager, State,
    menu::{MenuBuilder, MenuItemBuilder, SubmenuBuilder},
};

#[derive(Default)]
struct Session {
    document: Mutex<Document>,
    dirty: AtomicBool,
}
#[derive(Serialize)]
struct DocumentSnapshot {
    source: String,
    format: Format,
    path: Option<PathBuf>,
    name: String,
}
impl From<&Document> for DocumentSnapshot {
    fn from(document: &Document) -> Self {
        Self {
            source: document.source.clone(),
            format: document.format,
            path: document.path.clone(),
            name: document.name(),
        }
    }
}
fn snapshot(session: &Session) -> Result<DocumentSnapshot, String> {
    session
        .document
        .lock()
        .map(|doc| DocumentSnapshot::from(&*doc))
        .map_err(|_| "No se pudo acceder al documento.".into())
}
#[tauri::command]
fn current_document(session: State<'_, Session>) -> Result<DocumentSnapshot, String> {
    snapshot(&session)
}
#[tauri::command]
fn platform() -> &'static str {
    std::env::consts::OS
}
#[tauri::command]
fn set_dirty(dirty: bool, session: State<'_, Session>) {
    session.dirty.store(dirty, Ordering::SeqCst);
}
#[tauri::command]
fn quit_app(app: tauri::AppHandle, session: State<'_, Session>) {
    session.dirty.store(false, Ordering::SeqCst);
    app.exit(0);
}
#[tauri::command]
async fn parse_document(source: String, format: Format) -> Result<Spec, String> {
    tauri::async_runtime::spawn_blocking(move || Spec::parse(&source, format))
        .await
        .map_err(|_| "El analizador no pudo completar el trabajo.".to_string())?
}
#[tauri::command]
async fn rewrite_document(
    source: String,
    format: Format,
    target: Format,
) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        spec::parse_value(&source, format).and_then(|value| spec::serialize(&value, target))
    })
    .await
    .map_err(|_| "No se pudo convertir el documento.".to_string())?
}
#[tauri::command]
fn new_document(example: bool, session: State<'_, Session>) -> Result<DocumentSnapshot, String> {
    let document = if example {
        Document::untitled(
            include_str!("../../examples/petstore.yaml").into(),
            Format::Yaml,
        )
    } else {
        Document::default()
    };
    let result = DocumentSnapshot::from(&document);
    *session
        .document
        .lock()
        .map_err(|_| "No se pudo crear el documento.")? = document;
    session.dirty.store(false, Ordering::SeqCst);
    Ok(result)
}
#[tauri::command]
async fn open_document(
    path: Option<PathBuf>,
    app: tauri::AppHandle,
) -> Result<Option<DocumentSnapshot>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let path = path.or_else(|| {
            rfd::FileDialog::new()
                .set_title("Abrir especificación OpenAPI")
                .add_filter("OpenAPI / Swagger", &["json", "yaml", "yml"])
                .pick_file()
        });
        let Some(path) = path else {
            return Ok(None);
        };
        let document = Document::open(&path)?;
        let result = DocumentSnapshot::from(&document);
        let session = app.state::<Session>();
        *session
            .document
            .lock()
            .map_err(|_| "No se pudo abrir el documento.")? = document;
        session.dirty.store(false, Ordering::SeqCst);
        Ok(Some(result))
    })
    .await
    .map_err(|_| "No se pudo abrir el documento.".to_string())?
}
#[tauri::command]
async fn save_document(
    source: String,
    format: Format,
    save_as: bool,
    app: tauri::AppHandle,
) -> Result<Option<DocumentSnapshot>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let session = app.state::<Session>();
        let mut document = session
            .document
            .lock()
            .map_err(|_| "No se pudo acceder al documento.")?;
        document.source = source;
        document.format = format;
        let existing = document
            .path
            .clone()
            .filter(|p| !save_as && Format::detect("", Some(p)) == format);
        let path = existing.or_else(|| {
            let extensions: &[&str] = if format == Format::Json {
                &["json"]
            } else {
                &["yaml", "yml"]
            };
            let filename = format!(
                "{}.{}",
                document
                    .path
                    .as_ref()
                    .and_then(|p| p.file_stem())
                    .and_then(|s| s.to_str())
                    .unwrap_or("api"),
                format.extension()
            );
            let mut picker = rfd::FileDialog::new()
                .set_title("Guardar especificación")
                .add_filter(format.label(), extensions)
                .set_file_name(filename);
            if let Some(parent) = document.path.as_ref().and_then(|p| p.parent()) {
                picker = picker.set_directory(parent);
            }
            picker.save_file()
        });
        let Some(path) = path else {
            return Ok(None);
        };
        document.save_to(&path)?;
        session.dirty.store(document.dirty(), Ordering::SeqCst);
        Ok(Some(DocumentSnapshot::from(&*document)))
    })
    .await
    .map_err(|_| "No se pudo guardar el documento.".to_string())?
}
fn main() {
    tauri::Builder::default()
        .manage(Session::default())
        .setup(|app| {
            if let Some(path) = std::env::args_os().nth(1).map(PathBuf::from)
                && let Ok(document) = Document::open(&path)
            {
                *app.state::<Session>().document.lock().expect("New session") = document;
            }
            let new = MenuItemBuilder::with_id("new", "Nueva especificación")
                .accelerator("CmdOrCtrl+N")
                .build(app)?;
            let open = MenuItemBuilder::with_id("open", "Abrir…")
                .accelerator("CmdOrCtrl+O")
                .build(app)?;
            let save = MenuItemBuilder::with_id("save", "Guardar")
                .accelerator("CmdOrCtrl+S")
                .build(app)?;
            let save_as = MenuItemBuilder::with_id("save-as", "Guardar como…")
                .accelerator("CmdOrCtrl+Shift+S")
                .build(app)?;
            let quit = MenuItemBuilder::with_id("quit", "Salir de Swaggy")
                .accelerator("CmdOrCtrl+Q")
                .build(app)?;
            let file = SubmenuBuilder::new(app, "Archivo")
                .items(&[&new, &open, &save, &save_as])
                .separator()
                .text("convert-json", "Convertir a JSON…")
                .text("convert-yaml", "Convertir a YAML…")
                .separator()
                .text("example", "Abrir ejemplo Petstore")
                .build()?;
            let edit = SubmenuBuilder::new(app, "Edición")
                .undo()
                .redo()
                .separator()
                .cut()
                .copy()
                .paste()
                .select_all()
                .build()?;
            let view = SubmenuBuilder::new(app, "Vista")
                .text("view", "Visualizar")
                .text("edit", "Editar")
                .text("split", "Mixto")
                .separator()
                .text("theme", "Cambiar apariencia")
                .build()?;
            #[cfg(not(target_os = "macos"))]
            file.append(&quit)?;
            let menu = MenuBuilder::new(app);
            #[cfg(target_os = "macos")]
            let menu = {
                let app_menu = SubmenuBuilder::new(app, "Swaggy")
                    .about(None)
                    .separator()
                    .hide()
                    .hide_others()
                    .show_all()
                    .separator()
                    .item(&quit)
                    .build()?;
                menu.item(&app_menu)
            };
            app.set_menu(menu.items(&[&file, &edit, &view]).build()?)?;
            Ok(())
        })
        .on_menu_event(|app, event| {
            let _ = app.emit("menu-action", event.id().as_ref());
        })
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event
                && window.state::<Session>().dirty.load(Ordering::SeqCst)
            {
                api.prevent_close();
                let _ = window.emit("request-close", ());
            }
        })
        .invoke_handler(tauri::generate_handler![
            current_document,
            platform,
            set_dirty,
            quit_app,
            parse_document,
            rewrite_document,
            new_document,
            open_document,
            save_document
        ])
        .build(tauri::generate_context!())
        .expect("Could not initialize Swaggy")
        .run(|app, event| {
            if let tauri::RunEvent::ExitRequested { api, .. } = event
                && app.state::<Session>().dirty.load(Ordering::SeqCst)
            {
                api.prevent_exit();
                let _ = app.emit("request-close", ());
            }
        });
}
