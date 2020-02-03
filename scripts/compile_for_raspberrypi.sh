#!/usr/bin/env bash
set -eo pipefail

DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" >/dev/null 2>&1 && pwd )"

cd $DIR
docker run --rm --privileged multiarch/qemu-user-static --reset -p yes
docker build . --file ./Dockerfile_crossarch --tag multiarch

docker run -t --rm --workdir /workspace -v `realpath ../`:/workspace multiarch bash -c "yarn && yarn run electron-builder --linux AppImage --armv7l"