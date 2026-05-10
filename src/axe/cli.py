"""Typer CLI surface: thin handlers that load context, call core, render via output."""

from __future__ import annotations

from pathlib import Path
from typing import Annotated

import typer

from axe import __version__
from axe.config import Config, save_config
from axe.context import load_context
from axe.errors import AxeError, ExitCode
from axe.layout import layout_at
from axe.logs import find_latest_log, follow_log, tail_lines
from axe.mods import has_drift, run_mods_check
from axe.monitor import run_monitor_tick
from axe.output import (
    OutputOptions,
    print_front_door,
    print_mods,
    print_status,
    print_sync,
    read_output_options,
    render_error,
    render_fail,
    render_ok,
    status_envelope,
)
from axe.status import read_status
from axe.sync import sync_modlist
from axe.systemd import SystemctlVerb, systemctl_show, systemctl_verb
from axe.units import render_monitor_units, render_server_unit

app = typer.Typer(
    name="axe",
    help="Smol Linux cockpit for one Conan Exiles server.",
    no_args_is_help=False,
    invoke_without_command=True,
    add_completion=False,
)

server_app = typer.Typer(help="Server lifecycle (systemd facade).", no_args_is_help=True)
app.add_typer(server_app, name="server")

logs_app = typer.Typer(help="Log inspection.", no_args_is_help=True)
app.add_typer(logs_app, name="logs")


def _opts(ctx: typer.Context) -> OutputOptions:
    obj = ctx.obj or {}
    return read_output_options(
        json_flag=obj.get("json", False),
        quiet=obj.get("quiet", False),
        no_color=obj.get("no_color", False),
    )


def _config_path(ctx: typer.Context) -> Path | None:
    obj = ctx.obj or {}
    return obj.get("config")


@app.callback()
def main(
    ctx: typer.Context,
    config: Annotated[Path | None, typer.Option("--config", help="Path to axe.toml.")] = None,
    json: Annotated[bool, typer.Option("--json", help="Emit JSON envelope.")] = False,
    quiet: Annotated[bool, typer.Option("--quiet", help="Suppress success output.")] = False,
    no_color: Annotated[bool, typer.Option("--no-color", help="Disable ANSI color.")] = False,
) -> None:
    ctx.obj = {"config": config, "json": json, "quiet": quiet, "no_color": no_color}
    if ctx.invoked_subcommand is not None:
        return
    opts = _opts(ctx)
    if opts.json:
        render_fail(
            command="axe",
            code=ExitCode.MISUSE,
            message="--json requires a verb",
            opts=opts,
        )
    print_front_door(opts)


@app.command()
def version(ctx: typer.Context) -> None:
    """Print the axe version."""
    opts = _opts(ctx)
    render_ok(
        command="version",
        data={"version": __version__},
        opts=opts,
        human=lambda: print(__version__),
    )


@app.command()
def init(
    ctx: typer.Context,
    path: Annotated[Path | None, typer.Argument(help="Server root (default: cwd)")] = None,
) -> None:
    """Bootstrap a starter axe.toml at PATH."""
    opts = _opts(ctx)
    target_root = (path or Path.cwd()).resolve()
    target_toml = target_root / "axe.toml"

    if target_toml.exists():
        render_fail(
            command="init",
            code=ExitCode.FILESYSTEM,
            message=f"axe.toml already exists at {target_toml}; refusing to overwrite",
            opts=opts,
        )

    layout = layout_at(target_root)
    if not layout.binary.exists():
        render_fail(
            command="init",
            code=ExitCode.DISCOVERY,
            message=f"no Conan binary at {layout.binary}; {target_root} is not a Conan install",
            opts=opts,
        )

    server_id = target_root.name or "conan"
    config = Config.model_validate(
        {"schema": 1, "server": {"id": server_id, "root": str(target_root)}}
    )
    try:
        save_config(config, target_toml)
    except AxeError as e:
        render_error(command="init", error=e, opts=opts)

    render_ok(
        command="init",
        data={
            "config_path": str(target_toml),
            "root": str(target_root),
            "server_id": server_id,
        },
        opts=opts,
        human=lambda: print(f"wrote {target_toml}"),
    )


