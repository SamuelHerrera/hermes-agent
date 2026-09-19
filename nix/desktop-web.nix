# nix/desktop-web.nix — browser-hosted Hermes Desktop renderer
{ hermesNpmLib, ... }:
hermesNpmLib.buildNpmPackage {
  dirs = [
    "apps/desktop"
    "apps/shared"
  ];
  pname = "hermes-desktop-web";

  doCheck = false;

  buildPhase = ''
    runHook preBuild
    cd apps/desktop
    node ../../node_modules/vite/bin/vite.js build --mode browser --outDir dist
    node -e "import('./scripts/assert-browser-dist.mjs').then(({ assertBrowserDist }) => assertBrowserDist('./dist'))"
    cd ../..
    runHook postBuild
  '';

  installPhase = ''
    runHook preInstall
    cp -r apps/desktop/dist $out
    runHook postInstall
  '';
}