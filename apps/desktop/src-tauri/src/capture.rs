//! Screenshot and clipboard capture for quick add. The person picks a screen
//! area with the system's own tool; the image goes to a private temporary
//! file and quick add opens with it attached (quick_add.rs). Nothing is
//! uploaded until the task is created.
//!
//! - Windows: the system snipping overlay (`ms-screenclip:`), which puts the
//!   picture on the clipboard; the app waits up to a minute for a new image.
//! - macOS: `screencapture -i -x <file>` (needs Screen Recording permission).
//! - Linux: the desktop portal's Screenshot interface (`interactive: true`).

use std::sync::atomic::{AtomicBool, Ordering};
#[cfg(any(target_os = "macos", target_os = "linux"))]
use std::time::Duration;

use base64::Engine as _;
use tauri::AppHandle;
use tauri_plugin_clipboard_manager::ClipboardExt;

use crate::i18n;
use crate::quick_add::{self, Attachment, DraftUpdate, Notice, NoticeKind, MAX_ATTACHMENT_BYTES};

/// One capture at a time: a second press while picking is ignored (on
/// Windows it opens the snip again).
static CAPTURING: AtomicBool = AtomicBool::new(false);
/// Windows: the snip was opened again, so the wait starts over.
#[cfg(windows)]
static SNIP_AGAIN: AtomicBool = AtomicBool::new(false);

/// How long the Windows capture waits for the snip to reach the clipboard.
#[cfg(windows)]
const CLIPBOARD_WAIT: std::time::Duration = std::time::Duration::from_secs(60);
/// How long the macOS and Linux pickers may stay open.
#[cfg(any(target_os = "macos", target_os = "linux"))]
const PICKER_WAIT: Duration = Duration::from_secs(300);

/// The preview's largest width and height in pixels.
const PREVIEW_WIDTH: u32 = 360;
const PREVIEW_HEIGHT: u32 = 200;

enum Outcome {
    Captured(Attachment),
    Cancelled,
    Problem(Notice),
}

/// Lets the person pick a screen area with the OS's own tool, then opens
/// quick add with the image attached. Returns at once; safe on any thread.
pub fn start_screenshot(app: &AppHandle) {
    if CAPTURING.swap(true, Ordering::SeqCst) {
        // Windows: the snip may have been cancelled while the app still
        // waits for the clipboard; open it again and wait afresh.
        #[cfg(windows)]
        {
            SNIP_AGAIN.store(true, Ordering::SeqCst);
            crate::opener::open_system_tool(crate::opener::SCREEN_SNIP);
        }
        #[cfg(not(windows))]
        log::info!("a screenshot is already being taken");
        return;
    }
    let app = app.clone();
    let spawned = std::thread::Builder::new()
        .name("screenshot".into())
        .spawn(move || {
            let outcome = capture_screen(&app);
            CAPTURING.store(false, Ordering::SeqCst);
            match outcome {
                Outcome::Captured(attachment) => quick_add::add_to_draft(
                    &app,
                    DraftUpdate {
                        attachments: vec![attachment],
                        ..DraftUpdate::default()
                    },
                ),
                Outcome::Problem(notice) => quick_add::add_to_draft(
                    &app,
                    DraftUpdate {
                        notices: vec![notice],
                        ..DraftUpdate::default()
                    },
                ),
                Outcome::Cancelled => log::info!("screenshot cancelled"),
            }
        });
    if spawned.is_err() {
        CAPTURING.store(false, Ordering::SeqCst);
        log::warn!("could not start a thread for the screenshot");
    }
}

/// Opens quick add pre-filled from the clipboard: text (first line as the
/// title, the rest as the description, a lone link as the title), else an
/// image as an attachment. Returns at once; safe on any thread.
pub fn new_task_from_clipboard(app: &AppHandle) {
    let app = app.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let text = app
            .clipboard()
            .read_text()
            .ok()
            .filter(|text| !text.trim().is_empty());
        let update = match text {
            Some(text) => quick_add::text_update(&text),
            None => match clipboard_image(&app) {
                Some((rgba, width, height)) => {
                    match image_attachment(
                        &app,
                        &rgba,
                        width,
                        height,
                        "quickAdd.clipboardImageName",
                    ) {
                        Ok(attachment) => DraftUpdate {
                            attachments: vec![attachment],
                            ..DraftUpdate::default()
                        },
                        Err(notice) => DraftUpdate {
                            notices: vec![notice],
                            ..DraftUpdate::default()
                        },
                    }
                }
                None => DraftUpdate {
                    notices: vec![Notice::new(NoticeKind::ClipboardEmpty)],
                    ..DraftUpdate::default()
                },
            },
        };
        quick_add::add_to_draft(&app, update);
    });
}

