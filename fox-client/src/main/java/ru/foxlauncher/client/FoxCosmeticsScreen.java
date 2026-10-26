package ru.foxlauncher.client;

import net.minecraft.client.gui.DrawContext;
import net.minecraft.client.gui.screen.Screen;
import net.minecraft.client.gui.widget.ButtonWidget;
import net.minecraft.text.Text;

/** Original Fox Client accessory picker; selections are local until online cosmetics sync is added. */
public final class FoxCosmeticsScreen extends Screen {
    private static final String[][] ITEMS = {
            {"none", "Без аксессуара"},
            {"cape", "Плащ Fox"},
            {"pumpkin", "Тыквенный шлем"},
            {"wings", "Крылья Fox"},
            {"hood", "Капюшон Fox"},
            {"crown", "Корона Fox"},
            {"backpack", "Рюкзак Fox"},
            {"halo", "Светящийся нимб"}
    };

    public FoxCosmeticsScreen() {
        super(Text.literal("Гардероб Fox"));
    }

    @Override
    protected void init() {
        int buttonWidth = Math.min(220, this.width - 32);
        int left = this.width / 2 - buttonWidth / 2;
        int top = 52;
        for (int i = 0; i < ITEMS.length; i++) {
            final String id = ITEMS[i][0];
            final String label = ITEMS[i][1];
            int y = top + i * 24;
            if (y + 20 > this.height - 30) break;
            addDrawableChild(ButtonWidget.builder(Text.literal(
                    (id.equals(FoxClientConfig.getEquippedCosmetic()) ? "✓ " : "") + label),
                    button -> {
                        FoxClientConfig.setEquippedCosmetic(id);
                        if (client != null && client.player != null) {
                            client.player.sendMessage(Text.literal("§6Fox Client §7· выбран аксессуар: §f" + label), true);
                        }
                        if (client != null) client.setScreen(new FoxCosmeticsScreen());
                    }).dimensions(left, y, buttonWidth, 20).build());
        }
        addDrawableChild(ButtonWidget.builder(Text.literal("Закрыть"), button -> close())
                .dimensions(left, Math.min(this.height - 26, top + ITEMS.length * 24), buttonWidth, 20).build());
    }

    @Override
    public void render(DrawContext context, int mouseX, int mouseY, float delta) {
        renderBackground(context, mouseX, mouseY, delta);
        context.drawCenteredTextWithShadow(textRenderer, title, width / 2, 20, 0xFFFFB347);
        context.drawCenteredTextWithShadow(textRenderer,
                Text.literal("Локальный выбор · F9 — быстро сменить"), width / 2, 36, 0xFFCCCCCC);
        super.render(context, mouseX, mouseY, delta);
    }

    @Override
    public boolean shouldPause() {
        return false;
    }
}
