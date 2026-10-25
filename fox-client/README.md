# Fox Client — первый исходный модуль

This is the initial Fabric client-side module, separate from the Electron launcher. The first compatibility target is Minecraft Java Edition 1.21.4 with Java 21. One JAR cannot safely support every Minecraft version from 1.12 through 26.x; separate versioned builds and loader-specific source sets are required.

## Current foundation
- Fabric client entrypoint and a Right Shift key binding to toggle the first HUD-hint preference.
- Russian and English keybind labels.
- No server plugin required; no external network calls.

## Build
Use JDK 21 and Gradle, then run `gradle build` from this directory. The resulting JAR is under `build/libs/`.

## Not implemented yet
Voice chat, skins/capes, wings/headwear cosmetics, TAB server-side icon integration, and Forge/NeoForge/Quilt builds. This is source scaffolding, not a released or verified JAR.
