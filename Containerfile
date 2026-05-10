# axe verification rig — minimal at PR0; grown as PRs land.
# PR0/PR1: just enough to run the compiled axe binary.
# PR2+:   add steamcmd and an ACF fixture in the named volume.
# PR3+:   real Conan install populates the named volume on first run.
FROM debian:bookworm-slim

RUN apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /work

# axe binary mounted at runtime: -v "$PWD/dist/axe:/work/axe:ro"
ENTRYPOINT ["/work/axe"]
