package ru.foxlauncher.client.mixin;

import net.minecraft.client.MinecraftClient;
import net.minecraft.client.gui.hud.PlayerListHud;
import net.minecraft.client.network.PlayerListEntry;
import net.minecraft.text.Text;
import net.minecraft.util.Formatting;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Inject;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfoReturnable;

/** Adds a local Fox marker to the local player's name in the tab list. */
@Mixin(PlayerListHud.class)
public abstract class PlayerListHudMixin {
    @Inject(method = "getPlayerName", at = @At("RETURN"), cancellable = true)
    private void foxclient$appendLocalMarker(PlayerListEntry entry, CallbackInfoReturnable<Text> cir) {
        MinecraftClient client = MinecraftClient.getInstance();
        if (client.player == null || entry == null || entry.getProfile() == null) return;
        if (entry.getProfile().getId().equals(client.player.getUuid())) {
            Text original = cir.getReturnValue();
            if (original != null) {
                cir.setReturnValue(original.copy().append(Text.literal(" ◆").formatted(Formatting.GOLD)));
            }
        }
    }
}
