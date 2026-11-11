//! Margaya's own notification sounds, for native alerts.
//!
//! A port of the web app's synthesized sounds
//! (`apps/web/src/lib/notification-sound/sounds.ts`, `SOUND_RECIPES` and
//! `volumeGain`): the same notes, envelopes and gains, rendered to a 16-bit
//! mono WAV at 44.1 kHz in memory, so the desktop app plays the sound the
//! person chose at their volume. Keep the recipes in step with the web app.
//!
//! Windows toasts from an unpackaged app can only play the system's sound
//! events, so the toast stays silent and the app plays the WAV itself
//! (`PlaySoundW`, asynchronous). Linux plays the same WAV through the
//! desktop's sound server with the first player it has (`paplay`,
//! `pw-play`, then `aplay`). macOS keeps the system notification sound of
//! the notification plugin.

// Windows and Linux play the rendered sound; the rest is tested everywhere.
#![cfg_attr(not(any(windows, target_os = "linux")), allow(dead_code))]

/// The sounds a server may name (`soundName`), without "none".
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum SoundId {
    Chime,
    Pop,
    Ding,
    Bell,
    Knock,
    Marimba,
}

impl SoundId {
    #[cfg(test)]
    pub const ALL: [SoundId; 6] = [
        SoundId::Chime,
        SoundId::Pop,
        SoundId::Ding,
        SoundId::Bell,
        SoundId::Knock,
        SoundId::Marimba,
    ];

    pub fn parse(name: &str) -> Option<Self> {
        Some(match name {
            "chime" => Self::Chime,
            "pop" => Self::Pop,
            "ding" => Self::Ding,
            "bell" => Self::Bell,
            "knock" => Self::Knock,
            "marimba" => Self::Marimba,
            _ => return None,
        })
    }

    #[cfg_attr(not(any(test, feature = "e2e")), allow(dead_code))]
    pub fn name(self) -> &'static str {
        match self {
            Self::Chime => "chime",
            Self::Pop => "pop",
            Self::Ding => "ding",
            Self::Bell => "bell",
            Self::Knock => "knock",
            Self::Marimba => "marimba",
        }
    }
}

/// What an alert plays: a sound at the person's volume (0 to 100).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Tone {
    pub id: SoundId,
    pub volume: u8,
}

/// What a server that predates `soundName` gets when it asks for a sound:
/// the web app's default for mentions at its default volume.
pub const FALLBACK: Tone = Tone {
    id: SoundId::Chime,
    volume: 70,
};

impl Tone {
    /// The tone for a server's answer that calls for a sound. A name this
    /// app doesn't know (a newer server) or no name at all (an older one)
    /// plays the chime.
    pub fn from_server(sound_name: Option<&str>, volume: Option<u32>) -> Self {
        let id = sound_name.and_then(SoundId::parse);
        Tone {
            id: id.unwrap_or(FALLBACK.id),
            volume: volume.map_or(FALLBACK.volume, |v| v.min(100) as u8),
        }
    }
}

#[derive(Clone, Copy)]
enum Wave {
    Sine,
    Triangle,
}

struct Note {
    /// Hz at the start; `to` glides there (exponentially) over the note.
    freq: f64,
    to: Option<f64>,
    /// Seconds after the sound starts.
    at: f64,
    /// Seconds until the note has faded out.
    dur: f64,
    wave: Wave,
    /// Relative loudness, 0 to 1.
    gain: f64,
}

const fn note(freq: f64, at: f64, dur: f64, wave: Wave, gain: f64) -> Note {
    Note {
        freq,
        to: None,
        at,
        dur,
        wave,
        gain,
    }
}

const fn glide(freq: f64, to: f64, at: f64, dur: f64, gain: f64) -> Note {
    Note {
        freq,
        to: Some(to),
        at,
        dur,
        wave: Wave::Sine,
        gain,
    }
}

use Wave::{Sine, Triangle};

