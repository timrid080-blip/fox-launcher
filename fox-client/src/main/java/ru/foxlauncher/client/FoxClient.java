package ru.foxlauncher.client;

import net.fabricmc.api.ClientModInitializer;
import net.fabricmc.fabric.api.client.event.lifecycle.v1.ClientTickEvents;
import net.fabricmc.fabric.api.client.keybinding.v1.KeyBindingHelper;
import net.minecraft.client.option.KeyBinding;
import net.minecraft.client.util.InputUtil;
import net.minecraft.text.Text;
import org.lwjgl.glfw.GLFW;

/** Client-side entrypoint. No network calls and no server-side installation required. */
public final class FoxClient implements ClientModInitializer {
    private static KeyBinding toggleHudHints;
    private static boolean hintsEnabled = true;

    @Override
    public void onInitializeClient() {
        toggleHudHints = KeyBindingHelper.registerKeyBinding(new KeyBinding(
                "key.foxclient.toggle_hints",
                InputUtil.Type.KEYSYM,
                GLFW.GLFW_KEY_RIGHT_SHIFT,
                KeyBinding.Category.MISC
        ));
        ClientTickEvents.END_CLIENT_TICK.register(client -> {
            while (toggleHudHints.wasPressed()) {
                hintsEnabled = !hintsEnabled;
                if (client.player != null) {
                    client.player.sendMessage(Text.literal("§6Fox Client §7· подсказки интерфейса: " + (hintsEnabled ? "§aвключены" : "§cвыключены")), true);
                }
            }
        });
    }

    public static boolean areHudHintsEnabled() { return hintsEnabled; }
}
