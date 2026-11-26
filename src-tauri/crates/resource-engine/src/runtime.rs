pub async fn blocking<F, R>(work: F) -> Result<R, tokio::task::JoinError>
where
    F: FnOnce() -> R + Send + 'static,
    R: Send + 'static,
{
    #[cfg(not(target_os = "emscripten"))]
    {
        tokio::task::spawn_blocking(work).await
    }
    #[cfg(target_os = "emscripten")]
    {
        tokio::task::yield_now().await;
        Ok(work())
    }
}
