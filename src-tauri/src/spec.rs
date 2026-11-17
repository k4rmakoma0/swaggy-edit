use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::HashSet;

pub const MAX_BYTES: usize = 8 * 1024 * 1024;
pub const METHODS: &[&str] = &[
    "get", "post", "put", "patch", "delete", "options", "head", "trace", "query",
];

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
pub enum Format {
    Json,
    #[default]
    Yaml,
}
impl Format {
    pub fn label(self) -> &'static str {
        match self {
            Self::Json => "JSON",
            Self::Yaml => "YAML",
        }
    }
    pub fn extension(self) -> &'static str {
        match self {
            Self::Json => "json",
            Self::Yaml => "yaml",
        }
    }
    pub fn detect(source: &str, path: Option<&std::path::Path>) -> Self {
        match path
            .and_then(|p| p.extension())
            .and_then(|e| e.to_str())
            .map(str::to_ascii_lowercase)
            .as_deref()
        {
            Some("json") => Self::Json,
            Some("yaml" | "yml") => Self::Yaml,
            _ if source.trim_start().starts_with('{') => Self::Json,
            _ => Self::Yaml,
        }
    }
}

#[derive(Clone, Debug, Serialize)]
pub struct Diagnostic {
    pub error: bool,
    pub location: String,
    pub message: String,
}
#[derive(Clone, Debug, Serialize)]
pub struct Operation {
    pub path: String,
    pub method: String,
    pub tag: String,
    pub summary: String,
    pub value: Value,
    pub parameters: Vec<Value>,
}
#[derive(Debug, Serialize)]
pub struct Spec {
    pub root: Value,
    pub operations: Vec<Operation>,
    pub diagnostics: Vec<Diagnostic>,
}

pub fn parse_value(source: &str, format: Format) -> Result<Value, String> {
    if source.len() > MAX_BYTES {
        return Err("El documento supera el límite de 8 MiB.".into());
    }
    let source = source.trim_start_matches('\u{feff}');
    match format {
        Format::Json => serde_json::from_str(source).map_err(|e| e.to_string()),
        Format::Yaml => serde_saphyr::from_str(source).map_err(|e| e.to_string()),
    }
}
pub fn serialize(value: &Value, format: Format) -> Result<String, String> {
    let mut result = match format {
        Format::Json => serde_json::to_string_pretty(value).map_err(|e| e.to_string())?,
        Format::Yaml => serde_saphyr::to_string(value).map_err(|e| e.to_string())?,
    };
    if !result.ends_with('\n') {
        result.push('\n');
    }
    if result.len() > MAX_BYTES {
        return Err(
            "El resultado supera el límite de 8 MiB. Reduce el documento antes de convertirlo."
                .into(),
        );
    }
    Ok(result)
}
pub fn text<'a>(value: &'a Value, key: &str) -> &'a str {
    value[key].as_str().unwrap_or("")
}

