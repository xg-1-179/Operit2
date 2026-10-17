use super::AIService::AiServiceError;

#[derive(Default)]
pub struct StreamingLineBuffer {
    bytes: Vec<u8>,
    start: usize,
    scanned: usize,
}

impl StreamingLineBuffer {
    pub(super) fn new() -> Self {
        Self::default()
    }

    pub(super) fn extend_from_slice(&mut self, bytes: &[u8]) {
        // Compact once per transport chunk, never once per extracted line.
        if self.start > 0 && self.start >= self.bytes.len() / 2 {
            self.bytes.copy_within(self.start.., 0);
            self.bytes.truncate(self.bytes.len() - self.start);
            self.scanned -= self.start;
            self.start = 0;
        }
        self.bytes.extend_from_slice(bytes);
    }

    #[cfg(test)]
    fn is_empty(&self) -> bool {
        self.start == self.bytes.len()
    }
}

/// Extracts one complete UTF-8 line without decoding partial transport chunks.
#[allow(non_snake_case)]
pub(super) fn takeNextStreamingLine(
    pending_bytes: &mut StreamingLineBuffer,
) -> Result<Option<String>, AiServiceError> {
    let Some(relative_index) = pending_bytes.bytes[pending_bytes.scanned..]
        .iter()
        .position(|byte| *byte == b'\n')
    else {
        pending_bytes.scanned = pending_bytes.bytes.len();
        return Ok(None);
    };
    let end = pending_bytes.scanned + relative_index + 1;
    let start = pending_bytes.start;
    pending_bytes.start = end;
    pending_bytes.scanned = end;
    std::str::from_utf8(&pending_bytes.bytes[start..end])
        .map(|line| Some(line.trim().to_string()))
        .map_err(|error| AiServiceError::ConnectionFailed(error.to_string()))
}

/// Strictly decodes the remaining line when the response stream ends.
#[allow(non_snake_case)]
pub(super) fn decodeStreamingTail(
    pending_bytes: &mut StreamingLineBuffer,
) -> Result<String, AiServiceError> {
    let result = std::str::from_utf8(&pending_bytes.bytes[pending_bytes.start..])
        .map(|line| line.trim().to_string())
        .map_err(|error| AiServiceError::ConnectionFailed(error.to_string()));
    pending_bytes.bytes.clear();
    pending_bytes.start = 0;
    pending_bytes.scanned = 0;
    result
}

#[cfg(test)]
mod tests {
    use super::{decodeStreamingTail, takeNextStreamingLine, StreamingLineBuffer};
    use crate::chat::llmprovider::AIService::AiServiceError;

    /// Preserves multilingual tool content at every possible transport split.
    #[test]
    fn every_transport_split_preserves_tool_content() {
        let line = "data: {\"content\":\"协同空间 中文 👩‍💻 & <tag>\"}";
        let encoded = format!("{line}\r\n").into_bytes();
        for split in 0..encoded.len() {
            let mut pending = StreamingLineBuffer::new();
            pending.extend_from_slice(&encoded[..split]);
            assert_eq!(takeNextStreamingLine(&mut pending).unwrap(), None);
            pending.extend_from_slice(&encoded[split..]);
            assert_eq!(
                takeNextStreamingLine(&mut pending).unwrap(),
                Some(line.to_string())
            );
            assert!(pending.is_empty());
        }
    }

    /// Preserves text even when every byte arrives in a separate network chunk.
    #[test]
    fn single_byte_chunks_preserve_tool_content() {
        let line = "data: {\"content\":\"你好😀\"}";
        let mut pending = StreamingLineBuffer::new();
        let mut lines = Vec::new();
        for byte in format!("{line}\n").bytes() {
            pending.extend_from_slice(&[byte]);
            while let Some(decoded) = takeNextStreamingLine(&mut pending).unwrap() {
                lines.push(decoded);
            }
        }
        assert_eq!(lines, vec![line.to_string()]);
        assert_eq!(decodeStreamingTail(&mut pending).unwrap(), "");
    }

