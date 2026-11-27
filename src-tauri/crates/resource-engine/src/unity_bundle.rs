//! Lazy UnityFS block access, including Arknights' LZ4 variant.
//! LZ4AK compatibility follows Ark-Unpacker (BSD-3-Clause; see licenses/Ark-Unpacker.txt).

use anyhow::{bail, ensure, Context, Result};
use byteorder::{BigEndian, ReadBytesExt};
use std::collections::VecDeque;
use std::io::{self, Cursor, Read, Seek, SeekFrom};
use std::sync::{Arc, Mutex};
use tokio_util::sync::CancellationToken;
use unity_rs_core::source::{Region, Source};

const MAX_BLOCK_BYTES: usize = 256 * 1024 * 1024;
const MAX_INFO_BYTES: usize = 32 * 1024 * 1024;
const CACHE_BYTES: usize = 32 * 1024 * 1024;

#[derive(Debug)]
struct Block {
    input_offset: u64,
    input_size: usize,
    output_offset: u64,
    output_size: usize,
    compression: u16,
}

struct BlockCache {
    entries: VecDeque<(usize, Arc<[u8]>)>,
    bytes: usize,
}

struct BundleSource {
    input: Region,
    blocks: Vec<Block>,
    length: u64,
    cancelled: CancellationToken,
    cache: Mutex<BlockCache>,
}

fn cstring(reader: &mut impl Read) -> Result<String> {
    let mut bytes = Vec::new();
    for _ in 0..32_768 {
        let byte = reader.read_u8()?;
        if byte == 0 {
            return String::from_utf8(bytes).context("Invalid UnityFS path");
        }
        bytes.push(byte);
    }
    bail!("UnityFS string exceeds its limit")
}

fn extra_length(bytes: &[u8], at: &mut usize, initial: usize) -> Result<usize> {
    let mut length = initial;
    if initial == 15 {
        loop {
            let byte = *bytes.get(*at).context("Truncated LZ4AK length")?;
            *at += 1;
            length = length
                .checked_add(usize::from(byte))
                .context("LZ4AK length overflow")?;
            if byte != 255 {
                break;
            }
        }
    }
    Ok(length)
}

pub fn decode_lz4ak(input: &[u8], size: usize) -> Result<Vec<u8>> {
    ensure!(size <= MAX_BLOCK_BYTES, "LZ4AK block exceeds its limit");
    let mut output = Vec::with_capacity(size);
    let mut at = 0;
    while at < input.len() {
        let token = input[at];
        at += 1;
        let literals = extra_length(input, &mut at, usize::from(token & 15))?;
        ensure!(
            literals <= size - output.len(),
            "LZ4AK literal output overflow"
        );
        let end = at
            .checked_add(literals)
            .context("LZ4AK literal range overflow")?;
        output.extend_from_slice(input.get(at..end).context("Truncated LZ4AK literals")?);
        at = end;
        if output.len() == size {
            break;
        }
        let high = *input.get(at).context("Truncated LZ4AK offset")?;
        let low = *input.get(at + 1).context("Truncated LZ4AK offset")?;
        at += 2;
        let distance = usize::from(u16::from_be_bytes([high, low]));
        ensure!(
            distance > 0 && distance <= output.len(),
            "Invalid LZ4AK match offset"
        );
        let count = extra_length(input, &mut at, usize::from(token >> 4))?
            .checked_add(4)
            .context("LZ4AK match length overflow")?;
        ensure!(count <= size - output.len(), "LZ4AK match output overflow");
        for _ in 0..count {
            output.push(output[output.len() - distance]);
        }
    }
    ensure!(
        output.len() == size && at == input.len(),
        "LZ4AK block length mismatch"
    );
    Ok(output)
}

