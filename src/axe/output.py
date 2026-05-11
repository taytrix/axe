"""Human (Rich) + machine (JSON envelope) renderers. The single home for presentation."""

from __future__ import annotations

import json
import os
import sys
from collections.abc import Callable, Iterator
from contextlib import contextmanager
from dataclasses import dataclass
from pathlib import Path
from typing import TYPE_CHECKING, Any, NoReturn

from rich.console import Console
from rich.table import Table

from axe import __version__
from axe.errors import AxeError, ExitCode

if TYPE_CHECKING:
    from axe.doctor import DoctorReport
    from axe.mods import FreshnessReport
    from axe.status import ServerStatus, Status
    from axe.sync import SyncOutcome


@dataclass(frozen=True)
class OutputOptions:
    json: bool
    quiet: bool
    color: bool


def read_output_options(*, json_flag: bool, quiet: bool, no_color: bool) -> OutputOptions:
    return OutputOptions(json=json_flag, quiet=quiet, color=should_color(no_color))


def should_color(no_color: bool) -> bool:
    if no_color or os.environ.get("NO_COLOR"):
        return False
    return sys.stdout.isatty()


@contextmanager
def busy(message: str, opts: OutputOptions) -> Iterator[None]:
    """Spin with `message` for the body's duration.

    Stays silent when stdout is JSON-bound or when stderr isn't a TTY —
    e.g. a systemd-timer monitor tick. Rich Status renders to stderr so
    the envelope on stdout stays clean.
    """
    if opts.json or not sys.stderr.isatty():
        yield
        return
    console = Console(stderr=True, no_color=not opts.color)
    with console.status(f"[bold blue]{message}[/bold blue]"):
        yield


# ---------- envelope I/O ----------------------------------------------------


def render_ok(
    *,
    command: str,
    data: Any,
    opts: OutputOptions,
    human: Callable[[], None] | None = None,
    warnings: list[str] | None = None,
) -> None:
    if opts.json:
        envelope: dict[str, Any] = {
            "ok": True,
            "command": command,
            "data": data,
            "error": None,
        }
        if warnings:
            envelope["warnings"] = warnings
        sys.stdout.write(json.dumps(envelope) + "\n")
        return
    if opts.quiet:
        return
    if human is not None:
        human()


def render_fail(
    *,
    command: str,
    code: ExitCode,
    message: str,
    opts: OutputOptions,
) -> NoReturn:
    if opts.json:
        envelope = {
            "ok": False,
            "command": command,
            "data": None,
            "error": {"code": int(code), "message": message},
        }
        sys.stdout.write(json.dumps(envelope) + "\n")
    else:
        Console(stderr=True, no_color=not opts.color).print(f"[red]error:[/red] {message}")
    raise SystemExit(int(code))


_KIND_TO_CODE: dict[str, ExitCode] = {
    "config": ExitCode.CONFIG,
    "discovery": ExitCode.DISCOVERY,
    "filesystem": ExitCode.FILESYSTEM,
    "workshop_api": ExitCode.NETWORK,
    "acf_parse": ExitCode.CONFIG,
    "lifecycle": ExitCode.LIFECYCLE,
    "hook": ExitCode.LIFECYCLE,
}


def render_error(*, command: str, error: AxeError, opts: OutputOptions) -> NoReturn:
    render_fail(
        command=command,
        code=_KIND_TO_CODE.get(error.kind, ExitCode.MISUSE),
        message=error.message,
        opts=opts,
    )


# ---------- front door ------------------------------------------------------


