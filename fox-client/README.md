# Fox Client

Separate client-side Minecraft mod source for Fox Launcher. Current implementation target: **Minecraft Java 1.21.4, Java 21, Fabric**.

## Implemented in source
- `F8`: temporarily increases the current FOV by 20 (capped at 110), then restores the captured value when toggled off.
- `Right Shift`: toggles the initial HUD-hints preference flag.
- Russian and English keybind labels.
- Client-only behavior; no server plugin or external network request is required for these controls.

## Cosmetic goals
The planned Fox cosmetics are defined conceptually as:
- Free Fox-emblem cape.
- Pumpkin helmet / pumpkin headwear.
- Fox wings.
- Fox hood and other headwear.

**These are not rendered on the Minecraft player yet.** They need a client rendering implementation and texture assets; a launcher profile badge is not the same as an in-game cape or wings. A cape also cannot be made visible to other players just by adding a local texture—the distribution/visibility method must be implemented and clearly supported.

## Build
From this directory, use JDK 21 and Gradle 8.12:
```sh
gradle build --no-daemon
```
The JARs should appear under `build/libs/`. GitHub Actions also attempts this build and uploads the output as an artifact.

## Important limitations
- The source has **not yet been confirmed by a successful build or in-game test**.
- Forge and NeoForge versions are not implemented yet; their APIs and metadata need separate loader-specific projects.
- Voice chat, player-rendered skins/capes, wings/headwear cosmetics, and server-side TAB icon integration are not implemented.
- One JAR cannot be assumed to support Minecraft 1.12 through modern 26.x versions. Those require version-specific compatibility work and separate builds.
