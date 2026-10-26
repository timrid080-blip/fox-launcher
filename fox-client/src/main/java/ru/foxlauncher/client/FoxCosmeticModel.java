package ru.foxlauncher.client;

import net.minecraft.client.model.ModelData;
import net.minecraft.client.model.ModelPart;
import net.minecraft.client.model.ModelPartBuilder;
import net.minecraft.client.model.ModelPartData;
import net.minecraft.client.model.ModelTransform;
import net.minecraft.client.model.TexturedModelData;
import net.minecraft.client.render.entity.model.EntityModelLayer;
import net.minecraft.util.Identifier;

/** Simple low-poly 3D cosmetic geometry. */
public final class FoxCosmeticModel {
    public static final EntityModelLayer LAYER =
            new EntityModelLayer(Identifier.of("foxclient", "cosmetics"), "main");
    public static final Identifier TEXTURE =
            Identifier.of("foxclient", "textures/cosmetics.png");

    private FoxCosmeticModel() {}

    public static TexturedModelData getTexturedModelData() {
        ModelData data = new ModelData();
        ModelPartData root = data.getRoot();
        root.addChild("cape", ModelPartBuilder.create()
                .uv(0, 0).cuboid(-5.0F, 0.0F, 2.0F, 10.0F, 16.0F, 1.0F),
                ModelTransform.NONE);
        root.addChild("pumpkin", ModelPartBuilder.create()
                .uv(0, 32).cuboid(-4.0F, -8.0F, -4.0F, 8.0F, 8.0F, 8.0F),
                ModelTransform.NONE);
        root.addChild("hood", ModelPartBuilder.create()
                .uv(32, 0).cuboid(-4.5F, -8.5F, -4.5F, 9.0F, 9.0F, 9.0F),
                ModelTransform.NONE);
        ModelPartData wings = root.addChild("wings", ModelPartBuilder.create(), ModelTransform.NONE);
        wings.addChild("left", ModelPartBuilder.create()
                .uv(32, 32).cuboid(-12.0F, -1.0F, 2.0F, 7.0F, 10.0F, 1.0F),
                ModelTransform.NONE);
        wings.addChild("right", ModelPartBuilder.create()
                .uv(32, 32).cuboid(5.0F, -1.0F, 2.0F, 7.0F, 10.0F, 1.0F),
                ModelTransform.NONE);
        return TexturedModelData.of(data, 64, 64);
    }
}
