//! Android binary XML identity; no application code is executed.
use super::{u16_at, u32_at};
use anyhow::{ensure, Context, Result};

fn string_length(bytes: &[u8], at: &mut usize, utf8: bool) -> Result<usize> {
    if utf8 {
        let a = *bytes.get(*at).context("Truncated APK string")?;
        *at += 1;
        if a & 0x80 == 0 {
            Ok(a as usize)
        } else {
            let b = *bytes.get(*at).context("Truncated APK string")?;
            *at += 1;
            Ok(((a as usize & 0x7f) << 8) | b as usize)
        }
    } else {
        let a = u16_at(bytes, *at)?;
        *at += 2;
        if a & 0x8000 == 0 {
            Ok(a as usize)
        } else {
            let b = u16_at(bytes, *at)?;
            *at += 2;
            Ok(((a as usize & 0x7fff) << 16) | b as usize)
        }
    }
}
fn strings(bytes: &[u8]) -> Result<Vec<String>> {
    let header = usize::from(u16_at(bytes, 2)?);
    let count = u32_at(bytes, 8)? as usize;
    let utf8 = u32_at(bytes, 16)? & 0x100 != 0;
    let base = u32_at(bytes, 20)? as usize;
    ensure!(
        header >= 28 && count <= 65536 && header + count * 4 <= base && base <= bytes.len(),
        "Invalid APK XML string pool"
    );
    let mut result = Vec::with_capacity(count);
    for i in 0..count {
        let mut at = base
            .checked_add(u32_at(bytes, header + i * 4)? as usize)
            .context("APK string offset overflow")?;
        let characters = string_length(bytes, &mut at, utf8)?;
        if utf8 {
            let length = string_length(bytes, &mut at, true)?;
            let raw = bytes
                .get(
                    at..at
                        .checked_add(length)
                        .context("APK string length overflow")?,
                )
                .context("Truncated APK XML text")?;
            result.push(std::str::from_utf8(raw)?.into());
        } else {
            let raw = bytes
                .get(
                    at..at
                        .checked_add(
                            characters
                                .checked_mul(2)
                                .context("APK string length overflow")?,
                        )
                        .context("APK string range overflow")?,
                )
                .context("Truncated APK XML text")?;
            result.push(String::from_utf16(
                &raw.as_chunks::<2>()
                    .0
                    .iter()
                    .map(|v| u16::from_le_bytes(*v))
                    .collect::<Vec<_>>(),
            )?);
        }
    }
    Ok(result)
}
pub(super) fn identity(bytes: &[u8]) -> Result<(String, String)> {
    ensure!(
        u16_at(bytes, 0)? == 3
            && u16_at(bytes, 2)? == 8
            && u32_at(bytes, 4)? as usize == bytes.len(),
        "Invalid Android binary XML"
    );
    let mut pool = Vec::new();
    let mut at = 8;
    while at < bytes.len() {
        let kind = u16_at(bytes, at)?;
        let header = usize::from(u16_at(bytes, at + 2)?);
        let size = u32_at(bytes, at + 4)? as usize;
        ensure!(header >= 8 && size >= header, "Invalid APK XML chunk");
        let end = at.checked_add(size).context("APK XML chunk overflow")?;
        let row = bytes.get(at..end).context("Truncated APK XML chunk")?;
        if kind == 1 {
            pool = strings(row)?;
        }
        if kind == 0x102 {
            let string = |i: u32| {
                pool.get(i as usize)
                    .context("APK XML string index outside pool")
            };
            if string(u32_at(row, header + 4)?)? == "manifest" {
                let start = usize::from(u16_at(row, header + 8)?);
                let stride = usize::from(u16_at(row, header + 10)?);
                let count = usize::from(u16_at(row, header + 12)?);
                ensure!(
                    start >= 20 && stride >= 20 && header + start + stride * count <= row.len(),
                    "Invalid APK manifest attributes"
                );
                let mut package = None;
                let mut version = None;
                for i in 0..count {
                    let a = header + start + i * stride;
                    let name = string(u32_at(row, a + 4)?)?;
                    if name != "package" && name != "versionName" {
                        continue;
                    }
                    let namespace = u32_at(row, a)?;
                    if name == "package" {
                        ensure!(
                            namespace == u32::MAX,
                            "APK package attribute has a namespace"
                        );
                    } else {
                        ensure!(
                            string(namespace)? == "http://schemas.android.com/apk/res/android",
                            "Unexpected APK version namespace"
                        );
                    }
                    let raw = u32_at(row, a + 8)?;
                    let value = if raw != u32::MAX {
                        string(raw)?
                    } else {
                        ensure!(row[a + 15] == 3, "APK identity is not a string");
                        string(u32_at(row, a + 16)?)?
                    };
                    let slot = if name == "package" {
                        &mut package
                    } else {
                        &mut version
                    };
                    ensure!(
                        slot.replace(value.clone()).is_none(),
                        "Duplicate APK identity attribute"
                    );
                }
                return Ok((
                    package.context("APK package name missing")?,
                    version.context("APK version name missing")?,
                ));
            }
        }
        at = end;
    }
    anyhow::bail!("Android manifest root not found")
}

