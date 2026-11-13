//! Pencere ve görev çubuğu ikonunun sistem temasına uyumu.
//!
//! Statik .ico dosyası tema değiştiremez; çalışma anında koyu temada açık,
//! açık temada koyu çizimli ikon atanır ki görev çubuğunda ikon kaybolmasın.

use tauri::image::Image;
use tauri::{Manager, Theme, WebviewWindow};

const ICON_FOR_LIGHT_THEME: &[u8] = include_bytes!("../icons/theme/icon-dark.png");
const ICON_FOR_DARK_THEME: &[u8] = include_bytes!("../icons/theme/icon-light.png");

/// Tema için doğru ikonu seçer; bilinmeyen tema açık kabul edilir.
fn icon_bytes(theme: Theme) -> &'static [u8] {
    match theme {
        Theme::Dark => ICON_FOR_DARK_THEME,
        _ => ICON_FOR_LIGHT_THEME,
    }
}

fn apply(window: &WebviewWindow, theme: Theme) {
    // İkon atanamazsa uygulama statik ikonla çalışmaya devam eder; kritik değildir.
    match Image::from_bytes(icon_bytes(theme)) {
        Ok(icon) => {
            if let Err(error) = window.set_icon(icon) {
                tracing::warn!("pencere ikonu değiştirilemedi: {error}");
            }
        }
        Err(error) => tracing::warn!("tema ikonu çözülemedi: {error}"),
    }
}

/// Ana pencerenin ikonunu mevcut temaya göre ayarlar ve tema değişimini izler.
pub fn install(app: &tauri::App) {
    let Some(window) = app.get_webview_window("main") else {
        return;
    };
    if let Ok(theme) = window.theme() {
        apply(&window, theme);
    }
    let target = window.clone();
    window.on_window_event(move |event| {
        if let tauri::WindowEvent::ThemeChanged(theme) = event {
            apply(&target, *theme);
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn dark_theme_uses_light_artwork() {
        assert_eq!(icon_bytes(Theme::Dark), ICON_FOR_DARK_THEME);
        assert_eq!(icon_bytes(Theme::Light), ICON_FOR_LIGHT_THEME);
        assert_ne!(ICON_FOR_DARK_THEME, ICON_FOR_LIGHT_THEME);
    }
}
