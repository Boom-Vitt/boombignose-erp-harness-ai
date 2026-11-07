#!/bin/sh
# Add PostgreSQL 16.15 clients to the matching embedded 16.15 server runtime.
# Build on the target host, statically linking our own libpq and pinned zlib.
# No Homebrew, system libpq, DLL overlay, client from PATH, or build-path rpath
# becomes a runtime dependency. SCRAM uses PostgreSQL's built-in crypto; these
# clients connect only to the local native server (no external TLS endpoint).
set -eu
case "$(uname -s):$(uname -m)" in
  Linux:x86_64) target=linux-x64; suffix= ;;
  Darwin:arm64) target=darwin-arm64; suffix=; export MACOSX_DEPLOYMENT_TARGET=12.0 ;;
  MINGW64_NT*:x86_64) target=win32-x64; suffix=.exe ;;
  *) echo "unsupported PostgreSQL client build host" >&2; exit 1 ;;
esac
if [ "$target" != win32-x64 ]; then
  PATH=/usr/bin:/bin:/usr/sbin:/sbin
  export PATH
fi
[ "$#" -ge 1 ] && [ "$#" -le 2 ] || { echo "usage: assemble-clients.sh POSTGRES_DIRECTORY [STATIC_PREFIX]" >&2; exit 1; }
mkdir -p "$1/bin"
destination=$(CDPATH= cd -- "$1" && pwd)
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT HUP INT TERM
# Optional reusable SDK: only our static archives, public headers, pg_config,
# source archives and provenance survive. Existing one-argument callers retain
# exactly the same clients and temporary-prefix lifetime.
static_prefix=
if [ "$#" -eq 2 ]; then
  mkdir -p "$2"
  static_prefix=$(CDPATH= cd -- "$2" && pwd)
fi
install_prefix=${static_prefix:-$tmp/client-install}
pg_url=https://ftp.postgresql.org/pub/source/v16.15/postgresql-16.15.tar.bz2
pg_sha=c1575341fa7bd40f5274ea465b34390f4dc64cdd0770af327005caaeb9f6b7ed
zlib_url=https://zlib.net/fossils/zlib-1.3.1.tar.gz
zlib_sha=9a93b2b7dfdac77ceba5a558a580e74667dd6fede4585b91eefb60f03b72df23
verify() {
  if [ "$target" = darwin-arm64 ]; then
    printf '%s  %s\n' "$2" "$1" | shasum -a 256 -c -
  else
    printf '%s  %s\n' "$2" "$1" | sha256sum -c -
  fi
}
digest() {
  if [ "$target" = darwin-arm64 ]; then
    shasum -a 256 "$1" | cut -d ' ' -f 1
  else
    sha256sum "$1" | cut -d ' ' -f 1
  fi
}
curl -fsSL --retry 3 --connect-timeout 30 --max-time 600 -o "$tmp/postgresql.tar.bz2" "$pg_url"
verify "$tmp/postgresql.tar.bz2" "$pg_sha"
curl -fsSL --retry 3 --connect-timeout 30 --max-time 600 -o "$tmp/zlib.tar.gz" "$zlib_url"
verify "$tmp/zlib.tar.gz" "$zlib_sha"
tar -xjf "$tmp/postgresql.tar.bz2" -C "$tmp"
tar -xzf "$tmp/zlib.tar.gz" -C "$tmp"
# Ignore caller-supplied library/compiler search paths. The compiler itself is
# the native CI toolchain; everything above the OS C runtime is source-pinned.
unset CPPFLAGS CFLAGS CXXFLAGS LDFLAGS LIBS CPATH LIBRARY_PATH LD_LIBRARY_PATH DYLD_LIBRARY_PATH
export CC=cc
export CFLAGS=-O2
if [ "$target" = win32-x64 ]; then
  export CC=gcc
  export LDFLAGS='-static -static-libgcc'
