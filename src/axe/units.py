from __future__ import annotations

import sys
from dataclasses import dataclass
from pathlib import Path

from axe.config import Config
from axe.layout import Layout


@dataclass(frozen=True)
class MonitorUnits:
    service: str
    timer: str


def render_server_unit(config: Config, layout: Layout) -> str:
    unit_name = config.effective_unit()
    base_name = unit_name.removesuffix(".service")
    return (
        "# axe-generated systemd user unit\n"
        f"# install: ~/.config/systemd/user/{unit_name}\n"
        f"# enable:  systemctl --user enable --now {base_name}\n"
        "# survive reboot without login: loginctl enable-linger $USER\n"
        "\n"
        "[Unit]\n"
        "Description=Conan Exiles dedicated server (via axe)\n"
        "After=network-online.target\n"
        "Wants=network-online.target\n"
        "\n"
        "[Service]\n"
        "Type=simple\n"
        f"ExecStart={layout.binary} ConanSandbox -log\n"
        f"WorkingDirectory={layout.root}\n"
        "Restart=on-failure\n"
        "RestartSec=10\n"
        "\n"
        "[Install]\n"
        "WantedBy=default.target\n"
    )


def render_monitor_units(
    config: Config,
    config_path: Path,
    *,
    axe_path: str | None = None,
) -> MonitorUnits:
    axe = axe_path or _resolve_axe_path()
    base_name = config.effective_unit().removesuffix(".service")
    monitor_name = f"{base_name}-monitor"
    service = (
        f"# {monitor_name}.service\n"
        "[Unit]\n"
        "Description=axe drift sensor for Conan Exiles\n"
        "After=network-online.target\n"
        "\n"
        "[Service]\n"
        "Type=oneshot\n"
        f"ExecStart={axe} --config {config_path} monitor\n"
    )
    timer = (
        f"# {monitor_name}.timer\n"
        "[Unit]\n"
        "Description=axe drift sensor timer\n"
        "\n"
        "[Timer]\n"
        "OnBootSec=2min\n"
        "OnUnitActiveSec=5min\n"
        f"Unit={monitor_name}.service\n"
        "\n"
        "[Install]\n"
        "WantedBy=timers.target\n"
    )
    return MonitorUnits(service=service, timer=timer)


def _resolve_axe_path() -> str:
    return str(Path(sys.argv[0]).resolve())