/// The clipboard's image as RGBA, if it holds one.
fn clipboard_image(app: &AppHandle) -> Option<(Vec<u8>, u32, u32)> {
    let image = app.clipboard().read_image().ok()?;
    let (width, height) = (image.width(), image.height());
    if width == 0 || height == 0 {
        return None;
    }
    Some((image.rgba().to_vec(), width, height))
}

/// The display name of a captured image ("Screenshot.png").
fn image_name(key: &str) -> String {
    let base = i18n::t(key);
    let base = if base.trim().is_empty() || base == key {
        "image".to_string()
    } else {
        base.replace(['/', '\\', ':'], " ").trim().to_string()
    };
    format!("{base}.png")
}

/// Encodes an RGBA image to a private temporary PNG, with a preview.
fn image_attachment(
    app: &AppHandle,
    rgba: &[u8],
    width: u32,
    height: u32,
    name_key: &str,
) -> Result<Attachment, Notice> {
    let name = image_name(name_key);
    let png = encode_png(rgba, width, height, png::Compression::Fast)
        .ok_or_else(|| Notice::new(NoticeKind::ScreenshotFailed))?;
    if png.len() as u64 > MAX_ATTACHMENT_BYTES {
        return Err(Notice::about(NoticeKind::TooLarge, name));
    }
    let dir = quick_add::temp_dir(app).map_err(|_| Notice::new(NoticeKind::ScreenshotFailed))?;
    let path = quick_add::write_temp(&dir, "png", &png).map_err(|error| {
        log::warn!("could not save a capture: {error}");
        Notice::new(NoticeKind::ScreenshotFailed)
    })?;
    Ok(quick_add::temp_image(
        path,
        name,
        png.len() as u64,
        preview_data_url(rgba, width, height),
    ))
}

/// A PNG file the system tool wrote into the app's temporary folder, as an
/// attachment. Deletes it when it can't be used.
#[cfg(any(target_os = "macos", target_os = "linux"))]
fn file_attachment(path: std::path::PathBuf) -> Outcome {
    let name = image_name("quickAdd.screenshotName");
    let size = std::fs::metadata(&path).map(|meta| meta.len()).unwrap_or(0);
    if size == 0 {
        let _ = std::fs::remove_file(&path);
        return Outcome::Problem(Notice::new(NoticeKind::ScreenPermission));
    }
    if size > MAX_ATTACHMENT_BYTES {
        let _ = std::fs::remove_file(&path);
        return Outcome::Problem(Notice::about(NoticeKind::TooLarge, name));
    }
    quick_add::make_private(&path);
    let preview = std::fs::read(&path)
        .ok()
        .and_then(|bytes| decode_png(&bytes))
        .and_then(|(rgba, width, height)| preview_data_url(&rgba, width, height));
    Outcome::Captured(quick_add::temp_image(path, name, size, preview))
}

/// Runs a blocking picker with a time limit, so a picker left open doesn't
/// keep further screenshots from starting forever.
#[cfg(any(target_os = "macos", target_os = "linux"))]
fn with_time_limit(job: impl FnOnce() -> Outcome + Send + 'static) -> Outcome {
    let (send, receive) = std::sync::mpsc::channel();
    let started = std::thread::Builder::new()
        .name("screenshot-picker".into())
        .spawn(move || {
            let _ = send.send(job());
        });
    if started.is_err() {
        return Outcome::Problem(Notice::new(NoticeKind::ScreenshotFailed));
    }
    receive.recv_timeout(PICKER_WAIT).unwrap_or_else(|_| {
        log::warn!("the screenshot picker didn't answer in time");
        Outcome::Cancelled
    })
}

#[cfg(windows)]
fn capture_screen(app: &AppHandle) -> Outcome {
    use std::time::{Duration, Instant};
    // Only a picture that wasn't on the clipboard before counts.
    let before = clipboard_image(app).map(|(rgba, w, h)| fingerprint(&rgba, w, h));
    crate::opener::open_system_tool(crate::opener::SCREEN_SNIP);
    SNIP_AGAIN.store(false, Ordering::SeqCst);
    let mut deadline = Instant::now() + CLIPBOARD_WAIT;
    while Instant::now() < deadline {
        std::thread::sleep(Duration::from_millis(400));
        if SNIP_AGAIN.swap(false, Ordering::SeqCst) {
            deadline = Instant::now() + CLIPBOARD_WAIT;
        }
        if let Some((rgba, width, height)) = clipboard_image(app) {
            if Some(fingerprint(&rgba, width, height)) != before {
                return match image_attachment(app, &rgba, width, height, "quickAdd.screenshotName")
                {
                    Ok(attachment) => Outcome::Captured(attachment),
                    Err(notice) => Outcome::Problem(notice),
                };
            }
        }
    }
    Outcome::Cancelled
}

