package ru.foxlauncher.client.mixin;

import net.minecraft.client.render.Camera;
import net.minecraft.client.render.GameRenderer;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Inject;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfoReturnable;
import ru.foxlauncher.client.FoxClient;

/** Applies zoom to the rendered camera FOV without changing the user's FOV setting. */
@Mixin(GameRenderer.class)
public abstract class GameRendererMixin {
    @Inject(method = "getFov", at = @At("RETURN"), cancellable = true)
    private void foxclient$applySmoothZoom(Camera camera, float tickDelta, boolean changingFov,
                                           CallbackInfoReturnable<Double> cir) {
        double zoom = FoxClient.getSmoothZoom();
        if (zoom > 1.001) {
            cir.setReturnValue(cir.getReturnValueD() / zoom);
        }
    }
}
