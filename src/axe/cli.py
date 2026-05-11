"""Typer CLI surface: thin handlers that load context, call core, render via output."""

from __future__ import annotations

import subprocess
from collections.abc import Callable
from pathlib import Path
from typing import Annotated

import typer

from axe import __version__
from axe.config import Config, save_config
from axe.context import load_context
from axe.doctor import run_doctor
from axe.errors import AxeError, ExitCode
from axe.layout import layout_at
from axe.lifecycle import restart_server
from axe.logs import find_latest_log, follow_log, tail_lines
from axe.mod_edit import insert_mod, move_mod, remove_mod
from axe.mods import has_drift, run_mods_check
from axe.monitor import run_monitor_tick
from axe.output import (
    OutputOptions,
    busy,
    format_uptime,
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
from axe.state import load_state, state_path
from axe.status import _server_status_from_show, relative_age, status_from_saved
from axe.steamcmd import require_steamcmd_on_path
from axe.sync import run_sync
from axe.systemd import SystemctlVerb, systemctl_show, systemctl_verb
from axe.units import render_monitor_units, render_server_unit
from axe.update import run_update
from axe.validate import run_validate

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

mods_app = typer.Typer(
    help="Mod stack ops (list/add/move/rm).",
    no_args_is_help=False,
    invoke_without_command=True,
)
app.add_typer(mods_app, name="mods")

mods_add_app = typer.Typer(help="Insert a mod (top/bottom/above/below).", no_args_is_help=True)
mods_app.add_typer(mods_add_app, name="add")

mods_move_app = typer.Typer(help="Move a mod (top/bottom/above/below).", no_args_is_help=True)
mods_app.add_typer(mods_move_app, name="move")


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
def update(
    ctx: typer.Context,
    tag: Annotated[
        str | None,
        typer.Argument(help="Tag to install (default: latest python-v* from GitHub)"),
    ] = None,
) -> None:
    """Upgrade axe to the latest release (or to TAG). Assumes uv-tool install."""
    opts = _opts(ctx)
    try:
        outcome = run_update(target_tag=tag)
    except AxeError as e:
        render_error(command="update", error=e, opts=opts)
    target_version = outcome.target.removeprefix("python-v")
    if not outcome.upgraded:
        render_ok(
            command="update",
            data={
                "previous": outcome.previous,
                "target": outcome.target,
                "upgraded": False,
            },
            opts=opts,
            human=lambda: print(f"already at {target_version}; nothing to do"),
        )
        return
    render_ok(
        command="update",
        data={
            "previous": outcome.previous,
            "target": outcome.target,
            "upgraded": True,
            "command": outcome.command,
        },
        opts=opts,
        human=lambda: print(f"upgraded {outcome.previous} → {target_version}"),
    )


@app.command()
def init(
    ctx: typer.Context,
    path: Annotated[Path | None, typer.Argument(help="Server root (default: cwd)")] = None,
) -> None:
    """Write a starter axe.toml at PATH. Run `axe sync` afterwards to install the server."""
    opts = _opts(ctx)
    target_root = (path or Path.cwd()).resolve()
    _write_starter_toml(target_root, command="init", opts=opts)
    render_ok(
        command="init",
        data={
            "config_path": str(target_root / "axe.toml"),
            "root": str(target_root),
            "server_id": target_root.name or "conan",
        },
        opts=opts,
        human=lambda: print(
            f"wrote {target_root / 'axe.toml'} — run 'axe sync' to install the server"
        ),
    )


@app.command()
def install(
    ctx: typer.Context,
    path: Annotated[Path | None, typer.Argument(help="Server root (default: cwd)")] = None,
) -> None:
    """Cold-start: write axe.toml at PATH, then run steamcmd to install the server."""
    opts = _opts(ctx)
    target_root = (path or Path.cwd()).resolve()
    try:
        require_steamcmd_on_path()  # pre-flight; nothing touches disk if this fails
    except AxeError as e:
        render_error(command="install", error=e, opts=opts)
    _write_starter_toml(target_root, command="install", opts=opts)
    try:
        context = load_context(target_root / "axe.toml")
        outcome = run_sync(context)
        run_monitor_tick(context)  # populate state.json so `axe status` works
    except AxeError as e:
        render_error(command="install", error=e, opts=opts)
    render_ok(
        command="install",
        data={
            "config_path": str(target_root / "axe.toml"),
            "root": str(target_root),
            "base_build_updated": outcome.base_build_updated,
            "log_file": str(outcome.log_file) if outcome.log_file else None,
        },
        opts=opts,
        human=lambda: _print_install_complete(target_root, outcome.log_file),
        warnings=outcome.warnings,
    )


def _print_install_complete(root: Path, log: Path | None) -> None:
    print(f"installed at {root}" + (f" (log: {log})" if log else ""))
    print()
    print("next steps:")
    print(f"  cd {root}")
    print("  axe unit install        # wire systemd (server + monitor timer)")
    print("  axe mods add top <id>   # declare a mod, then `axe sync` to apply")
    print("  axe status              # what is true")


def _write_starter_toml(target_root: Path, *, command: str, opts: OutputOptions) -> None:
    target_toml = target_root / "axe.toml"
    if target_toml.exists():
        binary = layout_at(target_root).binary
        if binary.exists():
            msg = (
                f"axe.toml already exists at {target_toml}\n"
                "  install appears complete (server binary found)\n"
                "  run `axe status` to check, or `axe sync` to reconcile any drift"
            )
        else:
            msg = (
                f"axe.toml already exists at {target_toml}\n"
                f"  to complete an interrupted install: cd {target_root} && axe sync\n"
                f"  to start over:                      rm {target_toml}"
            )
        render_fail(
            command=command,
            code=ExitCode.FILESYSTEM,
            message=msg,
            opts=opts,
        )
    target_root.mkdir(parents=True, exist_ok=True)
    server_id = target_root.name or "conan"
    config = Config.model_validate(
        {"schema": 1, "server": {"id": server_id, "root": str(target_root)}}
    )
    try:
        save_config(config, target_toml)
    except AxeError as e:
        render_error(command=command, error=e, opts=opts)


@app.command()
def status(ctx: typer.Context) -> None:
    """Show what is true — reads state.json (offline). Run `axe monitor` to refresh."""
    opts = _opts(ctx)
    try:
        context = load_context(_config_path(ctx))
    except AxeError as e:
        render_error(command="status", error=e, opts=opts)

    saved = load_state(state_path(context.layout.root))
    if saved is None:
        render_fail(
            command="status",
            code=ExitCode.DISCOVERY,
            message=(
                f"no state.json at {state_path(context.layout.root)}\n"
                "  run `axe monitor` to populate it (or `axe sync` for a full reconcile)"
            ),
            opts=opts,
        )
    s = status_from_saved(saved, context)
    as_of = relative_age(saved.checked_at)
    render_ok(
        command="status",
        data=status_envelope(s, checked_at=saved.checked_at),
        opts=opts,
        human=lambda: print_status(s, opts, as_of=as_of),
        warnings=s.warnings,
    )
    if saved.drift:
        raise typer.Exit(int(ExitCode.DRIFT))


@app.command()
def sync(ctx: typer.Context) -> None:
    """Reconcile mods and base build in one cycle."""
    opts = _opts(ctx)
    try:
        context = load_context(_config_path(ctx))
        outcome = run_sync(context)
        run_monitor_tick(context)  # refresh state.json so `axe status` matches
    except AxeError as e:
        render_error(command="sync", error=e, opts=opts)

    render_ok(
        command="sync",
        data={
            "downloaded": outcome.downloaded,
            "missing": outcome.missing,
            "modlist_path": outcome.modlist_path,
            "modlist_changed": outcome.modlist_changed,
            "base_build_updated": outcome.base_build_updated,
            "log_file": str(outcome.log_file) if outcome.log_file else None,
        },
        opts=opts,
        human=lambda: print_sync(outcome, opts),
        warnings=outcome.warnings,
    )
    if outcome.missing:
        raise typer.Exit(int(ExitCode.DRIFT))


@app.command()
def doctor(ctx: typer.Context) -> None:
    """Walk the install and report each invariant: ✓ in order, ✗ needs attention."""
    opts = _opts(ctx)
    try:
        context = load_context(_config_path(ctx))
    except AxeError as e:
        render_error(command="doctor", error=e, opts=opts)
    report = run_doctor(context)
    data = {
        "all_ok": report.all_ok,
        "checks": [
            {"name": c.name, "ok": c.ok, "detail": c.detail} for c in report.checks
        ],
    }
    render_ok(
        command="doctor",
        data=data,
        opts=opts,
        human=lambda: _print_doctor(report),
    )
    if not report.all_ok:
        raise typer.Exit(int(ExitCode.DISCOVERY))


def _print_doctor(report) -> None:  # noqa: ANN001 — DoctorReport
    from rich.console import Console

    console = Console()
    for c in report.checks:
        mark = "[green]✓[/green]" if c.ok else "[red]✗[/red]"
        console.print(f"{mark} {c.name:24} [dim]{c.detail}[/dim]")


@app.command()
def validate(ctx: typer.Context) -> None:
    """Force `steamcmd +app_update 443030 validate` to re-verify the install."""
    opts = _opts(ctx)
    try:
        context = load_context(_config_path(ctx))
        outcome = run_validate(context)
    except AxeError as e:
        render_error(command="validate", error=e, opts=opts)
    render_ok(
        command="validate",
        data={
            "appid": outcome.appid,
            "log_file": str(outcome.log_file) if outcome.log_file else None,
        },
        opts=opts,
        human=lambda: print(
            f"validated app {outcome.appid}"
            + (f" (log: {outcome.log_file})" if outcome.log_file else "")
        ),
        warnings=outcome.warnings,
    )


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


@mods_app.callback()
def mods_callback(ctx: typer.Context) -> None:
    """`axe mods` with no subcommand defaults to `axe mods list`."""
    if ctx.invoked_subcommand is None:
        _mods_list(ctx)


@mods_app.command("list")
def mods_list(ctx: typer.Context) -> None:
    """Show the declared mod stack with ordinals + freshness state."""
    _mods_list(ctx)


def _mods_list(ctx: typer.Context) -> None:
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
                    "ordinal": ordinal,
                    "id": item.id,
                    "state": item.state,
                    "title": item.title,
                    "local_manifest": item.local_manifest,
                    "latest_manifest": item.latest_manifest,
                    "local_time_updated": item.local_time_updated,
                    "latest_time_updated": item.latest_time_updated,
                }
                for ordinal, item in enumerate(report.items, start=1)
            ],
        },
        opts=opts,
        human=lambda: print_mods(report, opts, root_label=context.layout.root.name),
        warnings=result.warnings,
    )
    if has_drift(report):
        raise typer.Exit(int(ExitCode.DRIFT))


