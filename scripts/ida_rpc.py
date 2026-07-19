#!/usr/bin/env python3
"""Call the local ida-pro-mcp JSON-RPC endpoint from Windows or WSL.

IDA's plugin binds to Windows 127.0.0.1.  A WSL process therefore cannot reach
it on the default NAT network.  When run under WSL, this helper launches IDA's
Windows Python only for the HTTP request and prints the JSON response back to
the caller.
"""

from __future__ import annotations

import argparse
import http.client
import json
import os
import subprocess
import sys
from pathlib import Path
from typing import Any


DEFAULT_WINDOWS_PYTHON = Path(
    "/mnt/c/Program Files/IDA Professional 9.3/python/python.exe"
)

# Conservative allow-list.  IDA's upstream "unsafe" marker only covers debugger
# operations; this bridge additionally gates database edits and byte patches.
READ_ONLY_METHODS = {
    "get_metadata",
    "get_function_by_name",
    "get_function_by_address",
    "get_current_address",
    "get_current_function",
    "convert_number",
    "list_functions",
    "list_globals_filter",
    "list_globals",
    "list_imports",
    "list_strings_filter",
    "list_strings",
    "list_local_types",
    "decompile_function",
    "disassemble_function",
    "get_xrefs_to",
    "get_xrefs_to_field",
    "get_callees",
    "get_callers",
    "get_entry_points",
    "get_global_variable_value_by_name",
    "get_global_variable_value_at_address",
    "get_stack_frame_variables",
    "get_defined_structures",
    "analyze_struct_detailed",
    "get_struct_at_address",
    "get_struct_info_simple",
    "search_structures",
    "read_memory_bytes",
    "data_read_byte",
    "data_read_word",
    "data_read_dword",
    "data_read_qword",
    "data_read_string",
}

WINDOWS_REQUEST_CODE = r"""
import http.client
import json
import sys

payload = sys.argv[1].encode("utf-8")
connection = http.client.HTTPConnection(sys.argv[2], int(sys.argv[3]), timeout=15)
connection.request(
    "POST",
    "/mcp",
    body=payload,
    headers={"Content-Type": "application/json", "Content-Length": str(len(payload))},
)
response = connection.getresponse()
body = response.read().decode("utf-8")
connection.close()
if response.status != 200:
    raise SystemExit("IDA RPC returned HTTP %d: %s" % (response.status, body))
print(body)
""".strip()


def parse_params(raw: str) -> list[Any] | dict[str, Any]:
    try:
        value = json.loads(raw)
    except json.JSONDecodeError as exc:
        raise ValueError(f"--params must be valid JSON: {exc}") from exc
    if not isinstance(value, (list, dict)):
        raise ValueError("--params must decode to a JSON array or object")
    return value


def request_direct(host: str, port: int, payload: str) -> str:
    body = payload.encode("utf-8")
    connection = http.client.HTTPConnection(host, port, timeout=15)
    try:
        connection.request(
            "POST",
            "/mcp",
            body=body,
            headers={"Content-Type": "application/json", "Content-Length": str(len(body))},
        )
        response = connection.getresponse()
        text = response.read().decode("utf-8")
        if response.status != 200:
            raise RuntimeError(f"IDA RPC returned HTTP {response.status}: {text}")
        return text
    finally:
        connection.close()


def request_via_windows_python(
    python_exe: Path, host: str, port: int, payload: str
) -> str:
    if not python_exe.is_file():
        raise FileNotFoundError(
            f"Windows Python bridge not found: {python_exe}. "
            "Set IDA_WINDOWS_PYTHON to IDA's python.exe path."
        )
    completed = subprocess.run(
        [
            str(python_exe),
            "-X",
            "utf8",
            "-c",
            WINDOWS_REQUEST_CODE,
            payload,
            host,
            str(port),
        ],
        cwd="/mnt/c" if Path("/mnt/c").is_dir() else None,
        check=False,
        text=True,
        encoding="utf-8",
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        timeout=30,
    )
    if completed.returncode != 0:
        detail = completed.stderr.strip() or completed.stdout.strip()
        raise RuntimeError(
            f"Windows Python IDA RPC bridge exited {completed.returncode}: {detail}"
        )
    return completed.stdout.strip()


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("method", nargs="?", default="get_metadata")
    parser.add_argument(
        "--params",
        default="[]",
        help='JSON array/object of method parameters (default: "[]")',
    )
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=13337)
    parser.add_argument(
        "--windows-python",
        type=Path,
        default=Path(os.environ.get("IDA_WINDOWS_PYTHON", DEFAULT_WINDOWS_PYTHON)),
    )
    parser.add_argument(
        "--allow-write",
        action="store_true",
        help="Allow IDA database edits, debugger operations, and byte patches",
    )
    parser.add_argument("--raw", action="store_true", help="Print compact response JSON")
    args = parser.parse_args()

    if args.method not in READ_ONLY_METHODS and not args.allow_write:
        parser.error(
            f"method {args.method!r} is not on the read-only allow-list; "
            "pass --allow-write only after reviewing the target and operation"
        )

    try:
        params = parse_params(args.params)
        payload = json.dumps(
            {"jsonrpc": "2.0", "method": args.method, "params": params, "id": 1},
            ensure_ascii=False,
            separators=(",", ":"),
        )
        if os.name == "nt":
            raw_response = request_direct(args.host, args.port, payload)
        elif args.windows_python.is_file():
            raw_response = request_via_windows_python(
                args.windows_python, args.host, args.port, payload
            )
        else:
            raw_response = request_direct(args.host, args.port, payload)
        response = json.loads(raw_response)
    except (OSError, RuntimeError, ValueError, json.JSONDecodeError) as exc:
        print(f"ida_rpc: {exc}", file=sys.stderr)
        return 1

    if "error" in response:
        print(json.dumps(response["error"], ensure_ascii=False, indent=2), file=sys.stderr)
        return 2

    if args.raw:
        print(json.dumps(response, ensure_ascii=False, separators=(",", ":")))
    else:
        print(json.dumps(response, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
