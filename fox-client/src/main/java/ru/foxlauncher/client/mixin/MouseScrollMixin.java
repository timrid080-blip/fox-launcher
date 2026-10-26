package ru.foxlauncher.client.mixin;

import net.minecraft.client.Mouse;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Inject;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfo;
import ru.foxlauncher.client.FoxClient;

/** Uses the mouse wheel to change zoom while C is held. */
@Mixin(Mouse.class)
public abstract class MouseScrollMixin {
    @Inject(method = "onMouseScroll", at = @At("HEAD"), cancellable = true)
    private void foxclient$adjustZoom(long window, double horizontal, double vertical, CallbackInfo ci) {
        if (FoxClient.handleZoomScroll(vertical)) {
            ci.cancel();
        }
    }
}
