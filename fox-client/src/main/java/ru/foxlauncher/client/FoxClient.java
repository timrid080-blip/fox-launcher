package ru.foxlauncher.client;

import net.fabricmc.api.ClientModInitializer;
import net.fabricmc.fabric.api.client.event.lifecycle.v1.ClientTickEvents;
import net.fabricmc.fabric.api.client.keybinding.v1.KeyBindingHelper;
import net.fabricmc.fabric.api.client.rendering.v1.EntityModelLayerRegistry;
import net.fabricmc.fabric.api.client.rendering.v1.LivingEntityFeatureRendererRegistrationCallback;
import net.minecraft.client.option.KeyBinding;
import net.minecraft.client.render.entity.PlayerEntityRenderer;
import net.minecraft.client.util.InputUtil;
import net.minecraft.text.Text;
import org.lwjgl.glfw.GLFW;

/** Client-side quality-of-life features. All controls run locally. */
public final class FoxClient implements ClientModInitializer {
    private static KeyBinding toggleHudHints;
    private static KeyBinding toggleFovBoost;
    private static KeyBinding toggleCoordinates;
    private static KeyBinding cycleCosmetic;
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

        toggleCoordinates = KeyBindingHelper.registerKeyBinding(new KeyBinding(
                "key.foxclient.toggle_coordinates", InputUtil.Type.KEYSYM,
                GLFW.GLFW_KEY_F7, "category.foxclient"));

        cycleCosmetic = KeyBindingHelper.registerKeyBinding(new KeyBinding(
                "key.foxclient.cycle_cosmetic", InputUtil.Type.KEYSYM,
                GLFW.GLFW_KEY_F9, "category.foxclient"));

        EntityModelLayerRegistry.registerModelLayer(
                FoxCosmeticModel.LAYER, FoxCosmeticModel::getTexturedModelData);
        LivingEntityFeatureRendererRegistrationCallback.EVENT.register(
                (entityType, entityRenderer, registrationHelper, context) -> {
                    if (entityRenderer instanceof PlayerEntityRenderer playerRenderer) {
                        registrationHelper.register(new FoxCosmeticFeatureRenderer(
                                playerRenderer, context.getPart(FoxCosmeticModel.LAYER)));
                    }
                });

        ClientTickEvents.END_CLIENT_TICK.register(client -> {
            while (toggleHudHints.wasPressed()) {
                hintsEnabled = !hintsEnabled;
                notifyPlayer(client, "§6Fox Client §7· подсказки интерфейса: "
                        + (hintsEnabled ? "§aвключены" : "§cвыключены"));
            }

            while (toggleCoordinates.wasPressed()) {
                FoxClientConfig.setCoordinatesEnabled(!FoxClientConfig.areCoordinatesEnabled());
                notifyPlayer(client, "§6Fox Client §7· координаты: "
                        + (FoxClientConfig.areCoordinatesEnabled() ? "§aвключены" : "§cвыключены"));
            }

            while (cycleCosmetic.wasPressed()) {
                String cosmetic = FoxClientConfig.cycleCosmetic();
                notifyPlayer(client, "§6Fox Client §7· аксессуар: §f" + FoxClientConfig.displayName(cosmetic));
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
    }

    private static void notifyPlayer(net.minecraft.client.MinecraftClient client, String message) {
        if (client.player != null) client.player.sendMessage(Text.literal(message), true);
    }

    public static boolean areHudHintsEnabled() { return hintsEnabled; }
}