// Two rising notes, soft.
const CHIME: &[Note] = &[
    note(880.0, 0.0, 0.35, Sine, 0.8),
    note(1318.5, 0.12, 0.45, Sine, 0.7),
];
// A short upward blip.
const POP: &[Note] = &[glide(520.0, 980.0, 0.0, 0.09, 1.0)];
// One bright note with an overtone.
const DING: &[Note] = &[
    note(1046.5, 0.0, 0.6, Sine, 0.8),
    note(2093.0, 0.0, 0.3, Sine, 0.2),
];
// A rounder, longer bell.
const BELL: &[Note] = &[
    note(784.0, 0.0, 1.0, Sine, 0.8),
    note(1568.0, 0.0, 0.6, Sine, 0.25),
    note(2352.0, 0.0, 0.35, Sine, 0.12),
];
// Two low taps, like knocking: someone is waiting.
const KNOCK: &[Note] = &[
    glide(210.0, 120.0, 0.0, 0.1, 1.0),
    glide(210.0, 120.0, 0.16, 0.1, 1.0),
];
// Three quick ascending wooden notes.
const MARIMBA: &[Note] = &[
    note(523.25, 0.0, 0.22, Triangle, 0.9),
    note(659.25, 0.09, 0.22, Triangle, 0.9),
    note(783.99, 0.18, 0.3, Triangle, 0.9),
];

fn recipe(id: SoundId) -> &'static [Note] {
    match id {
        SoundId::Chime => CHIME,
        SoundId::Pop => POP,
        SoundId::Ding => DING,
        SoundId::Bell => BELL,
        SoundId::Knock => KNOCK,
        SoundId::Marimba => MARIMBA,
    }
}

pub const SAMPLE_RATE: u32 = 44_100;

/// Silence before the first note, as the web app schedules it, so the
/// device's start never clips the attack.
const LEAD: f64 = 0.01;
/// Each oscillator runs this long past its fade, as in the web app.
const TAIL: f64 = 0.02;
/// The envelope's floor and attack, as in the web app.
const FLOOR: f64 = 0.0001;
const ATTACK: f64 = 0.005;

/// The web app's master gain: perceived loudness grows roughly with the
/// square of the gain.
pub fn volume_gain(volume: u8) -> f64 {
    let v = f64::from(volume.min(100)) / 100.0;
    v * v * 0.5
}

/// A native alert plays 6 dB above the web app's gain: at the web's level
/// the sounds were quieter than Windows' own notification sound, which
/// people already missed. At 70 they are at least as loud as it (see the
/// skill for the measurements); the settings preview in the page stays at
/// the web's level.
pub const DESKTOP_GAIN: f64 = 2.0;
/// The loudest sample, just under full scale (-1 dBFS), so the loudest
/// sounds at high volume never clip.
pub const CEILING: f64 = 0.89;

/// Web Audio's envelope: up from the floor to `gain` in 5 ms, then an
/// exponential fall to the floor at `dur`, where it stays.
fn envelope(note: &Note, t: f64) -> f64 {
    if t < ATTACK {
        FLOOR + (note.gain - FLOOR) * (t / ATTACK)
    } else if t < note.dur {
        note.gain * (FLOOR / note.gain).powf((t - ATTACK) / (note.dur - ATTACK))
    } else {
        FLOOR
    }
}

fn frequency(note: &Note, t: f64) -> f64 {
    match note.to {
        Some(to) if t < note.dur => note.freq * (to / note.freq).powf(t / note.dur),
        Some(to) => to,
        None => note.freq,
    }
}

/// One cycle of the wave at `phase` (0 to 1), peak 1.
fn wave(wave: Wave, phase: f64) -> f64 {
    match wave {
        Wave::Sine => (std::f64::consts::TAU * phase).sin(),
        // Starts at 0 and rises, like a sine.
        Wave::Triangle => {
            let p = (phase + 0.25).fract();
            4.0 * (p - 0.5).abs() - 1.0
        }
    }
}