fn decode(input: &[u8], size: usize, compression: u16) -> Result<Vec<u8>> {
    ensure!(size <= MAX_BLOCK_BYTES, "UnityFS block exceeds its limit");
    let output = match compression & 0x3f {
        0 => input.to_vec(),
        1 => {
            ensure!(input.len() >= 5, "Truncated Unity LZMA header");
            ensure!(
                u32::from_le_bytes(input[1..5].try_into()?) as usize <= MAX_BLOCK_BYTES,
                "Unity LZMA dictionary exceeds its limit"
            );
            let mut header = Vec::with_capacity(input.len() + 8);
            header.extend_from_slice(&input[..5]);
            header.extend_from_slice(&(size as u64).to_le_bytes());
            header.extend_from_slice(&input[5..]);
            let mut output = Vec::with_capacity(size);
            lzma_rs::lzma_decompress(&mut Cursor::new(header), &mut output)?;
            output
        }
        2 | 3 => lz4_flex::block::decompress(input, size)?,
        4 => decode_lz4ak(input, size)?,
        other => bail!("Unsupported UnityFS compression: {other}"),
    };
    ensure!(output.len() == size, "UnityFS decompressed length mismatch");
    Ok(output)
}

impl BundleSource {
    fn block(&self, index: usize) -> Result<Arc<[u8]>> {
        ensure!(
            !self.cancelled.is_cancelled(),
            "Resource preparation cancelled"
        );
        let mut cache = self
            .cache
            .lock()
            .map_err(|_| anyhow::anyhow!("Bundle cache unavailable"))?;
        if let Some(position) = cache.entries.iter().position(|(key, _)| *key == index) {
            let entry = cache.entries.remove(position).expect("Located cache entry");
            let bytes = entry.1.clone();
            cache.entries.push_front(entry);
            return Ok(bytes);
        }
        let block = &self.blocks[index];
        let mut compressed = vec![0; block.input_size];
        self.input
            .read_exact_at(block.input_offset, &mut compressed)?;
        let bytes: Arc<[u8]> = decode(&compressed, block.output_size, block.compression)?.into();
        while cache.bytes + bytes.len() > CACHE_BYTES {
            let Some((_, old)) = cache.entries.pop_back() else {
                break;
            };
            cache.bytes -= old.len();
        }
        // One unusually large compressed block must still be reusable: otherwise
        // every small metadata read would decompress the whole block again.
        cache.bytes += bytes.len();
        cache.entries.push_front((index, bytes.clone()));
        Ok(bytes)
    }
}

impl Source for BundleSource {
    fn len(&self) -> u64 {
        self.length
    }
    fn read_exact_at(&self, offset: u64, output: &mut [u8]) -> io::Result<()> {
        if offset
            .checked_add(output.len() as u64)
            .is_none_or(|end| end > self.length)
        {
            return Err(io::Error::new(
                io::ErrorKind::UnexpectedEof,
                "Bundle range outside file",
            ));
        }
        let mut position = offset;
        let mut written = 0;
        while written < output.len() {
            let index = self.blocks.partition_point(|block| {
                block.output_offset + block.output_size as u64 <= position
            });
            let block = &self.blocks[index];
            let start = (position - block.output_offset) as usize;
            let count = (output.len() - written).min(block.output_size - start);
            if block.compression & 0x3f == 0 {
                if self.cancelled.is_cancelled() {
                    return Err(io::Error::other("Resource preparation cancelled"));
                }
                self.input
                    .read_exact_at(
                        block.input_offset + start as u64,
                        &mut output[written..written + count],
                    )
                    .map_err(io::Error::other)?;
            } else {
                let bytes = self.block(index).map_err(io::Error::other)?;
                output[written..written + count].copy_from_slice(&bytes[start..start + count]);
            }
            written += count;
            position += count as u64;
        }
        Ok(())
    }
}

