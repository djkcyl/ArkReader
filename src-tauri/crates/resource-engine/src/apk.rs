//! Read the official Android package directory and only the required ZIP members.
use crate::net::{header, Client};
use crate::{cache::resource_path, error::checkpoint, source};
use anyhow::{ensure, Context, Result};
use futures_util::StreamExt;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{collections::BTreeMap, io::Read};
use tokio_util::sync::CancellationToken;

mod manifest;
const DOWNLOAD: &str = "https://ak.hypergryph.com/downloads/android_lastest";
const TAIL: u64 = 65557;
pub const DATA: &str = "assets/bin/Data/";

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Member {
    pub name: String,
    pub offset: u64,
    pub compressed: u64,
    pub size: u64,
    pub crc: u32,
    pub method: u16,
    pub flags: u16,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Archive {
    pub client_version: String,
    pub url: String,
    pub size: u64,
    pub etag: Option<String>,
    pub directory_sha256: String,
    pub directory_offset: u64,
    pub members: BTreeMap<String, Member>,
}
struct Range {
    bytes: Vec<u8>,
    start: u64,
    total: u64,
    url: String,
    etag: Option<String>,
}

pub(super) fn u16_at(bytes: &[u8], at: usize) -> Result<u16> {
    Ok(u16::from_le_bytes(
        bytes
            .get(at..at.checked_add(2).context("Offset overflow")?)
            .context("Truncated APK structure")?
            .try_into()?,
    ))
}
pub(super) fn u32_at(bytes: &[u8], at: usize) -> Result<u32> {
    Ok(u32::from_le_bytes(
        bytes
            .get(at..at.checked_add(4).context("Offset overflow")?)
            .context("Truncated APK structure")?
            .try_into()?,
    ))
}

async fn fetch(
    client: &Client,
    url: &str,
    range: &str,
    expected_etag: Option<&str>,
    limit: u64,
    cancel: &CancellationToken,
) -> Result<Range> {
    checkpoint(cancel)?;
    let mut request = client
        .get(source::https(url)?)
        .header(header::RANGE, range)
        .header(header::ACCEPT_ENCODING, "identity");
    if let Some(etag) = expected_etag {
        request = request.header(header::IF_MATCH, etag);
    }
    let response = tokio::select! { biased; _=cancel.cancelled()=>return Err(crate::error::Error::Cancelled.into()), r=request.send()=>r? };
    ensure!(
        response.status() == crate::net::StatusCode::PARTIAL_CONTENT,
        "Android package server did not return the requested byte range ({})",
        response.status()
    );
    let url = response.url().to_string();
    ensure!(
        response.url().scheme() == "https"
            && response.url().host_str() == Some("ak.hycdn.cn")
            && response.url().path().ends_with(".apk"),
        "Unexpected official Android package URL"
    );
    let etag = response
        .headers()
        .get(header::ETAG)
        .and_then(|v| v.to_str().ok())
        .map(str::to_owned);
    ensure!(
        expected_etag.is_none_or(|v| etag.as_deref() == Some(v)),
        "Android package changed during download"
    );
    let value = response
        .headers()
        .get(header::CONTENT_RANGE)
        .context("APK range header missing")?
        .to_str()?;
    let (bounds, total) = value
        .strip_prefix("bytes ")
        .and_then(|s| s.split_once('/'))
        .context("Invalid APK byte range")?;
    let (start, end) = bounds.split_once('-').context("Invalid APK byte range")?;
    let (start, end, total) = (
        start.parse::<u64>()?,
        end.parse::<u64>()?,
        total.parse::<u64>()?,
    );
    ensure!(
        start <= end && end < total && end - start < limit,
        "APK byte range exceeds its bounds"
    );
    let expected = end - start + 1;
    let mut bytes = Vec::with_capacity(usize::try_from(expected)?);
    let mut stream = response.bytes_stream();
    while let Some(part) = tokio::select! {biased;_=cancel.cancelled()=>return Err(crate::error::Error::Cancelled.into()),part=stream.next()=>part}
    {
        let part = part?;
        ensure!(
            bytes.len() as u64 + part.len() as u64 <= expected,
            "APK range response is too large"
        );
        bytes.extend_from_slice(&part);
    }
    ensure!(
        bytes.len() as u64 == expected,
        "Incomplete Android package range"
    );
    Ok(Range {
        bytes,
        start,
        total,
        url,
        etag,
    })
}

fn directory(tail: &[u8], tail_start: u64, total: u64) -> Result<(u64, u64, usize)> {
    let position = (0..tail.len().saturating_sub(21))
        .rev()
        .find(|&p| {
            tail.get(p..p + 4) == Some(b"PK\x05\x06")
                && u16_at(tail, p + 20).is_ok_and(|n| p + 22 + usize::from(n) == tail.len())
        })
        .context("Android ZIP directory footer missing")?;
    ensure!(
        u16_at(tail, position + 4)? == 0 && u16_at(tail, position + 6)? == 0,
        "Multi-volume APK is unsupported"
    );
    let count = usize::from(u16_at(tail, position + 10)?);
    ensure!(
        count > 0 && count < 65535 && usize::from(u16_at(tail, position + 8)?) == count,
        "Invalid APK entry count"
    );
    let size = u64::from(u32_at(tail, position + 12)?);
    let offset = u64::from(u32_at(tail, position + 16)?);
    ensure!(
        size > 0
            && size <= 16 * 1024 * 1024
            && offset + size == tail_start + position as u64
            && tail_start + tail.len() as u64 == total,
        "Invalid APK directory bounds"
    );
    Ok((offset, size, count))
}

fn parse_members(
    bytes: &[u8],
    count: usize,
    directory_offset: u64,
) -> Result<BTreeMap<String, Member>> {
    let mut result = BTreeMap::new();
    let mut at = 0;
    for _ in 0..count {
        ensure!(
            u32_at(bytes, at)? == 0x02014b50,
            "Invalid APK central directory entry"
        );
        let flags = u16_at(bytes, at + 8)?;
        let method = u16_at(bytes, at + 10)?;
        let size = u64::from(u32_at(bytes, at + 24)?);
        let compressed = u64::from(u32_at(bytes, at + 20)?);
        let offset = u64::from(u32_at(bytes, at + 42)?);
        let name_len = usize::from(u16_at(bytes, at + 28)?);
        let extra = usize::from(u16_at(bytes, at + 30)?);
        let comment = usize::from(u16_at(bytes, at + 32)?);
        ensure!(
            u16_at(bytes, at + 34)? == 0
                && flags & 1 == 0
                && offset + 30 + compressed <= directory_offset,
            "Invalid APK member bounds"
        );
        let end = at
            .checked_add(46 + name_len + extra + comment)
            .context("APK directory overflow")?;
        let row = bytes.get(at..end).context("Truncated APK directory")?;
        let name = std::str::from_utf8(&row[46..46 + name_len])?.to_owned();
        if !name.ends_with('/') {
            resource_path(&name)?;
            let member = Member {
                name: name.clone(),
                offset,
                compressed,
                size,
                crc: u32_at(bytes, at + 16)?,
                method,
                flags,
            };
            ensure!(result.insert(name, member).is_none(), "Duplicate APK entry");
        }
        at = end;
    }
    ensure!(at == bytes.len(), "Unexpected data after APK directory");
    Ok(result)
}

impl Archive {
    pub async fn discover(
        client: &Client,
        expected_version: &str,
        previous: Option<&Self>,
        cancel: &CancellationToken,
    ) -> Result<Self> {
        let tail = fetch(client, DOWNLOAD, "bytes=-65557", None, TAIL, cancel).await?;
        let (offset, size, count) = directory(&tail.bytes, tail.start, tail.total)?;
        if let Some(old) = previous.filter(|old| {
            old.client_version == expected_version
                && old.url == tail.url
                && old.size == tail.total
                && old.etag.is_some()
                && old.etag == tail.etag
        }) {
            return Ok(old.clone());
        }
        let raw = if offset >= tail.start {
            tail.bytes[(offset - tail.start) as usize..(offset - tail.start + size) as usize]
                .to_vec()
        } else {
            let r = fetch(
                client,
                &tail.url,
                &format!("bytes={offset}-{}", offset + size - 1),
                tail.etag.as_deref(),
                size,
                cancel,
            )
            .await?;
            ensure!(
                r.start == offset && r.total == tail.total && r.bytes.len() as u64 == size,
                "APK directory response mismatch"
            );
            r.bytes
        };
        let members = parse_members(&raw, count, offset)?;
        let mut archive = Self {
            client_version: String::new(),
            url: tail.url,
            size: tail.total,
            etag: tail.etag,
            directory_sha256: format!("{:x}", Sha256::digest(&raw)),
            directory_offset: offset,
            members,
        };
        let entry = archive
            .members
            .get("AndroidManifest.xml")
            .context("APK application manifest missing")?;
        let raw = archive.read_member(client, entry, cancel).await?;
        let (package, version) = manifest::identity(&raw)?;
        ensure!(
            package == "com.hypergryph.arknights",
            "Unexpected Android application package"
        );
        ensure!(
            version == expected_version,
            "Android package version {version} does not match resource client {expected_version}"
        );
        archive.client_version = version;
        Ok(archive)
    }

    pub async fn read_member(
        &self,
        client: &Client,
        entry: &Member,
        cancel: &CancellationToken,
    ) -> Result<Vec<u8>> {
        ensure!(
            entry.compressed <= 128 * 1024 * 1024 && entry.size <= 256 * 1024 * 1024,
            "APK member exceeds the resource limit"
        );
        let head = fetch(
            client,
            &self.url,
            &format!("bytes={}-{}", entry.offset, entry.offset + 29),
            self.etag.as_deref(),
            30,
            cancel,
        )
        .await?;
        ensure!(
            head.start == entry.offset && head.total == self.size && head.bytes.len() == 30,
            "APK local header response mismatch"
        );
        ensure!(
            u32_at(&head.bytes, 0)? == 0x04034b50
                && u16_at(&head.bytes, 6)? == entry.flags
                && u16_at(&head.bytes, 8)? == entry.method,
            "APK local header differs from directory"
        );
        let name = usize::from(u16_at(&head.bytes, 26)?);
        let extra = usize::from(u16_at(&head.bytes, 28)?);
        ensure!(
            name == entry.name.len(),
            "APK local filename length differs"
        );
        let start = entry.offset + 30;
        let length = name as u64 + extra as u64 + entry.compressed;
        ensure!(
            length > 0 && start + length <= self.directory_offset,
            "APK payload exceeds package"
        );
        let bytes = fetch(
            client,
            &self.url,
            &format!("bytes={start}-{}", start + length - 1),
            self.etag.as_deref(),
            length,
            cancel,
        )
        .await?;
        ensure!(
            bytes.start == start && bytes.total == self.size && bytes.bytes.len() as u64 == length,
            "APK payload response mismatch"
        );
        ensure!(
            &bytes.bytes[..name] == entry.name.as_bytes(),
            "APK local filename differs"
        );
        let member = entry.clone();
        let cancel = cancel.clone();
        crate::runtime::blocking(move || {
            decode_member(&member, &bytes.bytes[name + extra..], &cancel)
        })
        .await?
    }
}

fn decode_member(entry: &Member, bytes: &[u8], cancel: &CancellationToken) -> Result<Vec<u8>> {
    checkpoint(cancel)?;
    ensure!(
        bytes.len() as u64 == entry.compressed,
        "Truncated compressed APK member"
    );
    let data = match entry.method {
        0 => bytes.to_vec(),
        8 => {
            let mut data = Vec::with_capacity(usize::try_from(entry.size)?);
            flate2::read::DeflateDecoder::new(bytes)
                .take(entry.size + 1)
                .read_to_end(&mut data)?;
            data
        }
        _ => anyhow::bail!("Unsupported APK compression method {}", entry.method),
    };
    checkpoint(cancel)?;
    ensure!(
        data.len() as u64 == entry.size && crc32fast::hash(&data) == entry.crc,
        "APK resource checksum mismatch: {}",
        entry.name
    );
    Ok(data)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::{Cursor, Write};

    fn archive() -> Result<Vec<u8>> {
        let mut zip = zip::ZipWriter::new(Cursor::new(Vec::new()));
        zip.start_file(
            "assets/bin/Data/test.assets.split0",
            zip::write::SimpleFileOptions::default()
                .compression_method(zip::CompressionMethod::Deflated),
        )?;
        zip.write_all(b"first resource part")?;
        zip.set_comment("APK directory test");
        Ok(zip.finish()?.into_inner())
    }

    #[test]
    fn reads_directory_and_checks_member_content() -> Result<()> {
        let bytes = archive()?;
        let (offset, size, count) = directory(&bytes, 0, bytes.len() as u64)?;
        let entries = parse_members(
            &bytes[offset as usize..(offset + size) as usize],
            count,
            offset,
        )?;
        let member = &entries["assets/bin/Data/test.assets.split0"];
        let start = member.offset as usize
            + 30
            + usize::from(u16_at(&bytes, member.offset as usize + 26)?)
            + usize::from(u16_at(&bytes, member.offset as usize + 28)?);
        let payload = &bytes[start..start + member.compressed as usize];
        assert_eq!(
            decode_member(member, payload, &CancellationToken::new())?,
            b"first resource part"
        );
        let mut bad = member.clone();
        bad.crc ^= 1;
        assert!(decode_member(&bad, payload, &CancellationToken::new()).is_err());
        bad = member.clone();
        bad.size = 1;
        assert!(decode_member(&bad, payload, &CancellationToken::new()).is_err());
        let cancel = CancellationToken::new();
        cancel.cancel();
        assert!(decode_member(member, payload, &cancel).is_err());
        Ok(())
    }

    #[test]
    fn rejects_truncated_directories_and_unsafe_names() -> Result<()> {
        let bytes = archive()?;
        let (offset, size, count) = directory(&bytes, 0, bytes.len() as u64)?;
        assert!(directory(&bytes[..bytes.len() - 1], 0, bytes.len() as u64 - 1).is_err());
        let mut raw = bytes[offset as usize..(offset + size) as usize].to_vec();
        raw[46..49].copy_from_slice(b"../");
        assert!(parse_members(&raw, count, offset).is_err());
        assert!(parse_members(&raw[..raw.len() - 1], count, offset).is_err());
        Ok(())
    }
}
