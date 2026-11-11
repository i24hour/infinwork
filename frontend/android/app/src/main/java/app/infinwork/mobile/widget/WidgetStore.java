package app.infinwork.mobile.widget;

import android.content.Context;
import android.content.SharedPreferences;

final class WidgetStore {
    static final String PREFS = "infinwork_widget";
    private static final String KEY_TOKEN = "token";
    private static final String KEY_BASE = "baseUrl";
    private static final String KEY_SNAPSHOT = "lastSnapshotJson";
    static final String DEFAULT_BASE = "https://infinwork.app";

    private WidgetStore() {}

    private static SharedPreferences prefs(Context context) {
        return context.getApplicationContext().getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    static String token(Context context) {
        return prefs(context).getString(KEY_TOKEN, "");
    }

    static String baseUrl(Context context) {
        return normalizeBase(prefs(context).getString(KEY_BASE, DEFAULT_BASE));
    }

    static String lastSnapshot(Context context) {
        return prefs(context).getString(KEY_SNAPSHOT, null);
    }

    static void saveConnection(Context context, String token, String baseUrl) {
        prefs(context).edit()
                .putString(KEY_TOKEN, token == null ? "" : token.trim())
                .putString(KEY_BASE, normalizeBase(baseUrl))
                .apply();
    }

    static void saveSnapshot(Context context, String json) {
        prefs(context).edit().putString(KEY_SNAPSHOT, json).apply();
    }

    static String normalizeBase(String raw) {
        String value = raw == null ? "" : raw.trim();
        if (value.isEmpty()) {
            return DEFAULT_BASE;
        }
        if (!value.startsWith("https://") && !value.startsWith("http://")) {
            value = "https://" + value;
        }
        while (value.endsWith("/")) {
            value = value.substring(0, value.length() - 1);
        }
        return value;
    }
}