#[cfg(target_os = "macos")]
fn capture_screen(app: &AppHandle) -> Outcome {
    let Ok(dir) = quick_add::temp_dir(app) else {
        return Outcome::Problem(Notice::new(NoticeKind::ScreenshotFailed));
    };
    let path = quick_add::temp_path(&dir, "png");
    let target = path.clone();
    with_time_limit(move || {
        let status = std::process::Command::new("/usr/sbin/screencapture")
            .arg("-i")
            .arg("-x")
            .arg(&target)
            .status();
        match (status, target.exists()) {
            (_, true) => file_attachment(target),
            // Escape in the picker: no file, a clean exit.
            (Ok(status), false) if status.success() => Outcome::Cancelled,
            (Ok(_), false) => Outcome::Problem(Notice::new(NoticeKind::ScreenPermission)),
            (Err(error), false) => {
                log::warn!("screencapture didn't start: {error}");
                Outcome::Problem(Notice::new(NoticeKind::ScreenshotFailed))
            }
        }
    })
}

#[cfg(target_os = "linux")]
fn capture_screen(app: &AppHandle) -> Outcome {
    let Ok(dir) = quick_add::temp_dir(app) else {
        return Outcome::Problem(Notice::new(NoticeKind::ScreenshotFailed));
    };
    with_time_limit(move || match portal::screenshot() {
        Ok(Some(source)) => {
            // The portal's file belongs to the person (often in Pictures);
            // attach a private copy and leave theirs alone.
            let size = std::fs::metadata(&source)
                .map(|meta| meta.len())
                .unwrap_or(0);
            if size > MAX_ATTACHMENT_BYTES {
                return Outcome::Problem(Notice::about(
                    NoticeKind::TooLarge,
                    image_name("quickAdd.screenshotName"),
                ));
            }
            match std::fs::read(&source)
                .and_then(|bytes| quick_add::write_temp(&dir, "png", &bytes))
            {
                Ok(path) => file_attachment(path),
                Err(error) => {
                    log::warn!("could not read the portal's screenshot: {error}");
                    Outcome::Problem(Notice::new(NoticeKind::ScreenshotFailed))
                }
            }
        }
        Ok(None) => Outcome::Cancelled,
        Err(error) => {
            log::warn!("the screenshot portal failed: {error}");
            Outcome::Problem(Notice::new(NoticeKind::ScreenshotFailed))
        }
    })
}

#[cfg(not(any(windows, target_os = "macos", target_os = "linux")))]
fn capture_screen(_app: &AppHandle) -> Outcome {
    Outcome::Problem(Notice::new(NoticeKind::ScreenshotFailed))
}

/// `org.freedesktop.portal.Screenshot` over the session bus: GNOME, KDE and
/// other desktops show their own picker and answer with a file URI.
#[cfg(target_os = "linux")]
mod portal {
    use std::collections::HashMap;
    use std::path::PathBuf;

    use zbus::blocking::{Connection, Proxy};
    use zbus::zvariant::{OwnedObjectPath, OwnedValue, Value};

    const DESTINATION: &str = "org.freedesktop.portal.Desktop";
    const PATH: &str = "/org/freedesktop/portal/desktop";

    /// The request object the portal will answer on, by the documented
    /// rule: the sender's unique name without ':' and with '.' as '_'.
    pub fn request_path(unique_name: &str, token: &str) -> String {
        let sender = unique_name.trim_start_matches(':').replace('.', "_");
        format!("{PATH}/request/{sender}/{token}")
    }

