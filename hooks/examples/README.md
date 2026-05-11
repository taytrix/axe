# axe hooks: examples

These are *blessed scripts*, not Python plugins. axe's hook story is
unix-shaped: `axe.toml` names a shell command per lifecycle event, axe
runs it with a deterministic AXE_* env, and your script does the work.

Copy the script you want into `<server-root>/hooks/`, point at it from
`axe.toml`, and you're done. Edit freely.

## Wiring

```toml
[hooks]
on_drift       = "/home/tay/conan/hooks/discord-notify.sh"
before_sync    = "/home/tay/conan/hooks/backup.sh"
after_sync     = "/home/tay/conan/hooks/modlist-snapshot.sh"
before_restart = "/home/tay/conan/hooks/rcon-broadcast.sh"
after_restart  = ""

[hooks.strict]      # non-zero exit aborts the verb
before_sync    = true
before_restart = true
```

Strict-mode hooks abort the verb on non-zero exit. Non-strict hooks log
the failure as a warning and continue. Default is non-strict.

## AXE_* env contract

axe sets these for every hook:

| Variable     | Value                                       | Notes                       |
|--------------|---------------------------------------------|-----------------------------|
| `AXE_ROOT`   | absolute path to the server root            | always                      |
| `AXE_STATE`  | absolute path to `<root>/.axe/state.json`   | always                      |
| `AXE_EVENT`  | the event name                              | `drift` \| `before_sync` \| `after_sync` \| `before_restart` \| `after_restart` |

For sync + drift events, axe adds the mods + base-build axes:

| Variable                  | Value                                  |
|---------------------------|----------------------------------------|
| `AXE_MODS_STALE`          | count of stale mods                    |
| `AXE_MODS_MISSING_LOCAL`  | count of declared-but-not-downloaded   |
| `AXE_MODS_MISSING_REMOTE` | count of declared-but-deleted-upstream |
| `AXE_BUILD_DRIFTED`       | `1` or `0`                             |
| `AXE_BUILD_INSTALLED`     | installed app build id (string)        |
| `AXE_BUILD_LATEST`        | latest app build id (string)           |

For `after_sync` only, axe also adds the outcome axis:

| Variable                     | Value                                  |
|------------------------------|----------------------------------------|
| `AXE_SYNC_DOWNLOADED`        | count of mods successfully downloaded  |
| `AXE_SYNC_MISSING`           | count of mods still missing after sync |
| `AXE_SYNC_MODLIST_CHANGED`   | `1` or `0`                             |

For restart events, axe surfaces the systemd PID transition:

| Variable               | Value                              |
|------------------------|------------------------------------|
| `AXE_RESTART_OLD_PID`  | pre-restart MainPID (omitted if unknown) |
| `AXE_RESTART_NEW_PID`  | post-restart MainPID (omitted if unknown; `after_restart` only) |

Scripts also inherit the calling user's full env, so things like
`PATH`, `HOME`, and any operator-set vars (e.g. `DISCORD_WEBHOOK_URL`)
are available.

## The scripts

| Script                  | Wire at         | What it does                                |
|-------------------------|-----------------|---------------------------------------------|
| `backup.sh`             | `before_sync`   | tar of `<root>/ConanSandbox/Saved/` with timestamp |
| `discord-notify.sh`     | `on_drift` / `after_sync` | POSTs a message to `DISCORD_WEBHOOK_URL` |
| `modlist-snapshot.sh`   | `before_sync`   | Copies `<root>/ConanSandbox/Mods/modlist.txt` to a timestamped backup |
| `rcon-broadcast.sh`     | `before_restart` | Broadcasts "restart in N" via an operator-supplied RCON binary |

Each script is self-contained and ~20-40 lines. Read before you wire.