def _do_mods_edit(
    ctx: typer.Context,
    command: str,
    edit: Callable[[Path], list[int]],
) -> None:
    opts = _opts(ctx)
    try:
        context = load_context(_config_path(ctx))
        new_ids = edit(context.config_path)
    except AxeError as e:
        render_error(command=command, error=e, opts=opts)
    render_ok(
        command=command,
        data={"ids": new_ids, "config_path": str(context.config_path)},
        opts=opts,
        human=lambda: print(
            f"{command}: {len(new_ids)} mods declared — run 'axe sync' to apply"
        ),
    )


@mods_add_app.command("top")
def mods_add_top(
    ctx: typer.Context,
    mod_id: Annotated[int, typer.Argument(help="Workshop id to insert at the top.")],
) -> None:
    """Prepend MOD_ID to the stack."""
    _do_mods_edit(ctx, "mods add top", lambda p: insert_mod(p, mod_id, "top"))


@mods_add_app.command("bottom")
def mods_add_bottom(
    ctx: typer.Context,
    mod_id: Annotated[int, typer.Argument(help="Workshop id to insert at the bottom.")],
) -> None:
    """Append MOD_ID to the stack."""
    _do_mods_edit(ctx, "mods add bottom", lambda p: insert_mod(p, mod_id, "bottom"))


