//! The unread badge: the sum of every server's unread count, shown as the
//! macOS dock badge or a Windows taskbar overlay icon.

use serde_json::Value;

/// Unread notifications in a `GET /api/notification` list: not read, not
/// archived, and not snoozed into the future. `now` is an RFC 3339 UTC
/// timestamp; the API's timestamps share its format, so they compare as text.
pub fn count_unread(list: &Value, now: &str) -> u32 {
    let Some(items) = list.as_array() else {
        return 0;
    };
    items
        .iter()
        .filter(|item| item.get("isRead").and_then(Value::as_bool) != Some(true))
        .filter(|item| item.get("archivedAt").is_none_or(Value::is_null))
        .filter(
            |item| match item.get("snoozedUntil").and_then(Value::as_str) {
                Some(until) => until <= now,
                None => true,
            },
        )
        .count() as u32
}

/// The current time as `YYYY-MM-DDTHH:MM:SS.mmmZ`.
pub fn now_rfc3339() -> String {
    let millis = crate::servers::now_millis();
    let (secs, ms) = (millis / 1000, millis % 1000);
    let days = (secs / 86_400) as i64;
    let rem = secs % 86_400;
    // Civil date from days since 1970-01-01 (Howard Hinnant's algorithm).
    let z = days + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z.rem_euclid(146_097);
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let day = doy - (153 * mp + 2) / 5 + 1;
    let month = if mp < 10 { mp + 3 } else { mp - 9 };
    let year = yoe + era * 400 + i64::from(month <= 2);
    format!(
        "{year:04}-{month:02}-{day:02}T{:02}:{:02}:{:02}.{ms:03}Z",
        rem / 3600,
        (rem / 60) % 60,
        rem % 60
    )
}

/// The overlay's text: the count up to 99, then "99+".
pub fn badge_text(count: u32) -> Option<String> {
    match count {
        0 => None,
        1..=99 => Some(count.to_string()),
        _ => Some("99+".to_string()),
    }
}

/// The badge fill: Margaya's deep brand green (the Canopy palette's
/// high-contrast primary, #035C42), a shade darker than the app icon's
/// #047857 so the badge stands apart from it, with white text above 7:1.
#[cfg_attr(not(windows), allow(dead_code))]
pub const BADGE_GREEN: [u8; 3] = [0x03, 0x5c, 0x42];
/// The app icon's green (Canopy primary).
#[cfg(test)]
const ICON_GREEN: [u8; 3] = [0x04, 0x78, 0x57];
#[cfg_attr(not(windows), allow(dead_code))]
const WHITE: [u8; 3] = [0xff, 0xff, 0xff];

/// The overlay's side in physical pixels for a monitor scale: overlays are 16
/// logical pixels, so 200% gets a 32 px icon instead of a blurry upscale.
#[cfg_attr(not(windows), allow(dead_code))]
pub fn overlay_size(scale: f64) -> u32 {
    let scale = if scale.is_finite() { scale } else { 1.0 };
    ((16.0 * scale).round() as u32).clamp(16, 64)
}

#[cfg_attr(not(windows), allow(dead_code))]
type Point = (f32, f32);

/// An arc of an ellipse as a polyline; angles in degrees, counter-clockwise
/// on screen (y grows downwards, so `y = cy - ry * sin`).
#[cfg_attr(not(windows), allow(dead_code))]
fn arc(center: Point, radius: Point, from: f32, to: f32, steps: u32) -> Vec<Point> {
    (0..=steps)
        .map(|step| {
            let t = (from + (to - from) * step as f32 / steps as f32).to_radians();
            (center.0 + radius.0 * t.cos(), center.1 - radius.1 * t.sin())
        })
        .collect()
}

