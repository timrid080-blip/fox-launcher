package ru.foxlauncher.client;

import net.fabricmc.api.ClientModInitializer;
import net.fabricmc.fabric.api.client.event.lifecycle.v1.ClientTickEvents;
import net.fabricmc.fabric.api.client.keybinding.v1.KeyBindingHelper;
import net.minecraft.client.option.KeyBinding;
import net.minecraft.client.util.InputUtil;
import net.minecraft.text.Text;
import org.lwjgl.glfw.GLFW;

/** Client-side entrypoint. Preferences are local to this Minecraft client. */
public final class FoxClient implements ClientModInitializer {
    private static KeyBinding toggleHudHints;
    private static KeyBinding toggleFovBoost;
    private static boolean hintsEnabled = true;
    private static boolean fovBoostEnabled = false;
    private static Integer originalFov = null;

    @Override
    public void onInitializeClient() {
        toggleHudHints = KeyBindingHelper.registerKeyBinding(new KeyBinding(
                "key.foxclient.toggle_hints", InputUtil.Type.KEYSYM,
                GLFW.GLFW_KEY_RIGHT_SHIFT, "category.foxclient"));

        toggleFovBoost = KeyBindingHelper.registerKeyBinding(new KeyBinding(
                "key.foxclient.toggle_fov", InputUtil.Type.KEYSYM,
                GLFW.GLFW_KEY_F8, "category.foxclient"));

        ClientTickEvents.END_CLIENT_TICK.register(client -> {
            while (toggleHudHints.wasPressed()) {
                hintsEnabled = !hintsEnabled;
                if (client.player != null) {
                    client.player.sendMessage(Text.literal("§6Fox Client §7· подсказки интерфейса: "
                            + (hintsEnabled ? "§aвключены" : "§cвыключены")), true);
                }
            }

            while (toggleFovBoost.wasPressed()) {
                if (client.options == null) continue;
                int currentFov = client.options.getFov().getValue();
                if (!fovBoostEnabled) {
                    originalFov = currentFov;
                    client.options.getFov().setValue(Math.min(110, currentFov + 20));
                    fovBoostEnabled = true;
                } else {
                    if (originalFov != null) {
                        client.options.getFov().setValue(originalFov);
                    }
                    originalFov = null;
                    fovBoostEnabled = false;
                }
                if (client.player != null) {
                    client.player.sendMessage(Text.literal("§6Fox Client §7· FOV+: "
                            + (fovBoostEnabled ? "§aвключён" : "§cвыключен")), true);
                }
            }
        });
    }

    public static boolean areHudHintsEnabled() { return hintsEnabled; }
}