    /// The picked screenshot's file, or None when the person cancelled.
    pub fn screenshot() -> Result<Option<PathBuf>, String> {
        let connection = Connection::session().map_err(|error| error.to_string())?;
        let unique = connection
            .unique_name()
            .ok_or("no unique bus name")?
            .to_string();
        let token = format!("margaya{}", uuid::Uuid::new_v4().simple());
        // Subscribe before calling, so a quick answer isn't missed.
        let request = Proxy::new(
            &connection,
            DESTINATION,
            request_path(&unique, &token),
            "org.freedesktop.portal.Request",
        )
        .map_err(|error| error.to_string())?;
        let mut responses = request
            .receive_signal("Response")
            .map_err(|error| error.to_string())?;
        let portal = Proxy::new(
            &connection,
            DESTINATION,
            PATH,
            "org.freedesktop.portal.Screenshot",
        )
        .map_err(|error| error.to_string())?;
        let mut options: HashMap<&str, Value<'_>> = HashMap::new();
        options.insert("handle_token", Value::from(token.as_str()));
        options.insert("interactive", Value::from(true));
        options.insert("modal", Value::from(true));
        let _handle: OwnedObjectPath = portal
            .call("Screenshot", &("", options))
            .map_err(|error| error.to_string())?;
        let message = responses.next().ok_or("the portal closed the request")?;
        let (code, results): (u32, HashMap<String, OwnedValue>) = message
            .body()
            .deserialize()
            .map_err(|error| error.to_string())?;
        // 0 = success, 1 = cancelled by the person, 2 = other end.
        if code != 0 {
            return Ok(None);
        }
        let uri = results
            .get("uri")
            .and_then(|value| <&str>::try_from(value).ok())
            .ok_or("no uri in the answer")?;
        file_path(uri).map(Some)
    }

    pub fn file_path(uri: &str) -> Result<PathBuf, String> {
        let url = url::Url::parse(uri).map_err(|error| error.to_string())?;
        if url.scheme() != "file" {
            return Err("not a file URI".into());
        }
        url.to_file_path().map_err(|()| "not a local file".into())
    }

    #[cfg(test)]
    mod tests {
        use super::*;

        #[test]
        fn predicts_the_request_path() {
            assert_eq!(
                request_path(":1.234", "margaya1"),
                "/org/freedesktop/portal/desktop/request/1_234/margaya1"
            );
        }

        #[test]
        fn reads_file_uris() {
            assert_eq!(
                file_path("file:///home/a/Pictures/Screenshot%20from%20x.png").unwrap(),
                PathBuf::from("/home/a/Pictures/Screenshot from x.png")
            );
            assert!(file_path("https://example.com/a.png").is_err());
        }
    }
}

/// A cheap identity for a clipboard image, to tell a new snip from the
/// picture that was already there.
#[cfg(any(windows, test))]
fn fingerprint(rgba: &[u8], width: u32, height: u32) -> u64 {
    use std::hash::{Hash, Hasher};
    let mut hasher = std::collections::hash_map::DefaultHasher::new();
    (width, height).hash(&mut hasher);
    rgba.hash(&mut hasher);
    hasher.finish()
}

/// Encodes RGBA pixels as a PNG.
fn encode_png(
    rgba: &[u8],
    width: u32,
    height: u32,
    compression: png::Compression,
) -> Option<Vec<u8>> {
    if rgba.len() as u64 != u64::from(width) * u64::from(height) * 4 {
        return None;
    }
    let mut out = Vec::new();
    {
        let mut encoder = png::Encoder::new(&mut out, width, height);
        encoder.set_color(png::ColorType::Rgba);
        encoder.set_depth(png::BitDepth::Eight);
        encoder.set_compression(compression);
        let mut writer = encoder.write_header().ok()?;
        writer.write_image_data(rgba).ok()?;
    }
    Some(out)
}

/// Decodes a PNG to 8-bit RGBA (for the preview only).
#[cfg(any(target_os = "macos", target_os = "linux", test))]
fn decode_png(bytes: &[u8]) -> Option<(Vec<u8>, u32, u32)> {
    let mut decoder = png::Decoder::new_with_limits(
        std::io::Cursor::new(bytes),
        png::Limits {
            bytes: 256 * 1024 * 1024,
        },
    );
    decoder.set_transformations(png::Transformations::normalize_to_color8());
    let mut reader = decoder.read_info().ok()?;
    let mut buffer = vec![0; reader.output_buffer_size()?];
    let info = reader.next_frame(&mut buffer).ok()?;
    buffer.truncate(info.buffer_size());
    let (width, height) = (info.width, info.height);
    let pixels = (width as usize) * (height as usize);
    let rgba = match info.color_type {
        png::ColorType::Rgba => buffer,
        png::ColorType::Rgb => buffer
            .chunks_exact(3)
            .flat_map(|px| [px[0], px[1], px[2], 255])
            .collect(),
        png::ColorType::GrayscaleAlpha => buffer
            .chunks_exact(2)
            .flat_map(|px| [px[0], px[0], px[0], px[1]])
            .collect(),
        png::ColorType::Grayscale => buffer.iter().flat_map(|&g| [g, g, g, 255]).collect(),
        png::ColorType::Indexed => return None,
    };
    (rgba.len() == pixels * 4).then_some((rgba, width, height))
}

