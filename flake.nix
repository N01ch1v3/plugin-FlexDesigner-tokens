{
  description = "FlexDesigner AI Tokens plugin - dev environment";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
    flake-utils.url = "github:numtide/flake-utils";
  };

  outputs = { self, nixpkgs, flake-utils }:
    flake-utils.lib.eachDefaultSystem (system:
      let
        pkgs = import nixpkgs { inherit system; };
      in
      {
        devShells.default = pkgs.mkShell {
          name = "flexdesigner-ai-tokens";

          packages = with pkgs; [
            # FlexDesigner SDK requires Node.js 20+
            nodejs_20
            # flexcli is installed per-project via npm (not packaged in nixpkgs)
            git
            jq
          ];

          shellHook = ''
            echo "flexdesigner-ai-tokens dev shell"
            echo "  node $(node --version)"
            echo ""
            echo "  npm install       # first time"
            echo "  npm run build     # bundle backend"
            echo "  npm run dev       # link + watch (FlexDesigner must be running)"
            echo ""
            # Keep npm's global bin inside the repo so flexcli never leaks into $HOME
            export NPM_CONFIG_PREFIX="$PWD/.npm-global"
            export PATH="$PWD/.npm-global/bin:$PWD/node_modules/.bin:$PATH"
          '';
        };
      });
}
