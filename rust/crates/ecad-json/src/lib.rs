use std::io;

use serde::Serialize;
use serde_json::ser::{CharEscape, Formatter};

pub use serde_json::{Map, Value};

#[derive(Clone, Copy)]
enum Indent<'a> {
    None,
    With(&'a [u8]),
}

struct JsFormatter<'a> {
    indent: Indent<'a>,
    depth: usize,
    has_value: bool,
}

impl<'a> JsFormatter<'a> {
    fn new(indent: Indent<'a>) -> Self {
        Self {
            indent,
            depth: 0,
            has_value: false,
        }
    }

    fn newline<W: ?Sized + io::Write>(&self, writer: &mut W) -> io::Result<()> {
        if let Indent::With(unit) = self.indent {
            writer.write_all(b"\n")?;
            for _ in 0..self.depth {
                writer.write_all(unit)?;
            }
        }
        Ok(())
    }

    fn write_number<W: ?Sized + io::Write>(&mut self, writer: &mut W, value: f64) -> io::Result<()> {
        if !value.is_finite() {
            return writer.write_all(b"null");
        }
        if value == 0.0 {
            return writer.write_all(b"0");
        }
        let mut buffer = ryu_js::Buffer::new();
        writer.write_all(buffer.format_finite(value).as_bytes())
    }
}

impl Formatter for JsFormatter<'_> {
    fn write_f32<W: ?Sized + io::Write>(&mut self, writer: &mut W, value: f32) -> io::Result<()> {
        self.write_number(writer, f64::from(value))
    }

    fn write_f64<W: ?Sized + io::Write>(&mut self, writer: &mut W, value: f64) -> io::Result<()> {
        self.write_number(writer, value)
    }

    fn write_char_escape<W: ?Sized + io::Write>(
        &mut self,
        writer: &mut W,
        char_escape: CharEscape,
    ) -> io::Result<()> {
        let bytes: &[u8] = match char_escape {
            CharEscape::Quote => b"\\\"",
            CharEscape::ReverseSolidus => b"\\\\",
            CharEscape::Solidus => b"/",
            CharEscape::Backspace => b"\\b",
            CharEscape::FormFeed => b"\\f",
            CharEscape::LineFeed => b"\\n",
            CharEscape::CarriageReturn => b"\\r",
            CharEscape::Tab => b"\\t",
            CharEscape::AsciiControl(byte) => {
                const HEX: &[u8; 16] = b"0123456789abcdef";
                let escaped = [
                    b'\\',
                    b'u',
                    b'0',
                    b'0',
                    HEX[(byte >> 4) as usize],
                    HEX[(byte & 0xF) as usize],
                ];
                return writer.write_all(&escaped);
            }
        };
        writer.write_all(bytes)
    }

    fn begin_array<W: ?Sized + io::Write>(&mut self, writer: &mut W) -> io::Result<()> {
        self.depth += 1;
        self.has_value = false;
        writer.write_all(b"[")
    }

    fn end_array<W: ?Sized + io::Write>(&mut self, writer: &mut W) -> io::Result<()> {
        self.depth -= 1;
        if self.has_value {
            self.newline(writer)?;
        }
        writer.write_all(b"]")
    }

    fn begin_array_value<W: ?Sized + io::Write>(&mut self, writer: &mut W, first: bool) -> io::Result<()> {
        if !first {
            writer.write_all(b",")?;
        }
        self.newline(writer)
    }

    fn end_array_value<W: ?Sized + io::Write>(&mut self, _writer: &mut W) -> io::Result<()> {
        self.has_value = true;
        Ok(())
    }

    fn begin_object<W: ?Sized + io::Write>(&mut self, writer: &mut W) -> io::Result<()> {
        self.depth += 1;
        self.has_value = false;
        writer.write_all(b"{")
    }

    fn end_object<W: ?Sized + io::Write>(&mut self, writer: &mut W) -> io::Result<()> {
        self.depth -= 1;
        if self.has_value {
            self.newline(writer)?;
        }
        writer.write_all(b"}")
    }

    fn begin_object_key<W: ?Sized + io::Write>(&mut self, writer: &mut W, first: bool) -> io::Result<()> {
        if !first {
            writer.write_all(b",")?;
        }
        self.newline(writer)
    }

    fn begin_object_value<W: ?Sized + io::Write>(&mut self, writer: &mut W) -> io::Result<()> {
        match self.indent {
            Indent::None => writer.write_all(b":"),
            Indent::With(_) => writer.write_all(b": "),
        }
    }

    fn end_object_value<W: ?Sized + io::Write>(&mut self, _writer: &mut W) -> io::Result<()> {
        self.has_value = true;
        Ok(())
    }
}

fn write<T: Serialize + ?Sized>(value: &T, indent: Indent<'_>) -> String {
    let mut out = Vec::with_capacity(256);
    let mut serializer = serde_json::Serializer::with_formatter(&mut out, JsFormatter::new(indent));
    value
        .serialize(&mut serializer)
        .expect("serializing to memory cannot fail for JSON-compatible data");
    String::from_utf8(out).expect("serde_json writes UTF-8")
}

/// Same output as `JSON.stringify(value)`.
pub fn stringify<T: Serialize + ?Sized>(value: &T) -> String {
    write(value, Indent::None)
}

/// Same output as `JSON.stringify(value, null, indent)`.
pub fn stringify_pretty<T: Serialize + ?Sized>(value: &T, indent: &str) -> String {
    if indent.is_empty() {
        return stringify(value);
    }
    write(value, Indent::With(indent.as_bytes()))
}

/// Number formatting of `String(value)` in JavaScript.
pub fn js_number(value: f64) -> String {
    if value.is_nan() {
        return "NaN".into();
    }
    if value.is_infinite() {
        return if value > 0.0 { "Infinity".into() } else { "-Infinity".into() };
    }
    if value == 0.0 {
        return "0".into();
    }
    ryu_js::Buffer::new().format_finite(value).to_owned()
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn matches_json_stringify() {
        let value = json!({"b": 2.0, "a": [1.5, -0.0, 1e21, 1e-7, 0.000001, 123456789012.0], "s": "q\"\u{1}/", "e": [], "o": {}});
        assert_eq!(
            stringify(&value),
            r#"{"b":2,"a":[1.5,0,1e+21,1e-7,0.000001,123456789012],"s":"q\"\u0001/","e":[],"o":{}}"#
        );
        assert_eq!(
            stringify_pretty(&json!({"a": [1, {"b": []}], "c": {}}), "  "),
            "{\n  \"a\": [\n    1,\n    {\n      \"b\": []\n    }\n  ],\n  \"c\": {}\n}"
        );
    }
}
