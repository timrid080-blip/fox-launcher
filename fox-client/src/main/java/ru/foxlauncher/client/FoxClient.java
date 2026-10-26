package ru.foxlauncher.client;

import net.fabricmc.api.ClientModInitializer;
import net.fabricmc.fabric.api.client.event.lifecycle.v1.ClientTickEvents;
import net.fabricmc.fabric.api.client.keybinding.v1.KeyBindingHelper;
import net.fabricmc.fabric.api.client.rendering.v1.EntityModelLayerRegistry;
import net.fabricmc.fabric.api.client.rendering.v1.HudRenderCallback;
import net.fabricmc.fabric.api.client.rendering.v1.LivingEntityFeatureRendererRegistrationCallback;
import net.minecraft.client.MinecraftClient;
import net.minecraft.client.gui.DrawContext;
import net.minecraft.client.option.KeyBinding;
import net.minecraft.client.render.entity.PlayerEntityRenderer;
import net.minecraft.client.render.entity.feature.FeatureRendererContext;
import net.minecraft.client.render.entity.model.PlayerEntityModel;
import net.minecraft.client.render.entity.state.PlayerEntityRenderState;
import net.minecraft.client.util.InputUtil;
import net.minecraft.text.Text;
import net.minecraft.util.math.BlockPos;
import org.lwjgl.glfw.GLFW;

/** Client-side quality-of-life features. */
public final class FoxClient implements ClientModInitializer {
    private static KeyBinding toggleFovBoost;
    private static KeyBinding toggleCoordinates;
    private static KeyBinding cycleCosmetic;
    private static KeyBinding openCosmetics;
    private static boolean zoomKeyDown = false;
    private static double zoomMultiplier = 4.0;
    private static double smoothZoom = 1.0;

    @Override
    public void onInitializeClient() {
        toggleFovBoost = KeyBindingHelper.registerKeyBinding(new KeyBinding(
                "key.foxclient.zoom", InputUtil.Type.KEYSYM,
                GLFW.GLFW_KEY_C, "category.foxclient"));
        toggleCoordinates = KeyBindingHelper.registerKeyBinding(new KeyBinding(
                "key.foxclient.toggle_coordinates", InputUtil.Type.KEYSYM,
                GLFW.GLFW_KEY_F7, "category.foxclient"));
        cycleCosmetic = KeyBindingHelper.registerKeyBinding(new KeyBinding(
                "key.foxclient.cycle_cosmetic", InputUtil.Type.KEYSYM,
                GLFW.GLFW_KEY_F9, "category.foxclient"));
        openCosmetics = KeyBindingHelper.registerKeyBinding(new KeyBinding(
                "key.foxclient.open_cosmetics", InputUtil.Type.KEYSYM,
                GLFW.GLFW_KEY_F10, "category.foxclient"));

        EntityModelLayerRegistry.registerModelLayer(
                FoxCosmeticModel.LAYER, FoxCosmeticModel::getTexturedModelData);
        LivingEntityFeatureRendererRegistrationCallback.EVENT.register(
                (entityType, entityRenderer, registrationHelper, context) -> {
                    if (entityRenderer instanceof PlayerEntityRenderer) {
                        registrationHelper.register(new FoxCosmeticFeatureRenderer(
                                playerRendererContext(entityRenderer), context.getPart(FoxCosmeticModel.LAYER)));
                    }
                });

        HudRenderCallback.EVENT.register((drawContext, tickCounter) -> renderFoxHud(drawContext));

        ClientTickEvents.END_CLIENT_TICK.register(client -> {
            while (toggleCoordinates.wasPressed()) {
                FoxClientConfig.setCoordinatesEnabled(!FoxClientConfig.areCoordinatesEnabled());
                notifyPlayer(client, "§6Fox Client §7· координаты: "
                        + (FoxClientConfig.areCoordinatesEnabled() ? "§aвключены" : "§cвыключены"));
            }
            while (openCosmetics.wasPressed()) {
                if (client.player != null) client.setScreen(new FoxCosmeticsScreen());
            }
            while (cycleCosmetic.wasPressed()) {
                String cosmetic = FoxClientConfig.cycleCosmetic();
                notifyPlayer(client, "§6Fox Client §7· аксессуар: §f" + FoxClientConfig.displayName(cosmetic));
            }
            zoomKeyDown = toggleFovBoost.isPressed();
            double targetZoom = zoomKeyDown ? zoomMultiplier : 1.0;
            smoothZoom += (targetZoom - smoothZoom) * 0.28;
            if (Math.abs(targetZoom - smoothZoom) < 0.015) smoothZoom = targetZoom;
        });
    }

    @SuppressWarnings("unchecked")
    private static FeatureRendererContext<PlayerEntityRenderState, PlayerEntityModel> playerRendererContext(
            Object renderer) {
        // PlayerEntityRenderer is the concrete renderer for PlayerEntityRenderState in 1.21.4;
        // the callback exposes it through a wildcarded LivingEntityRenderer type.
        return (FeatureRendererContext<PlayerEntityRenderState, PlayerEntityModel>) (Object) renderer;
    }

    private static void renderFoxHud(DrawContext context) {
        MinecraftClient client = MinecraftClient.getInstance();
        if (client.player == null || client.world == null || client.options.hudHidden) return;

        int y = 8;
        if (FoxClientConfig.areCoordinatesEnabled()) {
            BlockPos pos = client.player.getBlockPos();
            String coordinates = String.format("XYZ: %d  %d  %d", pos.getX(), pos.getY(), pos.getZ());
            context.drawTextWithShadow(client.textRenderer, Text.literal(coordinates), 8, y, 0xFFFFB347);
            y += 12;
        }

    }

    private static void notifyPlayer(net.minecraft.client.MinecraftClient client, String message) {
        if (client.player != null) client.player.sendMessage(Text.literal(message), true);
    }

    /** True while C is held; zoom interpolation is smoothed on client ticks. */
    public static boolean isZoomKeyDown() { return zoomKeyDown; }

    public static double getSmoothZoom() { return smoothZoom; }

    /** Mouse wheel adjusts magnification only while the zoom key is held. */
    public static boolean handleZoomScroll(double vertical) {
        if (!zoomKeyDown || vertical == 0.0) return false;
        zoomMultiplier = Math.max(2.0, Math.min(20.0, zoomMultiplier + vertical * 0.75));
        return true;
    }
}
