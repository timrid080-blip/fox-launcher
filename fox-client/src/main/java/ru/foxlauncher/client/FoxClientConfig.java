package ru.foxlauncher.client;

import net.fabricmc.loader.api.FabricLoader;

import java.io.IOException;
import java.io.Reader;
import java.io.Writer;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;
import java.util.Properties;

/** Small, local-only config. It never stores account credentials or network data. */
public final class FoxClientConfig {
    private static final Path FILE = FabricLoader.getInstance().getConfigDir().resolve("foxclient.properties");
    private static final List<String> COSMETICS = List.of("none", "cape", "pumpkin", "wings", "hood", "crown", "backpack", "halo");
    private static boolean coordinatesEnabled = true;
    private static String equippedCosmetic = "none";

    static {
        load();
    }

    private FoxClientConfig() {}

    public static synchronized boolean areCoordinatesEnabled() {
        return coordinatesEnabled;
    }

    public static synchronized void setCoordinatesEnabled(boolean enabled) {
        coordinatesEnabled = enabled;
        save();
    }

    public static synchronized String getEquippedCosmetic() {
        return equippedCosmetic;
    }

    public static synchronized void setEquippedCosmetic(String cosmetic) {
        equippedCosmetic = COSMETICS.contains(cosmetic) ? cosmetic : "none";
        save();
    }

    public static synchronized String cycleCosmetic() {
        int index = COSMETICS.indexOf(equippedCosmetic);
        equippedCosmetic = COSMETICS.get((index + 1 + COSMETICS.size()) % COSMETICS.size());
        save();
        return equippedCosmetic;
    }

    public static String displayName(String cosmetic) {
        return switch (cosmetic) {
            case "cape" -> "Плащ Fox";
            case "pumpkin" -> "Тыквенный шлем Fox";
            case "wings" -> "Крылья Fox";
            case "hood" -> "Капюшон Fox";
            case "crown" -> "Корона Fox";
            case "backpack" -> "Рюкзак Fox";
            case "halo" -> "Светящийся нимб";
            default -> "выключено";
        };
    }

    private static synchronized void load() {
        Properties properties = new Properties();
        if (Files.isRegularFile(FILE)) {
            try (Reader reader = Files.newBufferedReader(FILE)) {
                properties.load(reader);
                coordinatesEnabled = Boolean.parseBoolean(properties.getProperty("coordinates", "true"));
                String cosmetic = properties.getProperty("cosmetic", "none");
                equippedCosmetic = COSMETICS.contains(cosmetic) ? cosmetic : "none";
            } catch (IOException ignored) {
                coordinatesEnabled = true;
                equippedCosmetic = "none";
            }
        }
    }

    private static synchronized void save() {
        Properties properties = new Properties();
        properties.setProperty("coordinates", Boolean.toString(coordinatesEnabled));
        properties.setProperty("cosmetic", equippedCosmetic);
        try {
            Files.createDirectories(FILE.getParent());
            try (Writer writer = Files.newBufferedWriter(FILE)) {
                properties.store(writer, "Fox Client local settings");
            }
        } catch (IOException ignored) {
            // The feature still works for this session if the config directory is read-only.
        }
    }
}