@app.command()
def status(ctx: typer.Context) -> None:
    """Show what is true."""
    opts = _opts(ctx)
    try:
        context = load_context(_config_path(ctx))
        s = read_status(context, with_mods=True)
    except AxeError as e:
        render_error(command="status", error=e, opts=opts)

    render_ok(
        command="status",
        data=status_envelope(s),
        opts=opts,
        human=lambda: print_status(s, opts),
        warnings=s.warnings,
    )
    if s.drifted:
        raise typer.Exit(int(ExitCode.DRIFT))


@app.command()
def sync(ctx: typer.Context) -> None:
    """Reconcile mods and modlist."""
    opts = _opts(ctx)
    try:
        context = load_context(_config_path(ctx))
        outcome = sync_modlist(context)
    except AxeError as e:
        render_error(command="sync", error=e, opts=opts)

    render_ok(
        command="sync",
        data={
            "downloaded": outcome.downloaded,
            "missing": outcome.missing,
            "modlist_path": outcome.modlist_path,
            "modlist_changed": outcome.modlist_changed,
            "log_file": str(outcome.log_file) if outcome.log_file else None,
        },
        opts=opts,
        human=lambda: print_sync(outcome, opts),
        warnings=outcome.warnings,
    )
    if outcome.missing:
        raise typer.Exit(int(ExitCode.DRIFT))


@app.command()
def monitor(ctx: typer.Context) -> None:
    """One tick: read status, write state.json, fire on_drift if needed."""
    opts = _opts(ctx)
    try:
        context = load_context(_config_path(ctx))
        outcome = run_monitor_tick(context)
    except AxeError as e:
        render_error(command="monitor", error=e, opts=opts)

    render_ok(
        command="monitor",
        data={
            "state_path": outcome.state_path_str,
            "drift": outcome.state.drift,
            "hook_fired": outcome.hook_fired,
            "checked_at": outcome.state.checked_at,
        },
        opts=opts,
        human=lambda: print(
            f"tick: drift={outcome.state.drift} state={outcome.state_path_str}"
        ),
        warnings=list(outcome.state.warnings),
    )
    if outcome.state.drift:
        raise typer.Exit(int(ExitCode.DRIFT))


@app.command()
def mods(ctx: typer.Context) -> None:
    """Declared mods + freshness state."""
    opts = _opts(ctx)
    try:
        context = load_context(_config_path(ctx))
        result = run_mods_check(context)
    except AxeError as e:
        render_error(command="mods", error=e, opts=opts)

    report = result.report
    render_ok(
        command="mods",
        data={
            "total": report.total,
            "current": report.current,
            "stale": report.stale,
            "missing_local": report.missing_local,
            "missing_remote": report.missing_remote,
            "unmanaged": report.unmanaged,
            "items": [
                {
                    "id": item.id,
                    "state": item.state,
                    "title": item.title,
                    "local_manifest": item.local_manifest,
                    "latest_manifest": item.latest_manifest,
                    "local_time_updated": item.local_time_updated,
                    "latest_time_updated": item.latest_time_updated,
                }
                for item in report.items
            ],
        },
        opts=opts,
        human=lambda: print_mods(report, opts),
        warnings=result.warnings,
    )
    if has_drift(report):
        raise typer.Exit(int(ExitCode.DRIFT))


@app.command()
def unit(
    ctx: typer.Context,
    target: Annotated[str, typer.Argument(help="server or monitor")] = "server",
) -> None:
    """Print systemd user unit text."""
    opts = _opts(ctx)
    if target not in {"server", "monitor"}:
        render_fail(
            command="unit",
            code=ExitCode.MISUSE,
            message=f"target must be 'server' or 'monitor'; got {target!r}",
            opts=opts,
        )
    try:
        context = load_context(_config_path(ctx))
    except AxeError as e:
        render_error(command=f"unit {target}", error=e, opts=opts)

    if target == "server":
        text = render_server_unit(context.config, context.layout)
        data: dict[str, object] = {"target": "server", "text": text}
    else:
        units = render_monitor_units(context.config, context.config_path)
        text = f"{units.service}\n{units.timer}"
        data = {"target": "monitor", "service": units.service, "timer": units.timer}
    render_ok(
        command=f"unit {target}",
        data=data,
        opts=opts,
        human=lambda: print(text, end=""),
    )