fi
(
  cd "$tmp/zlib-1.3.1"
  ./configure --static --prefix="$tmp/client-deps"
  make -j2
  make install
)
(
  cd "$tmp/postgresql-16.15"
  ./configure --prefix="$install_prefix" --disable-rpath --disable-nls \
    --without-readline --without-icu --without-openssl --without-ldap \
    --without-gssapi --without-lz4 --without-zstd \
    --with-includes="$tmp/client-deps/include" --with-libraries="$tmp/client-deps/lib"
  # Client objects include generated catalog headers; finish their prerequisite
  # before parallel subdirectory compilation (upstream's local rule can race).
  make -C src/backend generated-headers
  # Override the upstream link variable with the archive itself, not -lpq,
  # which could select a shared libpq and accidentally capture a build path.
  make -j2 -C src/bin/psql "libpq=$tmp/postgresql-16.15/src/interfaces/libpq/libpq.a" psql
  make -j2 -C src/bin/pg_dump "libpq=$tmp/postgresql-16.15/src/interfaces/libpq/libpq.a" pg_dump pg_restore
)
cp "$tmp/postgresql-16.15/src/bin/psql/psql$suffix" "$destination/bin/psql$suffix"
cp "$tmp/postgresql-16.15/src/bin/pg_dump/pg_dump$suffix" "$destination/bin/pg_dump$suffix"
cp "$tmp/postgresql-16.15/src/bin/pg_dump/pg_restore$suffix" "$destination/bin/pg_restore$suffix"
chmod 755 "$destination/bin/psql$suffix" "$destination/bin/pg_dump$suffix" "$destination/bin/pg_restore$suffix"
cp "$tmp/postgresql-16.15/COPYRIGHT" "$destination/POSTGRESQL_CLIENT_LICENSE.txt"
cp "$tmp/zlib-1.3.1/LICENSE" "$destination/ZLIB_LICENSE.txt"
if [ -n "$static_prefix" ]; then
  mkdir -p "$static_prefix/lib/pkgconfig" "$static_prefix/include" "$static_prefix/bin" "$static_prefix/sources"
  # Upstream's static libpq deliberately leaves pgcommon/pgport unresolved.
  # Export one self-contained archive so consumers' ordinary -lpq probes and
  # links cannot accidentally use host libraries or omit SCRAM/encoding code.
  pq_archive=$tmp/postgresql-16.15/src/interfaces/libpq/libpq.a
  common_archive=$tmp/postgresql-16.15/src/common/libpgcommon_shlib.a
  port_archive=$tmp/postgresql-16.15/src/port/libpgport_shlib.a
  if [ "$target" = darwin-arm64 ]; then
    libtool -static -o "$static_prefix/lib/libpq.a" "$pq_archive" "$common_archive" "$port_archive"
  else
    ar -M << EOF
CREATE $static_prefix/lib/libpq.a
ADDLIB $pq_archive
ADDLIB $common_archive
ADDLIB $port_archive
SAVE
END
EOF
  fi
  cp "$tmp/client-deps/lib/libz.a" "$static_prefix/lib/"
  cp "$tmp/client-deps/include/zlib.h" "$tmp/client-deps/include/zconf.h" "$static_prefix/include/"
  for header in libpq-fe.h libpq-events.h; do
    cp "$tmp/postgresql-16.15/src/interfaces/libpq/$header" "$static_prefix/include/"
  done
  mkdir -p "$static_prefix/include/libpq"
  cp "$tmp/postgresql-16.15/src/include/libpq/libpq-fs.h" "$static_prefix/include/libpq/"
  for header in postgres_ext.h pg_config_ext.h pg_config.h pg_config_os.h; do
    cp "$tmp/postgresql-16.15/src/include/$header" "$static_prefix/include/"
  done
  make -C "$tmp/postgresql-16.15/src/bin/pg_config" pg_config
  cp "$tmp/postgresql-16.15/src/bin/pg_config/pg_config$suffix" "$static_prefix/bin/"
  cp "$tmp/postgresql.tar.bz2" "$static_prefix/sources/postgresql-16.15.tar.bz2"
  cp "$tmp/zlib.tar.gz" "$static_prefix/sources/zlib-1.3.1.tar.gz"
  cp "$destination/POSTGRESQL_CLIENT_LICENSE.txt" "$destination/ZLIB_LICENSE.txt" "$static_prefix/"
  cat > "$static_prefix/lib/pkgconfig/libpq.pc" << EOF
prefix=$static_prefix
libdir=\${prefix}/lib
includedir=\${prefix}/include
Name: libpq
Description: Pinned PostgreSQL static client library
Version: 16.15
Libs: -L\${libdir} -lpq
Cflags: -I\${includedir}
EOF
  cat > "$static_prefix/lib/pkgconfig/zlib.pc" << EOF