@mods_add_app.command("above")
def mods_add_above(
    ctx: typer.Context,
    ordinal: Annotated[int, typer.Argument(help="1-indexed reference ordinal.")],
    mod_id: Annotated[int, typer.Argument(help="Workshop id to insert.")],
) -> None:
    """Insert MOD_ID above the entry at ORDINAL."""
    _do_mods_edit(
        ctx, "mods add above", lambda p: insert_mod(p, mod_id, "above", anchor=ordinal)
    )


@mods_add_app.command("below")
def mods_add_below(
    ctx: typer.Context,
    ordinal: Annotated[int, typer.Argument(help="1-indexed reference ordinal.")],
    mod_id: Annotated[int, typer.Argument(help="Workshop id to insert.")],
) -> None:
    """Insert MOD_ID below the entry at ORDINAL."""
    _do_mods_edit(
        ctx, "mods add below", lambda p: insert_mod(p, mod_id, "below", anchor=ordinal)
    )


@mods_move_app.command("top")
def mods_move_top(
    ctx: typer.Context,
    mod_id: Annotated[int, typer.Argument(help="Workshop id of the mod to move.")],
) -> None:
    """Move MOD_ID to the top of the stack."""
    _do_mods_edit(ctx, "mods move top", lambda p: move_mod(p, mod_id, "top"))