impl Spec {
    pub fn parse(source: &str, format: Format) -> Result<Self, String> {
        let root = parse_value(source, format)?;
        let mut spec = Self {
            root,
            operations: Vec::new(),
            diagnostics: Vec::new(),
        };
        spec.inspect();
        Ok(spec)
    }
    fn issue(&mut self, error: bool, location: &str, message: impl Into<String>) {
        self.diagnostics.push(Diagnostic {
            error,
            location: location.into(),
            message: message.into(),
        });
    }
    fn inspect(&mut self) {
        if !self.root.is_object() {
            self.issue(true, "/", "La raíz debe ser un objeto OpenAPI o Swagger.");
            return;
        }
        let swagger = self.root["swagger"] == "2.0";
        let version = text(&self.root, "openapi").to_owned();
        if !swagger
            && !["3.0.", "3.1.", "3.2."]
                .iter()
                .any(|v| version.starts_with(v) && version[v.len()..].parse::<u32>().is_ok())
        {
            self.issue(
                true,
                "/openapi",
                "Usa swagger: '2.0' u openapi: 3.0.x, 3.1.x o 3.2.x.",
            );
        }
        for field in ["title", "version"] {
            if self.root["info"][field]
                .as_str()
                .is_none_or(|s| s.trim().is_empty())
            {
                self.issue(
                    true,
                    &format!("/info/{field}"),
                    "Este campo es obligatorio y debe ser un texto no vacío.",
                );
            }
        }
        if swagger || version.starts_with("3.0.") {
            if !self.root["paths"].is_object() {
                self.issue(
                    true,
                    "/paths",
                    "paths debe ser un objeto (puede estar vacío).",
                );
            }
        } else if !["paths", "components", "webhooks"]
            .iter()
            .any(|key| self.root[*key].is_object())
        {
            self.issue(true, "/", "Se necesita paths, components o webhooks.");
        }
        if !self.root["paths"].is_null() && !self.root["paths"].is_object() {
            self.issue(true, "/paths", "paths debe ser un objeto.");
        }
        let paths = self.root["paths"].as_object().cloned().unwrap_or_default();
        let mut ids = HashSet::new();
        for (path, item) in paths {
            if path.starts_with("x-") {
                continue;
            }
            if !path.starts_with('/') {
                self.issue(true, &path, "Las rutas deben comenzar con /.");
            }
            let item = match self.resolve(&item) {
                Ok(item) => item.clone(),
                Err(_) => continue,
            };
            if !item.is_object() {
                self.issue(true, &path, "La definición de la ruta debe ser un objeto.");
                continue;
            }
            for method in METHODS {
                let Some(operation) = item.get(*method) else {
                    continue;
                };
                let location = format!("{method} {path}");
                if !operation.is_object() {
                    self.issue(true, &location, "La operación debe ser un objeto.");
                    continue;
                }
                if !operation["responses"].is_object()
                    || operation["responses"]
                        .as_object()
                        .is_some_and(|v| v.is_empty())
                {
                    self.issue(
                        true,
                        &location,
                        "La operación necesita un objeto responses con al menos una respuesta.",
                    );
                }
                let id = text(operation, "operationId");
                if !id.is_empty() && !ids.insert(id.to_owned()) {
                    self.issue(true, &location, format!("operationId duplicado: {id}"));
                }
                // Operation parameters override path-level parameters by (name, in).
                let mut parameters: Vec<Value> = Vec::new();
                for parameter in item["parameters"]
                    .as_array()
                    .into_iter()
                    .flatten()
                    .chain(operation["parameters"].as_array().into_iter().flatten())
                {
                    let resolved = self.resolve(parameter).unwrap_or(parameter);
                    if let Some(index) = parameters.iter().position(|old| {
                        let old = self.resolve(old).unwrap_or(old);
                        !text(resolved, "name").is_empty()
                            && old["name"] == resolved["name"]
                            && old["in"] == resolved["in"]
                    }) {
                        parameters[index] = parameter.clone();
                    } else {
                        parameters.push(parameter.clone());
                    }
                }
                self.operations.push(Operation {
                    path: path.clone(),
                    method: method.to_uppercase(),
                    tag: operation["tags"][0].as_str().unwrap_or("General").into(),
                    summary: text(operation, "summary").into(),
                    value: operation.clone(),
                    parameters,
                });
            }
        }
        // Do not follow references while scanning: recursive schemas are valid.
        let mut stack = vec![(&self.root, String::new())];
        let mut issues = Vec::new();
        while let Some((value, location)) = stack.pop() {
            match value {
                Value::Object(map) => {
                    // Example payloads can legitimately contain a literal "$ref" key.
                    if let Some(reference) = map.get("$ref").and_then(Value::as_str) {
                        if reference.starts_with('#') {
                            if self.reference(reference).is_err() {
                                issues.push((
                                    true,
                                    location.clone(),
                                    format!("Referencia local no encontrada: {reference}"),
                                ));
                            }
                        } else {
                            issues.push((false, location.clone(), format!("Referencia externa sin resolver: {reference}. Esta app no accede a archivos externos ni a la red.")));
                        }
                    }
                    for (key, child) in map {
                        if ["example", "examples", "default", "enum", "const"]
                            .contains(&key.as_str())
                            || key.starts_with("x-")
                        {
                            continue;
                        }
                        stack.push((
                            child,
                            format!("{location}/{}", key.replace('~', "~0").replace('/', "~1")),
                        ));
                    }
                }
                Value::Array(array) => {
                    for (index, child) in array.iter().enumerate() {
                        stack.push((child, format!("{location}/{index}")));
                    }
                }
                _ => {}
            }
        }
        for (error, location, message) in issues {
            self.issue(error, &location, message);
        }
    }
    pub fn reference(&self, reference: &str) -> Result<&Value, String> {
        let Some(pointer) = reference.strip_prefix('#') else {
            return Err(format!("Referencia externa: {reference}"));
        };
        let pointer = percent_encoding::percent_decode_str(pointer)
            .decode_utf8()
            .map_err(|_| format!("Referencia inválida: {reference}"))?;
        self.root
            .pointer(&pointer)
            .ok_or_else(|| format!("Referencia no encontrada: {reference}"))
    }
    pub fn resolve<'a>(&'a self, mut value: &'a Value) -> Result<&'a Value, String> {
        let mut seen = HashSet::new();
        while let Some(reference) = value["$ref"].as_str() {
            if !seen.insert(reference) {
                return Err(format!("Referencia circular: {reference}"));
            }
            value = self.reference(reference)?;
        }
        Ok(value)
    }
    #[cfg(test)]
    pub fn errors(&self) -> usize {
        self.diagnostics.iter().filter(|d| d.error).count()
    }
    #[cfg(test)]
    pub fn schemas(&self) -> Option<&serde_json::Map<String, Value>> {
        self.root
            .pointer("/components/schemas")
            .or_else(|| self.root.get("definitions"))
            .and_then(Value::as_object)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    const EXAMPLE: &str = include_str!("../../examples/petstore.yaml");
    #[test]
    fn parses_example_and_round_trips_both_formats() {
        let spec = Spec::parse(EXAMPLE, Format::Yaml).unwrap();
        assert_eq!(spec.errors(), 0, "{:?}", spec.diagnostics);
        assert_eq!(spec.operations.len(), 4);
        for format in [Format::Json, Format::Yaml] {
            assert_eq!(
                parse_value(&serialize(&spec.root, format).unwrap(), format).unwrap(),
                spec.root
            );
        }
    }
    #[test]
    fn yaml_json_yaml_preserves_anchors_references_and_scalar_types() {
        let yaml = "openapi: 3.0.3\ninfo: {title: 'México 🦀', version: '1.0'}\nx-description: &description {description: OK}\nx-values: ['001', true, null, 9007199254740993]\npaths:\n  /pets:\n    get:\n      responses:\n        200: *description\ncomponents:\n  schemas:\n    Pet: {type: object}\n    Pets: {type: array, items: {$ref: '#/components/schemas/Pet'}}\n";
        let original = parse_value(yaml, Format::Yaml).unwrap();
        let json = serialize(&original, Format::Json).unwrap();
        let from_json = parse_value(&json, Format::Json).unwrap();
        let converted_yaml = serialize(&from_json, Format::Yaml).unwrap();
        assert_eq!(
            parse_value(&converted_yaml, Format::Yaml).unwrap(),
            original
        );
        assert_eq!(from_json["x-values"][0], "001");
        assert_eq!(
            from_json["x-values"][3].as_u64(),
            Some(9_007_199_254_740_993)
        );
        assert_eq!(
            from_json["paths"]["/pets"]["get"]["responses"]["200"]["description"],
            "OK"
        );
    }
    #[test]
    fn conversion_rejects_output_larger_than_the_document_limit() {
        let value = serde_json::json!({"value": "x".repeat(MAX_BYTES - 16)});
        let compact = serde_json::to_string(&value).unwrap();
        assert!(compact.len() <= MAX_BYTES);
        let parsed = parse_value(&compact, Format::Json).unwrap();
        assert!(serialize(&parsed, Format::Json).is_err());
    }
    #[test]
    fn swagger_two_and_numeric_response_keys() {
        let source = "swagger: '2.0'\ninfo: {title: Test, version: '1'}\npaths:\n  /pets:\n    get:\n      responses:\n        200: {description: OK}\ndefinitions:\n  Pet: {type: object}\n";
        let spec = Spec::parse(source, Format::Yaml).unwrap();
        assert_eq!(spec.errors(), 0);
        assert!(spec.operations[0].value["responses"]["200"].is_object());
        assert_eq!(spec.schemas().unwrap().len(), 1);
    }
    #[test]
    fn rejects_syntax_and_reports_structure() {
        assert!(Spec::parse("{bad", Format::Json).is_err());
        assert!(Spec::parse("a: [", Format::Yaml).is_err());
        assert!(Spec::parse("a: 1\na: 2", Format::Yaml).is_err());
        assert!(Spec::parse("[]", Format::Json).unwrap().errors() > 0);
        assert!(
            Spec::parse("{\"openapi\":\"3.99.0\"}", Format::Json)
                .unwrap()
                .errors()
                > 0
        );
    }
    #[test]
    fn resolves_refs_and_does_not_recurse_recursive_schema() {
        let spec = Spec::parse("openapi: 3.1.0\ninfo: {title: T, version: '1'}\ncomponents:\n  schemas:\n    Node:\n      type: object\n      properties:\n        next: {$ref: '#/components/schemas/Node'}\n", Format::Yaml).unwrap();
        assert_eq!(spec.errors(), 0);
        assert!(spec.reference("#/components/schemas/Node").is_ok());
        assert!(spec.reference("#/missing").is_err());
    }
    #[test]
    fn parameter_override_and_search() {
        let spec = Spec::parse("openapi: 3.0.3\ninfo: {title: T, version: '1'}\npaths:\n  /pets:\n    parameters: [{name: limit, in: query, description: old}]\n    get:\n      parameters: [{name: limit, in: query, description: new}]\n      responses: {'200': {description: OK}}\n", Format::Yaml).unwrap();
        assert_eq!(spec.operations[0].parameters.len(), 1);
        assert_eq!(spec.operations[0].parameters[0]["description"], "new");
    }
    #[test]
    fn unresolved_refs_are_diagnostic_and_cycles_are_bounded() {
        let spec = Spec::parse("openapi: 3.1.0\ninfo: {title: T, version: '1'}\ncomponents:\n  schemas:\n    A: {$ref: '#/components/schemas/B'}\n    B: {$ref: '#/components/schemas/A'}\n    C: {$ref: '#/missing'}\n    D: {$ref: 'other.yaml#/Pet'}\n", Format::Yaml).unwrap();
        assert_eq!(spec.errors(), 1);
        assert!(
            spec.resolve(&spec.root["components"]["schemas"]["A"])
                .is_err()
        );
        assert!(spec.diagnostics.iter().any(|d| !d.error));
    }
    #[test]
    fn detects_extensions_and_bom() {
        assert_eq!(
            Format::detect("{}", Some(std::path::Path::new("API.YML"))),
            Format::Yaml
        );
        assert!(parse_value("\u{feff}{}", Format::Json).is_ok());
    }
}
