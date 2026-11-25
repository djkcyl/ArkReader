//! Bounded access to the publisher's enveloped FlatBuffer tables.
use anyhow::{ensure, Context, Result};

pub struct Flat<'a> {
    bytes: &'a [u8],
}

impl<'a> Flat<'a> {
    pub fn new(bytes: &'a [u8]) -> Result<Self> {
        ensure!(bytes.len() >= 132, "Official table is incomplete");
        Ok(Self { bytes })
    }

    pub fn bytes(&self, at: usize, len: usize) -> Result<&'a [u8]> {
        ensure!(at >= 128, "Table reference points into its envelope");
        let end = at.checked_add(len).context("Table range overflow")?;
        self.bytes
            .get(at..end)
            .context("Table reference outside payload")
    }

    pub fn u16(&self, at: usize) -> Result<u16> {
        Ok(u16::from_le_bytes(self.bytes(at, 2)?.try_into()?))
    }

    pub fn u32(&self, at: usize) -> Result<u32> {
        Ok(u32::from_le_bytes(self.bytes(at, 4)?.try_into()?))
    }

    pub fn i32(&self, at: usize) -> Result<i32> {
        Ok(i32::from_le_bytes(self.bytes(at, 4)?.try_into()?))
    }

    pub fn f32(&self, at: usize) -> Result<f32> {
        Ok(f32::from_le_bytes(self.bytes(at, 4)?.try_into()?))
    }

    pub fn i64(&self, at: usize) -> Result<i64> {
        Ok(i64::from_le_bytes(self.bytes(at, 8)?.try_into()?))
    }

    pub fn long(&self, table: usize, slot: usize) -> Result<i64> {
        self.field_with_width(table, slot, 8)?
            .map_or(Ok(0), |at| self.i64(at))
    }

    pub fn boolean(&self, table: usize, slot: usize) -> Result<bool> {
        self.field_with_width(table, slot, 1)?
            .map_or(Ok(false), |at| Ok(self.bytes(at, 1)?[0] != 0))
    }

    pub fn float(&self, table: usize, slot: usize) -> Result<f64> {
        self.field(table, slot)?
            .map_or(Ok(0.0), |at| Ok(self.f32(at)? as f64))
    }

    pub fn table(&self, table: usize, slot: usize) -> Result<usize> {
        self.pointer(self.field(table, slot)?.context("Missing table field")?)
    }

    pub fn pairs(&self, table: usize, slot: usize) -> Result<Vec<(String, usize)>> {
        let mut keys = std::collections::HashSet::new();
        self.vector(table, slot)?
            .into_iter()
            .map(|pair| {
                let key = self.string(pair, 4)?;
                ensure!(
                    !key.is_empty() && keys.insert(key.clone()),
                    "Missing or duplicate table key"
                );
                Ok((key, self.table(pair, 6)?))
            })
            .collect()
    }

    pub fn pointer(&self, at: usize) -> Result<usize> {
        let offset = self.u32(at)? as usize;
        ensure!(offset >= 4, "Invalid table reference");
        let target = at.checked_add(offset).context("Table pointer overflow")?;
        self.bytes(target, 4)?;
        Ok(target)
    }

    pub fn root(&self) -> Result<usize> {
        self.pointer(128)
    }

    pub fn field(&self, table: usize, slot: usize) -> Result<Option<usize>> {
        self.field_with_width(table, slot, 4)
    }

    pub fn field_with_width(
        &self,
        table: usize,
        slot: usize,
        width: usize,
    ) -> Result<Option<usize>> {
        let offset = self.i32(table)? as i64;
        let vtable = usize::try_from(table as i64 - offset).context("Invalid table vtable")?;
        let size = self.u16(vtable)? as usize;
        let object_size = self.u16(vtable + 2)? as usize;
        ensure!(
            size >= 4 && size.is_multiple_of(2) && object_size >= 4,
            "Invalid table vtable size"
        );
        self.bytes(vtable, size)?;
        self.bytes(table, object_size)?;
        if slot + 2 > size {
            return Ok(None);
        }
        let offset = self.u16(vtable + slot)? as usize;
        if offset == 0 {
            return Ok(None);
        }
        ensure!(
            offset >= 4
                && offset
                    .checked_add(width)
                    .is_some_and(|end| end <= object_size),
            "Table field outside object"
        );
        let target = table.checked_add(offset).context("Table field overflow")?;
        self.bytes(target, 1)?;
        Ok(Some(target))
    }

    pub fn scalar(&self, table: usize, slot: usize) -> Result<i32> {
        self.field(table, slot)?.map_or(Ok(0), |at| self.i32(at))
    }

    pub fn string(&self, table: usize, slot: usize) -> Result<String> {
        Ok(self.optional_string(table, slot)?.unwrap_or_default())
    }

    pub fn optional_string(&self, table: usize, slot: usize) -> Result<Option<String>> {
        let Some(at) = self.field(table, slot)? else {
            return Ok(None);
        };
        let start = self.pointer(at)?;
        let len = self.u32(start)? as usize;
        let value = std::str::from_utf8(self.bytes(start + 4, len)?)?.to_owned();
        ensure!(
            self.bytes(start + 4 + len, 1)? == [0],
            "Table string has no terminator"
        );
        Ok(Some(value))
    }

    pub fn vector(&self, table: usize, slot: usize) -> Result<Vec<usize>> {
        let Some(at) = self.field(table, slot)? else {
            return Ok(Vec::new());
        };
        let start = self.pointer(at)?;
        let count = self.u32(start)? as usize;
        self.bytes(
            start + 4,
            count.checked_mul(4).context("Table vector overflow")?,
        )?;
        (0..count)
            .map(|i| self.pointer(start + 4 + i * 4))
            .collect()
    }

    pub fn integers(&self, table: usize, slot: usize) -> Result<Vec<i32>> {
        let Some(at) = self.field(table, slot)? else {
            return Ok(Vec::new());
        };
        let start = self.pointer(at)?;
        let count = self.u32(start)? as usize;
        self.bytes(
            start + 4,
            count
                .checked_mul(4)
                .context("Table integer vector overflow")?,
        )?;
        (0..count).map(|i| self.i32(start + 4 + i * 4)).collect()
    }
}