/// Glyph strokes in a box 0.6 wide and 1 high. Drawn as thick round-capped
/// lines, so every size is anti-aliased and nothing depends on a font.
#[cfg_attr(not(windows), allow(dead_code))]
fn glyph(c: char) -> Vec<Vec<Point>> {
    const W: f32 = 0.6;
    match c {
        '0' => vec![arc((0.3, 0.5), (0.3, 0.5), 0.0, 360.0, 40)],
        '1' => vec![vec![(0.08, 0.24), (0.36, 0.0), (0.36, 1.0)]],
        '2' => {
            let mut line = arc((0.3, 0.28), (0.29, 0.28), 165.0, -35.0, 24);
            line.extend([(0.0, 1.0), (W, 1.0)]);
            vec![line]
        }
        '3' => vec![
            arc((0.3, 0.25), (0.27, 0.25), 155.0, -90.0, 24),
            arc((0.3, 0.73), (0.3, 0.27), 90.0, -155.0, 24),
        ],
        '4' => vec![vec![(0.46, 1.0), (0.46, 0.0), (0.0, 0.7), (W, 0.7)]],
        '5' => {
            let mut line = vec![(0.56, 0.0), (0.08, 0.0), (0.04, 0.47)];
            line.extend(arc((0.3, 0.67), (0.3, 0.33), 140.0, -150.0, 28));
            vec![line]
        }
        '6' => vec![
            arc((0.42, 0.62), (0.42, 0.62), 70.0, 180.0, 16),
            arc((0.3, 0.68), (0.3, 0.32), 0.0, 360.0, 36),
        ],
        '7' => vec![vec![(0.0, 0.0), (W, 0.0), (0.18, 1.0)]],
        '8' => vec![
            arc((0.3, 0.25), (0.25, 0.25), 0.0, 360.0, 32),
            arc((0.3, 0.72), (0.3, 0.28), 0.0, 360.0, 36),
        ],
        // A 6 turned upside down.
        '9' => glyph('6')
            .into_iter()
            .map(|line| line.into_iter().map(|(x, y)| (W - x, 1.0 - y)).collect())
            .collect(),
        '+' => vec![vec![(0.3, 0.2), (0.3, 0.8)], vec![(0.0, 0.5), (W, 0.5)]],
        _ => Vec::new(),
    }
}

#[cfg_attr(not(windows), allow(dead_code))]
fn distance_to_segment(p: Point, a: Point, b: Point) -> f32 {
    let (dx, dy) = (b.0 - a.0, b.1 - a.1);
    let length = dx * dx + dy * dy;
    let t = if length == 0.0 {
        0.0
    } else {
        (((p.0 - a.0) * dx + (p.1 - a.1) * dy) / length).clamp(0.0, 1.0)
    };
    let (x, y) = (a.0 + t * dx - p.0, a.1 + t * dy - p.1);
    (x * x + y * y).sqrt()
}

/// Paints `color` over a straight-alpha RGBA pixel with coverage `alpha`.
#[cfg_attr(not(windows), allow(dead_code))]
fn blend(pixel: &mut [u8], color: [u8; 3], alpha: f32) {
    let alpha = alpha.clamp(0.0, 1.0);
    if alpha <= 0.0 {
        return;
    }
    let below = f32::from(pixel[3]) / 255.0;
    let out = alpha + below * (1.0 - alpha);
    for channel in 0..3 {
        let mixed = (f32::from(color[channel]) * alpha
            + f32::from(pixel[channel]) * below * (1.0 - alpha))
            / out;
        pixel[channel] = mixed.round().clamp(0.0, 255.0) as u8;
    }
    pixel[3] = (out * 255.0).round() as u8;
}