prefix=$static_prefix
libdir=\${prefix}/lib
includedir=\${prefix}/include
Name: zlib
Description: Pinned static zlib
Version: 1.3.1
Libs: -L\${libdir} -lz
Cflags: -I\${includedir}
EOF
fi
# Reject non-OS dynamic dependencies now, before packaging/signing. Each
# platform smoke also executes all three shipped clients with --version.
for tool in psql pg_dump pg_restore; do
  binary=$destination/bin/$tool$suffix
  case "$target" in
    darwin-arm64)
      dependencies=$(otool -L "$binary")
      printf '%s\n' "$dependencies" | while IFS= read -r line; do
        case "$line" in
          *:|*'/usr/lib/'*|*'/System/Library/'*) ;;
          *) echo "non-system client dependency: $line" >&2; exit 1 ;;
        esac
      done
      ;;
    linux-x64)
      dependencies=$(readelf -d "$binary")
      printf '%s\n' "$dependencies" | while IFS= read -r line; do
        case "$line" in
          *NEEDED*)
            case "$line" in
              *'[libc.so.6]'*|*'[libm.so.6]'*|*'[libpthread.so.0]'*|*'[libdl.so.2]'*|*'[librt.so.1]'*) ;;
              *) echo "non-system client dependency: $line" >&2; exit 1 ;;
            esac ;;
          *RPATH*|*RUNPATH*) echo "unexpected client rpath: $line" >&2; exit 1 ;;
        esac
      done
      ;;
    win32-x64)
      dependencies=$(objdump -p "$binary")
      printf '%s\n' "$dependencies" | while IFS= read -r line; do
        case "$line" in
          *'DLL Name: '*)
            dll=${line##*DLL Name: }
            dll=$(printf '%s' "$dll" | tr '[:upper:]' '[:lower:]' | tr -d '\r')
            case "$dll" in
              kernel32.dll|advapi32.dll|bcrypt.dll|crypt32.dll|secur32.dll|shell32.dll|user32.dll|ws2_32.dll|wldap32.dll|msvcrt.dll|ucrtbase.dll|ntdll.dll|api-ms-win-*.dll) ;;
              *) echo "non-system client dependency: $dll" >&2; exit 1 ;;
            esac ;;
        esac
      done
      ;;
  esac
done
recipe_sha=$(digest "$0")
compiler=$("$CC" --version | tr '\n' ';')
configuration=$("$tmp/postgresql-16.15/config.status" --config)
static_manifest_sha=
if [ -n "$static_prefix" ]; then
  (
    cd "$static_prefix"
    for file in lib/libpq.a lib/libz.a include/*.h include/libpq/*.h lib/pkgconfig/*.pc "bin/pg_config$suffix"; do
      printf '%s  %s\n' "$(digest "$file")" "$file"
    done
  ) > "$static_prefix/STATIC_PREFIX_MANIFEST.sha256"
  static_manifest_sha=$(digest "$static_prefix/STATIC_PREFIX_MANIFEST.sha256")
fi
cat > "$destination/CLIENT_PROVENANCE" << EOF
platform=$target
postgres_clients=16.15
postgres_clients_url=$pg_url
postgres_clients_sha256=$pg_sha
postgres_clients_libpq=statically linked from matching PostgreSQL source
postgres_clients_crypto=built-in SCRAM, local non-TLS connections only
postgres_clients_compression=zlib (gzip custom archives)
zlib=1.3.1
zlib_url=$zlib_url
zlib_sha256=$zlib_sha
zlib_linkage=static
postgres_clients_license=PostgreSQL License (POSTGRESQL_CLIENT_LICENSE.txt)
zlib_license=zlib (ZLIB_LICENSE.txt)
postgres_clients_psql_sha256=$(digest "$destination/bin/psql$suffix")
postgres_clients_pg_dump_sha256=$(digest "$destination/bin/pg_dump$suffix")
postgres_clients_pg_restore_sha256=$(digest "$destination/bin/pg_restore$suffix")
postgres_clients_recipe_sha256=$recipe_sha
postgres_clients_compiler=$compiler
postgres_clients_cflags=$CFLAGS
postgres_clients_ldflags=${LDFLAGS-}
postgres_clients_configure=$configuration
static_prefix_manifest_sha256=$static_manifest_sha
EOF
if [ -n "$static_prefix" ]; then
  cp "$destination/CLIENT_PROVENANCE" "$static_prefix/CLIENT_PROVENANCE"
fi
printf 'staged matching %s PostgreSQL clients in %s\n' "$target" "$destination/bin"