#[cfg(test)]
mod tests {
    use super::*;
    fn xml(utf8: bool) -> Vec<u8> {
        let values = [
            "manifest",
            "package",
            "versionName",
            "com.hypergryph.arknights",
            "2.7.91",
            "http://schemas.android.com/apk/res/android",
        ];
        let mut pool = vec![0u8; 28 + values.len() * 4];
        pool[..2].copy_from_slice(&1u16.to_le_bytes());
        pool[2..4].copy_from_slice(&28u16.to_le_bytes());
        pool[8..12].copy_from_slice(&(values.len() as u32).to_le_bytes());
        pool[16..20].copy_from_slice(&(if utf8 { 256u32 } else { 0 }).to_le_bytes());
        let start = pool.len();
        pool[20..24].copy_from_slice(&(start as u32).to_le_bytes());
        for (i, s) in values.iter().enumerate() {
            let offset = pool.len() - start;
            pool[28 + i * 4..32 + i * 4].copy_from_slice(&(offset as u32).to_le_bytes());
            if utf8 {
                pool.extend([s.len() as u8, s.len() as u8]);
                pool.extend(s.as_bytes());
                pool.push(0);
            } else {
                pool.extend((s.len() as u16).to_le_bytes());
                for c in s.encode_utf16() {
                    pool.extend(c.to_le_bytes());
                }
                pool.extend([0, 0]);
            }
        }
        let size = pool.len() as u32;
        pool[4..8].copy_from_slice(&size.to_le_bytes());
        let mut node = vec![0; 76];
        node[..2].copy_from_slice(&0x102u16.to_le_bytes());
        node[2..4].copy_from_slice(&16u16.to_le_bytes());
        node[4..8].copy_from_slice(&76u32.to_le_bytes());
        node[16..20].copy_from_slice(&u32::MAX.to_le_bytes());
        node[24..26].copy_from_slice(&20u16.to_le_bytes());
        node[26..28].copy_from_slice(&20u16.to_le_bytes());
        node[28..30].copy_from_slice(&2u16.to_le_bytes());
        for (i, name, value, ns) in [(0, 1u32, 3u32, u32::MAX), (1, 2, 4, 5)] {
            let at = 36 + i * 20;
            node[at..at + 4].copy_from_slice(&ns.to_le_bytes());
            node[at + 4..at + 8].copy_from_slice(&name.to_le_bytes());
            node[at + 8..at + 12].copy_from_slice(&u32::MAX.to_le_bytes());
            node[at + 12..at + 14].copy_from_slice(&8u16.to_le_bytes());
            node[at + 15] = 3;
            node[at + 16..at + 20].copy_from_slice(&value.to_le_bytes());
        }
        let mut out = vec![3, 0, 8, 0];
        out.extend(((8 + pool.len() + node.len()) as u32).to_le_bytes());
        out.extend(pool);
        out.extend(node);
        out
    }
    #[test]
    fn reads_both_android_string_pool_encodings() -> Result<()> {
        for utf8 in [true, false] {
            let bytes = xml(utf8);
            assert_eq!(
                identity(&bytes)?,
                ("com.hypergryph.arknights".into(), "2.7.91".into())
            );
            assert!(identity(&bytes[..bytes.len() - 1]).is_err());
        }
        Ok(())
    }
    #[test]
    fn rejects_invalid_identity_string_indices() {
        let mut bytes = xml(true);
        let at = bytes.len() - 4;
        bytes[at..].copy_from_slice(&999u32.to_le_bytes());
        assert!(identity(&bytes).is_err());
    }
}