/// A `size`×`size` RGBA overlay: a plain deep green disc (no ring) with the
/// count in regular-weight white, anti-aliased. `text` is "1"…"99" or "99+".
#[cfg_attr(not(windows), allow(dead_code))]
pub fn overlay_rgba(text: &str, size: u32) -> Vec<u8> {
    let side = size as f32;
    let mut pixels = vec![0u8; (size * size * 4) as usize];
    let center = side / 2.0;
    let inner = side / 2.0;

    let glyphs: Vec<Vec<Vec<Point>>> = text
        .chars()
        .map(glyph)
        .filter(|strokes| !strokes.is_empty())
        .collect();
    let count = glyphs.len().max(1) as f32;
    // One digit fills the disc; two ("42") and three ("99+") share it.
    let height = inner
        * 2.0
        * match glyphs.len() {
            0 | 1 => 0.6,
            2 => 0.46,
            _ => 0.34,
        };
    // Regular weight, but never thinner than 1 px at 100%.
    let stroke = if count > 1.0 {
        (height * 0.14).max(side / 16.0)
    } else {
        (height * 0.12).max(side / 14.0)
    };
    let gap = height * 0.14;
    let width = count * 0.6 * height + (count - 1.0) * gap;
    let left = center - width / 2.0;
    let top = center - height / 2.0;
    let mut lines: Vec<(Point, Point)> = Vec::new();
    for (index, strokes) in glyphs.iter().enumerate() {
        let x0 = left + index as f32 * (0.6 * height + gap);
        let at = |(x, y): Point| (x0 + x * height, top + y * height);
        for line in strokes {
            for pair in line.windows(2) {
                lines.push((at(pair[0]), at(pair[1])));
            }
        }
    }

    for y in 0..size {
        for x in 0..size {
            let p = (x as f32 + 0.5, y as f32 + 0.5);
            let from_center = ((p.0 - center).powi(2) + (p.1 - center).powi(2)).sqrt();
            let index = ((y * size + x) * 4) as usize;
            let pixel = &mut pixels[index..index + 4];
            blend(pixel, BADGE_GREEN, inner - from_center + 0.5);
            let nearest = lines
                .iter()
                .map(|(a, b)| distance_to_segment(p, *a, *b))
                .fold(f32::MAX, f32::min);
            let inside = (inner - from_center + 0.5).clamp(0.0, 1.0);
            blend(pixel, WHITE, (stroke / 2.0 - nearest + 0.5).min(inside));
        }
    }
    pixels
}

/// WCAG relative luminance of an sRGB colour.
#[cfg(test)]
fn luminance(rgb: [u8; 3]) -> f64 {
    let linear = |c: u8| {
        let c = f64::from(c) / 255.0;
        if c <= 0.03928 {
            c / 12.92
        } else {
            ((c + 0.055) / 1.055).powf(2.4)
        }
    };
    0.2126 * linear(rgb[0]) + 0.7152 * linear(rgb[1]) + 0.0722 * linear(rgb[2])
}

#[cfg(test)]
fn contrast(a: [u8; 3], b: [u8; 3]) -> f64 {
    let (a, b) = (luminance(a), luminance(b));
    (a.max(b) + 0.05) / (a.min(b) + 0.05)
}

