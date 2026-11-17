use crate::spec::{Format, MAX_BYTES};
use std::{
    fs,
    io::{Read, Write},
    path::{Path, PathBuf},
};

pub const TEMPLATE: &str = "openapi: 3.0.3\ninfo:\n  title: Untitled API\n  version: 1.0.0\n  description: Describe your API here.\npaths: {}\n";

pub struct Document {
    pub source: String,
    pub format: Format,
    pub path: Option<PathBuf>,
    saved: String,
    saved_format: Format,
    disk_source: Option<String>,
}
impl Default for Document {
    fn default() -> Self {
        Self::untitled(TEMPLATE.into(), Format::Yaml)
    }
}
impl Document {
    pub fn untitled(source: String, format: Format) -> Self {
        Self {
            saved: source.clone(),
            source,
            format,
            saved_format: format,
            path: None,
            disk_source: None,
        }
    }
    pub fn open(path: &Path) -> Result<Self, String> {
        let path = path
            .canonicalize()
            .map_err(|e| format!("No se pudo abrir el archivo: {e}"))?;
        let source = read(&path)?;
        let format = Format::detect(&source, Some(&path));
        Ok(Self {
            saved: source.clone(),
            disk_source: Some(source.clone()),
            source,
            format,
            saved_format: format,
            path: Some(path),
        })
    }
    pub fn dirty(&self) -> bool {
        self.source != self.saved || self.format != self.saved_format
    }
    pub fn name(&self) -> String {
        self.path
            .as_ref()
            .and_then(|p| p.file_name())
            .map(|p| p.to_string_lossy().into_owned())
            .unwrap_or_else(|| format!("untitled.{}", self.format.extension()))
    }
    pub fn save_to(&mut self, destination: &Path) -> Result<(), String> {
        if self.source.len() > MAX_BYTES {
            return Err("El documento supera el límite de 8 MiB.".into());
        }
        let actual = Format::detect("", Some(destination));
        let extension = destination
            .extension()
            .and_then(|v| v.to_str())
            .unwrap_or("")
            .to_ascii_lowercase();
        if !["json", "yaml", "yml"].contains(&extension.as_str()) || actual != self.format {
            return Err(format!(
                "Usa la extensión .{} para este documento, o conviértelo primero.",
                self.format.extension()
            ));
        }
        let destination = if destination.exists() {
            destination.canonicalize().map_err(|e| e.to_string())?
        } else {
            let parent = destination
                .parent()
                .filter(|p| !p.as_os_str().is_empty())
                .unwrap_or_else(|| Path::new("."));
            let name = destination
                .file_name()
                .ok_or("El destino debe ser un archivo.")?;
            parent.canonicalize().map_err(|e| e.to_string())?.join(name)
        };
        // Refuse to silently overwrite changes made by another editor.
        if self.path.as_ref() == Some(&destination) {
            let current = read(&destination).map_err(|e| {
                format!("No se puede comprobar el archivo original. Usa Guardar como. {e}")
            })?;
            if self.disk_source.as_deref() != Some(&current) {
                return Err("El archivo cambió fuera de Swaggy. Usa Guardar como para conservar ambas versiones.".into());
            }
        }
        let parent = destination
            .parent()
            .filter(|p| !p.as_os_str().is_empty())
            .unwrap_or_else(|| Path::new("."));
        let mut temporary = tempfile::NamedTempFile::new_in(parent).map_err(|e| e.to_string())?;
        if let Ok(metadata) = fs::metadata(&destination) {
            temporary
                .as_file()
                .set_permissions(metadata.permissions())
                .map_err(|e| e.to_string())?;
        }
        temporary
            .write_all(self.source.as_bytes())
            .map_err(|e| e.to_string())?;
        temporary.as_file().sync_all().map_err(|e| e.to_string())?;
        temporary
            .persist(&destination)
            .map_err(|e| format!("No se pudo guardar: {}", e.error))?;
        self.path = Some(destination.canonicalize().unwrap_or(destination));
        self.saved.clone_from(&self.source);
        self.disk_source = Some(self.source.clone());
        self.saved_format = self.format;
        Ok(())
    }
}
fn read(path: &Path) -> Result<String, String> {
    let file = fs::File::open(path).map_err(|e| format!("No se pudo leer el archivo: {e}"))?;
    let mut bytes = Vec::new();
    file.take((MAX_BYTES + 1) as u64)
        .read_to_end(&mut bytes)
        .map_err(|e| e.to_string())?;
    if bytes.len() > MAX_BYTES {
        return Err("El archivo supera el límite de 8 MiB.".into());
    }
    String::from_utf8(bytes).map_err(|_| "El archivo debe usar codificación UTF-8.".into())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn save_keeps_exact_source_and_detects_external_changes() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("api.yml");
        let source = "# Keep this comment\nopenapi: 3.0.3\n";
        let mut doc = Document::untitled(source.into(), Format::Yaml);
        doc.save_to(&path).unwrap();
        assert!(!doc.dirty());
        assert_eq!(fs::read_to_string(&path).unwrap(), source);
        doc.source.push_str("paths: {}\n");
        assert!(doc.dirty());
        fs::write(&path, "changed elsewhere").unwrap();
        assert!(doc.save_to(&path).is_err());
        assert_eq!(fs::read_to_string(&path).unwrap(), "changed elsewhere");
        assert!(doc.dirty());
    }
    #[test]
    fn open_handles_yml_and_save_rejects_mismatched_extension() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("api.yml");
        fs::write(&path, TEMPLATE).unwrap();
        let mut doc = Document::open(&path).unwrap();
        assert_eq!(doc.format, Format::Yaml);
        assert!(!doc.dirty());
        assert!(doc.save_to(&directory.path().join("api.json")).is_err());
        assert!(!directory.path().join("api.json").exists());
    }
    #[test]
    fn failed_save_and_invalid_utf8_preserve_state() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("bad.yaml");
        fs::write(&path, [0xff]).unwrap();
        assert!(Document::open(&path).is_err());
        let mut doc = Document::default();
        doc.source.push_str("# change\n");
        assert!(
            doc.save_to(&directory.path().join("missing/api.yaml"))
                .is_err()
        );
        assert!(doc.dirty());
        assert!(doc.path.is_none());
    }
    #[test]
    fn conversion_saves_matching_extensions_and_keeps_the_original_file() {
        use crate::spec::{parse_value, serialize};
        let directory = tempfile::tempdir().unwrap();
        let original = directory.path().join("api.yml");
        let json = directory.path().join("api.json");
        let converted_yaml = directory.path().join("converted.yml");
        fs::write(&original, format!("# Preserve original\n{TEMPLATE}")).unwrap();
        let original_source = fs::read_to_string(&original).unwrap();
        let mut document = Document::open(&original).unwrap();
        let data = parse_value(&document.source, document.format).unwrap();
        document.source = serialize(&data, Format::Json).unwrap();
        document.format = Format::Json;
        assert!(document.dirty());
        assert!(document.save_to(&original).is_err());
        document.save_to(&json).unwrap();
        assert!(!document.dirty());
        let mut restored = Document::open(&json).unwrap();
        assert_eq!(restored.format, Format::Json);
        assert_eq!(
            parse_value(&restored.source, restored.format).unwrap(),
            data
        );
        restored.source = serialize(&data, Format::Yaml).unwrap();
        restored.format = Format::Yaml;
        restored.save_to(&converted_yaml).unwrap();
        let restored_yaml = Document::open(&converted_yaml).unwrap();
        assert_eq!(restored_yaml.format, Format::Yaml);
        assert_eq!(
            parse_value(&restored_yaml.source, restored_yaml.format).unwrap(),
            data
        );
        assert_eq!(fs::read_to_string(&original).unwrap(), original_source);
    }
    #[test]
    fn deleted_original_requires_save_as() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("api.yaml");
        let mut doc = Document::default();
        doc.save_to(&path).unwrap();
        fs::remove_file(&path).unwrap();
        assert!(doc.save_to(&path).is_err());
    }
}