def print_front_door(opts: OutputOptions) -> None:
    console = Console(no_color=not opts.color)
    console.print(f"[bold]axe {__version__}[/bold]\n")
    console.print("[dim]first-run[/dim]")
    console.print("  axe install <path>  cold-start: write axe.toml + run steamcmd")
    console.print("  axe unit install    wire systemd user units (server + monitor)")
    console.print()
    console.print("[dim]daily[/dim]")
    console.print("  axe status          what is true (offline; reads state.json)")
    console.print("  axe sync            reconcile any drift in one cycle")
    console.print("  axe monitor         refresh state.json (one tick)")
    console.print("  axe mods            declared mods + freshness")
    console.print()
    console.print("[dim]occasional[/dim]")
    console.print("  axe server up       start the systemd service")
    console.print("  axe server restart  restart the systemd service")
    console.print("  axe doctor          diagnose the install (✓ / ✗ per invariant)")
    console.print("  axe validate        force steam to re-verify the install")
    console.print("  axe update          upgrade axe to the latest release")


# ---------- status ----------------------------------------------------------


def status_envelope(s: Status, *, checked_at: str | None = None) -> dict[str, object]:
    envelope: dict[str, object] = {
        "config_path": s.config_path,
        "root": s.root,
        "drifted": s.drifted,
        "server": {
            "unit": s.server.unit,
            "active_state": s.server.active_state,
            "sub_state": s.server.sub_state,
            "main_pid": s.server.main_pid,
            "uptime_seconds": s.server.uptime_seconds,
        },
        "mods": {
            "declared": s.mods.declared,
            "current": s.mods.current,
            "stale": s.mods.stale,
            "missing_local": s.mods.missing_local,
            "missing_remote": s.mods.missing_remote,
        },
        "build": {
            "installed_buildid": s.build.installed_buildid,
            "latest_buildid": s.build.latest_buildid,
            "binary_present": s.build.binary_present,
            "drifted": s.build.drifted,
        },
        "settings": {
            "server_name": s.settings.server_name,
            "rcon_enabled": s.settings.rcon_enabled,
            "rcon_port": s.settings.rcon_port,
            "rcon_password_set": s.settings.rcon_password_set,
            "admin_password_set": s.settings.admin_password_set,
            "server_password_set": s.settings.server_password_set,
            "max_players": s.settings.max_players,
        },
    }
    if checked_at is not None:
        envelope["checked_at"] = checked_at
    return envelope


def print_status(s: Status, opts: OutputOptions, *, as_of: str | None = None) -> None:
    console = Console(no_color=not opts.color)
    console.print(f"[bold]axe / {Path(s.config_path).parent.name}[/bold]")
    console.print(f"[dim]root[/dim]         {s.root}")
    if as_of:
        console.print(f"[dim]as of[/dim]        {as_of}")
    console.print()
    console.print("[dim]server[/dim]")
    console.print(f"  unit         {s.server.unit}")
    console.print(f"  active       {s.server.active_state}")
    console.print(f"  sub          {s.server.sub_state}")
    if s.server.main_pid is not None:
        console.print(f"  pid          {s.server.main_pid}")
    if s.server.uptime_seconds is not None and s.server.active_state == "active":
        console.print(f"  uptime       {format_uptime(s.server.uptime_seconds)}")
    if s.settings.server_name:
        console.print(f"  name         \"{s.settings.server_name}\"")
    if s.settings.rcon_port is not None:
        rcon_state = "enabled" if s.settings.rcon_enabled else "disabled"
        console.print(f"  rcon         port {s.settings.rcon_port} ({rcon_state})")
    if s.settings.max_players is not None:
        console.print(f"  max_players  {s.settings.max_players}")
    console.print()
    console.print("[dim]build[/dim]")
    if not s.build.binary_present:
        console.print("  binary       [red]missing[/red]")
    console.print(f"  installed    {s.build.installed_buildid or '-'}")
    console.print(f"  latest       {s.build.latest_buildid or '-'}")
    build_label = "[red]drifted[/red]" if s.build.drifted else "[green]current[/green]"
    console.print(f"  state        {build_label}")
    console.print()
    console.print("[dim]mods[/dim]")
    console.print(f"  declared     {s.mods.declared}")
    if s.mods.declared:
        console.print(f"  current      {s.mods.current}")
        console.print(f"  stale        {s.mods.stale}")
        console.print(f"  missing      {s.mods.missing_local}")
    if s.warnings:
        console.print()
        for w in s.warnings:
            console.print(f"[yellow]warn[/yellow]    {w}")


