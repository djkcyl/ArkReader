use thiserror::Error;
use tokio_util::sync::CancellationToken;

#[derive(Debug, Error)]
pub enum Error {
    #[error("Resource preparation cancelled")]
    Cancelled,
    #[error("Official resource not found: {0}")]
    ResourceNotFound(String),
    #[error("Resource is not cached: {0}")]
    NotCached(String),
    #[error("Resource checksum mismatch: {0}")]
    Checksum(String),
    #[error("剧情包含尚未适配的功能，请更新程序后再试。")]
    UnsupportedScript(Box<crate::script::Compatibility>),
}

pub fn checkpoint(token: &CancellationToken) -> Result<(), Error> {
    if token.is_cancelled() {
        Err(Error::Cancelled)
    } else {
        Ok(())
    }
}
