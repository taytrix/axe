# axe verification rig — minimal at PR0; grown as PRs land.
# PR0/PR1: just enough to run the compiled axe binary.
# PR2+:   add steamcmd and an ACF fixture in the named volume.
# PR3+:   real Conan install populates the named volume on first run.
FROM debian:bookworm-slim

RUN dpkg --add-architecture i386 \
 && apt-get update \
 && apt-get install -y --no-install-recommends \
      ca-certificates \
      curl \
      lib32gcc-s1 \
      libstdc++6:i386 \
 && rm -rf /var/lib/apt/lists/*

# steamcmd lives at /opt/steamcmd; first run from this dir downloads its
# self-update payload and login modules into the same dir.
RUN mkdir -p /opt/steamcmd \
 && cd /opt/steamcmd \
 && curl -fsSL https://steamcdn-a.akamaihd.net/client/installer/steamcmd_linux.tar.gz \
    | tar -xz

WORKDIR /work

# axe binary mounted at runtime: -v "$PWD/dist/axe:/work/axe:ro"
# axe.toml typically points [steamcmd].binary at /opt/steamcmd/steamcmd.sh
ENTRYPOINT ["/work/axe"]
