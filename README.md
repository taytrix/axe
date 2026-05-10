# axe

A smol Linux cockpit for one Conan Exiles Enhanced server root.

```
systemd        owns lifecycle
SteamCMD       owns Steam ops
the operator   owns policy
shell hooks    own custom behavior
axe            owns the Conan / Workshop / Steam understanding layer
```

## Install

```
uv tool install --from git+https://github.com/taytrix/axe@python-v0.2.0 axe
```

## Quickstart

```
# 1. probe a Conan install, write axe.toml
axe init ~/conan

# 2. install the systemd user units (server + drift-sensor timer)
axe unit         > ~/.config/systemd/user/axe-conan.service
axe unit monitor                                       # prints .service + .timer pair
# split the pair and tee each half into ~/.config/systemd/user/

systemctl --user daemon-reload
systemctl --user enable --now axe-conan
systemctl --user enable --now axe-conan-monitor.timer
loginctl enable-linger $USER

# 3. see what is true
axe status

# 4. reconcile any drift (mods + base build) in one cycle
axe sync
```

## `axe.toml` shape

```toml
schema = 1

[server]
id = "conan"
root = "/home/tay/conan"

[steamcmd]
binary = "/usr/bin/steamcmd"      # optional; falls back to PATH

[mods]
ids = [880454836, 1159180273]

[hooks]
on_drift       = ""
before_sync    = ""
after_sync     = ""
before_restart = ""
after_restart  = ""

[hooks.strict]                    # non-zero exit aborts the verb
before_sync    = false
before_restart = false
```

Hooks receive `AXE_ROOT`, `AXE_STATE`, `AXE_EVENT`, and event-specific
`AXE_MODS_*` / `AXE_BUILD_*` / `AXE_SYNC_*` / `AXE_RESTART_*` env vars.
Native verbs for backup / discord / rcon are explicitly refused — those
are hook scripts you write.

## Philosophy

Drift is one concept: if a Steam-updated client can't connect, the cause is
mods OR base build, and the fix is the same cycle. Beyond that, the code
tree is the marketing — 20 small files named after real thoughts; no
`managers/`, `services/`, or `framework/` directories.
