package ru.foxlauncher.client.mixin;

import net.minecraft.client.MinecraftClient;
import net.minecraft.client.render.entity.PlayerEntityRenderer;
import net.minecraft.text.Text;
import net.minecraft.util.Formatting;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.ModifyVariable;

/** Adds a Fox marker to the local player's rendered name tag. */
@Mixin(PlayerEntityRenderer.class)
public abstract class PlayerEntityRendererMixin {
    @ModifyVariable(
            method = "renderLabelIfPresent",
            at = @At("HEAD"),
            argsOnly = true,
            ordinal = 0)
    private Text foxclient$appendLocalFoxMarker(Text originalText) {
        MinecraftClient client = MinecraftClient.getInstance();
        if (client.player == null || originalText == null) return originalText;

        String playerName = client.player.getGameProfile().getName();
        if (!originalText.getString().contains(playerName)
                || originalText.getString().contains("◆")) {
            return originalText;
        }
        return originalText.copy().append(Text.literal(" ◆").formatted(Formatting.GOLD));
    }
}
