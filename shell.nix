{ pkgs ? import <nixpkgs> {} }:

pkgs.mkShell {
  buildInputs = with pkgs; [
    nodejs           # provides node, npm, npx
    zip
    unzip
    gawk
    gnugrep
    coreutils        # wc, du, etc.
  ];

  shellHook = ''
    echo "Sonance3 dev shell ready."
    echo "Run:  ./build.sh        # build production .wgt"
    echo "      ./build.sh --dev  # restore dev mode"
  '';
}
