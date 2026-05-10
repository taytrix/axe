#!/usr/bin/env bash
# Stub steamcmd for tests. Mimics the side effects of a real steamcmd run
# without doing any network IO. Drives via argv pattern.
#
#   +force_install_dir <root> +login anonymous +app_update <appid> [validate] +quit
#     -> mkdir -p <root>/ConanSandbox/Binaries/Linux
#        touch + chmod +x ConanSandboxServer-Linux-Shipping
#
#   +force_install_dir <root> +login anonymous +workshop_download_item <appid> <id> ... +quit
#     -> for each <id>: mkdir -p <root>/steamapps/workshop/content/<appid>/<id>
#                        touch <id>.pak inside that dir
#
#   +app_info_print <appid> +quit
#     -> cat sample-app-info.txt (env: AXE_STUB_APP_INFO=path)
#
# Exits 0 on success. Stderr stays empty unless AXE_STUB_FAIL=<exit> is set.
set -u

if [[ -n "${AXE_STUB_FAIL:-}" ]]; then
  echo "stub: forced failure (AXE_STUB_FAIL=${AXE_STUB_FAIL})" >&2
  exit "${AXE_STUB_FAIL}"
fi

root=""
appid=""
validate=0
i=0
args=("$@")
n=${#args[@]}
declare -a workshop_ids=()

while (( i < n )); do
  arg="${args[$i]}"
  case "$arg" in
    +force_install_dir)
      i=$(( i + 1 ))
      root="${args[$i]}"
      ;;
    +login)
      i=$(( i + 1 ))
      ;;
    +app_update)
      i=$(( i + 1 ))
      appid="${args[$i]}"
      # peek for `validate` token
      if (( i + 1 < n )) && [[ "${args[$i + 1]}" == "validate" ]]; then
        validate=1
        i=$(( i + 1 ))
      fi
      if [[ -n "$root" && -n "$appid" ]]; then
        bindir="$root/ConanSandbox/Binaries/Linux"
        mkdir -p "$bindir"
        touch "$bindir/ConanSandboxServer-Linux-Shipping"
        chmod +x "$bindir/ConanSandboxServer-Linux-Shipping"
        if (( validate )); then
          echo "stub: validated $appid"
        else
          echo "stub: updated $appid"
        fi
      fi
      ;;
    +workshop_download_item)
      i=$(( i + 1 ))
      wsappid="${args[$i]}"
      i=$(( i + 1 ))
      wsid="${args[$i]}"
      workshop_ids+=("$wsappid:$wsid")
      ;;
    +app_info_print)
      i=$(( i + 1 ))
      info_appid="${args[$i]}"
      info_path="${AXE_STUB_APP_INFO:-}"
      if [[ -n "$info_path" && -f "$info_path" ]]; then
        cat "$info_path"
      else
        # minimal valid VDF block so parseAppInfo can find buildid
        cat <<EOF
"$info_appid"
{
	"depots"
	{
		"branches"
		{
			"public"
			{
				"buildid"	"99999"
			}
		}
	}
}
EOF
      fi
      ;;
    +quit)
      ;;
    *)
      ;;
  esac
  i=$(( i + 1 ))
done

# emit downloaded workshop items now (after we know root)
if [[ -n "$root" && ${#workshop_ids[@]} -gt 0 ]]; then
  for entry in "${workshop_ids[@]}"; do
    wsappid="${entry%%:*}"
    wsid="${entry##*:}"
    target="$root/steamapps/workshop/content/$wsappid/$wsid"
    mkdir -p "$target"
    touch "$target/$wsid.pak"
    echo "stub: downloaded $wsappid/$wsid"
  done
fi

exit 0