    /// Retains an unfinished final line after extracting complete SSE lines.
    #[test]
    fn multiple_lines_retain_the_unterminated_tail() {
        let mut pending = StreamingLineBuffer::new();
        pending.extend_from_slice("data: 一\n\ndata: 二".as_bytes());
        assert_eq!(
            takeNextStreamingLine(&mut pending).unwrap(),
            Some("data: 一".to_string())
        );
        assert_eq!(
            takeNextStreamingLine(&mut pending).unwrap(),
            Some(String::new())
        );
        assert_eq!(takeNextStreamingLine(&mut pending).unwrap(), None);
        assert_eq!(decodeStreamingTail(&mut pending).unwrap(), "data: 二");
        assert!(pending.is_empty());
    }

    /// Rejects invalid UTF-8 instead of injecting replacement characters.
    #[test]
    fn invalid_utf8_line_returns_a_transport_error() {
        let mut pending = StreamingLineBuffer::new();
        pending.extend_from_slice(&[b'd', 0xff, b'\n']);
        assert!(matches!(
            takeNextStreamingLine(&mut pending),
            Err(AiServiceError::ConnectionFailed(_))
        ));
    }

    /// Rejects a stream that ends before completing a multibyte character.
    #[test]
    fn truncated_utf8_tail_returns_a_transport_error() {
        let encoded = "中".as_bytes();
        let mut pending = StreamingLineBuffer::new();
        pending.extend_from_slice(&encoded[..2]);
        assert_eq!(takeNextStreamingLine(&mut pending).unwrap(), None);
        assert!(matches!(
            decodeStreamingTail(&mut pending),
            Err(AiServiceError::ConnectionFailed(_))
        ));
    }

    #[test]
    fn extracting_lines_does_not_move_the_buffer() {
        let mut pending = StreamingLineBuffer::new();
        let input = "data: test\n".repeat(4096);
        pending.extend_from_slice(input.as_bytes());
        let address = pending.bytes.as_ptr();
        for _ in 0..4096 {
            assert_eq!(
                takeNextStreamingLine(&mut pending).unwrap().as_deref(),
                Some("data: test")
            );
            assert_eq!(pending.bytes.as_ptr(), address);
            assert_eq!(pending.bytes.len(), input.len());
        }
        assert!(pending.is_empty());
        pending.extend_from_slice(b"next\n");
        assert_eq!(pending.bytes, b"next\n");
        assert_eq!(
            takeNextStreamingLine(&mut pending).unwrap().as_deref(),
            Some("next")
        );
    }

    #[test]
    fn compaction_preserves_scan_position_and_partial_utf8() {
        let mut pending = StreamingLineBuffer::new();
        pending.extend_from_slice(b"first long line\n\xe4");
        assert_eq!(
            takeNextStreamingLine(&mut pending).unwrap().as_deref(),
            Some("first long line")
        );
        assert_eq!(takeNextStreamingLine(&mut pending).unwrap(), None);
        pending.extend_from_slice(b"\xb8\xad\n");
        assert_eq!(pending.start, 0);
        assert_eq!(
            takeNextStreamingLine(&mut pending).unwrap().as_deref(),
            Some("中")
        );
    }

    #[test]
    fn incomplete_line_only_scans_new_bytes() {
        let mut pending = StreamingLineBuffer::new();
        for length in 1..=8192 {
            pending.extend_from_slice(b"x");
            assert_eq!(takeNextStreamingLine(&mut pending).unwrap(), None);
            assert_eq!(pending.scanned, length);
        }
        pending.extend_from_slice(b"\n");
        assert_eq!(
            takeNextStreamingLine(&mut pending).unwrap(),
            Some("x".repeat(8192))
        );
        assert_eq!(decodeStreamingTail(&mut pending).unwrap(), "");
        pending.extend_from_slice(b"reused\n");
        assert_eq!(
            takeNextStreamingLine(&mut pending).unwrap().as_deref(),
            Some("reused")
        );
    }
}
