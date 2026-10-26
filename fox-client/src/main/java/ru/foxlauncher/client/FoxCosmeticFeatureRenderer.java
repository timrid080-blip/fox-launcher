package ru.foxlauncher.client;

import net.minecraft.client.MinecraftClient;
import net.minecraft.client.model.ModelPart;
import net.minecraft.client.render.OverlayTexture;
import net.minecraft.client.render.RenderLayer;
import net.minecraft.client.render.VertexConsumerProvider;
import net.minecraft.client.render.entity.feature.FeatureRenderer;
import net.minecraft.client.render.entity.feature.FeatureRendererContext;
import net.minecraft.client.network.AbstractClientPlayerEntity;
import net.minecraft.client.render.entity.model.PlayerEntityModel;
import net.minecraft.client.util.math.MatrixStack;

/**
 * Renders equipped Fox cosmetics as actual model geometry.
 * Cosmetics are intentionally local-only until a safe, authenticated sync protocol exists.
 */
public final class FoxCosmeticFeatureRenderer extends FeatureRenderer<AbstractClientPlayerEntity, PlayerEntityModel<AbstractClientPlayerEntity>> {
    private final ModelPart cosmeticRoot;

    public FoxCosmeticFeatureRenderer(
            FeatureRendererContext<AbstractClientPlayerEntity, PlayerEntityModel<AbstractClientPlayerEntity>> context,
            ModelPart cosmeticRoot) {
        super(context);
        this.cosmeticRoot = cosmeticRoot;
    }

    @Override
    public void render(MatrixStack matrices, VertexConsumerProvider vertexConsumers, int light,
                       AbstractClientPlayerEntity player, float limbAngle, float limbDistance,
                       float tickDelta, float animationProgress, float headYaw, float headPitch) {
        if (player != MinecraftClient.getInstance().player) return;

        String equipped = FoxClientConfig.getEquippedCosmetic();
        if ("none".equals(equipped)) return;

        ModelPart part = cosmeticRoot.getChild(equipped);
        if ("cape".equals(equipped) || "wings".equals(equipped)) {
            getContextModel().body.copyTransform(part);
        } else {
            getContextModel().head.copyTransform(part);
        }

        part.render(matrices,
                vertexConsumers.getBuffer(RenderLayer.getEntityCutoutNoCull(FoxCosmeticModel.TEXTURE)),
                light, OverlayTexture.DEFAULT_UV);
    }
}