def format_uptime(seconds: int) -> str:
    hours, remainder = divmod(seconds, 3600)
    minutes = remainder // 60
    return f"{hours}h {minutes}m" if hours else f"{minutes}m"


def print_server_status_line(server: ServerStatus) -> None:
    """One-line summary; matches the `server` section of `axe status`."""
    bits = [server.unit, f"{server.active_state} ({server.sub_state})"]
    if server.main_pid is not None:
        bits.append(f"pid {server.main_pid}")
    if server.uptime_seconds is not None and server.active_state == "active":
        bits.append(f"up {format_uptime(server.uptime_seconds)}")
    print(" — ".join(bits))


# ---------- install / unit / doctor ----------------------------------------


def print_install_complete(root: Path, log: Path | None) -> None:
    print(f"installed at {root}" + (f" (log: {log})" if log else ""))
    print()
    print("next steps:")
    print(f"  cd {root}")
    print("  axe unit install        # wire systemd (server + monitor timer)")
    print("  axe mods add top <id>   # declare a mod, then `axe sync` to apply")
    print("  axe status              # what is true")


def print_unit_install_done(written: list[Path], target: str) -> None:
    for p in written:
        print(f"wrote {p}")
    if target in {"server", "all"}:
        print()
        print("enable + start the server:")
        print("  systemctl --user enable --now axe-conan")
    if target in {"monitor", "all"}:
        print()
        print("enable the drift-sensor timer:")
        print("  systemctl --user enable --now axe-conan-monitor.timer")


def print_doctor(report: DoctorReport) -> None:
    console = Console()
    for c in report.checks:
        mark = "[green]✓[/green]" if c.ok else "[red]✗[/red]"
        console.print(f"{mark} {c.name:24} [dim]{c.detail}[/dim]")


# ---------- sync ------------------------------------------------------------


def print_sync(outcome: SyncOutcome, opts: OutputOptions) -> None:
    console = Console(no_color=not opts.color)
    did_anything = (
        bool(outcome.downloaded)
        or bool(outcome.missing)
        or outcome.modlist_changed
        or outcome.base_build_updated
    )
    if not did_anything:
        console.print("[green]sync[/green]: nothing to do (no drift)")
        return
    for wsid in outcome.downloaded:
        console.print(f"[green]down[/green]    {wsid}")
    for wsid in outcome.missing:
        console.print(f"[red]miss[/red]    {wsid}")
    if outcome.base_build_updated:
        console.print("[blue]build[/blue]   updated to latest")
    label = "[blue]wrote[/blue]" if outcome.modlist_changed else "[dim]nochg[/dim]"
    console.print(f"{label}   {outcome.modlist_path}")


# ---------- mods ------------------------------------------------------------


_MOD_STATE_MARKER: dict[str, str] = {
    "current": "[green]ok[/green]",
    "stale": "[yellow]stale[/yellow]",
    "missing_local": "[red]miss[/red]",
    "missing_remote": "[red]gone[/red]",
    "unmanaged": "[dim]extra[/dim]",
}


def print_mods(
    report: FreshnessReport,
    opts: OutputOptions,
    *,
    root_label: str | None = None,
) -> None:
    console = Console(no_color=not opts.color)
    if root_label:
        console.print(f"[bold]axe / {root_label}[/bold]\n")
    if not report.items:
        console.print("[dim]no declared mods[/dim]")
        return
    table = Table(show_header=True, header_style="dim", box=None, pad_edge=False)
    table.add_column("#", justify="right")
    table.add_column("state")
    table.add_column("id", justify="right")
    table.add_column("title")
    for ordinal, item in enumerate(report.items, start=1):
        marker = _MOD_STATE_MARKER.get(item.state, "[dim]?[/dim]")
        title = item.title or "[dim]<unknown>[/dim]"
        table.add_row(str(ordinal), marker, str(item.id), title)
    console.print(table)