/// The sound as 16-bit mono samples at `SAMPLE_RATE`.
pub fn render(tone: Tone) -> Vec<i16> {
    let notes = recipe(tone.id);
    let length = notes
        .iter()
        .map(|note| note.at + note.dur + TAIL)
        .fold(0.0, f64::max)
        + LEAD;
    let count = (length * f64::from(SAMPLE_RATE)).ceil() as usize;
    let mut mix = vec![0.0f64; count];
    let step = 1.0 / f64::from(SAMPLE_RATE);
    for note in notes {
        let start = ((LEAD + note.at) * f64::from(SAMPLE_RATE)).round() as usize;
        let end = (((LEAD + note.at + note.dur + TAIL) * f64::from(SAMPLE_RATE)).round() as usize)
            .min(count);
        let mut phase = 0.0f64;
        for (i, sample) in mix[start..end].iter_mut().enumerate() {
            let t = i as f64 * step;
            *sample += envelope(note, t) * wave(note.wave, phase);
            phase = (phase + frequency(note, t) * step).fract();
        }
    }
    let loudest = mix
        .iter()
        .fold(0.0f64, |peak, sample| peak.max(sample.abs()));
    let mut master = volume_gain(tone.volume) * DESKTOP_GAIN;
    if loudest * master > CEILING {
        master = CEILING / loudest;
    }
    mix.into_iter()
        .map(|sample| {
            let value = (sample * master).clamp(-1.0, 1.0) * f64::from(i16::MAX);
            value.round() as i16
        })
        .collect()
}

/// A RIFF/WAVE file: PCM, 16-bit, mono, `SAMPLE_RATE`.
pub fn wav(samples: &[i16]) -> Vec<u8> {
    let data_len = (samples.len() * 2) as u32;
    let mut out = Vec::with_capacity(44 + samples.len() * 2);
    out.extend_from_slice(b"RIFF");
    out.extend_from_slice(&(36 + data_len).to_le_bytes());
    out.extend_from_slice(b"WAVE");
    out.extend_from_slice(b"fmt ");
    out.extend_from_slice(&16u32.to_le_bytes());
    out.extend_from_slice(&1u16.to_le_bytes()); // PCM
    out.extend_from_slice(&1u16.to_le_bytes()); // mono
    out.extend_from_slice(&SAMPLE_RATE.to_le_bytes());
    out.extend_from_slice(&(SAMPLE_RATE * 2).to_le_bytes()); // bytes per second
    out.extend_from_slice(&2u16.to_le_bytes()); // block align
    out.extend_from_slice(&16u16.to_le_bytes()); // bits per sample
    out.extend_from_slice(b"data");
    out.extend_from_slice(&data_len.to_le_bytes());
    for sample in samples {
        out.extend_from_slice(&sample.to_le_bytes());
    }
    out
}

/// Plays the tone without waiting for it. Call it off the UI thread.
#[cfg(windows)]
pub fn play(tone: Tone) {
    use ::windows::core::PCWSTR;
    use ::windows::Win32::Media::Audio::{PlaySoundW, SND_ASYNC, SND_MEMORY, SND_NODEFAULT};
    use std::sync::Mutex;

    // PlaySoundW reads an asynchronous SND_MEMORY sound from our buffer
    // while it plays, so the buffer lives here until the next sound has
    // stopped this one.
    static PLAYING: Mutex<Vec<u8>> = Mutex::new(Vec::new());

    let bytes = wav(&render(tone));
    let mut playing = PLAYING
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    unsafe {
        // Stops the sound that may still read the old buffer.
        let _ = PlaySoundW(PCWSTR::null(), None, SND_FLAGS_NONE);
        *playing = bytes;
        let ok = PlaySoundW(
            PCWSTR(playing.as_ptr().cast()),
            None,
            SND_MEMORY | SND_ASYNC | SND_NODEFAULT,
        );
        if !ok.as_bool() {
            log::warn!("could not play the notification sound");
        }
    }
    const SND_FLAGS_NONE: ::windows::Win32::Media::Audio::SND_FLAGS =
        ::windows::Win32::Media::Audio::SND_FLAGS(0);
}

