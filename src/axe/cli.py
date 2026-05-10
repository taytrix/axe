from __future__ import annotations

from pathlib import Path
from typing import Annotated

import typer
from rich.console import Console

from axe import __version__
from axe.errors import ExitCode
from axe.output import OutputOptions, read_output_options, render_fail, render_ok

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
    path: Annotated[Path | None, typer.Argument()] = None,
) -> None:
    """Bootstrap a starter axe.toml at PATH (default cwd)."""
    _ = path
    _stub("init", _opts(ctx))


@app.command()
def status(ctx: typer.Context) -> None:
    """Show what is true."""
    _stub("status", _opts(ctx))


@app.command()
def sync(ctx: typer.Context) -> None:
    """Reconcile mods and modlist."""
    _stub("sync", _opts(ctx))


@app.command()
def monitor(ctx: typer.Context) -> None:
    """One tick: read status, write state.json, fire on_drift if needed."""
    _stub("monitor", _opts(ctx))


@app.command()
def mods(ctx: typer.Context) -> None:
    """Declared mods + freshness state."""
    _stub("mods", _opts(ctx))


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
    _stub("server status", _opts(ctx))


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
