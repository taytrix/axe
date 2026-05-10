from __future__ import annotations

from pathlib import Path
from typing import Annotated

import typer
from rich.console import Console

from axe import __version__
from axe.config import Config, save_config
from axe.context import load_context
from axe.errors import AxeError, ExitCode
from axe.layout import layout_at
from axe.mods import FreshnessReport, has_drift, run_mods_check
from axe.output import (
    OutputOptions,
    read_output_options,
    render_error,
    render_fail,
    render_ok,
)
from axe.status import Status, read_status
from axe.sync import SyncOutcome, sync_modlist
from axe.systemd import systemctl_show

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


def _stub(command: str, opts: OutputOptions) -> None:
    render_fail(
        command=command,
        code=ExitCode.MISUSE,
        message="not implemented yet (stub)",
        opts=opts,
    )


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
    _print_front_door(opts)


def _print_front_door(opts: OutputOptions) -> None:
    console = Console(no_color=not opts.color)
    console.print(f"[bold]axe {__version__}[/bold]\n")
    console.print("[dim]common[/dim]")
    console.print("  axe status          show what is true")
    console.print("  axe sync            reconcile mods and modlist")
    console.print("  axe monitor         one tick (used by the systemd timer)")
    console.print("  axe server up       start the systemd service")
    console.print("  axe server restart  restart the systemd service")
    console.print("  axe mods            declared mods + freshness")
    console.print("  axe unit            print systemd user units")


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
            message=(
                f"no Conan binary at {layout.binary}; "
                f"{target_root} is not a Conan install"
            ),
            opts=opts,
        )

    server_id = target_root.name or "conan"
    config = Config.model_validate(
        {
            "schema": 1,
            "server": {"id": server_id, "root": str(target_root)},
        }
    )
    try:
        save_config(config, target_toml)
    except AxeError as e:
        render_error(command="init", error=e, opts=opts)
        return

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
        status_data = read_status(context, with_mods=True)
    except AxeError as e:
        render_error(command="status", error=e, opts=opts)
        return

    drift = (
        status_data.mods.stale > 0
        or status_data.mods.missing_local > 0
        or status_data.mods.missing_remote > 0
    )

    render_ok(
        command="status",
        data=_status_envelope(status_data),
        opts=opts,
        human=lambda: _print_status(status_data, opts),
        warnings=list(status_data.warnings) if status_data.warnings else None,
    )
    if drift:
        raise typer.Exit(int(ExitCode.DRIFT))


def _status_envelope(s: Status) -> dict[str, object]:
    return {
        "config_path": s.config_path,
        "root": s.root,
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
    }


def _print_status(s: Status, opts: OutputOptions) -> None:
    console = Console(no_color=not opts.color)
    console.print(f"[bold]axe / {Path(s.config_path).parent.name}[/bold]")
    console.print(f"[dim]root[/dim]         {s.root}\n")
    console.print("[dim]server[/dim]")
    console.print(f"  unit         {s.server.unit}")
    console.print(f"  active       {s.server.active_state}")
    console.print(f"  sub          {s.server.sub_state}")
    if s.server.main_pid is not None:
        console.print(f"  pid          {s.server.main_pid}")
    if s.server.uptime_seconds is not None:
        console.print(f"  uptime       {_format_uptime(s.server.uptime_seconds)}")
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


def _format_uptime(seconds: int) -> str:
    h, rem = divmod(seconds, 3600)
    m, _ = divmod(rem, 60)
    if h:
        return f"{h}h {m}m"
    return f"{m}m"


@app.command()
def sync(ctx: typer.Context) -> None:
    """Reconcile mods and modlist."""
    opts = _opts(ctx)
    try:
        context = load_context(_config_path(ctx))
        outcome = sync_modlist(context)
    except AxeError as e:
        render_error(command="sync", error=e, opts=opts)
        return

    data = {
        "downloaded": outcome.downloaded,
        "missing": outcome.missing,
        "modlist_path": outcome.modlist_path,
        "modlist_changed": outcome.modlist_changed,
        "log_file": str(outcome.log_file) if outcome.log_file else None,
    }
    render_ok(
        command="sync",
        data=data,
        opts=opts,
        human=lambda: _print_sync(outcome, opts),
        warnings=list(outcome.warnings) if outcome.warnings else None,
    )
    if outcome.missing:
        raise typer.Exit(int(ExitCode.DRIFT))


def _print_sync(outcome: SyncOutcome, opts: OutputOptions) -> None:
    console = Console(no_color=not opts.color)
    for wsid in outcome.downloaded:
        console.print(f"[green]down[/green]    {wsid}")
    for wsid in outcome.missing:
        console.print(f"[red]miss[/red]    {wsid}")
    if outcome.modlist_changed:
        console.print(f"[blue]wrote[/blue]   {outcome.modlist_path}")
    else:
        console.print(f"[dim]nochg[/dim]   {outcome.modlist_path}")


@app.command()
def monitor(ctx: typer.Context) -> None:
    """One tick: read status, write state.json, fire on_drift if needed."""
    _stub("monitor", _opts(ctx))


@app.command()
def mods(ctx: typer.Context) -> None:
    """Declared mods + freshness state."""
    opts = _opts(ctx)
    try:
        context = load_context(_config_path(ctx))
        result = run_mods_check(context)
    except AxeError as e:
        render_error(command="mods", error=e, opts=opts)
        return

    report = result.report
    data = {
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
    }
    render_ok(
        command="mods",
        data=data,
        opts=opts,
        human=lambda: _print_mods(report, opts),
        warnings=list(result.warnings) if result.warnings else None,
    )
    if has_drift(report):
        raise typer.Exit(int(ExitCode.DRIFT))


def _print_mods(report: FreshnessReport, opts: OutputOptions) -> None:
    console = Console(no_color=not opts.color)
    if not report.items:
        console.print("[dim]no declared mods[/dim]")
        return
    for item in report.items:
        marker = _state_marker(item.state)
        title = item.title or "<unknown>"
        console.print(f"{marker}  {item.id}  [dim]{title}[/dim]")


def _state_marker(state: str) -> str:
    return {
        "current": "[green]ok[/green]   ",
        "stale": "[yellow]stale[/yellow]",
        "missing_local": "[red]miss[/red] ",
        "missing_remote": "[red]gone[/red] ",
        "unmanaged": "[dim]extra[/dim]",
    }.get(state, "[dim]?[/dim]    ")


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
    _stub(f"unit {target}", opts)


@server_app.command("up")
def server_up(ctx: typer.Context) -> None:
    """systemctl --user start <unit>"""
    _stub("server up", _opts(ctx))


@server_app.command("down")
def server_down(ctx: typer.Context) -> None:
    """systemctl --user stop <unit>"""
    _stub("server down", _opts(ctx))


@server_app.command("restart")
def server_restart(ctx: typer.Context) -> None:
    """systemctl --user restart <unit>"""
    _stub("server restart", _opts(ctx))


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
        return

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
        human=lambda: print(
            f"{unit_name}: {data['active_state']} ({data['sub_state']})"
        ),
    )


@logs_app.command("path")
def logs_path(ctx: typer.Context) -> None:
    """Path to the current Conan log."""
    _stub("logs path", _opts(ctx))


@logs_app.command("tail")
def logs_tail(
    ctx: typer.Context,
    lines: Annotated[int, typer.Option("--lines", "-n")] = 100,
    follow: Annotated[bool, typer.Option("--follow", "-f")] = False,
) -> None:
    """Last N lines of the current Conan log."""
    _ = (lines, follow)
    _stub("logs tail", _opts(ctx))