/// The sound players tried on Linux, in order, with their arguments before
/// the file. `paplay` reaches PulseAudio and PipeWire (pipewire-pulse) and
/// is on almost every desktop; `pw-play` covers PipeWire without the Pulse
/// tools, `aplay` bare ALSA. Each plays as a notification ("event") stream,
/// so the desktop's alert volume applies. Spawning a player keeps the app
/// free of audio libraries at build and run time and leaves device choice,
/// mixing and per-app volume to the sound server.
#[cfg_attr(not(target_os = "linux"), allow(dead_code))]
pub const LINUX_PLAYERS: &[(&str, &[&str])] = &[
    (
        "paplay",
        &["--client-name=Margaya", "--property=media.role=event"],
    ),
    ("pw-play", &["--media-role=Notification"]),
    ("aplay", &["-q"]),
];

/// Plays the tone and waits for it to end. Call it off the UI thread.
#[cfg(target_os = "linux")]
pub fn play(tone: Tone) {
    use std::process::{Command, Stdio};

    let Some(file) = linux::write_wav(&wav(&render(tone))) else {
        log::warn!("could not play the notification sound: no place for it");
        return;
    };
    let mut played = false;
    for (program, args) in LINUX_PLAYERS {
        match Command::new(program)
            .args(*args)
            .arg(&file)
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status()
        {
            Ok(status) if status.success() => {
                played = true;
                break;
            }
            // Missing, or no sound server for it: try the next one.
            Ok(_) | Err(_) => {}
        }
    }
    let _ = std::fs::remove_file(&file);
    if !played {
        log::warn!(
            "could not play the notification sound: no working player (paplay, pw-play or aplay)"
        );
    }
}

/// macOS plays the system notification sound with the notification itself.
#[cfg(not(any(windows, target_os = "linux")))]
pub fn play(_tone: Tone) {}

#[cfg(target_os = "linux")]
mod linux {
    use std::io::Write;
    use std::os::unix::fs::OpenOptionsExt;
    use std::path::PathBuf;

    /// Writes the sound to a new file only this user can read, in the
    /// per-user runtime directory (else the temp directory), and returns
    /// its path. A fresh random name, created exclusively, so nothing can
    /// be put in its place.
    pub fn write_wav(bytes: &[u8]) -> Option<PathBuf> {
        let dir = std::env::var_os("XDG_RUNTIME_DIR")
            .map(PathBuf::from)
            .filter(|dir| dir.is_dir())
            .unwrap_or_else(std::env::temp_dir);
        let path = dir.join(format!("margaya-sound-{}.wav", uuid::Uuid::new_v4()));
        let mut file = std::fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .mode(0o600)
            .open(&path)
            .ok()?;
        if file.write_all(bytes).is_err() {
            let _ = std::fs::remove_file(&path);
            return None;
        }
        Some(path)
    }
}

/// Whether Windows holds notifications back now (Do Not Disturb or Focus,
/// a full-screen game or a presentation), when the toast itself stays
/// silent and so should our sound. Cheap: two in-process queries.
#[cfg(windows)]
pub fn system_quiet() -> bool {
    use ::windows::Win32::UI::Shell::{
        SHQueryUserNotificationState, QUNS_ACCEPTS_NOTIFICATIONS, QUNS_APP,
    };
    let busy = unsafe { SHQueryUserNotificationState() }
        .is_ok_and(|state| state != QUNS_ACCEPTS_NOTIFICATIONS && state != QUNS_APP);
    busy || focus_profile().is_some_and(|profile| profile != 0)
}