def _server_lifecycle(ctx: typer.Context, verb: SystemctlVerb, command: str) -> None:
    opts = _opts(ctx)
    try:
        context = load_context(_config_path(ctx))
        result = systemctl_verb(context.config.effective_unit(), verb)
    except AxeError as e:
        render_error(command=command, error=e, opts=opts)
    render_ok(
        command=command,
        data={"unit": result.unit, "verb": result.verb},
        opts=opts,
        human=lambda: print(f"{result.verb} {result.unit}: ok"),
    )


@server_app.command("up")
def server_up(ctx: typer.Context) -> None:
    """systemctl --user start <unit>"""
    _server_lifecycle(ctx, "start", "server up")


@server_app.command("down")
def server_down(ctx: typer.Context) -> None:
    """systemctl --user stop <unit>"""
    _server_lifecycle(ctx, "stop", "server down")


@server_app.command("restart")
def server_restart(ctx: typer.Context) -> None:
    """systemctl --user restart <unit>"""
    _server_lifecycle(ctx, "restart", "server restart")


@server_app.command("status")
def server_status(ctx: typer.Context) -> None:
    """Summarized systemctl --user show <unit>."""
    opts = _opts(ctx)
    try:
        context = load_context(_config_path(ctx))
        unit_name = context.config.effective_unit()
        show = systemctl_show(unit_name)
    except AxeError as e:
        render_error(command="server status", error=e, opts=opts)

    pid_raw = show.get("MainPID", "0")
    try:
        pid_int = int(pid_raw)
    except ValueError:
        pid_int = 0
    data = {
        "unit": unit_name,
        "active_state": show.get("ActiveState", "unknown"),
        "sub_state": show.get("SubState", "unknown"),
        "main_pid": pid_int if pid_int > 0 else None,
    }
    render_ok(
        command="server status",
        data=data,
        opts=opts,
        human=lambda: print(f"{unit_name}: {data['active_state']} ({data['sub_state']})"),
    )


@logs_app.command("path")
def logs_path(ctx: typer.Context) -> None:
    """Path to the current Conan log."""
    opts = _opts(ctx)
    try:
        context = load_context(_config_path(ctx))
    except AxeError as e:
        render_error(command="logs path", error=e, opts=opts)
    if not context.layout.logs_dir.exists():
        render_fail(
            command="logs path",
            code=ExitCode.DISCOVERY,
            message=f"logs dir not found at {context.layout.logs_dir}",
            opts=opts,
        )
    latest = find_latest_log(context.layout)
    render_ok(
        command="logs path",
        data={
            "logs_dir": str(context.layout.logs_dir),
            "current_log": str(latest) if latest else None,
        },
        opts=opts,
        human=lambda: print(str(latest) if latest else "no log files"),
    )


@logs_app.command("tail")
def logs_tail(
    ctx: typer.Context,
    lines: Annotated[int, typer.Option("--lines", "-n")] = 100,
    follow: Annotated[bool, typer.Option("--follow", "-f")] = False,
) -> None:
    """Last N lines of the current Conan log."""
    opts = _opts(ctx)
    if opts.json and follow:
        render_fail(
            command="logs tail",
            code=ExitCode.MISUSE,
            message="--json --follow is not supported (no clean streaming envelope)",
            opts=opts,
        )
    try:
        context = load_context(_config_path(ctx))
    except AxeError as e:
        render_error(command="logs tail", error=e, opts=opts)
    latest = find_latest_log(context.layout)
    if latest is None:
        render_fail(
            command="logs tail",
            code=ExitCode.DISCOVERY,
            message="no log files found",
            opts=opts,
        )
    if follow:
        for line in follow_log(latest, lines=lines):
            print(line, flush=True)
        return
    try:
        last_lines = tail_lines(latest, lines=lines)
    except AxeError as e:
        render_error(command="logs tail", error=e, opts=opts)
    render_ok(
        command="logs tail",
        data={"path": str(latest), "lines": last_lines},
        opts=opts,
        human=lambda: print("\n".join(last_lines)),
    )
