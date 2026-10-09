{ pkgs ? import <nixpkgs> {} }:

pkgs.mkShell {
  buildInputs = with pkgs; [
    nodejs           # provides node, npm, npx
    zip
    unzip
    gawk
    gnugrep
    coreutils        # wc, du, etc.
    perl             # build.sh rewrites index.html's script block and fixes the bundles
    gzip             # build.sh's size report
  ];

  shellHook = ''
    echo "Sonance3 dev shell ready."
    echo "Run:  ./build.sh        # build production .wgt"
    echo "      ./build.sh --dev  # restore dev mode"
  '';
}