@mods_move_app.command("bottom")
def mods_move_bottom(
    ctx: typer.Context,
    mod_id: Annotated[int, typer.Argument(help="Workshop id of the mod to move.")],
) -> None:
    """Move MOD_ID to the bottom of the stack."""
    _do_mods_edit(ctx, "mods move bottom", lambda p: move_mod(p, mod_id, "bottom"))


@mods_move_app.command("above")
def mods_move_above(
    ctx: typer.Context,
    ordinal: Annotated[int, typer.Argument(help="1-indexed reference ordinal.")],
    mod_id: Annotated[int, typer.Argument(help="Workshop id of the mod to move.")],
) -> None:
    """Move MOD_ID above the entry at ORDINAL."""
    _do_mods_edit(
        ctx, "mods move above", lambda p: move_mod(p, mod_id, "above", anchor=ordinal)
    )


@mods_move_app.command("below")
def mods_move_below(
    ctx: typer.Context,
    ordinal: Annotated[int, typer.Argument(help="1-indexed reference ordinal.")],
    mod_id: Annotated[int, typer.Argument(help="Workshop id of the mod to move.")],
) -> None:
    """Move MOD_ID below the entry at ORDINAL."""
    _do_mods_edit(
        ctx, "mods move below", lambda p: move_mod(p, mod_id, "below", anchor=ordinal)
    )


@mods_app.command("rm")
def mods_rm(
    ctx: typer.Context,
    mod_id: Annotated[int, typer.Argument(help="Workshop id of the mod to remove.")],
) -> None:
    """Remove MOD_ID from the stack."""
    _do_mods_edit(ctx, "mods rm", lambda p: remove_mod(p, mod_id))


unit_app = typer.Typer(
    help="Systemd unit text + installation.",
    no_args_is_help=False,
    invoke_without_command=True,
)
app.add_typer(unit_app, name="unit")


@unit_app.callback()
def unit_callback(ctx: typer.Context) -> None:
    """`axe unit` (no subcommand) prints the server unit text."""
    if ctx.invoked_subcommand is None:
        _unit_print(ctx, "server")


@unit_app.command("server")
def unit_server_cmd(ctx: typer.Context) -> None:
    """Print the server systemd unit text."""
    _unit_print(ctx, "server")


@unit_app.command("monitor")
def unit_monitor_cmd(ctx: typer.Context) -> None:
    """Print the monitor service + timer pair."""
    _unit_print(ctx, "monitor")


@unit_app.command("install")
def unit_install_cmd(
    ctx: typer.Context,
    target: Annotated[
        str,
        typer.Argument(help="server | monitor | all"),
    ] = "all",
) -> None:
    """Write systemd unit files into ~/.config/systemd/user/ and reload."""
    opts = _opts(ctx)
    if target not in {"server", "monitor", "all"}:
        render_fail(
            command="unit install",
            code=ExitCode.MISUSE,
            message=f"target must be 'server' | 'monitor' | 'all'; got {target!r}",
            opts=opts,
        )
    try:
        context = load_context(_config_path(ctx))
    except AxeError as e:
        render_error(command="unit install", error=e, opts=opts)

    user_dir = Path.home() / ".config" / "systemd" / "user"
    user_dir.mkdir(parents=True, exist_ok=True)
    written: list[Path] = []
    if target in {"server", "all"}:
        unit_name = context.config.effective_unit()
        text = render_server_unit(context.config, context.layout)
        path = user_dir / unit_name
        path.write_text(text)
        written.append(path)
    if target in {"monitor", "all"}:
        base = context.config.effective_unit().removesuffix(".service")
        units = render_monitor_units(context.config, context.config_path)
        svc = user_dir / f"{base}-monitor.service"
        tmr = user_dir / f"{base}-monitor.timer"
        svc.write_text(units.service)
        tmr.write_text(units.timer)
        written.extend([svc, tmr])

    reload_warning: str | None = None
    try:
        subprocess.run(
            ["systemctl", "--user", "daemon-reload"],
            check=True,
            capture_output=True,
            text=True,
            timeout=10,
        )
    except (FileNotFoundError, subprocess.SubprocessError) as e:
        reload_warning = f"daemon-reload failed: {e}; run manually"

    render_ok(
        command="unit install",
        data={"target": target, "written": [str(p) for p in written]},
        opts=opts,
        human=lambda: _print_unit_install_done(written, target),
        warnings=[reload_warning] if reload_warning else None,
    )


