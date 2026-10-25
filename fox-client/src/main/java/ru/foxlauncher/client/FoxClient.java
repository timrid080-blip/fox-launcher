package ru.foxlauncher.client;

import net.fabricmc.api.ClientModInitializer;
import net.fabricmc.fabric.api.client.event.lifecycle.v1.ClientTickEvents;
import net.fabricmc.fabric.api.client.keybinding.v1.KeyBindingHelper;
import net.fabricmc.fabric.api.client.rendering.v1.HudRenderCallback;
import net.minecraft.client.option.KeyBinding;
import net.minecraft.client.util.InputUtil;
import net.minecraft.text.Text;
import org.lwjgl.glfw.GLFW;

/** Client-side quality-of-life features. All controls run locally. */
public final class FoxClient implements ClientModInitializer {
    private static KeyBinding toggleHudHints;
    private static KeyBinding toggleFovBoost;
    private static KeyBinding toggleCoordinates;
    private static boolean hintsEnabled = true;
    private static boolean fovBoostEnabled = false;
    private static boolean coordinatesEnabled = true;
    private static Integer originalFov = null;

    @Override
    public void onInitializeClient() {
        toggleHudHints = KeyBindingHelper.registerKeyBinding(new KeyBinding(
                "key.foxclient.toggle_hints", InputUtil.Type.KEYSYM,
                GLFW.GLFW_KEY_RIGHT_SHIFT, "category.foxclient"));

        toggleFovBoost = KeyBindingHelper.registerKeyBinding(new KeyBinding(
                "key.foxclient.toggle_fov", InputUtil.Type.KEYSYM,
                GLFW.GLFW_KEY_F8, "category.foxclient"));

        toggleCoordinates = KeyBindingHelper.registerKeyBinding(new KeyBinding(
                "key.foxclient.toggle_coordinates", InputUtil.Type.KEYSYM,
                GLFW.GLFW_KEY_F7, "category.foxclient"));

        ClientTickEvents.END_CLIENT_TICK.register(client -> {
            while (toggleHudHints.wasPressed()) {
                hintsEnabled = !hintsEnabled;
                notifyPlayer(client, "§6Fox Client §7· подсказки интерфейса: "
                        + (hintsEnabled ? "§aвключены" : "§cвыключены"));
            }

            while (toggleCoordinates.wasPressed()) {
                coordinatesEnabled = !coordinatesEnabled;
                notifyPlayer(client, "§6Fox Client §7· координаты: "
                        + (coordinatesEnabled ? "§aвключены" : "§cвыключены"));
            }

            while (toggleFovBoost.wasPressed()) {
                if (client.options == null) continue;
                int currentFov = client.options.getFov().getValue();
                if (!fovBoostEnabled) {
                    originalFov = currentFov;
                    client.options.getFov().setValue(Math.min(110, currentFov + 20));
                    fovBoostEnabled = true;
                } else {
                    if (originalFov != null) client.options.getFov().setValue(originalFov);
                    originalFov = null;
                    fovBoostEnabled = false;
                }
                notifyPlayer(client, "§6Fox Client §7· FOV+: "
                        + (fovBoostEnabled ? "§aвключён" : "§cвыключен"));
            }
        });

        HudRenderCallback.EVENT.register((drawContext, tickCounter) -> {
            if (!coordinatesEnabled) return;
            var client = net.minecraft.client.MinecraftClient.getInstance();
            if (client.player == null || client.textRenderer == null) return;
            var pos = client.player.getPos();
            String coords = String.format(java.util.Locale.ROOT,
                    "XYZ: %.1f / %.1f / %.1f", pos.x, pos.y, pos.z);
            drawContext.drawTextWithShadow(client.textRenderer, Text.literal(coords),
                    6, 6, 0xFFFFFF);
            drawContext.drawTextWithShadow(client.textRenderer,
                    Text.literal("Fox Client"), 6, 18, 0xFFB347);
        });
    }

    private static void notifyPlayer(net.minecraft.client.MinecraftClient client, String message) {
        if (client.player != null) client.player.sendMessage(Text.literal(message), true);
    }

    public static boolean areHudHintsEnabled() { return hintsEnabled; }
}