/// A minimal PNG encoder (stored deflate blocks) for the test samples.
#[cfg(test)]
pub fn encode_png(rgba: &[u8], width: u32, height: u32) -> Vec<u8> {
    fn crc32(bytes: &[u8]) -> u32 {
        let mut crc = 0xffff_ffffu32;
        for byte in bytes {
            crc ^= u32::from(*byte);
            for _ in 0..8 {
                crc = if crc & 1 == 1 {
                    (crc >> 1) ^ 0xedb8_8320
                } else {
                    crc >> 1
                };
            }
        }
        !crc
    }
    fn chunk(out: &mut Vec<u8>, kind: &[u8; 4], data: &[u8]) {
        out.extend((data.len() as u32).to_be_bytes());
        let mut body = kind.to_vec();
        body.extend_from_slice(data);
        out.extend(&body);
        out.extend(crc32(&body).to_be_bytes());
    }
    let mut raw = Vec::new();
    for row in rgba.chunks((width * 4) as usize) {
        raw.push(0);
        raw.extend_from_slice(row);
    }
    let mut zlib = vec![0x78, 0x01];
    let blocks: Vec<&[u8]> = raw.chunks(65_535).collect();
    for (index, block) in blocks.iter().enumerate() {
        zlib.push(u8::from(index + 1 == blocks.len()));
        let length = block.len() as u16;
        zlib.extend(length.to_le_bytes());
        zlib.extend((!length).to_le_bytes());
        zlib.extend_from_slice(block);
    }
    let (mut a, mut b) = (1u32, 0u32);
    for byte in &raw {
        a = (a + u32::from(*byte)) % 65_521;
        b = (b + a) % 65_521;
    }
    zlib.extend(((b << 16) | a).to_be_bytes());
    let mut png = b"\x89PNG\r\n\x1a\n".to_vec();
    let mut header = Vec::new();
    header.extend(width.to_be_bytes());
    header.extend(height.to_be_bytes());
    header.extend([8, 6, 0, 0, 0]);
    chunk(&mut png, b"IHDR", &header);
    chunk(&mut png, b"IDAT", &zlib);
    chunk(&mut png, b"IEND", &[]);
    png
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn counts_only_unread_inbox_notifications() {
        let list = json!([
            { "isRead": false, "archivedAt": null, "snoozedUntil": null },
            { "isRead": null },
            { "isRead": true },
            { "isRead": false, "archivedAt": "2026-11-01T00:00:00.000Z" },
            { "isRead": false, "snoozedUntil": "2026-12-01T00:00:00.000Z" },
            { "isRead": false, "snoozedUntil": "2026-11-01T00:00:00.000Z" }
        ]);
        assert_eq!(count_unread(&list, "2026-11-11T12:00:00.000Z"), 3);
        assert_eq!(
            count_unread(&json!({ "error": "x" }), "2026-11-11T12:00:00.000Z"),
            0
        );
    }

    #[test]
    fn formats_now_like_the_api() {
        let now = now_rfc3339();
        assert_eq!(now.len(), 24);
        assert!(now.ends_with('Z'));
        assert_eq!(&now[4..5], "-");
        assert_eq!(&now[10..11], "T");
        assert!(now.as_str() > "2024-01-01T00:00:00.000Z");
    }

    #[test]
    fn caps_the_badge_text() {
        assert_eq!(badge_text(0), None);
        assert_eq!(badge_text(7).as_deref(), Some("7"));
        assert_eq!(badge_text(12).as_deref(), Some("12"));
        assert_eq!(badge_text(99).as_deref(), Some("99"));
        assert_eq!(badge_text(100).as_deref(), Some("99+"));
        assert_eq!(badge_text(130).as_deref(), Some("99+"));
    }

    #[test]
    fn sizes_the_overlay_for_the_monitor_scale() {
        assert_eq!(overlay_size(1.0), 16);
        assert_eq!(overlay_size(1.25), 20);
        assert_eq!(overlay_size(1.5), 24);
        assert_eq!(overlay_size(2.0), 32);
        assert_eq!(overlay_size(3.5), 56);
        assert_eq!(overlay_size(0.5), 16);
        assert_eq!(overlay_size(9.0), 64);
        assert_eq!(overlay_size(f64::NAN), 16);
    }

    fn rgb(pixels: &[u8], size: u32, x: u32, y: u32) -> [u8; 4] {
        let index = ((y * size + x) * 4) as usize;
        [
            pixels[index],
            pixels[index + 1],
            pixels[index + 2],
            pixels[index + 3],
        ]
    }

    /// Opaque pixels that are mostly the white digit (not the green disc).
    fn digit_mask(pixels: &[u8], size: u32) -> Vec<bool> {
        let center = size as f32 / 2.0;
        let inner = center - (size as f32 / 16.0).max(1.0) - 1.0;
        (0..size * size)
            .map(|i| {
                let (x, y) = (i % size, i / size);
                let d =
                    ((x as f32 + 0.5 - center).powi(2) + (y as f32 + 0.5 - center).powi(2)).sqrt();
                let [r, g, b, a] = rgb(pixels, size, x, y);
                d < inner && a == 255 && r.min(g).min(b) > 160
            })
            .collect()
    }

    #[test]
    fn draws_a_legible_white_count_on_a_green_disc() {
        for size in [16, 20, 24, 32, 48] {
            for text in ["1", "2", "3", "4", "5", "6", "7", "8", "9", "42", "99", "99+"] {
                let pixels = overlay_rgba(text, size);
                assert_eq!(pixels.len(), (size * size * 4) as usize);
                assert_eq!(rgb(&pixels, size, 0, 0)[3], 0, "corners stay transparent");
                assert_eq!(rgb(&pixels, size, size - 1, size - 1)[3], 0);
                // No ring: the top edge is the green disc itself.
                let top = rgb(&pixels, size, size / 2, 0);
                assert!(
                    top[3] > 100 && top[..3] == BADGE_GREEN,
                    "green edge at {size}: {top:?}"
                );
                // Pure green fills the disc where no stroke passes.
                let fill = pixels
                    .chunks(4)
                    .filter(|p| p[..3] == BADGE_GREEN && p[3] == 255)
                    .count();
                assert!(
                    fill as u32 > size * size / 5,
                    "{text}@{size}: {fill} fill pixels"
                );
                // The digit is there and big: a good share of the disc is
                // white, and it spans most of the disc's height.
                let mask = digit_mask(&pixels, size);
                let lit = mask.iter().filter(|&&on| on).count() as f32;
                let disc = std::f32::consts::PI * (size as f32 / 2.0).powi(2);
                assert!(lit > disc * 0.03, "{text}@{size}: only {lit} digit pixels");
                let rows: Vec<u32> = (0..size)
                    .filter(|y| (0..size).any(|x| mask[(y * size + x) as usize]))
                    .collect();
                let span = rows.last().unwrap() - rows.first().unwrap() + 1;
                let wanted = if text.len() > 1 { 0.3 } else { 0.4 };
                assert!(
                    span as f32 >= size as f32 * wanted,
                    "{text}@{size}: digit only {span} px tall"
                );
            }
        }
    }

    #[test]
    fn every_digit_looks_different() {
        let size = 32;
        let masks: Vec<(char, Vec<bool>)> = "123456789"
            .chars()
            .map(|c| (c, digit_mask(&overlay_rgba(&c.to_string(), size), size)))
            .collect();
        for (i, (a, first)) in masks.iter().enumerate() {
            for (b, second) in &masks[i + 1..] {
                let differing = first.iter().zip(second).filter(|(x, y)| x != y).count();
                assert!(
                    differing > 20,
                    "{a} and {b} differ in only {differing} pixels"
                );
            }
        }
    }

    #[test]
    fn white_on_the_badge_green_has_strong_contrast() {
        // WCAG AA for text is 4.5:1.
        assert!(contrast([0xff, 0xff, 0xff], BADGE_GREEN) > 7.0);
        // Darker than the icon underneath, so the disc reads against it.
        assert!(luminance(BADGE_GREEN) < luminance(ICON_GREEN) * 0.7);
        assert!(contrast([0xff, 0xff, 0xff], ICON_GREEN) > 4.5);
        // The green stands out from a light taskbar.
        assert!(contrast(BADGE_GREEN, [0xf3, 0xf3, 0xf3]) > 4.5);
    }

    #[test]
    fn edges_are_anti_aliased() {
        let pixels = overlay_rgba("7", 32);
        let partial = pixels.chunks(4).filter(|p| p[3] > 0 && p[3] < 255).count();
        assert!(partial > 20, "only {partial} soft edge pixels");
    }

    /// Writes badge samples (1x and 2x) to `MARGAYA_BADGE_SAMPLES` when set,
    /// for a person to look at.
    #[test]
    fn writes_samples_when_asked() {
        let Ok(dir) = std::env::var("MARGAYA_BADGE_SAMPLES") else {
            return;
        };
        let dir = std::path::PathBuf::from(dir);
        std::fs::create_dir_all(&dir).unwrap();
        for (scale, size) in [("1x", 16), ("1.5x", 24), ("2x", 32)] {
            for (name, text) in [("7", "7"), ("42", "42"), ("99plus", "99+")] {
                let png = encode_png(&overlay_rgba(text, size), size, size);
                std::fs::write(dir.join(format!("badge-{name}-{scale}.png")), png).unwrap();
            }
        }
    }
}
