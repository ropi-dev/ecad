use std::io::Write;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};

pub fn repo_root() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR"))
        .ancestors()
        .nth(3)
        .expect("crate sits at rust/crates/<name>")
        .to_path_buf()
}

pub fn script(name: &str) -> PathBuf {
    repo_root().join("rust/parity").join(name)
}

fn tsx() -> Option<PathBuf> {
    let path = repo_root().join("node_modules/.bin/tsx");
    path.exists().then_some(path)
}

/// Runs `rust/parity/<name>` with tsx from the repository root, writes `input` to its stdin and
/// returns its stdout. Returns `None` when the pnpm install is missing, unless
/// `ECAD_REQUIRE_PARITY` is set, in which case it panics.
pub fn run_ts(name: &str, args: &[&str], input: &[u8]) -> Option<Vec<u8>> {
    let Some(tsx) = tsx() else {
        if std::env::var_os("ECAD_REQUIRE_PARITY").is_some() {
            panic!("ECAD_REQUIRE_PARITY is set but node_modules/.bin/tsx is missing");
        }
        eprintln!("skipping TypeScript parity check {name}: run pnpm install at the repository root");
        return None;
    };
    let mut child = Command::new(tsx)
        .arg(script(name))
        .args(args)
        .current_dir(repo_root())
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .expect("start tsx");
    {
        let mut stdin = child.stdin.take().expect("stdin");
        stdin.write_all(input).expect("write parity input");
    }
    let output = child.wait_with_output().expect("wait for tsx");
    if !output.status.success() {
        panic!(
            "parity script {name} failed: {}",
            String::from_utf8_lossy(&output.stderr)
        );
    }
    Some(output.stdout)
}

pub fn run_ts_string(name: &str, args: &[&str], input: &str) -> Option<String> {
    run_ts(name, args, input.as_bytes()).map(|out| String::from_utf8(out).expect("UTF-8 output"))
}

#[cfg(test)]
mod tests {
    #[test]
    fn runs_typescript() {
        if let Some(out) = super::run_ts_string("echo.ts", &[], r#"{ "a": 1.0 }"#) {
            assert_eq!(out, r#"{"a":1}"#);
        }
    }
}