/// Entry bytes are decompressed only when their source regions are read.
pub fn entries(input: Region, cancelled: CancellationToken) -> Result<Vec<(String, Region)>> {
    let mut reader = input.cursor();
    ensure!(cstring(&mut reader)? == "UnityFS", "Not a UnityFS bundle");
    let version = reader.read_u32::<BigEndian>()?;
    let _engine_version = cstring(&mut reader)?;
    let _engine_revision = cstring(&mut reader)?;
    let size = reader.read_u64::<BigEndian>()?;
    ensure!(
        size == input.len(),
        "UnityFS size differs from the original package"
    );
    let packed_size = reader.read_u32::<BigEndian>()? as usize;
    let unpacked_size = reader.read_u32::<BigEndian>()? as usize;
    let flags = reader.read_u32::<BigEndian>()?;
    ensure!(
        packed_size <= MAX_INFO_BYTES && unpacked_size <= MAX_INFO_BYTES,
        "UnityFS directory exceeds its limit"
    );
    if version >= 7 {
        let at = reader.stream_position()?;
        reader.seek(SeekFrom::Start((at + 15) & !15))?;
    }
    let header_end = reader.stream_position()?;
    let at_end = flags & 0x80 != 0;
    let info_offset = if at_end {
        size.checked_sub(packed_size as u64)
            .context("Invalid UnityFS directory offset")?
    } else {
        header_end
    };
    let mut packed = vec![0; packed_size];
    input.read_exact_at(info_offset, &mut packed)?;
    let mut info = Cursor::new(decode(&packed, unpacked_size, flags as u16)?);
    info.seek(SeekFrom::Start(16))?;
    let count = info.read_u32::<BigEndian>()? as usize;
    ensure!(count <= MAX_INFO_BYTES / 10, "Invalid UnityFS block count");
    let mut input_offset = if at_end {
        header_end
    } else {
        info_offset + packed_size as u64
    };
    if flags & 0x200 != 0 {
        input_offset = (input_offset + 15) & !15;
    }
    let data_end = if at_end { info_offset } else { size };
    let mut output_offset = 0u64;
    let mut blocks = Vec::with_capacity(count);
    for _ in 0..count {
        let output_size = info.read_u32::<BigEndian>()? as usize;
        let input_size = info.read_u32::<BigEndian>()? as usize;
        let compression = info.read_u16::<BigEndian>()?;
        ensure!(
            compression & 0x3f != 0 || input_size == output_size,
            "Uncompressed block size mismatch"
        );
        ensure!(
            output_size > 0 && output_size <= MAX_BLOCK_BYTES && input_size <= MAX_BLOCK_BYTES,
            "Invalid UnityFS block size"
        );
        let next = input_offset
            .checked_add(input_size as u64)
            .context("UnityFS block offset overflow")?;
        ensure!(next <= data_end, "UnityFS block exceeds package data");
        blocks.push(Block {
            input_offset,
            input_size,
            output_offset,
            output_size,
            compression,
        });
        input_offset = next;
        output_offset = output_offset
            .checked_add(output_size as u64)
            .context("UnityFS output size overflow")?;
    }
    let count = info.read_u32::<BigEndian>()? as usize;
    ensure!(count <= MAX_INFO_BYTES / 21, "Invalid UnityFS entry count");
    let source: Arc<dyn Source> = Arc::new(BundleSource {
        input,
        blocks,
        length: output_offset,
        cancelled,
        cache: Mutex::new(BlockCache {
            entries: VecDeque::new(),
            bytes: 0,
        }),
    });
    let mut entries = Vec::with_capacity(count);
    for _ in 0..count {
        let offset = info.read_u64::<BigEndian>()?;
        let length = info.read_u64::<BigEndian>()?;
        let _flags = info.read_u32::<BigEndian>()?;
        let path = cstring(&mut info)?;
        ensure!(
            !path.is_empty()
                && !path.starts_with('/')
                && !path.contains("..")
                && !path.contains(['\\', ':']),
            "Invalid UnityFS entry name"
        );
        entries.push((path, Region::new(source.clone(), offset, length)?));
    }
    Ok(entries)
}