def _print_unit_install_done(written: list[Path], target: str) -> None:
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


def _unit_print(ctx: typer.Context, target: str) -> None:
    opts = _opts(ctx)
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


_VERB_NARRATION: dict[str, str] = {
    "start": "Starting {unit}...",
    "stop": "Stopping {unit} (Conan typically takes ~60s to clean up)...",
    "restart": "Restarting {unit} (this can take up to ~90s)...",
}


def _server_lifecycle(ctx: typer.Context, verb: SystemctlVerb, command: str) -> None:
    opts = _opts(ctx)
    try:
        context = load_context(_config_path(ctx))
        unit = context.config.effective_unit()
        narration = _VERB_NARRATION.get(verb, f"{verb} {{unit}}...").format(unit=unit)
        with busy(narration, opts):
            result = systemctl_verb(unit, verb)
    except AxeError as e:
        if _looks_like_unit_not_found(e.message):
            render_fail(
                command=command,
                code=ExitCode.DISCOVERY,
                message=(
                    f"{e.message}\n"
                    "  run `axe unit install` to write the unit file, then retry"
                ),
                opts=opts,
            )
        render_error(command=command, error=e, opts=opts)
    render_ok(
        command=command,
        data={"unit": result.unit, "verb": result.verb},
        opts=opts,
        human=lambda: print(f"{result.verb} {result.unit}: ok"),
    )


def _looks_like_unit_not_found(message: str) -> bool:
    needle = message.lower()
    return "unit" in needle and ("not found" in needle or "not loaded" in needle)


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
    """systemctl --user restart <unit> wrapped with before_/after_restart hooks."""
    opts = _opts(ctx)
    try:
        context = load_context(_config_path(ctx))
        unit = context.config.effective_unit()
        narration = _VERB_NARRATION["restart"].format(unit=unit)
        with busy(narration, opts):
            outcome = restart_server(context)
    except AxeError as e:
        if _looks_like_unit_not_found(e.message):
            render_fail(
                command="server restart",
                code=ExitCode.DISCOVERY,
                message=(
                    f"{e.message}\n"
                    "  run `axe unit install` to write the unit file, then retry"
                ),
                opts=opts,
            )
        render_error(command="server restart", error=e, opts=opts)
    render_ok(
        command="server restart",
        data={
            "unit": outcome.unit,
            "verb": "restart",
            "old_pid": outcome.old_pid,
            "new_pid": outcome.new_pid,
        },
        opts=opts,
        human=lambda: print(f"restart {outcome.unit}: ok"),
        warnings=outcome.warnings,
    )


@server_app.command("status")
def server_status(ctx: typer.Context) -> None:
    """Live systemctl status for the server unit (matches `axe status.server`)."""
    opts = _opts(ctx)
    try:
        context = load_context(_config_path(ctx))
        unit_name = context.config.effective_unit()
        show = systemctl_show(unit_name)
    except AxeError as e:
        if _looks_like_unit_not_found(e.message):
            render_fail(
                command="server status",
                code=ExitCode.DISCOVERY,
                message=(
                    f"{e.message}\n"
                    "  run `axe unit install` to write the unit file, then retry"
                ),
                opts=opts,
            )
        render_error(command="server status", error=e, opts=opts)
    server = _server_status_from_show(unit_name, show)
    data = {
        "unit": server.unit,
        "active_state": server.active_state,
        "sub_state": server.sub_state,
        "main_pid": server.main_pid,
        "uptime_seconds": server.uptime_seconds,
    }
    render_ok(
        command="server status",
        data=data,
        opts=opts,
        human=lambda: _print_server_status_line(server),
    )


def _print_server_status_line(server) -> None:  # noqa: ANN001 — ServerStatus dataclass
    """One-line summary; matches the `server` section of `axe status`."""
    bits = [server.unit, f"{server.active_state} ({server.sub_state})"]
    if server.main_pid is not None:
        bits.append(f"pid {server.main_pid}")
    if server.uptime_seconds is not None and server.active_state == "active":
        bits.append(f"up {format_uptime(server.uptime_seconds)}")
    print(" — ".join(bits))


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