/// The preview's size: the image scaled down (never up) to fit the box.
fn preview_size(width: u32, height: u32) -> (u32, u32) {
    let scale = f64::min(
        1.0,
        f64::min(
            f64::from(PREVIEW_WIDTH) / f64::from(width.max(1)),
            f64::from(PREVIEW_HEIGHT) / f64::from(height.max(1)),
        ),
    );
    (
        ((f64::from(width) * scale).round() as u32).max(1),
        ((f64::from(height) * scale).round() as u32).max(1),
    )
}

/// A small PNG data URL of the image (area average), for quick add's preview.
fn preview_data_url(rgba: &[u8], width: u32, height: u32) -> Option<String> {
    if width == 0 || height == 0 || rgba.len() != (width as usize) * (height as usize) * 4 {
        return None;
    }
    let (out_w, out_h) = preview_size(width, height);
    let mut out = Vec::with_capacity((out_w * out_h * 4) as usize);
    for y in 0..out_h {
        let y0 = (u64::from(y) * u64::from(height) / u64::from(out_h)) as u32;
        let y1 = ((u64::from(y + 1) * u64::from(height) / u64::from(out_h)) as u32).max(y0 + 1);
        for x in 0..out_w {
            let x0 = (u64::from(x) * u64::from(width) / u64::from(out_w)) as u32;
            let x1 = ((u64::from(x + 1) * u64::from(width) / u64::from(out_w)) as u32).max(x0 + 1);
            let mut sum = [0u64; 4];
            // Sample at most 4x4 source pixels per preview pixel: plenty for
            // a thumbnail, and quick for a large screenshot.
            let step_y = ((y1 - y0) / 4).max(1);
            let step_x = ((x1 - x0) / 4).max(1);
            let mut count = 0u64;
            let mut sy = y0;
            while sy < y1 {
                let mut sx = x0;
                while sx < x1 {
                    let index = ((sy as usize) * (width as usize) + sx as usize) * 4;
                    for channel in 0..4 {
                        sum[channel] += u64::from(rgba[index + channel]);
                    }
                    count += 1;
                    sx += step_x;
                }
                sy += step_y;
            }
            out.extend(sum.iter().map(|total| (total / count.max(1)) as u8));
        }
    }
    let png = encode_png(&out, out_w, out_h, png::Compression::Fast)?;
    Some(format!(
        "data:image/png;base64,{}",
        base64::engine::general_purpose::STANDARD.encode(png)
    ))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn checker(width: u32, height: u32) -> Vec<u8> {
        (0..width * height)
            .flat_map(|i| {
                if (i % width + i / width) % 2 == 0 {
                    [255, 0, 0, 255]
                } else {
                    [0, 0, 255, 128]
                }
            })
            .collect()
    }

    #[test]
    fn encodes_and_decodes_png() {
        let rgba = checker(7, 5);
        let png = encode_png(&rgba, 7, 5, png::Compression::Fast).unwrap();
        assert!(png.starts_with(b"\x89PNG"));
        assert_eq!(decode_png(&png), Some((rgba, 7, 5)));
        assert_eq!(encode_png(&[0; 3], 1, 1, png::Compression::Fast), None);
        assert_eq!(decode_png(b"not a png"), None);
    }

    #[test]
    fn previews_fit_the_box_without_upscaling() {
        assert_eq!(preview_size(3840, 2160), (356, 200));
        assert_eq!(preview_size(1000, 100), (360, 36));
        assert_eq!(preview_size(100, 50), (100, 50));
        assert_eq!(preview_size(1, 100_000), (1, 200));
        let url = preview_data_url(&checker(800, 600), 800, 600).unwrap();
        let encoded = url.strip_prefix("data:image/png;base64,").unwrap();
        let png = base64::engine::general_purpose::STANDARD
            .decode(encoded)
            .unwrap();
        let (_, width, height) = decode_png(&png).unwrap();
        assert_eq!((width, height), (267, 200));
        assert_eq!(preview_data_url(&[0; 4], 2, 2), None);
    }

    #[test]
    fn fingerprints_tell_images_apart() {
        let a = checker(4, 4);
        let mut b = a.clone();
        b[0] = 1;
        assert_eq!(fingerprint(&a, 4, 4), fingerprint(&a, 4, 4));
        assert_ne!(fingerprint(&a, 4, 4), fingerprint(&b, 4, 4));
        assert_ne!(fingerprint(&a, 4, 4), fingerprint(&a, 2, 8));
    }

    #[test]
    fn names_images_without_path_characters() {
        let name = image_name("quickAdd.screenshotName");
        assert!(name.ends_with(".png"));
        assert!(!name.contains('/') && !name.contains('\\'));
    }
}
