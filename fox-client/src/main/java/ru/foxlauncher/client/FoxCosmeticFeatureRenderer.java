package ru.foxlauncher.client;

import net.minecraft.client.MinecraftClient;
import net.minecraft.client.model.ModelPart;
import net.minecraft.client.render.OverlayTexture;
import net.minecraft.client.render.RenderLayer;
import net.minecraft.client.render.VertexConsumerProvider;
import net.minecraft.client.render.entity.feature.FeatureRenderer;
import net.minecraft.client.render.entity.feature.FeatureRendererContext;
import net.minecraft.client.render.entity.model.PlayerEntityModel;
import net.minecraft.client.render.entity.state.PlayerEntityRenderState;
import net.minecraft.client.util.math.MatrixStack;

/** Renders actual 3D cosmetic geometry on the local player. */
public final class FoxCosmeticFeatureRenderer extends FeatureRenderer<PlayerEntityRenderState, PlayerEntityModel> {
    private final ModelPart cosmeticRoot;

    public FoxCosmeticFeatureRenderer(
            FeatureRendererContext<PlayerEntityRenderState, PlayerEntityModel> context,
            ModelPart cosmeticRoot) {
        super(context);
        this.cosmeticRoot = cosmeticRoot;
    }

    @Override
    public void render(MatrixStack matrices, VertexConsumerProvider vertexConsumers, int light,
                       PlayerEntityRenderState state, float limbAngle, float limbDistance) {
        MinecraftClient client = MinecraftClient.getInstance();
        if (client.player == null || state.name == null
                || !state.name.equals(client.player.getGameProfile().getName())) return;

        String equipped = FoxClientConfig.getEquippedCosmetic();
        if ("none".equals(equipped)) return;

        ModelPart part = cosmeticRoot.getChild(equipped);
        if ("cape".equals(equipped) || "wings".equals(equipped) || "backpack".equals(equipped)) {
            getContextModel().body.copyTransform(part);
        } else {
            getContextModel().head.copyTransform(part);
        }
        part.render(matrices,
                vertexConsumers.getBuffer(RenderLayer.getEntityCutoutNoCull(FoxCosmeticModel.TEXTURE)),
                light, OverlayTexture.DEFAULT_UV);
    }
}
