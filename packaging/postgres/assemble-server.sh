#!/bin/sh
# Source-owned PostgreSQL server and standard contrib, with only pinned static
# OpenSSL/zlib above the OS runtime. Never replaces an existing runtime tree.
set -eu
[ "$#" -eq 1 ] || { echo 'usage: assemble-server.sh EMPTY_POSTGRES_DESTINATION' >&2; exit 1; }
root=$(CDPATH= cd -- "$(dirname "$0")/../.." && pwd)
node_bin=$(command -v node)
case "$(uname -s):$(uname -m)" in
  Darwin:arm64) platform=darwin-arm64; export MACOSX_DEPLOYMENT_TARGET=12.0 ;;
  Linux:x86_64) platform=linux-x64 ;;
  MINGW64_NT*:x86_64) platform=win32-x64 ;;
  *) echo 'unsupported source-owned PostgreSQL build host' >&2; exit 1 ;;
esac
if [ "$platform" != win32-x64 ]; then
  PATH=/usr/bin:/bin:/usr/sbin:/sbin
  export PATH
fi
mkdir -p "$1"
destination=$(CDPATH= cd -- "$1" && pwd)
[ -z "$(find "$destination" -mindepth 1 -maxdepth 1 -print -quit)" ] || { echo 'server destination must be empty' >&2; exit 1; }
work=$(mktemp -d "${POSTGRES_SERVER_BUILD_ROOT:-${TMPDIR:-/tmp}}/postgres-source-build.XXXXXX")
trap 'rm -rf "$work"' EXIT HUP INT TERM
cache=${POSTGRES_SOURCE_CACHE:-}
fetch() {
  name=$1; url=$2; sha=$3
  if [ -n "$cache" ] && [ -f "$cache/$name" ]; then
    cp "$cache/$name" "$work/$name"
  else
    curl -fL --max-time 180 --max-filesize 60000000 -o "$work/$name" "$url"
  fi
  if [ "$platform" = darwin-arm64 ]; then
    printf '%s  %s\n' "$sha" "$work/$name" | shasum -a 256 -c -
  else
    printf '%s  %s\n' "$sha" "$work/$name" | sha256sum -c -
  fi
}
fetch postgresql-16.15.tar.bz2 https://ftp.postgresql.org/pub/source/v16.15/postgresql-16.15.tar.bz2 c1575341fa7bd40f5274ea465b34390f4dc64cdd0770af327005caaeb9f6b7ed
fetch zlib-1.3.1.tar.gz https://zlib.net/fossils/zlib-1.3.1.tar.gz 9a93b2b7dfdac77ceba5a558a580e74667dd6fede4585b91eefb60f03b72df23
fetch openssl-3.5.9.tar.gz https://github.com/openssl/openssl/releases/download/openssl-3.5.9/openssl-3.5.9.tar.gz 603f5602e2eef00d77fbd429d34dcd5822bb301757a1bc9cdb24c670f1eb859a
tar -xjf "$work/postgresql-16.15.tar.bz2" -C "$work"
tar -xzf "$work/zlib-1.3.1.tar.gz" -C "$work"
tar -xzf "$work/openssl-3.5.9.tar.gz" -C "$work"
unset CPPFLAGS CFLAGS CXXFLAGS LDFLAGS LIBS CPATH C_INCLUDE_PATH CPLUS_INCLUDE_PATH LIBRARY_PATH LD_LIBRARY_PATH DYLD_LIBRARY_PATH PKG_CONFIG_PATH PKG_CONFIG_LIBDIR
export CC=cc
export CFLAGS='-O2 -fPIC'
case "$platform" in
  darwin-arm64) openssl_target=darwin64-arm64; rpath_option=--disable-rpath ;;
  linux-x64) openssl_target=linux-x86_64; rpath_option=--enable-rpath; export LDFLAGS=-static-libgcc ;;
  win32-x64)
    openssl_target=mingw64; rpath_option=--disable-rpath
    export CC=gcc CFLAGS=-O2 LDFLAGS='-static -static-libgcc'
    ;;
