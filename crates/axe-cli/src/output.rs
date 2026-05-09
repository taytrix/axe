//! Tiny output helpers: human-readable lines and the `--json` envelope.
//!
//! Light agent contract for v0.1: every command can emit
//! `{"ok": bool, "command": "...", "data": {...}, "error": {...} | null}`.

use std::io::{self, Write};

use serde::Serialize;
use serde_json::{Value, json};

use axe_core::error::ExitCode;

#[derive(Debug, Clone, Copy)]
pub struct Output {
    pub json: bool,
    pub quiet: bool,
}

impl Output {
    /// Print a `data` payload as either pretty JSON or as `human()` rendered text.
    pub fn ok<T, F>(self, command: &str, data: &T, human: F)
    where
        T: Serialize,
        F: FnOnce(),
    {
        if self.json {
            let value = serde_json::to_value(data).unwrap_or(Value::Null);
            print_envelope(true, command, value, None);
        } else if !self.quiet {
            human();
        }
    }

    /// Print an error envelope (or a one-line stderr message) and return the exit code.
    pub fn fail(self, command: &str, code: ExitCode, message: &str) -> ExitCode {
        if self.json {
            let err = json!({ "code": code.as_i32(), "kind": "error", "message": message });
            print_envelope(false, command, Value::Null, Some(err));
        } else {
            let _ = writeln!(io::stderr(), "axe {command}: {message}");
        }
        code
    }
}

fn print_envelope(ok: bool, command: &str, data: Value, error: Option<Value>) {
    let mut v = json!({ "ok": ok, "command": command });
    let obj = v.as_object_mut().expect("json!{} produced an object");
    obj.insert("data".into(), data);
    obj.insert("error".into(), error.unwrap_or(Value::Null));
    println!(
        "{}",
        serde_json::to_string(&v).unwrap_or_else(|_| "{}".into())
    );
}
