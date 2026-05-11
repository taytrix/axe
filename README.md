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
uv tool install --from git+https://github.com/taytrix/axe@python-v0.3.1 axe
```

## Quickstart

```
# 1. cold-start: writes axe.toml AND runs steamcmd to install the dedicated server
axe install ~/conan
cd ~/conan

# 2. declare some mods (stack ops; ordinals are 1-indexed)
axe mods add top    880454836         # prepend
axe mods add bottom 1159180273        # append
axe mods                              # list with freshness state
axe mods move above 1 1159180273      # reorder

# 3. reconcile any drift (mods + base build) in one cycle
axe sync

# 4. see what is true
axe status

# 5. (later) force a steam integrity-check pass
axe validate

# 6. (optional) wire systemd so the server auto-starts and drift detection runs
axe unit         > ~/.config/systemd/user/axe-conan.service
axe unit monitor                                       # prints .service + .timer pair
# split the pair and tee each half into ~/.config/systemd/user/
systemctl --user daemon-reload
systemctl --user enable --now axe-conan
systemctl --user enable --now axe-conan-monitor.timer
loginctl enable-linger $USER
```

axe finds `axe.toml` by walking up from the current directory (git-style), so
after the initial `cd ~/conan` you never type `--config`. Pin a specific
install across shells with `export AXE_ROOT=~/conan`.

If you want metadata-only (write `axe.toml` but don't run steamcmd yet),
use `axe init ~/conan` and `axe sync` afterwards. `axe install` is the
sugar for both.

## `axe mods` verbs

The mod list is a stack. Insertions are relative; ordinals are read from
`axe mods list`.

```
axe mods                              # default: list
axe mods list                         # explicit list

axe mods add top    <id>              # prepend
axe mods add bottom <id>              # append
axe mods add above  <ord> <id>        # insert above the entry at <ord>
axe mods add below  <ord> <id>        # insert below the entry at <ord>

axe mods move top    <id>             # move named id to the top
axe mods move bottom <id>             # move to the bottom
axe mods move above  <ord> <id>       # move above the entry at <ord>
axe mods move below  <ord> <id>       # move below the entry at <ord>

axe mods rm <id>                      # remove by id
```

Mutations write `axe.toml` (comments preserved via tomlkit) but do not
auto-sync. Run `axe sync` to apply your changes.

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

See [hooks/examples/](hooks/examples/) in the repo for blessed scripts:
`backup.sh`, `discord-notify.sh`, `modlist-snapshot.sh`,
`rcon-broadcast.sh`, and a README documenting the full AXE_* env table.

## What `axe status` reports

```
axe / conan
root         /home/tay/conan

server
  unit         axe-conan.service
  active       active
  sub          running
  pid          12345
  uptime       3h 20m
  name         "Tay's Conan Server"
  rcon         port 25575 (enabled)
  max_players  40

build
  installed    99999
  latest       99999
  state        current

mods
  declared     3
  current      3
  stale        0
  missing      0
```

Mods/build/server-name/rcon/max-players come straight from your install —
no extra configuration. ServerSettings.ini is parsed for display only;
passwords surface as presence flags, never values.

## Philosophy

Drift is one concept: if a Steam-updated client can't connect, the cause is
mods OR base build, and the fix is the same cycle. Beyond that, the code
tree is the marketing — 25 small files named after real thoughts; no
`managers/`, `services/`, or `framework/` directories.