/// Whether GNOME's Do Not Disturb is on (`show-banners` off), when the
/// notification itself stays quiet and so should our sound. Other desktops
/// keep their own setting, which the app can't read; their notification
/// still respects it.
#[cfg(target_os = "linux")]
pub fn system_quiet() -> bool {
    std::process::Command::new("gsettings")
        .args(["get", "org.gnome.desktop.notifications", "show-banners"])
        .stdin(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .output()
        .ok()
        .filter(|output| output.status.success())
        .is_some_and(|output| gnome_banners_off(&String::from_utf8_lossy(&output.stdout)))
}

/// Reads `gsettings get org.gnome.desktop.notifications show-banners`.
#[cfg_attr(not(target_os = "linux"), allow(dead_code))]
pub fn gnome_banners_off(output: &str) -> bool {
    output.trim() == "false"
}

#[cfg(not(any(windows, target_os = "linux")))]
pub fn system_quiet() -> bool {
    false
}

/// The Do Not Disturb (Focus assist) profile: 0 off, 1 priority only,
/// 2 alarms only. Windows has no documented API for it; this reads the
/// shell's WNF state `WNF_SHEL_QUIETHOURS_ACTIVE_PROFILE_CHANGED` through
/// ntdll, and gives None when that isn't available.
#[cfg(windows)]
fn focus_profile() -> Option<u32> {
    use ::windows::core::{s, w};
    use ::windows::Win32::System::LibraryLoader::{GetModuleHandleW, GetProcAddress};

    type NtQueryWnfStateData = unsafe extern "system" fn(
        state_name: *const u64,
        type_id: *const core::ffi::c_void,
        explicit_scope: *const core::ffi::c_void,
        change_stamp: *mut u32,
        buffer: *mut core::ffi::c_void,
        buffer_size: *mut u32,
    ) -> i32;
    const WNF_SHEL_QUIETHOURS_ACTIVE_PROFILE_CHANGED: u64 = 0x0D83_063E_A3BF_1C75;

    unsafe {
        let ntdll = GetModuleHandleW(w!("ntdll.dll")).ok()?;
        let query = GetProcAddress(ntdll, s!("NtQueryWnfStateData"))?;
        let query: NtQueryWnfStateData = std::mem::transmute(query);
        let state = WNF_SHEL_QUIETHOURS_ACTIVE_PROFILE_CHANGED;
        let (mut stamp, mut value, mut size) = (0u32, 0u32, 4u32);
        let status = query(
            &state,
            std::ptr::null(),
            std::ptr::null(),
            &mut stamp,
            (&mut value as *mut u32).cast(),
            &mut size,
        );
        (status >= 0 && size == 4).then_some(value)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn peak(samples: &[i16]) -> i32 {
        samples
            .iter()
            .map(|s| i32::from(*s).abs())
            .max()
            .unwrap_or(0)
    }

    fn rms(samples: &[i16]) -> f64 {
        let sum: f64 = samples.iter().map(|s| f64::from(*s).powi(2)).sum();
        (sum / samples.len() as f64).sqrt()
    }

    #[test]
    fn parses_every_server_sound_name_and_nothing_else() {
        for id in SoundId::ALL {
            assert_eq!(SoundId::parse(id.name()), Some(id));
        }
        assert_eq!(SoundId::parse("none"), None);
        assert_eq!(SoundId::parse("Chime"), None);
        assert_eq!(SoundId::parse(""), None);
    }

    #[test]
    fn older_or_newer_servers_get_the_chime() {
        assert_eq!(Tone::from_server(None, None), FALLBACK);
        assert_eq!(
            Tone::from_server(Some("marimba"), Some(40)),
            Tone {
                id: SoundId::Marimba,
                volume: 40
            }
        );
        assert_eq!(
            Tone::from_server(Some("whistle"), Some(55)),
            Tone {
                id: SoundId::Chime,
                volume: 55
            }
        );
        assert_eq!(Tone::from_server(Some("pop"), Some(400)).volume, 100);
    }

    #[test]
    fn every_sound_renders_audibly_for_as_long_as_its_recipe() {
        for id in SoundId::ALL {
            let samples = render(Tone { id, volume: 70 });
            let longest = recipe(id)
                .iter()
                .map(|n| n.at + n.dur + TAIL)
                .fold(0.0, f64::max);
            let seconds = samples.len() as f64 / f64::from(SAMPLE_RATE);
            assert!(
                (seconds - (longest + LEAD)).abs() < 0.001,
                "{id:?}: {seconds}"
            );
            // At 70 the master gain is 0.49; every sound peaks between its
            // loudest note's gain and all its notes' gains times that.
            let gains = recipe(id).iter().map(|n| n.gain);
            let loudest = gains.clone().fold(0.0, f64::max);
            let all: f64 = gains.sum();
            let master = volume_gain(70) * DESKTOP_GAIN * f64::from(i16::MAX);
            let got = f64::from(peak(&samples));
            assert!(
                got > loudest * master * 0.9 && got < all * master * 1.02,
                "{id:?}: peak {got}"
            );
            // Silent lead, quiet tail, no click at the end.
            assert!(samples[..(LEAD * f64::from(SAMPLE_RATE)) as usize - 1]
                .iter()
                .all(|s| *s == 0));
            assert!(samples[samples.len() - 10..].iter().all(|s| s.abs() <= 4));
        }
    }

    #[test]
    fn the_peak_follows_the_volume() {
        for id in SoundId::ALL {
            let at = |volume| peak(&render(Tone { id, volume }));
            assert_eq!(at(0), 0, "{id:?}");
            assert!(at(30) < at(70) && at(70) < at(100), "{id:?}");
            // Gain grows with the square of the volume.
            let ratio = f64::from(at(80)) / f64::from(at(40));
            assert!((ratio - 4.0).abs() < 0.1, "{id:?}: {ratio}");
            // Never clips, however loud.
            assert!(
                f64::from(at(100)) <= CEILING * f64::from(i16::MAX) + 1.0,
                "{id:?}"
            );
        }
    }

    #[test]
    fn every_sound_is_distinct() {
        let rendered: Vec<_> = SoundId::ALL
            .iter()
            .map(|&id| render(Tone { id, volume: 70 }))
            .collect();
        for (i, a) in rendered.iter().enumerate() {
            for b in &rendered[i + 1..] {
                assert_ne!(a, b);
            }
        }
    }

    #[test]
    fn writes_a_pcm_wave_header() {
        let samples = [0i16, 1000, -1000, i16::MAX];
        let bytes = wav(&samples);
        assert_eq!(bytes.len(), 44 + 8);
        assert_eq!(&bytes[0..4], b"RIFF");
        assert_eq!(u32::from_le_bytes(bytes[4..8].try_into().unwrap()), 36 + 8);
        assert_eq!(&bytes[8..16], b"WAVEfmt ");
        assert_eq!(u32::from_le_bytes(bytes[16..20].try_into().unwrap()), 16);
        assert_eq!(u16::from_le_bytes(bytes[20..22].try_into().unwrap()), 1);
        assert_eq!(u16::from_le_bytes(bytes[22..24].try_into().unwrap()), 1);
        assert_eq!(
            u32::from_le_bytes(bytes[24..28].try_into().unwrap()),
            44_100
        );
        assert_eq!(
            u32::from_le_bytes(bytes[28..32].try_into().unwrap()),
            88_200
        );
        assert_eq!(u16::from_le_bytes(bytes[32..34].try_into().unwrap()), 2);
        assert_eq!(u16::from_le_bytes(bytes[34..36].try_into().unwrap()), 16);
        assert_eq!(&bytes[36..40], b"data");
        assert_eq!(u32::from_le_bytes(bytes[40..44].try_into().unwrap()), 8);
        assert_eq!(&bytes[46..48], &1000i16.to_le_bytes());
        assert_eq!(&bytes[50..52], &i16::MAX.to_le_bytes());
    }

    /// Writes every sound at 70 and 100 to `MARGAYA_SOUND_SAMPLES` when set,
    /// with their peak and RMS, for a person to listen to and compare.
    #[test]
    fn writes_samples_when_asked() {
        let Ok(dir) = std::env::var("MARGAYA_SOUND_SAMPLES") else {
            return;
        };
        let dir = std::path::PathBuf::from(dir);
        std::fs::create_dir_all(&dir).unwrap();
        let mut report = String::from("sound\tvolume\tpeak_dbfs\trms_dbfs\tseconds\n");
        for id in SoundId::ALL {
            for volume in [70, 100] {
                let samples = render(Tone { id, volume });
                std::fs::write(
                    dir.join(format!("{}-{volume}.wav", id.name())),
                    wav(&samples),
                )
                .unwrap();
                let db = |x: f64| 20.0 * (x / f64::from(i16::MAX)).log10();
                report.push_str(&format!(
                    "{}\t{volume}\t{:.1}\t{:.1}\t{:.2}\n",
                    id.name(),
                    db(f64::from(peak(&samples))),
                    db(rms(&samples)),
                    samples.len() as f64 / f64::from(SAMPLE_RATE),
                ));
            }
        }
        std::fs::write(dir.join("levels.tsv"), report).unwrap();
    }

    #[test]
    fn linux_players_take_the_file_last_and_never_a_shell() {
        let names: Vec<_> = LINUX_PLAYERS.iter().map(|(name, _)| *name).collect();
        assert_eq!(names, ["paplay", "pw-play", "aplay"]);
        for (name, args) in LINUX_PLAYERS {
            assert!(!name.contains('/') && !name.contains(' '), "{name}");
            assert!(args.iter().all(|arg| arg.starts_with('-')), "{name}");
        }
    }

    #[test]
    fn reads_gnome_do_not_disturb() {
        assert!(gnome_banners_off("false\n"));
        assert!(!gnome_banners_off("true\n"));
        assert!(!gnome_banners_off(""));
        assert!(!gnome_banners_off("No such schema"));
    }

    #[cfg(target_os = "linux")]
    #[test]
    fn writes_the_linux_sound_file_for_this_user_only() {
        use std::os::unix::fs::PermissionsExt;
        let bytes = wav(&render(FALLBACK));
        let path = linux::write_wav(&bytes).unwrap();
        assert_eq!(std::fs::read(&path).unwrap(), bytes);
        let mode = std::fs::metadata(&path).unwrap().permissions().mode();
        assert_eq!(mode & 0o777, 0o600);
        let other = linux::write_wav(&bytes).unwrap();
        assert_ne!(path, other);
        std::fs::remove_file(path).unwrap();
        std::fs::remove_file(other).unwrap();
    }

    /// Plays one sound through the default output when
    /// `MARGAYA_SOUND_PLAY=<name>[:<volume>]` is set (Windows, Linux), and waits
    /// for it to end, for a live check with a level meter.
    #[test]
    fn plays_a_sample_when_asked() {
        let Ok(spec) = std::env::var("MARGAYA_SOUND_PLAY") else {
            return;
        };
        let (name, volume) = spec.split_once(':').unwrap_or((&spec, "70"));
        let tone = Tone {
            id: SoundId::parse(name).expect("a sound name"),
            volume: volume.parse().expect("a volume"),
        };
        #[cfg(windows)]
        eprintln!(
            "system quiet: {}, focus profile: {:?}",
            system_quiet(),
            focus_profile()
        );
        let repeat: u32 = std::env::var("MARGAYA_SOUND_REPEAT")
            .ok()
            .and_then(|r| r.parse().ok())
            .unwrap_or(1);
        for _ in 0..repeat {
            play(tone);
            std::thread::sleep(std::time::Duration::from_millis(1500));
        }
    }
}