esac
# pkg-config must never select Homebrew or unrelated host library metadata.
export PKG_CONFIG_LIBDIR="$work/deps/lib/pkgconfig"
export PKG_CONFIG_PATH="$PKG_CONFIG_LIBDIR"
deps=$work/deps
jobs=${POSTGRES_BUILD_JOBS:-2}
case "$jobs" in 1|2|3|4) ;; *) echo 'POSTGRES_BUILD_JOBS must be 1..4' >&2; exit 1 ;; esac
(
  cd "$work/zlib-1.3.1"
  ./configure --static --prefix="$deps"
  make -j"$jobs"
  make install
)
(
  cd "$work/openssl-3.5.9"
  ./Configure "$openssl_target" no-shared no-module no-tests no-atexit no-thread-pool no-quic --prefix="$deps" --openssldir="$deps/ssl" --libdir=lib
  make -j"$jobs"
  make install_sw
)
# Preserve the actual private OS linker libraries declared by this exact static
# OpenSSL build. This avoids guessing MinGW dependencies or using host pkg-config.
crypto_libs=
while IFS= read -r line; do
  case "$line" in 'Libs.private:'*) crypto_libs=${line#Libs.private:} ;; esac
done < "$deps/lib/pkgconfig/libcrypto.pc"
export LIBS=$crypto_libs
(
  cd "$work/postgresql-16.15"
  ./configure --prefix="$destination" "$rpath_option" --disable-nls \
    --without-readline --without-icu --without-libxml --without-libxslt \
    --without-ldap --without-gssapi --without-pam --without-bonjour \
    --without-lz4 --without-zstd --with-openssl \
    --with-includes="$deps/include" --with-libraries="$deps/lib"
  pg_make() {
    if [ "$platform" = linux-x64 ]; then
      # Upstream Makefile.linux single-quotes rpathdir at the final linker call.
      # Double dollars survive GNU make and remain literal loader $ORIGIN.
      # Static libpq also keeps installed PGXS helpers independent of loader
      # paths several levels beneath lib/. Standard ECPG libraries stay intact.
      make "$@" "libpq=$work/postgresql-16.15/src/interfaces/libpq/libpq.a" "rpathdir=\$\$ORIGIN:\$\$ORIGIN/../lib" "pkglibdir=$destination/lib" "datadir=$destination/share"
    else
      make "$@" "pkglibdir=$destination/lib" "datadir=$destination/share"
    fi
  }
  pg_make -j"$jobs"
  pg_make install
  pg_make -j"$jobs" -C contrib
  pg_make -C contrib install
)
mkdir -p "$destination/source-archives" "$destination/build-provenance"
cp "$work/postgresql-16.15.tar.bz2" "$work/zlib-1.3.1.tar.gz" "$work/openssl-3.5.9.tar.gz" "$destination/source-archives/"
cp "$work/postgresql-16.15/COPYRIGHT" "$destination/POSTGRESQL_LICENSE.txt"
cp "$work/zlib-1.3.1/LICENSE" "$destination/ZLIB_LICENSE.txt"
cp "$work/openssl-3.5.9/LICENSE.txt" "$destination/OPENSSL_LICENSE.txt"
cp "$work/postgresql-16.15/config.log" "$destination/build-provenance/postgresql-config.log"
cp "$work/postgresql-16.15/src/Makefile.global" "$destination/build-provenance/postgresql-Makefile.global"
cp "$work/openssl-3.5.9/configdata.pm" "$destination/build-provenance/openssl-configdata.pm"
cp "$root/packaging/postgres/assemble-server.sh" "$destination/build-provenance/assemble-server.sh"
# Native dependency inspection, relocation (Darwin only), and file/source proof
# are recorded by the shared finalizer. It never runs a server or SQL.
"$node_bin" --input-type=module - "$root" "$destination" "$platform" <<'JS'
import { pathToFileURL } from 'node:url';
import { join } from 'node:path';
const [root, destination, platform] = process.argv.slice(2);
const { recordPostgresServerBuild } = await import(pathToFileURL(join(root, 'packaging/postgres/collect-notices.mjs')));
recordPostgresServerBuild(destination, platform);
JS
printf 'source-owned PostgreSQL 16.15 staged in %s\n' "$destination"
