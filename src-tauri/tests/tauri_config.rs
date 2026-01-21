use std::fs;
use std::path::{Path, PathBuf};

use serde_json::Value;

#[test]
fn macos_private_api_feature_matches_config() {
    let manifest_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    let config_paths = [
        manifest_dir.join("tauri.conf.json"),
        manifest_dir.join("tauri.macos.conf.json"),
    ];
    let macos_private_api = config_paths
        .iter()
        .filter(|path| path.exists())
        .any(|path| config_has_macos_private_api(path));

    if macos_private_api {
        let cargo_path = manifest_dir.join("Cargo.toml");
        let cargo_contents = fs::read_to_string(&cargo_path)
            .unwrap_or_else(|error| panic!("Failed to read {cargo_path:?}: {error}"));
        let mut in_dependencies = false;
        let mut has_feature = false;

        for line in cargo_contents.lines() {
            let trimmed = line.trim();
            if trimmed.starts_with('[') {
                in_dependencies = trimmed == "[dependencies]";
                continue;
            }
            if !in_dependencies {
                continue;
            }
            if trimmed.starts_with("tauri") && trimmed.contains("macos-private-api") {
                has_feature = true;
                break;
            }
        }

        assert!(
            has_feature,
            "Cargo.toml [dependencies] must enable macos-private-api when app.macOSPrivateApi is true"
        );
    }
}

fn config_has_macos_private_api(path: &Path) -> bool {
    let config_contents =
        fs::read_to_string(path).unwrap_or_else(|error| panic!("Failed to read {path:?}: {error}"));
    let config: Value = serde_json::from_str(&config_contents)
        .unwrap_or_else(|error| panic!("Failed to parse {path:?}: {error}"));
    config
        .get("app")
        .and_then(|app| app.get("macOSPrivateApi"))
        .and_then(|value| value.as_bool())
        .unwrap_or(false)
}
